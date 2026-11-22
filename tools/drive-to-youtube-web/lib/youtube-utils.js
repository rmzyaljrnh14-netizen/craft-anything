'use strict';

const VALID_PRIVACY = ['private', 'unlisted', 'public'];
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v', '.wmv', '.flv', '.3gp', '.mpeg', '.mpg'];
const THUMBNAIL_EXTENSIONS = ['.jpg', '.jpeg', '.png'];
const SUBTITLE_EXTENSIONS = ['.srt', '.vtt', '.sbv'];
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const MAX_SUBTITLE_BYTES = 5 * 1024 * 1024;

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

function isSubtitleFile(file) {
  if (!file || !file.name) return false;
  const lower = String(file.name).toLowerCase();
  return SUBTITLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isMetadataTextFile(file) {
  if (!file || !file.name) return false;
  const lower = String(file.name).toLowerCase();
  if (!lower.endsWith('.txt')) return false;
  return (
    lower.includes('النشر') ||
    lower.includes('العناوين') ||
    lower.includes('الوصف') ||
    lower.includes('publish') ||
    lower.includes('metadata') ||
    lower.includes('youtube') ||
    lower.includes('seo')
  );
}

function findMatchingSubtitle(videoFileName, subtitleFiles, opts = {}) {
  if (!videoFileName || !Array.isArray(subtitleFiles) || subtitleFiles.length === 0) {
    return null;
  }
  const base = stripExtension(videoFileName).trim().toLowerCase();
  const exact = subtitleFiles.find(
    (f) => stripExtension(f.name).trim().toLowerCase() === base
  );
  if (exact) return exact;

  if (opts.allowFolderFallback) {
    const arSub = subtitleFiles.find((f) => {
      const n = String(f.name || '').toLowerCase();
      return n.includes('عربي') || n.includes('العربية') || n.includes('.ar.') || n.includes('الترجمة');
    });
    if (arSub) return arSub;
    if (subtitleFiles.length === 1 && opts.singleVideoInFolder) {
      return subtitleFiles[0];
    }
  }
  return null;
}

function stripEpisodePrefixForCtr(rawTitle) {
  let t = String(rawTitle || '').trim();
  // Strip common video file extensions if passed a filename
  t = t.replace(/\.(?:mp4|mov|mkv|webm|avi|m4v|wmv|flv|mpeg|mpg)$/i, '').trim();
  // Remove leading file numbering like "01 — " or "01 - "
  t = t.replace(/^\d{1,3}\s*[—–\-_.]+\s*/u, '');
  // Remove trailing internal episode tag like " — نقش 04" or " - نقش ٠٤"
  t = t.replace(/\s*[—–\-|]+\s*(?:نَ?قْ?ش|حلقة|ep)\s*[\d٠-٩]+\s*$/iu, '');
  return sanitizeYouTubeText(t, 100);
}

function inferBestCategoryId(text) {
  const s = String(text || '').toLowerCase();
  if (
    s.includes('إنترنت') ||
    s.includes('انترنت') ||
    s.includes('ذكاء اصطناعي') ||
    s.includes('شات جي بي تي') ||
    s.includes('استنساخ الصوت') ||
    s.includes('تقني') ||
    s.includes('تكنولوجيا') ||
    s.includes('شبكات')
  ) {
    return '28'; // Science & Technology
  }
  return '27'; // Education (great for Arabic documentaries & explainers)
}

function parseEpisodeMetadataText(rawText, fallbackFileName = '') {
  const text = String(rawText || '').replace(/\r\n/g, '\n');
  if (!text.trim()) return null;

  const headings = [
    { key: 'title', re: /^\[?(?:العنوان الرئيسي المقترح|العنوان المقترح|العنوان الرئيسي|العنوان|title)\]?\s*:?\s*$/i },
    { key: 'alternatives', re: /^\[?(?:بديلان|عناوين بديلة للاختبار|عناوين بديلة|بدائل العنوان|alternative titles?)\]?\s*:?\s*$/i },
    { key: 'thumbText', re: /^\[?(?:نصّ? الصورة المصغّ?رة|نص الصورة المصغرة|thumbnail text)\]?\s*:?\s*$/i },
    { key: 'tags', re: /^\[?(?:الكلمات المفتاحية|الوسوم|tags?|keywords?)\]?\s*:?\s*$/i },
    { key: 'description', re: /^\[?(?:الوصف الجاهز للنسخ|وصف الفيديو|الوصف|description)\]?\s*:?\s*$/i }
  ];

  const sections = {
    title: [],
    alternatives: [],
    thumbText: [],
    tags: [],
    description: []
  };

  let currentKey = null;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    const matched = headings.find((h) => h.re.test(trimmed));
    if (matched) {
      currentKey = matched.key;
      continue;
    }
    if (currentKey) {
      sections[currentKey].push(line);
    }
  }

  const primaryTitle = sanitizeYouTubeText(
    sections.title.map((l) => l.trim()).filter(Boolean)[0] ||
      stripEpisodePrefixForCtr(cleanVideoTitle(fallbackFileName)),
    100
  );

  const alternativeTitles = sections.alternatives
    .map((l) => sanitizeYouTubeText(l.replace(/^[-•*\d.)]+\s*/, ''), 100))
    .filter(Boolean);

  const tagsRaw = sections.tags.map((l) => l.trim()).filter(Boolean).join('، ');
  const tags = parseTags(tagsRaw);

  const description = sanitizeYouTubeText(sections.description.join('\n').trim(), 5000);
  const categoryId = inferBestCategoryId(`${primaryTitle} ${tags.join(' ')} ${description}`);

  return {
    title: primaryTitle,
    alternativeTitles,
    thumbnailText: sections.thumbText.map((l) => l.trim()).filter(Boolean)[0] || '',
    tags,
    tagsText: tags.join('، '),
    description,
    categoryId,
    hasChapters: /\b0?0:00\b/.test(description)
  };
}

function scoreYouTubeAlgorithm({
  title = '',
  description = '',
  tags = '',
  categoryId = '22',
  hasThumbnail = false,
  hasSubtitle = false
}) {
  const cleanTitle = String(title || '').trim();
  const cleanDesc = String(description || '').trim();
  const tagList = parseTags(tags);
  const hashtags = cleanDesc.match(/#[\p{L}\p{N}_]+/gu) || [];
  const hasChapters = /\b0?0:00\b/.test(cleanDesc);
  const hasFilePrefix = /^\d{1,3}\s*[—–\-_.]/.test(cleanTitle);

  const checks = [
    {
      id: 'title_ctr',
      ok: cleanTitle.length >= 25 && cleanTitle.length <= 70 && !hasFilePrefix,
      weight: 20,
      label: 'عنوان جذّاب بدون ترقيم ملفات (25–70 حرفاً)',
      tip: hasFilePrefix
        ? 'أزل الترقيم مثل "01 —" من بداية العنوان لرفع نسبة النقر CTR.'
        : 'اجعل العنوان بين 25 و 70 حرفاً حتى لا يُقصّ على الجوال.'
    },
    {
      id: 'description_hook',
      ok: cleanDesc.length >= 150,
      weight: 15,
      label: 'وصف غني بمقدمة مشوّقة وكلمات مفتاحية',
      tip: 'أضف سطرين مشوّقين في بداية الوصف يشرحان الفكرة ويثيران الفضول.'
    },
    {
      id: 'chapters',
      ok: hasChapters,
      weight: 15,
      label: 'فصول الفيديو (Chapters 00:00) مفعّلة',
      tip: 'أضف توقيتات الفصول بدءاً من 00:00 لرفع مدة المشاهدة والظهور في بحث Google.'
    },
    {
      id: 'tags',
      ok: tagList.length >= 6,
      weight: 15,
      label: `كلمات مفتاحية مركّزة (${tagList.length} وسم)`,
      tip: 'أضف 8–15 كلمة مفتاحية عربية يبحث عنها الجمهور فعلياً.'
    },
    {
      id: 'hashtags',
      ok: hashtags.length >= 1 && hashtags.length <= 5,
      weight: 5,
      label: `هاشتاقات مركّزة (${hashtags.length}/3)`,
      tip: 'أضف 3 هاشتاقات دقيقة في آخر الوصف (مثلاً #نقش #ماذا_لو).'
    },
    {
      id: 'thumbnail',
      ok: Boolean(hasThumbnail),
      weight: 15,
      label: 'صورة مصغرة مخصصة مرفقة تلقائياً',
      tip: 'ارفع صورة مصغرة عالية التباين (1280x720) بحد أقصى 3–4 كلمات.'
    },
    {
      id: 'subtitle',
      ok: Boolean(hasSubtitle),
      weight: 10,
      label: 'ترجمة عربية (.srt) لزيادة الفهرسة والاحتفاظ',
      tip: 'ارفق ملف الترجمة .srt لرفع الفهرسة والاحتفاظ بالمشاهدين على الجوال.'
    },
    {
      id: 'category',
      ok: categoryId === '27' || categoryId === '28',
      weight: 5,
      label: 'فئة مناسبة للوثائقيات (علوم وتقنية / تعليم)',
      tip: 'اختر «علوم وتقنية (28)» أو «تعليم (27)» لتوجيه الخوارزمية للجمهور الصحيح.'
    }
  ];

  const score = checks.reduce((sum, c) => sum + (c.ok ? c.weight : 0), 0);
  const grade = score >= 85 ? 'ممتاز للنشر 🚀' : score >= 65 ? 'جيد — قابل للتحسين ⚡' : 'يحتاج تحسين ⚠️';

  return { score, grade, checks };
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
  const categoryId = String(input.categoryId || '27').trim();
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
    selfDeclaredMadeForKids: madeForKids,
    embeddable: true,
    publicStatsViewable: true
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

function isGrowthPackFile(file) {
  if (!file || !file.name) return false;
  const lower = String(file.name).toLowerCase();
  if (!lower.endsWith('.txt')) return false;
  return (
    lower.includes('الانتشار') ||
    lower.includes('الفيروسي') ||
    lower.includes('شورتس') ||
    lower.includes('growth') ||
    lower.includes('viral') ||
    lower.includes('shorts')
  );
}

function detectSubtitleLanguage(fileName) {
  const n = String(fileName || '').toLowerCase();
  if (
    n.includes('english') ||
    n.includes('(en)') ||
    n.includes('.en.') ||
    n.includes('_en.') ||
    n.includes('-en.') ||
    n.includes('إنجليز') ||
    n.includes('انجليز')
  ) {
    return { language: 'en', label: 'English' };
  }
  if (n.includes('french') || n.includes('(fr)') || n.includes('.fr.') || n.includes('فرنس')) {
    return { language: 'fr', label: 'Français' };
  }
  if (n.includes('spanish') || n.includes('(es)') || n.includes('.es.') || n.includes('إسبان')) {
    return { language: 'es', label: 'Español' };
  }
  if (n.includes('turkish') || n.includes('(tr)') || n.includes('.tr.') || n.includes('ترك')) {
    return { language: 'tr', label: 'Türkçe' };
  }
  return { language: 'ar', label: 'العربية' };
}

function findAllMatchingSubtitles(videoFileName, subtitleFiles, opts = {}) {
  if (!videoFileName || !Array.isArray(subtitleFiles) || subtitleFiles.length === 0) {
    return [];
  }
  const base = stripExtension(videoFileName).trim().toLowerCase();
  const matched = [];
  const seenLangs = new Set();

  for (const f of subtitleFiles) {
    const fBase = stripExtension(f.name).trim().toLowerCase();
    const isExact = fBase === base;
    const allowed =
      isExact ||
      (opts.allowFolderFallback &&
        (opts.singleVideoInFolder ||
          fBase.includes('الترجمة') ||
          fBase.includes('subtitle') ||
          fBase.includes('caption')));
    if (!allowed) continue;

    const { language, label } = detectSubtitleLanguage(f.name);
    if (seenLangs.has(language)) continue;
    seenLangs.add(language);
    matched.push({
      id: f.id,
      name: f.name,
      size: Number(f.size || 0),
      language,
      label
    });
  }

  // Sort Arabic first, English second
  matched.sort((a, b) => {
    if (a.language === 'ar') return -1;
    if (b.language === 'ar') return 1;
    if (a.language === 'en') return -1;
    if (b.language === 'en') return 1;
    return a.language.localeCompare(b.language);
  });
  return matched;
}

function findAllMatchingThumbnails(videoFileName, imageFiles, opts = {}) {
  const primary = findMatchingThumbnail(videoFileName, imageFiles, opts);
  if (!primary) return { primary: null, alternatives: [] };
  const alternatives = (imageFiles || [])
    .filter((f) => {
      if (!f || f.id === primary.id) return false;
      const n = String(f.name || '').toLowerCase();
      return (
        opts.singleVideoInFolder ||
        n.includes('مصغر') ||
        n.includes('thumb') ||
        n.includes('a-b') ||
        n.includes('اختبار') ||
        n.includes('cover')
      );
    })
    .map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType || 'image/jpeg',
      size: Number(f.size || 0),
      thumbnailLink: f.thumbnailLink || ''
    }));
  return {
    primary: {
      id: primary.id,
      name: primary.name,
      mimeType: primary.mimeType || 'image/jpeg',
      size: Number(primary.size || 0),
      thumbnailLink: primary.thumbnailLink || ''
    },
    alternatives
  };
}

function detectShortVideo(file) {
  const meta = (file && file.videoMediaMetadata) || {};
  const durationMs = Number(meta.durationMillis || 0);
  const durationSec = durationMs > 0 ? Math.round(durationMs / 1000) : 0;
  const width = Number(meta.width || 0);
  const height = Number(meta.height || 0);
  const nameLower = String((file && file.name) || '').toLowerCase();
  const sizeBytes = Number((file && file.size) || 0);

  const isVertical = height > 0 && width > 0 && height > width;
  const isShortDuration = durationSec > 0 && durationSec <= 65;
  const hasShortHint =
    nameLower.includes('short') ||
    nameLower.includes('شورت') ||
    nameLower.includes('ريلز') ||
    nameLower.includes('reel') ||
    nameLower.includes('معاينة') ||
    nameLower.includes('٣٠ ثانية') ||
    nameLower.includes('30 ثانية');

  const isShort =
    isVertical ||
    isShortDuration ||
    hasShortHint ||
    (durationSec === 0 && sizeBytes > 0 && sizeBytes < 14 * 1024 * 1024);

  return {
    isShort,
    isVertical,
    durationSec,
    width,
    height
  };
}

function parseTimestampToSeconds(ts) {
  const m = String(ts || '').trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1] || 0);
  const min = Number(m[2] || 0);
  const sec = Number(m[3] || 0);
  return h * 3600 + min * 60 + sec;
}

function parseGrowthPackText(rawText) {
  const text = String(rawText || '').replace(/\r\n/g, '\n');
  if (!text.trim()) return null;

  // Extract English Title
  let englishTitle = '';
  const enTitleMatch = text.match(/►\s*English Title[^\n]*\n+([^\n]+)/i);
  if (enTitleMatch) {
    englishTitle = sanitizeYouTubeText(enTitleMatch[1], 100);
  }

  // Extract English Description (up to next section divider "----")
  let englishDescription = '';
  const enDescMatch = text.match(/►\s*English Description[^\n]*\n+([\s\S]*?)(?:\n-{5,}|\n►\s|$)/i);
  if (enDescMatch) {
    englishDescription = sanitizeYouTubeText(enDescMatch[1].trim(), 5000);
  }

  // Extract Pinned Comment
  let pinnedComment = '';
  const pinMatch = text.match(/►\s*التعليق المثبّ?ت[^\n]*\n+([\s\S]*?)(?:\n►\s|\n-{5,}|$)/i);
  if (pinMatch) {
    pinnedComment = pinMatch[1].trim();
  }

  // Extract Viral Shorts Clips
  const clips = [];
  const shortBlocks = text.split(/►\s*الشورت\s*#/);
  for (let i = 1; i < shortBlocks.length; i++) {
    const block = shortBlocks[i];
    const headerLine = (block.split('\n')[0] || '').trim();
    const timeMatch = block.match(/(\d{2}:\d{2}:\d{2})\s*إلى\s*(\d{2}:\d{2}:\d{2})/);
    const hookMatch = block.match(/نص ظاهر على الشاشة[^\n]*\n+\s*[«"]([^»"\n]+)[»"]/);
    const titleMatch = block.match(/عنوان الشورت:\s*\n+\s*([^\n]+)/);

    if (timeMatch) {
      const startSec = parseTimestampToSeconds(timeMatch[1]);
      let endSec = parseTimestampToSeconds(timeMatch[2]);
      if (startSec !== null && endSec !== null && endSec > startSec) {
        if (endSec - startSec > 59) endSec = startSec + 58;
        clips.push({
          id: `clip-${i}`,
          label: `الشورت #${headerLine.replace(/^\d+\s*/, '').trim() || i}`,
          startSec,
          endSec,
          hookText: (hookMatch && hookMatch[1].trim()) || '',
          title: sanitizeYouTubeText((titleMatch && titleMatch[1].trim()) || `شورت #${i} #Shorts`, 100)
        });
      }
    }
  }

  return {
    englishMeta:
      englishTitle && englishDescription
        ? { title: englishTitle, description: englishDescription }
        : null,
    pinnedComment,
    viralClips: clips
  };
}

function buildDefaultViralClips(title, extractedMeta, durationSec) {
  const cleanTitle = stripEpisodePrefixForCtr(title || 'الحلقة');
  const dur = Number(durationSec || 0);
  const clips = [];

  // Parse chapters from description if available
  const desc = (extractedMeta && extractedMeta.description) || '';
  const chapters = [];
  for (const line of desc.split('\n')) {
    const m = line.trim().match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$/);
    if (m) {
      const s = parseTimestampToSeconds(m[1]);
      if (s !== null) chapters.push({ sec: s, label: m[2].trim() });
    }
  }

  if (chapters.length >= 3) {
    const picks = [
      { idx: 0, tag: 'الصدمة الافتتاحية' },
      { idx: Math.min(2, chapters.length - 1), tag: 'نقطة التحول' },
      { idx: Math.max(chapters.length - 2, 1), tag: 'الذروة والتأثير' }
    ];
    picks.forEach((p, i) => {
      const ch = chapters[p.idx];
      const startSec = ch.sec;
      const maxEnd = dur > 0 ? Math.min(dur, startSec + 52) : startSec + 52;
      if (maxEnd - startSec >= 10) {
        clips.push({
          id: `auto-clip-${i + 1}`,
          label: `شورت #${i + 1} — ${p.tag} (${ch.label})`,
          startSec,
          endSec: maxEnd,
          hookText: `${ch.label} — ${cleanTitle}`.slice(0, 62),
          title: sanitizeYouTubeText(`${ch.label} | ${cleanTitle} #Shorts`, 100)
        });
      }
    });
    if (clips.length > 0) return clips;
  }

  // Fallback based on total duration
  const total = dur > 60 ? dur : 300;
  clips.push(
    {
      id: 'auto-clip-1',
      label: 'شورت #1 — الخطاف الافتتاحي (أول 50 ثانية)',
      startSec: 0,
      endSec: Math.min(50, total),
      hookText: cleanTitle.slice(0, 58),
      title: sanitizeYouTubeText(`${cleanTitle} 😱 #Shorts`, 100)
    },
    {
      id: 'auto-clip-2',
      label: 'شورت #2 — منتصف القصة (لحظة التحول)',
      startSec: Math.floor(total * 0.35),
      endSec: Math.min(total, Math.floor(total * 0.35) + 48),
      hookText: `اللحظة التي غيّرت كل شيء…`,
      title: sanitizeYouTubeText(`ماذا حدث في منتصف التجربة؟ | ${cleanTitle} #Shorts`, 100)
    },
    {
      id: 'auto-clip-3',
      label: 'شورت #3 — الذروة والنهاية المؤثرة',
      startSec: Math.max(0, Math.floor(total * 0.78)),
      endSec: Math.min(total, Math.floor(total * 0.78) + 48),
      hookText: `النهاية التي لم يتوقعها أحد…`,
      title: sanitizeYouTubeText(`الحقيقة في اللحظة الأخيرة | ${cleanTitle} #Shorts`, 100)
    }
  );
  return clips;
}

function generateViralTitleIdeas(baseTitle) {
  const clean = stripEpisodePrefixForCtr(baseTitle || '').replace(/[؟?!]+$/, '').trim();
  if (!clean) return [];
  const ideas = [
    `${clean}؟`,
    `ماذا يحدث فعلاً: ${clean}؟`,
    `الحقيقة الصادمة: ${clean}`,
    `تخيّل لو حصل هذا غداً… ${clean}؟`,
    `${clean} | القصة التي لم يخبرك بها أحد`
  ];
  return Array.from(new Set(ideas.map((t) => sanitizeYouTubeText(t, 95)).filter(Boolean)));
}

function buildDefaultPinnedComment(title) {
  const clean = stripEpisodePrefixForCtr(title || '');
  return (
    `سؤال للنقاش بعد مشاهدة «${clean}» 👇\n` +
    'لو وضِعت في هذا الموقف غداً، ما هو أول قرار ستتخذه في الساعة الأولى؟ شاركنا رأيك في التعليقات!'
  );
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
  MAX_SUBTITLE_BYTES,
  isVideoFile,
  isThumbnailFile,
  isSubtitleFile,
  isMetadataTextFile,
  isGrowthPackFile,
  detectSubtitleLanguage,
  stripExtension,
  findMatchingThumbnail,
  findAllMatchingThumbnails,
  findMatchingSubtitle,
  findAllMatchingSubtitles,
  detectShortVideo,
  parseTimestampToSeconds,
  parseGrowthPackText,
  buildDefaultViralClips,
  generateViralTitleIdeas,
  buildDefaultPinnedComment,
  stripEpisodePrefixForCtr,
  inferBestCategoryId,
  parseEpisodeMetadataText,
  scoreYouTubeAlgorithm,
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
