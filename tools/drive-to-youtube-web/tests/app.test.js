'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppServer } = require('../dev-server');
const ytUtils = require('../lib/youtube-utils');
const session = require('../lib/session');
const googleApi = require('../lib/google-api');

test('youtube-utils sanitizes Arabic titles, tags, publishAt, and aligns chunks', () => {
  assert.equal(
    ytUtils.cleanVideoTitle('ماذا يبقى للإنسان؟ — نَقْش.mp4'),
    'ماذا يبقى للإنسان؟ — نَقْش'
  );
  assert.deepEqual(
    ytUtils.parseTags('تعليم، يوتيوب, تعليم , <تجربة>, عربي'),
    ['تعليم', 'يوتيوب', 'تجربة', 'عربي']
  );

  const now = Date.parse('2026-11-20T12:00:00Z');
  const meta = ytUtils.buildYouTubeMetadata(
    {
      title: 'حلقة 1',
      privacyStatus: 'public',
      publishAt: '2026-12-10T18:00:00+03:00',
      tags: 'عربي، إنتاج'
    },
    'ep1.mp4',
    now
  );
  assert.equal(meta.status.privacyStatus, 'private');
  assert.equal(meta.status.publishAt, '2026-12-10T15:00:00.000Z');
  assert.equal(ytUtils.computeChunkSizeBytes(8), 8 * 1024 * 1024);
  assert.equal(ytUtils.computeChunkSizeBytes(8) % (256 * 1024), 0);

  // Smart thumbnail matching inside episode folders (Arabic "الصورة المصغرة")
  const epThumb = ytUtils.findMatchingThumbnail(
    '01 — ماذا لو اختفى الإنترنت من العالم لمدة 7 أيام؟ — نقش 04.mp4',
    [{ id: 't_ep4', name: '03 — ٧ أيام بلا إنترنت — الصورة المصغرة.jpg', mimeType: 'image/jpeg' }],
    { allowFolderFallback: true, singleVideoInFolder: true }
  );
  assert.equal(epThumb.id, 't_ep4');
});

test('session encryption round-trips payloads and rejects tampered tokens', () => {
  const original = { clientId: '123.apps.googleusercontent.com', refreshToken: 'rt_secret' };
  const token = session.encryptPayload(original);
  assert.deepEqual(session.decryptPayload(token), original);

  const tampered = token.slice(0, -4) + 'AAAA';
  assert.equal(session.decryptPayload(tampered), null);
});

test('assertValidYouTubeUploadUri blocks SSRF URLs and allows YouTube resumable URLs', () => {
  assert.doesNotThrow(() =>
    googleApi.assertValidYouTubeUploadUri(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=abc123'
    )
  );
  assert.doesNotThrow(() =>
    googleApi.assertValidYouTubeUploadUri(
      'https://youtube.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=abc123'
    )
  );
  assert.throws(() => googleApi.assertValidYouTubeUploadUri('http://169.254.169.254/latest/meta-data'));
  assert.throws(() => googleApi.assertValidYouTubeUploadUri('https://evil.example.com/upload'));
});

test('mocked chunked upload transitions 308 -> 200 and returns YouTube video ID', async () => {
  const fakeUploadUri = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=xyz';
  const calls = [];
  const mockFetch = async (url, opts) => {
    calls.push({ url, method: opts.method, headers: opts.headers, redirect: opts.redirect });
    if (opts.method === 'POST') {
      return {
        status: 200,
        ok: true,
        headers: new Map([['location', fakeUploadUri]]),
        text: async () => ''
      };
    }
    if (opts.headers['Content-Range'] === 'bytes 0-3/8') {
      return {
        status: 308,
        ok: false,
        headers: new Map([['range', 'bytes=0-3']]),
        text: async () => ''
      };
    }
    return {
      status: 200,
      ok: true,
      headers: new Map(),
      text: async () => JSON.stringify({ id: 'YT_LIVE_888' })
    };
  };

  const uri = await googleApi.initiateYouTubeResumableUpload(
    'tok',
    { snippet: { title: 'Test' }, status: { privacyStatus: 'private' } },
    8,
    'video/mp4',
    mockFetch
  );
  assert.equal(uri, fakeUploadUri);

  const r1 = await googleApi.uploadChunkToYouTube(
    'tok',
    { uploadUri: uri, start: 0, end: 3, totalSize: 8, mimeType: 'video/mp4', chunkBuffer: Buffer.from('1234') },
    mockFetch
  );
  assert.equal(r1.done, false);
  assert.equal(r1.nextOffset, 4);

  const r2 = await googleApi.uploadChunkToYouTube(
    'tok',
    { uploadUri: uri, start: 4, end: 7, totalSize: 8, mimeType: 'video/mp4', chunkBuffer: Buffer.from('5678') },
    mockFetch
  );
  assert.equal(r2.done, true);
  assert.equal(r2.videoId, 'YT_LIVE_888');
  assert.equal(r2.percent, 100);
  assert.equal(calls[1].redirect, 'manual');
  assert.equal(calls[2].redirect, 'manual');
});

test('HTTP server serves RTL UI, health defaults, OAuth config, and OAuth redirect cleanly', async () => {
  const server = createAppServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Root page
    const htmlResp = await fetch(`${baseUrl}/`);
    assert.equal(htmlResp.status, 200);
    const html = await htmlResp.text();
    assert.ok(html.includes('dir="rtl"'));
    assert.ok(html.includes('Drive2Tube Studio'));

    // 2. Health endpoint
    const healthResp = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthResp.status, 200);
    const health = await healthResp.json();
    assert.equal(health.ok, true);
    assert.equal(health.defaults.QUEUE_FOLDER_ID, '1w8S6j9i6FCuZmIBsAbSTt-tSWGM05GI0');
    assert.equal(health.redirectUri, `${baseUrl}/api/auth/callback`);

    // 3. Configure OAuth Client ID + Secret -> stores encrypted HttpOnly cookie
    const cfgResp = await fetch(`${baseUrl}/api/auth/configure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: '999999-test.apps.googleusercontent.com',
        clientSecret: 'GOCSPX-test-secret'
      })
    });
    assert.equal(cfgResp.status, 200);
    const cfgBody = await cfgResp.json();
    assert.equal(cfgBody.mode, 'oauth_server');
    const setCookieHeader = cfgResp.headers.get('set-cookie');
    assert.ok(setCookieHeader && setCookieHeader.includes('d2yt_session='));
    const cookiePair = setCookieHeader.split(';')[0];

    // 4. OAuth redirect builds exact Google authorization URL with Drive + YouTube + Captions scopes
    const authResp = await fetch(`${baseUrl}/api/auth/google`, {
      headers: { Cookie: cookiePair },
      redirect: 'manual'
    });
    assert.equal(authResp.status, 302);
    const location = authResp.headers.get('location');
    assert.ok(location.startsWith('https://accounts.google.com/o/oauth2/v2/auth?'));
    assert.ok(location.includes('youtube.upload'));
    assert.ok(location.includes('youtube.force-ssl'));
    assert.ok(location.includes('auth%2Fdrive'));
    assert.ok(location.includes('access_type=offline'));

    // 5. Unauthenticated session check
    const sessResp = await fetch(`${baseUrl}/api/auth/session`);
    const sess = await sessResp.json();
    assert.equal(sess.connected, false);

    // 6. Unauthenticated drive videos call returns 401
    const vidResp = await fetch(`${baseUrl}/api/drive/videos`);
    assert.equal(vidResp.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('YouTube algorithm helpers parse Arabic publishing pack, match .srt subtitles, clean CTR titles, and score 100/100', () => {
  // 1. CTR title cleanup strips "01 — " prefix and trailing episode number
  assert.equal(
    ytUtils.stripEpisodePrefixForCtr('01 — ماذا لو اختفى الإنترنت من العالم لمدة 7 أيام؟ — نقش 04.mp4'),
    'ماذا لو اختفى الإنترنت من العالم لمدة 7 أيام؟'
  );

  // 2. Parse Arabic episode publishing pack (same layout as "04 — ملف النشر والعناوين والوصف.txt")
  const samplePack = `
======================================================================
حزمة نشر حلقة نقش 04
======================================================================

[العنوان الرئيسي المقترح]
ماذا لو اختفى الإنترنت من العالم لمدة 7 أيام؟

[عناوين بديلة للاختبار]
1. رسالة من سبع ثوانٍ استغرقت أسبوعاً لتصل
2. الطائرة هبطت… فلماذا لم يصل الخبر؟ | سبعة أيام بلا إنترنت

[الكلمات المفتاحية]
انقطاع الإنترنت، اختفاء الإنترنت من العالم، سبعة أيام بلا إنترنت، ماذا لو انقطع الإنترنت، الحياة بدون إنترنت، وثائقي تخيلي عربي، قناة نقش

[وصف الفيديو]
السادسة وسبع دقائق صباحاً. فجأة تتوقف الشبكة العالمية بالكامل لمدة سبعة أيام متواصلة وتنكشف البنية الخفية للعالم الحديث.

فصول الفيديو:
00:00 السادسة وسبع دقائق
01:40 اليوم الأول: صمت الشاشات
04:15 اليوم الثالث: المستشفيات والدفع الإلكتروني
13:09 ما الذي نحتفظ به؟

#نقش #ماذا_لو #انقطاع_الإنترنت
`;

  const parsed = ytUtils.parseEpisodeMetadataText(samplePack);
  assert.ok(parsed);
  assert.equal(parsed.title, 'ماذا لو اختفى الإنترنت من العالم لمدة 7 أيام؟');
  assert.equal(parsed.alternativeTitles.length, 2);
  assert.equal(parsed.alternativeTitles[0], 'رسالة من سبع ثوانٍ استغرقت أسبوعاً لتصل');
  assert.ok(parsed.tags.includes('انقطاع الإنترنت'));
  assert.ok(parsed.tags.includes('قناة نقش'));
  assert.ok(parsed.description.includes('00:00 السادسة وسبع دقائق'));
  assert.ok(parsed.description.includes('#نقش'));
  assert.equal(parsed.categoryId, '28'); // Science & Tech inferred from "الإنترنت"

  // 3. Matching .srt subtitle inside episode folder
  const sub = ytUtils.findMatchingSubtitle(
    '01 — ماذا لو اختفى الإنترنت من العالم لمدة 7 أيام؟ — نقش 04.mp4',
    [{ id: 'sub_06', name: '06 — الترجمة العربية.srt', mimeType: 'application/x-subrip' }],
    { allowFolderFallback: true, singleVideoInFolder: true }
  );
  assert.ok(sub);
  assert.equal(sub.id, 'sub_06');

  // 4. Algorithm score reaches 100/100 when all signals are present
  const report = ytUtils.scoreYouTubeAlgorithm({
    title: parsed.title,
    description: parsed.description,
    tags: parsed.tags,
    hasThumbnail: true,
    hasSubtitle: true,
    categoryId: parsed.categoryId
  });
  assert.equal(report.score, 100);
  assert.equal(report.grade, 'ممتاز للنشر 🚀');

  // 5. buildYouTubeMetadata defaults to Education (27) and enables embeddable + publicStatsViewable
  const built = ytUtils.buildYouTubeMetadata({ title: parsed.title }, 'ep.mp4');
  assert.equal(built.snippet.categoryId, '27');
  assert.equal(built.status.embeddable, true);
  assert.equal(built.status.publicStatsViewable, true);
});

test('Viral Engine v3: multi-language .srt, A/B thumbnails, Short detection, growth pack parser, and YouTube viral APIs', async () => {
  // 1. Multi-language subtitles (AR + EN)
  const subs = ytUtils.findAllMatchingSubtitles(
    '01 — ماذا لو اختفى الإنترنت من العالم لمدة 7 أيام؟ — نقش 04.mp4',
    [
      { id: 's_en', name: '08 — English Subtitles (EN).srt', size: '21000' },
      { id: 's_ar', name: '06 — الترجمة العربية.srt', size: '24185' }
    ],
    { allowFolderFallback: true, singleVideoInFolder: true }
  );
  assert.equal(subs.length, 2);
  assert.equal(subs[0].language, 'ar');
  assert.equal(subs[1].language, 'en');

  // 2. Primary + A/B alternative thumbnails
  const thumbs = ytUtils.findAllMatchingThumbnails(
    '01 — ماذا لو اختفى الإنترنت من العالم لمدة 7 أيام؟ — نقش 04.mp4',
    [
      { id: 't1', name: '03 — ٧ أيام بلا إنترنت — الصورة المصغرة.jpg', size: '262425' },
      { id: 't2', name: '03B — نسخة اختبار A-B — الطائرة المتجمدة (06:07).png', size: '410000' },
      { id: 't3', name: '03C — نسخة اختبار A-B — التذكرة بلا شبكة.png', size: '390000' }
    ],
    { allowFolderFallback: true, singleVideoInFolder: true }
  );
  assert.equal(thumbs.primary.id, 't1');
  assert.equal(thumbs.alternatives.length, 2);

  // 3. Short vs Long detection using videoMediaMetadata
  const longInfo = ytUtils.detectShortVideo({
    name: '01 — نقش 04.mp4',
    size: '83769912',
    videoMediaMetadata: { width: 1920, height: 1080, durationMillis: '848000' }
  });
  assert.equal(longInfo.isShort, false);
  assert.equal(longInfo.durationSec, 848);

  const shortInfo = ytUtils.detectShortVideo({
    name: 'نَقْش — يمّه، وصلت.mp4',
    size: '8093574',
    videoMediaMetadata: { width: 1080, height: 1920, durationMillis: '45000' }
  });
  assert.equal(shortInfo.isShort, true);
  assert.equal(shortInfo.isVertical, true);

  // 4. Growth pack parser extracts English localization + Pinned Comment + 3 Viral Clips
  const sampleGrowth = `
► الشورت #1 (الصدمة)
- التوقيت للقص من الفيديو الأصلي: من 00:00:00 إلى 00:00:59
- نص ظاهر على الشاشة في أول ثانيتين (Hook):
  «الساعة 6:07 صباحاً… طائرة ابنها تجمّدت فوق البحر ✈️»
- عنوان الشورت:
  ماذا لو اختفى الإنترنت عن العالم فجأة لمدة 7 أيام؟ 😱 #نقش

► English Title (العنوان الإنجليزي):
What If the Internet Disappeared for 7 Days?

► English Description (الوصف الإنجليزي مع الفصول):
On Maryam's phone screen, her son's plane is frozen over the sea.
------------------------------------------------------------------------
► التعليق المثبّت (انسخه وثبّته):
لو انقطع الإنترنت فجأة الآن لمدة 7 أيام… ما أول شيء ستفعله؟ 👇
`;
  const growth = ytUtils.parseGrowthPackText(sampleGrowth);
  assert.ok(growth.englishMeta);
  assert.equal(growth.englishMeta.title, 'What If the Internet Disappeared for 7 Days?');
  assert.ok(growth.pinnedComment.includes('لو انقطع الإنترنت'));
  assert.equal(growth.viralClips.length, 1);
  assert.equal(growth.viralClips[0].startSec, 0);
  assert.equal(growth.viralClips[0].endSec, 59);

  // 5. Mocked YouTube viral post-upload APIs (playlist, localization, first comment)
  const apiCalls = [];
  const mockYtFetch = async (url, opts = {}) => {
    apiCalls.push({ url, method: opts.method || 'GET' });
    if (url.includes('/playlists?part=snippet&mine=true')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ items: [] }) };
    }
    if (url.includes('/playlists?part=snippet,status')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'PL_NAQSH_1' }) };
    }
    if (url.includes('/playlistItems')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'PLI_1' }) };
    }
    if (url.includes('/commentThreads')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'CMT_1' }) };
    }
    if (url.includes('/videos?part=snippet,localizations&id=')) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            items: [{ id: 'VID_1', snippet: { title: 'عربي', description: 'وصف', categoryId: '28' }, localizations: {} }]
          })
      };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'VID_1' }) };
  };

  const pl = await googleApi.findOrCreateYouTubePlaylist('tok', 'سلسلة نقش', '', mockYtFetch);
  assert.equal(pl.id, 'PL_NAQSH_1');
  assert.equal(pl.created, true);
  await googleApi.addVideoToYouTubePlaylist('tok', pl.id, 'VID_1', mockYtFetch);
  const cmtId = await googleApi.postYouTubeFirstComment('tok', 'VID_1', 'سؤال للنقاش', mockYtFetch);
  assert.equal(cmtId, 'CMT_1');
  await googleApi.applyYouTubeLocalization('tok', 'VID_1', 'en', 'English Title', 'English Desc', mockYtFetch);
  assert.ok(apiCalls.some((c) => c.method === 'PUT' && c.url.includes('localizations')));

  // 6. New HTTP routes reject unauthenticated calls with 401
  const server = createAppServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const rStream = await fetch(`${baseUrl}/api/drive/stream?fileId=abc`);
    assert.equal(rStream.status, 401);
    const rInit = await fetch(`${baseUrl}/api/upload/init`, { method: 'POST', body: '{"directUpload":true}' });
    assert.equal(rInit.status, 401);
    const rChunk = await fetch(`${baseUrl}/api/upload/chunk`, { method: 'POST', headers: { 'x-upload-uri': 'https://www.googleapis.com/upload/youtube/v3/videos' }, body: 'x' });
    assert.equal(rChunk.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

