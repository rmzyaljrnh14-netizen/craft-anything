'use strict';

const { OAUTH_SCOPES } = require('./defaults');
const {
  isVideoFile,
  isThumbnailFile,
  MAX_THUMBNAIL_BYTES,
  parseNextOffsetFromRangeHeader,
  resolveThumbnailMimeType
} = require('./youtube-utils');
const { readSession, writeSession, getOAuthCredentials, extractBearerToken } = require('./session');

const YOUTUBE_RESUMABLE_PREFIX = 'https://www.googleapis.com/upload/youtube/v3/videos';
const ALLOWED_YOUTUBE_UPLOAD_HOSTS = new Set([
  'www.googleapis.com',
  'youtube.googleapis.com'
]);

function extractApiError(parsed, rawText) {
  let rawMsg = String(rawText || 'Unknown Google API error').slice(0, 350);
  let reason = '';

  if (parsed && parsed.error) {
    if (typeof parsed.error === 'string') {
      rawMsg = parsed.error_description || parsed.error;
    } else {
      if (parsed.error.message) rawMsg = parsed.error.message;
      if (Array.isArray(parsed.error.errors) && parsed.error.errors[0] && parsed.error.errors[0].reason) {
        reason = String(parsed.error.errors[0].reason);
      }
    }
  }

  const lower = `${reason} ${rawMsg}`.toLowerCase();
  if (lower.includes('has not been used in project') || lower.includes('accessnotconfigured') || lower.includes('it is disabled')) {
    return `واجهة YouTube أو Drive غير مفعّلة في مشروعك على Google Cloud — فعّل YouTube Data API v3 و Google Drive API ثم حاول بعد دقيقة. (${rawMsg})`;
  }
  if (lower.includes('youtubesignuprequired') || lower.includes('channelnotfound') || lower.includes('has not created a youtube channel')) {
    return `لا توجد قناة يوتيوب منشأة على هذا الحساب بعد — افتح youtube.com وأنشئ قناة أولاً ثم أعد المحاولة. (${rawMsg})`;
  }
  if (lower.includes('insufficientpermissions') || lower.includes('insufficient authentication scopes') || lower.includes('access_token_scope_insufficient')) {
    return `صلاحية الرفع على يوتيوب غير مفعّلة في هذه الجلسة — اضغط «تسجيل الخروج» ثم أعد الربط مع تحديد جميع مربعات الصلاحيات. (${rawMsg})`;
  }
  if (lower.includes('uploadlimitexceeded')) {
    return `وصلت القناة للحد اليومي للرفع على يوتيوب (أثبت ملكية القناة أو جرّب لاحقاً). (${rawMsg})`;
  }
  if (lower.includes('quotaexceeded')) {
    return `تم استهلاك الحصة اليومية لـ YouTube API في مشروعك على Google Cloud. (${rawMsg})`;
  }

  return rawMsg;
}

async function parseJsonResponse(resp) {
  const text = await resp.text();
  try {
    return { parsed: text ? JSON.parse(text) : null, text };
  } catch {
    return { parsed: null, text };
  }
}

function buildGoogleAuthUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: OAUTH_SCOPES.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function exchangeCodeForTokens({ code, clientId, clientSecret, redirectUri, fetchImpl = fetch }) {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  });

  const resp = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  const { parsed, text } = await parseJsonResponse(resp);
  if (!resp.ok || !parsed || !parsed.access_token) {
    throw new Error(`فشل تبادل رمز الدخول مع Google (${resp.status}): ${extractApiError(parsed, text)}`);
  }

  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token || null,
    expiresAt: Date.now() + Number(parsed.expires_in || 3600) * 1000,
    scope: parsed.scope || ''
  };
}

async function refreshAccessToken({ refreshToken, clientId, clientSecret, fetchImpl = fetch }) {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token'
  });

  const resp = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  const { parsed, text } = await parseJsonResponse(resp);
  if (!resp.ok || !parsed || !parsed.access_token) {
    throw new Error(`انتهت جلسة Google وتعذر تجديدها (${resp.status}): ${extractApiError(parsed, text)}`);
  }

  return {
    accessToken: parsed.access_token,
    expiresAt: Date.now() + Number(parsed.expires_in || 3600) * 1000
  };
}

/**
 * Resolves a valid Google OAuth access token from either:
 * 1) Authorization: Bearer <token> header (Quick GIS Client-ID mode)
 * 2) Encrypted HttpOnly session cookie (auto-refreshing via refresh_token if expired)
 */
async function resolveAccessToken(req, res, fetchImpl = fetch) {
  const bearer = extractBearerToken(req);
  if (bearer) {
    return { accessToken: bearer, mode: 'gis' };
  }

  const session = readSession(req);
  if (!session.accessToken && !session.refreshToken) {
    return { accessToken: null, mode: null };
  }

  const isExpired = !session.accessToken || (session.expiresAt && Date.now() >= session.expiresAt - 60000);
  if (!isExpired) {
    return { accessToken: session.accessToken, mode: 'oauth_server', hasRefreshToken: Boolean(session.refreshToken) };
  }

  if (session.refreshToken) {
    const creds = getOAuthCredentials(req);
    if (creds.clientId && creds.clientSecret) {
      const refreshed = await refreshAccessToken({
        refreshToken: session.refreshToken,
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        fetchImpl
      });
      const updated = {
        ...session,
        accessToken: refreshed.accessToken,
        expiresAt: refreshed.expiresAt
      };
      writeSession(req, res, updated);
      return { accessToken: refreshed.accessToken, mode: 'oauth_server', hasRefreshToken: true };
    }
  }

  return { accessToken: null, mode: null };
}

async function fetchGoogleUserAndChannel(accessToken, fetchImpl = fetch) {
  const [userResp, ytResp] = await Promise.all([
    fetchImpl('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    }),
    fetchImpl('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true', {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
  ]);

  const userJson = await parseJsonResponse(userResp);
  if (!userResp.ok) {
    throw new Error(`تعذر جلب بيانات حساب Google (${userResp.status}): ${extractApiError(userJson.parsed, userJson.text)}`);
  }

  const ytJson = await parseJsonResponse(ytResp);
  let channel = null;
  let youtubeError = null;
  if (ytResp.ok && ytJson.parsed && Array.isArray(ytJson.parsed.items) && ytJson.parsed.items.length > 0) {
    const item = ytJson.parsed.items[0];
    channel = {
      id: item.id,
      title: item.snippet ? item.snippet.title : 'YouTube Channel',
      customUrl: item.snippet ? item.snippet.customUrl || '' : '',
      thumbnail:
        item.snippet && item.snippet.thumbnails && item.snippet.thumbnails.default
          ? item.snippet.thumbnails.default.url
          : '',
      subscriberCount: item.statistics ? item.statistics.subscriberCount || '0' : '0',
      videoCount: item.statistics ? item.statistics.videoCount || '0' : '0'
    };
  } else if (!ytResp.ok) {
    youtubeError = extractApiError(ytJson.parsed, ytJson.text);
  }

  return {
    user: {
      email: userJson.parsed ? userJson.parsed.email : '',
      name: userJson.parsed ? userJson.parsed.name : '',
      picture: userJson.parsed ? userJson.parsed.picture : ''
    },
    channel,
    youtubeError
  };
}

async function listDriveFolderContents(accessToken, folderId, fetchImpl = fetch) {
  const safeFolder = String(folderId || 'root').replace(/'/g, "\\'");
  const q = `'${safeFolder}' in parents and trashed = false`;
  const url =
    'https://www.googleapis.com/drive/v3/files?' +
    `q=${encodeURIComponent(q)}` +
    `&fields=${encodeURIComponent('files(id,name,mimeType,size,createdTime,modifiedTime,webViewLink,thumbnailLink,parents)')}` +
    `&orderBy=${encodeURIComponent('modifiedTime desc')}` +
    '&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true';

  const resp = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const { parsed, text } = await parseJsonResponse(resp);
  if (!resp.ok) {
    throw new Error(`فشل قراءة مجلد Drive (${resp.status}): ${extractApiError(parsed, text)}`);
  }

  const all = (parsed && Array.isArray(parsed.files)) ? parsed.files : [];
  const videos = all.filter(isVideoFile);
  const thumbnails = all.filter(isThumbnailFile);
  const folders = all.filter((f) => f.mimeType === 'application/vnd.google-apps.folder');

  return { videos, thumbnails, folders };
}

async function getDriveFileMetadata(accessToken, fileId, fetchImpl = fetch) {
  const url =
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}` +
    `?fields=${encodeURIComponent('id,name,mimeType,size,parents,trashed,webViewLink')}` +
    '&supportsAllDrives=true';

  const resp = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const { parsed, text } = await parseJsonResponse(resp);
  if (!resp.ok || !parsed) {
    throw new Error(`فشل جلب بيانات الملف من Drive (${resp.status}): ${extractApiError(parsed, text)}`);
  }
  return parsed;
}

async function downloadDriveRange(accessToken, fileId, start, end, fetchImpl = fetch) {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
  const resp = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Range: `bytes=${start}-${end}`
    }
  });
  if (resp.status !== 206 && resp.status !== 200) {
    const { parsed, text } = await parseJsonResponse(resp);
    throw new Error(`فشل قراءة مقطع الفيديو من Drive (${resp.status}): ${extractApiError(parsed, text)}`);
  }
  const arrayBuf = await resp.arrayBuffer();
  let buf = Buffer.from(arrayBuf);
  const expected = end - start + 1;
  if (resp.status === 200 && buf.length > expected && end < buf.length) {
    buf = buf.subarray(start, end + 1);
  }
  if (buf.length !== expected) {
    throw new Error(`عدم تطابق حجم المقطع المحمّل من Drive (المتوقع ${expected} بايت، الفعلي ${buf.length} بايت).`);
  }
  return buf;
}

async function moveDriveFile(accessToken, fileId, fromParentId, toParentId, fetchImpl = fetch) {
  if (!toParentId || fromParentId === toParentId) return;
  let url =
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}` +
    `?addParents=${encodeURIComponent(toParentId)}&supportsAllDrives=true&fields=id,parents`;
  if (fromParentId) {
    url += `&removeParents=${encodeURIComponent(fromParentId)}`;
  }

  const resp = await fetchImpl(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: '{}'
  });
  if (!resp.ok) {
    const { parsed, text } = await parseJsonResponse(resp);
    throw new Error(`فشل نقل الملف في Drive (${resp.status}): ${extractApiError(parsed, text)}`);
  }
}

async function initiateYouTubeResumableUpload(accessToken, metadata, fileSize, mimeType, fetchImpl = fetch) {
  const url = `${YOUTUBE_RESUMABLE_PREFIX}?uploadType=resumable&part=snippet,status`;
  const resp = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(fileSize),
      'X-Upload-Content-Type': mimeType
    },
    body: JSON.stringify(metadata)
  });

  if (resp.status !== 200) {
    const { parsed, text } = await parseJsonResponse(resp);
    throw new Error(`فشل بدء الرفع على YouTube (${resp.status}): ${extractApiError(parsed, text)}`);
  }

  const location = resp.headers.get('location') || resp.headers.get('Location');
  assertValidYouTubeUploadUri(location);
  return location;
}

function assertValidYouTubeUploadUri(uploadUri) {
  if (typeof uploadUri !== 'string' || !uploadUri) {
    throw new Error('لم يُرجع YouTube رابط جلسة الرفع القابل للاستئناف.');
  }
  let parsed;
  try {
    parsed = new URL(uploadUri);
  } catch {
    throw new Error('رابط جلسة رفع YouTube غير صالح.');
  }
  if (
    parsed.protocol !== 'https:' ||
    !ALLOWED_YOUTUBE_UPLOAD_HOSTS.has(parsed.hostname) ||
    !parsed.pathname.startsWith('/upload/youtube/v3/videos')
  ) {
    throw new Error('رابط جلسة رفع YouTube غير صالح.');
  }
}

async function uploadChunkToYouTube(accessToken, { uploadUri, start, end, totalSize, mimeType, chunkBuffer }, fetchImpl = fetch) {
  assertValidYouTubeUploadUri(uploadUri);

  const resp = await fetchImpl(uploadUri, {
    method: 'PUT',
    redirect: 'manual',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': mimeType,
      'Content-Length': String(chunkBuffer.length),
      'Content-Range': `bytes ${start}-${end}/${totalSize}`
    },
    body: chunkBuffer
  });

  if (resp.status === 200 || resp.status === 201) {
    const { parsed } = await parseJsonResponse(resp);
    if (!parsed || !parsed.id) {
      throw new Error('اكتمل الرفع لكن لم يُرجع YouTube معرف الفيديو.');
    }
    return { done: true, videoId: parsed.id, nextOffset: totalSize, percent: 100 };
  }

  if (resp.status === 308) {
    const rangeHeader = resp.headers.get('range') || resp.headers.get('Range');
    const nextOffset = parseNextOffsetFromRangeHeader(rangeHeader, end + 1);
    const percent = Math.min(99, Math.floor((nextOffset / totalSize) * 100));
    return { done: false, videoId: null, nextOffset, percent };
  }

  const { parsed, text } = await parseJsonResponse(resp);
  throw new Error(`فشل رفع المقطع على YouTube (${resp.status}): ${extractApiError(parsed, text)}`);
}

async function uploadYouTubeThumbnailFromDrive(accessToken, videoId, thumbFile, fetchImpl = fetch) {
  const size = Number(thumbFile.size || 0);
  if (size <= 0 || size > MAX_THUMBNAIL_BYTES) {
    throw new Error('حجم الصورة المصغرة يجب أن يكون أقل من 2MB.');
  }
  const bytes = await downloadDriveRange(accessToken, thumbFile.id, 0, size - 1, fetchImpl);
  const mimeType = resolveThumbnailMimeType(thumbFile.mimeType, thumbFile.name);
  const url = `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`;

  const resp = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': mimeType,
      'Content-Length': String(bytes.length)
    },
    body: bytes
  });

  if (!resp.ok) {
    const { parsed, text } = await parseJsonResponse(resp);
    throw new Error(`تعذر رفع الصورة المصغرة (${resp.status}): ${extractApiError(parsed, text)}`);
  }
}

async function appendPublishedRowToSheet(accessToken, spreadsheetId, rowValues, fetchImpl = fetch) {
  if (!spreadsheetId) return;
  const range = encodeURIComponent('Queue!A:O');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const resp = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ values: [rowValues] })
  });

  if (!resp.ok) {
    const { parsed, text } = await parseJsonResponse(resp);
    throw new Error(`تعذر تسجيل الفيديو في Google Sheet (${resp.status}): ${extractApiError(parsed, text)}`);
  }
}

module.exports = {
  YOUTUBE_RESUMABLE_PREFIX,
  buildGoogleAuthUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  resolveAccessToken,
  fetchGoogleUserAndChannel,
  listDriveFolderContents,
  getDriveFileMetadata,
  downloadDriveRange,
  moveDriveFile,
  initiateYouTubeResumableUpload,
  assertValidYouTubeUploadUri,
  uploadChunkToYouTube,
  uploadYouTubeThumbnailFromDrive,
  appendPublishedRowToSheet
};
