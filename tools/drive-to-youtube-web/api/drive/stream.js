'use strict';

const { sendJson, parseQuery } = require('../../lib/http');
const { resolveAccessToken, getDriveFileMetadata, downloadDriveRange } = require('../../lib/google-api');
const { resolveVideoMimeType } = require('../../lib/youtube-utils');

// Keep each HTTP 206 range chunk <= 2 MB so it stays well under Vercel's 4.5 MB response limit
const MAX_STREAM_CHUNK = 2 * 1024 * 1024;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { error: 'Method Not Allowed' });
  }

  try {
    const auth = await resolveAccessToken(req, res);
    if (!auth.accessToken) {
      return sendJson(res, 401, { error: 'يرجى ربط حساب Google أولاً.' });
    }

    const query = parseQuery(req);
    const fileId = String(query.fileId || '').trim();
    if (!fileId) {
      return sendJson(res, 400, { error: 'معرف الملف مطلوب.' });
    }

    const meta = await getDriveFileMetadata(auth.accessToken, fileId);
    const totalSize = Number(meta.size || 0);
    if (totalSize <= 0) {
      return sendJson(res, 400, { error: 'الملف فارغ أو غير صالح للبث.' });
    }

    const mimeType = resolveVideoMimeType(meta.mimeType, meta.name);
    const rangeHeader = String(req.headers.range || '');

    let start = 0;
    let end = Math.min(totalSize - 1, MAX_STREAM_CHUNK - 1);

    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/i);
      if (match) {
        start = Math.max(0, parseInt(match[1], 10) || 0);
        const requestedEnd = match[2] ? parseInt(match[2], 10) : totalSize - 1;
        end = Math.min(totalSize - 1, requestedEnd, start + MAX_STREAM_CHUNK - 1);
      }
    }

    if (start >= totalSize) {
      res.statusCode = 416;
      res.setHeader('Content-Range', `bytes */${totalSize}`);
      res.end();
      return;
    }

    if (req.method === 'HEAD') {
      res.statusCode = 200;
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Length', String(totalSize));
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.end();
      return;
    }

    const chunk = await downloadDriveRange(auth.accessToken, fileId, start, end);
    res.statusCode = 206;
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', String(chunk.length));
    res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.end(chunk);
  } catch (err) {
    return sendJson(res, 500, { error: err.message || 'تعذر بث الفيديو للمعاينة والقص.' });
  }
};
