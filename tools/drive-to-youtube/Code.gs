/**
 * Google Drive -> YouTube Auto-Publisher (Google Apps Script)
 *
 * Watches a Google Drive folder (YouTube_Queue), syncs video files to a Google Sheet
 * dashboard, uploads them to YouTube using chunked Resumable Uploads (supports >50 MB
 * videos and resumes automatically across Apps Script's 6-minute execution limit),
 * optionally attaches a matching thumbnail image, logs results, and moves processed
 * files to YouTube_Published or YouTube_Failed.
 */

const DEFAULT_SPREADSHEET_ID = '1KLpJRf3f3RzAtRo75dZa2dAF1zhqoC-7NAXQ80lJ7WU';

const DEFAULT_SETTINGS = {
  QUEUE_FOLDER_ID: '1w8S6j9i6FCuZmIBsAbSTt-tSWGM05GI0',
  PUBLISHED_FOLDER_ID: '1IiRsRxQ0IA-dNWTrDYY8grySSPqfMzGF',
  FAILED_FOLDER_ID: '1aVfmXO_IRr8yGJRwqGdBPcQbiXgQN2kC',
  DEFAULT_PRIVACY: 'private',
  DEFAULT_DESCRIPTION: '',
  DEFAULT_TAGS: '',
  DEFAULT_CATEGORY_ID: '22',
  DEFAULT_LANGUAGE: 'ar',
  DEFAULT_MADE_FOR_KIDS: false,
  AUTO_START_UPLOAD: true,
  MAX_VIDEOS_PER_RUN: 2,
  MAX_RETRIES: 3,
  CHUNK_SIZE_MB: 16,
  NOTIFY_EMAIL: ''
};

const SHEET_NAMES = {
  QUEUE: 'Queue',
  SETTINGS: 'Settings',
  LOGS: 'Logs'
};

// 0-based column indices in the Queue sheet (columns A..O)
const COL = {
  FILE_ID: 0,
  FILE_NAME: 1,
  SIZE_MB: 2,
  STATUS: 3,
  TITLE: 4,
  DESCRIPTION: 5,
  TAGS: 6,
  PRIVACY: 7,
  PUBLISH_AT: 8,
  CATEGORY_ID: 9,
  MADE_FOR_KIDS: 10,
  PROGRESS: 11,
  YOUTUBE_URL: 12,
  RETRIES: 13,
  NOTES: 14
};

const STATUS = {
  PENDING: 'PENDING',
  UPLOADING: 'UPLOADING',
  PUBLISHED: 'PUBLISHED',
  FAILED: 'FAILED',
  PAUSED: 'PAUSED'
};

const VALID_PRIVACY = ['private', 'unlisted', 'public'];
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v', '.wmv', '.flv', '.3gp', '.mpeg', '.mpg'];
const THUMBNAIL_EXTENSIONS = ['.jpg', '.jpeg', '.png'];
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const MAX_EXECUTION_MS = 240000; // 4 minutes safety budget (Apps Script limit is 6 minutes)
const UPLOAD_STATE_PREFIX = 'YT_UPLOAD_STATE_';

// ============================================================================
// Menu & Triggers
// ============================================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🎬 النشر التلقائي ليوتيوب')
    .addItem('🔄 فحص مجلد الانتظار الآن', 'scanQueueFolderMenu')
    .addItem('▶️ رفع الفيديوهات الجاهزة الآن', 'runAutoPublisherMenu')
    .addSeparator()
    .addItem('⏱️ تفعيل التشغيل التلقائي (كل 15 دقيقة)', 'installAutoTrigger')
    .addItem('⏹️ إيقاف التشغيل التلقائي', 'removeAutoTriggers')
    .addSeparator()
    .addItem('🧪 فحص الاتصال والصلاحيات', 'testConnection')
    .addToUi();
}

function scanQueueFolderMenu() {
  const result = syncDriveQueueToSheet();
  showUiAlert(
    'فحص مجلد الانتظار',
    'تم فحص مجلد YouTube_Queue بنجاح.\n' +
      'الفيديوهات الجديدة المضافة: ' + result.added + '\n' +
      'إجمالي الفيديوهات في المجلد: ' + result.totalInFolder
  );
}

function runAutoPublisherMenu() {
  const summary = runAutoPublisher();
  showUiAlert(
    'نتيجة الرفع إلى يوتيوب',
    'تم النشر: ' + summary.published + '\n' +
      'قيد الاستكمال (فيديو كبير): ' + summary.inProgress + '\n' +
      'فشل: ' + summary.failed + '\n' +
      'أُضيف من Drive: ' + summary.added
  );
}

function installAutoTrigger() {
  removeAutoTriggers(true);
  ScriptApp.newTrigger('runAutoPublisher')
    .timeBased()
    .everyMinutes(15)
    .create();

  appendLog('INFO', '-', 'تم تفعيل التشغيل التلقائي كل 15 دقيقة بنجاح.');
  showUiAlert(
    'تم تفعيل النشر التلقائي',
    'سيتم فحص مجلد YouTube_Queue ورفع الفيديوهات الجديدة تلقائياً كل 15 دقيقة.'
  );
}

function removeAutoTriggers(silent) {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'runAutoPublisher') {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }
  if (!silent) {
    appendLog('INFO', '-', 'تم إيقاف التشغيل التلقائي (عدد المؤقتات المحذوفة: ' + removed + ').');
    showUiAlert('تم الإيقاف', 'تم حذف المؤقتات التلقائية (' + removed + ').');
  }
}

function testConnection() {
  const settings = loadSettings();
  const token = ScriptApp.getOAuthToken();
  const lines = [];

  // 1. Check Drive folders
  const folderChecks = [
    ['YouTube_Queue', settings.QUEUE_FOLDER_ID],
    ['YouTube_Published', settings.PUBLISHED_FOLDER_ID],
    ['YouTube_Failed', settings.FAILED_FOLDER_ID]
  ];
  for (let i = 0; i < folderChecks.length; i++) {
    const label = folderChecks[i][0];
    const folderId = folderChecks[i][1];
    try {
      const meta = driveGetFileMetadata(folderId, token);
      lines.push('✅ مجلد ' + label + ': ' + meta.name);
    } catch (err) {
      lines.push('❌ مجلد ' + label + ': ' + err.message);
    }
  }

  // 2. Check YouTube channel authorization
  try {
    const resp = UrlFetchApp.fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
      {
        method: 'get',
        headers: { Authorization: 'Bearer ' + token },
        muteHttpExceptions: true
      }
    );
    const code = resp.getResponseCode();
    const body = parseJsonSafe(resp.getContentText());
    if (code >= 200 && code < 300) {
      if (body && body.items && body.items.length > 0) {
        lines.push('✅ قناة يوتيوب المتصلة: ' + body.items[0].snippet.title);
      } else {
        lines.push('⚠️ تم الاتصال بـ YouTube API ولكن لا توجد قناة يوتيوب منشأة لهذا الحساب بعد.');
      }
    } else {
      lines.push('❌ YouTube API (' + code + '): ' + extractApiError(body, resp.getContentText()));
    }
  } catch (err) {
    lines.push('❌ فشل الاتصال بـ YouTube API: ' + err.message);
  }

  const report = lines.join('\n');
  appendLog('INFO', '-', 'فحص الاتصال: ' + lines.join(' | '));
  showUiAlert('نتيجة فحص الاتصال والصلاحيات', report);
  return report;
}

// ============================================================================
// Main Orchestrator
// ============================================================================

function runAutoPublisher() {
  const summary = { added: 0, published: 0, inProgress: 0, failed: 0, skippedLock: false };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    appendLog('INFO', '-', 'توجد عملية رفع أخرى قيد التنفيذ حالياً — تم تخطي هذه الدورة.');
    summary.skippedLock = true;
    return summary;
  }

  const runStartedAt = Date.now();
  try {
    const settings = loadSettings();
    const syncRes = syncDriveQueueToSheet(settings);
    summary.added = syncRes.added;

    const sheet = getSheet(SHEET_NAMES.QUEUE);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return summary;
    }

    const token = ScriptApp.getOAuthToken();
    const rows = sheet.getRange(2, 1, lastRow - 1, 15).getValues();
    const queueImages = listFolderThumbnails(settings.QUEUE_FOLDER_ID, token);

    let processedCount = 0;

    // Prioritize resuming UPLOADING rows before starting new PENDING rows
    const candidateIndices = [];
    for (let i = 0; i < rows.length; i++) {
      const st = String(rows[i][COL.STATUS] || '').trim().toUpperCase();
      if (st === STATUS.UPLOADING) candidateIndices.push(i);
    }
    for (let i = 0; i < rows.length; i++) {
      const st = String(rows[i][COL.STATUS] || '').trim().toUpperCase();
      if (st === STATUS.PENDING) candidateIndices.push(i);
    }

    for (let k = 0; k < candidateIndices.length; k++) {
      if (processedCount >= settings.MAX_VIDEOS_PER_RUN) {
        break;
      }
      if (Date.now() - runStartedAt >= MAX_EXECUTION_MS) {
        appendLog('INFO', '-', 'الاقتراب من حد وقت التشغيل — سيتم استكمال باقي القائمة في الدورة القادمة.');
        break;
      }

      const idx = candidateIndices[k];
      const rowNum = idx + 2;
      const row = rows[idx];
      const fileId = String(row[COL.FILE_ID] || '').trim();
      const fileName = String(row[COL.FILE_NAME] || '').trim();

      if (!fileId) {
        continue;
      }

      try {
        const outcome = processVideoRow(sheet, rowNum, row, settings, token, queueImages, runStartedAt);
        processedCount++;
        if (outcome.status === STATUS.PUBLISHED) {
          summary.published++;
        } else if (outcome.status === STATUS.UPLOADING) {
          summary.inProgress++;
          break; // Execution budget reached; resume on next trigger
        }
      } catch (err) {
        summary.failed++;
        handleRowFailure(sheet, rowNum, row, settings, token, err);
      }
    }

    return summary;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Scans YouTube_Queue folder and appends any newly discovered video files to the Queue sheet.
 */
function syncDriveQueueToSheet(existingSettings) {
  const settings = existingSettings || loadSettings();
  const token = ScriptApp.getOAuthToken();
  const files = listFolderVideos(settings.QUEUE_FOLDER_ID, token);

  const sheet = getSheet(SHEET_NAMES.QUEUE);
  const lastRow = sheet.getLastRow();
  const existingIds = {};

  if (lastRow >= 2) {
    const idValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < idValues.length; i++) {
      const id = String(idValues[i][0] || '').trim();
      if (id) existingIds[id] = true;
    }
  }

  const newRows = [];
  const initialStatus = settings.AUTO_START_UPLOAD ? STATUS.PENDING : STATUS.PAUSED;

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (existingIds[f.id]) continue;

    const sizeBytes = Number(f.size || 0);
    const sizeMb = Math.round((sizeBytes / (1024 * 1024)) * 100) / 100;
    const title = cleanVideoTitle(f.name);

    newRows.push([
      f.id,
      f.name,
      sizeMb,
      initialStatus,
      title,
      settings.DEFAULT_DESCRIPTION,
      settings.DEFAULT_TAGS,
      settings.DEFAULT_PRIVACY,
      '',
      settings.DEFAULT_CATEGORY_ID,
      settings.DEFAULT_MADE_FOR_KIDS ? 'TRUE' : 'FALSE',
      '0%',
      '',
      0,
      'تم الاكتشاف تلقائياً من Drive'
    ]);
  }

  if (newRows.length > 0) {
    sheet.getRange(lastRow + 1, 1, newRows.length, 15).setValues(newRows);
    appendLog('INFO', '-', 'تمت إضافة ' + newRows.length + ' فيديو جديد من مجلد YouTube_Queue.');
  }

  return { added: newRows.length, totalInFolder: files.length };
}

function processVideoRow(sheet, rowNum, row, settings, token, queueImages, runStartedAt) {
  const fileId = String(row[COL.FILE_ID]).trim();
  const fileMeta = driveGetFileMetadata(fileId, token);

  if (fileMeta.trashed) {
    throw new Error('الملف موجود في سلة المحذوفات في Google Drive.');
  }

  const fileSize = Number(fileMeta.size || 0);
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    throw new Error('حجم الملف غير صالح أو الملف فارغ (0 بايت).');
  }

  const fileName = fileMeta.name || String(row[COL.FILE_NAME] || 'video.mp4');
  const mimeType = resolveVideoMimeType(fileMeta.mimeType, fileName);
  const metadata = buildYouTubeMetadata(row, fileName, settings);

  updateRowCells(sheet, rowNum, {
    status: STATUS.UPLOADING,
    notes: 'جاري الرفع إلى يوتيوب...'
  });

  const uploadResult = uploadDriveFileToYouTubeResumable({
    fileId: fileId,
    fileName: fileName,
    fileSize: fileSize,
    mimeType: mimeType,
    metadata: metadata,
    chunkSizeBytes: computeChunkSizeBytes(settings.CHUNK_SIZE_MB),
    token: token,
    runStartedAt: runStartedAt,
    onProgress: function (percent) {
      sheet.getRange(rowNum, COL.PROGRESS + 1).setValue(percent + '%');
    }
  });

  if (!uploadResult.completed) {
    updateRowCells(sheet, rowNum, {
      status: STATUS.UPLOADING,
      progress: uploadResult.percent + '%',
      notes: 'جاري الاستكمال تلقائياً في الدورة القادمة (' + uploadResult.percent + '%)'
    });
    appendLog('INFO', fileName, 'تم رفع ' + uploadResult.percent + '% وسيُستكمل تلقائياً في الدورة القادمة.');
    return { status: STATUS.UPLOADING };
  }

  const videoId = uploadResult.videoId;
  const videoUrl = 'https://www.youtube.com/watch?v=' + videoId;
  const notesParts = ['تم الرفع بنجاح'];

  // Optional matching thumbnail upload
  const thumbFile = findMatchingThumbnail(fileName, queueImages);
  if (thumbFile) {
    try {
      uploadThumbnailFromDrive(videoId, thumbFile, token);
      notesParts.push('تم رفع الصورة المصغرة');
      try {
        driveMoveFile(thumbFile.id, settings.QUEUE_FOLDER_ID, settings.PUBLISHED_FOLDER_ID, token);
      } catch (moveThumbErr) {
        appendLog('WARN', thumbFile.name, 'تم رفع الصورة المصغرة لكن تعذر نقلها: ' + moveThumbErr.message);
      }
    } catch (thumbErr) {
      notesParts.push('تنبيه صورة مصغرة: ' + thumbErr.message);
      appendLog('WARN', fileName, 'تم رفع الفيديو بنجاح لكن تعذر رفع الصورة المصغرة: ' + thumbErr.message);
    }
  }

  // Move video from Queue -> Published
  try {
    driveMoveFile(fileId, settings.QUEUE_FOLDER_ID, settings.PUBLISHED_FOLDER_ID, token);
  } catch (moveErr) {
    notesParts.push('تنبيه نقل الملف: ' + moveErr.message);
    appendLog('WARN', fileName, 'تم النشر على يوتيوب لكن تعذر نقل الملف إلى YouTube_Published: ' + moveErr.message);
  }

  updateRowCells(sheet, rowNum, {
    status: STATUS.PUBLISHED,
    progress: '100%',
    youtubeUrl: videoUrl,
    notes: notesParts.join(' | ')
  });

  appendLog('SUCCESS', fileName, 'تم النشر بنجاح: ' + videoUrl);
  sendNotificationEmail(
    settings.NOTIFY_EMAIL,
    '✅ تم نشر فيديو جديد على يوتيوب: ' + metadata.snippet.title,
    'تم رفع الفيديو بنجاح من Google Drive إلى YouTube.\n\n' +
      'العنوان: ' + metadata.snippet.title + '\n' +
      'الخصوصية: ' + metadata.status.privacyStatus + '\n' +
      'رابط المشاهدة: ' + videoUrl + '\n' +
      'رابط التعديل في YouTube Studio: https://studio.youtube.com/video/' + videoId + '/edit\n'
  );

  return { status: STATUS.PUBLISHED, videoId: videoId, videoUrl: videoUrl };
}

function handleRowFailure(sheet, rowNum, row, settings, token, err) {
  const fileId = String(row[COL.FILE_ID] || '').trim();
  const fileName = String(row[COL.FILE_NAME] || fileId);
  const prevRetries = Number(row[COL.RETRIES] || 0);
  const nextRetries = prevRetries + 1;
  const errMsg = err && err.message ? err.message : String(err);

  if (nextRetries >= settings.MAX_RETRIES) {
    clearUploadState(fileId);
    try {
      driveMoveFile(fileId, settings.QUEUE_FOLDER_ID, settings.FAILED_FOLDER_ID, token);
    } catch (moveErr) {
      appendLog('WARN', fileName, 'تعذر نقل الملف الفاشل إلى YouTube_Failed: ' + moveErr.message);
    }

    updateRowCells(sheet, rowNum, {
      status: STATUS.FAILED,
      retries: nextRetries,
      notes: 'فشل نهائي بعد ' + nextRetries + ' محاولات: ' + errMsg
    });
    appendLog('ERROR', fileName, 'فشل نهائي: ' + errMsg);
    sendNotificationEmail(
      settings.NOTIFY_EMAIL,
      '❌ فشل رفع فيديو إلى يوتيوب: ' + fileName,
      'تعذر رفع الملف بعد ' + nextRetries + ' محاولات وتم نقله إلى مجلد YouTube_Failed.\n\nالسبب:\n' + errMsg
    );
  } else {
    updateRowCells(sheet, rowNum, {
      status: STATUS.PENDING,
      retries: nextRetries,
      notes: 'محاولة ' + nextRetries + '/' + settings.MAX_RETRIES + ' — ' + errMsg
    });
    appendLog('WARN', fileName, 'خطأ مؤقت (محاولة ' + nextRetries + '/' + settings.MAX_RETRIES + '): ' + errMsg);
  }
}

// ============================================================================
// Chunked Resumable Upload (Drive Range GET -> YouTube Resumable PUT)
// ============================================================================

function uploadDriveFileToYouTubeResumable(opts) {
  const fileId = opts.fileId;
  const fileSize = opts.fileSize;
  const mimeType = opts.mimeType;
  const chunkSizeBytes = opts.chunkSizeBytes;
  const token = opts.token;
  const runStartedAt = opts.runStartedAt;

  let state = loadUploadState(fileId);
  let uploadUri = state && state.uploadUri ? state.uploadUri : null;
  let offset = state && Number.isFinite(state.nextOffset) ? state.nextOffset : 0;

  // Verify existing resumable session if present
  if (uploadUri) {
    const probe = probeResumableSession(uploadUri, fileSize, token);
    if (probe.state === 'COMPLETED') {
      clearUploadState(fileId);
      return { completed: true, videoId: probe.videoId, percent: 100 };
    } else if (probe.state === 'ACTIVE') {
      offset = probe.nextOffset;
    } else {
      // Session expired or invalid -> start fresh
      clearUploadState(fileId);
      uploadUri = null;
      offset = 0;
    }
  }

  // Initiate new resumable upload session if needed
  if (!uploadUri) {
    uploadUri = initiateYouTubeResumableUpload(opts.metadata, fileSize, mimeType, token);
    offset = 0;
    saveUploadState(fileId, { uploadUri: uploadUri, nextOffset: 0, updatedAt: new Date().toISOString() });
  }

  while (offset < fileSize) {
    if (Date.now() - runStartedAt >= MAX_EXECUTION_MS) {
      const pct = calculateProgressPercent(offset, fileSize);
      saveUploadState(fileId, { uploadUri: uploadUri, nextOffset: offset, updatedAt: new Date().toISOString() });
      return { completed: false, percent: pct };
    }

    const range = computeNextChunkRange(offset, fileSize, chunkSizeBytes);
    const chunkBytes = driveDownloadRange(fileId, range.start, range.end, token);

    const putResp = UrlFetchApp.fetch(uploadUri, {
      method: 'put',
      contentType: mimeType,
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Range': 'bytes ' + range.start + '-' + range.end + '/' + fileSize
      },
      payload: chunkBytes,
      muteHttpExceptions: true
    });

    const code = putResp.getResponseCode();
    if (code === 200 || code === 201) {
      const data = parseJsonSafe(putResp.getContentText());
      if (!data || !data.id) {
        throw new Error('اكتمل الرفع لكن لم يُرجع يوتيوب معرف الفيديو.');
      }
      clearUploadState(fileId);
      if (opts.onProgress) opts.onProgress(100);
      return { completed: true, videoId: data.id, percent: 100 };
    }

    if (code === 308) {
      const rangeHeader = getHeaderCaseInsensitive(putResp.getAllHeaders(), 'Range');
      const confirmedNext = parseNextOffsetFromRangeHeader(rangeHeader, range.end + 1);
      offset = confirmedNext;
      saveUploadState(fileId, { uploadUri: uploadUri, nextOffset: offset, updatedAt: new Date().toISOString() });
      if (opts.onProgress) {
        opts.onProgress(calculateProgressPercent(offset, fileSize));
      }
      continue;
    }

    if (code === 404 || code === 410) {
      clearUploadState(fileId);
      throw new Error('انتهت جلسة الرفع المؤقتة على يوتيوب (HTTP ' + code + ') — ستتم إعادة البدء تلقائياً.');
    }

    const body = parseJsonSafe(putResp.getContentText());
    throw new Error('فشل رفع الجزء (' + code + '): ' + extractApiError(body, putResp.getContentText()));
  }

  throw new Error('انتهت حلقة الرفع دون استلام تأكيد نهائي من يوتيوب.');
}

function initiateYouTubeResumableUpload(metadata, fileSize, mimeType, token) {
  const url = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json; charset=UTF-8',
    headers: {
      Authorization: 'Bearer ' + token,
      'X-Upload-Content-Length': String(fileSize),
      'X-Upload-Content-Type': mimeType
    },
    payload: JSON.stringify(metadata),
    muteHttpExceptions: true
  });

  const code = resp.getResponseCode();
  if (code !== 200) {
    const body = parseJsonSafe(resp.getContentText());
    throw new Error('فشل بدء جلسة الرفع على يوتيوب (' + code + '): ' + extractApiError(body, resp.getContentText()));
  }

  const location = getHeaderCaseInsensitive(resp.getAllHeaders(), 'Location');
  if (!location) {
    throw new Error('لم يُرجع YouTube API رابط جلسة الرفع (Location header).');
  }
  return location;
}

function probeResumableSession(uploadUri, fileSize, token) {
  const resp = UrlFetchApp.fetch(uploadUri, {
    method: 'put',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Range': 'bytes */' + fileSize
    },
    muteHttpExceptions: true
  });

  const code = resp.getResponseCode();
  if (code === 200 || code === 201) {
    const data = parseJsonSafe(resp.getContentText());
    if (data && data.id) {
      return { state: 'COMPLETED', videoId: data.id };
    }
    return { state: 'EXPIRED' };
  }
  if (code === 308) {
    const rangeHeader = getHeaderCaseInsensitive(resp.getAllHeaders(), 'Range');
    const nextOffset = parseNextOffsetFromRangeHeader(rangeHeader, 0);
    return { state: 'ACTIVE', nextOffset: nextOffset };
  }
  return { state: 'EXPIRED' };
}

function uploadThumbnailFromDrive(videoId, thumbFile, token) {
  const thumbSize = Number(thumbFile.size || 0);
  if (thumbSize <= 0 || thumbSize > MAX_THUMBNAIL_BYTES) {
    throw new Error('حجم الصورة المصغرة يجب أن يكون أقل من 2MB.');
  }

  const mimeType = resolveThumbnailMimeType(thumbFile.mimeType, thumbFile.name);
  const bytes = driveDownloadRange(thumbFile.id, 0, thumbSize - 1, token);

  const url =
    'https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=' +
    encodeURIComponent(videoId) +
    '&uploadType=media';

  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: mimeType,
    headers: { Authorization: 'Bearer ' + token },
    payload: bytes,
    muteHttpExceptions: true
  });

  const code = resp.getResponseCode();
  if (code < 200 || code >= 300) {
    const body = parseJsonSafe(resp.getContentText());
    throw new Error('HTTP ' + code + ': ' + extractApiError(body, resp.getContentText()));
  }
}

// ============================================================================
// Google Drive REST v3 Helpers
// ============================================================================

function listFolderVideos(folderId, token) {
  const allFiles = listFolderFiles(folderId, token);
  const videos = [];
  for (let i = 0; i < allFiles.length; i++) {
    if (isVideoFile(allFiles[i])) {
      videos.push(allFiles[i]);
    }
  }
  return videos;
}

function listFolderThumbnails(folderId, token) {
  const allFiles = listFolderFiles(folderId, token);
  const images = [];
  for (let i = 0; i < allFiles.length; i++) {
    if (isThumbnailFile(allFiles[i])) {
      images.push(allFiles[i]);
    }
  }
  return images;
}

function listFolderFiles(folderId, token) {
  const results = [];
  let pageToken = '';

  do {
    const q = "'" + folderId.replace(/'/g, "\\'") + "' in parents and trashed = false";
    let url =
      'https://www.googleapis.com/drive/v3/files?' +
      'q=' + encodeURIComponent(q) +
      '&fields=' + encodeURIComponent('nextPageToken,files(id,name,mimeType,size,createdTime,trashed)') +
      '&orderBy=' + encodeURIComponent('createdTime asc') +
      '&pageSize=100' +
      '&supportsAllDrives=true&includeItemsFromAllDrives=true';

    if (pageToken) {
      url += '&pageToken=' + encodeURIComponent(pageToken);
    }

    const resp = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });

    const code = resp.getResponseCode();
    const data = parseJsonSafe(resp.getContentText());
    if (code < 200 || code >= 300) {
      throw new Error('فشل قراءة مجلد Drive (' + code + '): ' + extractApiError(data, resp.getContentText()));
    }

    if (data && Array.isArray(data.files)) {
      for (let i = 0; i < data.files.length; i++) {
        results.push(data.files[i]);
      }
    }
    pageToken = data && data.nextPageToken ? data.nextPageToken : '';
  } while (pageToken);

  return results;
}

function driveGetFileMetadata(fileId, token) {
  const url =
    'https://www.googleapis.com/drive/v3/files/' +
    encodeURIComponent(fileId) +
    '?fields=' + encodeURIComponent('id,name,mimeType,size,parents,trashed') +
    '&supportsAllDrives=true';

  const resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });

  const code = resp.getResponseCode();
  const data = parseJsonSafe(resp.getContentText());
  if (code < 200 || code >= 300) {
    throw new Error('فشل جلب بيانات الملف (' + code + '): ' + extractApiError(data, resp.getContentText()));
  }
  return data;
}

function driveDownloadRange(fileId, start, end, token) {
  const url =
    'https://www.googleapis.com/drive/v3/files/' +
    encodeURIComponent(fileId) +
    '?alt=media&supportsAllDrives=true';

  const resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + token,
      Range: 'bytes=' + start + '-' + end
    },
    muteHttpExceptions: true
  });

  const code = resp.getResponseCode();
  if (code !== 206 && code !== 200) {
    const body = parseJsonSafe(resp.getContentText());
    throw new Error('فشل تحميل جزء من Drive (' + code + '): ' + extractApiError(body, resp.getContentText()));
  }

  const bytes = resp.getContent();
  const expectedLength = end - start + 1;
  if (bytes.length !== expectedLength) {
    throw new Error(
      'عدم تطابق حجم الجزء المحمّل من Drive (المتوقع ' + expectedLength + ' بايت، الفعلي ' + bytes.length + ' بايت).'
    );
  }
  return bytes;
}

function driveMoveFile(fileId, fromFolderId, toFolderId, token) {
  if (!toFolderId || fromFolderId === toFolderId) return;

  const url =
    'https://www.googleapis.com/drive/v3/files/' +
    encodeURIComponent(fileId) +
    '?addParents=' + encodeURIComponent(toFolderId) +
    '&removeParents=' + encodeURIComponent(fromFolderId) +
    '&supportsAllDrives=true&fields=id,parents';

  const resp = UrlFetchApp.fetch(url, {
    method: 'patch',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: '{}',
    muteHttpExceptions: true
  });

  const code = resp.getResponseCode();
  if (code < 200 || code >= 300) {
    const body = parseJsonSafe(resp.getContentText());
    throw new Error('HTTP ' + code + ': ' + extractApiError(body, resp.getContentText()));
  }
}

// ============================================================================
// Pure Helpers (Tested via Node.js Unit Tests)
// ============================================================================

function isVideoFile(file) {
  if (!file || !file.name) return false;
  if (file.mimeType === 'application/vnd.google-apps.folder') return false;
  if (file.mimeType && String(file.mimeType).toLowerCase().indexOf('video/') === 0) {
    return true;
  }
  const lower = String(file.name).toLowerCase();
  for (let i = 0; i < VIDEO_EXTENSIONS.length; i++) {
    if (lower.endsWith(VIDEO_EXTENSIONS[i])) return true;
  }
  return false;
}

function isThumbnailFile(file) {
  if (!file || !file.name) return false;
  const mime = String(file.mimeType || '').toLowerCase();
  if (mime === 'image/jpeg' || mime === 'image/png') return true;
  const lower = String(file.name).toLowerCase();
  for (let i = 0; i < THUMBNAIL_EXTENSIONS.length; i++) {
    if (lower.endsWith(THUMBNAIL_EXTENSIONS[i])) return true;
  }
  return false;
}

function stripExtension(fileName) {
  const str = String(fileName || '').trim();
  const lastDot = str.lastIndexOf('.');
  if (lastDot <= 0) return str;
  return str.slice(0, lastDot);
}

function findMatchingThumbnail(videoFileName, thumbnailFiles) {
  if (!videoFileName || !Array.isArray(thumbnailFiles) || thumbnailFiles.length === 0) {
    return null;
  }
  const base = stripExtension(videoFileName).trim().toLowerCase();
  for (let i = 0; i < thumbnailFiles.length; i++) {
    const img = thumbnailFiles[i];
    if (stripExtension(img.name).trim().toLowerCase() === base) {
      return img;
    }
  }
  return null;
}

function sanitizeYouTubeText(text, maxLength) {
  let clean = String(text || '')
    .replace(/[<>]/g, '')
    .replace(/\r\n/g, '\n')
    .trim();

  if (clean.length > maxLength) {
    // Avoid splitting UTF-16 surrogate pairs
    let cut = maxLength;
    const code = clean.charCodeAt(cut - 1);
    if (code >= 0xd800 && code <= 0xdbff) {
      cut -= 1;
    }
    clean = clean.slice(0, cut).trim();
  }
  return clean;
}

function cleanVideoTitle(fileName) {
  const withoutExt = stripExtension(fileName);
  const normalized = withoutExt.replace(/\s+/g, ' ').trim();
  const safe = sanitizeYouTubeText(normalized, 100);
  return safe || 'Untitled Video';
}

function parseTags(rawTags) {
  if (!rawTags) return [];
  const parts = String(rawTags).split(/[,،\n]+/);
  const seen = {};
  const result = [];
  let totalChars = 0;

  for (let i = 0; i < parts.length; i++) {
    const tag = sanitizeYouTubeText(parts[i], 100);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen[key]) continue;

    // YouTube counts tags plus comma/quote overhead against a 500-char ceiling
    const overhead = tag.indexOf(' ') >= 0 ? tag.length + 3 : tag.length + 1;
    if (totalChars + overhead > 480) break;

    seen[key] = true;
    result.push(tag);
    totalChars += overhead;
  }
  return result;
}

function normalizePrivacy(rawPrivacy, fallback) {
  const candidate = String(rawPrivacy || '').trim().toLowerCase();
  if (VALID_PRIVACY.indexOf(candidate) >= 0) return candidate;
  const fb = String(fallback || 'private').trim().toLowerCase();
  return VALID_PRIVACY.indexOf(fb) >= 0 ? fb : 'private';
}

function parseBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  const s = String(value === undefined || value === null ? '' : value).trim().toLowerCase();
  if (s === 'true' || s === 'yes' || s === '1' || s === 'نعم') return true;
  if (s === 'false' || s === 'no' || s === '0' || s === 'لا') return false;
  return Boolean(fallback);
}

function normalizePublishAt(rawValue, nowMs) {
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
    return null;
  }
  const dt = rawValue instanceof Date ? rawValue : new Date(String(rawValue).trim());
  if (isNaN(dt.getTime())) {
    throw new Error('صيغة وقت النشر المجدول غير صالحة. استخدم صيغة ISO مثل: 2026-12-01T18:00:00+03:00');
  }
  const refNow = typeof nowMs === 'number' ? nowMs : Date.now();
  if (dt.getTime() <= refNow + 60000) {
    throw new Error('وقت النشر المجدول يجب أن يكون في المستقبل (بعد دقيقة على الأقل من الآن).');
  }
  return dt.toISOString();
}

function buildYouTubeMetadata(row, fileName, settings, nowMs) {
  const titleInput = row[COL.TITLE] ? String(row[COL.TITLE]) : cleanVideoTitle(fileName);
  const title = sanitizeYouTubeText(titleInput, 100) || cleanVideoTitle(fileName);

  const descInput =
    row[COL.DESCRIPTION] !== undefined && String(row[COL.DESCRIPTION]).trim() !== ''
      ? String(row[COL.DESCRIPTION])
      : String(settings.DEFAULT_DESCRIPTION || '');
  const description = sanitizeYouTubeText(descInput, 5000);

  const tagsInput =
    row[COL.TAGS] !== undefined && String(row[COL.TAGS]).trim() !== ''
      ? String(row[COL.TAGS])
      : String(settings.DEFAULT_TAGS || '');
  const tags = parseTags(tagsInput);

  const categoryId = String(row[COL.CATEGORY_ID] || settings.DEFAULT_CATEGORY_ID || '22').trim();
  const madeForKids = parseBoolean(row[COL.MADE_FOR_KIDS], settings.DEFAULT_MADE_FOR_KIDS);
  const publishAt = normalizePublishAt(row[COL.PUBLISH_AT], nowMs);

  // YouTube requires privacyStatus='private' when publishAt is specified
  const privacyStatus = publishAt
    ? 'private'
    : normalizePrivacy(row[COL.PRIVACY], settings.DEFAULT_PRIVACY);

  const snippet = {
    title: title,
    description: description,
    categoryId: categoryId
  };
  if (tags.length > 0) {
    snippet.tags = tags;
  }
  if (settings.DEFAULT_LANGUAGE) {
    snippet.defaultLanguage = String(settings.DEFAULT_LANGUAGE).trim();
    snippet.defaultAudioLanguage = String(settings.DEFAULT_LANGUAGE).trim();
  }

  const statusObj = {
    privacyStatus: privacyStatus,
    selfDeclaredMadeForKids: madeForKids
  };
  if (publishAt) {
    statusObj.publishAt = publishAt;
  }

  return {
    snippet: snippet,
    status: statusObj
  };
}

function computeChunkSizeBytes(chunkSizeMb) {
  const n = Number(chunkSizeMb);
  const clampedMb = Number.isFinite(n) ? Math.min(32, Math.max(1, Math.round(n))) : 16;
  return clampedMb * 1024 * 1024; // Always an exact multiple of 256 KiB
}

function computeNextChunkRange(offset, totalSize, chunkSizeBytes) {
  const start = offset;
  const end = Math.min(offset + chunkSizeBytes - 1, totalSize - 1);
  return { start: start, end: end, length: end - start + 1 };
}

function calculateProgressPercent(bytesUploaded, totalSize) {
  if (!totalSize || totalSize <= 0) return 0;
  return Math.min(100, Math.max(0, Math.floor((bytesUploaded / totalSize) * 100)));
}

function parseNextOffsetFromRangeHeader(rangeHeader, fallbackOffset) {
  if (!rangeHeader) return fallbackOffset;
  const match = String(rangeHeader).match(/bytes=\d+-(\d+)/i);
  if (!match) return fallbackOffset;
  const lastByte = parseInt(match[1], 10);
  return Number.isFinite(lastByte) ? lastByte + 1 : fallbackOffset;
}

function getHeaderCaseInsensitive(headers, targetName) {
  if (!headers || typeof headers !== 'object') return null;
  const lowerTarget = String(targetName).toLowerCase();
  const keys = Object.keys(headers);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === lowerTarget) {
      const val = headers[keys[i]];
      return Array.isArray(val) ? val[0] : val;
    }
  }
  return null;
}

function resolveVideoMimeType(mimeType, fileName) {
  if (mimeType && String(mimeType).toLowerCase().indexOf('video/') === 0) {
    return mimeType;
  }
  const lower = String(fileName || '').toLowerCase();
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mkv')) return 'video/x-matroska';
  if (lower.endsWith('.avi')) return 'video/x-msvideo';
  return 'video/mp4';
}

function resolveThumbnailMimeType(mimeType, fileName) {
  const m = String(mimeType || '').toLowerCase();
  if (m === 'image/png' || String(fileName || '').toLowerCase().endsWith('.png')) {
    return 'image/png';
  }
  return 'image/jpeg';
}

function parseJsonSafe(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

function extractApiError(parsedBody, rawText) {
  if (parsedBody && parsedBody.error) {
    if (typeof parsedBody.error === 'string') return parsedBody.error;
    if (parsedBody.error.message) return parsedBody.error.message;
  }
  return String(rawText || 'Unknown error').slice(0, 300);
}

// ============================================================================
// Spreadsheet, Properties & Notification Helpers
// ============================================================================

function getSpreadsheet() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  return SpreadsheetApp.openById(DEFAULT_SPREADSHEET_ID);
}

function getSheet(name) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) {
    throw new Error('تعذر العثور على ورقة العمل: ' + name);
  }
  return sheet;
}

function loadSettings() {
  const settings = Object.assign({}, DEFAULT_SETTINGS);
  try {
    const sheet = getSheet(SHEET_NAMES.SETTINGS);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return settings;

    const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    for (let i = 0; i < data.length; i++) {
      const key = String(data[i][0] || '').trim();
      const val = data[i][1];
      if (!key || !(key in settings)) continue;

      if (key === 'DEFAULT_MADE_FOR_KIDS' || key === 'AUTO_START_UPLOAD') {
        settings[key] = parseBoolean(val, settings[key]);
      } else if (key === 'MAX_VIDEOS_PER_RUN' || key === 'MAX_RETRIES' || key === 'CHUNK_SIZE_MB') {
        const num = Number(val);
        if (Number.isFinite(num) && num > 0) settings[key] = num;
      } else if (key === 'DEFAULT_PRIVACY') {
        settings[key] = normalizePrivacy(val, settings[key]);
      } else {
        const str = String(val === undefined || val === null ? '' : val).trim();
        if (str !== '' || key === 'DEFAULT_DESCRIPTION' || key === 'DEFAULT_TAGS' || key === 'NOTIFY_EMAIL') {
          settings[key] = str;
        }
      }
    }
  } catch (err) {
    // Fallback cleanly to DEFAULT_SETTINGS
  }
  return settings;
}

function updateRowCells(sheet, rowNum, updates) {
  if (updates.status !== undefined) {
    sheet.getRange(rowNum, COL.STATUS + 1).setValue(updates.status);
  }
  if (updates.progress !== undefined) {
    sheet.getRange(rowNum, COL.PROGRESS + 1).setValue(updates.progress);
  }
  if (updates.youtubeUrl !== undefined) {
    sheet.getRange(rowNum, COL.YOUTUBE_URL + 1).setValue(updates.youtubeUrl);
  }
  if (updates.retries !== undefined) {
    sheet.getRange(rowNum, COL.RETRIES + 1).setValue(updates.retries);
  }
  if (updates.notes !== undefined) {
    sheet.getRange(rowNum, COL.NOTES + 1).setValue(updates.notes);
  }
}

function appendLog(level, fileName, message) {
  try {
    const sheet = getSheet(SHEET_NAMES.LOGS);
    const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Aden', 'yyyy-MM-dd HH:mm:ss');
    sheet.appendRow([now, level, fileName || '-', message]);
  } catch (e) {
    // Avoid breaking upload flow if log write fails
  }
}

function loadUploadState(fileId) {
  const raw = PropertiesService.getScriptProperties().getProperty(UPLOAD_STATE_PREFIX + fileId);
  return parseJsonSafe(raw);
}

function saveUploadState(fileId, stateObj) {
  PropertiesService.getScriptProperties().setProperty(UPLOAD_STATE_PREFIX + fileId, JSON.stringify(stateObj));
}

function clearUploadState(fileId) {
  PropertiesService.getScriptProperties().deleteProperty(UPLOAD_STATE_PREFIX + fileId);
}

function sendNotificationEmail(email, subject, body) {
  const target = String(email || '').trim();
  if (!target) return;
  try {
    MailApp.sendEmail(target, subject, body);
  } catch (err) {
    appendLog('WARN', '-', 'تعذر إرسال إشعار البريد الإلكتروني: ' + err.message);
  }
}

function showUiAlert(title, message) {
  try {
    SpreadsheetApp.getUi().alert(title, message, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    // Running from a time-driven trigger where UI is not available
  }
}

// ============================================================================
// Built-in Web App UI (Zero Google Cloud / Zero Client ID — 1-Click Google Auth)
// ============================================================================

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Drive2Tube — ربط قوقل درايف بيوتيوب تلقائياً')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getConnectedYouTubeChannel(token) {
  const url = 'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true';
  const resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  const code = resp.getResponseCode();
  const data = parseJsonSafe(resp.getContentText());
  if (code >= 200 && code < 300 && data && Array.isArray(data.items) && data.items.length > 0) {
    const item = data.items[0];
    return {
      id: item.id,
      title: item.snippet ? item.snippet.title : 'قناة يوتيوب',
      thumbnail:
        item.snippet && item.snippet.thumbnails && item.snippet.thumbnails.default
          ? item.snippet.thumbnails.default.url
          : '',
      subscriberCount: item.statistics ? item.statistics.subscriberCount || '0' : '0',
      videoCount: item.statistics ? item.statistics.videoCount || '0' : '0'
    };
  }
  return null;
}

function hasAutoPublishTrigger() {
  try {
    const triggers = ScriptApp.getProjectTriggers();
    for (let i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === 'runAutoPublisher') {
        return true;
      }
    }
  } catch (e) {
    // Ignore when triggers API unavailable
  }
  return false;
}

function webGetDashboardState() {
  const settings = loadSettings();
  const token = ScriptApp.getOAuthToken();
  let email = '';
  try {
    email = Session.getActiveUser().getEmail() || '';
  } catch (e) {
    email = '';
  }

  let channel = null;
  try {
    channel = getConnectedYouTubeChannel(token);
  } catch (e) {
    channel = null;
  }

  return {
    ok: true,
    email: email,
    channel: channel,
    autoEnabled: hasAutoPublishTrigger(),
    settings: {
      queueFolderId: settings.QUEUE_FOLDER_ID,
      publishedFolderId: settings.PUBLISHED_FOLDER_ID,
      failedFolderId: settings.FAILED_FOLDER_ID,
      defaultPrivacy: settings.DEFAULT_PRIVACY,
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + DEFAULT_SPREADSHEET_ID + '/edit'
    }
  };
}

function webListVideos(folderKey) {
  const settings = loadSettings();
  const token = ScriptApp.getOAuthToken();
  let folderId = settings.QUEUE_FOLDER_ID;
  if (folderKey === 'root') {
    folderId = 'root';
  } else if (folderKey === 'published') {
    folderId = settings.PUBLISHED_FOLDER_ID;
  } else if (folderKey && folderKey !== 'queue') {
    folderId = String(folderKey).trim();
  }

  const allFiles = listFolderFiles(folderId, token);
  const videos = [];
  const thumbnails = [];
  for (let i = 0; i < allFiles.length; i++) {
    if (isVideoFile(allFiles[i])) {
      videos.push(allFiles[i]);
    } else if (isThumbnailFile(allFiles[i])) {
      thumbnails.push(allFiles[i]);
    }
  }

  const out = [];
  for (let i = 0; i < videos.length; i++) {
    const v = videos[i];
    const thumb = findMatchingThumbnail(v.name, thumbnails);
    const sizeBytes = Number(v.size || 0);
    out.push({
      id: v.id,
      name: v.name,
      sizeBytes: sizeBytes,
      sizeMb: Math.round((sizeBytes / (1024 * 1024)) * 100) / 100,
      suggestedTitle: cleanVideoTitle(v.name),
      driveUrl: 'https://drive.google.com/file/d/' + v.id + '/view',
      thumbnailName: thumb ? thumb.name : ''
    });
  }

  return { ok: true, folderId: folderId, videos: out };
}

function webPublishSingleVideo(payload) {
  const settings = loadSettings();
  const token = ScriptApp.getOAuthToken();
  const fileId = String(payload.fileId || '').trim();
  if (!fileId) {
    throw new Error('معرف الفيديو مطلوب.');
  }

  const fileMeta = driveGetFileMetadata(fileId, token);
  const metadata = buildYouTubeMetadata(
    {
      title: payload.title,
      description: payload.description,
      tags: payload.tags,
      privacyStatus: payload.privacyStatus || settings.DEFAULT_PRIVACY,
      publishAt: payload.publishAt || '',
      categoryId: payload.categoryId || settings.DEFAULT_CATEGORY_ID,
      madeForKids: Boolean(payload.madeForKids)
    },
    settings,
    fileMeta.name
  );

  const result = uploadDriveFileToYouTubeResumable(
    fileId,
    metadata,
    settings,
    token,
    Date.now(),
    function () {}
  );

  if (result.status !== 'COMPLETED') {
    return {
      ok: true,
      inProgress: true,
      progressPct: result.progressPct,
      message: 'تم رفع ' + result.progressPct + '% من الفيديو — اضغط مرة أخرى للاستئناف أو دع النشر التلقائي يكمله.'
    };
  }

  const youtubeUrl = 'https://www.youtube.com/watch?v=' + result.videoId;
  const studioUrl = 'https://studio.youtube.com/video/' + result.videoId + '/edit';

  // Optional move to Published folder
  if (payload.moveToPublished && settings.PUBLISHED_FOLDER_ID) {
    const sourceParent = fileMeta.parents && fileMeta.parents.length ? fileMeta.parents[0] : '';
    if (sourceParent !== settings.PUBLISHED_FOLDER_ID) {
      try {
        driveMoveFile(fileId, sourceParent, settings.PUBLISHED_FOLDER_ID, token);
      } catch (e) {
        appendLog('WARN', fileId, 'تم الرفع لكن تعذر نقل الملف: ' + e.message);
      }
    }
  }

  appendLog('INFO', fileId, 'تم النشر من واجهة الويب: ' + youtubeUrl);
  return {
    ok: true,
    inProgress: false,
    videoId: result.videoId,
    youtubeUrl: youtubeUrl,
    studioUrl: studioUrl
  };
}

function webToggleAutoTrigger(enable) {
  if (enable) {
    const settings = loadSettings();
    const minutes = Math.max(5, Number(settings.TRIGGER_INTERVAL_MIN) || 15);
    const triggers = ScriptApp.getProjectTriggers();
    for (let i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === 'runAutoPublisher') {
        ScriptApp.deleteTrigger(triggers[i]);
      }
    }
    const allowedMinutes = minutes <= 5 ? 5 : minutes <= 10 ? 10 : minutes <= 15 ? 15 : 30;
    ScriptApp.newTrigger('runAutoPublisher').timeBased().everyMinutes(allowedMinutes).create();
    return { ok: true, autoEnabled: true, minutes: allowedMinutes };
  } else {
    const triggers = ScriptApp.getProjectTriggers();
    for (let i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === 'runAutoPublisher') {
        ScriptApp.deleteTrigger(triggers[i]);
      }
    }
    return { ok: true, autoEnabled: false };
  }
}

function webRunAutoPublisherNow() {
  runAutoPublisher();
  return { ok: true };
}

// Export for automated unit testing in Node.js (ignored in Google Apps Script V8)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    COL,
    STATUS,
    DEFAULT_SETTINGS,
    DEFAULT_SPREADSHEET_ID,
    isVideoFile,
    isThumbnailFile,
    stripExtension,
    findMatchingThumbnail,
    sanitizeYouTubeText,
    cleanVideoTitle,
    parseTags,
    normalizePrivacy,
    parseBoolean,
    normalizePublishAt,
    buildYouTubeMetadata,
    computeChunkSizeBytes,
    computeNextChunkRange,
    calculateProgressPercent,
    parseNextOffsetFromRangeHeader,
    getHeaderCaseInsensitive,
    resolveVideoMimeType,
    resolveThumbnailMimeType,
    extractApiError,
    uploadDriveFileToYouTubeResumable,
    syncDriveQueueToSheet,
    runAutoPublisher,
    doGet,
    webGetDashboardState,
    webListVideos,
    webPublishSingleVideo,
    webToggleAutoTrigger
  };
}
