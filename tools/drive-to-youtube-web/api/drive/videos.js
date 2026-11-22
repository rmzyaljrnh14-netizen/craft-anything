'use strict';

const { DEFAULTS } = require('../../lib/defaults');
const { sendJson, parseQuery } = require('../../lib/http');
const {
  resolveAccessToken,
  listDriveFolderContents,
  listAllDriveVideos,
  downloadDriveTextFile
} = require('../../lib/google-api');
const {
  cleanVideoTitle,
  stripEpisodePrefixForCtr,
  inferBestCategoryId,
  findMatchingThumbnail,
  findMatchingSubtitle,
  parseEpisodeMetadataText
} = require('../../lib/youtube-utils');

async function loadExtractedMetaByParent(accessToken, metadataFilesByParent) {
  const out = {};
  const entries = Object.entries(metadataFilesByParent || {});
  await Promise.all(
    entries.map(async ([pid, files]) => {
      if (!Array.isArray(files) || files.length === 0) return;
      try {
        const metaFile = files[0];
        const raw = await downloadDriveTextFile(accessToken, metaFile.id);
        const parsed = parseEpisodeMetadataText(raw);
        if (parsed) {
          out[pid] = { ...parsed, sourceFileName: metaFile.name };
        }
      } catch {
        // Non-fatal: continue without auto-extracted text
      }
    })
  );
  return out;
}

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
    const folderId = String(query.folderId || 'all').trim() || 'all';

    if (folderId === 'all') {
      const {
        videos,
        folderNamesById,
        thumbnailsByParent,
        subtitlesByParent,
        metadataFilesByParent
      } = await listAllDriveVideos(auth.accessToken, [
        DEFAULTS.PUBLISHED_FOLDER_ID,
        DEFAULTS.FAILED_FOLDER_ID
      ]);

      const extractedMetaByParent = await loadExtractedMetaByParent(
        auth.accessToken,
        metadataFilesByParent
      );

      // Count videos per parent folder so single-video episode folders auto-match their thumbnail & subtitle
      const countByParent = {};
      for (const v of videos) {
        const pid = (v.parents && v.parents[0]) || '';
        if (pid) countByParent[pid] = (countByParent[pid] || 0) + 1;
      }

      const enrichedVideos = videos.map((v) => {
        const pid = (v.parents && v.parents[0]) || '';
        const isSingle = countByParent[pid] === 1;
        const folderThumbs = (pid && thumbnailsByParent[pid]) || [];
        const folderSubs = (pid && subtitlesByParent[pid]) || [];
        const thumb = findMatchingThumbnail(v.name, folderThumbs, {
          allowFolderFallback: true,
          singleVideoInFolder: isSingle
        });
        const sub = findMatchingSubtitle(v.name, folderSubs, {
          allowFolderFallback: true,
          singleVideoInFolder: isSingle
        });
        const extractedMeta = pid && isSingle ? extractedMetaByParent[pid] || null : null;
        const sizeBytes = Number(v.size || 0);
        const cleanTitle = stripEpisodePrefixForCtr(cleanVideoTitle(v.name));

        return {
          id: v.id,
          name: v.name,
          mimeType: v.mimeType || 'video/mp4',
          sizeBytes,
          sizeMb: Math.round((sizeBytes / (1024 * 1024)) * 100) / 100,
          modifiedTime: v.modifiedTime || '',
          webViewLink: v.webViewLink || `https://drive.google.com/file/d/${v.id}/view`,
          parents: v.parents || [],
          folderName: (pid && folderNamesById[pid]) || '',
          suggestedTitle: (extractedMeta && extractedMeta.title) || cleanTitle,
          suggestedCategoryId:
            (extractedMeta && extractedMeta.categoryId) || inferBestCategoryId(cleanTitle),
          extractedMeta,
          matchingThumbnail: thumb
            ? {
                id: thumb.id,
                name: thumb.name,
                mimeType: thumb.mimeType || 'image/jpeg',
                size: Number(thumb.size || 0)
              }
            : null,
          matchingSubtitle: sub
            ? {
                id: sub.id,
                name: sub.name,
                size: Number(sub.size || 0)
              }
            : null
        };
      });

      return sendJson(res, 200, {
        ok: true,
        folderId: 'all',
        videos: enrichedVideos,
        folders: []
      });
    }

    const { videos, thumbnails, subtitles, metadataFiles, folders } = await listDriveFolderContents(
      auth.accessToken,
      folderId
    );
    const extractedMap = await loadExtractedMetaByParent(auth.accessToken, {
      [folderId]: metadataFiles
    });
    const folderExtractedMeta = videos.length === 1 ? extractedMap[folderId] || null : null;

    const enrichedVideos = videos.map((v) => {
      const isSingle = videos.length === 1;
      const thumb = findMatchingThumbnail(v.name, thumbnails, {
        allowFolderFallback: true,
        singleVideoInFolder: isSingle
      });
      const sub = findMatchingSubtitle(v.name, subtitles, {
        allowFolderFallback: true,
        singleVideoInFolder: isSingle
      });
      const sizeBytes = Number(v.size || 0);
      const cleanTitle = stripEpisodePrefixForCtr(cleanVideoTitle(v.name));

      return {
        id: v.id,
        name: v.name,
        mimeType: v.mimeType || 'video/mp4',
        sizeBytes,
        sizeMb: Math.round((sizeBytes / (1024 * 1024)) * 100) / 100,
        modifiedTime: v.modifiedTime || '',
        webViewLink: v.webViewLink || `https://drive.google.com/file/d/${v.id}/view`,
        parents: v.parents || [],
        folderName: '',
        suggestedTitle: (folderExtractedMeta && folderExtractedMeta.title) || cleanTitle,
        suggestedCategoryId:
          (folderExtractedMeta && folderExtractedMeta.categoryId) || inferBestCategoryId(cleanTitle),
        extractedMeta: folderExtractedMeta,
        matchingThumbnail: thumb
          ? {
              id: thumb.id,
              name: thumb.name,
              mimeType: thumb.mimeType || 'image/jpeg',
              size: Number(thumb.size || 0)
            }
          : null,
        matchingSubtitle: sub
          ? {
              id: sub.id,
              name: sub.name,
              size: Number(sub.size || 0)
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
