'use strict';

const { readJsonBody, sendJson } = require('../../lib/http');
const {
  resolveAccessToken,
  downloadDriveRange,
  uploadChunkToYouTube,
  assertValidYouTubeUploadUri
} = require('../../lib/google-api');

const MAX_CHUNK_BYTES = 16 * 1024 * 1024;
const MAX_DIRECT_CHUNK = 4 * 1024 * 1024;

async function readRawBinaryBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_DIRECT_CHUNK) {
      throw new Error('حجم الجزء المباشر يتجاوز الحد المسموح (4MB).');
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

    // Mode A: Direct binary chunk (from built-in 9:16 Viral Short Clipper)
    if (req.headers['x-upload-uri']) {
      const uploadUri = String(req.headers['x-upload-uri'] || '').trim();
      const start = Number(req.headers['x-start']);
      const end = Number(req.headers['x-end']);
      const totalSize = Number(req.headers['x-total-size']);
      const mimeType = String(req.headers['x-mime-type'] || 'video/webm').trim();

      assertValidYouTubeUploadUri(uploadUri);
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        !Number.isInteger(totalSize) ||
        start < 0 ||
        end < start ||
        end >= totalSize
      ) {
        return sendJson(res, 400, { error: 'بيانات نطاق الجزء المباشر غير صالحة.' });
      }

      const chunkBuffer = await readRawBinaryBody(req);
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
      return sendJson(res, 200, { ok: true, ...result });
    }

    // Mode B: Google Drive range chunk
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
