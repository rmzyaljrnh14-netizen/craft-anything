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
    currentFolderId: '',
    currentPreset: 'queue',
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
    logToSheetCheck: document.getElementById('logToSheetCheck'),
    activityLog: document.getElementById('activityLog'),
    clearLogsBtn: document.getElementById('clearLogsBtn')
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
      chunkSizeMb: Number(el.chunkSizeSelect.value || 8),
      moveToPublished: el.moveToPublishedCheck.checked,
      attachThumbnail: el.attachThumbnailCheck.checked,
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
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(data.error || `HTTP ${resp.status}`);
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

      state.currentFolderId = state.health.defaults.QUEUE_FOLDER_ID;
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
      await loadVideos(state.currentFolderId);
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

  async function loadVideos(folderId) {
    if (!state.connected) return;
    state.currentFolderId = folderId;
    el.refreshVideosBtn.disabled = true;
    el.videosList.innerHTML = '<div class="empty-state"><p class="muted">جاري قراءة الفيديوهات من Google Drive...</p></div>';

    try {
      const data = await apiFetch(`/api/drive/videos?folderId=${encodeURIComponent(folderId)}`);
      state.videos = data.videos || [];
      state.folders = data.folders || [];
      renderSubfolders();
      renderVideos();
      addLog(`تم تحميل ${state.videos.length} فيديو من Google Drive.`, 'info');
    } catch (err) {
      el.videosList.innerHTML = `<div class="empty-state"><p style="color:#fca5a5;">${escapeHtml(err.message)}</p></div>`;
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

  function getVideoMeta(video) {
    if (!state.videoEdits[video.id]) {
      state.videoEdits[video.id] = {
        title: video.suggestedTitle,
        description: '',
        tags: '',
        privacyStatus: el.defaultPrivacySelect.value || 'private',
        publishAt: '',
        categoryId: '22',
        madeForKids: false,
        expanded: false
      };
    }
    return state.videoEdits[video.id];
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

        const thumbBadge = v.matchingThumbnail
          ? `<span class="badge badge-thumb">🖼️ صورة مصغرة: ${escapeHtml(v.matchingThumbnail.name)}</span>`
          : '';

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
            <div class="field full">
              <label>عنوان الفيديو على يوتيوب (بحد أقصى 100 حرف)</label>
              <input type="text" data-field="title" maxlength="100" value="${escapeHtml(meta.title)}" />
            </div>
            <div class="field full">
              <label>الوصف</label>
              <textarea data-field="description" placeholder="اكتب وصف الفيديو هنا...">${escapeHtml(meta.description)}</textarea>
            </div>
            <div class="field">
              <label>الوسوم (مفصولة بفاصلة)</label>
              <input type="text" data-field="tags" placeholder="تعليم، ثقافة، فيديو" value="${escapeHtml(meta.tags)}" />
            </div>
            <div class="field">
              <label>الخصوصية</label>
              <select data-field="privacyStatus">
                <option value="private" ${meta.privacyStatus === 'private' ? 'selected' : ''}>خاص (Private)</option>
                <option value="unlisted" ${meta.privacyStatus === 'unlisted' ? 'selected' : ''}>غير مدرج (Unlisted)</option>
                <option value="public" ${meta.privacyStatus === 'public' ? 'selected' : ''}>عام (Public)</option>
              </select>
            </div>
            <div class="field">
              <label>جدولة النشر (اختياري)</label>
              <input type="datetime-local" data-field="publishAt" value="${escapeHtml(meta.publishAt)}" />
            </div>
            <div class="field">
              <label>الفئة</label>
              <select data-field="categoryId">
                <option value="22" ${meta.categoryId === '22' ? 'selected' : ''}>أشخاص ومدونات (22)</option>
                <option value="27" ${meta.categoryId === '27' ? 'selected' : ''}>تعليم (27)</option>
                <option value="24" ${meta.categoryId === '24' ? 'selected' : ''}>ترفيه (24)</option>
                <option value="28" ${meta.categoryId === '28' ? 'selected' : ''}>علوم وتقنية (28)</option>
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
                <span>📁 ${escapeHtml(v.name)}</span>
                <span>💾 ${v.sizeMb} MB</span>
                <a href="${escapeHtml(v.webViewLink)}" target="_blank" rel="noopener" style="color:#7dd3fc;text-decoration:none;">عرض في Drive ↗</a>
              </div>
              <div class="video-meta-line">
                ${badgeHtml}
                ${thumbBadge}
              </div>
            </div>
            <div class="video-actions">
              <button class="btn btn-ghost btn-xs" type="button" data-toggle-edit="${escapeHtml(v.id)}">
                ${meta.expanded ? '▲ إغلاق التفاصيل' : '✏️ تعديل التفاصيل'}
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
    const chunkSizeMb = Number(el.chunkSizeSelect.value || 8);

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

      // 2. Stream chunk-by-chunk Drive -> Server -> YouTube
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

        const chunkRes = await apiFetch('/api/upload/chunk', {
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
          matchingThumbnail: video.matchingThumbnail,
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

      let targetId = state.health.defaults.QUEUE_FOLDER_ID;
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
      el.logToSheetCheck
    ].forEach((node) => {
      node.addEventListener('change', () => {
        saveSettings();
        if (node === el.intervalSelect && state.autoEnabled) {
          startAutoPublisher();
        }
      });
    });

    el.clearLogsBtn.addEventListener('click', () => {
      el.activityLog.innerHTML = '';
    });
  }

  init();
})();
