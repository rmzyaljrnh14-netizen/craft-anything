'use strict';

const { DEFAULTS } = require('../../lib/defaults');
const { readJsonBody, sendJson } = require('../../lib/http');
const {
  resolveAccessToken,
  moveDriveFile,
  uploadYouTubeThumbnailFromDrive,
  uploadYouTubeCaptionFromDrive,
  applyYouTubeLocalization,
  findOrCreateYouTubePlaylist,
  addVideoToYouTubePlaylist,
  postYouTubeFirstComment,
  appendPublishedRowToSheet
} = require('../../lib/google-api');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method Not Allowed' });
  }

  try {
    const auth = await resolveAccessToken(req, res);
    if (!auth.accessToken) {
      return sendJson(res, 401, { error: 'يرجى ربط حساب Google أولاً.' });
    }

    const body = await readJsonBody(req);
    const videoId = String(body.videoId || '').trim();
    const fileId = String(body.fileId || '').trim();
    if (!videoId) {
      return sendJson(res, 400, { error: 'معرف الفيديو مطلوب.' });
    }

    const warnings = [];
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const studioUrl = `https://studio.youtube.com/video/${videoId}/edit`;

    // 1. Optional custom thumbnail
    let thumbnailUploaded = false;
    if (body.attachThumbnail && body.matchingThumbnail && body.matchingThumbnail.id) {
      try {
        await uploadYouTubeThumbnailFromDrive(auth.accessToken, videoId, body.matchingThumbnail);
        thumbnailUploaded = true;
        if (body.moveToPublished && body.publishedFolderId) {
          try {
            await moveDriveFile(
              auth.accessToken,
              body.matchingThumbnail.id,
              body.sourceFolderId || '',
              body.publishedFolderId
            );
          } catch (moveThumbErr) {
            warnings.push(`تم رفع الصورة المصغرة لكن تعذر نقلها: ${moveThumbErr.message}`);
          }
        }
      } catch (thumbErr) {
        warnings.push(thumbErr.message);
      }
    }

    // 2. Multi-language subtitles (.srt): upload Arabic + English (and any matched tracks)
    const uploadedSubtitles = [];
    const subtitleList = Array.isArray(body.allSubtitles) && body.allSubtitles.length > 0
      ? body.allSubtitles
      : body.matchingSubtitle && body.matchingSubtitle.id
        ? [{ ...body.matchingSubtitle, language: body.language || DEFAULTS.DEFAULT_LANGUAGE || 'ar', label: 'العربية' }]
        : [];

    if (body.attachSubtitle && subtitleList.length > 0) {
      for (const sub of subtitleList) {
        if (!sub || !sub.id) continue;
        try {
          await uploadYouTubeCaptionFromDrive(
            auth.accessToken,
            videoId,
            sub,
            sub.language || 'ar',
            sub.label || ''
          );
          uploadedSubtitles.push(sub.language || 'ar');
        } catch (subErr) {
          warnings.push(
            `تنبيه الترجمة (${sub.language || 'ar'}): ${subErr.message} — (إذا ظهرت رسالة صلاحيات، أعد ربط الحساب مرة واحدة)`
          );
        }
      }
    }

    // 3. Global English Localization (Title + Description) for international discovery
    let localizedEn = false;
    if (body.applyEnglishLocalization && body.englishMeta && body.englishMeta.title) {
      try {
        await applyYouTubeLocalization(
          auth.accessToken,
          videoId,
          'en',
          body.englishMeta.title,
          body.englishMeta.description || ''
        );
        localizedEn = true;
      } catch (locErr) {
        warnings.push(`تنبيه الترجمة العالمية (EN): ${locErr.message}`);
      }
    }

    // 4. Auto-Playlist linking (Session Watch Time multiplier!)
    let playlistLinked = null;
    if (body.addToPlaylist && body.playlistTitle) {
      try {
        const pl = await findOrCreateYouTubePlaylist(auth.accessToken, body.playlistTitle);
        if (pl && pl.id) {
          await addVideoToYouTubePlaylist(auth.accessToken, pl.id, videoId);
          playlistLinked = pl;
        }
      } catch (plErr) {
        warnings.push(`تنبيه قائمة التشغيل: ${plErr.message}`);
      }
    }

    // 5. Auto First Engagement Comment (boosts first-hour engagement velocity)
    let commentPosted = false;
    const isPrivateOrScheduled =
      String(body.privacyStatus || 'private').toLowerCase() === 'private' || Boolean(body.publishAt);
    if (body.postFirstComment && body.firstComment) {
      if (isPrivateOrScheduled) {
        warnings.push(
          'التعليق التفاعلي الأول جاهز للنسخ — يوتيوب يسمح بنشر التعليقات فقط بعد تحوّل الفيديو من «خاص/مجدول» إلى «عام».'
        );
      } else {
        try {
          await postYouTubeFirstComment(auth.accessToken, videoId, body.firstComment);
          commentPosted = true;
        } catch (cErr) {
          warnings.push(`تنبيه التعليق الأول: ${cErr.message}`);
        }
      }
    }

    // 6. Optional move video to Published folder (only when uploaded from Drive)
    if (body.moveToPublished && fileId) {
      const targetFolder = String(body.publishedFolderId || DEFAULTS.PUBLISHED_FOLDER_ID).trim();
      const sourceParent = String(body.sourceFolderId || '').trim();
      if (targetFolder && targetFolder !== sourceParent) {
        try {
          await moveDriveFile(auth.accessToken, fileId, sourceParent, targetFolder);
        } catch (moveErr) {
          warnings.push(`تعذر نقل الفيديو إلى مجلد المنشورات: ${moveErr.message}`);
        }
      }
    }

    // 7. Optional log to Google Sheet
    if (body.logToSheet) {
      const sheetId = String(body.spreadsheetId || DEFAULTS.SPREADSHEET_ID).trim();
      if (sheetId) {
        try {
          const sizeMb = Math.round((Number(body.fileSize || 0) / (1024 * 1024)) * 100) / 100;
          const row = [
            fileId || `short_${videoId}`,
            String(body.fileName || ''),
            sizeMb,
            'PUBLISHED',
            String(body.title || ''),
            String(body.description || ''),
            Array.isArray(body.tags) ? body.tags.join(', ') : String(body.tags || ''),
            String(body.privacyStatus || 'private'),
            String(body.publishAt || ''),
            String(body.categoryId || '27'),
            body.madeForKids ? 'TRUE' : 'FALSE',
            '100%',
            youtubeUrl,
            0,
            warnings.length > 0 ? `تم النشر (تنبيه: ${warnings.join(' | ')})` : 'تم النشر عبر Drive2Tube Viral Engine'
          ];
          await appendPublishedRowToSheet(auth.accessToken, sheetId, row);
        } catch (sheetErr) {
          warnings.push(sheetErr.message);
        }
      }
    }

    return sendJson(res, 200, {
      ok: true,
      videoId,
      youtubeUrl,
      studioUrl,
      thumbnailUploaded,
      subtitleUploaded: uploadedSubtitles.length > 0,
      uploadedSubtitles,
      localizedEn,
      playlistLinked,
      commentPosted,
      warnings
    });
  } catch (err) {
    return sendJson(res, 500, { error: err.message || 'تعذر إتمام خطوات ما بعد الرفع.' });
  }
};
