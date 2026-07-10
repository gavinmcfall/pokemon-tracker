/* Living Dex — production front-end implementing the Claude Design deliverable
   "Living Dex Tracker.dc.html". The DC prototype's logic (tileVars, chipBase,
   filtering, progress mosaic, theme cycle) is ported to dependency-free JS.
   Data and catch state come from the app's own API, not mock data/localStorage:
     GET  /api/entries         -> entries with embedded { status }
     POST /api/status          -> persist a catch toggle
   The view is generation-scoped: header counts, progress mosaic and status
   chips reflect the selected generation (the region shown beside the wordmark). */
'use strict';

const TYPE_ORDER = ['normal','fire','water','electric','grass','ice','fighting','poison','ground','flying','psychic','bug','rock','ghost','dragon','dark','steel','fairy'];
const TYPE_COLORS = {
  normal:'#A8A77A', fire:'#EE8130', water:'#6390F0', electric:'#F7D02C',
  grass:'#7AC74C', ice:'#96D9D6', fighting:'#C22E28', poison:'#A33EA1',
  ground:'#E2BF65', flying:'#A98FF3', psychic:'#F95587', bug:'#A6B91A',
  rock:'#B6A136', ghost:'#735797', dragon:'#6F35FC', dark:'#705746',
  steel:'#B7B7CE', fairy:'#D685AD',
};
const ROMAN = ['I','II','III','IV','V','VI','VII','VIII','IX'];
const REGIONS = ['Kanto','Johto','Hoenn','Sinnoh','Unova','Kalos','Alola','Galar','Paldea'];
const TINT = 18; // % — matches the design's default tintStrength

const LD = (l, d) => `light-dark(${l}, ${d})`;
const T = {
  page: LD('#EEF1F4', '#14171C'),
  card: LD('#FFFFFF', '#1B2027'),
  raised: LD('#F6F8FA', '#232A33'),
  border: LD('#D3D9E0', '#2E3742'),
  text: LD('#1B1F24', '#E7ECF2'),
  muted: LD('#5A6472', '#8B94A4'),
  red: LD('#E3350D', '#F4503B'),
  gray: LD('#C6CDD5', '#3A4450'),
};

const THEME_KEY = 'livingdex-theme';
const GEN_KEY = 'livingdex-gen';

const state = {
  loading: true,
  entries: [],
  caught: new Set(),
  gensAvailable: new Set(),
  gen: 1,
  status: 'all',
  query: '',
  types: [],
  theme: 'auto',
};

const el = {};
const $ = (id) => document.getElementById(id);

function applyStyles(node, styles) {
  for (const [k, v] of Object.entries(styles)) {
    if (k.startsWith('--')) node.style.setProperty(k, String(v));
    else node.style[k] = String(v);
  }
}

/* ---------- API ---------- */
async function api(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).error ?? detail; } catch { /* not json */ }
    throw new Error(detail);
  }
  return res.json();
}

let toastTimer;
function toast(message, isError) {
  el.toast.textContent = message;
  el.toast.classList.toggle('error', Boolean(isError));
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 6000);
}

/* ---------- theme ---------- */
function syncTheme() {
  document.documentElement.style.colorScheme = state.theme === 'auto' ? 'light dark' : state.theme;
  el.themeBtn.textContent = state.theme === 'auto' ? '◐ Auto' : state.theme === 'light' ? '○ Light' : '● Dark';
  el.themeBtn.title = `Theme: ${state.theme}${state.theme === 'auto' ? ' (follows system)' : ''} — click to cycle`;
}
function cycleTheme() {
  state.theme = state.theme === 'auto' ? 'light' : state.theme === 'light' ? 'dark' : 'auto';
  try { localStorage.setItem(THEME_KEY, state.theme); } catch { /* ignore */ }
  syncTheme();
}

/* ---------- style helpers (ported from the design) ---------- */
function chipBase() {
  return {
    display: 'inline-flex', alignItems: 'center', gap: '7px',
    minHeight: '40px', padding: '0 14px', borderRadius: '999px',
    fontFamily: "'Atkinson Hyperlegible', system-ui, sans-serif",
    fontSize: '13px', fontWeight: '700', cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  };
}

function tileStyle(e, isCaught) {
  const c1 = TYPE_COLORS[e.types[0]];
  const c2 = e.types[1] ? TYPE_COLORS[e.types[1]] : null;
  const base = {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
    padding: '10px 8px 12px', borderRadius: '14px', border: 'none',
    cursor: 'pointer', width: '100%', minHeight: '44px', font: 'inherit',
    textAlign: 'center', WebkitTapHighlightColor: 'transparent',
    transition: 'background 0.25s ease, box-shadow 0.25s ease',
  };
  let dyn;
  if (isCaught) {
    const fill = `color-mix(in oklab, ${c1} ${TINT}%, ${T.card})`;
    const ring = `inset 0 0 0 1.5px color-mix(in oklab, ${c1} 45%, ${T.border})` + (c2 ? `, inset 0 -3px 0 0 ${c2}` : '');
    dyn = {
      background: fill,
      boxShadow: ring,
      '--fill-hover': `color-mix(in oklab, ${c1} ${TINT + 8}%, ${T.card})`,
      '--ring-hover': `inset 0 0 0 2px color-mix(in oklab, ${c1} 70%, ${T.border})` + (c2 ? `, inset 0 -3px 0 0 ${c2}` : ''),
      '--num': `color-mix(in oklab, ${c1} 55%, ${T.text})`,
      '--name': T.text,
      '--sf': 'none',
      '--dot1': c1,
      '--dot2': c2 || 'transparent',
    };
  } else {
    dyn = {
      background: T.raised,
      boxShadow: `inset 0 0 0 1.5px ${T.border}`,
      '--fill-hover': T.card,
      '--ring-hover': `inset 0 0 0 2px color-mix(in oklab, ${c1} 55%, ${T.border})`,
      '--num': T.muted,
      '--name': T.muted,
      '--sf': 'grayscale(1) opacity(0.5)',
      '--dot1': T.gray,
      '--dot2': c2 ? T.gray : 'transparent',
    };
  }
  return { ...base, ...dyn };
}

/* ---------- selectors ---------- */
function genEntries() {
  return state.entries.filter((e) => e.generation === state.gen);
}
function matchesFilters(e) {
  if (state.types.length && !e.types.some((t) => state.types.includes(t))) return false;
  const isC = state.caught.has(e.entryKey);
  if (state.status === 'needed' && isC) return false;
  if (state.status === 'caught' && !isC) return false;
  const q = state.query.trim().toLowerCase();
  if (q) {
    const qNum = /^#?\d+$/.test(q) ? parseInt(q.replace('#', ''), 10) : null;
    if (qNum !== null) { if (e.dex !== qNum) return false; }
    else if (!(e.name.toLowerCase().includes(q) || (e.formLabel ?? '').toLowerCase().includes(q))) return false;
  }
  return true;
}
function visibleEntries() {
  return genEntries().filter(matchesFilters);
}

/* ---------- rendering ---------- */
function renderChrome() {
  const scoped = genEntries();
  const total = scoped.length;
  const caughtCount = scoped.filter((e) => state.caught.has(e.entryKey)).length;
  const pct = total ? Math.round((caughtCount / total) * 100) : 0;

  el.region.textContent = REGIONS[state.gen - 1] ?? `Gen ${ROMAN[state.gen - 1] ?? state.gen}`;
  el.caught.textContent = String(caughtCount);
  el.total.textContent = `/ ${total}`;
  el.pct.textContent = `${pct}%`;
  el.progress.setAttribute('aria-label', `${caughtCount} of ${total} caught — ${pct}%`);
  el.progress.title = `${caughtCount} of ${total} caught — ${pct}%`;

  // progress mosaic — one segment per primary type that has returned to the dex
  el.progress.replaceChildren();
  if (total) {
    for (const t of TYPE_ORDER) {
      const n = scoped.filter((e) => e.types[0] === t && state.caught.has(e.entryKey)).length;
      if (n > 0) {
        const seg = document.createElement('span');
        applyStyles(seg, {
          flex: `0 0 ${((n / total) * 100).toFixed(3)}%`,
          background: TYPE_COLORS[t], height: '100%', display: 'block',
        });
        el.progress.append(seg);
      }
    }
  }

  renderGenChips();
  renderStatusChips(caughtCount, total);
  renderTypeChips();
}

function renderGenChips() {
  el.genChips.replaceChildren();
  ROMAN.forEach((r, i) => {
    const n = i + 1;
    const active = state.gen === n;
    const hasData = state.gensAvailable.has(n);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = r;
    btn.dataset.gen = String(n);
    btn.setAttribute('aria-pressed', String(active));
    btn.title = hasData ? `Generation ${r} — ${REGIONS[i] ?? ''}`.trim() : `Generation ${r} — no data`;
    if (!hasData) btn.disabled = true;
    applyStyles(btn, {
      ...chipBase(),
      minWidth: '44px', justifyContent: 'center', padding: '0 10px',
      fontFamily: "'IBM Plex Mono', monospace", fontSize: '12.5px', fontWeight: '600',
      background: active ? T.text : T.card,
      border: `1.5px solid ${active ? T.text : T.border}`,
      color: active ? T.page : hasData ? T.text : T.muted,
      opacity: hasData || active ? '1' : '0.55',
      cursor: hasData ? 'pointer' : 'not-allowed',
    });
    if (hasData) btn.addEventListener('click', () => setGen(n));
    el.genChips.append(btn);
  });
}

function renderStatusChips(caughtCount, total) {
  const needed = total - caughtCount;
  const options = [
    { key: 'all', label: 'All' },
    { key: 'needed', label: `Needed ${needed}` },
    { key: 'caught', label: `Caught ${caughtCount}` },
  ];
  el.statusChips.replaceChildren();
  for (const o of options) {
    const active = state.status === o.key;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = o.label;
    btn.dataset.status = o.key;
    btn.setAttribute('aria-pressed', String(active));
    applyStyles(btn, {
      ...chipBase(),
      minHeight: '38px', padding: '0 14px',
      background: active ? T.card : 'transparent',
      border: active ? `1.5px solid ${T.border}` : '1.5px solid transparent',
      color: active ? T.text : T.muted,
      boxShadow: active ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
    });
    btn.addEventListener('click', () => { state.status = o.key; render(); });
    el.statusChips.append(btn);
  }
}

function renderTypeChips() {
  el.typeChips.replaceChildren();
  for (const t of TYPE_ORDER) {
    const c = TYPE_COLORS[t];
    const sel = state.types.includes(t);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.type = t;
    btn.setAttribute('aria-pressed', String(sel));
    applyStyles(btn, {
      ...chipBase(),
      fontSize: '12.5px',
      background: sel ? `color-mix(in oklab, ${c} 22%, ${T.card})` : T.card,
      border: `1.5px solid ${sel ? `color-mix(in oklab, ${c} 65%, ${T.border})` : T.border}`,
      color: sel ? T.text : T.muted,
    });
    const dot = document.createElement('span');
    applyStyles(dot, { width: '9px', height: '9px', borderRadius: '50%', background: c, flexShrink: 0 });
    btn.append(dot, document.createTextNode(t.charAt(0).toUpperCase() + t.slice(1)));
    btn.addEventListener('click', () => {
      state.types = sel ? state.types.filter((x) => x !== t) : [...state.types, t];
      render();
    });
    el.typeChips.append(btn);
  }
  if (state.types.length) {
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'clear-types';
    clear.textContent = 'clear types';
    clear.addEventListener('click', () => { state.types = []; render(); });
    el.typeChips.append(clear);
  }
}

function tileMarkup(e) {
  const isC = state.caught.has(e.entryKey);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.entryKey = e.entryKey;
  btn.setAttribute('aria-pressed', String(isC));
  btn.title = `${e.name}${e.formLabel ? ' — ' + e.formLabel : ''} · ${e.types.join(' / ')} · ${isC ? 'caught — tap to unmark' : 'needed — tap to mark caught'}`;
  applyStyles(btn, tileStyle(e, isC));

  const head = document.createElement('span');
  applyStyles(head, { display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: '4px' });
  const num = document.createElement('span');
  applyStyles(num, { display: 'inline-flex', alignItems: 'center', gap: '5px', fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px', fontWeight: '600', letterSpacing: '0.05em', color: 'var(--num)' });
  num.textContent = '#' + String(e.dex).padStart(4, '0');
  for (const dotVar of ['--dot1', '--dot2']) {
    const d = document.createElement('span');
    applyStyles(d, { width: '7px', height: '7px', borderRadius: '50%', background: `var(${dotVar})`, flexShrink: 0 });
    num.append(d);
  }
  const gender = document.createElement('span');
  applyStyles(gender, { fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', fontWeight: '600', color: 'var(--num)' });
  gender.textContent = e.gender === 'male' ? '♂' : e.gender === 'female' ? '♀' : '';
  head.append(num, gender);

  const img = document.createElement('img');
  img.src = e.spriteUrl;
  img.alt = '';
  img.width = 68; img.height = 68; img.loading = 'lazy'; img.draggable = false;
  applyStyles(img, { filter: 'var(--sf)', transition: 'filter 0.25s ease', imageRendering: 'pixelated', margin: '2px 0' });

  const name = document.createElement('span');
  applyStyles(name, { fontSize: '13px', fontWeight: '700', color: 'var(--name)', lineHeight: '1.2', textAlign: 'center' });
  name.textContent = e.name;

  const form = document.createElement('span');
  applyStyles(form, { fontSize: '10.5px', fontWeight: '400', color: 'var(--name)', opacity: '0.75', lineHeight: '1.15', textAlign: 'center' });
  form.textContent = e.formLabel ?? '';

  btn.append(head, img, name, form);
  btn.addEventListener('click', () => toggle(e.entryKey));
  return btn;
}

function restyleTile(entryKey) {
  const btn = el.grid.querySelector(`button[data-entry-key="${cssEscape(entryKey)}"]`);
  const e = state.entries.find((x) => x.entryKey === entryKey);
  if (!btn || !e) return;
  const isC = state.caught.has(entryKey);
  applyStyles(btn, tileStyle(e, isC));
  btn.setAttribute('aria-pressed', String(isC));
  btn.title = `${e.name}${e.formLabel ? ' — ' + e.formLabel : ''} · ${e.types.join(' / ')} · ${isC ? 'caught — tap to unmark' : 'needed — tap to mark caught'}`;
  if (isC) {
    btn.style.animation = 'dex-settle 0.45s cubic-bezier(0.34, 1.4, 0.64, 1)';
    setTimeout(() => { btn.style.animation = ''; }, 550);
  }
}

function cssEscape(value) {
  return window.CSS && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}

let lastVisibleKeys = '';
function renderGrid() {
  const visible = visibleEntries();
  lastVisibleKeys = visible.map((e) => e.entryKey).join(',');

  const showLoading = state.loading;
  const showEmpty = !state.loading && visible.length === 0;
  const showGrid = !state.loading && visible.length > 0;
  el.loading.hidden = !showLoading;
  el.empty.hidden = !showEmpty;
  el.results.hidden = !showGrid;

  if (showEmpty) {
    const q = state.query.trim();
    const parts = [];
    if (q) parts.push(`search “${q}”`);
    if (state.types.length) parts.push(`${state.types.length} type filter${state.types.length > 1 ? 's' : ''}`);
    if (state.status !== 'all') parts.push(`status “${state.status}”`);
    el.emptyTitle.textContent = genEntries().length === 0 ? `Nothing in Gen ${ROMAN[state.gen - 1]} yet` : 'No entries match';
    el.emptyBody.textContent = genEntries().length === 0
      ? 'No entries for this generation have been seeded yet.'
      : (parts.length ? `Your ${parts.join(' + ')} filtered everything out. ` : '') + 'Clear the filters to see the full dex again.';
    el.emptyAction.textContent = 'Clear filters';
    return;
  }

  if (showGrid) {
    const filterCount = (state.status !== 'all' ? 1 : 0) + state.types.length + (state.query.trim() ? 1 : 0);
    el.resultLabel.textContent = `${visible.length} ${visible.length === 1 ? 'ENTRY' : 'ENTRIES'}` +
      (filterCount ? ` · ${filterCount} FILTER${filterCount > 1 ? 'S' : ''} ACTIVE` : '');
    const frag = document.createDocumentFragment();
    for (const e of visible) frag.append(tileMarkup(e));
    el.grid.replaceChildren(frag);
  }
}

function render() {
  renderChrome();
  renderGrid();
}

async function toggle(entryKey) {
  const wasCaught = state.caught.has(entryKey);
  const next = !wasCaught;
  // optimistic
  if (next) state.caught.add(entryKey); else state.caught.delete(entryKey);

  // If the toggle changes which tiles are visible (a status filter is active),
  // rebuild the grid the way the design does; otherwise restyle in place so
  // keyboard focus is preserved.
  const nowKeys = visibleEntries().map((e) => e.entryKey).join(',');
  if (nowKeys === lastVisibleKeys) { restyleTile(entryKey); renderChrome(); }
  else render();

  try {
    const status = await api('/api/status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entryKey, caught: next }),
    });
    const e = state.entries.find((x) => x.entryKey === entryKey);
    if (e) e.status = status;
  } catch (err) {
    // revert
    if (wasCaught) state.caught.add(entryKey); else state.caught.delete(entryKey);
    render();
    toast(`Couldn't save: ${err.message}`, true);
  }
}

function setGen(n) {
  state.gen = n;
  try { localStorage.setItem(GEN_KEY, String(n)); } catch { /* ignore */ }
  render();
}

function ingest(entries) {
  state.entries = entries;
  state.caught = new Set(entries.filter((e) => e.status && e.status.caught).map((e) => e.entryKey));
  state.gensAvailable = new Set(entries.map((e) => e.generation));
  if (!state.gensAvailable.has(state.gen)) {
    state.gen = Math.min(...state.gensAvailable) || 1;
  }
}

async function reload() {
  const entries = await api('/api/entries');
  ingest(entries);
}

/* ---------- import ---------- */
async function onImport(file) {
  const form = new FormData();
  form.append('file', file);
  try {
    const result = await api('/api/import', { method: 'POST', body: form });
    const skipped = result.unmatched.length
      ? ` — ${result.unmatched.length} unmatched (first: line ${result.unmatched[0].line}, ${result.unmatched[0].reason})`
      : '';
    await reload();
    render();
    toast(`Imported ${result.matched} matched, ${result.updated} updated${skipped}`, result.unmatched.length > 0);
  } catch (err) {
    toast(`Import failed: ${err.message}`, true);
  }
}

/* ---------- init ---------- */
function init() {
  el.region = $('region'); el.caught = $('caught'); el.total = $('total'); el.pct = $('pct');
  el.progress = $('progress'); el.genChips = $('gen-chips'); el.statusChips = $('status-chips');
  el.typeChips = $('type-chips'); el.search = $('search'); el.themeBtn = $('theme-btn');
  el.loading = $('loading'); el.skeleton = $('skeleton'); el.empty = $('empty');
  el.emptyTitle = $('empty-title'); el.emptyBody = $('empty-body'); el.emptyAction = $('empty-action');
  el.results = $('results'); el.resultLabel = $('result-label'); el.grid = $('grid');
  el.importFile = $('import-file'); el.toast = $('toast');

  try {
    const savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme === 'auto' || savedTheme === 'light' || savedTheme === 'dark') state.theme = savedTheme;
    const savedGen = parseInt(localStorage.getItem(GEN_KEY) ?? '', 10);
    if (Number.isInteger(savedGen) && savedGen >= 1 && savedGen <= 9) state.gen = savedGen;
  } catch { /* ignore */ }
  syncTheme();

  // skeleton cells for the loading state
  const sk = document.createDocumentFragment();
  for (let i = 0; i < 24; i++) sk.append(document.createElement('div'));
  el.skeleton.replaceChildren(sk);

  el.themeBtn.addEventListener('click', cycleTheme);
  el.emptyAction.addEventListener('click', () => {
    state.status = 'all'; state.query = ''; state.types = []; el.search.value = ''; render();
  });
  let searchTimer;
  el.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.query = el.search.value; render(); }, 200);
  });
  el.importFile.addEventListener('change', () => {
    const file = el.importFile.files && el.importFile.files[0];
    if (file) onImport(file);
    el.importFile.value = '';
  });

  // initial loading view
  state.loading = true;
  el.loading.hidden = false;
  el.results.hidden = true;
  el.empty.hidden = true;

  reload()
    .then(() => { state.loading = false; render(); })
    .catch((err) => {
      state.loading = false;
      el.loading.hidden = true;
      toast(`Failed to load: ${err.message}`, true);
    });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
