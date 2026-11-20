const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CODE_PATH = path.join(__dirname, '..', 'Code.gs');
const MANIFEST_PATH = path.join(__dirname, '..', 'appsscript.json');
const CODE_SOURCE = fs.readFileSync(CODE_PATH, 'utf8');

function loadGasModule(globalsOverride = {}) {
  const mod = { exports: {} };
  const sandbox = {
    console,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    JSON,
    Error,
    RegExp,
    parseInt,
    isNaN,
    encodeURIComponent,
    module: mod,
    exports: mod.exports,
    ...globalsOverride
  };
  vm.createContext(sandbox);
  vm.runInContext(CODE_SOURCE, sandbox, { filename: 'Code.gs' });
  return mod.exports;
}

function createFakeSheet(name, initialRows) {
  const data = initialRows.map((r) => [...r]);

  function ensureSize(rowEnd, colEnd) {
    while (data.length < rowEnd) data.push([]);
    for (let r = 0; r < rowEnd; r++) {
      while (data[r].length < colEnd) data[r].push('');
    }
  }

  return {
    name,
    data,
    getLastRow() {
      return data.length;
    },
    appendRow(row) {
      data.push([...row]);
    },
    getRange(row, col, numRows = 1, numCols = 1) {
      return {
        getValues() {
          ensureSize(row - 1 + numRows, col - 1 + numCols);
          const out = [];
          for (let r = 0; r < numRows; r++) {
            out.push(data[row - 1 + r].slice(col - 1, col - 1 + numCols));
          }
          return out;
        },
        setValues(values) {
          ensureSize(row - 1 + values.length, col - 1 + values[0].length);
          for (let r = 0; r < values.length; r++) {
            for (let c = 0; c < values[r].length; c++) {
              data[row - 1 + r][col - 1 + c] = values[r][c];
            }
          }
        },
        setValue(value) {
          ensureSize(row, col);
          data[row - 1][col - 1] = value;
        }
      };
    }
  };
}

function createMockGasEnv({ fetchHandler, queueRows = [], settingsRows = null, nowFn = () => Date.now() }) {
  const props = {};
  const sentEmails = [];
  const defaultSettingsRows = settingsRows || [
    ['Key', 'Value', 'Description'],
    ['QUEUE_FOLDER_ID', 'folder_queue', ''],
    ['PUBLISHED_FOLDER_ID', 'folder_published', ''],
    ['FAILED_FOLDER_ID', 'folder_failed', ''],
    ['DEFAULT_PRIVACY', 'private', ''],
    ['DEFAULT_DESCRIPTION', 'وصف افتراضي', ''],
    ['DEFAULT_TAGS', 'عربي، تعليم', ''],
    ['DEFAULT_CATEGORY_ID', '27', ''],
    ['DEFAULT_LANGUAGE', 'ar', ''],
    ['DEFAULT_MADE_FOR_KIDS', 'FALSE', ''],
    ['AUTO_START_UPLOAD', 'TRUE', ''],
    ['MAX_VIDEOS_PER_RUN', '2', ''],
    ['MAX_RETRIES', '2', ''],
    ['CHUNK_SIZE_MB', '1', ''],
    ['NOTIFY_EMAIL', 'owner@example.com', '']
  ];

  const queueSheet = createFakeSheet('Queue', [
    [
      'File ID', 'File Name', 'Size MB', 'Status', 'Title', 'Description',
      'Tags', 'Privacy', 'Publish At', 'Category', 'Kids', 'Progress',
      'YouTube URL', 'Retries', 'Notes'
    ],
    ...queueRows
  ]);
  const settingsSheet = createFakeSheet('Settings', defaultSettingsRows);
  const logsSheet = createFakeSheet('Logs', [['Time', 'Level', 'File', 'Message']]);

  const sheetsByName = {
    Queue: queueSheet,
    Settings: settingsSheet,
    Logs: logsSheet
  };

  class FakeDate extends Date {
    constructor(...args) {
      if (args.length === 0) {
        super(nowFn());
      } else {
        super(...args);
      }
    }
    static now() {
      return nowFn();
    }
  }

  const globals = {
    Date: FakeDate,
    ScriptApp: {
      getOAuthToken: () => 'fake-oauth-token'
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => true,
        releaseLock: () => {}
      })
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => {
          props[k] = String(v);
        },
        deleteProperty: (k) => {
          delete props[k];
        }
      })
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (name) => sheetsByName[name] || null
      }),
      getUi: () => {
        throw new Error('No UI in trigger');
      }
    },
    Utilities: {
      formatDate: () => '2026-11-20 16:00:00'
    },
    Session: {
      getScriptTimeZone: () => 'Asia/Aden'
    },
    MailApp: {
      sendEmail: (to, subject, body) => {
        sentEmails.push({ to, subject, body });
      }
    },
    UrlFetchApp: {
      fetch: fetchHandler
    }
  };

  return {
    gas: loadGasModule(globals),
    props,
    sentEmails,
    sheets: sheetsByName
  };
}

function makeResp(code, body = '', headers = {}, rawBytes = null) {
  return {
    getResponseCode: () => code,
    getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body)),
    getAllHeaders: () => headers,
    getContent: () => rawBytes || []
  };
}

// ============================================================================
// Tests
// ============================================================================

test('appsscript.json manifest is valid and enables YouTube & Drive v3 services', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  assert.equal(manifest.runtimeVersion, 'V8');
  assert.equal(manifest.timeZone, 'Asia/Aden');

  const services = manifest.dependencies.enabledAdvancedServices;
  assert.ok(services.some((s) => s.serviceId === 'youtube' && s.version === 'v3'));
  assert.ok(services.some((s) => s.serviceId === 'drive' && s.version === 'v3'));

  assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/youtube.upload'));
  assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/drive'));
  assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/spreadsheets'));
  assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/script.external_request'));
});

test('pure helpers: Arabic title cleaning, tag parsing, thumbnail matching, and chunk math', () => {
  const gas = loadGasModule();

  assert.equal(
    gas.cleanVideoTitle('ماذا يبقى للإنسان؟ — نَقْش.mp4'),
    'ماذا يبقى للإنسان؟ — نَقْش'
  );
  assert.equal(gas.cleanVideoTitle('  <Test>   Video.MOV  '), 'Test Video');

  // 100-char limit with emoji surrogate pair at boundary
  const withEmoji = 'a'.repeat(99) + '🎬extra';
  const cleanedEmoji = gas.sanitizeYouTubeText(withEmoji, 100);
  assert.equal(cleanedEmoji.length, 99);

  // Arabic + English comma tag parsing + dedup
  assert.deepEqual(
    Array.from(gas.parseTags('تعليم، تطوير الذات, تعليم , <يوتيوب>, ثقافة')),
    ['تعليم', 'تطوير الذات', 'يوتيوب', 'ثقافة']
  );

  // Video & thumbnail matching
  assert.equal(gas.isVideoFile({ name: 'clip.mkv', mimeType: 'application/octet-stream' }), true);
  assert.equal(gas.isVideoFile({ name: 'notes.pdf', mimeType: 'application/pdf' }), false);
  assert.equal(
    gas.isVideoFile({ name: 'folder.mp4', mimeType: 'application/vnd.google-apps.folder' }),
    false
  );

  const thumb = gas.findMatchingThumbnail('ماذا يبقى للإنسان؟.mp4', [
    { id: 't1', name: 'other.jpg', mimeType: 'image/jpeg' },
    { id: 't2', name: 'ماذا يبقى للإنسان؟.png', mimeType: 'image/png' }
  ]);
  assert.equal(thumb.id, 't2');

  // Chunk size alignment (always multiple of 256 KiB and clamped 1..32 MB)
  assert.equal(gas.computeChunkSizeBytes(16), 16 * 1024 * 1024);
  assert.equal(gas.computeChunkSizeBytes(100), 32 * 1024 * 1024);
  assert.equal(gas.computeChunkSizeBytes(16) % (256 * 1024), 0);

  assert.deepEqual(
    Object.assign({}, gas.computeNextChunkRange(0, 73681650, 16 * 1024 * 1024)),
    {
      start: 0,
      end: 16 * 1024 * 1024 - 1,
      length: 16 * 1024 * 1024
    }
  );

  // Case-insensitive header lookup + Range offset parsing
  assert.equal(
    gas.getHeaderCaseInsensitive({ location: ['https://upload.example/1'] }, 'Location'),
    'https://upload.example/1'
  );
  assert.equal(gas.parseNextOffsetFromRangeHeader('bytes=0-16777215', 0), 16777216);
  assert.equal(gas.parseNextOffsetFromRangeHeader(null, 0), 0);
});

test('buildYouTubeMetadata enforces private status for scheduled publishAt and rejects past dates', () => {
  const gas = loadGasModule();
  const nowMs = Date.parse('2026-11-20T12:00:00Z');
  const row = new Array(15).fill('');
  row[gas.COL.TITLE] = 'حلقة تجريبية';
  row[gas.COL.PRIVACY] = 'public';
  row[gas.COL.PUBLISH_AT] = '2026-12-01T18:00:00+03:00';
  row[gas.COL.TAGS] = 'عربي، إنتاج';
  row[gas.COL.MADE_FOR_KIDS] = 'FALSE';

  const meta = gas.buildYouTubeMetadata(row, 'video.mp4', gas.DEFAULT_SETTINGS, nowMs);
  assert.equal(meta.status.privacyStatus, 'private');
  assert.equal(meta.status.publishAt, '2026-12-01T15:00:00.000Z');
  assert.equal(meta.status.selfDeclaredMadeForKids, false);
  assert.deepEqual(Array.from(meta.snippet.tags), ['عربي', 'إنتاج']);

  row[gas.COL.PUBLISH_AT] = '2020-01-01T00:00:00Z';
  assert.throws(() => gas.buildYouTubeMetadata(row, 'video.mp4', gas.DEFAULT_SETTINGS, nowMs));
});

test('end-to-end chunked upload >1 chunk, thumbnail upload, file move, and email notification', () => {
  const totalBytes = 2.5 * 1024 * 1024; // 2.5 MiB with 1 MiB chunks -> 3 chunks
  const requests = [];
  let movedFiles = [];
  let uploadedThumbVideoId = null;

  const env = createMockGasEnv({
    fetchHandler(url, options) {
      requests.push({ url, method: options.method, headers: options.headers || {} });

      // List folder files
      if (url.startsWith('https://www.googleapis.com/drive/v3/files?')) {
        return makeResp(200, {
          files: [
            {
              id: 'vid_1',
              name: 'ماذا يبقى للإنسان؟ — نَقْش.mp4',
              mimeType: 'video/mp4',
              size: String(totalBytes)
            },
            {
              id: 'thumb_1',
              name: 'ماذا يبقى للإنسان؟ — نَقْش.png',
              mimeType: 'image/png',
              size: '1024'
            }
          ]
        });
      }

      // Drive metadata
      if (url.includes('/drive/v3/files/vid_1?fields=')) {
        return makeResp(200, {
          id: 'vid_1',
          name: 'ماذا يبقى للإنسان؟ — نَقْش.mp4',
          mimeType: 'video/mp4',
          size: String(totalBytes),
          trashed: false
        });
      }

      // Drive range download
      if (url.includes('alt=media')) {
        const range = options.headers.Range;
        const m = range.match(/bytes=(\d+)-(\d+)/);
        const len = Number(m[2]) - Number(m[1]) + 1;
        return makeResp(206, '', {}, new Array(len).fill(42));
      }

      // Drive move file
      if (options.method === 'patch' && url.includes('/drive/v3/files/')) {
        movedFiles.push(url);
        return makeResp(200, { id: 'moved' });
      }

      // YouTube resumable init
      if (url.includes('/upload/youtube/v3/videos?uploadType=resumable')) {
        return makeResp(200, '', { Location: 'https://upload.yt/session/abc' });
      }

      // YouTube chunk PUT
      if (url === 'https://upload.yt/session/abc' && options.method === 'put') {
        const cr = options.headers['Content-Range'];
        const m = cr.match(/bytes (\d+)-(\d+)\/(\d+)/);
        const end = Number(m[2]);
        const total = Number(m[3]);
        if (end + 1 < total) {
          return makeResp(308, '', { Range: 'bytes=0-' + end });
        }
        return makeResp(200, { id: 'YT_VID_999' });
      }

      // YouTube thumbnail upload
      if (url.includes('/upload/youtube/v3/thumbnails/set?videoId=YT_VID_999')) {
        uploadedThumbVideoId = 'YT_VID_999';
        return makeResp(200, { items: [] });
      }

      throw new Error('Unexpected fetch: ' + options.method + ' ' + url);
    }
  });

  const summary = env.gas.runAutoPublisher();
  assert.equal(summary.added, 1);
  assert.equal(summary.published, 1);
  assert.equal(summary.failed, 0);

  const row = env.sheets.Queue.data[1];
  assert.equal(row[env.gas.COL.STATUS], 'PUBLISHED');
  assert.equal(row[env.gas.COL.PROGRESS], '100%');
  assert.equal(row[env.gas.COL.YOUTUBE_URL], 'https://www.youtube.com/watch?v=YT_VID_999');
  assert.equal(uploadedThumbVideoId, 'YT_VID_999');
  assert.equal(movedFiles.length, 2); // video + thumbnail moved to Published
  assert.equal(env.sentEmails.length, 1);
  assert.ok(env.sentEmails[0].body.includes('https://www.youtube.com/watch?v=YT_VID_999'));
  assert.equal(Object.keys(env.props).length, 0); // upload state cleaned up
});

test('resumable upload pauses safely before execution timeout and resumes across runs', () => {
  const totalBytes = 3 * 1024 * 1024; // 3 chunks of 1 MiB
  let currentNow = 1000000;
  let putChunksReceived = [];
  let probeCalled = false;

  const env = createMockGasEnv({
    nowFn: () => currentNow,
    fetchHandler(url, options) {
      if (url.startsWith('https://www.googleapis.com/drive/v3/files?')) {
        return makeResp(200, {
          files: [{ id: 'big_vid', name: 'large.mp4', mimeType: 'video/mp4', size: String(totalBytes) }]
        });
      }
      if (url.includes('/drive/v3/files/big_vid?fields=')) {
        return makeResp(200, {
          id: 'big_vid',
          name: 'large.mp4',
          mimeType: 'video/mp4',
          size: String(totalBytes),
          trashed: false
        });
      }
      if (url.includes('alt=media')) {
        const m = options.headers.Range.match(/bytes=(\d+)-(\d+)/);
        const len = Number(m[2]) - Number(m[1]) + 1;
        return makeResp(206, '', {}, new Array(len).fill(7));
      }
      if (options.method === 'patch') {
        return makeResp(200, { id: 'big_vid' });
      }
      if (url.includes('/upload/youtube/v3/videos?uploadType=resumable')) {
        return makeResp(200, '', { Location: 'https://upload.yt/session/resume1' });
      }
      if (url === 'https://upload.yt/session/resume1' && options.method === 'put') {
        const cr = options.headers['Content-Range'];
        if (cr.startsWith('bytes */')) {
          probeCalled = true;
          return makeResp(308, '', { Range: 'bytes=0-' + (1024 * 1024 - 1) });
        }
        const m = cr.match(/bytes (\d+)-(\d+)\/(\d+)/);
        const start = Number(m[1]);
        const end = Number(m[2]);
        const total = Number(m[3]);
        putChunksReceived.push({ start, end });

        // Simulate 4+ minutes passing right after first chunk
        if (start === 0) {
          currentNow += 250000;
          return makeResp(308, '', { Range: 'bytes=0-' + end });
        }
        if (end + 1 < total) {
          return makeResp(308, '', { Range: 'bytes=0-' + end });
        }
        return makeResp(200, { id: 'YT_BIG_123' });
      }
      throw new Error('Unexpected fetch: ' + url);
    }
  });

  // Run 1: uploads chunk 0, hits time budget, pauses cleanly at 33%
  const run1 = env.gas.runAutoPublisher();
  assert.equal(run1.inProgress, 1);
  assert.equal(run1.published, 0);
  assert.equal(env.sheets.Queue.data[1][env.gas.COL.STATUS], 'UPLOADING');
  assert.equal(env.sheets.Queue.data[1][env.gas.COL.PROGRESS], '33%');
  assert.ok(env.props['YT_UPLOAD_STATE_big_vid']);

  // Run 2 (15 minutes later): probes YouTube session, resumes from chunk 1 & finishes!
  currentNow += 900000;
  const run2 = env.gas.runAutoPublisher();
  assert.equal(probeCalled, true);
  assert.equal(run2.published, 1);
  assert.equal(env.sheets.Queue.data[1][env.gas.COL.STATUS], 'PUBLISHED');
  assert.equal(env.sheets.Queue.data[1][env.gas.COL.YOUTUBE_URL], 'https://www.youtube.com/watch?v=YT_BIG_123');
  assert.deepEqual(putChunksReceived, [
    { start: 0, end: 1048575 },
    { start: 1048576, end: 2097151 },
    { start: 2097152, end: 3145727 }
  ]);
});

test('retries failed video up to MAX_RETRIES and then moves it to YouTube_Failed', () => {
  let movedToFailed = false;
  const env = createMockGasEnv({
    fetchHandler(url, options) {
      if (url.startsWith('https://www.googleapis.com/drive/v3/files?')) {
        return makeResp(200, {
          files: [{ id: 'bad_vid', name: 'broken.mp4', mimeType: 'video/mp4', size: '1024' }]
        });
      }
      if (url.includes('/drive/v3/files/bad_vid?fields=')) {
        return makeResp(200, { id: 'bad_vid', name: 'broken.mp4', mimeType: 'video/mp4', size: '1024', trashed: false });
      }
      if (url.includes('/upload/youtube/v3/videos?uploadType=resumable')) {
        return makeResp(403, { error: { message: 'Quota exceeded' } });
      }
      if (options.method === 'patch' && url.includes('addParents=folder_failed')) {
        movedToFailed = true;
        return makeResp(200, { id: 'bad_vid' });
      }
      throw new Error('Unexpected fetch: ' + url);
    }
  });

  // Attempt 1 (MAX_RETRIES = 2) -> stays PENDING with retries=1
  const r1 = env.gas.runAutoPublisher();
  assert.equal(r1.failed, 1);
  assert.equal(env.sheets.Queue.data[1][env.gas.COL.STATUS], 'PENDING');
  assert.equal(env.sheets.Queue.data[1][env.gas.COL.RETRIES], 1);
  assert.equal(movedToFailed, false);

  // Attempt 2 -> hits MAX_RETRIES -> marked FAILED and moved to YouTube_Failed
  const r2 = env.gas.runAutoPublisher();
  assert.equal(r2.failed, 1);
  assert.equal(env.sheets.Queue.data[1][env.gas.COL.STATUS], 'FAILED');
  assert.equal(env.sheets.Queue.data[1][env.gas.COL.RETRIES], 2);
  assert.equal(movedToFailed, true);
  assert.equal(env.sentEmails.length, 1);
});

test('recovers automatically when a saved resumable upload session expires (HTTP 410)', () => {
  let initCount = 0;
  const env = createMockGasEnv({
    queueRows: [
      ['vid_exp', 'resume_me.mp4', 0.5, 'UPLOADING', 'فيديو مستكمل', '', '', 'unlisted', '', '22', 'FALSE', '50%', '', 0, '']
    ],
    fetchHandler(url, options) {
      if (url.startsWith('https://www.googleapis.com/drive/v3/files?')) {
        return makeResp(200, {
          files: [{ id: 'vid_exp', name: 'resume_me.mp4', mimeType: 'video/mp4', size: '512000' }]
        });
      }
      if (url.includes('/drive/v3/files/vid_exp?fields=')) {
        return makeResp(200, { id: 'vid_exp', name: 'resume_me.mp4', mimeType: 'video/mp4', size: '512000', trashed: false });
      }
      if (url === 'https://upload.yt/session/expired' && options.method === 'put') {
        return makeResp(410, 'Gone');
      }
      if (url.includes('/upload/youtube/v3/videos?uploadType=resumable')) {
        initCount++;
        return makeResp(200, '', { Location: 'https://upload.yt/session/fresh' });
      }
      if (url.includes('alt=media')) {
        return makeResp(206, '', {}, new Array(512000).fill(1));
      }
      if (url === 'https://upload.yt/session/fresh' && options.method === 'put') {
        return makeResp(200, { id: 'YT_FRESH_77' });
      }
      if (options.method === 'patch') {
        return makeResp(200, { id: 'vid_exp' });
      }
      throw new Error('Unexpected fetch: ' + url);
    }
  });

  // Seed stale session state
  env.props['YT_UPLOAD_STATE_vid_exp'] = JSON.stringify({
    uploadUri: 'https://upload.yt/session/expired',
    nextOffset: 256000
  });

  const summary = env.gas.runAutoPublisher();
  assert.equal(initCount, 1);
  assert.equal(summary.published, 1);
  assert.equal(env.sheets.Queue.data[1][env.gas.COL.STATUS], 'PUBLISHED');
  assert.equal(env.sheets.Queue.data[1][env.gas.COL.YOUTUBE_URL], 'https://www.youtube.com/watch?v=YT_FRESH_77');
});

