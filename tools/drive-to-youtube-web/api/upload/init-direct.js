'use strict';

const { readJsonBody, sendJson } = require('../../lib/http');
const { resolveAccessToken, initiateYouTubeResumableUpload } = require('../../lib/google-api');
const { buildYouTubeMetadata, resolveVideoMimeType } = require('../../lib/youtube-utils');

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
    const fileSize = Number(body.fileSize || 0);
    const fileName = String(body.fileName || 'viral-short.webm').trim();
    if (!Number.isFinite(fileSize) || fileSize <= 0) {
      return sendJson(res, 400, { error: 'حجم ملف الشورت غير صالح.' });
    }

    const mimeType = resolveVideoMimeType(body.mimeType, fileName);
    const ytMetadata = buildYouTubeMetadata(
      {
        title: body.title,
        description: body.description,
        tags: body.tags,
        privacyStatus: body.privacyStatus || 'private',
        publishAt: body.publishAt || '',
        categoryId: body.categoryId || '28',
        madeForKids: Boolean(body.madeForKids),
        language: body.language || 'ar'
      },
      fileName
    );

    const uploadUri = await initiateYouTubeResumableUpload(
      auth.accessToken,
      ytMetadata,
      fileSize,
      mimeType
    );

    return sendJson(res, 200, {
      ok: true,
      uploadUri,
      fileSize,
      mimeType,
      metadata: ytMetadata
    });
  } catch (err) {
    return sendJson(res, 500, { error: err.message || 'فشل بدء رفع الشورت إلى يوتيوب.' });
  }
};
