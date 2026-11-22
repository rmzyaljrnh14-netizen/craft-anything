'use strict';

const { readJsonBody, sendJson } = require('../../lib/http');
const {
  resolveAccessToken,
  getDriveFileMetadata,
  initiateYouTubeResumableUpload
} = require('../../lib/google-api');
const {
  buildYouTubeMetadata,
  resolveVideoMimeType,
  computeChunkSizeBytes
} = require('../../lib/youtube-utils');

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

    // Mode A: Direct browser upload (e.g. 9:16 Viral Short clipped inside Drive2Tube Studio)
    if (body.directUpload) {
      const fileSize = Number(body.fileSize || 0);
      const fileName = String(body.fileName || 'viral-short-9x16.webm').trim();
      if (!Number.isFinite(fileSize) || fileSize <= 0) {
        return sendJson(res, 400, { error: 'حجم ملف الشورت غير صالح.' });
      }
      const mimeType = resolveVideoMimeType(body.mimeType, fileName);
      const metadata = buildYouTubeMetadata(body, fileName);
      const uploadUri = await initiateYouTubeResumableUpload(
        auth.accessToken,
        metadata,
        fileSize,
        mimeType
      );
      return sendJson(res, 200, {
        ok: true,
        uploadUri,
        fileId: '',
        fileName,
        fileSize,
        mimeType,
        metadata
      });
    }

    // Mode B: Google Drive video upload
    const fileId = String(body.fileId || '').trim();
    if (!fileId) {
      return sendJson(res, 400, { error: 'معرف ملف Google Drive مطلوب.' });
    }

    const fileMeta = await getDriveFileMetadata(auth.accessToken, fileId);
    if (fileMeta.trashed) {
      return sendJson(res, 400, { error: 'الملف موجود في سلة المحذوفات في Google Drive.' });
    }

    const fileSize = Number(fileMeta.size || 0);
    if (!Number.isFinite(fileSize) || fileSize <= 0) {
      return sendJson(res, 400, { error: 'حجم الملف غير صالح أو فارغ (0 بايت).' });
    }

    const mimeType = resolveVideoMimeType(fileMeta.mimeType, fileMeta.name);
    const metadata = buildYouTubeMetadata(body, fileMeta.name);
    const uploadUri = await initiateYouTubeResumableUpload(
      auth.accessToken,
      metadata,
      fileSize,
      mimeType
    );

    return sendJson(res, 200, {
      ok: true,
      uploadUri,
      fileId,
      fileName: fileMeta.name,
      fileSize,
      mimeType,
      parents: fileMeta.parents || [],
      chunkSizeBytes: computeChunkSizeBytes(body.chunkSizeMb),
      metadata
    });
  } catch (err) {
    return sendJson(res, 500, { error: err.message || 'تعذر بدء جلسة الرفع على YouTube.' });
  }
};
