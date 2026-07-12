/* Living Dex — production front-end implementing the Claude Design deliverable
   "Living Dex Tracker v2". The v1 grid plus a per-entry detail sheet (My Catch
   editor + Obtainability zone) and obtainability filters. Wired to the app's
   own API — catch + metadata are server-backed:
     GET  /api/entries   -> entries with embedded { status }
     POST /api/status    -> persist caught + gameOrigin/method/notes (patch-style)
   The obtainability layer reads enrichment fields (availability[], gmaxCapable,
   shinyLockedIn, …) that the API does not yet return; it stays hidden until it
   does. View is generation-scoped (header counts/region/mosaic follow the gen). */
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
const TINT = 18;
const PLATFORM_ORDER = ['gb','gbc','gba','ds','3ds','switch','switch2','mobile'];
const PLATFORM_LABELS = { gb:'GAME BOY', gbc:'GAME BOY COLOR', gba:'GAME BOY ADVANCE', ds:'NINTENDO DS', '3ds':'NINTENDO 3DS', switch:'SWITCH', switch2:'SWITCH 2', mobile:'MOBILE' };
const EMU_SUGGESTIONS = ['emu:FireRed','emu:LeafGreen','emu:HeartGold','emu:SoulSilver','emu:Emerald','emu:Platinum'];
const METHOD_FALLBACK = ['caught','bred','hatched','traded','evolved','gift','transferred'];

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
  gensAvailable: new Set(),
  gen: 1,
  status: 'all',
  query: '',
  types: [],
  obtain: { switch: false, shiny: false, gmax: false, tera: false },
  gameFilter: '',
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
function elem(tag, styles, text) {
  const n = document.createElement(tag);
  if (styles) applyStyles(n, styles);
  if (text !== undefined) n.textContent = text;
  return n;
}

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

/* ---------- style helpers ---------- */
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
    textAlign: 'center', WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation',
    transition: 'background 0.25s ease, box-shadow 0.25s ease',
  };
  let dyn;
  if (isCaught) {
    const fill = `color-mix(in oklab, ${c1} ${TINT}%, ${T.card})`;
    const ring = `inset 0 0 0 1.5px color-mix(in oklab, ${c1} 45%, ${T.border})` + (c2 ? `, inset 0 -3px 0 0 ${c2}` : '');
    dyn = {
      background: fill, boxShadow: ring,
      '--fill-hover': `color-mix(in oklab, ${c1} ${TINT + 8}%, ${T.card})`,
      '--ring-hover': `inset 0 0 0 2px color-mix(in oklab, ${c1} 70%, ${T.border})` + (c2 ? `, inset 0 -3px 0 0 ${c2}` : ''),
      '--num': `color-mix(in oklab, ${c1} 55%, ${T.text})`,
      '--name': T.text, '--sf': 'none', '--dot1': c1, '--dot2': c2 || 'transparent',
    };
  } else {
    dyn = {
      background: T.raised, boxShadow: `inset 0 0 0 1.5px ${T.border}`,
      '--fill-hover': T.card,
      '--ring-hover': `inset 0 0 0 2px color-mix(in oklab, ${c1} 55%, ${T.border})`,
      '--num': T.muted, '--name': T.muted, '--sf': 'grayscale(1) opacity(0.5)',
      '--dot1': T.gray, '--dot2': c2 ? T.gray : 'transparent',
    };
  }
  return { ...base, ...dyn };
}

const genderMark = (g) => (g === 'male' ? '♂' : g === 'female' ? '♀' : '');
const isCaught = (e) => Boolean(e.status && e.status.caught);
const hasEnrichment = (e) => Array.isArray(e.availability);
function enrichmentPresent() { return state.entries.some(hasEnrichment); }

/* ---------- selectors ---------- */
function genEntries() { return state.entries.filter((e) => e.generation === state.gen); }
function matchesFilters(e) {
  if (state.types.length && !e.types.some((t) => state.types.includes(t))) return false;
  const c = isCaught(e);
  if (state.status === 'needed' && c) return false;
  if (state.status === 'caught' && !c) return false;
  const ob = state.obtain;
  if (ob.switch && !e.catchableOnSwitch) return false;
  if (ob.shiny && !e.shinyLegalSomewhere) return false;
  if (ob.gmax && !e.gmaxCapable) return false;
  if (ob.tera && !e.teraAvailable) return false;
  if (state.gameFilter && !(hasEnrichment(e) && e.availability.some((a) => a.gameId === state.gameFilter))) return false;
  const q = state.query.trim().toLowerCase();
  if (q) {
    const qNum = /^#?\d+$/.test(q) ? parseInt(q.replace('#', ''), 10) : null;
    if (qNum !== null) { if (e.dex !== qNum) return false; }
    else if (!(e.name.toLowerCase().includes(q) || (e.formLabel ?? '').toLowerCase().includes(q))) return false;
  }
  return true;
}
function visibleEntries() { return genEntries().filter(matchesFilters); }
function obtainActiveCount() {
  return Object.values(state.obtain).filter(Boolean).length + (state.gameFilter ? 1 : 0);
}

/* ---------- chrome ---------- */
function renderChrome() {
  const scoped = genEntries();
  const total = scoped.length;
  const caughtCount = scoped.filter(isCaught).length;
  const pct = total ? Math.round((caughtCount / total) * 100) : 0;

  el.region.textContent = REGIONS[state.gen - 1] ?? `Gen ${ROMAN[state.gen - 1] ?? state.gen}`;
  el.caught.textContent = String(caughtCount);
  el.total.textContent = `/ ${total}`;
  el.pct.textContent = `${pct}%`;
  el.progress.setAttribute('aria-label', `${caughtCount} of ${total} caught — ${pct}%`);
  el.progress.title = `${caughtCount} of ${total} caught — ${pct}%`;

  el.progress.replaceChildren();
  if (total) {
    for (const t of TYPE_ORDER) {
      const n = scoped.filter((e) => e.types[0] === t && isCaught(e)).length;
      if (n > 0) {
        const seg = elem('span', { flex: `0 0 ${((n / total) * 100).toFixed(3)}%`, background: TYPE_COLORS[t], height: '100%', display: 'block' });
        el.progress.append(seg);
      }
    }
  }

  renderGenChips();
  renderStatusChips(caughtCount, total);
  renderTypeChips();
  renderObtain();
}

function renderGenChips() {
  el.genChips.replaceChildren();
  ROMAN.forEach((r, i) => {
    const n = i + 1;
    const active = state.gen === n;
    const hasData = state.gensAvailable.has(n);
    const btn = elem('button', {
      ...chipBase(), minWidth: '44px', justifyContent: 'center', padding: '0 10px',
      fontFamily: "'IBM Plex Mono', monospace", fontSize: '12.5px', fontWeight: '600',
      background: active ? T.text : T.card, border: `1.5px solid ${active ? T.text : T.border}`,
      color: active ? T.page : hasData ? T.text : T.muted, opacity: hasData || active ? '1' : '0.55',
      cursor: hasData ? 'pointer' : 'not-allowed',
    }, r);
    btn.type = 'button'; btn.dataset.gen = String(n);
    btn.setAttribute('aria-pressed', String(active));
    btn.title = hasData ? `Generation ${r} — ${REGIONS[i] ?? ''}`.trim() : `Generation ${r} — no data`;
    if (!hasData) btn.disabled = true; else btn.addEventListener('click', () => setGen(n));
    el.genChips.append(btn);
  });
}

function renderStatusChips(caughtCount, total) {
  const options = [
    { key: 'all', label: 'All' },
    { key: 'needed', label: `Needed ${total - caughtCount}` },
    { key: 'caught', label: `Caught ${caughtCount}` },
  ];
  el.statusChips.replaceChildren();
  for (const o of options) {
    const active = state.status === o.key;
    const btn = elem('button', {
      ...chipBase(), minHeight: '38px', padding: '0 14px',
      background: active ? T.card : 'transparent',
      border: active ? `1.5px solid ${T.border}` : '1.5px solid transparent',
      color: active ? T.text : T.muted, boxShadow: active ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
    }, o.label);
    btn.type = 'button'; btn.dataset.status = o.key;
    btn.setAttribute('aria-pressed', String(active));
    btn.addEventListener('click', () => { state.status = o.key; render(); });
    el.statusChips.append(btn);
  }
}

function renderTypeChips() {
  el.typeChips.replaceChildren();
  for (const t of TYPE_ORDER) {
    const c = TYPE_COLORS[t];
    const sel = state.types.includes(t);
    const btn = elem('button', {
      ...chipBase(), fontSize: '12.5px',
      background: sel ? `color-mix(in oklab, ${c} 22%, ${T.card})` : T.card,
      border: `1.5px solid ${sel ? `color-mix(in oklab, ${c} 65%, ${T.border})` : T.border}`,
      color: sel ? T.text : T.muted,
    });
    btn.type = 'button'; btn.dataset.type = t;
    btn.setAttribute('aria-pressed', String(sel));
    btn.append(elem('span', { width: '9px', height: '9px', borderRadius: '50%', background: c, flexShrink: 0 }), document.createTextNode(t.charAt(0).toUpperCase() + t.slice(1)));
    btn.addEventListener('click', () => {
      state.types = sel ? state.types.filter((x) => x !== t) : [...state.types, t];
      render();
    });
    el.typeChips.append(btn);
  }
  if (state.types.length) {
    const clear = elem('button', null, 'clear types');
    clear.type = 'button'; clear.className = 'clear-types';
    clear.addEventListener('click', () => { state.types = []; render(); });
    el.typeChips.append(clear);
  }
}

function renderObtain() {
  const present = enrichmentPresent();
  el.obtainRow.hidden = !present;
  if (!present) return;
  const defs = [
    { key: 'switch', label: 'Switch' }, { key: 'shiny', label: 'Shiny-legal' },
    { key: 'gmax', label: 'GMax' }, { key: 'tera', label: 'Tera' },
  ];
  el.obtainChips.replaceChildren();
  for (const o of defs) {
    const sel = state.obtain[o.key];
    const btn = elem('button', {
      ...chipBase(), minHeight: '38px', fontSize: '12.5px',
      background: sel ? T.text : T.card, border: `1.5px solid ${sel ? T.text : T.border}`,
      color: sel ? T.page : T.muted,
    }, o.label);
    btn.type = 'button'; btn.dataset.obtain = o.key;
    btn.setAttribute('aria-pressed', String(sel));
    btn.addEventListener('click', () => { state.obtain = { ...state.obtain, [o.key]: !state.obtain[o.key] }; render(); });
    el.obtainChips.append(btn);
  }
  // populate game options once from the entries' availability
  const games = new Map();
  for (const e of state.entries) if (hasEnrichment(e)) for (const a of e.availability) if (!games.has(a.gameId)) games.set(a.gameId, a.label);
  const current = state.gameFilter;
  el.gameSelect.replaceChildren(elem('option', null, 'in any game…'));
  el.gameSelect.firstChild.value = '';
  for (const [gameId, label] of games) {
    const opt = elem('option', null, label); opt.value = gameId; el.gameSelect.append(opt);
  }
  el.gameSelect.value = current;
}

/* ---------- grid ---------- */
function tileHint(e) {
  if (hasEnrichment(e) && e.unobtainableLegit) return { hint: '⊘', title: 'Not legitimately obtainable' };
  if (hasEnrichment(e) && e.gmaxCapable) return { hint: 'G✦', title: 'Gigantamax-capable' };
  return { hint: '', title: '' };
}

const lp = { timer: null, fired: false };
function startLongPress(entryKey) {
  lp.fired = false;
  clearTimeout(lp.timer);
  lp.timer = setTimeout(() => { lp.fired = true; openSheet(entryKey); }, 500);
}
function cancelLongPress() { clearTimeout(lp.timer); }

function tileMarkup(e) {
  const c = isCaught(e);
  const wrap = elem('div', null); wrap.className = 'tile';

  const btn = elem('button', tileStyle(e, c));
  btn.type = 'button'; btn.className = 'tile-body'; btn.dataset.entryKey = e.entryKey;
  btn.setAttribute('aria-pressed', String(c));
  btn.title = `${e.name}${e.formLabel ? ' — ' + e.formLabel : ''} · ${e.types.join(' / ')} · ${c ? 'caught — tap to unmark' : 'needed — tap to mark caught'} · long-press or ⋯ for details`;

  const head = elem('span', { display: 'flex', width: '100%', alignItems: 'center', gap: '4px', paddingRight: '28px' });
  const num = elem('span', { display: 'inline-flex', alignItems: 'center', gap: '5px', fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px', fontWeight: '600', letterSpacing: '0.05em', color: 'var(--num)' });
  num.textContent = '#' + String(e.dex).padStart(4, '0');
  for (const dv of ['--dot1', '--dot2']) num.append(elem('span', { width: '7px', height: '7px', borderRadius: '50%', background: `var(${dv})`, flexShrink: 0 }));
  const gender = elem('span', { fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', fontWeight: '600', color: 'var(--num)' }, genderMark(e.gender));
  const spacer = elem('span', { flex: '1' });
  const hintInfo = tileHint(e);
  const hint = elem('span', { fontFamily: "'IBM Plex Mono', monospace", fontSize: '10px', fontWeight: '700', letterSpacing: '0.05em', color: 'var(--num)', opacity: '0.85' }, hintInfo.hint);
  if (hintInfo.title) hint.title = hintInfo.title;
  head.append(num, gender, spacer, hint);

  const img = elem('img', { filter: 'var(--sf)', transition: 'filter 0.25s ease', imageRendering: 'pixelated', margin: '2px 0' });
  img.src = e.spriteUrl; img.alt = ''; img.width = 68; img.height = 68; img.loading = 'lazy'; img.draggable = false;

  const name = elem('span', { fontSize: '13px', fontWeight: '700', color: 'var(--name)', lineHeight: '1.2', textAlign: 'center' }, e.name);
  const form = elem('span', { fontSize: '10.5px', fontWeight: '400', color: 'var(--name)', opacity: '0.75', lineHeight: '1.15', textAlign: 'center' }, e.formLabel ?? '');

  btn.append(head, img, name, form);
  btn.addEventListener('click', () => { if (lp.fired) { lp.fired = false; return; } toggle(e.entryKey); });
  btn.addEventListener('pointerdown', () => startLongPress(e.entryKey));
  btn.addEventListener('pointerup', cancelLongPress);
  btn.addEventListener('pointerleave', cancelLongPress);
  btn.addEventListener('contextmenu', (ev) => ev.preventDefault());

  const info = elem('button', null); info.type = 'button'; info.className = 'tile-info';
  info.textContent = '⋯';
  info.setAttribute('aria-label', `Details: ${e.name}${e.formLabel ? ' ' + e.formLabel : ''}`);
  info.title = info.getAttribute('aria-label');
  info.addEventListener('click', (ev) => { ev.stopPropagation(); openSheet(e.entryKey); });

  wrap.append(btn, info);
  return wrap;
}

function tileEl(entryKey) {
  return el.grid.querySelector(`.tile-body[data-entry-key="${cssEscape(entryKey)}"]`);
}
function cssEscape(v) { return window.CSS && CSS.escape ? CSS.escape(v) : v.replace(/["\\]/g, '\\$&'); }

function restyleTile(entryKey) {
  const btn = tileEl(entryKey);
  const e = state.entries.find((x) => x.entryKey === entryKey);
  if (!btn || !e) return;
  const c = isCaught(e);
  applyStyles(btn, tileStyle(e, c));
  btn.setAttribute('aria-pressed', String(c));
  if (c) { btn.style.animation = 'dex-settle 0.45s cubic-bezier(0.34, 1.4, 0.64, 1)'; setTimeout(() => { btn.style.animation = ''; }, 550); }
}

let lastVisibleKeys = '';
function renderGrid() {
  const visible = visibleEntries();
  lastVisibleKeys = visible.map((e) => e.entryKey).join(',');
  const showEmpty = !state.loading && visible.length === 0;
  el.loading.hidden = !state.loading;
  el.empty.hidden = !showEmpty;
  el.results.hidden = !(!state.loading && visible.length > 0);

  if (showEmpty) {
    const q = state.query.trim();
    const parts = [];
    if (q) parts.push(`search “${q}”`);
    if (state.types.length) parts.push(`${state.types.length} type filter${state.types.length > 1 ? 's' : ''}`);
    if (state.status !== 'all') parts.push(`status “${state.status}”`);
    if (obtainActiveCount()) parts.push(`${obtainActiveCount()} obtainability filter${obtainActiveCount() > 1 ? 's' : ''}`);
    el.emptyTitle.textContent = genEntries().length === 0 ? `Nothing in Gen ${ROMAN[state.gen - 1]} yet` : 'No entries match';
    el.emptyBody.textContent = genEntries().length === 0
      ? 'No entries for this generation have been seeded yet.'
      : (parts.length ? `Your ${parts.join(' + ')} filtered everything out. ` : '') + 'Clear the filters to see the full dex again.';
    el.emptyAction.textContent = 'Clear filters';
    return;
  }
  if (!state.loading && visible.length > 0) {
    const fc = (state.status !== 'all' ? 1 : 0) + state.types.length + (state.query.trim() ? 1 : 0) + obtainActiveCount();
    el.resultLabel.textContent = `${visible.length} ${visible.length === 1 ? 'ENTRY' : 'ENTRIES'}` + (fc ? ` · ${fc} FILTER${fc > 1 ? 'S' : ''} ACTIVE` : '');
    const frag = document.createDocumentFragment();
    for (const e of visible) frag.append(tileMarkup(e));
    el.grid.replaceChildren(frag);
  }
}

function render() { renderChrome(); renderGrid(); }

/* ---------- status writes ---------- */
async function saveStatus(entryKey, patch, opts = {}) {
  const e = state.entries.find((x) => x.entryKey === entryKey);
  if (!e) return;
  const prev = e.status ? { ...e.status } : null;
  const caught = 'caught' in patch ? patch.caught : Boolean(e.status && e.status.caught);
  // optimistic local update
  e.status = { ...(e.status ?? { entryKey, caught: false, caughtAt: null, gameOrigin: null, method: null, notes: null }), ...patch, caught };

  const body = { entryKey, caught };
  for (const f of ['gameOrigin', 'method', 'notes']) if (f in patch) body[f] = patch[f];

  if (opts.membershipMayChange) {
    const nowKeys = visibleEntries().map((x) => x.entryKey).join(',');
    if (nowKeys === lastVisibleKeys) { restyleTile(entryKey); renderChrome(); } else render();
  }
  if (opts.rerenderSheet && sheet.key === entryKey) renderSheetInto(e, true);

  try {
    const status = await api('/api/status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    e.status = status;
    if (sheet.key === entryKey && sheet.panel && 'caught' in patch) renderSheetInto(e, false);
  } catch (err) {
    e.status = prev;
    if (opts.membershipMayChange) render();
    if (sheet.key === entryKey) renderSheetInto(e, false);
    toast(`Couldn't save: ${err.message}`, true);
  }
}

function toggle(entryKey) {
  const e = state.entries.find((x) => x.entryKey === entryKey);
  saveStatus(entryKey, { caught: !isCaught(e) }, { membershipMayChange: true });
}

/* ---------- detail sheet ---------- */
const sheet = { key: null, scrim: null, panel: null, lastFocus: null, onKey: null };

function openSheet(entryKey) {
  const e = state.entries.find((x) => x.entryKey === entryKey);
  if (!e) return;
  if (sheet.key) closeSheet();
  sheet.key = entryKey;
  sheet.lastFocus = document.activeElement;

  const narrow = window.innerWidth < 640;
  sheet.scrim = elem('div', { alignItems: narrow ? 'flex-end' : 'center', padding: narrow ? '0' : '24px' });
  sheet.scrim.className = 'sheet-scrim';
  sheet.panel = elem('div', {
    width: narrow ? '100%' : 'min(560px, 92vw)',
    maxHeight: narrow ? '88vh' : '86vh',
    borderRadius: narrow ? '18px 18px 0 0' : '18px',
    fontFamily: "'Atkinson Hyperlegible', system-ui, sans-serif",
  });
  sheet.panel.className = 'sheet-panel';
  sheet.panel.setAttribute('role', 'dialog');
  sheet.panel.setAttribute('aria-modal', 'true');
  sheet.panel.setAttribute('aria-label', `${e.name}${e.formLabel ? ' — ' + e.formLabel : ''} details`);

  renderSheetInto(e, false);
  sheet.scrim.append(sheet.panel);
  document.body.append(sheet.scrim);
  document.body.style.overflow = 'hidden';

  sheet.scrim.addEventListener('click', (ev) => { if (ev.target === sheet.scrim) closeSheet(); });
  sheet.panel.addEventListener('keydown', trapTab);
  sheet.onKey = (ev) => { if (ev.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', sheet.onKey);
  setTimeout(() => { const f = sheet.panel.querySelector('button, input, textarea, select'); if (f) f.focus(); }, 30);
}

function closeSheet() {
  if (!sheet.key) return;
  document.removeEventListener('keydown', sheet.onKey);
  sheet.scrim.remove();
  document.body.style.overflow = '';
  const restore = sheet.lastFocus;
  sheet.key = sheet.scrim = sheet.panel = sheet.lastFocus = sheet.onKey = null;
  if (restore && restore.focus) setTimeout(() => restore.focus(), 20);
}

function trapTab(ev) {
  if (ev.key !== 'Tab' || !sheet.panel) return;
  const f = [...sheet.panel.querySelectorAll('button, input, textarea, select, [tabindex]')].filter((x) => !x.disabled && x.tabIndex !== -1);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
  else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
}

function renderSheetInto(e, refocusCaught) {
  const c1 = TYPE_COLORS[e.types[0]];
  const st = e.status ?? { caught: false, caughtAt: null, gameOrigin: null, method: null, notes: null };
  const panel = sheet.panel;
  panel.replaceChildren();

  // header
  const head = elem('div', null); head.className = 'sheet-head';
  const spriteWrap = elem('span', {
    width: '84px', height: '84px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '14px',
    background: st.caught ? `color-mix(in oklab, ${c1} 20%, ${T.card})` : T.raised,
    boxShadow: `inset 0 0 0 1.5px ${st.caught ? `color-mix(in oklab, ${c1} 45%, ${T.border})` : T.border}`,
  });
  const img = elem('img', { imageRendering: 'pixelated', filter: st.caught ? 'none' : 'grayscale(1) opacity(0.55)' });
  img.src = e.spriteUrl; img.alt = ''; img.width = 72; img.height = 72; img.draggable = false;
  spriteWrap.append(img);

  const title = elem('div', null); title.className = 'sheet-title';
  const numLine = elem('span', { fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px', fontWeight: '600', letterSpacing: '0.08em', color: T.muted });
  numLine.textContent = '#' + String(e.dex).padStart(4, '0') + ' ';
  numLine.append(elem('span', { fontSize: '13px' }, genderMark(e.gender)));
  title.append(numLine, elem('span', { fontSize: '19px', fontWeight: '700', lineHeight: '1.15' }, e.name));
  if (e.formLabel) title.append(elem('span', { fontSize: '13px', color: T.muted }, e.formLabel));
  const pills = elem('div', { display: 'flex', gap: '5px', marginTop: '3px' });
  for (const t of e.types) {
    pills.append(elem('span', {
      display: 'inline-flex', alignItems: 'center', minHeight: '24px', padding: '0 10px', borderRadius: '999px',
      background: `color-mix(in oklab, ${TYPE_COLORS[t]} 22%, ${T.card})`,
      border: `1px solid color-mix(in oklab, ${TYPE_COLORS[t]} 60%, ${T.border})`,
      fontFamily: "'IBM Plex Mono', monospace", fontSize: '10.5px', fontWeight: '700', letterSpacing: '0.08em', color: T.text,
    }, t.toUpperCase()));
  }
  title.append(pills);

  const close = elem('button', null, '✕'); close.type = 'button'; close.className = 'sheet-close';
  close.setAttribute('aria-label', 'Close details');
  close.addEventListener('click', closeSheet);
  head.append(spriteWrap, title, close);

  // my catch
  const my = elem('div', null); my.className = 'sheet-section';
  my.append(elem('span', null, 'MY CATCH')); my.firstChild.className = 'sheet-h';

  const caughtRow = elem('div', { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' });
  const caughtBtn = elem('button', {
    ...chipBase(), minHeight: '44px', padding: '0 18px', fontSize: '14.5px',
    background: st.caught ? `color-mix(in oklab, ${c1} 24%, ${T.card})` : T.raised,
    border: `1.5px solid ${st.caught ? `color-mix(in oklab, ${c1} 60%, ${T.border})` : T.border}`, color: T.text,
  }, st.caught ? '◉ Caught' : '○ Mark caught');
  caughtBtn.type = 'button'; caughtBtn.setAttribute('aria-pressed', String(st.caught));
  caughtBtn.addEventListener('click', () => saveStatus(e.entryKey, { caught: !st.caught }, { membershipMayChange: true, rerenderSheet: true }));
  caughtRow.append(caughtBtn);
  if (st.caught && st.caughtAt) caughtRow.append(elem('span', { fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px', color: T.muted }, `caught ${String(st.caughtAt).slice(0, 10)}`));
  my.append(caughtRow);

  // game + method combo inputs (suggestions from availability + fallbacks)
  const availLabels = hasEnrichment(e) ? e.availability.map((a) => a.label) : [];
  const gameSug = [...new Set([...availLabels, ...EMU_SUGGESTIONS])];
  const matched = hasEnrichment(e) ? e.availability.filter((a) => a.label === (st.gameOrigin ?? '')) : [];
  const methodSug = [...new Set([...(matched.length ? matched.map((a) => a.method) : (hasEnrichment(e) ? e.availability.map((a) => a.method) : [])), ...METHOD_FALLBACK])];

  const grid = elem('div', { display: 'grid', gridTemplateColumns: window.innerWidth < 640 ? '1fr' : '1fr 1fr', gap: '10px' });
  grid.append(
    comboField('GAME', 'dex-game-suggestions', gameSug, st.gameOrigin ?? '', 'e.g. emu:HeartGold', (v) => saveStatus(e.entryKey, { gameOrigin: v })),
    comboField('METHOD', 'dex-method-suggestions', methodSug, st.method ?? '', 'caught / traded / evolved', (v) => saveStatus(e.entryKey, { method: v })),
  );
  my.append(grid);

  const notesField = elem('label', null); notesField.className = 'field';
  notesField.append(elem('span', null, 'NOTES')); notesField.firstChild.className = 'field-label';
  const notes = document.createElement('textarea');
  notes.rows = 3; notes.placeholder = 'Anything worth remembering about this catch'; notes.value = st.notes ?? '';
  notes.addEventListener('change', () => saveStatus(e.entryKey, { notes: notes.value }));
  notesField.append(notes);
  my.append(notesField);

  panel.append(head, my);

  // obtainability (only when the API provides it)
  if (hasEnrichment(e)) {
    const ob = elem('div', null); ob.className = 'sheet-section obtain';
    ob.append(elem('span', null, 'OBTAINABILITY')); ob.firstChild.className = 'sheet-h';

    if (e.unobtainableLegit) {
      const call = elem('div', { border: `1.5px solid ${T.red}`, borderRadius: '12px', padding: '10px 14px', fontSize: '13.5px', lineHeight: '1.5', color: T.text });
      const strong = elem('strong', { color: T.red }, 'Not legitimately obtainable. ');
      call.append(strong, document.createTextNode('Event-only distribution — a known gap, not a “needed” you can farm.'));
      ob.append(call);
    }
    const badges = [];
    if (e.gmaxCapable) badges.push('GMAX');
    if (e.teraAvailable) badges.push('TERA');
    if (e.genderVisualDiff) badges.push('♀♂ VISUAL DIFF');
    if (!e.shinyLegalSomewhere && !e.unobtainableLegit) badges.push('✦ SHINY-LOCKED EVERYWHERE');
    if (badges.length) {
      const row = elem('div', { display: 'flex', flexWrap: 'wrap', gap: '6px' });
      for (const b of badges) row.append(elem('span', {
        display: 'inline-flex', alignItems: 'center', minHeight: '28px', padding: '0 11px', borderRadius: '999px',
        background: T.raised, border: `1px solid ${T.border}`, fontFamily: "'IBM Plex Mono', monospace",
        fontSize: '11.5px', fontWeight: '600', letterSpacing: '0.05em', color: T.text,
      }, b));
      ob.append(row);
    }
    for (const p of PLATFORM_ORDER) {
      const rows = e.availability.filter((a) => a.platform === p);
      if (!rows.length) continue;
      const group = elem('div', { display: 'flex', flexDirection: 'column', gap: '6px' });
      group.append(elem('span', { fontFamily: "'IBM Plex Mono', monospace", fontSize: '10.5px', fontWeight: '600', letterSpacing: '0.12em', color: T.muted }, PLATFORM_LABELS[p] ?? p.toUpperCase()));
      const chips = elem('div', { display: 'flex', flexWrap: 'wrap', gap: '6px' });
      for (const a of rows) {
        const locked = (e.shinyLockedIn || []).includes(a.gameId);
        const origin = (e.originGames || []).includes(a.gameId);
        const chip = elem('span', {
          display: 'inline-flex', alignItems: 'center', gap: '7px', minHeight: '34px', padding: '0 12px', borderRadius: '999px',
          background: T.raised, border: `1px solid ${origin ? `color-mix(in oklab, ${c1} 55%, ${T.border})` : T.border}`,
          fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px', color: T.text,
        });
        chip.title = `${a.label} · ${a.method}` + (locked ? ' · shiny-locked' : a.shinyPossible ? ' · shiny possible' : ' · no shinies') + (origin ? ' · origin game' : '');
        chip.append(elem('span', { fontWeight: '700' }, a.label), elem('span', { opacity: '0.75' }, a.method));
        chip.append(elem('span', {
          color: (a.shinyPossible && !locked) ? `color-mix(in oklab, ${c1} 70%, ${T.text})` : T.muted,
          textDecoration: locked ? 'line-through' : 'none', opacity: (!a.shinyPossible && !locked) ? '0.35' : '1', fontSize: '13px',
        }, '✦'));
        if (origin) chip.append(elem('span', { fontSize: '9.5px', fontWeight: '700', letterSpacing: '0.06em', color: T.muted }, 'ORIGIN'));
        chips.append(chip);
      }
      group.append(chips);
      ob.append(group);
    }
    panel.append(ob);
  }

  if (refocusCaught) setTimeout(() => { const b = panel.querySelector('.sheet-section button[aria-pressed]'); if (b) b.focus(); }, 10);
}

function comboField(label, listId, suggestions, value, placeholder, onSave) {
  const wrap = elem('label', null); wrap.className = 'field';
  wrap.append(elem('span', null, label)); wrap.firstChild.className = 'field-label';
  const input = document.createElement('input');
  input.type = 'text'; input.value = value; input.placeholder = placeholder;
  input.setAttribute('list', listId);
  input.addEventListener('change', () => onSave(input.value));
  const dl = document.createElement('datalist'); dl.id = listId;
  for (const s of suggestions) { const o = document.createElement('option'); o.value = s; dl.append(o); }
  wrap.append(input, dl);
  return wrap;
}

/* ---------- filters / gen ---------- */
function setGen(n) {
  state.gen = n;
  try { localStorage.setItem(GEN_KEY, String(n)); } catch { /* ignore */ }
  render();
}

function ingest(entries) {
  state.entries = entries;
  state.gensAvailable = new Set(entries.map((e) => e.generation));
  if (!state.gensAvailable.has(state.gen)) state.gen = Math.min(...state.gensAvailable) || 1;
}
async function reload() { ingest(await api('/api/entries')); }

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

/* ---------- sprite mirror ---------- */
function paintMirror(status) {
  if (!status || !status.enabled) { el.mirrorBtn.hidden = true; return; }
  el.mirrorBtn.hidden = false;
  if (status.running) { el.mirrorBtn.textContent = `Mirroring ${status.mirrored}/${status.total || '…'}`; el.mirrorBtn.disabled = true; }
  else if (status.total > 0 && status.mirrored >= status.total) { el.mirrorBtn.textContent = 'Mirrored ✓'; el.mirrorBtn.disabled = false; el.mirrorBtn.title = 'Sprites are mirrored locally — click to re-check'; }
  else { el.mirrorBtn.textContent = status.mirrored > 0 ? `Mirror (${status.mirrored} done)` : 'Mirror'; el.mirrorBtn.disabled = false; }
}
async function pollMirror() {
  const status = await api('/api/sprites/status');
  paintMirror(status);
  if (status.enabled && status.running) setTimeout(() => { pollMirror().catch(() => {}); }, 1500);
  else if (status.enabled && status.total > 0 && status.mirrored >= status.total) { await reload(); render(); }
}
async function mirrorSprites() {
  try {
    el.mirrorBtn.disabled = true;
    paintMirror(await api('/api/sprites/mirror', { method: 'POST' }));
    toast('Mirroring sprites to the server — this runs in the background.');
    pollMirror().catch(() => {});
  } catch (err) { toast(`Mirror failed: ${err.message}`, true); el.mirrorBtn.disabled = false; }
}

/* ---------- init ---------- */
function init() {
  Object.assign(el, {
    region: $('region'), caught: $('caught'), total: $('total'), pct: $('pct'), progress: $('progress'),
    genChips: $('gen-chips'), statusChips: $('status-chips'), typeChips: $('type-chips'), search: $('search'),
    obtainRow: $('obtain-row'), obtainChips: $('obtain-chips'), gameSelect: $('game-select'), themeBtn: $('theme-btn'),
    loading: $('loading'), skeleton: $('skeleton'), empty: $('empty'), emptyTitle: $('empty-title'),
    emptyBody: $('empty-body'), emptyAction: $('empty-action'), results: $('results'), resultLabel: $('result-label'),
    grid: $('grid'), importFile: $('import-file'), toast: $('toast'), mirrorBtn: $('mirror-btn'),
  });

  try {
    const savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme === 'auto' || savedTheme === 'light' || savedTheme === 'dark') state.theme = savedTheme;
    const savedGen = parseInt(localStorage.getItem(GEN_KEY) ?? '', 10);
    if (Number.isInteger(savedGen) && savedGen >= 1 && savedGen <= 9) state.gen = savedGen;
  } catch { /* ignore */ }
  syncTheme();

  const sk = document.createDocumentFragment();
  for (let i = 0; i < 24; i++) sk.append(document.createElement('div'));
  el.skeleton.replaceChildren(sk);

  el.themeBtn.addEventListener('click', cycleTheme);
  el.emptyAction.addEventListener('click', () => {
    state.status = 'all'; state.query = ''; state.types = []; state.obtain = { switch: false, shiny: false, gmax: false, tera: false };
    state.gameFilter = ''; el.search.value = ''; render();
  });
  let searchTimer;
  el.search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.query = el.search.value; render(); }, 200); });
  el.gameSelect.addEventListener('change', () => { state.gameFilter = el.gameSelect.value; render(); });
  el.importFile.addEventListener('change', () => { const f = el.importFile.files && el.importFile.files[0]; if (f) onImport(f); el.importFile.value = ''; });
  el.mirrorBtn.addEventListener('click', mirrorSprites);
  pollMirror().catch(() => { el.mirrorBtn.hidden = true; });

  state.loading = true;
  el.loading.hidden = false; el.results.hidden = true; el.empty.hidden = true;
  reload().then(() => { state.loading = false; render(); }).catch((err) => {
    state.loading = false; el.loading.hidden = true; toast(`Failed to load: ${err.message}`, true);
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
