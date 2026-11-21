/* Client-side only. Never visit a listing on behalf of the reader. */
'use strict';
(() => {
  const el = id => document.getElementById(id);
  const sites = Array.from(el('cards').children, card => {
    const name = card.querySelector('.name').textContent;
    const domain = card.querySelector('.domain').textContent;
    return {
      card, name, id: Number(card.dataset.id),
      search: `${name} ${domain}`.toLowerCase(),
      button: card.querySelector('.save'),
    };
  });
  const known = new Set(sites.map(site => site.id));
  const saved = new Set();
  const key = 'mirsad.directory.saved.v1';
  let store;
  try {
    store = window.sessionStorage;
    const raw = store.getItem(key);
    if (raw && raw.length <= 4096) {
      const ids = JSON.parse(raw);
      if (Array.isArray(ids)) {
        for (const id of ids) if (known.has(id)) saved.add(id);
      }
    }
  } catch {
    // A disabled store or a damaged entry should never disable browsing.
    el('memory').textContent = 'إذا تعذّر حفظ اختياراتك في التبويب، تبقى في ذاكرة الصفحة.';
  }

  function remember() {
    try {
      if (saved.size) store.setItem(key, JSON.stringify([...saved]));
      else store.removeItem(key);
    } catch {
      el('memory').textContent = 'تعذّر حفظ الاختيارات في التبويب. القائمة الحالية في الذاكرة فقط.';
    }
  }

  function matches(site, scope) {
    const d = site.card.dataset;
    switch (scope) {
      case 'all': return true;
      case 'saved': return saved.has(site.id);
      case 'reviewed': return d.reviewed === '1';
      case 'hold': return d.hold === '1';
      default: return d.signin === scope || d.mode === scope;
    }
  }

  function filter() {
    const q = el('search').value.trim().toLowerCase();
    const scope = el('scope').value;
    let shown = 0;
    for (const site of sites) {
      const visible = matches(site, scope) && site.search.includes(q);
      site.card.hidden = !visible;
      if (visible) shown++;
    }
    el('results').textContent = `المواقع الظاهرة: ${shown} من ${sites.length} · قائمتي: ${saved.size}`;
    el('zero').hidden = shown > 0;
  }

  function updateButton(site) {
    const on = saved.has(site.id);
    site.button.setAttribute('aria-pressed', String(on));
    site.button.textContent = on ? 'محفوظ ✓' : 'حفظ في قائمتي';
    site.button.setAttribute('aria-label', on ? `إزالة ${site.name} من قائمتي` : `حفظ ${site.name} في قائمتي`);
    site.button.hidden = false;
  }
  for (const site of sites) {
    updateButton(site);
    site.button.addEventListener('click', () => {
      if (saved.has(site.id)) saved.delete(site.id);
      else saved.add(site.id);
      remember();
      updateButton(site);
      filter();
      if (site.card.hidden) el('scope').focus();
    });
  }

  function reset() {
    el('scope').value = 'all';
    el('search').value = '';
    filter();
  }
  el('clear').addEventListener('click', reset);
  el('scope').addEventListener('change', filter);
  el('search').addEventListener('input', filter);
  // A guide link can still reveal a card hidden by a previous filter.
  for (const link of document.querySelectorAll('a[href^="#site-"]')) {
    link.addEventListener('click', () => { if (el(link.hash.slice(1))?.hidden) reset(); });
  }
  function updateSourceLink() {
    const coin = el('coin').value;
    if (/^[A-Z]{2,8}$/.test(coin)) {
      el('source-link').href = 'https://faucetpay.io/earn/faucets?category=1&coin=' + coin.toLowerCase();
    }
  }
  el('coin').addEventListener('change', updateSourceLink);
  updateSourceLink();
  el('tools').hidden = false;
  el('coin-box').hidden = false;
  reset();
})();
