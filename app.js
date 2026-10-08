'use strict';

/* ============================================================
   Tår – personlig barlager
   All data lagres lokalt i nettleseren (localStorage).
   ============================================================ */

// Nøkkelen beholdes uendret slik at eksisterende data ikke forsvinner.
const STORAGE_KEY = 'taar.data.v1';
const CATEGORIES = [
  'Vodka', 'Gin', 'Rom', 'Whisky', 'Tequila/Mezcal', 'Cognac/Brandy', 'Likør',
  'Bitter/Amaro', 'Vermut/Aperitiff', 'Vin', 'Musserende', 'Øl/Cider', 'Sirup', 'Mixer', 'Annet',
];
const LOG_TYPES = {
  start: 'Opprettet',
  mottak: 'Varemottak',
  svinn: 'Svinn/brukt',
  justering: 'Justering',
  telling: 'Telling',
};

/* ---------- Hjelpere ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const fmtNum = (n, d = 0) => Number(n || 0).toLocaleString('nb-NO', { minimumFractionDigits: d, maximumFractionDigits: d });
const kr = (n, d = 0) => `${fmtNum(n, d)} kr`;
const fmtDate = (iso) => new Date(iso).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDateTime = (iso) => new Date(iso).toLocaleString('nb-NO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const sum = (arr, fn) => arr.reduce((a, x) => a + fn(x), 0);

/* ---------- Lagring ---------- */
function defaultState() {
  return {
    version: 1,
    settings: { vatPct: 25, pricesIncludeVat: true, targetPourCost: 20, lastBackup: null },
    products: [],
    drinks: [],
    counts: [],
    log: [],
    draft: null,
  };
}

function migrate(data) {
  const d = defaultState();
  return { ...d, ...data, settings: { ...d.settings, ...(data.settings || {}) } };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? migrate(JSON.parse(raw)) : defaultState();
  } catch (e) {
    console.error(e);
    return defaultState();
  }
}

let state = load();
let persistRequested = false;

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('Klarte ikke å lagre! Ta en backup.');
  }
  if (!persistRequested && navigator.storage?.persist) {
    persistRequested = true;
    navigator.storage.persist().catch(() => {});
  }
  updateBadges();
}

/* ---------- Domenelogikk ---------- */
const product = (id) => state.products.find((p) => p.id === id);
const isBottle = (p) => p.unit !== 'stk';
const qtyLabel = (p, q) => (isBottle(p) ? `${fmtNum(q, 1)} fl` : `${fmtNum(q, q % 1 ? 1 : 0)} stk`);
const costPerCl = (p) => (isBottle(p) && p.sizeCl > 0 ? p.cost / p.sizeCl : 0);
const isLow = (p) => !!p.lowAlert && p.stock <= p.threshold;
const lowProducts = () => state.products.filter(isLow);
const productValue = (p) => p.stock * p.cost;
const totalValue = () => sum(state.products, productValue);
const orderQty = (p) => Math.max(0, Math.ceil((p.par > 0 ? p.par : p.threshold + 1) - p.stock));
const sortByName = (a, b) => a.name.localeCompare(b.name, 'nb');

function ingredientCost(ing) {
  const p = product(ing.productId);
  if (!p) return 0;
  return isBottle(p) ? ing.amount * costPerCl(p) : ing.amount * p.cost;
}
const drinkCost = (d) => sum(d.ingredients, ingredientCost);
function priceExVat(price) {
  const s = state.settings;
  return s.pricesIncludeVat ? price / (1 + s.vatPct / 100) : price;
}
function pourPct(cost, price) {
  const ex = priceExVat(price);
  return ex > 0 ? (cost / ex) * 100 : null;
}
function suggestedPrice(cost) {
  const s = state.settings;
  if (!s.targetPourCost) return 0;
  const ex = cost / (s.targetPourCost / 100);
  return s.pricesIncludeVat ? ex * (1 + s.vatPct / 100) : ex;
}
function pctClass(pct) {
  if (pct == null) return '';
  const t = state.settings.targetPourCost;
  if (pct <= t) return 'ok';
  if (pct <= t * 1.25) return 'warn';
  return 'bad';
}
const pctBadge = (pct) => `<span class="pct ${pctClass(pct)}">${pct == null ? '–' : fmtNum(pct, 1) + ' %'}</span>`;

function addLog(p, type, delta, note = '') {
  state.log.push({ id: uid(), date: new Date().toISOString(), productId: p.id, name: p.name, type, delta: round2(delta), after: p.stock, note });
  if (state.log.length > 3000) state.log = state.log.slice(-3000);
}

function adjustStock(p, delta, type) {
  const before = p.stock;
  p.stock = Math.max(0, round1(p.stock + delta));
  const wasLow = p.lowAlert && before <= p.threshold;
  addLog(p, type, p.stock - before);
  save();
  if (!wasLow && isLow(p)) toast(`⚠️ Lavt lager: ${p.name}`);
}

/* ---------- UI-infrastruktur ---------- */
const V = $('#view');
const sheet = $('#sheet');
const sheetBody = $('#sheet-body');
let toastTimer;

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function openSheet(html, onMount) {
  sheetBody.innerHTML = html;
  if (!sheet.open) sheet.showModal();
  sheetBody.scrollTop = 0;
  sheet.scrollTop = 0;
  if (onMount) onMount(sheetBody);
}
function closeSheet() { if (sheet.open) sheet.close(); }
sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });

/* ---------- Strekkodeskanner ----------
   iOS Safari har ikke BarcodeDetector, så vi bruker ZXing (lastes først ved behov). */
const SCAN_ICON = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h2v14H3zm4 0h1v14H7zm3 0h2v14h-2zm4 0h1v14h-1zm3 0h1v14h-1zm2 0h2v14h-2z"/></svg>';
let zxingLoading;
function loadZXing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  zxingLoading = zxingLoading || new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/zxing.min.js';
    s.onload = () => resolve(window.ZXing);
    s.onerror = () => { zxingLoading = null; reject(new Error('Kunne ikke laste skanneren')); };
    document.head.appendChild(s);
  });
  return zxingLoading;
}

// Åpner kamera i arket og gir tilbake koden (eller null hvis avbrutt). Arket står åpent etterpå.
function scanBarcode(title = 'Skann strekkode') {
  return new Promise((resolve) => {
    let reader = null;
    let finished = false;
    const finish = (code) => {
      if (finished) return;
      finished = true;
      sheet.removeEventListener('close', onClose);
      try { reader?.reset(); } catch (e) { /* ignorer */ }
      resolve(code);
    };
    const onClose = () => finish(null);
    openSheet(`
      <h2>${esc(title)}</h2>
      <div class="scanner"><video id="scan-video" playsinline muted autoplay></video><div class="scan-line"></div></div>
      <p class="hint" id="scan-status" style="margin:8px 0 12px">Starter kamera …</p>
      <form class="input-btn" id="scan-manual">
        <input type="text" name="code" inputmode="numeric" placeholder="… eller skriv inn koden" autocomplete="off" aria-label="Strekkode">
        <button class="btn">OK</button>
      </form>`, async (root) => {
      sheet.addEventListener('close', onClose);
      $('#scan-manual', root).addEventListener('submit', (e) => {
        e.preventDefault();
        const code = e.target.elements.code.value.replace(/\s+/g, '');
        if (code) finish(code);
      });
      const status = $('#scan-status', root);
      try {
        const ZX = await loadZXing();
        if (finished) return;
        const hints = new Map();
        hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [ZX.BarcodeFormat.EAN_13, ZX.BarcodeFormat.EAN_8,
          ZX.BarcodeFormat.UPC_A, ZX.BarcodeFormat.UPC_E, ZX.BarcodeFormat.CODE_128, ZX.BarcodeFormat.CODE_39, ZX.BarcodeFormat.QR_CODE]);
        reader = new ZX.BrowserMultiFormatReader(hints, 250);
        await reader.decodeFromConstraints({ audio: false, video: { facingMode: 'environment' } }, $('#scan-video', root), (result) => {
          if (result && !finished) {
            navigator.vibrate?.(60);
            finish(result.getText());
          }
        });
        if (!finished) status.textContent = 'Hold strekkoden inne i rammen.';
      } catch (err) {
        if (finished) return;
        status.textContent = err?.name === 'NotAllowedError'
          ? 'Ingen tilgang til kameraet. Tillat kamera for appen i Innstillinger, eller skriv inn koden.'
          : 'Fant ikke noe kamera. Skriv inn koden i stedet.';
      }
    });
  });
}

// Skann i Lager: åpne produktet, eller tilby å opprette/koble når koden er ukjent.
async function scanToProduct() {
  const code = await scanBarcode();
  if (!code) return;
  const p = productByBarcode(code);
  if (p) { openProduct(p.id); return; }
  openSheet(`
    <h2>Ukjent strekkode</h2>
    <p class="lead" style="margin-top:0">Koden <b class="num">${esc(code)}</b> er ikke koblet til noe produkt enda.</p>
    <button class="btn primary block" data-action="new-product-code" data-code="${esc(code)}">Nytt produkt med denne koden</button>
    ${state.products.length ? `
      <h3>Eller koble til eksisterende</h3>
      <form data-form="link-barcode" data-code="${esc(code)}" class="input-btn">
        <select name="productId" required>${productSelect('')}</select>
        <button class="btn">Koble</button>
      </form>` : ''}`);
}

// Skann under telling: hopp til produktet i listen.
async function scanInCount() {
  const code = await scanBarcode('Skann for å finne produkt');
  if (!code) return;
  const p = productByBarcode(code);
  closeSheet();
  if (!p) { toast('Ukjent strekkode – koble den til et produkt under Lager'); return; }
  countFilter.q = '';
  countFilter.cat = '';
  if ($('#cnt-q')) { $('#cnt-q').value = ''; $('#cnt-cat').value = ''; }
  renderCountList();
  const row = $(`.count-row[data-id="${p.id}"]`);
  if (row) {
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.remove('flash');
    void row.offsetWidth;
    row.classList.add('flash');
  }
}

async function scanIntoForm(form) {
  const draft = readProductForm(form);
  const id = form.dataset.id;
  const code = await scanBarcode();
  productForm(id ? product(id) : null, code ? { ...draft, barcode: code } : draft);
}

function setTitle(t) { $('#title').textContent = t; document.title = `${t} · Tår`; }

function updateBadges() {
  const low = lowProducts().length;
  const b = $('#badge-low');
  b.hidden = !low;
  b.textContent = low;
  $('#badge-count').hidden = !state.draft;
  if ('setAppBadge' in navigator) {
    (low ? navigator.setAppBadge(low) : navigator.clearAppBadge()).catch(() => {});
  }
}

function categoryOptions(selected, includeAll) {
  const used = new Set(state.products.map((p) => p.category));
  const cats = includeAll ? CATEGORIES.filter((c) => used.has(c)) : CATEGORIES;
  return (includeAll ? `<option value="">Alle kategorier</option>` : '') +
    cats.map((c) => `<option ${c === selected ? 'selected' : ''}>${esc(c)}</option>`).join('');
}

function groupByCategory(list) {
  const groups = new Map();
  for (const c of CATEGORIES) groups.set(c, []);
  for (const p of list) (groups.get(p.category) || groups.get('Annet')).push(p);
  return [...groups].filter(([, items]) => items.length).map(([cat, items]) => [cat, items.sort(sortByName)]);
}

function matchesQuery(p, q) {
  if (!q) return true;
  q = q.toLowerCase();
  return p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q) ||
    (p.supplier || '').toLowerCase().includes(q) || (p.barcode || '') === q;
}

/* ---------- Ruting ---------- */
const routes = {
  oversikt: renderDashboard,
  lager: renderInventory,
  telling: renderCount,
  drinker: renderDrinks,
  mer: renderMore,
  historikk: renderHistory,
  logg: renderLog,
  rapport: renderReport,
};
const tabFor = { historikk: 'mer', logg: 'mer', rapport: 'mer' };

function render() {
  const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  const route = routes[name] ? name : 'oversikt';
  const tab = tabFor[route] || route;
  $$('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  document.body.classList.toggle('report-mode', route === 'rapport');
  routes[route](arg ? decodeURIComponent(arg) : undefined);
  updateBadges();
}
window.addEventListener('hashchange', () => { closeSheet(); render(); window.scrollTo(0, 0); });
const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };

/* ============================================================
   OVERSIKT
   ============================================================ */
function renderDashboard() {
  setTitle('Oversikt');
  if (!state.products.length) {
    V.innerHTML = `
      <div class="card empty">
        <div class="hero"><div class="logo" role="img" aria-label="Tår"></div><div class="tagline">Cocktails &amp; kaffe</div></div>
        <p>Legg inn produktene i baren, tell beholdningen og få varsel når noe begynner å gå tomt.</p>
        <div class="btn-row">
          <button class="btn primary" data-action="bulk-add">Legg til produkter</button>
          <button class="btn" data-action="load-demo">Prøv med eksempeldata</button>
        </div>
      </div>`;
    return;
  }

  const low = lowProducts().sort(sortByName);
  const last = state.counts[state.counts.length - 1];
  const drinks = state.drinks.map((d) => pourPct(drinkCost(d), d.price)).filter((x) => x != null);
  const avgPct = drinks.length ? sum(drinks, (x) => x) / drinks.length : null;
  const overTarget = drinks.filter((x) => x > state.settings.targetPourCost).length;
  const latestActual = (() => {
    for (let i = state.counts.length - 1; i > 0; i--) {
      const c = state.counts[i];
      if (!c.sales) continue;
      const rows = periodUsage(c, state.counts[i - 1]);
      return { c, a: pourAnalysis(c, rows, sum(rows, (r) => r.usedValue)) };
    }
    return null;
  })();
  const noPrice = state.products.filter((p) => !(p.cost > 0)).length;
  const daysSinceBackup = state.settings.lastBackup ? (Date.now() - new Date(state.settings.lastBackup)) / 864e5 : Infinity;

  V.innerHTML = `
    <div class="stats">
      <div class="stat"><div class="label">Lagerverdi</div><div class="value">${kr(totalValue())}</div></div>
      <div class="stat"><div class="label">Produkter</div><div class="value">${state.products.length}</div></div>
      <a class="stat ${low.length ? 'alert' : ''}" href="#/lager" data-action="show-low" style="text-decoration:none;color:inherit">
        <div class="label">Lavt lager</div><div class="value">${low.length}</div></a>
    </div>

    ${state.draft ? `
      <div class="card">
        <div class="card-head"><h2>Telling pågår</h2><a class="btn small primary" href="#/telling">Fortsett</a></div>
        <div class="muted small">Startet ${fmtDateTime(state.draft.startedAt)}</div>
      </div>` : ''}

    <div class="card">
      <div class="card-head">
        <h2>Lavt lager</h2>
        ${low.length ? `<button class="btn small" data-action="copy-shopping">Kopier handleliste</button>` : ''}
      </div>
      ${low.length ? lowBySupplier().map(([sup, ps], i, all) => `
        ${all.length > 1 || sup !== NO_SUPPLIER ? `
          <div class="supplier-head">
            <div class="group-label" style="margin:${i ? 14 : 2}px 4px 6px">${esc(sup)}</div>
            <button class="linkbtn small" data-action="copy-shopping" data-supplier="${esc(sup)}">Del</button>
          </div>` : ''}
        <div class="list" style="margin:0">${ps.map((p) => `
        <div class="row" data-action="open-product" data-id="${p.id}">
          <div class="row-main">
            <div class="row-title">${esc(p.name)}</div>
            <div class="row-sub">Igjen: ${qtyLabel(p, p.stock)} · varsel ved ${qtyLabel(p, p.threshold)}</div>
          </div>
          <div class="row-end"><span class="tag low">Bestill ${orderQty(p)}</span></div>
        </div>`).join('')}</div>`).join('')
      : `<p class="muted" style="margin:0">Ingen varsler. ${state.products.some((p) => p.lowAlert) ? 'Alt er over grensen 👍' : 'Slå på «Varsle ved lavt lager» på produktene du vil følge med på.'}</p>`}
    </div>

    <div class="card">
      <div class="card-head"><h2>Siste telling</h2>
        ${state.draft ? '' : `<a class="btn small" href="#/telling">Ny telling</a>`}</div>
      ${last ? `
        <p style="margin:0">${fmtDate(last.date)} · <b>${kr(last.value)}</b></p>
        <p class="muted small" style="margin:.2rem 0 0">${daysAgo(last.date)} · <a href="#/historikk/${last.id}">Se forbruk</a> · <a href="#/rapport/${last.id}">Rapport</a></p>`
      : `<p class="muted" style="margin:0">Ingen tellinger enda.</p>`}
    </div>

    <div class="card">
      <div class="card-head"><h2>Pour cost</h2><a class="btn small" href="#/drinker">Drinker</a></div>
      ${avgPct != null ? `
        <p style="margin:0">Snitt ${pctBadge(avgPct)} &nbsp;mål ${fmtNum(state.settings.targetPourCost)} %</p>
        <p class="muted small" style="margin:.4rem 0 0">${overTarget ? `${overTarget} av ${drinks.length} drinker er over målet.` : `Alle ${drinks.length} drinker er innenfor målet.`}</p>`
      : `<p class="muted" style="margin:0">Legg inn drinker med oppskrift og pris for å se pour cost.</p>`}
      ${latestActual ? `
        <p style="margin:.6rem 0 0">Faktisk ${pctBadge(latestActual.a.actualPct)} &nbsp;<span class="muted small">perioden til
          <a href="#/historikk/${latestActual.c.id}">${fmtDate(latestActual.c.date)}</a></span></p>` : ''}
    </div>

    ${noPrice ? `
      <div class="card">
        <div class="card-head"><h2>Mangler pris</h2><button class="btn small" data-action="show-noprice">Vis</button></div>
        <p class="muted small" style="margin:0">${noPrice} produkter har ingen innkjøpspris. Uten pris blir lagerverdi og pour cost for lave.</p>
      </div>` : ''}

    ${daysSinceBackup > 14 ? `
      <div class="card">
        <h2>💾 Ta en backup</h2>
        <p class="muted small" style="margin-top:0">Dataene ligger kun på denne enheten. ${state.settings.lastBackup ? `Siste backup var ${fmtDate(state.settings.lastBackup)}.` : 'Du har ikke tatt backup enda.'}</p>
        <button class="btn block" data-action="export-json">Del / last ned backup</button>
      </div>` : ''}
  `;
}

function daysAgo(iso) {
  const d = Math.floor((Date.now() - new Date(iso)) / 864e5);
  return d <= 0 ? 'I dag' : d === 1 ? 'I går' : `${d} dager siden`;
}

/* ============================================================
   LAGER
   ============================================================ */
const invFilter = { q: '', cat: '', low: false, noPrice: false };

function renderInventory() {
  setTitle('Lager');
  V.innerHTML = `
    <div class="toolbar">
      <input type="search" id="inv-q" placeholder="Søk produkt…" value="${esc(invFilter.q)}" autocomplete="off">
      <select id="inv-cat">${categoryOptions(invFilter.cat, true)}</select>
      <label class="chip"><input type="checkbox" id="inv-low" ${invFilter.low ? 'checked' : ''}> Kun lavt</label>
      <label class="chip"><input type="checkbox" id="inv-noprice" ${invFilter.noPrice ? 'checked' : ''}> Mangler pris</label>
      <button class="chip" data-action="scan-product">${SCAN_ICON} Skann</button>
      <button class="chip" data-action="bulk-add">+ Legg til mange</button>
    </div>
    <div id="inv-summary" class="muted small" style="margin:0 4px 4px"></div>
    <div id="inv-list"></div>
    <button class="fab" data-action="new-product" aria-label="Nytt produkt">+</button>`;
  $('#inv-q').addEventListener('input', (e) => { invFilter.q = e.target.value; renderInventoryList(); });
  $('#inv-cat').addEventListener('change', (e) => { invFilter.cat = e.target.value; renderInventoryList(); });
  $('#inv-low').addEventListener('change', (e) => { invFilter.low = e.target.checked; renderInventoryList(); });
  $('#inv-noprice').addEventListener('change', (e) => { invFilter.noPrice = e.target.checked; renderInventoryList(); });
  renderInventoryList();
}

function renderInventoryList() {
  const list = $('#inv-list');
  if (!list) return;
  const items = state.products.filter((p) =>
    matchesQuery(p, invFilter.q) && (!invFilter.cat || p.category === invFilter.cat) && (!invFilter.low || isLow(p)) && (!invFilter.noPrice || !(p.cost > 0)));
  $('#inv-summary').textContent = `${items.length} produkter · ${kr(sum(items, productValue))}`;
  if (!items.length) {
    list.innerHTML = `<div class="card empty">${state.products.length ? 'Ingen treff.' :
      'Ingen produkter enda. Trykk på + for å legge til.'}</div>`;
    return;
  }
  list.innerHTML = groupByCategory(items).map(([cat, ps]) => `
    <div class="group-label">${esc(cat)}</div>
    <div class="list">${ps.map(inventoryRow).join('')}</div>`).join('');
}

function inventoryRow(p) {
  const sub = [isBottle(p) ? `${fmtNum(p.sizeCl)} cl` : 'stk', kr(p.cost)].join(' · ');
  return `
    <div class="row" data-action="open-product" data-id="${p.id}">
      <div class="row-main">
        <div class="row-title">${esc(p.name)}${isLow(p) ? '<span class="tag low">Lavt</span>' : ''}</div>
        <div class="row-sub">${sub}${p.lowAlert ? ` · 🔔 ${fmtNum(p.threshold, p.threshold % 1 ? 1 : 0)}` : ''}</div>
      </div>
      <div class="stepper">
        <button data-action="adj" data-id="${p.id}" data-d="-1" aria-label="Trekk fra én">−</button>
        <span class="qty">${qtyLabel(p, p.stock)}</span>
        <button data-action="adj" data-id="${p.id}" data-d="1" aria-label="Legg til én">+</button>
      </div>
    </div>`;
}

function refreshCurrent() {
  if ($('#inv-list')) renderInventoryList();
  else render();
}

/* ---------- Produktark ---------- */
function openProduct(id) {
  const p = product(id);
  if (!p) return;
  const usedIn = state.drinks.filter((d) => d.ingredients.some((i) => i.productId === id));
  const logs = state.log.filter((l) => l.productId === id).slice(-6).reverse();
  const step = isBottle(p) ? '0.1' : '1';
  openSheet(`
    <h2>${esc(p.name)}</h2>
    <div class="muted small">${[esc(p.category), isBottle(p) ? `${fmtNum(p.sizeCl)} cl flaske` : 'per stk', esc(p.supplier)].filter(Boolean).join(' · ')}</div>
    <div class="big-stock" style="margin-top:10px">${qtyLabel(p, p.stock)}
      ${isLow(p) ? '<span class="tag low" style="font-size:.8rem">Lavt lager</span>' : ''}</div>

    <div class="kv">
      <div><span>Lagerverdi</span><b>${kr(productValue(p))}</b></div>
      <div><span>${isBottle(p) ? 'Kost per cl' : 'Kost per stk'}</span><b>${isBottle(p) ? kr(costPerCl(p), 2) : kr(p.cost, 2)}</b></div>
      <div><span>Varsel</span><b>${p.lowAlert ? `ved ${qtyLabel(p, p.threshold)}` : 'Av'}</b></div>
      <div><span>Bestill opp til</span><b>${p.par > 0 ? qtyLabel(p, p.par) : '–'}</b></div>
    </div>

    <form data-form="move" data-id="${p.id}">
      <label class="field"><span>Registrer bevegelse</span>
        <div class="input-suffix"><input type="number" name="amount" inputmode="decimal" step="${step}" min="0" value="1" required>
        <em>${isBottle(p) ? 'fl' : 'stk'}</em></div></label>
      <div class="btn-row" style="margin-top:0">
        <button class="btn primary" name="type" value="mottak">+ Varemottak</button>
        <button class="btn" name="type" value="svinn">− Svinn/brukt</button>
      </div>
    </form>

    ${usedIn.length ? `<h3>Brukes i</h3><p style="margin:0">${usedIn.map((d) => esc(d.name)).join(', ')}</p>` : ''}
    ${p.notes ? `<h3>Notater</h3><p style="margin:0;white-space:pre-wrap">${esc(p.notes)}</p>` : ''}

    ${logs.length ? `<h3>Siste bevegelser</h3>
      <table><tbody>${logs.map((l) => `
        <tr><td>${fmtDateTime(l.date)}</td><td>${LOG_TYPES[l.type] || l.type}</td>
        <td class="n">${l.delta > 0 ? '+' : ''}${fmtNum(l.delta, l.delta % 1 ? 1 : 0)}</td></tr>`).join('')}
      </tbody></table>` : ''}

    <div class="btn-row">
      <button class="btn" data-action="edit-product" data-id="${p.id}">Rediger produkt</button>
      ${p.cost > 0 ? '' : `<a class="btn" target="_blank" rel="noopener" href="${vmpUrl(p.name)}">Vinmonopolet ↗</a>`}
    </div>`);
}

const suppliers = () => [...new Set(state.products.map((p) => p.supplier).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'nb'));
const productByBarcode = (code) => state.products.find((p) => p.barcode && p.barcode === code);

// p = eksisterende produkt (eller null for nytt), draft = verdier som overstyrer (f.eks. etter skanning)
const vmpUrl = (name) => `https://www.vinmonopolet.no/search?q=${encodeURIComponent((name || '').trim())}`;

function productForm(p, draft = {}) {
  const isNew = !p;
  const v = { name: '', category: 'Gin', unit: 'flaske', sizeCl: 70, cost: '', stock: 0, lowAlert: true, threshold: 1, par: 3,
    supplier: '', barcode: '', notes: '', ...(p || {}), ...draft };
  const unit = v.unit === 'stk' ? 'stk' : 'fl';
  openSheet(`
    <h2>${isNew ? 'Nytt produkt' : 'Rediger produkt'}</h2>
    <form data-form="product" data-id="${isNew ? '' : p.id}">
      <label class="field"><span>Navn</span>
        <input type="text" name="name" value="${esc(v.name)}" required placeholder="F.eks. Tanqueray London Dry"></label>
      <div class="field-row">
        <label class="field"><span>Kategori</span><select name="category">${categoryOptions(v.category)}</select></label>
        <label class="field"><span>Enhet</span>
          <select name="unit">
            <option value="flaske" ${v.unit !== 'stk' ? 'selected' : ''}>Flaske</option>
            <option value="stk" ${v.unit === 'stk' ? 'selected' : ''}>Stk (boks, kartong …)</option>
          </select></label>
      </div>
      <div class="field-row">
        <label class="field bottle-only"><span>Flaskestørrelse</span>
          <div class="input-suffix"><input type="number" name="sizeCl" inputmode="decimal" min="1" step="any" value="${v.sizeCl}"><em>cl</em></div></label>
        <label class="field"><span class="cost-label">Innkjøpspris per ${v.unit === 'stk' ? 'stk' : 'flaske'}</span>
          <div class="input-suffix"><input type="number" name="cost" inputmode="decimal" min="0" step="any" value="${v.cost}" placeholder="0"><em>kr</em></div></label>
      </div>
      <div class="price-help">
        <label class="check"><input type="checkbox" name="costInclVat"> Prisen er inkl. mva – trekk fra ${fmtNum(state.settings.vatPct)} %</label>
        <a class="vmp-link" target="_blank" rel="noopener" href="${vmpUrl(v.name)}">Finn pris på Vinmonopolet ↗</a>
      </div>
      <label class="field"><span>Beholdning nå</span>
        <div class="input-suffix"><input type="number" name="stock" inputmode="decimal" min="0" step="any" value="${v.stock}"><em class="unit-suffix">${unit}</em></div></label>
      <p class="hint bottle-only">Bruk desimaler for åpne flasker, f.eks. 2,4 = to fulle og en på 40 %.</p>

      <label class="check"><input type="checkbox" name="lowAlert" ${v.lowAlert ? 'checked' : ''}> Varsle ved lavt lager</label>
      <div class="field-row alert-fields">
        <label class="field"><span>Varsle når ≤</span>
          <div class="input-suffix"><input type="number" name="threshold" inputmode="decimal" min="0" step="any" value="${v.threshold}"><em class="unit-suffix">${unit}</em></div></label>
        <label class="field"><span>Bestill opp til</span>
          <div class="input-suffix"><input type="number" name="par" inputmode="decimal" min="0" step="any" value="${v.par || ''}" placeholder="valgfritt"><em class="unit-suffix">${unit}</em></div></label>
      </div>

      <label class="field"><span>Leverandør</span>
        <input type="text" name="supplier" value="${esc(v.supplier)}" list="supplier-list" placeholder="Hvem du bestiller fra" autocomplete="off">
        <datalist id="supplier-list">${suppliers().map((s) => `<option value="${esc(s)}">`).join('')}</datalist></label>

      <div class="field"><span class="muted small">Strekkode</span>
        <div class="input-btn">
          <input type="text" name="barcode" value="${esc(v.barcode)}" inputmode="numeric" placeholder="Ingen" autocomplete="off" aria-label="Strekkode">
          <button type="button" class="btn" data-action="scan-into-form">${SCAN_ICON} Skann</button>
        </div>
      </div>

      <label class="field"><span>Notater</span><textarea name="notes" rows="2" placeholder="Hylleplass, smak …">${esc(v.notes)}</textarea></label>

      <div class="btn-row">
        ${isNew ? '' : `<button type="button" class="btn danger" data-action="delete-product" data-id="${p.id}">Slett</button>`}
        <button class="btn primary">${isNew ? 'Legg til' : 'Lagre'}</button>
      </div>
    </form>`, (root) => {
    const form = $('form', root);
    const sync = () => {
      const stk = form.elements.unit.value === 'stk';
      $$('.bottle-only', form).forEach((el) => { el.hidden = stk; });
      $$('.unit-suffix', form).forEach((el) => { el.textContent = stk ? 'stk' : 'fl'; });
      $('.cost-label', form).textContent = `Innkjøpspris per ${stk ? 'stk' : 'flaske'}`;
      $('.alert-fields', form).style.opacity = form.elements.lowAlert.checked ? 1 : 0.4;
    };
    form.addEventListener('change', sync);
    form.elements.name.addEventListener('input', () => { $('.vmp-link', form).href = vmpUrl(form.elements.name.value); });
    sync();
    if (isNew && !v.name) form.elements.name.focus();
  });
}

function readProductForm(form) {
  const f = form.elements;
  return {
    name: f.name.value.trim(),
    category: f.category.value,
    unit: f.unit.value,
    sizeCl: Math.max(1, num(f.sizeCl.value) || 70),
    cost: round2(Math.max(0, num(f.cost.value)) / (f.costInclVat.checked ? 1 + state.settings.vatPct / 100 : 1)),
    lowAlert: f.lowAlert.checked,
    threshold: Math.max(0, num(f.threshold.value)),
    par: Math.max(0, num(f.par.value)),
    supplier: f.supplier.value.trim(),
    barcode: f.barcode.value.replace(/\s+/g, ''),
    notes: f.notes.value.trim(),
    stock: Math.max(0, round1(num(f.stock.value))),
  };
}

function saveProduct(form) {
  const { stock, ...data } = readProductForm(form);
  if (!data.name) return toast('Produktet må ha et navn');
  const id = form.dataset.id;
  const clash = data.barcode && productByBarcode(data.barcode);
  if (clash && clash.id !== id) return toast(`Strekkoden er allerede brukt på ${clash.name}`);
  let p;
  if (id) {
    p = product(id);
    Object.assign(p, data);
    if (stock !== p.stock) {
      const before = p.stock;
      p.stock = stock;
      addLog(p, 'justering', stock - before);
    }
    toast('Lagret');
  } else {
    p = { id: uid(), ...data, stock, createdAt: new Date().toISOString() };
    state.products.push(p);
    addLog(p, 'start', stock);
    toast(`${data.name} lagt til`);
  }
  save();
  closeSheet();
  refreshCurrent();
}

/* ---------- Legg til mange produkter på én gang ----------
   Én linje per produkt: Navn; Kategori; Størrelse; Innkjøpspris; Antall; Leverandør
   Bare navnet er påkrevd. Skilletegn kan være semikolon eller tabulator (lim inn fra Excel). */
const CATEGORY_WORDS = [
  ['Gin', /\bgin\b|genever|tanqueray|hendrick|bombay|beefeater|monkey 47|gordon/i],
  ['Vodka', /vodka|absolut|smirnoff|belvedere|grey goose|ketel one|finlandia/i],
  ['Rom', /\brum\b|\brom\b|rhum|havana|bacardi|diplomatico|plantation|kraken|appleton|zacapa|captain morgan/i],
  ['Whisky', /whisk|bourbon|scotch|jameson|jack daniel|maker'?s mark|bulleit|laphroaig|glen|talisker|johnnie walker|lagavulin|rye/i],
  ['Tequila/Mezcal', /tequila|mezcal|\b1800\b|olmeca|patr[oó]n|don julio|espol[oó]n|casamigos|del maguey|ocho/i],
  ['Cognac/Brandy', /cognac|brandy|armagnac|calvados|hennessy|r[eé]my|martell|pisco/i],
  ['Bitter/Amaro', /amaro|bitter|campari|aperol|fernet|cynar|montenegro|averna|angostura|suze/i],
  ['Vermut/Aperitiff', /verm[ou]|martini (rosso|bianco|extra)|noilly|cocchi|carpano|antica formula|dolin|lillet|punt e mes|sherry|port/i],
  ['Likør', /lik[øo]r|liqueur|cointreau|triple sec|chartreuse|amaretto|kahl[uú]a|baileys|st[- ]germain|maraschino|cr[eè]me de|falernum|licor 43|galliano|benedictine|drambuie|curacao/i],
  ['Musserende', /prosecco|champagne|cava|cr[eé]mant|musserende|spumante|sekt/i],
  ['Vin', /\bvin\b|wine|riesling|chardonnay|pinot|sauvignon|merlot|cabernet|rioja|chianti|barolo/i],
  ['Øl/Cider', /\b[øo]l\b|beer|lager|\bipa\b|pils|stout|cider|ale\b/i],
  ['Sirup', /sirup|syrup|orgeat|grenadine|monin|agave/i],
  ['Mixer', /tonic|soda|ginger (ale|beer)|cola|fever[- ]tree|schweppes|juice|lemonade|sprite|farris|bris/i],
];
function guessCategory(name) {
  return CATEGORY_WORDS.find(([, re]) => re.test(name))?.[0] || null;
}
function matchCategory(text) {
  const t = (text || '').trim().toLowerCase();
  if (!t) return null;
  return CATEGORIES.find((c) => c.toLowerCase() === t || c.toLowerCase().split('/').includes(t)) ||
    guessCategory(t) || null;
}
// "70", "70cl", "0,7l", "1 l", "75 cl" -> cl
function parseSizeCl(text) {
  const m = String(text || '').replace(',', '.').match(/([\d.]+)\s*(cl|ml|l)?/i);
  if (!m) return null;
  let v = parseFloat(m[1]);
  const u = (m[2] || '').toLowerCase();
  if (u === 'l' || (!u && v <= 3)) v *= 100;
  else if (u === 'ml') v /= 10;
  return v > 0 ? Math.round(v * 10) / 10 : null;
}

function parseBulk(text, defaults) {
  const existing = new Set(state.products.map((p) => p.name.trim().toLowerCase()));
  const seen = new Set();
  const items = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:[•\-*–]|\d+[.)])\s+/, '').trim(); // fjern punkttegn/nummerering
    if (!line) continue;
    const cols = line.split(/\t|;/).map((s) => s.trim());
    const name = cols[0];
    if (!name || /^navn$/i.test(name)) continue; // hopp over overskriftslinje
    const key = name.toLowerCase();
    if (existing.has(key) || seen.has(key)) { skipped++; continue; }
    seen.add(key);
    const category = matchCategory(cols[1]) || guessCategory(name) || defaults.category;
    const isStk = /\bstk\b/i.test(cols[2] || '') || (!cols[2] && (category === 'Mixer' || category === 'Øl/Cider'));
    items.push({
      name,
      category,
      unit: isStk ? 'stk' : 'flaske',
      sizeCl: parseSizeCl(cols[2]) || (category === 'Musserende' || category === 'Vin' || category === 'Vermut/Aperitiff' ? 75 : defaults.sizeCl),
      cost: Math.max(0, num(cols[3])),
      stock: Math.max(0, round1(num(cols[4]))),
      supplier: cols[5] || defaults.supplier,
    });
  }
  return { items, skipped };
}

function bulkForm(prefill = '') {
  openSheet(`
    <h2>Legg til mange</h2>
    <p class="lead" style="margin-top:0">Ett produkt per linje. Bare navnet er nødvendig – resten kan du fylle inn senere.</p>
    <form data-form="bulk">
      <label class="field"><span>Produkter</span>
        <textarea name="text" rows="9" placeholder="Tanqueray London Dry; Gin; 70; 329; 3
Campari; Bitter; 70cl; 279; 2,5
Absolut Vodka
Fever-Tree Tonic; Mixer; stk; 14; 24" style="font-size:.9rem">${esc(prefill)}</textarea></label>
      <p class="hint">Rekkefølge: <b>Navn; Kategori; Størrelse; Innkjøpspris; Antall; Leverandør</b>. Kategori gjettes ut fra navnet hvis den mangler.
        Du kan også lime inn rett fra Excel.</p>
      <div class="field-row">
        <label class="field"><span>Standard kategori</span><select name="category">${categoryOptions('Annet')}</select></label>
        <label class="field"><span>Standard størrelse</span>
          <div class="input-suffix"><input type="number" name="sizeCl" inputmode="decimal" min="1" step="any" value="70"><em>cl</em></div></label>
      </div>
      <label class="field"><span>Leverandør (valgfritt)</span>
        <input type="text" name="supplier" list="supplier-list-bulk" autocomplete="off" placeholder="Brukes når linjen ikke har leverandør">
        <datalist id="supplier-list-bulk">${suppliers().map((s) => `<option value="${esc(s)}">`).join('')}</datalist></label>
      <label class="check"><input type="checkbox" name="lowAlert" checked> Varsle ved lavt lager (ved 1 igjen)</label>
      <div class="calc" id="bulk-preview" style="display:block"></div>
      <div class="btn-row">
        <label class="btn" style="flex:0 0 auto">Velg fil<input type="file" accept=".csv,.txt,text/csv,text/plain" hidden id="bulk-file"></label>
        <button class="btn primary" id="bulk-submit">Legg til</button>
      </div>
    </form>`, (root) => {
    const form = $('form', root);
    const update = () => {
      const { items, skipped } = parseBulk(form.elements.text.value, bulkDefaults(form));
      const cats = {};
      for (const i of items) cats[i.category] = (cats[i.category] || 0) + 1;
      $('#bulk-preview', root).innerHTML = items.length
        ? `<b>${items.length} nye produkter</b>${skipped ? ` · ${skipped} finnes fra før og hoppes over` : ''}<br>
           <span class="muted small">${Object.entries(cats).map(([c, n]) => `${esc(c)} ${n}`).join(' · ')}</span>`
        : `<span class="muted">${skipped ? `${skipped} finnes fra før.` : 'Skriv eller lim inn produkter over.'}</span>`;
      $('#bulk-submit', root).disabled = !items.length;
    };
    form.addEventListener('input', update);
    form.addEventListener('change', update);
    $('#bulk-file', root).addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      form.elements.text.value = await f.text();
      update();
    });
    update();
  });
}

function bulkDefaults(form) {
  const f = form.elements;
  return { category: f.category.value, sizeCl: Math.max(1, num(f.sizeCl.value) || 70), supplier: f.supplier.value.trim() };
}

function saveBulk(form) {
  const { items } = parseBulk(form.elements.text.value, bulkDefaults(form));
  if (!items.length) return;
  const lowAlert = form.elements.lowAlert.checked;
  const now = new Date().toISOString();
  for (const i of items) {
    const p = { id: uid(), ...i, lowAlert, threshold: 1, par: 0, barcode: '', notes: '', createdAt: now };
    state.products.push(p);
    addLog(p, 'start', p.stock);
  }
  save();
  closeSheet();
  toast(`${items.length} produkter lagt til`);
  invFilter.q = '';
  invFilter.cat = '';
  invFilter.low = false;
  go('#/lager');
}

function deleteProduct(id) {
  const p = product(id);
  const usedIn = state.drinks.filter((d) => d.ingredients.some((i) => i.productId === id));
  const msg = `Slette «${p.name}»?` + (usedIn.length ? `\n\nDen fjernes også fra: ${usedIn.map((d) => d.name).join(', ')}.` : '');
  if (!confirm(msg)) return;
  state.products = state.products.filter((x) => x.id !== id);
  for (const d of usedIn) d.ingredients = d.ingredients.filter((i) => i.productId !== id);
  if (state.draft) delete state.draft.items[id];
  save();
  closeSheet();
  toast('Produkt slettet');
  refreshCurrent();
}

/* ============================================================
   TELLING
   ============================================================ */
const countFilter = { q: '', cat: '' };

function draftItem(p) {
  const items = state.draft.items;
  if (!items[p.id]) {
    const full = isBottle(p) ? Math.floor(p.stock + 1e-9) : p.stock;
    items[p.id] = { full, open: isBottle(p) ? round1(p.stock - full) : 0, done: false };
  }
  return items[p.id];
}

function renderCount() {
  setTitle('Telling');
  if (!state.draft) {
    const recent = state.counts.slice(-5).reverse();
    V.innerHTML = `
      <div class="card">
        <h2>Ny telling</h2>
        <p class="lead" style="margin-top:0">Gå gjennom hylla og registrer fulle flasker og åpne flasker i tideler.
          Tallene er forhåndsutfylt med dagens beholdning, så du trenger bare å rette det som avviker.
          Du kan ta pauser underveis, og fremdriften lagres automatisk.</p>
        <button class="btn primary block" data-action="count-start" ${state.products.length ? '' : 'disabled'}>Start telling</button>
        ${state.products.length ? '' : '<p class="hint" style="margin-top:8px">Legg til produkter først.</p>'}
      </div>
      ${recent.length ? `
        <div class="group-label">Tidligere tellinger</div>
        <div class="list">${recent.map(countRow).join('')}</div>
        <a href="#/historikk" class="small">Se alle</a>` : ''}`;
    return;
  }

  V.innerHTML = `
    <div class="toolbar">
      <input type="search" id="cnt-q" placeholder="Søk…" value="${esc(countFilter.q)}" autocomplete="off">
      <select id="cnt-cat">${categoryOptions(countFilter.cat, true)}</select>
      <button class="chip" data-action="scan-count">${SCAN_ICON} Skann</button>
    </div>
    <div id="cnt-list"></div>
    <div class="count-footer">
      <div class="progress"><span id="cnt-progress"></span><div class="bar"><i id="cnt-bar"></i></div></div>
      <button class="btn small" data-action="count-cancel">Avbryt</button>
      <button class="btn small primary" data-action="count-finish">Fullfør</button>
    </div>`;
  $('#cnt-q').addEventListener('input', (e) => { countFilter.q = e.target.value; renderCountList(); });
  $('#cnt-cat').addEventListener('change', (e) => { countFilter.cat = e.target.value; renderCountList(); });
  renderCountList();
}

function renderCountList() {
  const items = state.products.filter((p) => matchesQuery(p, countFilter.q) && (!countFilter.cat || p.category === countFilter.cat));
  $('#cnt-list').innerHTML = items.length ? groupByCategory(items).map(([cat, ps]) => `
    <div class="group-label">${esc(cat)}</div>
    <div class="list">${ps.map(countItemRow).join('')}</div>`).join('') : '<div class="card empty">Ingen treff.</div>';
  updateCountProgress();
}

function countItemRow(p) {
  const it = draftItem(p);
  return `
    <div class="count-row ${it.done ? 'done' : ''}" data-id="${p.id}">
      <div class="count-head">
        <div class="row-main">
          <div class="row-title">${esc(p.name)}</div>
          <div class="row-sub">Før: ${qtyLabel(p, p.stock)} · Nå: <b class="cnt-total">${qtyLabel(p, it.full + it.open)}</b></div>
        </div>
        <button class="done-btn" data-action="count-done" aria-label="Merk som telt">✓</button>
      </div>
      <div class="count-ctrl">
        <div class="stepper">
          <button data-action="count-step" data-d="-1" aria-label="Færre">−</button>
          <input class="qty cnt-full" type="number" inputmode="decimal" min="0" step="1" value="${it.full}" aria-label="Antall ${isBottle(p) ? 'fulle flasker' : 'stk'}">
          <button data-action="count-step" data-d="1" aria-label="Flere">+</button>
        </div>
        <span class="lbl">${isBottle(p) ? 'fulle' : 'stk'}</span>
        ${isBottle(p) ? `
          <div class="open">
            <div class="bottle" aria-hidden="true"><i style="height:${it.open * 100}%"></i></div>
            <input type="range" class="cnt-open" min="0" max="0.9" step="0.1" value="${it.open}" aria-label="Åpen flaske">
            <span class="open-val">${fmtNum(it.open, 1)}</span>
          </div>` : ''}
      </div>
    </div>`;
}

function updateCountRow(row, markDone = true) {
  const p = product(row.dataset.id);
  const it = draftItem(p);
  if (markDone) it.done = true;
  row.classList.toggle('done', it.done);
  $('.cnt-total', row).textContent = qtyLabel(p, it.full + it.open);
  const range = $('.cnt-open', row);
  if (range) {
    $('.open-val', row).textContent = fmtNum(it.open, 1);
    $('.bottle i', row).style.height = `${it.open * 100}%`;
  }
  updateCountProgress();
}

function updateCountProgress() {
  const total = state.products.length;
  const done = state.products.filter((p) => state.draft.items[p.id]?.done).length;
  $('#cnt-progress').textContent = `${done} av ${total} telt`;
  $('#cnt-bar').style.width = `${total ? (done / total) * 100 : 0}%`;
}

let draftSaveTimer;
function saveDraftSoon() {
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(save, 250);
}

V.addEventListener('input', (e) => {
  const row = e.target.closest('.count-row');
  if (!row || !state.draft) return;
  const it = draftItem(product(row.dataset.id));
  if (e.target.classList.contains('cnt-open')) it.open = round1(num(e.target.value));
  else if (e.target.classList.contains('cnt-full')) it.full = Math.max(0, num(e.target.value));
  else return;
  updateCountRow(row);
  saveDraftSoon();
});

function finishCount() {
  const notDone = state.products.filter((p) => !state.draft.items[p.id]?.done);
  if (notDone.length && !confirm(`${notDone.length} produkter er ikke merket som telt.\nDe lagres med verdiene som står i listen. Fullføre likevel?`)) return;
  const date = new Date().toISOString();
  const items = state.products.map((p) => {
    const it = draftItem(p);
    const qty = Math.max(0, round1(it.full + it.open));
    const prev = p.stock;
    p.stock = qty;
    if (qty !== prev) addLog(p, 'telling', qty - prev);
    return { productId: p.id, name: p.name, category: p.category, unit: p.unit, cost: p.cost, qty, prev };
  });
  const count = { id: uid(), date, startedAt: state.draft.startedAt, items, value: sum(items, (i) => i.qty * i.cost) };
  state.counts.push(count);
  state.draft = null;
  save();
  toast('Telling lagret ✔');
  go(`#/historikk/${count.id}`);
}

function countRow(c) {
  return `
    <a class="row" href="#/historikk/${c.id}" style="color:inherit;text-decoration:none">
      <div class="row-main"><div class="row-title">${fmtDate(c.date)}</div>
        <div class="row-sub">${c.items.length} produkter</div></div>
      <div class="row-end"><b>${kr(c.value)}</b></div>
    </a>`;
}

/* ============================================================
   HISTORIKK (tellinger og forbruk)
   ============================================================ */
function renderHistory(id) {
  if (!id) {
    setTitle('Tellinger');
    V.innerHTML = state.counts.length
      ? `<div class="list">${state.counts.slice().reverse().map(countRow).join('')}</div>`
      : `<div class="card empty">Ingen tellinger enda.<div class="btn-row"><a class="btn primary" href="#/telling">Start telling</a></div></div>`;
    return;
  }
  const idx = state.counts.findIndex((c) => c.id === id);
  const c = state.counts[idx];
  if (!c) { go('#/historikk'); return; }
  setTitle(`Telling ${fmtDate(c.date)}`);
  const prev = state.counts[idx - 1];

  let usageHtml = '<p class="muted" style="margin:0">Forbruk beregnes fra og med neste telling (trenger to tellinger å sammenligne).</p>';
  let pourHtml = '';
  if (prev) {
    const rows = periodUsage(c, prev).sort((a, b) => b.usedValue - a.usedValue);
    const days = Math.max(1, Math.round((new Date(c.date) - new Date(prev.date)) / 864e5));
    const totalUsed = sum(rows, (r) => r.usedValue);
    const unitOf = (r) => (r.unit === 'stk' ? 'stk' : 'fl');
    usageHtml = `
      <p style="margin:0 0 .6rem">Siden ${fmtDate(prev.date)} (${days} ${days === 1 ? 'dag' : 'dager'}): <b>${kr(totalUsed)}</b> i forbruk</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Produkt</th><th class="n">Inn</th><th class="n">Brukt</th><th class="n">Verdi</th></tr></thead>
        <tbody>${rows.filter((r) => r.used !== 0 || r.received).map((r) => `
          <tr><td>${esc(r.name)}</td>
          <td class="n">${r.received ? fmtNum(r.received, 1) : ''}</td>
          <td class="n" ${r.used < 0 ? 'style="color:var(--bad)"' : ''}>${fmtNum(r.used, 1)} ${unitOf(r)}</td>
          <td class="n">${kr(r.usedValue)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Ingen endringer.</td></tr>'}
        </tbody></table></div>
      ${rows.some((r) => r.used < 0) ? '<p class="hint" style="margin-top:8px">Negativt forbruk betyr at du har mer enn forventet – sjekk om et varemottak mangler.</p>' : ''}`;
    pourHtml = actualPourCostCard(c, rows, totalUsed);
  }

  V.innerHTML = `
    <div class="stats">
      <div class="stat"><div class="label">Lagerverdi</div><div class="value">${kr(c.value)}</div></div>
      <div class="stat"><div class="label">Produkter</div><div class="value">${c.items.length}</div></div>
      <div class="stat"><div class="label">Endring</div><div class="value">${prev ? (c.value >= prev.value ? '+' : '') + kr(c.value - prev.value) : '–'}</div></div>
    </div>
    ${pourHtml}
    <div class="card"><h2>Forbruk</h2>${usageHtml}</div>
    <div class="card">
      <h2>Beholdning ved telling</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Produkt</th><th class="n">Antall</th><th class="n">Verdi</th></tr></thead>
        <tbody>${c.items.slice().sort(sortByName).map((i) => `
          <tr><td>${esc(i.name)}</td><td class="n">${fmtNum(i.qty, i.unit === 'stk' ? 0 : 1)} ${i.unit === 'stk' ? 'stk' : 'fl'}</td>
          <td class="n">${kr(i.qty * i.cost)}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>
    <div class="btn-row">
      <a class="btn primary" href="#/rapport/${c.id}">Rapport og deling</a>
    </div>
    <div class="btn-row">
      <a class="btn" href="#/historikk">Alle tellinger</a>
      <button class="btn danger" data-action="delete-count" data-id="${c.id}">Slett telling</button>
    </div>`;
}

// Forbruk per produkt mellom to tellinger: forrige telling + varemottak − denne tellingen.
function periodUsage(c, prev) {
  const prevMap = new Map(prev.items.map((i) => [i.productId, i]));
  return c.items.filter((i) => prevMap.has(i.productId)).map((i) => {
    const received = sum(state.log.filter((l) => l.productId === i.productId && l.type === 'mottak' && l.date > prev.date && l.date <= c.date), (l) => l.delta);
    const used = round1(prevMap.get(i.productId).qty + received - i.qty);
    return { ...i, received, used, usedValue: used * i.cost };
  });
}

// Faktisk pour cost = forbruk fra tellingene ÷ salg eks. mva. Teoretisk = oppskriftskost for solgte drinker ÷ salg.
function pourAnalysis(c, rows, totalUsed) {
  const s = c.sales;
  if (!s) return null;
  const sold = Object.entries(s.drinks || {}).map(([id, qty]) => ({ d: state.drinks.find((x) => x.id === id), qty }))
    .filter((x) => x.d && x.qty > 0);
  const drinkRevenueEx = sum(sold, (x) => priceExVat(x.d.price) * x.qty);
  const revenueEx = s.revenue > 0 ? priceExVat(s.revenue) : drinkRevenueEx;
  const theoCost = sum(sold, (x) => drinkCost(x.d) * x.qty);

  // Forventet forbruk per produkt ut fra oppskriftene, i flasker/stk
  const expected = new Map();
  for (const { d, qty } of sold) {
    for (const ing of d.ingredients) {
      const p = product(ing.productId);
      if (!p) continue;
      const units = isBottle(p) ? (ing.amount / p.sizeCl) * qty : ing.amount * qty;
      expected.set(p.id, (expected.get(p.id) || 0) + units);
    }
  }
  const variance = rows.map((r) => {
    const exp = expected.get(r.productId) || 0;
    const diff = r.used - exp;
    return { ...r, expected: exp, diff, diffValue: diff * r.cost };
  }).filter((r) => r.expected > 0 || r.used !== 0)
    .sort((a, b) => Math.abs(b.diffValue) - Math.abs(a.diffValue));

  return {
    revenueEx,
    soldCount: sum(sold, (x) => x.qty),
    actualPct: revenueEx > 0 ? (totalUsed / revenueEx) * 100 : null,
    theoPct: drinkRevenueEx > 0 ? (theoCost / drinkRevenueEx) * 100 : null,
    theoCost,
    variance,
  };
}

function actualPourCostCard(c, rows, totalUsed) {
  const a = pourAnalysis(c, rows, totalUsed);
  if (!a) {
    return `
      <div class="card">
        <h2>Faktisk pour cost</h2>
        <p class="lead" style="margin-top:0">Legg inn salget for perioden (fra kassasystemet), så sammenligner appen det med forbruket fra tellingene.
          Da ser du den faktiske pour costen og hvor mye som forsvinner i svinn og overpouring.</p>
        <button class="btn primary block" data-action="edit-sales" data-id="${c.id}">Legg inn salg</button>
      </div>`;
  }
  const lossValue = sum(a.variance, (r) => r.diffValue);
  const fmtQ = (r, q) => `${fmtNum(q, 1)} ${r.unit === 'stk' ? 'stk' : 'fl'}`;
  return `
    <div class="card">
      <div class="card-head"><h2>Faktisk pour cost</h2>
        <button class="btn small" data-action="edit-sales" data-id="${c.id}">Endre salg</button></div>
      <div class="kv" style="margin-top:0">
        <div><span>Salg eks. mva</span><b>${kr(a.revenueEx)}</b></div>
        <div><span>Forbruk</span><b>${kr(totalUsed)}</b></div>
        <div><span>Faktisk</span>${pctBadge(a.actualPct)}</div>
        <div><span>Teoretisk</span>${pctBadge(a.theoPct)}</div>
      </div>
      ${a.soldCount ? `
        <p style="margin:0 0 .4rem">${fmtNum(a.soldCount)} drinker solgt. Oppskriftene tilsier ${kr(a.theoCost)} i varekost,
          tellingene viser ${kr(totalUsed)}: <b style="color:var(${lossValue > 0 ? '--bad' : '--ok'})">${lossValue > 0 ? '+' : ''}${kr(lossValue)}</b> i avvik.</p>
        <h3>Avvik per produkt</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>Produkt</th><th class="n">Forventet</th><th class="n">Brukt</th><th class="n">Avvik</th></tr></thead>
          <tbody>${a.variance.map((r) => `
            <tr><td>${esc(r.name)}</td><td class="n">${fmtQ(r, r.expected)}</td><td class="n">${fmtQ(r, r.used)}</td>
            <td class="n" style="color:var(${r.diffValue > 0.5 ? '--bad' : r.diffValue < -0.5 ? '--ok' : '--muted'})">${r.diffValue > 0 ? '+' : ''}${kr(r.diffValue)}</td></tr>`).join('')}
          </tbody></table></div>
        <p class="hint" style="margin-top:8px">Positivt avvik betyr at mer er brukt enn oppskriftene tilsier: svinn, overpouring,
          spanderte drinker eller salg som ikke er lagt inn. Negativt avvik kan bety for lite pour eller manglende varemottak.</p>`
      : '<p class="hint" style="margin:0">Legg inn antall solgte per drink for å se avvik per produkt.</p>'}
    </div>`;
}

function salesForm(c) {
  const s = c.sales || { revenue: '', drinks: {} };
  const prevDate = state.counts[state.counts.indexOf(c) - 1]?.date;
  openSheet(`
    <h2>Salg i perioden</h2>
    <p class="lead" style="margin-top:0">${prevDate ? `${fmtDate(prevDate)} – ${fmtDate(c.date)}. ` : ''}Hent tallene fra kassasystemet.</p>
    <form data-form="sales" data-id="${c.id}">
      <label class="field"><span>Totalt drikkesalg ${state.settings.pricesIncludeVat ? 'inkl.' : 'eks.'} mva</span>
        <div class="input-suffix"><input type="number" name="revenue" inputmode="decimal" min="0" step="any" value="${s.revenue || ''}" placeholder="Valgfritt"><em>kr</em></div></label>
      <p class="hint">Ta med alt salg som bruker varene i baren, men ikke kaffe og mat. Står feltet tomt, brukes summen av drinkene under.</p>
      ${state.drinks.length ? `
        <h3>Antall solgt per drink</h3>
        <div class="list">${state.drinks.slice().sort(sortByName).map((d) => `
          <label class="row" style="cursor:default">
            <div class="row-main"><div class="row-title drink">${esc(d.name)}</div><div class="row-sub">${kr(d.price)}</div></div>
            <input type="number" name="d_${d.id}" inputmode="numeric" min="0" step="1" value="${s.drinks?.[d.id] || ''}" placeholder="0" style="width:90px;text-align:right">
          </label>`).join('')}</div>` : '<p class="hint">Legg inn drinker under Pour cost for å se avvik per produkt.</p>'}
      <div class="btn-row">
        ${c.sales ? `<button type="button" class="btn danger" data-action="clear-sales" data-id="${c.id}">Fjern salg</button>` : ''}
        <button class="btn primary">Lagre</button>
      </div>
    </form>`);
}

function saveSales(form) {
  const c = state.counts.find((x) => x.id === form.dataset.id);
  const drinks = {};
  for (const d of state.drinks) {
    const q = Math.max(0, Math.round(num(form.elements[`d_${d.id}`]?.value)));
    if (q) drinks[d.id] = q;
  }
  const revenue = Math.max(0, num(form.elements.revenue.value));
  if (!revenue && !Object.keys(drinks).length) return toast('Legg inn salg eller antall drinker');
  c.sales = { revenue, drinks };
  save();
  closeSheet();
  toast('Salg lagret');
  render();
}

/* ============================================================
   RAPPORT PER TELLING (deles som PDF via utskrift, eller som tekst)
   ============================================================ */
function reportData(c) {
  const idx = state.counts.indexOf(c);
  const prev = state.counts[idx - 1];
  const data = { c, prev, rows: [], totalUsed: 0, received: 0, pour: null, days: 0 };
  if (prev) {
    data.rows = periodUsage(c, prev);
    data.totalUsed = sum(data.rows, (r) => r.usedValue);
    data.received = sum(data.rows, (r) => r.received * r.cost);
    data.pour = pourAnalysis(c, data.rows, data.totalUsed);
    data.days = Math.max(1, Math.round((new Date(c.date) - new Date(prev.date)) / 864e5));
  }
  return data;
}

function renderReport(id) {
  const c = state.counts.find((x) => x.id === id);
  if (!c) { go('#/historikk'); return; }
  setTitle('Rapport');
  const { prev, rows, totalUsed, received, pour, days } = reportData(c);
  const unit = (r) => (r.unit === 'stk' ? 'stk' : 'fl');
  const q = (r, v) => `${fmtNum(v, r.unit === 'stk' ? 0 : 1)} ${unit(r)}`;
  const used = rows.filter((r) => r.used !== 0 || r.received).sort((a, b) => b.usedValue - a.usedValue);
  const groups = groupByCategory(c.items.map((i) => ({ ...i, category: i.category || 'Annet' })));

  V.innerHTML = `
    <div class="report-actions no-print">
      <a class="btn" href="#/historikk/${c.id}">Tilbake</a>
      <button class="btn" data-action="share-report-text" data-id="${c.id}">Del som tekst</button>
      <button class="btn primary" data-action="print-report">Del som PDF</button>
    </div>
    <p class="hint no-print" style="margin:0 4px 12px">«Del som PDF» åpner utskrift. Trykk på dele-ikonet øverst der for å sende eller lagre rapporten som PDF.</p>

    <article class="report">
      <header class="report-head">
        <div class="logo" role="img" aria-label="Tår"></div>
        <div>
          <div class="report-kicker">Tellingsrapport</div>
          <h2 style="margin:0">${fmtDate(c.date)}</h2>
          <div class="muted small">${prev ? `Periode ${fmtDate(prev.date)} – ${fmtDate(c.date)} (${days} ${days === 1 ? 'dag' : 'dager'})` : 'Første telling'}</div>
        </div>
      </header>

      <section class="report-stats">
        <div><span>Lagerverdi</span><b>${kr(c.value)}</b></div>
        <div><span>Endring</span><b>${prev ? (c.value >= prev.value ? '+' : '') + kr(c.value - prev.value) : '–'}</b></div>
        <div><span>Forbruk</span><b>${prev ? kr(totalUsed) : '–'}</b></div>
        <div><span>Varemottak</span><b>${prev ? kr(received) : '–'}</b></div>
        ${pour ? `
          <div><span>Salg eks. mva</span><b>${kr(pour.revenueEx)}</b></div>
          <div><span>Faktisk pour cost</span><b>${pour.actualPct == null ? '–' : fmtNum(pour.actualPct, 1) + ' %'}</b></div>
          <div><span>Teoretisk pour cost</span><b>${pour.theoPct == null ? '–' : fmtNum(pour.theoPct, 1) + ' %'}</b></div>
          <div><span>Avvik</span><b>${pour.soldCount ? (sum(pour.variance, (r) => r.diffValue) > 0 ? '+' : '') + kr(sum(pour.variance, (r) => r.diffValue)) : '–'}</b></div>` : ''}
      </section>

      ${prev ? `
        <section>
          <h3>Forbruk i perioden</h3>
          <table>
            <thead><tr><th>Produkt</th><th class="n">Inn</th><th class="n">Brukt</th><th class="n">Verdi</th></tr></thead>
            <tbody>${used.map((r) => `
              <tr><td>${esc(r.name)}</td><td class="n">${r.received ? q(r, r.received) : ''}</td>
              <td class="n">${q(r, r.used)}</td><td class="n">${kr(r.usedValue)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Ingen endringer.</td></tr>'}
              <tr class="sum-row"><td>Sum</td><td></td><td></td><td class="n">${kr(totalUsed)}</td></tr>
            </tbody>
          </table>
        </section>` : ''}

      ${pour?.soldCount ? `
        <section>
          <h3>Avvik per produkt</h3>
          <table>
            <thead><tr><th>Produkt</th><th class="n">Forventet</th><th class="n">Brukt</th><th class="n">Avvik</th></tr></thead>
            <tbody>${pour.variance.map((r) => `
              <tr><td>${esc(r.name)}</td><td class="n">${q(r, r.expected)}</td><td class="n">${q(r, r.used)}</td>
              <td class="n">${r.diffValue > 0 ? '+' : ''}${kr(r.diffValue)}</td></tr>`).join('')}
            </tbody>
          </table>
          <p class="hint">Positivt avvik = mer brukt enn oppskriftene tilsier (svinn, overpouring, spanderte drinker eller salg som ikke er lagt inn).</p>
        </section>` : ''}

      <section>
        <h3>Beholdning ved telling</h3>
        <table>
          <thead><tr><th>Produkt</th><th class="n">Antall</th><th class="n">Verdi</th></tr></thead>
          ${groups.map(([cat, items]) => `
            <tbody>
              <tr class="cat-row"><td colspan="3">${esc(cat)}</td></tr>
              ${items.map((i) => `<tr><td>${esc(i.name)}</td><td class="n">${q(i, i.qty)}</td><td class="n">${kr(i.qty * i.cost)}</td></tr>`).join('')}
            </tbody>`).join('')}
          <tbody><tr class="sum-row"><td>Sum</td><td></td><td class="n">${kr(c.value)}</td></tr></tbody>
        </table>
      </section>

      <footer class="report-foot">Tår · Cocktails &amp; kaffe · laget ${fmtDateTime(new Date().toISOString())}</footer>
    </article>`;
}

function reportText(c) {
  const { prev, rows, totalUsed, pour, days } = reportData(c);
  const lines = [`Tår – tellingsrapport ${fmtDate(c.date)}`];
  if (prev) lines.push(`Periode: ${fmtDate(prev.date)} – ${fmtDate(c.date)} (${days} ${days === 1 ? 'dag' : 'dager'})`);
  lines.push('', `Lagerverdi: ${kr(c.value)}`);
  if (prev) {
    lines.push(`Endring: ${c.value >= prev.value ? '+' : ''}${kr(c.value - prev.value)}`, `Forbruk: ${kr(totalUsed)}`);
    if (pour) {
      lines.push(`Salg eks. mva: ${kr(pour.revenueEx)}`);
      if (pour.actualPct != null) lines.push(`Faktisk pour cost: ${fmtNum(pour.actualPct, 1)} %`);
      if (pour.theoPct != null) lines.push(`Teoretisk pour cost: ${fmtNum(pour.theoPct, 1)} %`);
    }
    const top = rows.filter((r) => r.usedValue > 0).sort((a, b) => b.usedValue - a.usedValue).slice(0, 5);
    if (top.length) lines.push('', 'Mest brukt:', ...top.map((r) => `• ${r.name}: ${fmtNum(r.used, 1)} ${r.unit === 'stk' ? 'stk' : 'fl'} (${kr(r.usedValue)})`));
    const worst = (pour?.variance || []).filter((r) => r.diffValue > 0.5).slice(0, 5);
    if (worst.length) lines.push('', 'Største avvik:', ...worst.map((r) => `• ${r.name}: +${kr(r.diffValue)}`));
  }
  return lines.join('\n');
}

function renderLog() {
  setTitle('Logg');
  const entries = state.log.slice(-200).reverse();
  V.innerHTML = entries.length ? `
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Når</th><th>Produkt</th><th>Type</th><th class="n">Endring</th></tr></thead>
      <tbody>${entries.map((l) => `
        <tr><td class="small">${fmtDateTime(l.date)}</td><td>${esc(product(l.productId)?.name || l.name)}</td>
        <td class="small">${LOG_TYPES[l.type] || l.type}</td>
        <td class="n">${l.delta > 0 ? '+' : ''}${fmtNum(l.delta, l.delta % 1 ? 1 : 0)}</td></tr>`).join('')}
      </tbody></table></div></div>` : '<div class="card empty">Ingen bevegelser enda.</div>';
}

/* ============================================================
   DRINKER / POUR COST
   ============================================================ */
function renderDrinks() {
  setTitle('Pour cost');
  const s = state.settings;
  const drinks = state.drinks.map((d) => {
    const cost = drinkCost(d);
    return { d, cost, pct: pourPct(cost, d.price) };
  }).sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));

  V.innerHTML = `
    <p class="muted small" style="margin:0 4px 10px">Mål: ${fmtNum(s.targetPourCost)} % · priser ${s.pricesIncludeVat ? `inkl. ${fmtNum(s.vatPct)} % mva` : 'eks. mva'} ·
      <a href="#/mer">endre</a></p>
    ${drinks.length ? `<div class="list">${drinks.map(({ d, cost, pct }) => `
      <div class="row" data-action="edit-drink" data-id="${d.id}">
        <div class="row-main">
          <div class="row-title drink">${esc(d.name)}</div>
          <div class="row-sub">Kost ${kr(cost, 2)} · pris ${kr(d.price)} · ${esc(d.ingredients.map((i) => product(i.productId)?.name).filter(Boolean).join(', ') || 'ingen ingredienser')}</div>
        </div>
        <div class="row-end">${pctBadge(pct)}</div>
      </div>`).join('')}</div>`
    : `<div class="card empty">
        <p>Legg inn drinker (eller enkeltpours, f.eks. «Gin 4 cl») med ingredienser og utsalgspris for å se pour cost.</p>
        ${state.products.length ? '' : '<p class="small">Tips: legg inn produkter med innkjøpspris først.</p>'}
      </div>`}
    <button class="fab" data-action="new-drink" aria-label="Ny drink">+</button>`;
}

function productSelect(selectedId) {
  return `<option value="">Velg produkt…</option>` + groupByCategory([...state.products]).map(([cat, ps]) =>
    `<optgroup label="${esc(cat)}">${ps.map((p) => `<option value="${p.id}" ${p.id === selectedId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</optgroup>`).join('');
}

function ingredientRow(ing = { productId: '', amount: '' }) {
  const p = product(ing.productId);
  return `
    <div class="ing">
      <select name="ingProduct">${productSelect(ing.productId)}</select>
      <div class="input-suffix"><input type="number" name="ingAmount" inputmode="decimal" min="0" step="any" value="${ing.amount}" placeholder="0"><em>${p && !isBottle(p) ? 'stk' : 'cl'}</em></div>
      <button type="button" data-action="remove-ing" aria-label="Fjern">✕</button>
    </div>`;
}

function drinkForm(d) {
  const isNew = !d;
  if (!state.products.length) return toast('Legg til produkter først');
  d = d || { name: '', price: '', ingredients: [{ productId: '', amount: 4 }] };
  const s = state.settings;
  openSheet(`
    <h2>${isNew ? 'Ny drink' : 'Rediger drink'}</h2>
    <form data-form="drink" data-id="${isNew ? '' : d.id}">
      <label class="field"><span>Navn</span><input type="text" name="name" value="${esc(d.name)}" required placeholder="F.eks. Negroni"></label>
      <label class="field"><span>Utsalgspris ${s.pricesIncludeVat ? 'inkl. mva' : 'eks. mva'}</span>
        <div class="input-suffix"><input type="number" name="price" inputmode="decimal" min="0" step="any" value="${d.price}" placeholder="0"><em>kr</em></div></label>
      <div class="field"><span class="muted small">Ingredienser</span>
        <div id="ings" style="margin-top:4px">${d.ingredients.map(ingredientRow).join('')}</div>
        <button type="button" class="btn small" data-action="add-ing">+ Ingrediens</button>
      </div>
      <div class="calc" id="drink-calc"></div>
      <div class="btn-row">
        ${isNew ? '' : `<button type="button" class="btn danger" data-action="delete-drink" data-id="${d.id}">Slett</button>`}
        <button class="btn primary">${isNew ? 'Legg til' : 'Lagre'}</button>
      </div>
    </form>`, (root) => {
    const form = $('form', root);
    form.addEventListener('input', () => updateDrinkCalc(form));
    form.addEventListener('change', (e) => {
      if (e.target.name === 'ingProduct') {
        const p = product(e.target.value);
        $('em', e.target.closest('.ing')).textContent = p && !isBottle(p) ? 'stk' : 'cl';
      }
      updateDrinkCalc(form);
    });
    updateDrinkCalc(form);
    if (isNew) form.elements.name.focus();
  });
}

function readIngredients(form) {
  return $$('.ing', form).map((row) => ({
    productId: $('select', row).value,
    amount: Math.max(0, num($('input', row).value)),
  })).filter((i) => i.productId && i.amount > 0);
}

function updateDrinkCalc(form) {
  const ings = readIngredients(form);
  const cost = sum(ings, ingredientCost);
  const price = num(form.elements.price.value);
  const pct = pourPct(cost, price);
  const s = state.settings;
  const sugg = suggestedPrice(cost);
  const profit = priceExVat(price) - cost;
  $('#drink-calc').innerHTML = `
    <span>Varekost</span><span>${kr(cost, 2)}</span>
    ${s.pricesIncludeVat ? `<span>Pris eks. mva</span><span>${kr(priceExVat(price), 2)}</span>` : ''}
    <span>Fortjeneste per drink</span><span>${price ? kr(profit, 2) : '–'}</span>
    <span class="big">Pour cost</span><span>${pctBadge(pct)}</span>
    <span class="muted small">Pris for ${fmtNum(s.targetPourCost)} % pour cost</span><span class="muted small">${cost ? kr(Math.ceil(sugg)) : '–'}</span>`;
}

function saveDrink(form) {
  const name = form.elements.name.value.trim();
  if (!name) return toast('Drinken må ha et navn');
  const data = { name, price: Math.max(0, num(form.elements.price.value)), ingredients: readIngredients(form) };
  const id = form.dataset.id;
  if (id) Object.assign(state.drinks.find((d) => d.id === id), data);
  else state.drinks.push({ id: uid(), ...data });
  save();
  closeSheet();
  toast('Lagret');
  render();
}

/* ============================================================
   MER (innstillinger, backup)
   ============================================================ */
function renderMore() {
  setTitle('Mer');
  const s = state.settings;
  V.innerHTML = `
    <div class="list">
      <a class="row" href="#/historikk" style="color:inherit;text-decoration:none">
        <div class="row-main"><div class="row-title">Tellinger og forbruk</div><div class="row-sub">${state.counts.length} tellinger</div></div><span class="muted">›</span></a>
      <a class="row" href="#/logg" style="color:inherit;text-decoration:none">
        <div class="row-main"><div class="row-title">Logg</div><div class="row-sub">Varemottak, svinn og justeringer</div></div><span class="muted">›</span></a>
    </div>

    <div class="card">
      <h2>Pour cost-innstillinger</h2>
      <form data-form="settings">
        <div class="field-row">
          <label class="field"><span>Mål for pour cost</span>
            <div class="input-suffix"><input type="number" name="targetPourCost" inputmode="decimal" min="1" max="100" step="any" value="${s.targetPourCost}"><em>%</em></div></label>
          <label class="field"><span>Mva-sats</span>
            <div class="input-suffix"><input type="number" name="vatPct" inputmode="decimal" min="0" max="100" step="any" value="${s.vatPct}"><em>%</em></div></label>
        </div>
        <label class="check"><input type="checkbox" name="pricesIncludeVat" ${s.pricesIncludeVat ? 'checked' : ''}> Utsalgsprisene mine er inkl. mva</label>
        <p class="hint">Pour cost = varekost ÷ utsalgspris eks. mva. Innkjøpsprisene på produktene bør være eks. mva.</p>
        <button class="btn primary block">Lagre innstillinger</button>
      </form>
    </div>

    <div class="card">
      <h2>Backup og eksport</h2>
      <p class="muted small" style="margin-top:0">Alt lagres kun på denne enheten. Ta backup jevnlig, og bruk den samme filen for å flytte dataene til en ny telefon.
        ${s.lastBackup ? `Siste backup: ${fmtDate(s.lastBackup)}.` : ''}</p>
      <div class="grid2">
        <button class="btn" data-action="export-json">Del backup</button>
        <button class="btn" data-action="import-json">Gjenopprett backup</button>
        <button class="btn" data-action="export-csv">Del lagerliste (Excel)</button>
        <button class="btn danger" data-action="reset">Slett alle data</button>
      </div>
      <input type="file" id="import-file" accept="application/json,.json" hidden>
    </div>

    <div class="card">
      <h2>Installer på telefonen</h2>
      <p class="muted small" style="margin:0"><b>iPhone:</b> Åpne i Safari → Del-knappen → «Legg til på Hjem-skjerm».<br>
        <b>Android:</b> Åpne i Chrome → menyen ⋮ → «Installer app».<br>Appen virker da offline som en vanlig app.</p>
    </div>`;

  $('#import-file').addEventListener('change', importJson);
}

function saveSettings(form) {
  const f = form.elements;
  Object.assign(state.settings, {
    targetPourCost: Math.min(100, Math.max(1, num(f.targetPourCost.value) || 20)),
    vatPct: Math.min(100, Math.max(0, num(f.vatPct.value))),
    pricesIncludeVat: f.pricesIncludeVat.checked,
  });
  save();
  toast('Innstillinger lagret');
}

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const today = () => new Date().toISOString().slice(0, 10);
const isTouch = () => matchMedia('(pointer: coarse)').matches;

// På telefonen åpnes delingsmenyen (AirDrop, e-post, Filer …); ellers lastes filen ned.
async function shareFile(filename, content, type, title) {
  const file = new File([content], filename, { type });
  if (isTouch() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
    }
  }
  download(filename, content, type);
  return 'downloaded';
}

async function exportJson() {
  const result = await shareFile(`tar-cocktails-backup-${today()}.json`, JSON.stringify(state, null, 2), 'application/json', 'Tår – backup');
  if (result === 'cancelled') return;
  state.settings.lastBackup = new Date().toISOString();
  save();
  toast(result === 'shared' ? 'Backup delt' : 'Backup lastet ned');
  render();
}

function importJson(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.products)) throw new Error('Ugyldig fil');
      if (!confirm(`Gjenopprette backup med ${data.products.length} produkter?\nDette erstatter alle data på denne enheten.`)) return;
      state = migrate(data);
      save();
      toast('Backup gjenopprettet');
      go('#/oversikt');
    } catch (err) {
      toast('Kunne ikke lese filen – er det en Tår-backup?');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

function exportCsv() {
  const cell = (v) => {
    const s = typeof v === 'number' ? String(round2(v)).replace('.', ',') : String(v ?? '');
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['Navn', 'Kategori', 'Leverandør', 'Strekkode', 'Enhet', 'Størrelse (cl)', 'Innkjøpspris', 'Beholdning', 'Verdi', 'Varsel på', 'Varsle ved', 'Bestill opp til', 'Bestill antall'];
  const rows = state.products.slice().sort(sortByName).map((p) => [
    p.name, p.category, p.supplier || '', p.barcode ? `\u2060${p.barcode}` : '', isBottle(p) ? 'flaske' : 'stk', isBottle(p) ? p.sizeCl : '', p.cost, p.stock,
    productValue(p), p.lowAlert ? 'ja' : 'nei', p.threshold, p.par || '', isLow(p) ? orderQty(p) : '']);
  const csv = '﻿' + [head, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
  shareFile(`tar-cocktails-lager-${today()}.csv`, csv, 'text/csv;charset=utf-8', 'Tår – lagerliste');
}

const NO_SUPPLIER = 'Uten leverandør';
function lowBySupplier() {
  const groups = new Map();
  for (const p of lowProducts().sort(sortByName)) {
    const key = p.supplier || NO_SUPPLIER;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  return [...groups].sort(([a], [b]) => (a === NO_SUPPLIER) - (b === NO_SUPPLIER) || a.localeCompare(b, 'nb'));
}

function shoppingListText(onlySupplier) {
  const groups = lowBySupplier().filter(([sup]) => !onlySupplier || sup === onlySupplier);
  const line = (p) => `• ${p.name}: ${orderQty(p)} ${isBottle(p) ? 'fl' : 'stk'} (har ${qtyLabel(p, p.stock)})`;
  const title = `Bestilling${onlySupplier && onlySupplier !== NO_SUPPLIER ? ` – ${onlySupplier}` : ''} ${fmtDate(new Date().toISOString())}`;
  if (onlySupplier || (groups.length === 1 && groups[0][0] === NO_SUPPLIER)) {
    return `${title}\n${groups.flatMap(([, ps]) => ps.map(line)).join('\n')}`;
  }
  return `${title}\n` + groups.map(([sup, ps]) => `\n${sup.toUpperCase()}\n${ps.map(line).join('\n')}`).join('\n');
}

function loadDemo() {
  const P = (name, category, sizeCl, cost, stock, threshold, par, unit = 'flaske', supplier = 'Grossist A') =>
    ({ id: uid(), name, category, unit, sizeCl, cost, stock, lowAlert: true, threshold, par, supplier, barcode: '', notes: '', createdAt: new Date().toISOString() });
  const prods = [
    P('Tanqueray London Dry', 'Gin', 70, 329, 3.4, 2, 4),
    P('Hendrick\'s', 'Gin', 70, 449, 1.2, 1, 2, 'flaske', 'Grossist B'),
    P('Absolut Vodka', 'Vodka', 70, 299, 4.0, 2, 5),
    P('Havana Club 3', 'Rom', 70, 289, 0.6, 1, 3, 'flaske', 'Grossist B'),
    P('Campari', 'Bitter/Amaro', 70, 279, 2.5, 1, 3),
    P('Martini Rosso', 'Vermut/Aperitiff', 75, 139, 1.8, 1, 3),
    P('Aperol', 'Bitter/Amaro', 70, 229, 0.3, 1, 3),
    P('Jameson', 'Whisky', 70, 359, 2.0, 1, 3),
    P('Olmeca Altos Plata', 'Tequila/Mezcal', 70, 399, 1.0, 1, 2, 'flaske', 'Grossist B'),
    P('Cointreau', 'Likør', 70, 389, 1.5, 1, 2),
    P('Prosecco', 'Musserende', 75, 109, 6, 4, 12),
    P('Sukkersirup', 'Sirup', 100, 49, 2.3, 1, 3, 'flaske', ''),
    P('Fever-Tree Tonic', 'Mixer', 20, 14, 18, 12, 48, 'stk', 'Mixer-leverandør'),
    P('Soda', 'Mixer', 33, 8, 30, 12, 48, 'stk', 'Mixer-leverandør'),
  ];
  const by = (n) => prods.find((p) => p.name === n).id;
  state.products.push(...prods);
  for (const p of prods) addLog(p, 'start', p.stock);
  state.drinks.push(
    { id: uid(), name: 'Negroni', price: 159, ingredients: [{ productId: by('Tanqueray London Dry'), amount: 3 }, { productId: by('Campari'), amount: 3 }, { productId: by('Martini Rosso'), amount: 3 }] },
    { id: uid(), name: 'Gin & Tonic', price: 149, ingredients: [{ productId: by('Tanqueray London Dry'), amount: 4 }, { productId: by('Fever-Tree Tonic'), amount: 1 }] },
    { id: uid(), name: 'Aperol Spritz', price: 145, ingredients: [{ productId: by('Aperol'), amount: 6 }, { productId: by('Prosecco'), amount: 9 }, { productId: by('Soda'), amount: 0.2 }] },
    { id: uid(), name: 'Margarita', price: 159, ingredients: [{ productId: by('Olmeca Altos Plata'), amount: 5 }, { productId: by('Cointreau'), amount: 2 }, { productId: by('Sukkersirup'), amount: 1 }] },
    { id: uid(), name: 'Jameson 4 cl', price: 129, ingredients: [{ productId: by('Jameson'), amount: 4 }] },
  );
  save();
  toast('Eksempeldata lastet inn');
  render();
}

/* ============================================================
   Hendelser
   ============================================================ */
const actions = {
  'close-sheet': closeSheet,
  'new-product': () => productForm(),
  'bulk-add': () => bulkForm(),
  'new-product-code': (el) => productForm(null, { barcode: el.dataset.code }),
  'scan-product': scanToProduct,
  'scan-count': scanInCount,
  'scan-into-form': (el) => scanIntoForm(el.closest('form')),
  'open-product': (el) => openProduct(el.dataset.id),
  'edit-product': (el) => productForm(product(el.dataset.id)),
  'delete-product': (el) => deleteProduct(el.dataset.id),
  'show-noprice': () => { Object.assign(invFilter, { q: '', cat: '', low: false, noPrice: true }); go('#/lager'); },
  'show-low': (el, e) => { e.preventDefault(); invFilter.low = true; invFilter.noPrice = false; invFilter.q = ''; invFilter.cat = ''; go('#/lager'); },
  adj: (el) => {
    const p = product(el.dataset.id);
    const d = num(el.dataset.d);
    if (d < 0 && p.stock <= 0) return;
    adjustStock(p, d, d > 0 ? 'mottak' : 'svinn');
    refreshCurrent();
  },
  'copy-shopping': async (el) => {
    const text = shoppingListText(el.dataset.supplier);
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); toast('Handleliste kopiert'); }
    } catch (e) {
      if (e.name !== 'AbortError') prompt('Kopier handlelisten:', text);
    }
  },

  'count-start': () => {
    state.draft = { startedAt: new Date().toISOString(), items: {} };
    countFilter.q = '';
    countFilter.cat = '';
    save();
    render();
  },
  'count-cancel': () => {
    if (!confirm('Avbryte tellingen? Det du har registrert så langt forkastes.')) return;
    state.draft = null;
    save();
    render();
  },
  'count-finish': finishCount,
  'count-step': (el) => {
    const row = el.closest('.count-row');
    const it = draftItem(product(row.dataset.id));
    it.full = Math.max(0, round1(it.full + num(el.dataset.d)));
    $('.cnt-full', row).value = it.full;
    updateCountRow(row);
    saveDraftSoon();
  },
  'count-done': (el) => {
    const row = el.closest('.count-row');
    const it = draftItem(product(row.dataset.id));
    it.done = !it.done;
    updateCountRow(row, false);
    saveDraftSoon();
  },
  'edit-sales': (el) => salesForm(state.counts.find((c) => c.id === el.dataset.id)),
  'clear-sales': (el) => {
    const c = state.counts.find((x) => x.id === el.dataset.id);
    if (!confirm('Fjerne salgstallene for denne perioden?')) return;
    delete c.sales;
    save();
    closeSheet();
    render();
  },
  'delete-count': (el) => {
    if (!confirm('Slette denne tellingen? Beholdningen endres ikke.')) return;
    state.counts = state.counts.filter((c) => c.id !== el.dataset.id);
    save();
    go('#/historikk');
  },

  'new-drink': () => drinkForm(),
  'edit-drink': (el) => drinkForm(state.drinks.find((d) => d.id === el.dataset.id)),
  'delete-drink': (el) => {
    const d = state.drinks.find((x) => x.id === el.dataset.id);
    if (!confirm(`Slette «${d.name}»?`)) return;
    state.drinks = state.drinks.filter((x) => x.id !== d.id);
    save();
    closeSheet();
    render();
  },
  'add-ing': () => {
    $('#ings').insertAdjacentHTML('beforeend', ingredientRow());
    $('#ings .ing:last-child select').focus();
  },
  'remove-ing': (el) => {
    const form = el.closest('form');
    el.closest('.ing').remove();
    updateDrinkCalc(form);
  },

  'print-report': () => window.print(),
  'share-report-text': async (el) => {
    const text = reportText(state.counts.find((c) => c.id === el.dataset.id));
    try {
      if (navigator.share && isTouch()) await navigator.share({ title: 'Tår – tellingsrapport', text });
      else { await navigator.clipboard.writeText(text); toast('Rapporten er kopiert'); }
    } catch (e) {
      if (e.name !== 'AbortError') prompt('Kopier rapporten:', text);
    }
  },
  'export-json': exportJson,
  'import-json': () => $('#import-file').click(),
  'export-csv': exportCsv,
  'load-demo': loadDemo,
  reset: () => {
    if (!confirm('Slette ALLE data på denne enheten? Dette kan ikke angres.')) return;
    if (!confirm('Er du helt sikker? Ta gjerne en backup først.')) return;
    state = defaultState();
    save();
    go('#/oversikt');
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) fn(el, e);
});

const forms = {
  product: saveProduct,
  bulk: saveBulk,
  'link-barcode': (form) => {
    const p = product(form.elements.productId.value);
    if (!p) return;
    const clash = productByBarcode(form.dataset.code);
    if (clash && clash.id !== p.id) return toast(`Koden er allerede brukt på ${clash.name}`);
    p.barcode = form.dataset.code;
    save();
    toast(`Strekkode koblet til ${p.name}`);
    openProduct(p.id);
  },
  drink: saveDrink,
  settings: saveSettings,
  sales: saveSales,
  move: (form, e) => {
    const p = product(form.dataset.id);
    const amount = Math.abs(num(form.elements.amount.value));
    if (!amount) return;
    const type = e.submitter?.value === 'svinn' ? 'svinn' : 'mottak';
    adjustStock(p, type === 'svinn' ? -amount : amount, type);
    toast(`${LOG_TYPES[type]}: ${fmtNum(amount, amount % 1 ? 1 : 0)} ${isBottle(p) ? 'fl' : 'stk'} ${p.name}`);
    openProduct(p.id);
    refreshCurrent();
  },
};

document.addEventListener('submit', (e) => {
  const handler = forms[e.target.dataset.form];
  if (!handler) return;
  e.preventDefault();
  handler(e.target, e);
});

/* ---------- Oppstart ---------- */
if (!location.hash) history.replaceState(null, '', '#/oversikt');
render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
