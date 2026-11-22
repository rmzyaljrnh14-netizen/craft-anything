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
  findAllMatchingThumbnails,
  findAllMatchingSubtitles,
  detectShortVideo,
  parseEpisodeMetadataText,
  parseGrowthPackText,
  buildDefaultViralClips,
  generateViralTitleIdeas,
  buildDefaultPinnedComment
} = require('../../lib/youtube-utils');

async function loadTextPacksByParent(accessToken, filesByParent, parserFn) {
  const out = {};
  const entries = Object.entries(filesByParent || {});
  await Promise.all(
    entries.map(async ([pid, files]) => {
      if (!Array.isArray(files) || files.length === 0) return;
      try {
        const file = files[0];
        const raw = await downloadDriveTextFile(accessToken, file.id);
        const parsed = parserFn(raw);
        if (parsed) {
          out[pid] = { ...parsed, sourceFileName: file.name };
        }
      } catch {
        // Non-fatal: continue without auto-extracted text
      }
    })
  );
  return out;
}

function buildEnrichedVideo({
  video,
  folderName,
  isSingle,
  folderThumbs,
  folderSubs,
  extractedMeta,
  growthPack
}) {
  const thumbSet = findAllMatchingThumbnails(video.name, folderThumbs, {
    allowFolderFallback: true,
    singleVideoInFolder: isSingle
  });
  const allSubtitles = findAllMatchingSubtitles(video.name, folderSubs, {
    allowFolderFallback: true,
    singleVideoInFolder: isSingle
  });
  const matchingSubtitle = allSubtitles[0] || null;

  const sizeBytes = Number(video.size || 0);
  const cleanTitle = stripEpisodePrefixForCtr(cleanVideoTitle(video.name));
  const suggestedTitle = (extractedMeta && extractedMeta.title) || cleanTitle;
  const shortInfo = detectShortVideo(video);

  const englishMeta = (growthPack && growthPack.englishMeta) || null;
  const viralClips =
    growthPack && Array.isArray(growthPack.viralClips) && growthPack.viralClips.length > 0
      ? growthPack.viralClips
      : !shortInfo.isShort
        ? buildDefaultViralClips(suggestedTitle, extractedMeta, shortInfo.durationSec)
        : [];
  const suggestedComment =
    (growthPack && growthPack.pinnedComment) || buildDefaultPinnedComment(suggestedTitle);

  return {
    id: video.id,
    name: video.name,
    mimeType: video.mimeType || 'video/mp4',
    sizeBytes,
    sizeMb: Math.round((sizeBytes / (1024 * 1024)) * 100) / 100,
    modifiedTime: video.modifiedTime || '',
    webViewLink: video.webViewLink || `https://drive.google.com/file/d/${video.id}/view`,
    thumbnailLink: video.thumbnailLink || '',
    parents: video.parents || [],
    folderName: folderName || '',
    durationSec: shortInfo.durationSec,
    width: shortInfo.width,
    height: shortInfo.height,
    isShort: shortInfo.isShort,
    isVertical: shortInfo.isVertical,
    suggestedTitle,
    suggestedCategoryId:
      (extractedMeta && extractedMeta.categoryId) || inferBestCategoryId(suggestedTitle),
    extractedMeta,
    englishMeta,
    viralClips,
    viralTitleIdeas: generateViralTitleIdeas(suggestedTitle),
    suggestedComment,
    matchingThumbnail: thumbSet.primary,
    alternativeThumbnails: thumbSet.alternatives,
    matchingSubtitle,
    allSubtitles
  };
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
        metadataFilesByParent,
        growthFilesByParent
      } = await listAllDriveVideos(auth.accessToken, [
        DEFAULTS.PUBLISHED_FOLDER_ID,
        DEFAULTS.FAILED_FOLDER_ID
      ]);

      const [extractedMetaByParent, growthPackByParent] = await Promise.all([
        loadTextPacksByParent(auth.accessToken, metadataFilesByParent, parseEpisodeMetadataText),
        loadTextPacksByParent(auth.accessToken, growthFilesByParent, parseGrowthPackText)
      ]);

      const countByParent = {};
      for (const v of videos) {
        const pid = (v.parents && v.parents[0]) || '';
        if (pid) countByParent[pid] = (countByParent[pid] || 0) + 1;
      }

      const enrichedVideos = videos.map((v) => {
        const pid = (v.parents && v.parents[0]) || '';
        const isSingle = countByParent[pid] === 1;
        return buildEnrichedVideo({
          video: v,
          folderName: (pid && folderNamesById[pid]) || '',
          isSingle,
          folderThumbs: (pid && thumbnailsByParent[pid]) || [],
          folderSubs: (pid && subtitlesByParent[pid]) || [],
          extractedMeta: pid && isSingle ? extractedMetaByParent[pid] || null : null,
          growthPack: pid && isSingle ? growthPackByParent[pid] || null : null
        });
      });

      return sendJson(res, 200, {
        ok: true,
        folderId: 'all',
        videos: enrichedVideos,
        folders: []
      });
    }

    const { videos, thumbnails, subtitles, metadataFiles, growthFiles, folders } =
      await listDriveFolderContents(auth.accessToken, folderId);

    const [extractedMap, growthMap] = await Promise.all([
      loadTextPacksByParent(auth.accessToken, { [folderId]: metadataFiles }, parseEpisodeMetadataText),
      loadTextPacksByParent(auth.accessToken, { [folderId]: growthFiles }, parseGrowthPackText)
    ]);

    const isSingle = videos.length === 1;
    const enrichedVideos = videos.map((v) =>
      buildEnrichedVideo({
        video: v,
        folderName: '',
        isSingle,
        folderThumbs: thumbnails,
        folderSubs: subtitles,
        extractedMeta: isSingle ? extractedMap[folderId] || null : null,
        growthPack: isSingle ? growthMap[folderId] || null : null
      })
    );

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
