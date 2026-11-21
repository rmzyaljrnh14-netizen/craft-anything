'use strict';

const VALID_PRIVACY = ['private', 'unlisted', 'public'];
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v', '.wmv', '.flv', '.3gp', '.mpeg', '.mpg'];
const THUMBNAIL_EXTENSIONS = ['.jpg', '.jpeg', '.png'];
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;

function isVideoFile(file) {
  if (!file || !file.name) return false;
  if (file.mimeType === 'application/vnd.google-apps.folder') return false;
  if (file.mimeType && String(file.mimeType).toLowerCase().startsWith('video/')) {
    return true;
  }
  const lower = String(file.name).toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isThumbnailFile(file) {
  if (!file || !file.name) return false;
  const mime = String(file.mimeType || '').toLowerCase();
  if (mime === 'image/jpeg' || mime === 'image/png') return true;
  const lower = String(file.name).toLowerCase();
  return THUMBNAIL_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function stripExtension(fileName) {
  const str = String(fileName || '').trim();
  const idx = str.lastIndexOf('.');
  return idx <= 0 ? str : str.slice(0, idx);
}

function findMatchingThumbnail(videoFileName, thumbnailFiles, opts = {}) {
  if (!videoFileName || !Array.isArray(thumbnailFiles) || thumbnailFiles.length === 0) {
    return null;
  }
  const base = stripExtension(videoFileName).trim().toLowerCase();
  const exact = thumbnailFiles.find(
    (img) => stripExtension(img.name).trim().toLowerCase() === base
  );
  if (exact) return exact;

  // For episode folders (e.g. "01 — video.mp4" + "03 — الصورة المصغرة.jpg"):
  // match an explicit thumbnail-named image or the sole image when there is 1 video in the folder
  if (opts.allowFolderFallback) {
    const namedThumb = thumbnailFiles.find((img) => {
      const n = String(img.name || '').toLowerCase();
      return (
        n.includes('thumb') ||
        n.includes('مصغرة') ||
        n.includes('مصغره') ||
        n.includes('غلاف')
      );
    });
    if (namedThumb) return namedThumb;
    if (thumbnailFiles.length === 1 && opts.singleVideoInFolder) {
      return thumbnailFiles[0];
    }
  }
  return null;
}

function sanitizeYouTubeText(text, maxLength) {
  let clean = String(text || '')
    .replace(/[<>]/g, '')
    .replace(/\r\n/g, '\n')
    .trim();

  if (clean.length > maxLength) {
    let cut = maxLength;
    const code = clean.charCodeAt(cut - 1);
    if (code >= 0xd800 && code <= 0xdbff) {
      cut -= 1;
    }
    clean = clean.slice(0, cut).trim();
  }
  return clean;
}

function cleanVideoTitle(fileName) {
  const normalized = stripExtension(fileName).replace(/\s+/g, ' ').trim();
  return sanitizeYouTubeText(normalized, 100) || 'Untitled Video';
}

function parseTags(rawTags) {
  if (!rawTags) return [];
  const rawList = Array.isArray(rawTags) ? rawTags : String(rawTags).split(/[,،\n]+/);
  const seen = new Set();
  const result = [];
  let totalChars = 0;

  for (const raw of rawList) {
    const tag = sanitizeYouTubeText(raw, 100);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    const overhead = tag.includes(' ') ? tag.length + 3 : tag.length + 1;
    if (totalChars + overhead > 480) break;
    seen.add(key);
    result.push(tag);
    totalChars += overhead;
  }
  return result;
}

function normalizePrivacy(raw, fallback = 'private') {
  const val = String(raw || '').trim().toLowerCase();
  if (VALID_PRIVACY.includes(val)) return val;
  return VALID_PRIVACY.includes(fallback) ? fallback : 'private';
}

function normalizePublishAt(rawValue, nowMs = Date.now()) {
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
    return null;
  }
  const dt = new Date(String(rawValue).trim());
  if (Number.isNaN(dt.getTime())) {
    throw new Error('صيغة وقت النشر المجدول غير صالحة.');
  }
  if (dt.getTime() <= nowMs + 60000) {
    throw new Error('وقت النشر المجدول يجب أن يكون في المستقبل (بعد دقيقة على الأقل).');
  }
  return dt.toISOString();
}

function buildYouTubeMetadata(input, fileName, nowMs = Date.now()) {
  const title = sanitizeYouTubeText(input.title || cleanVideoTitle(fileName), 100) || cleanVideoTitle(fileName);
  const description = sanitizeYouTubeText(input.description || '', 5000);
  const tags = parseTags(input.tags);
  const categoryId = String(input.categoryId || '22').trim();
  const madeForKids = Boolean(input.madeForKids);
  const publishAt = normalizePublishAt(input.publishAt, nowMs);
  const privacyStatus = publishAt ? 'private' : normalizePrivacy(input.privacyStatus, 'private');
  const language = String(input.language || 'ar').trim();

  const snippet = {
    title,
    description,
    categoryId
  };
  if (tags.length > 0) snippet.tags = tags;
  if (language) {
    snippet.defaultLanguage = language;
    snippet.defaultAudioLanguage = language;
  }

  const status = {
    privacyStatus,
    selfDeclaredMadeForKids: madeForKids
  };
  if (publishAt) {
    status.publishAt = publishAt;
  }

  return { snippet, status };
}

function computeChunkSizeBytes(chunkSizeMb) {
  const n = Number(chunkSizeMb);
  // 2..16 MB chunks: safe for Vercel Serverless functions & always a multiple of 256 KiB
  const clamped = Number.isFinite(n) ? Math.min(16, Math.max(2, Math.round(n))) : 8;
  return clamped * 1024 * 1024;
}

function parseNextOffsetFromRangeHeader(rangeHeader, fallbackOffset) {
  if (!rangeHeader) return fallbackOffset;
  const match = String(rangeHeader).match(/bytes=\d+-(\d+)/i);
  if (!match) return fallbackOffset;
  const lastByte = parseInt(match[1], 10);
  return Number.isFinite(lastByte) ? lastByte + 1 : fallbackOffset;
}

function resolveVideoMimeType(mimeType, fileName) {
  if (mimeType && String(mimeType).toLowerCase().startsWith('video/')) {
    return mimeType;
  }
  const lower = String(fileName || '').toLowerCase();
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mkv')) return 'video/x-matroska';
  if (lower.endsWith('.avi')) return 'video/x-msvideo';
  return 'video/mp4';
}

function resolveThumbnailMimeType(mimeType, fileName) {
  const m = String(mimeType || '').toLowerCase();
  if (m === 'image/png' || String(fileName || '').toLowerCase().endsWith('.png')) {
    return 'image/png';
  }
  return 'image/jpeg';
}

module.exports = {
  VALID_PRIVACY,
  MAX_THUMBNAIL_BYTES,
  isVideoFile,
  isThumbnailFile,
  stripExtension,
  findMatchingThumbnail,
  sanitizeYouTubeText,
  cleanVideoTitle,
  parseTags,
  normalizePrivacy,
  normalizePublishAt,
  buildYouTubeMetadata,
  computeChunkSizeBytes,
  parseNextOffsetFromRangeHeader,
  resolveVideoMimeType,
  resolveThumbnailMimeType
};
