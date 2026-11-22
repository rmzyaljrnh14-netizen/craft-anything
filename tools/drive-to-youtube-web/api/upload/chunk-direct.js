'use strict';

const { sendJson } = require('../../lib/http');
const { resolveAccessToken, uploadChunkToYouTube, assertValidYouTubeUploadUri } = require('../../lib/google-api');

const MAX_DIRECT_CHUNK = 4 * 1024 * 1024;

async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_DIRECT_CHUNK) {
      throw new Error('حجم الجزء يتجاوز الحد المسموح (4MB).');
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method Not Allowed' });
  }

  try {
    const auth = await resolveAccessToken(req, res);
    if (!auth.accessToken) {
      return sendJson(res, 401, { error: 'يرجى ربط حساب Google أولاً.' });
    }

    const uploadUri = String(req.headers['x-upload-uri'] || '').trim();
    const start = Number(req.headers['x-start']);
    const end = Number(req.headers['x-end']);
    const totalSize = Number(req.headers['x-total-size']);
    const mimeType = String(req.headers['x-mime-type'] || 'video/webm').trim();

    assertValidYouTubeUploadUri(uploadUri);
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(totalSize) || end < start) {
      return sendJson(res, 400, { error: 'بيانات نطاق الجزء غير صالحة.' });
    }

    const chunkBuffer = await readRawBody(req);
    const expected = end - start + 1;
    if (chunkBuffer.length !== expected) {
      return sendJson(res, 400, {
        error: `عدم تطابق حجم الجزء المرسل (المتوقع ${expected} بايت، الفعلي ${chunkBuffer.length} بايت).`
      });
    }

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
      done: result.done,
      videoId: result.videoId,
      nextOffset: result.nextOffset,
      percent: result.percent
    });
  } catch (err) {
    return sendJson(res, 500, { error: err.message || 'فشل رفع جزء الشورت إلى يوتيوب.' });
  }
};
