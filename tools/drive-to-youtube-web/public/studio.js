'use strict';

(function () {
  const STORAGE_KEYS = {
    CLIENT_ID: 'd2yt_client_id',
    SETTINGS: 'd2yt_settings',
    PUBLISHED_MAP: 'd2yt_published_map',
    GIS_TOKEN: 'd2yt_gis_token',
    GIS_EXPIRY: 'd2yt_gis_expiry'
  };

  const state = {
    health: null,
    connected: false,
    connectionMode: null,
    user: null,
    channel: null,
    currentFolderId: 'all',
    currentPreset: 'all',
    videos: [],
    folders: [],
    videoEdits: {},
    uploadStatus: {}, // fileId -> { status, percent, message, youtubeUrl, studioUrl }
    publishedMap: loadJsonStorage(localStorage, STORAGE_KEYS.PUBLISHED_MAP, {}),
    isUploading: false,
    autoEnabled: false,
    autoTimerId: null,
    countdownTimerId: null,
    nextAutoRunAt: null,
    gisToken: sessionStorage.getItem(STORAGE_KEYS.GIS_TOKEN) || ''
  };

  const el = {
    setupPanel: document.getElementById('setupPanel'),
    openSetupBtn: document.getElementById('openSetupBtn'),
    toggleSetupBtn: document.getElementById('toggleSetupBtn'),
    logoutBtn: document.getElementById('logoutBtn'),
    connectionBadge: document.getElementById('connectionBadge'),
    connectionBadgeText: document.getElementById('connectionBadgeText'),
    autoStatusPill: document.getElementById('autoStatusPill'),
    autoStatusText: document.getElementById('autoStatusText'),
    alertBanner: document.getElementById('alertBanner'),
    alertText: document.getElementById('alertText'),
    alertCloseBtn: document.getElementById('alertCloseBtn'),
    originDisplay: document.getElementById('originDisplay'),
    redirectUriDisplay: document.getElementById('redirectUriDisplay'),
    oauthConfigForm: document.getElementById('oauthConfigForm'),
    clientIdInput: document.getElementById('clientIdInput'),
    clientSecretInput: document.getElementById('clientSecretInput'),
    configStatusHint: document.getElementById('configStatusHint'),
    connectGoogleBtn: document.getElementById('connectGoogleBtn'),
    connectModeHint: document.getElementById('connectModeHint'),
    advancedOAuthDetails: document.getElementById('advancedOAuthDetails'),
    refreshVideosBtn: document.getElementById('refreshVideosBtn'),
    publishAllBtn: document.getElementById('publishAllBtn'),
    folderTabs: document.getElementById('folderTabs'),
    customFolderIdInput: document.getElementById('customFolderIdInput'),
    loadCustomFolderBtn: document.getElementById('loadCustomFolderBtn'),
    subfoldersRow: document.getElementById('subfoldersRow'),
    videosList: document.getElementById('videosList'),
    channelCardBody: document.getElementById('channelCardBody'),
    autoPublishToggle: document.getElementById('autoPublishToggle'),
    countdownBox: document.getElementById('countdownBox'),
    countdownTimer: document.getElementById('countdownTimer'),
    intervalSelect: document.getElementById('intervalSelect'),
    defaultPrivacySelect: document.getElementById('defaultPrivacySelect'),
    chunkSizeSelect: document.getElementById('chunkSizeSelect'),
    moveToPublishedCheck: document.getElementById('moveToPublishedCheck'),
    attachThumbnailCheck: document.getElementById('attachThumbnailCheck'),
    attachSubtitleCheck: document.getElementById('attachSubtitleCheck'),
    applyEnglishLocCheck: document.getElementById('applyEnglishLocCheck'),
    addToPlaylistCheck: document.getElementById('addToPlaylistCheck'),
    playlistTitleInput: document.getElementById('playlistTitleInput'),
    postFirstCommentCheck: document.getElementById('postFirstCommentCheck'),
    logToSheetCheck: document.getElementById('logToSheetCheck'),
    scheduleCampaignBtn: document.getElementById('scheduleCampaignBtn'),
    activityLog: document.getElementById('activityLog'),
    clearLogsBtn: document.getElementById('clearLogsBtn'),
    // Built-in 9:16 Viral Short Clipper modal elements
    clipperModal: document.getElementById('clipperModal'),
    clipperVideoName: document.getElementById('clipperVideoName'),
    closeClipperBtn: document.getElementById('closeClipperBtn'),
    clipperPresets: document.getElementById('clipperPresets'),
    clipperCanvas: document.getElementById('clipperCanvas'),
    clipperSourceVideo: document.getElementById('clipperSourceVideo'),
    clipperPreviewBtn: document.getElementById('clipperPreviewBtn'),
    clipperRenderBtn: document.getElementById('clipperRenderBtn'),
    clipperStopBtn: document.getElementById('clipperStopBtn'),
    clipperStatusBox: document.getElementById('clipperStatusBox'),
    clipperOutputBox: document.getElementById('clipperOutputBox'),
    clipperResultVideo: document.getElementById('clipperResultVideo'),
    clipperUploadYtBtn: document.getElementById('clipperUploadYtBtn'),
    clipperDownloadLink: document.getElementById('clipperDownloadLink'),
    clipperUploadProgress: document.getElementById('clipperUploadProgress'),
    clipperUploadBar: document.getElementById('clipperUploadBar'),
    clipperUploadText: document.getElementById('clipperUploadText'),
    clipperUploadPct: document.getElementById('clipperUploadPct'),
    clipStartInput: document.getElementById('clipStartInput'),
    clipEndInput: document.getElementById('clipEndInput'),
    clipHookInput: document.getElementById('clipHookInput'),
    clipTitleInput: document.getElementById('clipTitleInput'),
    clipDescInput: document.getElementById('clipDescInput'),
    clipPrivacySelect: document.getElementById('clipPrivacySelect'),
    clipScheduleInput: document.getElementById('clipScheduleInput')
  };

  function loadJsonStorage(storage, key, fallback) {
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function saveSettings() {
    const cfg = {
      intervalMin: Number(el.intervalSelect.value || 15),
      defaultPrivacy: el.defaultPrivacySelect.value || 'private',
      chunkSizeMb: Number(el.chunkSizeSelect.value || 4),
      moveToPublished: el.moveToPublishedCheck.checked,
      attachThumbnail: el.attachThumbnailCheck.checked,
      attachSubtitle: el.attachSubtitleCheck ? el.attachSubtitleCheck.checked : true,
      applyEnglishLoc: el.applyEnglishLocCheck ? el.applyEnglishLocCheck.checked : true,
      addToPlaylist: el.addToPlaylistCheck ? el.addToPlaylistCheck.checked : true,
      playlistTitle: el.playlistTitleInput ? el.playlistTitleInput.value.trim() : '',
      postFirstComment: el.postFirstCommentCheck ? el.postFirstCommentCheck.checked : true,
      logToSheet: el.logToSheetCheck.checked
    };
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(cfg));
  }

  function restoreSettings() {
    const cfg = loadJsonStorage(localStorage, STORAGE_KEYS.SETTINGS, null);
    if (!cfg) return;
    if (cfg.intervalMin) el.intervalSelect.value = String(cfg.intervalMin);
    if (cfg.defaultPrivacy) el.defaultPrivacySelect.value = cfg.defaultPrivacy;
    if (cfg.chunkSizeMb) el.chunkSizeSelect.value = String(cfg.chunkSizeMb);
    if (typeof cfg.moveToPublished === 'boolean') el.moveToPublishedCheck.checked = cfg.moveToPublished;
    if (typeof cfg.attachThumbnail === 'boolean') el.attachThumbnailCheck.checked = cfg.attachThumbnail;
    if (typeof cfg.attachSubtitle === 'boolean' && el.attachSubtitleCheck) {
      el.attachSubtitleCheck.checked = cfg.attachSubtitle;
    }
    if (typeof cfg.applyEnglishLoc === 'boolean' && el.applyEnglishLocCheck) {
      el.applyEnglishLocCheck.checked = cfg.applyEnglishLoc;
    }
    if (typeof cfg.addToPlaylist === 'boolean' && el.addToPlaylistCheck) {
      el.addToPlaylistCheck.checked = cfg.addToPlaylist;
    }
    if (cfg.playlistTitle && el.playlistTitleInput) {
      el.playlistTitleInput.value = cfg.playlistTitle;
    }
    if (typeof cfg.postFirstComment === 'boolean' && el.postFirstCommentCheck) {
      el.postFirstCommentCheck.checked = cfg.postFirstComment;
    }
    if (typeof cfg.logToSheet === 'boolean') el.logToSheetCheck.checked = cfg.logToSheet;
  }

  function getGisTokenIfValid() {
    const expiry = Number(sessionStorage.getItem(STORAGE_KEYS.GIS_EXPIRY) || 0);
    if (state.gisToken && expiry && Date.now() < expiry - 30000) {
      return state.gisToken;
    }
    return '';
  }

  function authHeaders(extra = {}) {
    const headers = { ...extra };
    const token = getGisTokenIfValid();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }

  async function apiFetch(url, options = {}) {
    const resp = await fetch(url, {
      ...options,
      headers: authHeaders(options.headers || {})
    });
    const text = await resp.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }
    if (!resp.ok) {
      const detail = data.error || (text ? text.replace(/<[^>]+>/g, ' ').trim().slice(0, 220) : '') || `HTTP ${resp.status}`;
      throw new Error(detail);
    }
    return data;
  }

  function showAlert(message, type = 'info') {
    el.alertText.textContent = message;
    el.alertBanner.className = `alert alert-${type}`;
    el.alertBanner.classList.remove('hidden');
  }

  function hideAlert() {
    el.alertBanner.classList.add('hidden');
  }

  function addLog(message, level = 'info') {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');

    const item = document.createElement('div');
    item.className = `log-item log-${level}`;
    const timeEl = document.createElement('span');
    timeEl.className = 'log-time';
    timeEl.textContent = `${hh}:${mm}:${ss}`;
    const textEl = document.createElement('span');
    textEl.textContent = message;
    item.append(timeEl, textEl);

    el.activityLog.prepend(item);
    while (el.activityLog.children.length > 60) {
      el.activityLog.lastElementChild.remove();
    }
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ============================================================================
  // Initialization & Session
  // ============================================================================

  async function init() {
    restoreSettings();
    bindEvents();

    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === '1') {
      showAlert('✅ تم ربط حساب Google وقناة YouTube بنجاح!', 'success');
      window.history.replaceState({}, '', '/');
    } else if (params.get('auth_error')) {
      showAlert('❌ خطأ في الربط: ' + params.get('auth_error'), 'error');
      window.history.replaceState({}, '', '/');
    }

    try {
      state.health = await apiFetch('/api/health');
      const origin = window.location.origin;
      el.originDisplay.textContent = origin;
      el.redirectUriDisplay.textContent = `${origin}/api/auth/callback`;

      const savedClientId = state.health.oauth.clientId || localStorage.getItem(STORAGE_KEYS.CLIENT_ID) || '';
      if (savedClientId) {
        el.clientIdInput.value = savedClientId;
      }

      if (state.health.oauth.fromEnv) {
        el.configStatusHint.textContent = '✅ مفاتيح OAuth مضبوطة من السيرفر (جاهز للربط بضغطة واحدة).';
        if (el.advancedOAuthDetails) el.advancedOAuthDetails.classList.add('hidden');
      } else if (state.health.oauth.hasClientSecret) {
        el.configStatusHint.textContent = '✅ تم حفظ Client ID و Client Secret (جاهز للربط).';
      } else if (savedClientId) {
        el.configStatusHint.textContent = '✅ تم حفظ Client ID (جاهز للربط).';
      }

      state.currentFolderId = 'all';
      await refreshSession();
    } catch (err) {
      showAlert('تعذر الاتصال بالخادم: ' + err.message, 'error');
      addLog('فشل تهيئة التطبيق: ' + err.message, 'error');
    }
  }

  async function refreshSession() {
    const data = await apiFetch('/api/auth/session');
    state.connected = Boolean(data.connected);
    state.connectionMode = data.mode || null;
    state.user = data.user || null;
    state.channel = data.channel || null;

    renderConnectionState(data);

    if (state.connected) {
      addLog(
        `تم الاتصال بحساب ${state.user ? state.user.email : ''}` +
          (state.channel ? ` — قناة: ${state.channel.title}` : ''),
        'success'
      );
      if (data.youtubeError) {
        showAlert('⚠️ تنبيه اتصال يوتيوب: ' + data.youtubeError, 'error');
        addLog('⚠️ خطأ اتصال يوتيوب: ' + data.youtubeError, 'error');
      }
      await loadVideos(state.currentFolderId, { autoFallbackToRoot: true });
    }
  }

  function renderConnectionState(sessionData = {}) {
    if (state.connected) {
      el.connectionBadge.className = 'pill pill-online';
      el.connectionBadgeText.textContent = state.channel
        ? `متصل: ${state.channel.title}`
        : `متصل: ${state.user ? state.user.email : 'Google'}`;

      el.logoutBtn.classList.remove('hidden');
      el.toggleSetupBtn.classList.remove('hidden');
      el.setupPanel.classList.add('hidden');
      el.refreshVideosBtn.disabled = false;
      el.publishAllBtn.disabled = false;
      if (el.scheduleCampaignBtn) el.scheduleCampaignBtn.disabled = false;
      el.loadCustomFolderBtn.disabled = false;
      el.autoPublishToggle.disabled = false;

      if (state.channel) {
        const modeBadge =
          state.connectionMode === 'oauth_server'
            ? '🔄 تجديد تلقائي دائم (Server OAuth)'
            : '⚡ ربط سريع عبر المتصفح (GIS)';
        el.channelCardBody.innerHTML = `
          <div class="channel-info">
            ${state.channel.thumbnail ? `<img class="channel-avatar" src="${escapeHtml(state.channel.thumbnail)}" alt="Channel avatar" />` : ''}
            <div>
              <strong>${escapeHtml(state.channel.title)}</strong>
              <div class="muted small">${escapeHtml(state.user ? state.user.email : '')}</div>
              <div class="small" style="color:#6ee7b7;margin-top:2px;">${modeBadge}</div>
            </div>
          </div>
          <div class="channel-stats">
            <span>المشتركون: <strong>${escapeHtml(state.channel.subscriberCount)}</strong></span>
            <span>الفيديوهات: <strong>${escapeHtml(state.channel.videoCount)}</strong></span>
          </div>
          <div style="margin-top:12px;">
            <a class="btn btn-secondary btn-xs btn-block" href="https://studio.youtube.com/channel/${encodeURIComponent(state.channel.id)}" target="_blank" rel="noopener">
              🎛️ فتح YouTube Studio ↗
            </a>
          </div>
        `;
      } else {
        el.channelCardBody.innerHTML = `
          <p class="small">تم ربط حساب Google (<strong>${escapeHtml(state.user ? state.user.email : '')}</strong>).</p>
          <p class="muted small">${escapeHtml(sessionData.youtubeError || 'لم يتم العثور على قناة يوتيوب منشأة لهذا الحساب بعد — أنشئ قناة على youtube.com ثم أعد المحاولة.')}</p>
        `;
      }
    } else {
      el.connectionBadge.className = 'pill pill-offline';
      el.connectionBadgeText.textContent = 'غير متصل بـ Google';
      el.logoutBtn.classList.add('hidden');
      el.toggleSetupBtn.classList.add('hidden');
      el.setupPanel.classList.remove('hidden');
      el.refreshVideosBtn.disabled = true;
      el.publishAllBtn.disabled = true;
      if (el.scheduleCampaignBtn) el.scheduleCampaignBtn.disabled = true;
      el.loadCustomFolderBtn.disabled = true;
      el.autoPublishToggle.disabled = true;
      el.autoPublishToggle.checked = false;
      stopAutoPublisher();

      el.channelCardBody.innerHTML =
        '<p class="muted small">لم يتم ربط قناة يوتيوب بعد. اضغط على «ربط حساب Google وقناة YouTube» بالأعلى.</p>';
    }
  }

  // ============================================================================
  // OAuth Configuration & Sign-in (Supports BOTH Server OAuth and Quick GIS)
  // ============================================================================

  async function handleSaveConfig(e) {
    e.preventDefault();
    const clientId = el.clientIdInput.value.trim();
    const clientSecret = el.clientSecretInput.value.trim();

    if (!clientId) {
      showAlert('يرجى إدخال Google OAuth Client ID أولاً.', 'error');
      return;
    }

    try {
      const res = await apiFetch('/api/auth/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret })
      });
      localStorage.setItem(STORAGE_KEYS.CLIENT_ID, clientId);
      state.health = await apiFetch('/api/health');
      el.clientSecretInput.value = '';
      el.configStatusHint.textContent =
        res.mode === 'oauth_server'
          ? '✅ تم حفظ Client ID و Client Secret — اضغط الآن «ربط حساب Google وقناة YouTube».'
          : '✅ تم حفظ Client ID — اضغط الآن «ربط حساب Google وقناة YouTube» للربط السريع.';
      showAlert('تم حفظ إعدادات الربط بنجاح! يمكنك الآن الضغط على زر ربط حساب Google.', 'success');
      addLog('تم حفظ إعدادات Google OAuth.', 'info');
    } catch (err) {
      showAlert(err.message, 'error');
    }
  }

  async function handleConnectGoogle() {
    hideAlert();
    const inputClientId = el.clientIdInput.value.trim();
    const inputSecret = el.clientSecretInput.value.trim();

    // Auto-save if user typed credentials and immediately clicked Connect
    if (inputClientId && (inputClientId !== (state.health && state.health.oauth.clientId) || inputSecret)) {
      try {
        await apiFetch('/api/auth/configure', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId: inputClientId, clientSecret: inputSecret })
        });
        localStorage.setItem(STORAGE_KEYS.CLIENT_ID, inputClientId);
        state.health = await apiFetch('/api/health');
      } catch (err) {
        showAlert(err.message, 'error');
        return;
      }
    }

    const oauth = state.health ? state.health.oauth : {};
    const clientId = oauth.clientId || localStorage.getItem(STORAGE_KEYS.CLIENT_ID) || '';

    if (!clientId) {
      el.setupPanel.classList.remove('hidden');
      if (el.advancedOAuthDetails) el.advancedOAuthDetails.open = true;
      el.clientIdInput.focus();
      showAlert('تحتاج Google إلى إضافة Client ID مرة واحدة فقط لتفعيل زر تسجيل الدخول على هذا الرابط — افتح القسم بالأسفل وأدخله ثم اضغط الربط.', 'info');
      return;
    }

    // Mode A: Full Server OAuth (Client ID + Client Secret) -> persistent refresh token!
    if (oauth.hasClientSecret) {
      addLog('جاري التحويل إلى شاشة تسجيل الدخول في Google...', 'info');
      window.location.href = '/api/auth/google';
      return;
    }

    // Mode B: Quick GIS Popup (Client ID only!)
    if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
      showAlert('مكتبة تسجيل الدخول من Google لا تزال قيد التحميل — انتظر لحظة وحاول مجدداً (أو أضف Client Secret للربط المباشر).', 'info');
      return;
    }

    try {
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: (oauth.scopes || []).join(' '),
        prompt: 'consent select_account',
        callback: async (tokenResponse) => {
          if (tokenResponse.error) {
            showAlert('تم إلغاء الربط أو حدث خطأ: ' + tokenResponse.error, 'error');
            return;
          }
          state.gisToken = tokenResponse.access_token;
          const expiresIn = Number(tokenResponse.expires_in || 3600);
          sessionStorage.setItem(STORAGE_KEYS.GIS_TOKEN, state.gisToken);
          sessionStorage.setItem(STORAGE_KEYS.GIS_EXPIRY, String(Date.now() + expiresIn * 1000));
          showAlert('✅ تم ربط حساب Google وقناة YouTube بنجاح!', 'success');
          await refreshSession();
        }
      });
      tokenClient.requestAccessToken();
    } catch (err) {
      showAlert('تعذر فتح نافذة تسجيل الدخول من Google: ' + err.message, 'error');
    }
  }

  async function handleLogout() {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network errors on logout
    }
    state.gisToken = '';
    sessionStorage.removeItem(STORAGE_KEYS.GIS_TOKEN);
    sessionStorage.removeItem(STORAGE_KEYS.GIS_EXPIRY);
    state.connected = false;
    state.user = null;
    state.channel = null;
    state.videos = [];
    renderConnectionState();
    renderVideos();
    addLog('تم فصل حساب Google بنجاح.', 'info');
  }

  // ============================================================================
  // Drive Video Browser & Metadata Editor
  // ============================================================================

  async function loadVideos(folderId, opts = {}) {
    if (!state.connected) return;
    state.currentFolderId = folderId;
    el.refreshVideosBtn.disabled = true;
    el.videosList.innerHTML = '<div class="empty-state"><p class="muted">جاري قراءة الفيديوهات من Google Drive...</p></div>';

    try {
      const data = await apiFetch(`/api/drive/videos?folderId=${encodeURIComponent(folderId)}`);
      state.videos = data.videos || [];
      state.folders = data.folders || [];

      if (
        opts.autoFallbackToRoot &&
        state.videos.length === 0 &&
        state.health &&
        folderId === state.health.defaults.QUEUE_FOLDER_ID
      ) {
        const rootTab = document.querySelector('.folder-tab[data-folder-preset="root"]');
        if (rootTab) {
          document.querySelectorAll('.folder-tab').forEach((b) => b.classList.remove('active'));
          rootTab.classList.add('active');
          state.currentPreset = 'root';
        }
        await loadVideos('root', { autoFallbackToRoot: false });
        return;
      }

      renderSubfolders();
      renderVideos();
      addLog(`تم تحميل ${state.videos.length} فيديو من Google Drive.`, 'info');
    } catch (err) {
      el.videosList.innerHTML = `<div class="empty-state"><p style="color:#fca5a5;">${escapeHtml(err.message)}</p></div>`;
      showAlert('❌ خطأ في قراءة Google Drive: ' + err.message, 'error');
      addLog('خطأ في قراءة Google Drive: ' + err.message, 'error');
    } finally {
      el.refreshVideosBtn.disabled = false;
    }
  }

  function renderSubfolders() {
    if (!state.folders.length) {
      el.subfoldersRow.classList.add('hidden');
      el.subfoldersRow.innerHTML = '';
      return;
    }
    el.subfoldersRow.classList.remove('hidden');
    el.subfoldersRow.innerHTML = state.folders
      .map(
        (f) =>
          `<button class="subfolder-chip" type="button" data-open-folder="${escapeHtml(f.id)}">📁 ${escapeHtml(f.name)}</button>`
      )
      .join('');
  }

  function formatDuration(sec) {
    const s = Math.max(0, Math.round(Number(sec || 0)));
    if (!s) return '';
    const mins = Math.floor(s / 60);
    const rem = s % 60;
    return `${mins}:${String(rem).padStart(2, '0')}`;
  }

  function getSelectedThumbnail(video, meta) {
    const allThumbs = [video.matchingThumbnail, ...(video.alternativeThumbnails || [])].filter(Boolean);
    if (!allThumbs.length) return null;
    if (meta && meta.selectedThumbnailId) {
      const found = allThumbs.find((t) => t.id === meta.selectedThumbnailId);
      if (found) return found;
    }
    return allThumbs[0];
  }

  function getVideoMeta(video) {
    if (!state.videoEdits[video.id]) {
      const ext = video.extractedMeta || null;
      let initialTitle = (ext && ext.title) || video.suggestedTitle;
      if (video.isShort && !/#shorts/i.test(initialTitle) && initialTitle.length < 88) {
        initialTitle = `${initialTitle} #Shorts`;
      }
      state.videoEdits[video.id] = {
        title: initialTitle,
        description: (ext && ext.description) || (video.isShort ? `${initialTitle}\n\nشاهد الحلقة الكاملة على القناة 👇\n\n#Shorts #نقش #ماذا_لو` : ''),
        tags: (ext && ext.tagsText) || (video.isShort ? 'Shorts، نقش، ماذا لو، وثائقي قصير، قصص معرفية' : ''),
        privacyStatus: el.defaultPrivacySelect.value || 'private',
        publishAt: '',
        categoryId: (ext && ext.categoryId) || video.suggestedCategoryId || '27',
        madeForKids: false,
        selectedThumbnailId: video.matchingThumbnail ? video.matchingThumbnail.id : '',
        firstComment: video.suggestedComment || '',
        expanded: false
      };
    }
    return state.videoEdits[video.id];
  }

  function computeClientAlgoScore(video, meta) {
    const cleanTitle = String(meta.title || '').trim();
    const cleanDesc = String(meta.description || '').trim();
    const tagsList = String(meta.tags || '')
      .split(/[,،\n]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    const hashtags = cleanDesc.match(/#[^\s#]+/g) || [];
    const hasChapters = /\b0?0:00\b/.test(cleanDesc);
    const hasFilePrefix = /^\d{1,3}\s*[—–\-_.]/.test(cleanTitle);
    const allSubs = Array.isArray(video.allSubtitles) && video.allSubtitles.length
      ? video.allSubtitles
      : video.matchingSubtitle ? [video.matchingSubtitle] : [];
    const hasSelectedThumb = Boolean(getSelectedThumbnail(video, meta)) && el.attachThumbnailCheck.checked;
    const hasPlaylist = Boolean(el.addToPlaylistCheck && el.addToPlaylistCheck.checked && el.playlistTitleInput && el.playlistTitleInput.value.trim());
    const hasFirstComment = Boolean(el.postFirstCommentCheck && el.postFirstCommentCheck.checked && String(meta.firstComment || '').trim().length > 10);

    const checks = [
      {
        ok: cleanTitle.length >= 20 && cleanTitle.length <= 72 && !hasFilePrefix,
        weight: 18,
        label: hasFilePrefix ? 'أزل الترقيم من بداية العنوان' : 'عنوان جذّاب بدون ترقيم (20–72 حرفاً)'
      },
      {
        ok: cleanDesc.length >= (video.isShort ? 40 : 150),
        weight: 12,
        label: 'وصف مشوّق + كلمات مفتاحية قوية'
      },
      {
        ok: video.isShort ? /#shorts/i.test(`${cleanTitle} ${cleanDesc}`) : hasChapters,
        weight: 12,
        label: video.isShort ? 'وسم #Shorts مفعّل لتغذية الشورتس' : 'فصول الفيديو (Chapters 00:00) مفعّلة'
      },
      {
        ok: tagsList.length >= 5,
        weight: 12,
        label: `كلمات مفتاحية مركّزة (${tagsList.length} وسم)`
      },
      {
        ok: hashtags.length >= 1 && hashtags.length <= 5,
        weight: 5,
        label: `هاشتاقات مركّزة (${hashtags.length}/3)`
      },
      {
        ok: video.isShort ? true : hasSelectedThumb,
        weight: 14,
        label: video.isShort ? 'تنسيق Short سريع (بدون حاجة لصورة منفصلة)' : 'صورة مصغرة عالية التباين مرفقة'
      },
      {
        ok: video.isShort ? true : (allSubs.length > 0 && (!el.attachSubtitleCheck || el.attachSubtitleCheck.checked)),
        weight: 10,
        label: allSubs.length > 1 ? `ترجمات متعددة (${allSubs.map((s) => (s.language || 'ar').toUpperCase()).join(' + ')})` : 'ترجمة عربية (.srt) للبحث والاحتفاظ'
      },
      {
        ok: hasPlaylist,
        weight: 7,
        label: 'ربط تلقائي بقائمة تشغيل السلسلة (Session Time)'
      },
      {
        ok: hasFirstComment,
        weight: 5,
        label: 'أول تعليق تفاعلي جاهز لإشعال الساعة الأولى'
      },
      {
        ok: meta.categoryId === '27' || meta.categoryId === '28',
        weight: 5,
        label: 'فئة مثالية للوثائقيات (28 تقنية / 27 تعليم)'
      }
    ];

    const score = checks.reduce((s, c) => s + (c.ok ? c.weight : 0), 0);
    return { score, checks };
  }

  function formatDateLocalInput(dateObj) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${dateObj.getFullYear()}-${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())}T${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}`;
  }

  function computeNextPrimeTimeLocalInput(offsetHours = 0) {
    // Next 21:00 (9:00 PM local time), at least 3 hours ahead so HD/4K processing finishes
    const now = new Date();
    const target = new Date(now.getTime());
    target.setHours(21, 0, 0, 0);
    if (target.getTime() - now.getTime() < 3 * 60 * 60 * 1000) {
      target.setDate(target.getDate() + 1);
    }
    if (offsetHours) {
      target.setTime(target.getTime() + offsetHours * 60 * 60 * 1000);
    }
    return formatDateLocalInput(target);
  }

  function scheduleFullViralCampaign() {
    if (!state.videos.length) {
      showAlert('لا توجد فيديوهات محمّلة حالياً للجدولة.', 'info');
      return;
    }
    const ready = state.videos.filter((v) => !state.publishedMap[v.id]);
    if (!ready.length) {
      showAlert('جميع الفيديوهات الحالية منشورة بالفعل.', 'info');
      return;
    }

    const longVideos = ready.filter((v) => !v.isShort);
    const shortVideos = ready.filter((v) => v.isShort);

    // Main video -> Next 9:00 PM prime time; additional long videos -> +72h each
    longVideos.forEach((v, idx) => {
      const meta = getVideoMeta(v);
      meta.publishAt = computeNextPrimeTimeLocalInput(idx * 72);
      meta.privacyStatus = 'private';
    });

    // Shorts -> Staggered +12h, +36h, +72h, +96h to keep feeding traffic back to the main video!
    const shortOffsets = [12, 36, 72, 96, 120, 144];
    shortVideos.forEach((v, idx) => {
      const meta = getVideoMeta(v);
      meta.publishAt = computeNextPrimeTimeLocalInput(shortOffsets[idx] || (idx + 1) * 24);
      meta.privacyStatus = 'private';
    });

    renderVideos();
    showAlert(
      `📅 تم توزيع حملة إطلاق ذكية على ${longVideos.length} فيديو رئيسي (ذروة 9:00 م) و ${shortVideos.length} شورتس (مجدولة بعد +12 و +36 و +72 ساعة)!`,
      'success'
    );
    addLog(`📅 تم تفعيل جدولة حملة الانتشار المليوني لـ ${ready.length} فيديو.`, 'success');
  }

  function autoOptimizeVideoMeta(video) {
    const meta = getVideoMeta(video);
    const ext = video.extractedMeta || null;

    // 1. Clean high-CTR title
    let title = (ext && ext.title) || meta.title || video.suggestedTitle;
    title = String(title)
      .replace(/^\d{1,3}\s*[—–\-_.]+\s*/, '')
      .replace(/\s*[—–\-|]+\s*(?:نَ?قْ?ش|حلقة|ep)\s*[\d٠-٩]+\s*$/i, '')
      .trim();
    meta.title = title;

    // 2. Restore rich description from publishing pack if empty, or enrich hook + hashtags
    if (!meta.description.trim() && ext && ext.description) {
      meta.description = ext.description;
    } else if (!meta.description.trim()) {
      meta.description =
        `${title}\n\n` +
        'في هذه الحلقة نستكشف التفاصيل الخفية خطوة بخطوة بأسلوب بصري مشوّق.\n' +
        'شاركونا رأيكم في التعليقات 👇\n\n' +
        '#نقش #ماذا_لو #وثائقي';
    } else if (!/#[^\s#]+/.test(meta.description)) {
      meta.description = `${meta.description.trim()}\n\n#نقش #ماذا_لو #وثائقي`;
    }

    // 3. Tags from publishing pack + smart Arabic discovery tags
    if (!meta.tags.trim() && ext && ext.tagsText) {
      meta.tags = ext.tagsText;
    } else if (!meta.tags.trim()) {
      const words = title
        .replace(/[؟?!.,،—–\-|()]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 3);
      const baseTags = [title, ...words.slice(0, 6), 'وثائقي عربي', 'ماذا لو', 'قناة نقش', 'قصص معرفية'];
      meta.tags = Array.from(new Set(baseTags)).join('، ');
    }

    // 4. Optimal category for documentaries/tech
    const combined = `${meta.title} ${meta.tags} ${meta.description}`.toLowerCase();
    meta.categoryId =
      combined.includes('إنترنت') || combined.includes('انترنت') || combined.includes('ذكاء') || combined.includes('تقني')
        ? '28'
        : '27';

    meta.expanded = true;
    renderVideos();
    showAlert('✨ تم تحسين العنوان والوصف والكلمات المفتاحية والفئة لخوارزمية يوتيوب!', 'success');
    addLog(`✨ تم تحسين إعدادات خوارزمية يوتيوب للفيديو: ${meta.title}`, 'success');
  }

  function renderVideos() {
    if (!state.connected) {
      el.videosList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📂</div>
          <h3>اربط حساب Google للبدء</h3>
          <p class="muted">بعد ربط حسابك وقناتك على يوتيوب، ستظهر هنا جميع ملفات الفيديو من Google Drive جاهزة للرفع والنشر التلقائي.</p>
        </div>
      `;
      return;
    }

    if (!state.videos.length) {
      el.videosList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">✨</div>
          <h3>لا توجد ملفات فيديو في هذا المجلد حالياً</h3>
          <p class="muted">ضع أي ملف فيديو MP4/MOV/MKV في مجلد <code>YouTube_Queue</code> أو انتقل إلى تبويب «ملفاتي الرئيسية (My Drive)» لرؤية فيديوهاتك الموجودة.</p>
        </div>
      `;
      return;
    }

    el.videosList.innerHTML = state.videos
      .map((v) => {
        const meta = getVideoMeta(v);
        const pub = state.publishedMap[v.id];
        const st = state.uploadStatus[v.id] || (pub ? { status: 'published', percent: 100, ...pub } : { status: 'ready', percent: 0 });

        let badgeHtml = '<span class="badge badge-ready">جاهز للرفع</span>';
        let cardClass = 'video-card';
        if (st.status === 'uploading') {
          badgeHtml = `<span class="badge badge-uploading">جاري الرفع ${st.percent || 0}%</span>`;
          cardClass += ' uploading';
        } else if (st.status === 'published') {
          badgeHtml = '<span class="badge badge-published">تم النشر ✓</span>';
          cardClass += ' published';
        } else if (st.status === 'failed') {
          badgeHtml = '<span class="badge badge-failed">فشل الرفع</span>';
          cardClass += ' failed';
        }

        const allThumbs = [v.matchingThumbnail, ...(v.alternativeThumbnails || [])].filter(Boolean);
        const activeThumb = getSelectedThumbnail(v, meta);
        const allSubs = Array.isArray(v.allSubtitles) && v.allSubtitles.length
          ? v.allSubtitles
          : v.matchingSubtitle ? [{ ...v.matchingSubtitle, language: 'ar', label: 'العربية' }] : [];

        const typeBadge = v.isShort
          ? `<span class="badge badge-short">⚡ Short / ريلز${v.durationSec ? ` • ${formatDuration(v.durationSec)}` : ''}</span>`
          : `<span class="badge badge-long">🎬 فيديو طويل${v.durationSec ? ` • ${formatDuration(v.durationSec)}` : ''}${v.height ? ` • ${v.height}p` : ''}</span>`;

        const thumbBadge = activeThumb
          ? `<span class="badge badge-thumb">🖼️ ${allThumbs.length > 1 ? `${allThumbs.length} صور A/B — المختارة: ` : 'صورة مصغرة: '}${escapeHtml(activeThumb.name)}</span>`
          : '';
        const subBadge = allSubs.length
          ? `<span class="badge badge-sub">💬 ترجمة (${allSubs.map((s) => (s.language || 'ar').toUpperCase()).join(' + ')})</span>`
          : '';
        const globalBadge = v.englishMeta && v.englishMeta.title
          ? `<span class="badge badge-global">🌍 ترجمة عالمية EN جاهزة</span>`
          : '';
        const packBadge = v.extractedMeta
          ? `<span class="badge badge-pack">📝 حزمة النشر والفصول محمّلة</span>`
          : '';

        const algo = computeClientAlgoScore(v, meta);
        const algoBadgeClass =
          algo.score >= 85 ? 'badge-algo-high' : algo.score >= 65 ? 'badge-algo-mid' : 'badge-algo-low';
        const algoBadge = `<span class="badge ${algoBadgeClass}">📈 الخوارزمية: ${algo.score}/100</span>`;

        const packAltTitles = v.extractedMeta && Array.isArray(v.extractedMeta.alternativeTitles)
          ? v.extractedMeta.alternativeTitles
          : [];
        const viralIdeas = Array.isArray(v.viralTitleIdeas) ? v.viralTitleIdeas : [];
        const combinedTitles = Array.from(new Set([...packAltTitles, ...viralIdeas])).slice(0, 6);
        const altTitlesHtml = combinedTitles.length
          ? `<div class="alt-titles-row">
              <span class="muted small" style="width:100%;">💡 مولّد العناوين المليونية + بدائل A/B (اضغط لتطبيق العنوان فوراً):</span>
              ${combinedTitles
                .map(
                  (alt) =>
                    `<button type="button" class="alt-title-chip" data-pick-title="${escapeHtml(v.id)}" data-title-val="${escapeHtml(alt)}">✨ ${escapeHtml(alt)}</button>`
                )
                .join('')}
            </div>`
          : '';

        const thumbPickerHtml = allThumbs.length > 1
          ? `<div class="field full">
              <label>🖼️ تبديل الصورة المصغرة الأساسية قبل الرفع (تم اكتشاف ${allThumbs.length} نسخ A/B في المجلد):</label>
              <div class="thumb-ab-picker">
                ${allThumbs
                  .map(
                    (t, idx) =>
                      `<button type="button" class="thumb-ab-chip ${activeThumb && activeThumb.id === t.id ? 'active' : ''}" data-pick-thumb="${escapeHtml(v.id)}" data-thumb-id="${escapeHtml(t.id)}">${idx === 0 ? '⭐ ' : '🧪 '}${escapeHtml(t.name)}</button>`
                  )
                  .join('')}
              </div>
            </div>`
          : '';

        const previewThumbUrl = (activeThumb && activeThumb.thumbnailLink) || v.thumbnailLink || '';
        const ytPreviewHtml = `
          <div class="yt-feed-preview full">
            <div class="yt-preview-thumb">
              ${previewThumbUrl ? `<img src="${escapeHtml(previewThumbUrl)}" alt="Thumbnail preview" />` : '<span>🖼️ معاينة يوتيوب</span>'}
              ${v.durationSec ? `<span class="yt-preview-dur">${formatDuration(v.durationSec)}</span>` : ''}
            </div>
            <div class="yt-preview-info">
              <div class="yt-preview-title">${escapeHtml(meta.title || v.suggestedTitle)}</div>
              <div class="yt-preview-sub">${escapeHtml(state.channel ? state.channel.title : 'قناتك على يوتيوب')} • ${meta.publishAt ? `مجدول: ${escapeHtml(meta.publishAt.replace('T', ' '))}` : 'معاينة شكل الفيديو على هاتف المشاهد'}</div>
              ${v.englishMeta && v.englishMeta.title ? `<div class="yt-preview-sub" style="color:#5eead4;">🌍 EN: ${escapeHtml(v.englishMeta.title)}</div>` : ''}
            </div>
          </div>`;

        const algoChecksHtml = `
          <div class="algo-panel full">
            <div class="algo-panel-head">
              <strong>🔥 فحص خوارزمية المليون مشاهدة (${algo.score}/100)</strong>
              <div class="video-actions">
                <button type="button" class="btn btn-secondary btn-xs" data-optimize-algo="${escapeHtml(v.id)}">✨ تحسين تلقائي</button>
                <button type="button" class="btn btn-ghost btn-xs" data-prime-schedule="${escapeHtml(v.id)}">⏰ جدولة ذروة 9:00 م</button>
                ${!v.isShort ? `<button type="button" class="btn btn-secondary btn-xs" data-open-clipper="${escapeHtml(v.id)}">✂️ قص شورت 9:16</button>` : ''}
              </div>
            </div>
            <div class="algo-checks">
              ${algo.checks
                .map(
                  (c) =>
                    `<div class="algo-check ${c.ok ? 'ok' : 'miss'}">${c.ok ? '✅' : '⚡'} ${escapeHtml(c.label)}</div>`
                )
                .join('')}
            </div>
          </div>`;

        const progressHtml =
          st.status === 'uploading'
            ? `
            <div class="progress-wrap">
              <div class="progress-track"><div class="progress-fill" style="width:${st.percent || 5}%"></div></div>
              <div class="progress-label">
                <span>${escapeHtml(st.message || 'جاري الرفع المجزأ...')}</span>
                <strong>${st.percent || 0}%</strong>
              </div>
            </div>`
            : st.status === 'failed' && st.message
              ? `<div class="small" style="color:#fca5a5;">⚠️ ${escapeHtml(st.message)}</div>`
              : '';

        const publishedLinksHtml =
          st.status === 'published' && st.youtubeUrl
            ? `
            <div class="video-actions">
              <a class="btn btn-secondary btn-xs" href="${escapeHtml(st.youtubeUrl)}" target="_blank" rel="noopener">▶️ مشاهدة على يوتيوب ↗</a>
              <a class="btn btn-ghost btn-xs" href="${escapeHtml(st.studioUrl || st.youtubeUrl)}" target="_blank" rel="noopener">🎛️ تعديل في Studio ↗</a>
            </div>`
            : '';

        const editorHtml = meta.expanded
          ? `
          <div class="meta-editor" data-editor-for="${escapeHtml(v.id)}">
            ${ytPreviewHtml}
            ${algoChecksHtml}
            ${thumbPickerHtml}
            <div class="field full">
              <label>عنوان الفيديو على يوتيوب (${String(meta.title || '').length}/100 حرف — المثالي 40–65 حرفاً)</label>
              <input type="text" data-field="title" maxlength="100" value="${escapeHtml(meta.title)}" />
              ${altTitlesHtml}
            </div>
            <div class="field full">
              <label>الوصف (يشمل المقدمة + فصول الفيديو 00:00 + 3 هاشتاقات)</label>
              <textarea data-field="description" rows="6" placeholder="اكتب وصف الفيديو هنا...">${escapeHtml(meta.description)}</textarea>
            </div>
            <div class="field full">
              <label>💬 التعليق التفاعلي الأول (يُنشر تلقائياً عند النشر العام لإشعال تفاعل الساعة الأولى)</label>
              <textarea data-field="firstComment" rows="2" placeholder="اكتب سؤالاً مثيراً للنقاش لتثبيته في التعليقات...">${escapeHtml(meta.firstComment || '')}</textarea>
            </div>
            <div class="field">
              <label>الوسوم / الكلمات المفتاحية (مفصولة بفاصلة)</label>
              <input type="text" data-field="tags" placeholder="انقطاع الإنترنت، ماذا لو، وثائقي عربي" value="${escapeHtml(meta.tags)}" />
            </div>
            <div class="field">
              <label>الخصوصية</label>
              <select data-field="privacyStatus">
                <option value="private" ${meta.privacyStatus === 'private' ? 'selected' : ''}>خاص (Private — يُنصح به ساعتين قبل النشر للمعالجة HD)</option>
                <option value="unlisted" ${meta.privacyStatus === 'unlisted' ? 'selected' : ''}>غير مدرج (Unlisted)</option>
                <option value="public" ${meta.privacyStatus === 'public' ? 'selected' : ''}>عام (Public)</option>
              </select>
            </div>
            <div class="field">
              <label>جدولة النشر (اختياري — يُنصح بذروة 7:00–9:00 م)</label>
              <input type="datetime-local" data-field="publishAt" value="${escapeHtml(meta.publishAt)}" />
            </div>
            <div class="field">
              <label>الفئة</label>
              <select data-field="categoryId">
                <option value="28" ${meta.categoryId === '28' ? 'selected' : ''}>علوم وتقنية (28 — ممتاز لمحتوى الإنترنت والذكاء الاصطناعي)</option>
                <option value="27" ${meta.categoryId === '27' ? 'selected' : ''}>تعليم (27 — ممتاز للوثائقيات والشروحات)</option>
                <option value="22" ${meta.categoryId === '22' ? 'selected' : ''}>أشخاص ومدونات (22)</option>
                <option value="24" ${meta.categoryId === '24' ? 'selected' : ''}>ترفيه (24)</option>
                <option value="1" ${meta.categoryId === '1' ? 'selected' : ''}>أفلام ورسوم متحركة (1)</option>
                <option value="20" ${meta.categoryId === '20' ? 'selected' : ''}>ألعاب فيديو (20)</option>
              </select>
            </div>
            <label class="check-row full">
              <input type="checkbox" data-field="madeForKids" ${meta.madeForKids ? 'checked' : ''} />
              <span>هذا الفيديو مخصص للأطفال</span>
            </label>
          </div>`
          : '';

        return `
        <article class="${cardClass}" data-video-id="${escapeHtml(v.id)}">
          <div class="video-top">
            <div class="video-title-wrap">
              <h4 class="video-title">${escapeHtml(meta.title)}</h4>
              <div class="video-meta-line">
                ${v.folderName ? `<span>📂 ${escapeHtml(v.folderName)}</span>` : ''}
                <span>📁 ${escapeHtml(v.name)}</span>
                <span>💾 ${v.sizeMb} MB</span>
                <a href="${escapeHtml(v.webViewLink)}" target="_blank" rel="noopener" style="color:#7dd3fc;text-decoration:none;">عرض في Drive ↗</a>
              </div>
              <div class="video-meta-line">
                ${badgeHtml}
                ${typeBadge}
                ${algoBadge}
                ${packBadge}
                ${thumbBadge}
                ${subBadge}
                ${globalBadge}
              </div>
            </div>
            <div class="video-actions">
              ${!v.isShort ? `<button class="btn btn-secondary btn-xs" type="button" data-open-clipper="${escapeHtml(v.id)}">✂️ قص شورت 9:16</button>` : ''}
              <button class="btn btn-ghost btn-xs" type="button" data-toggle-edit="${escapeHtml(v.id)}">
                ${meta.expanded ? '▲ إغلاق الاستوديو' : '🔥 استوديو الخوارزمية'}
              </button>
              <button class="btn btn-primary btn-xs" type="button" data-publish-one="${escapeHtml(v.id)}" ${st.status === 'uploading' || state.isUploading ? 'disabled' : ''}>
                ${st.status === 'published' ? '🔁 إعادة الرفع' : '🚀 رفع ليوتيوب'}
              </button>
            </div>
          </div>
          ${progressHtml}
          ${publishedLinksHtml}
          ${editorHtml}
        </article>`;
      })
      .join('');
  }

  // ============================================================================
  // Chunked Resumable Upload Engine
  // ============================================================================

  async function publishSingleVideo(video) {
    const meta = getVideoMeta(video);
    const chunkSizeMb = Number(el.chunkSizeSelect.value || 4);

    state.uploadStatus[video.id] = {
      status: 'uploading',
      percent: 2,
      message: 'جاري بدء جلسة الرفع مع YouTube...'
    };
    renderVideos();
    addLog(`بدء رفع الفيديو: ${meta.title} (${video.sizeMb} MB)`, 'info');

    try {
      // 1. Initialize YouTube Resumable Upload
      const publishAtIso = meta.publishAt ? new Date(meta.publishAt).toISOString() : '';
      const initRes = await apiFetch('/api/upload/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId: video.id,
          title: meta.title,
          description: meta.description,
          tags: meta.tags,
          privacyStatus: meta.privacyStatus || el.defaultPrivacySelect.value || 'private',
          publishAt: publishAtIso,
          categoryId: meta.categoryId || '22',
          madeForKids: meta.madeForKids,
          chunkSizeMb
        })
      });

      const totalSize = initRes.fileSize;
      const chunkBytes = initRes.chunkSizeBytes;
      const totalChunks = Math.ceil(totalSize / chunkBytes);
      let offset = 0;
      let chunkIdx = 0;
      let videoId = null;

      // 2. Stream chunk-by-chunk Drive -> Server -> YouTube (with automatic transient retry)
      while (offset < totalSize) {
        chunkIdx++;
        const start = offset;
        const end = Math.min(offset + chunkBytes - 1, totalSize - 1);

        state.uploadStatus[video.id] = {
          status: 'uploading',
          percent: Math.max(3, Math.floor((offset / totalSize) * 100)),
          message: `جاري رفع المقطع ${chunkIdx} من ${totalChunks}...`
        };
        renderVideos();

        let chunkRes = null;
        let lastErr = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            chunkRes = await apiFetch('/api/upload/chunk', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                fileId: video.id,
                uploadUri: initRes.uploadUri,
                start,
                end,
                totalSize,
                mimeType: initRes.mimeType
              })
            });
            lastErr = null;
            break;
          } catch (chunkErr) {
            lastErr = chunkErr;
            if (attempt < 2) {
              addLog(`إعادة محاولة المقطع ${chunkIdx}/${totalChunks} بعد خطأ مؤقت...`, 'warn');
              await new Promise((r) => setTimeout(r, 1500));
            }
          }
        }
        if (lastErr) throw lastErr;

        if (chunkRes.done) {
          videoId = chunkRes.videoId;
          break;
        }
        offset = chunkRes.nextOffset;
      }

      if (!videoId) {
        throw new Error('اكتمل إرسال المقاطع دون استلام معرف الفيديو من YouTube.');
      }

      // 3. Complete: optional thumbnail, move file to Published, log to Sheet
      state.uploadStatus[video.id] = {
        status: 'uploading',
        percent: 99,
        message: 'تم الرفع! جاري تحديث Drive و Google Sheets...'
      };
      renderVideos();

      const sourceFolderId =
        (initRes.parents && initRes.parents[0]) ||
        (state.currentFolderId !== 'root' ? state.currentFolderId : '');

      const completeRes = await apiFetch('/api/upload/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          fileId: video.id,
          fileName: initRes.fileName,
          fileSize: totalSize,
          title: initRes.metadata.snippet.title,
          description: initRes.metadata.snippet.description,
          tags: initRes.metadata.snippet.tags || [],
          privacyStatus: initRes.metadata.status.privacyStatus,
          publishAt: initRes.metadata.status.publishAt || '',
          categoryId: initRes.metadata.snippet.categoryId,
          madeForKids: initRes.metadata.status.selfDeclaredMadeForKids,
          attachThumbnail: el.attachThumbnailCheck.checked,
          matchingThumbnail: getSelectedThumbnail(video, meta),
          attachSubtitle: el.attachSubtitleCheck ? el.attachSubtitleCheck.checked : true,
          matchingSubtitle: video.matchingSubtitle,
          allSubtitles: video.allSubtitles || [],
          applyEnglishLocalization: el.applyEnglishLocCheck ? el.applyEnglishLocCheck.checked : true,
          englishMeta: video.englishMeta || null,
          addToPlaylist: el.addToPlaylistCheck ? el.addToPlaylistCheck.checked : true,
          playlistTitle: el.playlistTitleInput ? el.playlistTitleInput.value.trim() : '',
          postFirstComment: el.postFirstCommentCheck ? el.postFirstCommentCheck.checked : true,
          firstComment: meta.firstComment || '',
          language: 'ar',
          moveToPublished: el.moveToPublishedCheck.checked,
          sourceFolderId,
          publishedFolderId: state.health.defaults.PUBLISHED_FOLDER_ID,
          logToSheet: el.logToSheetCheck.checked,
          spreadsheetId: state.health.defaults.SPREADSHEET_ID
        })
      });

      state.publishedMap[video.id] = {
        videoId,
        youtubeUrl: completeRes.youtubeUrl,
        studioUrl: completeRes.studioUrl,
        publishedAt: new Date().toISOString()
      };
      localStorage.setItem(STORAGE_KEYS.PUBLISHED_MAP, JSON.stringify(state.publishedMap));

      state.uploadStatus[video.id] = {
        status: 'published',
        percent: 100,
        youtubeUrl: completeRes.youtubeUrl,
        studioUrl: completeRes.studioUrl
      };
      renderVideos();

      addLog(`✅ تم نشر "${meta.title}" بنجاح: ${completeRes.youtubeUrl}`, 'success');
      if (completeRes.thumbnailUploaded) {
        addLog('🖼️ تم رفع الصورة المصغرة تلقائياً بنجاح.', 'success');
      }
      if (completeRes.uploadedSubtitles && completeRes.uploadedSubtitles.length > 0) {
        addLog(`💬 تم رفع الترجمات (${completeRes.uploadedSubtitles.map((l) => l.toUpperCase()).join(' + ')}) تلقائياً بنجاح.`, 'success');
      }
      if (completeRes.localizedEn) {
        addLog('🌍 تم إضافة العنوان والوصف بالإنجليزية للانتشار العالمي بنجاح.', 'success');
      }
      if (completeRes.playlistLinked) {
        addLog(`📚 تم ربط الفيديو بقائمة التشغيل: "${completeRes.playlistLinked.title}".`, 'success');
      }
      if (completeRes.commentPosted) {
        addLog('🔥 تم نشر التعليق التفاعلي الأول تلقائياً لرفع سرعة التفاعل!', 'success');
      }
      if (completeRes.warnings && completeRes.warnings.length > 0) {
        addLog(`تنبيه: ${completeRes.warnings.join(' | ')}`, 'warn');
      }
      return true;
    } catch (err) {
      state.uploadStatus[video.id] = {
        status: 'failed',
        percent: 0,
        message: err.message
      };
      renderVideos();
      showAlert(`❌ فشل رفع "${meta.title}": ${err.message}`, 'error');
      addLog(`❌ فشل رفع "${meta.title}": ${err.message}`, 'error');
      return false;
    }
  }

  async function publishAllReadyVideos() {
    if (!state.connected || state.isUploading) return;
    const readyVideos = state.videos.filter((v) => !state.publishedMap[v.id]);
    if (!readyVideos.length) {
      addLog('لا توجد فيديوهات جديدة غير منشورة في المجلد الحالي.', 'info');
      return;
    }

    state.isUploading = true;
    el.publishAllBtn.disabled = true;
    let okCount = 0;

    try {
      for (const v of readyVideos) {
        const ok = await publishSingleVideo(v);
        if (ok) okCount++;
      }
      if (okCount > 0) {
        showAlert(`✅ تم نشر ${okCount} فيديو بنجاح على قناتك في يوتيوب!`, 'success');
        if (el.moveToPublishedCheck.checked) {
          await loadVideos(state.currentFolderId);
        }
      }
    } finally {
      state.isUploading = false;
      el.publishAllBtn.disabled = !state.connected;
      renderVideos();
    }
  }

  // ============================================================================
  // Auto-Publisher Scheduler
  // ============================================================================

  function startAutoPublisher() {
    stopAutoPublisher();
    state.autoEnabled = true;
    const intervalMin = Number(el.intervalSelect.value || 15);
    const intervalMs = intervalMin * 60 * 1000;
    state.nextAutoRunAt = Date.now() + intervalMs;

    el.autoStatusPill.className = 'pill pill-active';
    el.autoStatusText.textContent = `النشر التلقائي: نشط (كل ${intervalMin} د)`;
    el.countdownBox.classList.remove('hidden');

    addLog(`⚡ تم تفعيل النشر التلقائي كل ${intervalMin} دقيقة.`, 'success');

    const runCycle = async () => {
      if (!state.connected || !state.autoEnabled) return;
      state.nextAutoRunAt = Date.now() + intervalMs;
      addLog('🔄 بدء دورة الفحص التلقائي لمجلد Google Drive...', 'info');
      await loadVideos(state.currentFolderId);
      await publishAllReadyVideos();
    };

    state.autoTimerId = setInterval(runCycle, intervalMs);
    state.countdownTimerId = setInterval(updateCountdown, 1000);
    updateCountdown();

    // Run an immediate scan & publish right away
    runCycle();
  }

  function stopAutoPublisher() {
    state.autoEnabled = false;
    if (state.autoTimerId) clearInterval(state.autoTimerId);
    if (state.countdownTimerId) clearInterval(state.countdownTimerId);
    state.autoTimerId = null;
    state.countdownTimerId = null;
    state.nextAutoRunAt = null;

    el.autoStatusPill.className = 'pill pill-muted';
    el.autoStatusText.textContent = 'النشر التلقائي: متوقف';
    el.countdownBox.classList.add('hidden');
  }

  function updateCountdown() {
    if (!state.nextAutoRunAt) return;
    const remSec = Math.max(0, Math.floor((state.nextAutoRunAt - Date.now()) / 1000));
    const mm = String(Math.floor(remSec / 60)).padStart(2, '0');
    const ss = String(remSec % 60).padStart(2, '0');
    el.countdownTimer.textContent = `${mm}:${ss}`;
  }

  // ============================================================================
  // Events
  // ============================================================================

  function bindEvents() {
    el.alertCloseBtn.addEventListener('click', hideAlert);

    el.openSetupBtn.addEventListener('click', () => {
      el.setupPanel.classList.toggle('hidden');
    });

    el.toggleSetupBtn.addEventListener('click', () => {
      el.setupPanel.classList.add('hidden');
    });

    el.oauthConfigForm.addEventListener('submit', handleSaveConfig);
    el.connectGoogleBtn.addEventListener('click', handleConnectGoogle);
    el.logoutBtn.addEventListener('click', handleLogout);

    // Copy buttons
    document.querySelectorAll('.copy-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const target = document.getElementById(btn.dataset.copy);
        if (!target) return;
        try {
          await navigator.clipboard.writeText(target.textContent.trim());
          const orig = btn.textContent;
          btn.textContent = '✓ تم النسخ';
          setTimeout(() => {
            btn.textContent = orig;
          }, 1500);
        } catch {
          showAlert('انسخ الرابط يدوياً من الصندوق.', 'info');
        }
      });
    });

    // Folder presets
    el.folderTabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.folder-tab');
      if (!btn || !state.health) return;
      document.querySelectorAll('.folder-tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const preset = btn.dataset.folderPreset;
      state.currentPreset = preset;

      let targetId = 'all';
      if (preset === 'queue') targetId = state.health.defaults.QUEUE_FOLDER_ID;
      if (preset === 'root') targetId = 'root';
      if (preset === 'published') targetId = state.health.defaults.PUBLISHED_FOLDER_ID;

      if (state.connected) {
        loadVideos(targetId);
      } else {
        state.currentFolderId = targetId;
      }
    });

    el.loadCustomFolderBtn.addEventListener('click', () => {
      const id = el.customFolderIdInput.value.trim();
      if (!id) return;
      document.querySelectorAll('.folder-tab').forEach((b) => b.classList.remove('active'));
      loadVideos(id);
    });

    el.subfoldersRow.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-open-folder]');
      if (!btn) return;
      document.querySelectorAll('.folder-tab').forEach((b) => b.classList.remove('active'));
      loadVideos(btn.dataset.openFolder);
    });

    el.refreshVideosBtn.addEventListener('click', () => loadVideos(state.currentFolderId));
    el.publishAllBtn.addEventListener('click', publishAllReadyVideos);

    // Video card actions (delegation)
    el.videosList.addEventListener('click', async (e) => {
      const editBtn = e.target.closest('[data-toggle-edit]');
      if (editBtn) {
        const vidId = editBtn.dataset.toggleEdit;
        const vid = state.videos.find((v) => v.id === vidId);
        if (!vid) return;
        const meta = getVideoMeta(vid);
        meta.expanded = !meta.expanded;
        renderVideos();
        return;
      }

      const optBtn = e.target.closest('[data-optimize-algo]');
      if (optBtn) {
        const vid = state.videos.find((v) => v.id === optBtn.dataset.optimizeAlgo);
        if (vid) autoOptimizeVideoMeta(vid);
        return;
      }

      const primeBtn = e.target.closest('[data-prime-schedule]');
      if (primeBtn) {
        const vid = state.videos.find((v) => v.id === primeBtn.dataset.primeSchedule);
        if (!vid) return;
        const meta = getVideoMeta(vid);
        meta.publishAt = computeNextPrimeTimeLocalInput();
        meta.privacyStatus = 'private';
        renderVideos();
        showAlert('⏰ تم ضبط النشر المجدول تلقائياً على ذروة المشاهدة (9:00 مساءً) مع وقت كافٍ لمعالجة HD!', 'success');
        return;
      }

      const pickTitleBtn = e.target.closest('[data-pick-title]');
      if (pickTitleBtn) {
        const vid = state.videos.find((v) => v.id === pickTitleBtn.dataset.pickTitle);
        if (!vid) return;
        const meta = getVideoMeta(vid);
        meta.title = pickTitleBtn.dataset.titleVal || meta.title;
        renderVideos();
        return;
      }

      const pickThumbBtn = e.target.closest('[data-pick-thumb]');
      if (pickThumbBtn) {
        const vid = state.videos.find((v) => v.id === pickThumbBtn.dataset.pickThumb);
        if (!vid) return;
        const meta = getVideoMeta(vid);
        meta.selectedThumbnailId = pickThumbBtn.dataset.thumbId || '';
        renderVideos();
        showAlert('🖼️ تم تبديل الصورة المصغرة الأساسية بنجاح!', 'success');
        return;
      }

      const clipBtn = e.target.closest('[data-open-clipper]');
      if (clipBtn) {
        const vid = state.videos.find((v) => v.id === clipBtn.dataset.openClipper);
        if (vid) openViralClipper(vid);
        return;
      }

      const pubBtn = e.target.closest('[data-publish-one]');
      if (pubBtn && !state.isUploading) {
        const vidId = pubBtn.dataset.publishOne;
        const vid = state.videos.find((v) => v.id === vidId);
        if (!vid) return;
        state.isUploading = true;
        el.publishAllBtn.disabled = true;
        try {
          const ok = await publishSingleVideo(vid);
          if (ok && el.moveToPublishedCheck.checked) {
            await loadVideos(state.currentFolderId);
          }
        } finally {
          state.isUploading = false;
          el.publishAllBtn.disabled = !state.connected;
          renderVideos();
        }
      }
    });

    // Metadata inline edits (delegation)
    el.videosList.addEventListener('input', handleMetaEdit);
    el.videosList.addEventListener('change', handleMetaEdit);

    function handleMetaEdit(e) {
      const editor = e.target.closest('[data-editor-for]');
      if (!editor) return;
      const vidId = editor.dataset.editorFor;
      const field = e.target.dataset.field;
      if (!field) return;
      const vid = state.videos.find((v) => v.id === vidId);
      if (!vid) return;
      const meta = getVideoMeta(vid);
      meta[field] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      if (field === 'title') {
        const titleNode = editor.closest('.video-card').querySelector('.video-title');
        if (titleNode) titleNode.textContent = meta.title || vid.suggestedTitle;
      }
    }

    // Auto-publisher controls
    el.autoPublishToggle.addEventListener('change', () => {
      if (el.autoPublishToggle.checked) {
        startAutoPublisher();
      } else {
        stopAutoPublisher();
        addLog('⏹️ تم إيقاف النشر التلقائي.', 'info');
      }
    });

    [
      el.intervalSelect,
      el.defaultPrivacySelect,
      el.chunkSizeSelect,
      el.moveToPublishedCheck,
      el.attachThumbnailCheck,
      el.attachSubtitleCheck,
      el.applyEnglishLocCheck,
      el.addToPlaylistCheck,
      el.playlistTitleInput,
      el.postFirstCommentCheck,
      el.logToSheetCheck
    ].filter(Boolean).forEach((node) => {
      node.addEventListener('change', () => {
        saveSettings();
        if (
          node === el.attachThumbnailCheck ||
          node === el.attachSubtitleCheck ||
          node === el.addToPlaylistCheck ||
          node === el.postFirstCommentCheck ||
          node === el.playlistTitleInput
        ) {
          renderVideos();
        }
        if (node === el.intervalSelect && state.autoEnabled) {
          startAutoPublisher();
        }
      });
    });

    if (el.scheduleCampaignBtn) {
      el.scheduleCampaignBtn.addEventListener('click', scheduleFullViralCampaign);
    }

    el.clearLogsBtn.addEventListener('click', () => {
      el.activityLog.innerHTML = '';
    });

    bindClipperEvents();
  }

  // ============================================================================
  // Built-in 9:16 Viral Short Clipper & Direct YouTube Uploader
  // ============================================================================

  const clipper = {
    video: null,
    isRecording: false,
    isPreviewing: false,
    rafId: null,
    recorder: null,
    recordedBlob: null,
    recordedUrl: '',
    audioCtx: null,
    audioSource: null,
    audioDest: null
  };

  function drawClipperFrame(progressRatio = 0) {
    const canvas = el.clipperCanvas;
    const vidEl = el.clipperSourceVideo;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;

    // 1. Deep midnight-teal backdrop + blurred video bleed
    ctx.fillStyle = '#091522';
    ctx.fillRect(0, 0, W, H);

    if (vidEl && vidEl.readyState >= 2 && vidEl.videoWidth > 0) {
      ctx.save();
      ctx.filter = 'blur(18px) brightness(0.45)';
      const bgScale = Math.max(W / vidEl.videoWidth, H / vidEl.videoHeight);
      const bw = vidEl.videoWidth * bgScale;
      const bh = vidEl.videoHeight * bgScale;
      ctx.drawImage(vidEl, (W - bw) / 2, (H - bh) / 2, bw, bh);
      ctx.restore();

      // 2. Crisp centered 16:9 video frame with golden documentary frame
      const fgW = W - 24;
      const fgH = Math.round(fgW * (vidEl.videoHeight / vidEl.videoWidth));
      const fgX = 12;
      const fgY = Math.round((H - fgH) / 2) + 20;

      ctx.fillStyle = 'rgba(245, 176, 65, 0.88)';
      ctx.fillRect(fgX - 3, fgY - 3, fgW + 6, fgH + 6);
      ctx.drawImage(vidEl, fgX, fgY, fgW, fgH);
    }

    // 3. Top Viral Hook Banner (wrapped Arabic text)
    const hookText = (el.clipHookInput && el.clipHookInput.value.trim()) || '';
    if (hookText) {
      ctx.fillStyle = 'rgba(11, 21, 34, 0.84)';
      ctx.fillRect(20, 44, W - 40, 134);
      ctx.strokeStyle = 'rgba(245, 176, 65, 0.8)';
      ctx.lineWidth = 2;
      ctx.strokeRect(20, 44, W - 40, 134);

      ctx.fillStyle = '#fef3c7';
      ctx.font = 'bold 26px "Cairo", "Segoe UI", Tahoma, sans-serif';
      ctx.textAlign = 'center';
      ctx.direction = 'rtl';

      const words = hookText.split(/\s+/);
      const lines = [];
      let line = '';
      for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (ctx.measureText(test).width > W - 76 && line) {
          lines.push(line);
          line = w;
        } else {
          line = test;
        }
      }
      if (line) lines.push(line);
      const showLines = lines.slice(0, 3);
      const startY = 112 - ((showLines.length - 1) * 34) / 2;
      showLines.forEach((ln, idx) => {
        ctx.fillText(ln, W / 2, startY + idx * 34);
      });
    }

    // 4. Bottom CTA + Channel watermark + Animated Progress Bar
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.font = 'bold 20px "Cairo", "Segoe UI", Tahoma, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('👆 شاهد القصة الكاملة من الرابط أسفل الشاشة', W / 2, H - 72);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.fillRect(28, H - 40, W - 56, 8);
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(28, H - 40, Math.max(0, Math.min(1, progressRatio)) * (W - 56), 8);
  }

  function stopClipperPlayback() {
    if (clipper.rafId) {
      cancelAnimationFrame(clipper.rafId);
      clipper.rafId = null;
    }
    clipper.isPreviewing = false;
    if (el.clipperSourceVideo) {
      el.clipperSourceVideo.pause();
    }
    if (clipper.recorder && clipper.recorder.state === 'recording') {
      clipper.recorder.stop();
    }
    clipper.isRecording = false;
    if (el.clipperStopBtn) el.clipperStopBtn.classList.add('hidden');
    if (el.clipperRenderBtn) el.clipperRenderBtn.disabled = false;
  }

  function applyClipPreset(clip, video) {
    const mainPub = state.publishedMap[video.id];
    el.clipStartInput.value = String(Math.max(0, Number(clip.startSec || 0)));
    el.clipEndInput.value = String(Math.min(Number(clip.startSec || 0) + 58, Number(clip.endSec || 48)));
    el.clipHookInput.value = clip.hookText || '';
    el.clipTitleInput.value = clip.title || `${video.suggestedTitle} #Shorts`;
    el.clipDescInput.value =
      `${clip.hookText || video.suggestedTitle}\n\n` +
      (mainPub && mainPub.youtubeUrl ? `🎬 شاهد الحلقة الكاملة من هنا:\n${mainPub.youtubeUrl}\n\n` : '🎬 شاهد الحلقة الكاملة على القناة 👇\n\n') +
      '#Shorts #نقش #ماذا_لو';
    el.clipScheduleInput.value = computeNextPrimeTimeLocalInput(12);
    if (el.clipperSourceVideo && el.clipperSourceVideo.readyState >= 1) {
      el.clipperSourceVideo.currentTime = Number(el.clipStartInput.value || 0);
    }
    drawClipperFrame(0);
  }

  function openViralClipper(video) {
    stopClipperPlayback();
    clipper.video = video;
    clipper.recordedBlob = null;
    if (clipper.recordedUrl) {
      URL.revokeObjectURL(clipper.recordedUrl);
      clipper.recordedUrl = '';
    }

    el.clipperVideoName.textContent = `${video.suggestedTitle} (${video.name})`;
    el.clipperOutputBox.classList.add('hidden');
    el.clipperUploadProgress.classList.add('hidden');
    el.clipperStatusBox.textContent = 'جاري تحميل دفق الفيديو من Google Drive للقص المباشر...';

    const clips = Array.isArray(video.viralClips) && video.viralClips.length
      ? video.viralClips
      : [
          {
            id: 'default-1',
            label: 'شورت #1 — أول 50 ثانية',
            startSec: 0,
            endSec: 50,
            hookText: video.suggestedTitle,
            title: `${video.suggestedTitle} #Shorts`
          }
        ];

    el.clipperPresets.innerHTML = clips
      .map(
        (c, i) =>
          `<button type="button" class="alt-title-chip" data-clip-preset-idx="${i}">🔥 ${escapeHtml(c.label)} (${formatDuration(c.startSec)} → ${formatDuration(c.endSec)})</button>`
      )
      .join('');

    applyClipPreset(clips[0], video);

    // Load authenticated Range stream from /api/drive/stream
    el.clipperSourceVideo.src = `/api/drive/stream?fileId=${encodeURIComponent(video.id)}`;
    el.clipperSourceVideo.load();
    el.clipperModal.classList.remove('hidden');
  }

  async function runClipperPreviewOrRecord(recordMode) {
    if (!clipper.video) return;
    stopClipperPlayback();

    const startSec = Math.max(0, Number(el.clipStartInput.value || 0));
    let endSec = Math.max(startSec + 5, Number(el.clipEndInput.value || startSec + 45));
    if (endSec - startSec > 59) {
      endSec = startSec + 58;
      el.clipEndInput.value = String(endSec);
    }
    const duration = endSec - startSec;
    const vidEl = el.clipperSourceVideo;

    el.clipperStatusBox.textContent = 'جاري الانتقال إلى ثانية البداية...';
    await new Promise((resolve) => {
      const onSeeked = () => {
        vidEl.removeEventListener('seeked', onSeeked);
        resolve();
      };
      vidEl.addEventListener('seeked', onSeeked);
      vidEl.currentTime = startSec;
      setTimeout(resolve, 2500);
    });

    if (recordMode) {
      if (typeof MediaRecorder === 'undefined') {
        showAlert('متصفحك لا يدعم MediaRecorder للقص المباشر — استخدم Chrome أو Edge.', 'error');
        return;
      }
      const chunks = [];
      const canvasStream = el.clipperCanvas.captureStream(30);
      const tracks = [...canvasStream.getVideoTracks()];

      // Attach audio track from the source video so the Short has crystal-clear narration!
      try {
        if (!clipper.audioCtx) {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          clipper.audioCtx = new AudioCtx();
          clipper.audioSource = clipper.audioCtx.createMediaElementSource(vidEl);
          clipper.audioDest = clipper.audioCtx.createMediaStreamDestination();
          clipper.audioSource.connect(clipper.audioDest);
          clipper.audioSource.connect(clipper.audioCtx.destination);
        }
        if (clipper.audioCtx.state === 'suspended') {
          await clipper.audioCtx.resume();
        }
        clipper.audioDest.stream.getAudioTracks().forEach((t) => tracks.push(t));
      } catch {
        // Fallback: video-only if audio graph is restricted
      }

      const combinedStream = new MediaStream(tracks);
      const preferredMime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) =>
        MediaRecorder.isTypeSupported(m)
      );
      clipper.recorder = new MediaRecorder(
        combinedStream,
        preferredMime ? { mimeType: preferredMime, videoBitsPerSecond: 4500000 } : undefined
      );

      clipper.recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };
      clipper.recorder.onstop = () => {
        const blob = new Blob(chunks, { type: clipper.recorder.mimeType || 'video/webm' });
        clipper.recordedBlob = blob;
        if (clipper.recordedUrl) URL.revokeObjectURL(clipper.recordedUrl);
        clipper.recordedUrl = URL.createObjectURL(blob);
        el.clipperResultVideo.src = clipper.recordedUrl;
        el.clipperDownloadLink.href = clipper.recordedUrl;
        const safeName = (el.clipTitleInput.value || 'viral-short').replace(/[^\u0600-\u06FFa-zA-Z0-9_-]+/g, '-').slice(0, 40);
        el.clipperDownloadLink.download = `${safeName}-9x16.webm`;
        el.clipperOutputBox.classList.remove('hidden');
        const sizeMb = (blob.size / (1024 * 1024)).toFixed(2);
        el.clipperStatusBox.textContent = `✅ تم تجهيز الشورت العمودي 9:16 بنجاح (${sizeMb} MB) — جاهز للرفع المباشر إلى يوتيوب!`;
      };

      clipper.isRecording = true;
      el.clipperRenderBtn.disabled = true;
      el.clipperStopBtn.classList.remove('hidden');
      el.clipperOutputBox.classList.add('hidden');
      clipper.recorder.start(250);
      el.clipperStatusBox.textContent = `🔴 جاري قص وتصيير الشورت 9:16 (${duration} ثانية)...`;
    } else {
      clipper.isPreviewing = true;
      el.clipperStatusBox.textContent = '▶️ معاينة حية للشورت العمودي 9:16...';
    }

    await vidEl.play();

    const tick = () => {
      const elapsed = Math.max(0, vidEl.currentTime - startSec);
      const ratio = duration > 0 ? elapsed / duration : 0;
      drawClipperFrame(ratio);

      if (vidEl.currentTime >= endSec || vidEl.ended) {
        stopClipperPlayback();
        return;
      }
      if (clipper.isRecording || clipper.isPreviewing) {
        clipper.rafId = requestAnimationFrame(tick);
      }
    };
    clipper.rafId = requestAnimationFrame(tick);
  }

  async function uploadClippedShortToYouTube() {
    if (!clipper.recordedBlob || !state.connected) {
      showAlert('قم بقص وتجهيز الشورت أولاً قبل الرفع.', 'error');
      return;
    }

    const blob = clipper.recordedBlob;
    const totalSize = blob.size;
    const mimeType = blob.type && blob.type.startsWith('video/') ? blob.type.split(';')[0] : 'video/webm';
    const title = (el.clipTitleInput.value || 'شورت فيروسي #Shorts').trim();
    const description = (el.clipDescInput.value || `${title}\n#Shorts`).trim();
    const privacyStatus = el.clipPrivacySelect.value || 'private';
    const publishAt = el.clipScheduleInput.value ? new Date(el.clipScheduleInput.value).toISOString() : '';

    el.clipperUploadYtBtn.disabled = true;
    el.clipperUploadProgress.classList.remove('hidden');
    el.clipperUploadBar.style.width = '5%';
    el.clipperUploadText.textContent = 'جاري إنشاء جلسة رفع الشورت على يوتيوب...';
    el.clipperUploadPct.textContent = '5%';

    try {
      const initRes = await apiFetch('/api/upload/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          directUpload: true,
          fileName: 'viral-short-9x16.webm',
          fileSize: totalSize,
          mimeType,
          title,
          description,
          tags: 'Shorts، نقش، ماذا لو، وثائقي قصير',
          privacyStatus,
          publishAt,
          categoryId: '28',
          madeForKids: false,
          language: 'ar'
        })
      });

      const chunkSize = 2 * 1024 * 1024; // 2 MB multiple of 256 KiB (safe for Vercel)
      let offset = 0;
      let videoId = null;

      while (offset < totalSize) {
        const end = Math.min(offset + chunkSize - 1, totalSize - 1);
        const slice = blob.slice(offset, end + 1);
        const resp = await fetch('/api/upload/chunk', {
          method: 'POST',
          headers: authHeaders({
            'Content-Type': 'application/octet-stream',
            'x-upload-uri': initRes.uploadUri,
            'x-start': String(offset),
            'x-end': String(end),
            'x-total-size': String(totalSize),
            'x-mime-type': mimeType
          }),
          body: slice
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);

        const pct = data.done ? 95 : Math.min(92, Math.max(10, data.percent || Math.round(((end + 1) / totalSize) * 90)));
        el.clipperUploadBar.style.width = `${pct}%`;
        el.clipperUploadPct.textContent = `${pct}%`;
        el.clipperUploadText.textContent = `جاري رفع الشورت إلى يوتيوب (${Math.round(((end + 1) / (1024 * 1024)) * 10) / 10} MB)...`;

        if (data.done && data.videoId) {
          videoId = data.videoId;
          break;
        }
        offset = data.nextOffset;
      }

      if (!videoId) throw new Error('لم يرجع يوتيوب معرف الشورت.');

      const completeRes = await apiFetch('/api/upload/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          fileId: '',
          fileName: 'viral-short-9x16.webm',
          fileSize: totalSize,
          title,
          description,
          tags: ['Shorts', 'نقش', 'ماذا لو'],
          privacyStatus: initRes.metadata.status.privacyStatus,
          publishAt: initRes.metadata.status.publishAt || '',
          categoryId: '28',
          addToPlaylist: el.addToPlaylistCheck ? el.addToPlaylistCheck.checked : true,
          playlistTitle: el.playlistTitleInput ? el.playlistTitleInput.value.trim() : '',
          logToSheet: el.logToSheetCheck.checked,
          spreadsheetId: state.health.defaults.SPREADSHEET_ID
        })
      });

      el.clipperUploadBar.style.width = '100%';
      el.clipperUploadPct.textContent = '100%';
      el.clipperUploadText.textContent = '✅ تم نشر الشورت على يوتيوب بنجاح!';
      showAlert(`🚀 تم قص ورفع الشورت «${title}» مباشرة على قناتك في يوتيوب!`, 'success');
      addLog(`⚡ تم قص ورفع شورت 9:16 بنجاح: ${completeRes.youtubeUrl}`, 'success');
    } catch (err) {
      showAlert(`❌ فشل رفع الشورت: ${err.message}`, 'error');
      addLog(`❌ فشل رفع الشورت: ${err.message}`, 'error');
      el.clipperUploadText.textContent = `❌ ${err.message}`;
    } finally {
      el.clipperUploadYtBtn.disabled = false;
    }
  }

  function bindClipperEvents() {
    if (!el.clipperModal) return;
    el.closeClipperBtn.addEventListener('click', () => {
      stopClipperPlayback();
      el.clipperModal.classList.add('hidden');
    });
    el.clipperPresets.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-clip-preset-idx]');
      if (!btn || !clipper.video) return;
      const idx = Number(btn.dataset.clipPresetIdx);
      const clips = clipper.video.viralClips || [];
      if (clips[idx]) applyClipPreset(clips[idx], clipper.video);
    });
    el.clipperSourceVideo.addEventListener('loadeddata', () => {
      el.clipperStatusBox.textContent = '✅ الفيديو جاهز! اضغط «معاينة» أو «قص وتجهيز الشورت (9:16)».';
      el.clipperSourceVideo.currentTime = Number(el.clipStartInput.value || 0);
      drawClipperFrame(0);
    });
    el.clipperSourceVideo.addEventListener('seeked', () => drawClipperFrame(0));
    el.clipHookInput.addEventListener('input', () => drawClipperFrame(0));
    el.clipperPreviewBtn.addEventListener('click', () => runClipperPreviewOrRecord(false));
    el.clipperRenderBtn.addEventListener('click', () => runClipperPreviewOrRecord(true));
    el.clipperStopBtn.addEventListener('click', stopClipperPlayback);
    el.clipperUploadYtBtn.addEventListener('click', uploadClippedShortToYouTube);
  }

  init();
})();
