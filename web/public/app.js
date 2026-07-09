/* Placeholder SPA for the Living Dex tracker. Vanilla JS, no build step.
   Speaks the /api contract; replaced wholesale by the Claude Design front-end. */
'use strict';

const GENDER_SYMBOL = { male: '♂', female: '♀', genderless: '—' };

const els = {
  grid: document.getElementById('grid'),
  q: document.getElementById('f-q'),
  gen: document.getElementById('f-gen'),
  type: document.getElementById('f-type'),
  status: document.getElementById('f-status'),
  summaryCount: document.getElementById('summary-count'),
  summaryBar: document.getElementById('summary-bar'),
  summaryPct: document.getElementById('summary-pct'),
  resultCount: document.getElementById('result-count'),
  message: document.getElementById('message'),
  importFile: document.getElementById('import-file'),
  cardTemplate: document.getElementById('card-template'),
};

let entries = [];

function showMessage(text, isError) {
  els.message.textContent = text;
  els.message.classList.toggle('error', Boolean(isError));
  els.message.hidden = false;
  clearTimeout(showMessage.timer);
  showMessage.timer = setTimeout(() => { els.message.hidden = true; }, 6000);
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

function filterParams() {
  const params = new URLSearchParams();
  if (els.q.value.trim()) params.set('q', els.q.value.trim());
  if (els.gen.value) params.set('gen', els.gen.value);
  if (els.type.value) params.set('type', els.type.value);
  if (els.status.value) params.set('status', els.status.value);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

async function refreshSummary() {
  const gen = els.gen.value;
  const summary = await api(`/api/summary${gen ? `?gen=${gen}` : ''}`);
  els.summaryCount.textContent = `${summary.caught} / ${summary.total}`;
  els.summaryPct.textContent = `${summary.pct}%`;
  els.summaryBar.style.width = `${summary.pct}%`;
  populateTypeOptions(summary.byType.map((t) => t.type));
}

function populateTypeOptions(types) {
  const current = els.type.value;
  if (els.type.options.length > 1) return; // populate once, from the unscoped summary
  for (const type of types) {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = type[0].toUpperCase() + type.slice(1);
    els.type.append(option);
  }
  els.type.value = current;
}

function populateGenOptions(list) {
  const gens = [...new Set(list.map((e) => e.generation))].sort((a, b) => a - b);
  while (els.gen.options.length > 1) els.gen.remove(1);
  for (const g of gens) {
    const option = document.createElement('option');
    option.value = String(g);
    option.textContent = `Gen ${g}`;
    els.gen.append(option);
  }
}

function renderCard(entry) {
  const card = els.cardTemplate.content.firstElementChild.cloneNode(true);
  card.dataset.entryKey = entry.entryKey;
  const caught = Boolean(entry.status && entry.status.caught);
  card.classList.toggle('caught', caught);
  card.setAttribute('aria-pressed', String(caught));
  card.title = `${entry.name}${entry.formLabel ? ` (${entry.formLabel})` : ''} — click to mark ${caught ? 'uncaught' : 'caught'}`;

  const img = card.querySelector('.sprite');
  img.src = entry.spriteUrl;
  img.alt = '';

  card.querySelector('.dex').textContent = `#${String(entry.dex).padStart(4, '0')}`;
  card.querySelector('.name').textContent = entry.name;
  card.querySelector('.form').textContent = entry.formLabel ?? '';
  card.querySelector('.gender').textContent = GENDER_SYMBOL[entry.gender] ?? '';
  card.querySelector('.gender').classList.add(entry.gender);

  const badges = card.querySelector('.badges');
  for (const type of entry.types) {
    const badge = document.createElement('span');
    badge.className = `badge type-${type}`;
    badge.textContent = type;
    badges.append(badge);
  }
  return card;
}

async function refreshEntries() {
  entries = await api(`/api/entries${filterParams()}`);
  els.resultCount.textContent = `${entries.length} entries`;
  const fragment = document.createDocumentFragment();
  for (const entry of entries) fragment.append(renderCard(entry));
  els.grid.replaceChildren(fragment);
}

async function toggleCaught(card) {
  const entry = entries.find((e) => e.entryKey === card.dataset.entryKey);
  if (!entry) return;
  // Guard with a data flag instead of `disabled`: disabling a focused button
  // drops keyboard focus, which breaks keyboard-only toggling.
  if (card.dataset.busy) return;
  const next = !(entry.status && entry.status.caught);
  card.dataset.busy = '1';
  card.setAttribute('aria-busy', 'true');
  try {
    entry.status = await api('/api/status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entryKey: entry.entryKey, caught: next }),
    });
    card.classList.toggle('caught', next);
    card.setAttribute('aria-pressed', String(next));
    await refreshSummary();
  } catch (err) {
    showMessage(`Failed to update: ${err.message}`, true);
  } finally {
    delete card.dataset.busy;
    card.removeAttribute('aria-busy');
  }
}

els.grid.addEventListener('click', (event) => {
  const card = event.target.closest('.card');
  if (card) toggleCaught(card);
});

let searchTimer;
els.q.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(refreshEntries, 250);
});
for (const el of [els.gen, els.type, els.status]) {
  el.addEventListener('change', () => {
    refreshEntries();
    if (el === els.gen) refreshSummary();
  });
}

els.importFile.addEventListener('change', async () => {
  const file = els.importFile.files[0];
  if (!file) return;
  const form = new FormData();
  form.append('file', file);
  try {
    const result = await api('/api/import', { method: 'POST', body: form });
    const skipped = result.unmatched.length
      ? ` — ${result.unmatched.length} unmatched row(s), first: line ${result.unmatched[0].line} (${result.unmatched[0].reason})`
      : '';
    showMessage(`Imported: ${result.matched} rows matched, ${result.updated} statuses updated${skipped}`, result.unmatched.length > 0);
    await Promise.all([refreshEntries(), refreshSummary()]);
  } catch (err) {
    showMessage(`Import failed: ${err.message}`, true);
  } finally {
    els.importFile.value = '';
  }
});

(async function init() {
  try {
    await refreshSummary();
    const all = await api('/api/entries');
    populateGenOptions(all);
    entries = all;
    els.resultCount.textContent = `${entries.length} entries`;
    const fragment = document.createDocumentFragment();
    for (const entry of entries) fragment.append(renderCard(entry));
    els.grid.replaceChildren(fragment);
  } catch (err) {
    showMessage(`Failed to load: ${err.message}`, true);
  }
})();
