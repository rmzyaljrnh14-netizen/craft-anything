'use strict';

const { DEFAULTS } = require('../../lib/defaults');
const { sendJson, parseQuery } = require('../../lib/http');
const { resolveAccessToken, listDriveFolderContents } = require('../../lib/google-api');
const { cleanVideoTitle, findMatchingThumbnail } = require('../../lib/youtube-utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method Not Allowed' });
  }

  try {
    const auth = await resolveAccessToken(req, res);
    if (!auth.accessToken) {
      return sendJson(res, 401, { error: 'يرجى ربط حساب Google أولاً.' });
    }

    const query = parseQuery(req);
    const folderId = String(query.folderId || DEFAULTS.QUEUE_FOLDER_ID).trim() || 'root';
    const { videos, thumbnails, folders } = await listDriveFolderContents(auth.accessToken, folderId);

    const enrichedVideos = videos.map((v) => {
      const thumb = findMatchingThumbnail(v.name, thumbnails);
      const sizeBytes = Number(v.size || 0);
      return {
        id: v.id,
        name: v.name,
        mimeType: v.mimeType || 'video/mp4',
        sizeBytes,
        sizeMb: Math.round((sizeBytes / (1024 * 1024)) * 100) / 100,
        modifiedTime: v.modifiedTime || '',
        webViewLink: v.webViewLink || `https://drive.google.com/file/d/${v.id}/view`,
        parents: v.parents || [],
        suggestedTitle: cleanVideoTitle(v.name),
        matchingThumbnail: thumb
          ? {
              id: thumb.id,
              name: thumb.name,
              mimeType: thumb.mimeType || 'image/jpeg',
              size: Number(thumb.size || 0)
            }
          : null
      };
    });

    return sendJson(res, 200, {
      ok: true,
      folderId,
      videos: enrichedVideos,
      folders: folders.map((f) => ({ id: f.id, name: f.name }))
    });
  } catch (err) {
    return sendJson(res, 500, { error: err.message || 'تعذر قراءة ملفات Google Drive.' });
  }
};
