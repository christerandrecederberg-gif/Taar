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
  return p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q);
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
};
const tabFor = { historikk: 'mer', logg: 'mer' };

function render() {
  const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  const route = routes[name] ? name : 'oversikt';
  const tab = tabFor[route] || route;
  $$('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
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
          <button class="btn primary" data-action="new-product">Legg til første produkt</button>
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
      ${low.length ? `<div class="list" style="margin:0">${low.map((p) => `
        <div class="row" data-action="open-product" data-id="${p.id}">
          <div class="row-main">
            <div class="row-title">${esc(p.name)}</div>
            <div class="row-sub">Igjen: ${qtyLabel(p, p.stock)} · varsel ved ${qtyLabel(p, p.threshold)}</div>
          </div>
          <div class="row-end"><span class="tag low">Bestill ${orderQty(p)}</span></div>
        </div>`).join('')}</div>`
      : `<p class="muted" style="margin:0">Ingen varsler. ${state.products.some((p) => p.lowAlert) ? 'Alt er over grensen 👍' : 'Slå på «Varsle ved lavt lager» på produktene du vil følge med på.'}</p>`}
    </div>

    <div class="card">
      <div class="card-head"><h2>Siste telling</h2>
        ${state.draft ? '' : `<a class="btn small" href="#/telling">Ny telling</a>`}</div>
      ${last ? `
        <p style="margin:0">${fmtDate(last.date)} · <b>${kr(last.value)}</b></p>
        <p class="muted small" style="margin:.2rem 0 0">${daysAgo(last.date)} · <a href="#/historikk/${last.id}">Se forbruk</a></p>`
      : `<p class="muted" style="margin:0">Ingen tellinger enda.</p>`}
    </div>

    <div class="card">
      <div class="card-head"><h2>Pour cost</h2><a class="btn small" href="#/drinker">Drinker</a></div>
      ${avgPct != null ? `
        <p style="margin:0">Snitt ${pctBadge(avgPct)} &nbsp;mål ${fmtNum(state.settings.targetPourCost)} %</p>
        <p class="muted small" style="margin:.4rem 0 0">${overTarget ? `${overTarget} av ${drinks.length} drinker er over målet.` : `Alle ${drinks.length} drinker er innenfor målet.`}</p>`
      : `<p class="muted" style="margin:0">Legg inn drinker med oppskrift og pris for å se pour cost.</p>`}
    </div>

    ${daysSinceBackup > 14 ? `
      <div class="card">
        <h2>💾 Ta en backup</h2>
        <p class="muted small" style="margin-top:0">Dataene ligger kun på denne enheten. ${state.settings.lastBackup ? `Siste backup var ${fmtDate(state.settings.lastBackup)}.` : 'Du har ikke tatt backup enda.'}</p>
        <button class="btn block" data-action="export-json">Last ned backup</button>
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
const invFilter = { q: '', cat: '', low: false };

function renderInventory() {
  setTitle('Lager');
  V.innerHTML = `
    <div class="toolbar">
      <input type="search" id="inv-q" placeholder="Søk produkt…" value="${esc(invFilter.q)}" autocomplete="off">
      <select id="inv-cat">${categoryOptions(invFilter.cat, true)}</select>
      <label class="chip"><input type="checkbox" id="inv-low" ${invFilter.low ? 'checked' : ''}> Kun lavt</label>
    </div>
    <div id="inv-summary" class="muted small" style="margin:0 4px 4px"></div>
    <div id="inv-list"></div>
    <button class="fab" data-action="new-product" aria-label="Nytt produkt">+</button>`;
  $('#inv-q').addEventListener('input', (e) => { invFilter.q = e.target.value; renderInventoryList(); });
  $('#inv-cat').addEventListener('change', (e) => { invFilter.cat = e.target.value; renderInventoryList(); });
  $('#inv-low').addEventListener('change', (e) => { invFilter.low = e.target.checked; renderInventoryList(); });
  renderInventoryList();
}

function renderInventoryList() {
  const list = $('#inv-list');
  if (!list) return;
  const items = state.products.filter((p) =>
    matchesQuery(p, invFilter.q) && (!invFilter.cat || p.category === invFilter.cat) && (!invFilter.low || isLow(p)));
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
    <div class="muted small">${esc(p.category)} · ${isBottle(p) ? `${fmtNum(p.sizeCl)} cl flaske` : 'per stk'}</div>
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
    </div>`);
}

function productForm(p) {
  const isNew = !p;
  p = p || { name: '', category: 'Gin', unit: 'flaske', sizeCl: 70, cost: '', stock: 0, lowAlert: true, threshold: 1, par: 3, notes: '' };
  openSheet(`
    <h2>${isNew ? 'Nytt produkt' : 'Rediger produkt'}</h2>
    <form data-form="product" data-id="${isNew ? '' : p.id}">
      <label class="field"><span>Navn</span>
        <input type="text" name="name" value="${esc(p.name)}" required placeholder="F.eks. Tanqueray London Dry"></label>
      <div class="field-row">
        <label class="field"><span>Kategori</span><select name="category">${categoryOptions(p.category)}</select></label>
        <label class="field"><span>Enhet</span>
          <select name="unit">
            <option value="flaske" ${p.unit !== 'stk' ? 'selected' : ''}>Flaske</option>
            <option value="stk" ${p.unit === 'stk' ? 'selected' : ''}>Stk (boks, kartong …)</option>
          </select></label>
      </div>
      <div class="field-row">
        <label class="field bottle-only"><span>Flaskestørrelse</span>
          <div class="input-suffix"><input type="number" name="sizeCl" inputmode="decimal" min="1" step="any" value="${p.sizeCl}"><em>cl</em></div></label>
        <label class="field"><span class="cost-label">Innkjøpspris per ${p.unit === 'stk' ? 'stk' : 'flaske'}</span>
          <div class="input-suffix"><input type="number" name="cost" inputmode="decimal" min="0" step="any" value="${p.cost}" placeholder="0"><em>kr</em></div></label>
      </div>
      <label class="field"><span>Beholdning nå</span>
        <div class="input-suffix"><input type="number" name="stock" inputmode="decimal" min="0" step="any" value="${p.stock}"><em class="unit-suffix">${p.unit === 'stk' ? 'stk' : 'fl'}</em></div></label>
      <p class="hint bottle-only">Bruk desimaler for åpne flasker, f.eks. 2,4 = to fulle og en på 40 %.</p>

      <label class="check"><input type="checkbox" name="lowAlert" ${p.lowAlert ? 'checked' : ''}> Varsle ved lavt lager</label>
      <div class="field-row alert-fields">
        <label class="field"><span>Varsle når ≤</span>
          <div class="input-suffix"><input type="number" name="threshold" inputmode="decimal" min="0" step="any" value="${p.threshold}"><em class="unit-suffix">${p.unit === 'stk' ? 'stk' : 'fl'}</em></div></label>
        <label class="field"><span>Bestill opp til</span>
          <div class="input-suffix"><input type="number" name="par" inputmode="decimal" min="0" step="any" value="${p.par || ''}" placeholder="valgfritt"><em class="unit-suffix">${p.unit === 'stk' ? 'stk' : 'fl'}</em></div></label>
      </div>

      <label class="field"><span>Notater</span><textarea name="notes" rows="2" placeholder="Leverandør, hylleplass …">${esc(p.notes)}</textarea></label>

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
    sync();
    if (isNew) form.elements.name.focus();
  });
}

function saveProduct(form) {
  const f = form.elements;
  const name = f.name.value.trim();
  if (!name) return toast('Produktet må ha et navn');
  const data = {
    name,
    category: f.category.value,
    unit: f.unit.value,
    sizeCl: Math.max(1, num(f.sizeCl.value) || 70),
    cost: Math.max(0, num(f.cost.value)),
    lowAlert: f.lowAlert.checked,
    threshold: Math.max(0, num(f.threshold.value)),
    par: Math.max(0, num(f.par.value)),
    notes: f.notes.value.trim(),
  };
  const stock = Math.max(0, round1(num(f.stock.value)));
  const id = form.dataset.id;
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
    toast(`${name} lagt til`);
  }
  save();
  closeSheet();
  refreshCurrent();
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
  if (prev) {
    const prevMap = new Map(prev.items.map((i) => [i.productId, i]));
    const rows = c.items.filter((i) => prevMap.has(i.productId)).map((i) => {
      const received = sum(state.log.filter((l) => l.productId === i.productId && l.type === 'mottak' && l.date > prev.date && l.date <= c.date), (l) => l.delta);
      const used = round1(prevMap.get(i.productId).qty + received - i.qty);
      return { ...i, received, used, usedValue: used * i.cost };
    }).sort((a, b) => b.usedValue - a.usedValue);
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
  }

  V.innerHTML = `
    <div class="stats">
      <div class="stat"><div class="label">Lagerverdi</div><div class="value">${kr(c.value)}</div></div>
      <div class="stat"><div class="label">Produkter</div><div class="value">${c.items.length}</div></div>
      <div class="stat"><div class="label">Endring</div><div class="value">${prev ? (c.value >= prev.value ? '+' : '') + kr(c.value - prev.value) : '–'}</div></div>
    </div>
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
      <a class="btn" href="#/historikk">Alle tellinger</a>
      <button class="btn danger" data-action="delete-count" data-id="${c.id}">Slett telling</button>
    </div>`;
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
        <button class="btn" data-action="export-json">Last ned backup</button>
        <button class="btn" data-action="import-json">Gjenopprett backup</button>
        <button class="btn" data-action="export-csv">Eksporter lager (CSV)</button>
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

function exportJson() {
  state.settings.lastBackup = new Date().toISOString();
  save();
  download(`tar-cocktails-backup-${today()}.json`, JSON.stringify(state, null, 2), 'application/json');
  toast('Backup lastet ned');
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
  const head = ['Navn', 'Kategori', 'Enhet', 'Størrelse (cl)', 'Innkjøpspris', 'Beholdning', 'Verdi', 'Varsel på', 'Varsle ved', 'Bestill opp til', 'Bestill antall'];
  const rows = state.products.slice().sort(sortByName).map((p) => [
    p.name, p.category, isBottle(p) ? 'flaske' : 'stk', isBottle(p) ? p.sizeCl : '', p.cost, p.stock,
    productValue(p), p.lowAlert ? 'ja' : 'nei', p.threshold, p.par || '', isLow(p) ? orderQty(p) : '']);
  const csv = '﻿' + [head, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
  download(`tar-cocktails-lager-${today()}.csv`, csv, 'text/csv;charset=utf-8');
}

function shoppingListText() {
  return `Handleliste ${fmtDate(new Date().toISOString())}\n` + lowProducts().sort(sortByName)
    .map((p) => `• ${p.name}: ${orderQty(p)} ${isBottle(p) ? 'fl' : 'stk'} (har ${qtyLabel(p, p.stock)})`).join('\n');
}

function loadDemo() {
  const P = (name, category, sizeCl, cost, stock, threshold, par, unit = 'flaske') =>
    ({ id: uid(), name, category, unit, sizeCl, cost, stock, lowAlert: true, threshold, par, notes: '', createdAt: new Date().toISOString() });
  const prods = [
    P('Tanqueray London Dry', 'Gin', 70, 329, 3.4, 2, 4),
    P('Hendrick\'s', 'Gin', 70, 449, 1.2, 1, 2),
    P('Absolut Vodka', 'Vodka', 70, 299, 4.0, 2, 5),
    P('Havana Club 3', 'Rom', 70, 289, 0.6, 1, 3),
    P('Campari', 'Bitter/Amaro', 70, 279, 2.5, 1, 3),
    P('Martini Rosso', 'Vermut/Aperitiff', 75, 139, 1.8, 1, 3),
    P('Aperol', 'Bitter/Amaro', 70, 229, 0.3, 1, 3),
    P('Jameson', 'Whisky', 70, 359, 2.0, 1, 3),
    P('Olmeca Altos Plata', 'Tequila/Mezcal', 70, 399, 1.0, 1, 2),
    P('Cointreau', 'Likør', 70, 389, 1.5, 1, 2),
    P('Prosecco', 'Musserende', 75, 109, 6, 4, 12),
    P('Sukkersirup', 'Sirup', 100, 49, 2.3, 1, 3),
    P('Fever-Tree Tonic', 'Mixer', 20, 14, 18, 12, 48, 'stk'),
    P('Soda', 'Mixer', 33, 8, 30, 12, 48, 'stk'),
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
  'open-product': (el) => openProduct(el.dataset.id),
  'edit-product': (el) => productForm(product(el.dataset.id)),
  'delete-product': (el) => deleteProduct(el.dataset.id),
  'show-low': (el, e) => { e.preventDefault(); invFilter.low = true; invFilter.q = ''; invFilter.cat = ''; go('#/lager'); },
  adj: (el) => {
    const p = product(el.dataset.id);
    const d = num(el.dataset.d);
    if (d < 0 && p.stock <= 0) return;
    adjustStock(p, d, d > 0 ? 'mottak' : 'svinn');
    refreshCurrent();
  },
  'copy-shopping': async () => {
    const text = shoppingListText();
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
  drink: saveDrink,
  settings: saveSettings,
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
