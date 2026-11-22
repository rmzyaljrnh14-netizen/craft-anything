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

