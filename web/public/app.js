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
const PLATFORM_ORDER = ['gb','gbc','gba','ds','3ds','switch','switch2','mobile','service'];
const PLATFORM_LABELS = { gb:'GAME BOY', gbc:'GAME BOY COLOR', gba:'GAME BOY ADVANCE', ds:'NINTENDO DS', '3ds':'NINTENDO 3DS', switch:'SWITCH', switch2:'SWITCH 2', mobile:'MOBILE', service:'SERVICES (HOME BRIDGE)' };
const EMU_SUGGESTIONS = ['emu:FireRed','emu:LeafGreen','emu:HeartGold','emu:SoulSilver','emu:Emerald','emu:Platinum'];
const METHOD_FALLBACK = ['caught','bred','hatched','traded','evolved','gift','transferred'];
// Friendly labels for the HOME originGame slugs (falls back to UPPERCASE).
const GAME_LABELS = {
  rb:'Red/Blue', y:'Yellow', gs:'Gold/Silver', c:'Crystal', rs:'Ruby/Sapphire', e:'Emerald',
  frlg:'FireRed/LeafGreen', dp:'Diamond/Pearl', pt:'Platinum', hgss:'HeartGold/SoulSilver',
  bw:'Black/White', b2w2:'Black 2/White 2', xy:'X/Y', oras:'Omega Ruby/Alpha Sapphire',
  sm:'Sun/Moon', usum:'Ultra Sun/Ultra Moon', lgpe:'Let’s Go', swsh:'Sword/Shield',
  bdsp:'Brilliant Diamond/Shining Pearl', pla:'Legends: Arceus', sv:'Scarlet/Violet', go:'Pokémon GO',
};
const gameLabel = (slug) => (slug ? (GAME_LABELS[slug] ?? slug.toUpperCase()) : null);

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
  gold: LD('#B8860B', '#F7D02C'),
  owned: LD('#1B9E52', '#3FD07E'),
};

const THEME_KEY = 'livingdex-theme';
const GEN_KEY = 'livingdex-gen';

// Ownership method labels. Which methods apply to a given game comes from the
// API (`applicableMethods` per release) — mobile titles (Pokémon GO) get only
// `digital` ("Playing"), everything else the physical trio.
const METHOD_META = {
  cartridge: { label: 'Cartridge', short: 'Cart' },
  emulator: { label: 'Emulator', short: 'Emu' },
  romhack: { label: 'Romhack', short: 'Hack' },
  digital: { label: 'Playing', short: 'Playing' },
  subscription: { label: 'Active', short: 'Active' },
};
// Canonical order, matching the API, for stable method sets.
const METHOD_ORDER = ['cartridge', 'emulator', 'romhack', 'digital', 'subscription'];

// Planner verdicts → display. Order = how they sort in the planner filter row.
const VERDICT_META = {
  ready: { label: 'Ready', color: 'owned' },
  'need-game': { label: 'Need a game', color: 'gold' },
  have: { label: 'Have', color: 'muted' },
  unknown: { label: 'Unknown', color: 'muted' },
  'event-only': { label: 'Event-only', color: 'red' },
};
const VERDICT_ORDER = ['ready', 'need-game', 'have', 'unknown', 'event-only'];

// Acquisition planner: how you'll get games, and how to order the shopping list.
const ACQUIRE_MODES = [
  { key: 'emu-first', label: 'Emu, then cart' },
  { key: 'cartridge-first', label: 'Cart, then emu' },
  { key: 'emulator-only', label: 'Emulator only' },
  { key: 'cartridge-only', label: 'Cartridge only' },
];
const ACQUIRE_RANKS = [
  { key: 'fewest-games', label: 'Fewest games' },
  { key: 'fewest-consoles', label: 'Fewest consoles' },
  { key: 'oldest-gen', label: 'Oldest gen first' },
];
const VIA_META = {
  cartridge: { label: 'BUY CART', color: 'gold' },
  emulator: { label: 'EMULATE', color: 'owned' },
  install: { label: 'INSTALL', color: 'owned' },
  subscription: { label: 'SUBSCRIBE', color: 'gold' },
};
const ACQ_MODE_KEY = 'livingdex-acq-mode';
const ACQ_RANK_KEY = 'livingdex-acq-rank';

// Goal scopes — what "finishing the dex" means (mirrors src/planner/scope.ts).
// A species/regional-form group counts as caught when ANY of its slots is.
const GOAL_SCOPES = [
  { key: 'species', label: 'Species' },
  { key: 'species-regional', label: '+ Regional' },
  { key: 'all', label: 'Everything' },
  { key: 'phased', label: 'Phased' },
];
const SCOPE_KEY = 'livingdex-goal-scope';
const REGIONAL_SEGMENTS = new Set(['alola', 'alolan', 'galar', 'galarian', 'hisui', 'hisuian', 'paldea', 'paldean']);
const isRegionalForm = (slug) => slug.split('_').some((s) => REGIONAL_SEGMENTS.has(s));

// Dex VIEW consolidation — a display choice for the grid only, independent of
// the planner's goal scope. "One per species" collapses a species to a single
// tile (a caught slot represents it, so any-gender/any-form counts as caught).
const DEX_VIEWS = [
  { key: 'all', label: 'Every slot' },
  { key: 'species', label: 'One per species' },
  { key: 'species-regional', label: '+ Regional forms' },
];
const DEX_VIEW_KEY = 'livingdex-dex-view';

// How a game's catches reach Pokémon HOME. Rank = simplicity (lower is simpler),
// used to pick the easiest route among the games a species is available in.
const REACH = {
  native: { rank: 0, tag: 'HOME-native', direct: true },
  go: { rank: 1, tag: 'via GO', direct: true },
  bank: { rank: 2, tag: 'via Pokémon Bank', direct: false },
  chain: { rank: 3, tag: 'via transfer chain', direct: false },
  none: { rank: 8, tag: 'no HOME route', direct: false },
  unknown: { rank: 9, tag: 'route unknown', direct: false },
};

const state = {
  loading: true,
  entries: [],
  gensAvailable: new Set(),
  gen: 1,
  status: 'all',
  query: '',
  types: [],
  obtain: { owned: false, switch: false, shiny: false, gmax: false, tera: false },
  gameFilter: '',
  games: [],
  ownedGroupIds: new Set(),
  transfer: {}, // gameId -> TransferInfo (how that game reaches HOME)
  view: 'dex', // 'dex' | 'planner'
  plan: {}, // entryKey -> SpeciesPlan verdict
  planSummary: null,
  acquisitions: [],
  planFilter: 'all', // 'all' | verdict
  acquireMode: 'emu-first',
  acquireRank: 'fewest-games',
  acquirePlan: null,
  acqStepFilter: null, // itinerary stop id whose species are shown
  acqStepKeys: null,   // Set of entryKeys for that stop
  acqStepLabel: '',
  goalScope: 'phased', // planner GoalScope — what the PLAN counts toward "done"
  planPhase: null,     // {n, of, label, caught, total} from the API when scope is phased
  dexView: 'all',      // dex grid consolidation — display only, independent of goalScope
  theme: 'auto',
};

/* ---------- dex view consolidation (grouping mirrors src/planner/scope.ts) ---------- */
// Cache of the visible entryKey set for the dex VIEW; null = every slot shows.
let scopeCache = { view: null, keys: null };
function invalidateScope() { scopeCache = { view: null, keys: null }; }

function scopeRepresentatives(regional) {
  const groups = new Map();
  for (const e of state.entries) {
    const isReg = isRegionalForm(e.formSlug);
    if (isReg && !regional) continue;
    const key = isReg ? `${e.dex}:${e.formSlug}` : String(e.dex);
    const arr = groups.get(key);
    if (arr) arr.push(e); else groups.set(key, [e]);
  }
  const GENDER_RANK = { male: 0, genderless: 1, female: 2 };
  const reps = [];
  for (const members of groups.values()) {
    members.sort((a, b) =>
      Number(isCaught(b)) - Number(isCaught(a)) ||
      Number(b.formSlug === 'default') - Number(a.formSlug === 'default') ||
      (GENDER_RANK[a.gender] ?? 9) - (GENDER_RANK[b.gender] ?? 9) ||
      a.entryKey.localeCompare(b.entryKey));
    reps.push(members[0]);
  }
  return reps;
}

/** The entryKey Set the dex VIEW shows (null = every slot). */
function scopeKeys() {
  if (scopeCache.view === state.dexView) return scopeCache.keys;
  const view = state.dexView;
  const keys = view === 'species' || view === 'species-regional'
    ? new Set(scopeRepresentatives(view === 'species-regional').map((e) => e.entryKey))
    : null;
  scopeCache = { view, keys };
  return keys;
}
const inScope = (e) => { const k = scopeKeys(); return !k || k.has(e.entryKey); };

/** The simplest HOME route among the games a species is available in (or null). */
function bestHomeRoute(e) {
  if (!hasEnrichment(e)) return null;
  let best = null;
  for (const a of e.availability) {
    const info = state.transfer[a.gameId];
    if (!info || info.reach === 'none' || info.reach === 'unknown') continue;
    const rank = (REACH[info.reach] ?? REACH.unknown).rank;
    if (!best || rank < best.rank) best = { rank, info };
  }
  return best ? best.info : null;
}

// Games are individual releases (Red and Blue are separate); obtainability
// availability is per version-group. Owning either release lights up its group,
// so the "owned" signal is keyed by the owned releases' versionGroups.
function setGamesState(games) {
  state.games = games;
  state.ownedGroupIds = new Set(games.filter((g) => g.owned).map((g) => g.versionGroup));
}

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
/** HOME-derived at-a-glance markers shown on caught tiles. */
function specimenBadges(e) {
  const sp = e.specimen;
  if (!sp) return [];
  const out = [];
  if (sp.shiny) out.push({ kind: 'shiny', glyph: '✨', title: 'Shiny' });
  if (sp.event) out.push({ kind: 'event', glyph: '🎁', title: 'Event / gift' });
  if (sp.ivPerfect === 6) out.push({ kind: 'sixiv', glyph: '★', title: 'Perfect IVs (6×31)' });
  return out;
}
const hasEnrichment = (e) => Array.isArray(e.availability);
function enrichmentPresent() { return state.entries.some(hasEnrichment); }

/* ---------- selectors ---------- */
function genEntries() { return state.entries.filter((e) => e.generation === state.gen && inScope(e)); }
function matchesFilters(e) {
  if (state.types.length && !e.types.some((t) => state.types.includes(t))) return false;
  const c = isCaught(e);
  if (state.status === 'needed' && c) return false;
  if (state.status === 'caught' && !c) return false;
  const ob = state.obtain;
  // Obtainability filters exclude an entry only when we KNOW the flag is false
  // (the entry has obtainability data). Entries with no data yet are "unknown"
  // and are kept rather than silently hidden — we never assert a guess.
  if (hasEnrichment(e)) {
    // "Owned" hides only entries we KNOW aren't in a game you own; entries with
    // no availability data stay visible (unknown, never a guess) — same rule as
    // the other obtainability filters below.
    if (ob.owned && state.ownedGroupIds.size > 0 && !e.availability.some((a) => state.ownedGroupIds.has(a.gameId))) return false;
    if (ob.switch && !e.catchableOnSwitch) return false;
    if (ob.shiny && !e.shinyLegalSomewhere) return false;
    if (ob.gmax && !e.gmaxCapable) return false;
    if (ob.tera && !e.teraAvailable) return false;
  }
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
  renderViewChips();
}

// Dex VIEW consolidation chips — a display choice, deliberately separate from
// the planner's GOAL scope (planning what to catch ≠ how you browse the dex).
function renderViewChips() {
  el.viewChips.replaceChildren();
  for (const v of DEX_VIEWS) {
    const active = state.dexView === v.key;
    const btn = elem('button', {
      ...chipBase(), minHeight: '38px', fontSize: '12.5px',
      background: active ? T.text : T.card, border: `1.5px solid ${active ? T.text : T.border}`,
      color: active ? T.page : T.muted,
    }, v.label);
    btn.type = 'button'; btn.dataset.view = v.key;
    btn.setAttribute('aria-pressed', String(active));
    btn.addEventListener('click', () => setDexView(v.key));
    el.viewChips.append(btn);
  }
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
    // "In a game you own" only appears once at least one game is owned — an
    // otherwise-dead filter is more confusing than absent.
    ...(state.ownedGroupIds.size > 0 ? [{ key: 'owned', label: 'In a game I own', accent: T.owned }] : []),
    { key: 'switch', label: 'Switch' }, { key: 'shiny', label: 'Shiny-legal' },
    { key: 'gmax', label: 'GMax' }, { key: 'tera', label: 'Tera' },
  ];
  el.obtainChips.replaceChildren();
  for (const o of defs) {
    const sel = state.obtain[o.key];
    const on = o.accent ?? T.text;
    const btn = elem('button', {
      ...chipBase(), minHeight: '38px', fontSize: '12.5px',
      background: sel ? on : T.card, border: `1.5px solid ${sel ? on : T.border}`,
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
  const badges = elem('span', { display: 'inline-flex', alignItems: 'center', gap: '2px', fontSize: '11px', lineHeight: '1' });
  badges.className = 'tile-badges';
  for (const b of specimenBadges(e)) {
    const bg = elem('span', { filter: b.kind === 'sixiv' ? 'none' : 'saturate(1.1)', color: b.kind === 'sixiv' ? 'var(--dot1)' : 'inherit' }, b.glyph);
    bg.className = 'tile-badge'; bg.dataset.kind = b.kind; bg.title = b.title; bg.setAttribute('aria-label', b.title);
    badges.append(bg);
  }
  head.append(num, gender, spacer, badges, hint);

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

function render() {
  const planner = state.view === 'planner';
  el.viewBtn.textContent = planner ? '← Dex' : 'Planner';
  el.viewBtn.setAttribute('aria-pressed', String(planner));
  el.planner.hidden = !planner;
  if (el.filterRow) el.filterRow.hidden = planner;
  if (el.typeRow) el.typeRow.hidden = planner;
  if (planner) {
    el.results.hidden = true; el.loading.hidden = true; el.empty.hidden = true; el.obtainRow.hidden = true;
    el.viewRow.hidden = true;
    renderPlanner();
    return;
  }
  el.viewRow.hidden = false;
  renderChrome();
  renderGrid();
}

/* ---------- planner view ---------- */
function plannerTile(label, n, color, key) {
  const active = state.planFilter === key;
  const t = elem('button', {
    display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-start',
    padding: '12px 14px', borderRadius: '12px', cursor: 'pointer', font: 'inherit', textAlign: 'left',
    background: active ? `color-mix(in oklab, ${color} 16%, ${T.card})` : T.card,
    border: `1.5px solid ${active ? color : T.border}`, color: T.text,
  });
  t.type = 'button'; t.className = 'plan-tile'; t.setAttribute('aria-pressed', String(active));
  t.append(elem('span', { fontFamily: "'IBM Plex Mono', monospace", fontSize: '22px', fontWeight: '700', color }, String(n)));
  t.append(elem('span', { fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px', letterSpacing: '0.06em', color: T.muted }, label.toUpperCase()));
  t.dataset.verdict = key;
  t.addEventListener('click', () => { state.planFilter = active ? 'all' : key; state.acqStepFilter = null; state.acqStepKeys = null; renderPlanner(); });
  return t;
}

function plannerRow(e) {
  const p = state.plan[e.entryKey];
  const verdict = p?.verdict ?? 'unknown';
  const meta = VERDICT_META[verdict] ?? VERDICT_META.unknown;
  const color = T[meta.color] ?? T.muted;
  const row = elem('button', {
    display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '8px 10px',
    borderRadius: '10px', cursor: 'pointer', font: 'inherit', textAlign: 'left',
    background: T.card, border: `1px solid ${T.border}`,
  });
  row.type = 'button'; row.className = 'planner-row'; row.dataset.entryKey = e.entryKey; row.dataset.verdict = verdict;

  const img = elem('img', { width: '40px', height: '40px', imageRendering: 'pixelated', flexShrink: 0, filter: verdict === 'have' ? 'none' : 'none' });
  img.src = e.spriteUrl; img.alt = ''; img.loading = 'lazy'; img.draggable = false;

  const mid = elem('span', { display: 'flex', flexDirection: 'column', gap: '1px', flex: '1', minWidth: '0' });
  const title = elem('span', { fontSize: '13.5px', fontWeight: '700', color: T.text });
  title.append(elem('span', { fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px', color: T.muted }, '#' + String(e.dex).padStart(4, '0') + ' '), document.createTextNode(e.name + (e.formLabel ? ` · ${e.formLabel}` : '')));
  mid.append(title);
  const detailText = verdict === 'ready' && p ? `catch in ${gameLabel(p.via) ?? p.via}`
    : verdict === 'need-game' && p ? `acquire ${formatNeeds(p.needs)}`
    : verdict === 'have' ? 'in your dex'
    : verdict === 'event-only' ? 'event-only distribution'
    : 'no known route yet';
  mid.append(elem('span', { fontSize: '11.5px', color: T.muted, lineHeight: '1.3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, detailText));

  const pill = elem('span', {
    flexShrink: 0, display: 'inline-flex', alignItems: 'center', minHeight: '24px', padding: '0 10px', borderRadius: '999px',
    background: `color-mix(in oklab, ${color} 16%, ${T.raised})`, border: `1px solid ${color}`,
    fontFamily: "'IBM Plex Mono', monospace", fontSize: '10.5px', fontWeight: '700', letterSpacing: '0.04em', color: T.text,
  }, meta.label.toUpperCase());

  row.append(img, mid, pill);
  row.addEventListener('click', () => openSheet(e.entryKey));
  return row;
}

function acqChip(active, label, onClick) {
  const btn = elem('button', {
    ...chipBase(), minHeight: '34px', padding: '0 12px', fontSize: '12px',
    background: active ? T.text : T.card, border: `1.5px solid ${active ? T.text : T.border}`,
    color: active ? T.page : T.muted,
  }, label);
  btn.type = 'button'; btn.setAttribute('aria-pressed', String(active));
  btn.addEventListener('click', onClick);
  return btn;
}

function setAcquire(field, value) {
  state[field] = value;
  state.acqStepFilter = null; state.acqStepKeys = null; // the itinerary changes
  try { localStorage.setItem(field === 'acquireMode' ? ACQ_MODE_KEY : ACQ_RANK_KEY, value); } catch { /* ignore */ }
  loadAcquire().then(() => { if (state.view === 'planner') renderPlanner(); });
}

function setGoalScope(value) {
  state.goalScope = value;
  state.acqStepFilter = null; state.acqStepKeys = null; state.planFilter = 'all';
  try { localStorage.setItem(SCOPE_KEY, value); } catch { /* ignore */ }
  if (state.view === 'planner') renderPlanner(); // show the chip flip while the plan reloads
  Promise.all([loadPlan(), loadAcquire()]).then(() => { if (state.view === 'planner') renderPlanner(); });
}

function setDexView(value) {
  state.dexView = value;
  invalidateScope();
  try { localStorage.setItem(DEX_VIEW_KEY, value); } catch { /* ignore */ }
  render();
}

const shortPlatform = (p) => (p === 'service' ? 'SERVICE' : (PLATFORM_LABELS[p] ?? p.toUpperCase()));

/** The "shopping list to complete the dex" — the primary planner content. */
function acquireSection() {
  const wrap = elem('div', { display: 'flex', flexDirection: 'column', gap: '10px' });
  wrap.className = 'acquire';
  wrap.append(elem('span', { fontFamily: "'IBM Plex Mono', monospace", fontSize: '10.5px', fontWeight: '600', letterSpacing: '0.12em', color: T.muted }, 'COMPLETION PLAN'));

  // Strategy selectors: how you acquire games, and how to order the list.
  const strat = elem('div', { display: 'flex', flexDirection: 'column', gap: '8px' });
  const modeRow = elem('div', { display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center' });
  modeRow.append(elem('span', { fontFamily: "'IBM Plex Mono', monospace", fontSize: '10px', letterSpacing: '0.08em', color: T.muted, marginRight: '2px' }, 'ACQUIRE:'));
  for (const m of ACQUIRE_MODES) { const b = acqChip(state.acquireMode === m.key, m.label, () => setAcquire('acquireMode', m.key)); b.dataset.mode = m.key; modeRow.append(b); }
  const rankRow = elem('div', { display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center' });
  rankRow.append(elem('span', { fontFamily: "'IBM Plex Mono', monospace", fontSize: '10px', letterSpacing: '0.08em', color: T.muted, marginRight: '2px' }, 'ORDER:'));
  for (const r of ACQUIRE_RANKS) { const b = acqChip(state.acquireRank === r.key, r.label, () => setAcquire('acquireRank', r.key)); b.dataset.rank = r.key; rankRow.append(b); }
  strat.append(modeRow, rankRow);
  wrap.append(strat);

  const plan = state.acquirePlan;
  if (!plan) { wrap.append(elem('div', { padding: '16px', textAlign: 'center', color: T.muted, fontSize: '13px' }, 'Computing plan…')); return wrap; }

  const stops = plan.steps.filter((s) => !s.prereq);
  const toAcquire = plan.steps.filter((s) => !s.owned).length;

  // Headline: play these N games, in order, to catch everything.
  const headline = stops.length
    ? `Catch your ${plan.coverable} missing across ${stops.length} game${stops.length > 1 ? 's' : ''}, in order.`
    : `Nothing left to catch that has a known route.`;
  wrap.append(elem('div', { fontSize: '15px', fontWeight: '700', color: T.text, lineHeight: '1.4' }, headline));
  const sub = [];
  if (toAcquire) sub.push(`${toAcquire} to acquire, the rest you already own`);
  if (plan.leftover.length) sub.push(`${plan.leftover.length} can’t be planned (event-only / no known route)`);
  if (sub.length) wrap.append(elem('div', { fontSize: '12.5px', color: T.muted, lineHeight: '1.4' }, sub.join(' · ')));

  // Ordered itinerary — prereqs first, then numbered catch stops. Click a stop to
  // see exactly which species to catch there.
  const list = elem('div', { display: 'flex', flexDirection: 'column', gap: '6px' });
  let n = 0;
  for (const step of plan.steps) {
    const selected = !step.prereq && state.acqStepFilter === step.id;
    const rowEl = elem('button', {
      display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '10px 12px', borderRadius: '10px',
      cursor: step.prereq ? 'default' : 'pointer', font: 'inherit', textAlign: 'left',
      background: selected ? `color-mix(in oklab, ${T.owned} 12%, ${T.card})` : T.card,
      border: `1px solid ${selected ? T.owned : T.border}`,
    });
    rowEl.type = 'button'; rowEl.className = 'acq-step'; rowEl.dataset.id = step.id;
    if (step.prereq) rowEl.dataset.prereq = 'true';

    // marker: "GET FIRST" for prereqs, else the step number
    rowEl.append(step.prereq
      ? elem('span', { fontFamily: "'IBM Plex Mono', monospace", fontSize: '8.5px', fontWeight: '700', letterSpacing: '0.05em', color: T.gold, minWidth: '20px', lineHeight: '1.1' }, 'GET\nFIRST')
      : elem('span', { fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', fontWeight: '700', color: T.muted, minWidth: '20px' }, String(++n)));

    const mid = elem('span', { display: 'flex', flexDirection: 'column', gap: '1px', flex: '1', minWidth: '0' });
    mid.append(elem('span', { fontSize: '14px', fontWeight: '700', color: T.text }, step.label));
    mid.append(elem('span', { fontFamily: "'IBM Plex Mono', monospace", fontSize: '10px', letterSpacing: '0.06em', color: T.muted }, shortPlatform(step.platform)));
    rowEl.append(mid);

    // status badge: OWN (you have it) or the acquire method
    if (step.owned) {
      rowEl.append(elem('span', {
        flexShrink: 0, display: 'inline-flex', alignItems: 'center', minHeight: '24px', padding: '0 10px', borderRadius: '999px',
        background: `color-mix(in oklab, ${T.owned} 16%, ${T.raised})`, border: `1px solid ${T.owned}`,
        fontFamily: "'IBM Plex Mono', monospace", fontSize: '10px', fontWeight: '700', letterSpacing: '0.05em', color: T.text,
      }, 'OWN'));
    } else {
      const via = VIA_META[step.via] ?? { label: String(step.via).toUpperCase(), color: 'gold' };
      const viaColor = T[via.color] ?? T.gold;
      rowEl.append(elem('span', {
        flexShrink: 0, display: 'inline-flex', alignItems: 'center', minHeight: '24px', padding: '0 10px', borderRadius: '999px',
        background: `color-mix(in oklab, ${viaColor} 16%, ${T.raised})`, border: `1px solid ${viaColor}`,
        fontFamily: "'IBM Plex Mono', monospace", fontSize: '10px', fontWeight: '700', letterSpacing: '0.05em', color: T.text,
      }, via.label));
    }

    // catch count (stops) or a transfer note (prereqs)
    rowEl.append(elem('span', { fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px', fontWeight: '700', color: step.prereq ? T.muted : T.owned, minWidth: '64px', textAlign: 'right' },
      step.prereq ? 'transfer' : `catch ${step.catchCount}`));

    if (!step.prereq) {
      rowEl.addEventListener('click', () => {
        state.acqStepFilter = state.acqStepFilter === step.id ? null : step.id;
        state.acqStepKeys = state.acqStepFilter ? new Set(step.entryKeys) : null;
        state.acqStepLabel = step.label;
        renderPlanner();
      });
    }
    list.append(rowEl);
  }
  wrap.append(list);

  // Reality check: Bank can no longer be newly installed (3DS eShop closed
  // March 2023) — a Bank prereq only works if it's already on your 3DS.
  if (plan.steps.some((s) => s.id === 'bank' && !s.owned)) {
    wrap.append(elem('div', {
      border: `1.5px solid ${T.gold}`, borderRadius: '12px', padding: '10px 14px',
      fontSize: '12.5px', lineHeight: '1.5', color: T.text,
    }, '⚠ Pokémon Bank can no longer be newly downloaded (the 3DS eShop closed in March 2023). '
      + 'This route assumes Bank is already installed on your 3DS — if it isn’t, the pre-Switch stops can’t reach HOME.'));
  }

  return wrap;
}

const PLANNER_ROW_CAP = 400;
function renderPlanner() {
  const root = el.planner;
  root.replaceChildren();
  applyStyles(root, { display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '760px', margin: '0 auto' });
  const s = state.planSummary;
  if (!s) { root.append(elem('div', { padding: '48px 0', textAlign: 'center', color: T.muted }, 'Planner data unavailable — is the API reachable?')); return; }

  root.append(elem('div', { fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', fontWeight: '700', letterSpacing: '0.1em', color: T.text }, 'LIVING-DEX PLANNER'));
  root.append(elem('p', { fontSize: '13px', color: T.muted, lineHeight: '1.5', margin: '0' },
    'The order to play through your games to finish the dex. Pick your goal and how you’d get missing games below; set what you already own + Bank under “My Games”. Tap a game to see exactly what to catch there.'));

  // Goal scope: what "done" means (species / +regional / everything / phased).
  const goalRow = elem('div', { display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center' });
  goalRow.append(elem('span', { fontFamily: "'IBM Plex Mono', monospace", fontSize: '10px', letterSpacing: '0.08em', color: T.muted, marginRight: '2px' }, 'GOAL:'));
  for (const g of GOAL_SCOPES) { const b = acqChip(state.goalScope === g.key, g.label, () => setGoalScope(g.key)); b.dataset.scope = g.key; goalRow.append(b); }
  root.append(goalRow);

  // Scope progress: phase banner (phased) or a plain caught-of-goal line.
  const ph = state.planPhase;
  const goalLine = ph
    ? `PHASE ${ph.n}/${ph.of} — ${ph.label.toUpperCase()} · ${ph.caught}/${ph.total} caught`
    : `${(GOAL_SCOPES.find((g) => g.key === state.goalScope)?.label ?? state.goalScope).toUpperCase()} · ${s.have}/${s.total} caught`;
  const goalEl = elem('div', { fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px', fontWeight: '700', letterSpacing: '0.06em', color: T.text });
  goalEl.dataset.role = 'goal-progress';
  goalEl.textContent = goalLine;
  root.append(goalEl);

  // The completion itinerary — the primary content.
  root.append(acquireSection());

  // Breakdown by verdict (secondary). Summary tiles (click to filter).
  const tiles = elem('div', { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(108px, 1fr))', gap: '8px' });
  tiles.append(
    plannerTile('Ready', s.ready, T.owned, 'ready'),
    plannerTile('Need a game', s.needGame, T.gold, 'need-game'),
    plannerTile('Have', s.have, T.muted, 'have'),
    plannerTile('Unknown', s.unknown, T.muted, 'unknown'),
    plannerTile('Event-only', s.eventOnly, T.red, 'event-only'),
  );
  root.append(tiles);

  // Species list — either the species to catch at a tapped itinerary stop, or
  // the active verdict-tile filter.
  const listWrap = elem('div', { display: 'flex', flexDirection: 'column', gap: '8px' });
  const byStop = Boolean(state.acqStepFilter && state.acqStepKeys);
  const label = byStop ? `CATCH IN ${state.acqStepLabel.toUpperCase()}`
    : state.planFilter === 'all' ? 'ALL SPECIES'
    : (VERDICT_META[state.planFilter]?.label ?? state.planFilter).toUpperCase();
  const header = elem('div', { display: 'flex', alignItems: 'center', gap: '8px' });
  header.append(elem('span', { fontFamily: "'IBM Plex Mono', monospace", fontSize: '10.5px', fontWeight: '600', letterSpacing: '0.12em', color: T.muted }, label));
  if (byStop || state.planFilter !== 'all') {
    const clear = elem('button', null, 'show all'); clear.type = 'button'; clear.className = 'clear-types';
    clear.addEventListener('click', () => { state.planFilter = 'all'; state.acqStepFilter = null; state.acqStepKeys = null; renderPlanner(); });
    header.append(clear);
  }
  listWrap.append(header);

  // The species list follows the PLAN's goal scope: the server only returns
  // verdicts for in-scope slots, so plan membership is the filter.
  const filtered = state.entries
    .filter((e) => byStop
      ? state.acqStepKeys.has(e.entryKey)
      : (!state.planSummary || state.plan[e.entryKey] !== undefined)
        && (state.planFilter === 'all' || verdictOf(e) === state.planFilter))
    .sort((a, b) => a.dex - b.dex || a.entryKey.localeCompare(b.entryKey));
  const frag = document.createDocumentFragment();
  for (const e of filtered.slice(0, PLANNER_ROW_CAP)) frag.append(plannerRow(e));
  listWrap.append(frag);
  if (filtered.length > PLANNER_ROW_CAP) {
    listWrap.append(elem('div', { padding: '10px', textAlign: 'center', fontSize: '12px', color: T.muted },
      `Showing ${PLANNER_ROW_CAP} of ${filtered.length} — use the tiles above to narrow the list.`));
  }
  if (filtered.length === 0) {
    listWrap.append(elem('div', { padding: '24px', textAlign: 'center', fontSize: '13px', color: T.muted }, 'Nothing in this category.'));
  }
  root.append(listWrap);
}

/** Refresh planner data after a change that affects routing, then re-render what's visible. */
function refreshPlan() {
  return Promise.all([loadPlan(), loadAcquire()]).then(() => {
    if (state.view === 'planner') renderPlanner();
    if (sheet.key) { const e = state.entries.find((x) => x.entryKey === sheet.key); if (e) renderSheetInto(e, false); }
  }).catch(() => {});
}

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
  if ('caught' in patch) invalidateScope(); // caught-any group representatives may shift

  if (opts.membershipMayChange) {
    const nowKeys = visibleEntries().map((x) => x.entryKey).join(',');
    if (nowKeys === lastVisibleKeys) { restyleTile(entryKey); renderChrome(); } else render();
  }
  if (opts.rerenderSheet && sheet.key === entryKey) renderSheetInto(e, true);

  // Optimistic planner nudge: a fresh catch is immediately "Have".
  if ('caught' in patch && caught && state.plan[entryKey]) state.plan[entryKey] = { ...state.plan[entryKey], verdict: 'have' };

  try {
    const status = await api('/api/status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    e.status = status;
    if (sheet.key === entryKey && sheet.panel && 'caught' in patch) renderSheetInto(e, false);
    if ('caught' in patch) refreshPlan(); // catching/releasing changes Have vs the routing verdicts
  } catch (err) {
    e.status = prev;
    invalidateScope();
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

  // best specimen (HOME-derived; present only on caught slots that were imported)
  if (e.specimen) {
    const sp = e.specimen;
    const zone = elem('div', null); zone.className = 'sheet-section specimen';
    zone.append(elem('span', null, 'BEST SPECIMEN')); zone.firstChild.className = 'sheet-h';

    const pills = [];
    if (sp.shiny) pills.push({ text: '✨ SHINY', color: T.gold });
    if (sp.event) pills.push({ text: '🎁 EVENT', color: c1 });
    if (sp.ivPerfect === 6) pills.push({ text: '★ 6IV', color: c1 });
    if (sp.tera) pills.push({ text: `TERA ${sp.tera.toUpperCase()}`, color: TYPE_COLORS[sp.tera.toLowerCase()] ?? c1 });
    if (pills.length) {
      const row = elem('div', { display: 'flex', flexWrap: 'wrap', gap: '6px' });
      for (const p of pills) row.append(elem('span', {
        display: 'inline-flex', alignItems: 'center', minHeight: '28px', padding: '0 11px', borderRadius: '999px',
        background: `color-mix(in oklab, ${p.color} 22%, ${T.card})`, border: `1px solid color-mix(in oklab, ${p.color} 55%, ${T.border})`,
        fontFamily: "'IBM Plex Mono', monospace", fontSize: '11.5px', fontWeight: '700', letterSpacing: '0.05em', color: T.text,
      }, p.text));
      zone.append(row);
    }

    const facts = [];
    const origin = [gameLabel(sp.originGame), sp.metYear].filter(Boolean).join(' · ');
    if (origin) facts.push(['Origin', origin]);
    if (sp.level != null) facts.push(['Level', String(sp.level)]);
    if (sp.nature) facts.push(['Nature', sp.nature]);
    if (sp.ability) facts.push(['Ability', sp.ability]);
    if (sp.ball) facts.push(['Ball', sp.ball]);
    if (sp.ivPerfect != null) facts.push(['Perfect IVs', `${sp.ivPerfect}/6`]);
    if (sp.nickname) facts.push(['Nickname', sp.nickname]);
    if (sp.ot) facts.push(['OT', sp.ot]);
    if (facts.length) {
      const g = elem('div', { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 14px', alignItems: 'baseline' });
      for (const [k, v] of facts) {
        g.append(elem('span', { fontFamily: "'IBM Plex Mono', monospace", fontSize: '10.5px', fontWeight: '600', letterSpacing: '0.08em', color: T.muted }, k.toUpperCase()));
        g.append(elem('span', { fontSize: '13px', color: T.text }, v));
      }
      zone.append(g);
    }

    if (sp.ivs) {
      const ivWrap = elem('div', { display: 'flex', flexWrap: 'wrap', gap: '5px' });
      for (const [k, lab] of [['hp', 'HP'], ['atk', 'ATK'], ['def', 'DEF'], ['spa', 'SPA'], ['spd', 'SPD'], ['spe', 'SPE']]) {
        const v = sp.ivs[k]; const max = v === 31;
        ivWrap.append(elem('span', {
          display: 'inline-flex', gap: '5px', alignItems: 'center', minHeight: '26px', padding: '0 9px', borderRadius: '8px',
          background: max ? `color-mix(in oklab, ${c1} 26%, ${T.card})` : T.raised,
          border: `1px solid ${max ? `color-mix(in oklab, ${c1} 55%, ${T.border})` : T.border}`,
          fontFamily: "'IBM Plex Mono', monospace", fontSize: '11.5px', color: T.text, fontWeight: max ? '700' : '400',
        }, `${lab} ${v}`));
      }
      zone.append(ivWrap);
    }

    if (sp.ribbons && sp.ribbons.length) {
      const row = elem('div', { display: 'flex', flexWrap: 'wrap', gap: '6px' });
      for (const r of sp.ribbons) row.append(elem('span', {
        display: 'inline-flex', alignItems: 'center', minHeight: '26px', padding: '0 10px', borderRadius: '999px',
        background: T.raised, border: `1px solid ${T.border}`, fontSize: '12px', color: T.text,
      }, `🎀 ${r}`));
      zone.append(row);
    }

    panel.append(zone);
  }

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
    // Ownership-aware plan verdict (Ready with your games / Need a game).
    const plan = state.plan[e.entryKey];
    if (plan && (plan.verdict === 'ready' || plan.verdict === 'need-game')) {
      const ready = plan.verdict === 'ready';
      const accent = ready ? T.owned : T.gold;
      const box = elem('div', { display: 'flex', flexDirection: 'column', gap: '5px' });
      box.append(elem('span', { fontFamily: "'IBM Plex Mono', monospace", fontSize: '10.5px', fontWeight: '600', letterSpacing: '0.12em', color: T.muted }, 'YOUR PLAN'));
      const line = elem('div', { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' });
      line.append(elem('span', {
        display: 'inline-flex', alignItems: 'center', minHeight: '26px', padding: '0 11px', borderRadius: '999px',
        background: `color-mix(in oklab, ${accent} 18%, ${T.raised})`, border: `1px solid ${accent}`,
        fontFamily: "'IBM Plex Mono', monospace", fontSize: '11.5px', fontWeight: '700', letterSpacing: '0.05em', color: T.text,
      }, ready ? '✓ READY' : 'NEED A GAME'));
      const detail = ready
        ? `catch in ${gameLabel(plan.via) ?? plan.via} — ${plan.route}`
        : `acquire ${formatNeeds(plan.needs)}`;
      line.append(elem('span', { fontSize: '12.5px', color: T.text, lineHeight: '1.4' }, detail));
      box.append(line);
      ob.append(box);
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
    // Simplest legit route into Pokémon HOME across the games it's available in
    // (ownership-agnostic for now — the planner will make it "with games you own").
    const route = bestHomeRoute(e);
    if (route) {
      const meta = REACH[route.reach] ?? REACH.unknown;
      const accent = meta.direct ? T.owned : T.muted;
      const box = elem('div', { display: 'flex', flexDirection: 'column', gap: '5px' });
      box.append(elem('span', { fontFamily: "'IBM Plex Mono', monospace", fontSize: '10.5px', fontWeight: '600', letterSpacing: '0.12em', color: T.muted }, 'TO POKÉMON HOME'));
      const line = elem('div', { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' });
      line.append(elem('span', {
        display: 'inline-flex', alignItems: 'center', minHeight: '26px', padding: '0 10px', borderRadius: '999px',
        background: `color-mix(in oklab, ${accent} 16%, ${T.raised})`, border: `1px solid ${accent}`,
        fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px', fontWeight: '700', letterSpacing: '0.04em', color: T.text,
      }, meta.direct ? `✓ ${meta.tag.toUpperCase()}` : meta.tag.toUpperCase()));
      line.append(elem('span', { fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px', color: T.text }, route.route));
      box.append(line);
      if (route.note) box.append(elem('span', { fontSize: '11.5px', color: T.muted, lineHeight: '1.4' }, route.note));
      ob.append(box);
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
        const owned = state.ownedGroupIds.has(a.gameId);
        const chip = elem('span', {
          display: 'inline-flex', alignItems: 'center', gap: '7px', minHeight: '34px', padding: '0 12px', borderRadius: '999px',
          background: owned ? `color-mix(in oklab, ${T.owned} 12%, ${T.raised})` : T.raised,
          border: `1px solid ${owned ? T.owned : origin ? `color-mix(in oklab, ${c1} 55%, ${T.border})` : T.border}`,
          fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px', color: T.text,
        });
        chip.title = `${a.label} · ${a.method}` + (locked ? ' · shiny-locked' : a.shinyPossible ? ' · shiny possible' : ' · no shinies') + (origin ? ' · origin game' : '') + (owned ? ' · in a game you own' : '');
        chip.append(elem('span', { fontWeight: '700' }, a.label), elem('span', { opacity: '0.75' }, a.method));
        chip.append(elem('span', {
          color: (a.shinyPossible && !locked) ? `color-mix(in oklab, ${c1} 70%, ${T.text})` : T.muted,
          textDecoration: locked ? 'line-through' : 'none', opacity: (!a.shinyPossible && !locked) ? '0.35' : '1', fontSize: '13px',
        }, '✦'));
        if (owned) chip.append(elem('span', { fontSize: '9.5px', fontWeight: '700', letterSpacing: '0.06em', color: T.owned }, '✓ OWNED'));
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

/* ---------- My Games (ownership) ---------- */
const gamesModal = { scrim: null, panel: null, lastFocus: null, onKey: null };

function gameById(gameId) { return state.games.find((g) => g.gameId === gameId); }

async function saveOwnership(gameId, methods, notes) {
  const g = gameById(gameId);
  if (!g) return;
  const prev = { owned: g.owned, methods: [...g.methods], notes: g.notes };
  // optimistic
  g.methods = methods; g.notes = notes ?? null; g.owned = methods.length > 0;
  setGamesState(state.games);
  if (gamesModal.panel) renderGamesInto();
  render(); // refresh the "In a game I own" chip + owned markers

  try {
    const saved = await api('/api/ownership', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gameId, methods, notes: notes ?? null }),
    });
    g.methods = saved.methods; g.notes = saved.notes; g.owned = saved.methods.length > 0;
    setGamesState(state.games);
    if (gamesModal.panel) renderGamesInto();
    render();
    refreshPlan(); // ownership changes routing — recompute verdicts + acquisitions
  } catch (err) {
    Object.assign(g, prev);
    setGamesState(state.games);
    if (gamesModal.panel) renderGamesInto();
    render();
    toast(`Couldn't save ${gameLabel(gameId) ?? gameId}: ${err.message}`, true);
  }
}

function ownershipRow(g) {
  const owned = g.methods.length > 0;
  const row = elem('div', {
    display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px',
    borderRadius: '12px', background: T.raised,
    border: `1px solid ${owned ? T.owned : T.border}`,
  });
  row.className = 'game-row'; row.dataset.gameId = g.gameId;

  const top = elem('div', { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' });
  const name = elem('span', { display: 'flex', flexDirection: 'column', gap: '1px', minWidth: '0', flex: '1' });
  name.append(elem('span', { fontSize: '14px', fontWeight: '700', color: T.text }, g.label));
  name.append(elem('span', { fontFamily: "'IBM Plex Mono', monospace", fontSize: '10.5px', letterSpacing: '0.06em', color: T.muted },
    g.generation ? `GEN ${ROMAN[g.generation - 1] ?? g.generation}` : 'SPIN-OFF'));
  top.append(name);

  // Only the methods that make sense for this game's platform (from the API):
  // mobile → a single "Playing" toggle, everything else the physical trio.
  const applicable = g.applicableMethods ?? ['cartridge', 'emulator', 'romhack'];
  const toggles = elem('div', { display: 'flex', gap: '5px', flexWrap: 'wrap' });
  for (const key of applicable) {
    const meta = METHOD_META[key] ?? { label: key, short: key };
    const on = g.methods.includes(key);
    const btn = elem('button', {
      ...chipBase(), minHeight: '36px', padding: '0 12px', fontSize: '12px',
      background: on ? T.owned : T.card, border: `1.5px solid ${on ? T.owned : T.border}`,
      color: on ? T.page : T.muted,
    }, meta.short);
    btn.type = 'button'; btn.setAttribute('aria-pressed', String(on));
    btn.dataset.gameId = g.gameId; btn.dataset.method = key;
    btn.title = `${g.label} — ${meta.label}: ${on ? 'owned' : 'not owned'}`;
    btn.setAttribute('aria-label', `${g.label} ${meta.label}`);
    btn.addEventListener('click', () => {
      const next = on
        ? g.methods.filter((x) => x !== key)
        : METHOD_ORDER.filter((k) => k === key || g.methods.includes(k));
      saveOwnership(g.gameId, next, g.notes);
    });
    toggles.append(btn);
  }
  top.append(toggles);
  row.append(top);

  // Notes appear only for a game you actually have (or already annotated).
  if (owned || (g.notes && g.notes.length)) {
    const notes = document.createElement('input');
    notes.type = 'text'; notes.value = g.notes ?? '';
    notes.placeholder = 'note — e.g. cart is JP, or which romhack';
    applyStyles(notes, {
      minHeight: '40px', padding: '0 12px', borderRadius: '10px',
      border: `1.5px solid ${T.border}`, background: T.card, color: T.text,
      fontFamily: "'Atkinson Hyperlegible', system-ui, sans-serif", fontSize: '13.5px', width: '100%',
    });
    notes.addEventListener('change', () => saveOwnership(g.gameId, g.methods, notes.value));
    row.append(notes);
  }
  return row;
}

function renderGamesInto() {
  const panel = gamesModal.panel;
  panel.replaceChildren();

  // Sticky header so the ✕ stays reachable while the (long) games list scrolls —
  // matters most on the mobile bottom-sheet.
  const head = elem('div', { position: 'sticky', top: '0', zIndex: '1', background: T.card });
  head.className = 'sheet-head';
  const title = elem('div', null); title.className = 'sheet-title';
  const ownedCount = state.games.filter((g) => g.owned).length;
  title.append(elem('span', { fontSize: '19px', fontWeight: '700' }, 'My Games'));
  title.append(elem('span', { fontSize: '13px', color: T.muted },
    `${ownedCount} of ${state.games.length} owned · cartridge, emulator or romhack`));
  const close = elem('button', null, '✕'); close.type = 'button'; close.className = 'sheet-close';
  close.setAttribute('aria-label', 'Close My Games');
  close.addEventListener('click', closeGamesModal);
  head.append(title, close);
  panel.append(head);

  const body = elem('div', { padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '18px' });
  for (const p of PLATFORM_ORDER) {
    const games = state.games.filter((g) => g.platform === p);
    if (!games.length) continue;
    const group = elem('div', { display: 'flex', flexDirection: 'column', gap: '8px' });
    group.append(elem('span', {
      fontFamily: "'IBM Plex Mono', monospace", fontSize: '10.5px', fontWeight: '600',
      letterSpacing: '0.12em', color: T.muted,
    }, PLATFORM_LABELS[p] ?? p.toUpperCase()));
    for (const g of games) group.append(ownershipRow(g));
    body.append(group);
  }
  panel.append(body);
}

function openGamesModal() {
  if (gamesModal.panel) return;
  gamesModal.lastFocus = document.activeElement;
  const narrow = window.innerWidth < 640;
  gamesModal.scrim = elem('div', { alignItems: narrow ? 'flex-end' : 'center', padding: narrow ? '0' : '24px' });
  gamesModal.scrim.className = 'sheet-scrim';
  gamesModal.panel = elem('div', {
    width: narrow ? '100%' : 'min(560px, 92vw)',
    maxHeight: narrow ? '88vh' : '86vh',
    borderRadius: narrow ? '18px 18px 0 0' : '18px',
    fontFamily: "'Atkinson Hyperlegible', system-ui, sans-serif",
  });
  gamesModal.panel.className = 'sheet-panel games-panel';
  gamesModal.panel.setAttribute('role', 'dialog');
  gamesModal.panel.setAttribute('aria-modal', 'true');
  gamesModal.panel.setAttribute('aria-label', 'My Games — track which games you own');

  renderGamesInto();
  gamesModal.scrim.append(gamesModal.panel);
  document.body.append(gamesModal.scrim);
  document.body.style.overflow = 'hidden';

  gamesModal.scrim.addEventListener('click', (ev) => { if (ev.target === gamesModal.scrim) closeGamesModal(); });
  gamesModal.panel.addEventListener('keydown', trapGamesTab);
  gamesModal.onKey = (ev) => { if (ev.key === 'Escape') closeGamesModal(); };
  document.addEventListener('keydown', gamesModal.onKey);
  setTimeout(() => { const f = gamesModal.panel.querySelector('button, input'); if (f) f.focus(); }, 30);
}

function closeGamesModal() {
  if (!gamesModal.panel) return;
  document.removeEventListener('keydown', gamesModal.onKey);
  gamesModal.scrim.remove();
  document.body.style.overflow = '';
  const restore = gamesModal.lastFocus;
  gamesModal.scrim = gamesModal.panel = gamesModal.lastFocus = gamesModal.onKey = null;
  if (restore && restore.focus) setTimeout(() => restore.focus(), 20);
}

function trapGamesTab(ev) {
  if (ev.key !== 'Tab' || !gamesModal.panel) return;
  const f = [...gamesModal.panel.querySelectorAll('button, input, [tabindex]')].filter((x) => !x.disabled && x.tabIndex !== -1);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
  else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
}

async function loadGames() {
  try { setGamesState(await api('/api/games')); }
  catch { /* ownership is optional chrome; leave it absent on failure */ }
}

async function loadTransfer() {
  try { state.transfer = await api('/api/transfer'); }
  catch { /* transfer topology is optional chrome; the route line stays hidden */ }
}

async function loadPlan() {
  try {
    const plan = await api(`/api/plan?scope=${encodeURIComponent(state.goalScope)}`);
    state.plan = Object.fromEntries(plan.species.map((s) => [s.entryKey, s]));
    state.planSummary = plan.summary;
    state.acquisitions = plan.acquisitions;
    state.planPhase = plan.phase ?? null;
  } catch { /* planner is optional chrome; the Planner view shows an empty state */ }
}

async function loadAcquire() {
  try {
    state.acquirePlan = await api(`/api/acquire?mode=${encodeURIComponent(state.acquireMode)}&rank=${encodeURIComponent(state.acquireRank)}&scope=${encodeURIComponent(state.goalScope)}`);
  } catch { state.acquirePlan = null; }
}
const verdictOf = (e) => state.plan[e.entryKey]?.verdict ?? null;
const needLabel = (id) => (id === 'bank' ? 'Pokémon Bank' : (gameLabel(id) ?? id.toUpperCase()));
/** Format a planner AND-of-ORs needs list, e.g. "Scarlet/Violet + any of …". */
function formatNeeds(needs) {
  if (!needs || !needs.length) return 'more games';
  return needs.map((hop) => (hop.length === 1 ? needLabel(hop[0]) : `any of ${hop.map(needLabel).join(' / ')}`)).join(' + ');
}

/* ---------- filters / gen ---------- */
function setGen(n) {
  state.gen = n;
  try { localStorage.setItem(GEN_KEY, String(n)); } catch { /* ignore */ }
  render();
}

function ingest(entries) {
  // The API nests the derived obtainability fields under `entry.obtainability`;
  // flatten them onto the entry so the obtainability zone/filters (which read
  // e.availability, e.gmaxCapable, …) light up when the API provides them.
  for (const e of entries) if (e.obtainability) Object.assign(e, e.obtainability);
  state.entries = entries;
  invalidateScope();
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
    viewRow: $('view-row'), viewChips: $('view-chips'),
    loading: $('loading'), skeleton: $('skeleton'), empty: $('empty'), emptyTitle: $('empty-title'),
    emptyBody: $('empty-body'), emptyAction: $('empty-action'), results: $('results'), resultLabel: $('result-label'),
    grid: $('grid'), importFile: $('import-file'), toast: $('toast'), mirrorBtn: $('mirror-btn'),
    gamesBtn: $('games-btn'), viewBtn: $('view-btn'), planner: $('planner'),
    filterRow: document.querySelector('.filter-row'), typeRow: document.querySelector('.type-row'),
  });

  try {
    const savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme === 'auto' || savedTheme === 'light' || savedTheme === 'dark') state.theme = savedTheme;
    const savedGen = parseInt(localStorage.getItem(GEN_KEY) ?? '', 10);
    if (Number.isInteger(savedGen) && savedGen >= 1 && savedGen <= 9) state.gen = savedGen;
    const savedMode = localStorage.getItem(ACQ_MODE_KEY);
    if (ACQUIRE_MODES.some((m) => m.key === savedMode)) state.acquireMode = savedMode;
    const savedRank = localStorage.getItem(ACQ_RANK_KEY);
    if (ACQUIRE_RANKS.some((r) => r.key === savedRank)) state.acquireRank = savedRank;
    const savedScope = localStorage.getItem(SCOPE_KEY);
    if (GOAL_SCOPES.some((g) => g.key === savedScope)) state.goalScope = savedScope;
    const savedView = localStorage.getItem(DEX_VIEW_KEY);
    if (DEX_VIEWS.some((v) => v.key === savedView)) state.dexView = savedView;
  } catch { /* ignore */ }
  syncTheme();

  const sk = document.createDocumentFragment();
  for (let i = 0; i < 24; i++) sk.append(document.createElement('div'));
  el.skeleton.replaceChildren(sk);

  el.themeBtn.addEventListener('click', cycleTheme);
  el.emptyAction.addEventListener('click', () => {
    state.status = 'all'; state.query = ''; state.types = []; state.obtain = { owned: false, switch: false, shiny: false, gmax: false, tera: false };
    state.gameFilter = ''; el.search.value = ''; render();
  });
  let searchTimer;
  el.search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.query = el.search.value; render(); }, 200); });
  el.gameSelect.addEventListener('change', () => { state.gameFilter = el.gameSelect.value; render(); });
  el.importFile.addEventListener('change', () => { const f = el.importFile.files && el.importFile.files[0]; if (f) onImport(f); el.importFile.value = ''; });
  el.mirrorBtn.addEventListener('click', mirrorSprites);
  el.gamesBtn.addEventListener('click', openGamesModal);
  el.viewBtn.addEventListener('click', () => { state.view = state.view === 'planner' ? 'dex' : 'planner'; render(); });
  pollMirror().catch(() => { el.mirrorBtn.hidden = true; });
  loadGames().then(render);
  loadTransfer().then(() => { if (sheet.key) { const e = state.entries.find((x) => x.entryKey === sheet.key); if (e) renderSheetInto(e, false); } });
  Promise.all([loadPlan(), loadAcquire()]).then(() => { if (state.view === 'planner') renderPlanner(); });

  state.loading = true;
  el.loading.hidden = false; el.results.hidden = true; el.empty.hidden = true;
  reload().then(() => { state.loading = false; render(); }).catch((err) => {
    state.loading = false; el.loading.hidden = true; toast(`Failed to load: ${err.message}`, true);
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
