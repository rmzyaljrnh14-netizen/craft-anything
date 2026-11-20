'use strict';

const { readJsonBody, sendJson } = require('../../lib/http');
const {
  resolveAccessToken,
  downloadDriveRange,
  uploadChunkToYouTube,
  assertValidYouTubeUploadUri
} = require('../../lib/google-api');

const MAX_CHUNK_BYTES = 16 * 1024 * 1024;

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
    const fileId = String(body.fileId || '').trim();
    const uploadUri = String(body.uploadUri || '').trim();
    const mimeType = String(body.mimeType || 'video/mp4').trim();
    const start = Number(body.start);
    const end = Number(body.end);
    const totalSize = Number(body.totalSize);

    if (!fileId || !uploadUri) {
      return sendJson(res, 400, { error: 'بيانات الجزء المطلوبة ناقصة.' });
    }
    assertValidYouTubeUploadUri(uploadUri);

    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      !Number.isInteger(totalSize) ||
      start < 0 ||
      end < start ||
      end >= totalSize
    ) {
      return sendJson(res, 400, { error: 'نطاق البايتات غير صالح.' });
    }

    if (end - start + 1 > MAX_CHUNK_BYTES) {
      return sendJson(res, 400, { error: 'حجم المقطع يتجاوز الحد الأقصى المسموح (16MB).' });
    }

    const chunkBuffer = await downloadDriveRange(auth.accessToken, fileId, start, end);
    const result = await uploadChunkToYouTube(auth.accessToken, {
      uploadUri,
      start,
      end,
      totalSize,
      mimeType,
      chunkBuffer
    });

    return sendJson(res, 200, {
      ok: true,
      ...result
    });
  } catch (err) {
    return sendJson(res, 500, { error: err.message || 'فشل رفع مقطع الفيديو.' });
  }
};
