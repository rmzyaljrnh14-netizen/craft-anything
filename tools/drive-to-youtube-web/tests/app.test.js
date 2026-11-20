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
  assert.throws(() => googleApi.assertValidYouTubeUploadUri('http://169.254.169.254/latest/meta-data'));
  assert.throws(() => googleApi.assertValidYouTubeUploadUri('https://evil.example.com/upload'));
});

test('mocked chunked upload transitions 308 -> 200 and returns YouTube video ID', async () => {
  const fakeUploadUri = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=xyz';
  const calls = [];
  const mockFetch = async (url, opts) => {
    calls.push({ url, method: opts.method, headers: opts.headers });
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

    // 4. OAuth redirect builds exact Google authorization URL with Drive + YouTube scopes
    const authResp = await fetch(`${baseUrl}/api/auth/google`, {
      headers: { Cookie: cookiePair },
      redirect: 'manual'
    });
    assert.equal(authResp.status, 302);
    const location = authResp.headers.get('location');
    assert.ok(location.startsWith('https://accounts.google.com/o/oauth2/v2/auth?'));
    assert.ok(location.includes('youtube.upload'));
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
