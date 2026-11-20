'use strict';

const { DEFAULTS } = require('../../lib/defaults');
const { readJsonBody, sendJson } = require('../../lib/http');
const {
  resolveAccessToken,
  moveDriveFile,
  uploadYouTubeThumbnailFromDrive,
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
    if (!videoId || !fileId) {
      return sendJson(res, 400, { error: 'معرف الفيديو ومعرف الملف مطلوبان.' });
    }

    const warnings = [];
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const studioUrl = `https://studio.youtube.com/video/${videoId}/edit`;

    // 1. Optional custom thumbnail
    if (body.attachThumbnail && body.matchingThumbnail && body.matchingThumbnail.id) {
      try {
        await uploadYouTubeThumbnailFromDrive(auth.accessToken, videoId, body.matchingThumbnail);
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

    // 2. Optional move video to Published folder
    if (body.moveToPublished) {
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

    // 3. Optional log to Google Sheet
    if (body.logToSheet) {
      const sheetId = String(body.spreadsheetId || DEFAULTS.SPREADSHEET_ID).trim();
      if (sheetId) {
        try {
          const sizeMb = Math.round((Number(body.fileSize || 0) / (1024 * 1024)) * 100) / 100;
          const row = [
            fileId,
            String(body.fileName || ''),
            sizeMb,
            'PUBLISHED',
            String(body.title || ''),
            String(body.description || ''),
            Array.isArray(body.tags) ? body.tags.join(', ') : String(body.tags || ''),
            String(body.privacyStatus || 'private'),
            String(body.publishAt || ''),
            String(body.categoryId || '22'),
            body.madeForKids ? 'TRUE' : 'FALSE',
            '100%',
            youtubeUrl,
            0,
            warnings.length > 0 ? `تم النشر (تنبيه: ${warnings.join(' | ')})` : 'تم النشر عبر Drive2Tube Studio'
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
      warnings
    });
  } catch (err) {
    return sendJson(res, 500, { error: err.message || 'تعذر إتمام خطوات ما بعد الرفع.' });
  }
};
