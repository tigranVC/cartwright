// Cartwright SPA. Every mutation goes through window.cartwright.dispatch, so
// the UI and the programmatic API are guaranteed to behave identically.
import cw from './api.js';

const C = cw.core;
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (c) => C.fmtMoney(c || 0);
const S = () => cw.state;
const get = (coll, id) => (id ? C.byId(S(), coll, id) : null);
const Q = (name, params) => { const r = cw.query(name, params); if (!r.ok) throw new Error(r.error.message); return r.result; };
const pill = (s) => `<span class="pill ${esc(s)}">${esc(String(s).replace(/_/g, ' '))}</span>`;
const tagsHtml = (tags) => (tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('') || '<span class="muted">—</span>';
const when = (stamp) => (stamp ? esc(String(stamp).replace('T', ' ')) : '—');
const toCents = (v) => (v === '' || v == null ? undefined : Math.round(parseFloat(v) * 100));
const dollars = (c) => (c == null ? '' : (c / 100).toFixed(2));
const custName = (id) => { const c = get('customers', id); return c ? `${c.firstName} ${c.lastName}`.trim() || c.email : '—'; };
const custLink = (id) => (id ? `<a href="#/customers/${id}">${esc(custName(id))}</a>` : '<span class="muted">no customer</span>');
const orderLink = (id) => { const o = get('orders', id); return o ? `<a href="#/orders/${o.id}">${esc(o.name)}</a>` : esc(id); };
const locLabel = (id) => get('locations', id)?.name ?? id;
const initials = (s) => String(s || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Line icons (20×20, stroked with currentColor) used inside the views.
const ICON_PATHS = {
  cart: '<path d="M3.5 6.5h13l-1.2 9.2a1.5 1.5 0 0 1-1.5 1.3H6.2a1.5 1.5 0 0 1-1.5-1.3z"/><path d="M7 8.5V5.5a3 3 0 0 1 6 0v3"/>',
  money: '<rect x="2.5" y="5" width="15" height="10" rx="1.5"/><circle cx="10" cy="10" r="2.2"/><path d="M5.5 8v4M14.5 8v4"/>',
  avg: '<path d="M3 15l4.5-5 3 3L17 6"/><path d="M13 6h4v4"/>',
  people: '<circle cx="7.5" cy="7.5" r="2.7"/><path d="M2.8 16a4.7 4.7 0 0 1 9.4 0"/><path d="M12.5 5a2.5 2.5 0 0 1 0 5M14.5 16a4.7 4.7 0 0 0-1.6-3.5"/>',
  box: '<path d="M10 2.8l6.5 3.4v7.6L10 17.2l-6.5-3.4V6.2z"/><path d="M3.5 6.2L10 9.6l6.5-3.4M10 9.6v7.6"/>',
  plus: '<path d="M10 4.5v11M4.5 10h11"/>',
  search: '<circle cx="8.5" cy="8.5" r="5"/><path d="M12.3 12.3L17 17"/>',
  tag: '<path d="M10.5 3H16a1 1 0 0 1 1 1v5.5L9.8 16.7a1 1 0 0 1-1.4 0l-5.1-5.1a1 1 0 0 1 0-1.4z"/><circle cx="13.3" cy="6.7" r="1.2"/>',
  back: '<path d="M12 5l-5 5 5 5"/>',
  ext: '<path d="M11 4h5v5M16 4l-7 7"/><path d="M14 11.5V16H4V6h4.5"/>',
};
const icon = (name) => `<svg class="i" viewBox="0 0 20 20" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
const STOCK_LOW = 10;
const stockPill = (n) => (n <= 0 ? '<span class="pill out-of-stock">Out of stock</span>' : n < STOCK_LOW ? '<span class="pill low-stock">Low stock</span>' : '<span class="pill in-stock">In stock</span>');
const swatchColor = (id) => { const h = (200 + (C.hashSeed(id) % 170)) % 360; return `hsl(${h} 45% 42%)`; }; // blues→purples→reds→oranges
const thumb = (id, title) => `<span class="thumb" style="background:${swatchColor(id)}">${esc(String(title).split(' ').map((w) => w[0]).join('').slice(0, 2))}</span>`;
const avatar = (id, name) => `<span class="thumb" style="background:${swatchColor(id)};border-radius:50%">${esc(initials(name))}</span>`;

const ui = {
  store: localStorage.getItem('cartwright:ui:store') || 'STO-1',
  pages: {},
  f: {},
  carts: JSON.parse(localStorage.getItem('cartwright:ui:carts') || '{}'),
};
const store = () => get('stores', ui.store) || S().stores[0];
const saveCarts = () => localStorage.setItem('cartwright:ui:carts', JSON.stringify(ui.carts));

// ---- toasts & modal ---------------------------------------------------------------
function toast(msg, err = false) {
  const el = document.createElement('div');
  el.className = `toast${err ? ' err' : ''}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), err ? 6000 : 3000);
}

function openModal({ title, body, footer = '', onMount = null }) {
  closeModal();
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-back"><div class="modal" role="dialog" aria-label="${esc(title)}">
    <header><h2>${esc(title)}</h2><button class="btn small" data-close aria-label="Close">✕</button></header>
    <div class="body">${body}</div>${footer ? `<footer>${footer}</footer>` : ''}</div></div>`;
  $('[data-close]', root).onclick = closeModal;
  $('.modal-back', root).addEventListener('mousedown', (e) => { if (e.target.classList.contains('modal-back')) closeModal(); });
  if (onMount) onMount($('.modal', root));
}
function closeModal() { $('#modal-root').innerHTML = ''; }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

/** Dispatch an action, toast the outcome, re-render. */
function act(type, params, okMsg) {
  const r = cw.dispatch(type, params);
  if (r.ok) { if (okMsg) toast(okMsg); render(); } else toast(`${r.error.code}: ${r.error.message}`, true);
  return r;
}

// ---- generic form ------------------------------------------------------------------
function fieldHtml(f) {
  const v = f.value ?? '';
  const cls = f.full ? ' class="full"' : '';
  if (f.type === 'select') {
    return `<label${cls}>${esc(f.label)}<select name="${f.name}"${f.multiple ? ' multiple size="5"' : ''}>${f.options.map((o) => { const [val, lab] = Array.isArray(o) ? o : [o, o]; const sel = f.multiple ? (v || []).includes(val) : String(val) === String(v); return `<option value="${esc(val)}"${sel ? ' selected' : ''}>${esc(lab)}</option>`; }).join('')}</select></label>`;
  }
  if (f.type === 'textarea') return `<label${cls}>${esc(f.label)}<textarea name="${f.name}" placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea></label>`;
  if (f.type === 'checkbox') return `<label${cls} style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" name="${f.name}"${v ? ' checked' : ''}> ${esc(f.label)}</label>`;
  if (f.type === 'html') return `<div class="full">${f.html}</div>`;
  return `<label${cls}>${esc(f.label)}<input name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}"${f.step ? ` step="${f.step}"` : ''}${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ''}></label>`;
}

function openForm({ title, fields, submitLabel = 'Save', onSubmit, onMount }) {
  openModal({
    title,
    body: `<form class="form" onsubmit="return false">${fields.map(fieldHtml).join('')}</form><div class="form-error"></div>`,
    footer: `<button class="btn" data-cancel>Cancel</button><button class="btn primary" data-submit>${esc(submitLabel)}</button>`,
    onMount(m) {
      $('[data-cancel]', m).onclick = closeModal;
      $('[data-submit]', m).onclick = () => {
        const values = {};
        for (const f of fields) {
          if (!f.name) continue;
          const el = $(`[name="${f.name}"]`, m);
          if (!el) continue;
          values[f.name] = f.type === 'checkbox' ? el.checked : f.multiple ? [...el.selectedOptions].map((o) => o.value) : el.value;
        }
        const r = onSubmit(values, m);
        if (r && r.ok === false) $('.form-error', m).textContent = `${r.error.code}: ${r.error.message}`;
        else if (r && r.ok) closeModal();
      };
      if (onMount) onMount(m);
      const first = $('input,select,textarea', m);
      if (first) first.focus();
    },
  });
}
/** Like act() but leaves the modal open on failure (the form shows the error). */
const submit = (type, params, okMsg) => { const r = cw.dispatch(type, params); if (r.ok) { toast(okMsg); setTimeout(render); } return r; };

// ---- table helper ---------------------------------------------------------------------
/** Page numbers to show: first, last, and a window around the current page, with gaps as null. */
function pageList(cur, count) {
  const want = new Set([0, count - 1, cur - 1, cur, cur + 1].filter((p) => p >= 0 && p < count));
  const out = [];
  [...want].sort((a, b) => a - b).forEach((p, i, arr) => { if (i && p - arr[i - 1] > 1) out.push(null); out.push(p); });
  return out;
}
function table(key, rows, columns, { pageSize = 25, href, empty = 'Nothing here yet.', noun = 'row' } = {}) {
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageNo = Math.min(ui.pages[key] || 0, pages - 1);
  const slice = rows.slice(pageNo * pageSize, pageNo * pageSize + pageSize);
  const cls = (c) => [c.num ? 'num' : '', c.cls || ''].join(' ').trim();
  const from = rows.length ? pageNo * pageSize + 1 : 0;
  const to = Math.min(rows.length, (pageNo + 1) * pageSize);
  const html = `<div class="table-wrap"><table><thead><tr>${columns.map((c) => `<th class="${cls(c)}">${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${slice.map((r) => `<tr${href ? ` data-href="${esc(href(r))}"` : ''}>${columns.map((c) => `<td class="${cls(c)}">${c.render(r)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${columns.length}" class="empty">${esc(empty)}</td></tr>`}</tbody></table></div>
    ${rows.length > pageSize ? `<div class="pager" data-pager="${key}"><span>Showing ${from}–${to} of ${rows.length} ${noun}s</span><span class="pages">
      <button class="btn small" data-page="-1"${pageNo === 0 ? ' disabled' : ''} aria-label="Previous page">‹</button>
      ${pageList(pageNo, pages).map((p) => (p == null ? '<span class="gap">…</span>' : `<button class="btn small${p === pageNo ? ' on' : ''}" data-goto="${p}"${p === pageNo ? ' aria-current="page"' : ''}>${p + 1}</button>`)).join('')}
      <button class="btn small" data-page="1"${pageNo + 1 >= pages ? ' disabled' : ''} aria-label="Next page">›</button></span></div>`
    : rows.length ? `<div class="pager"><span>${plural(rows.length, noun)}</span></div>` : ''}`;
  return { html, wire(root) {
    $$(`[data-pager="${key}"] [data-page]`, root).forEach((b) => { b.onclick = () => { ui.pages[key] = pageNo + Number(b.dataset.page); render(); }; });
    $$(`[data-pager="${key}"] [data-goto]`, root).forEach((b) => { b.onclick = () => { ui.pages[key] = Number(b.dataset.goto); render(); }; });
    if (href) $$('[data-href]', root).forEach((tr) => { tr.onclick = (e) => { if (!e.target.closest('a,button,input,select')) location.hash = tr.dataset.href; }; });
  } };
}
const tabs = (key, options, current, extra = '') => `<div class="tabs${extra ? ` ${extra}` : ''}" data-tabs="${key}">${options.map(([v, l]) => `<button data-v="${esc(v)}" class="${v === current ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
const cardTabs = (key, options, current) => tabs(key, options, current, 'card-tabs');
/** A full-bleed card: optional tabs strip, optional filter toolbar, then the table. */
const tableCard = (t, { tabsHtml = '', toolbar = '', title = '' } = {}) => `<div class="card flush">${title ? `<h2>${title}</h2>` : ''}${tabsHtml}${toolbar ? `<div class="card-toolbar">${toolbar}</div>` : ''}${t.html}</div>`;
const btnIcon = (id, label, name = 'plus', cls = 'primary') => `<button class="btn ${cls}" id="${id}">${icon(name)}${esc(label)}</button>`;
function wireFilters(root) {
  $$('[data-tabs]', root).forEach((t) => $$('button', t).forEach((b) => { b.onclick = () => { ui.f[t.dataset.tabs] = b.dataset.v; ui.pages = {}; render(); }; }));
  $$('[data-filter]', root).forEach((el) => {
    const ev = el.tagName === 'SELECT' ? 'change' : 'keydown';
    el.addEventListener(ev, (e) => { if (ev === 'keydown' && e.key !== 'Enter') return; ui.f[el.dataset.filter] = el.value; ui.pages = {}; render(); });
  });
}
const filterInput = (key, placeholder) => `<input data-filter="${key}" placeholder="${esc(placeholder)} (Enter)" value="${esc(ui.f[key] || '')}">`;
const searchInput = (key, placeholder) => `<span class="search-field">${icon('search')}${filterInput(key, placeholder)}</span>`;

/** Parse "SKU x 2" / "SKU, 2" / "SKU 2" lines into [{sku, quantity}]. */
function parseLines(text) {
  return String(text).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = /^(\S+)\s*(?:[x×,*]\s*|\s+)?(\d+)?$/i.exec(l);
    return m ? { sku: m[1], quantity: Number(m[2] || 1) } : { sku: l, quantity: 1 };
  });
}

// ---- chart (single series, columns over time) --------------------------------------
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
}
function columnChart(rows, { value, label, fmt, title }) {
  const W = 760; const H = 230; const L = 64; const R = 8; const T = 10; const B = 26;
  const max = niceMax(Math.max(...rows.map(value), 0));
  const band = (W - L - R) / Math.max(rows.length, 1);
  const bw = Math.max(2, Math.min(24, band - 2));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const every = Math.ceil(rows.length / 8);
  const bar = (x, top, w, h) => { const r = Math.min(4, h, w / 2); return `M${x},${top + h}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${top + h}Z`; };
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">
    <g class="grid">${ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${esc(fmt(t, true))}</text>`).join('')}</g>
    ${rows.map((r, i) => {
      const x = L + i * band + (band - bw) / 2;
      const v = value(r);
      const h = Math.max(0, y(0) - y(v));
      return `<g data-tip="${esc(`${label(r)}: ${fmt(v)}`)}"><rect class="hit" x="${L + i * band}" y="${T}" width="${band}" height="${H - T - B}" fill="transparent"/>${h > 0 ? `<path class="bar" d="${bar(x, y(v), bw, h)}"/>` : ''}
      ${i % every === 0 ? `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(label(r).slice(5))}</text>` : ''}</g>`;
    }).join('')}
  </svg>`;
}
function wireChart(root) {
  let tip = null;
  $$('[data-tip]', root).forEach((g) => {
    g.addEventListener('mousemove', (e) => {
      if (!tip) { tip = document.createElement('div'); tip.className = 'chart-tip'; document.body.appendChild(tip); }
      tip.textContent = g.dataset.tip;
      tip.style.left = `${e.clientX + 12}px`;
      tip.style.top = `${e.clientY - 28}px`;
      $('.bar', g)?.classList.add('hover');
    });
    g.addEventListener('mouseleave', () => { tip?.remove(); tip = null; $('.bar', g)?.classList.remove('hover'); });
  });
}
const shortMoney = (c, axis) => (!axis ? money(c) : c >= 100000 ? `$${Math.round(c / 10000) / 10}k` : `$${Math.round(c / 100)}`);

// ---- pages ----------------------------------------------------------------------------------
const PAGES = {};

PAGES.home = () => {
  const sid = ui.store;
  const sum = Q('analyticsSummary', { storeId: sid });
  const sales = Q('salesOverTime', { storeId: sid });
  const n = (p) => Q('listOrders', { storeId: sid, ...p, limit: 0 }).total;
  const toShip = n({ status: 'open', financialStatus: 'paid', fulfillmentStatus: 'unfulfilled' });
  const toCapture = n({ status: 'open', financialStatus: 'authorized' });
  const unpaid = n({ status: 'open', financialStatus: 'pending' });
  const returns = Q('listReturns', { storeId: sid, status: 'requested', limit: 0 }).total;
  const lowStock = Q('listVariants', { storeId: sid, lowStock: STOCK_LOW, limit: 6 });
  const recent = Q('listOrders', { storeId: sid, limit: 8 }).items;
  const kpi = (ic, label, value, sub, amber = false) => `<div class="tile"><div class="label"><span class="ic${amber ? ' amber' : ''}">${icon(ic)}</span>${label}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
  const todo = (go, href, label, count) => `<li><a href="${href}"${go ? ` data-go="${go}"` : ''}><span class="count${count ? ' hot' : ''}">${count}</span><span class="grow">${label}</span><span class="muted">›</span></a></li>`;
  const recentTable = `<div class="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Payment</th><th>Fulfillment</th><th class="num">Total</th></tr></thead><tbody>
    ${recent.map((o) => `<tr data-href="#/orders/${o.id}"><td><a class="cell-title" href="#/orders/${o.id}">${esc(o.name)}</a><div class="muted tiny">${when(o.createdAt)}</div></td><td>${esc(custName(o.customerId))}</td><td>${pill(o.financialStatus)}</td><td>${pill(o.fulfillmentStatus)}</td><td class="num">${money(o.totalCents)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No orders yet.</td></tr>'}
  </tbody></table></div>`;
  return {
    title: 'Home',
    subtitle: `Here's what's happening at ${esc(store().name)} over the last 30 days.`,
    actions: `<a class="btn" href="#/analytics">View analytics</a>${btnIcon('home-new-order', 'Create order')}`,
    html: `<div class="tiles">
      ${kpi('money', 'Total sales', money(sum.totalSalesCents), `net ${money(sum.netSalesCents)}`)}
      ${kpi('cart', 'Orders', sum.orders, 'last 30 days')}
      ${kpi('avg', 'Average order value', money(sum.averageOrderValueCents), 'per order', true)}
      ${kpi('people', 'Returning customers', `${(sum.returningCustomerRate * 100).toFixed(1)}%`, 'of ordering customers', true)}
    </div>
    <div class="layout"><div>
      <div class="card"><h2>Net sales by day <span class="muted tiny">last 30 days</span></h2>${columnChart(sales.rows, { value: (r) => r.netSalesCents, label: (r) => r.period, fmt: shortMoney, title: 'Net sales by day' })}</div>
      <div class="card flush"><h2>Recent orders <a class="tiny" href="#/orders" data-go="all">View all</a></h2>${recentTable}</div>
    </div><div>
      <div class="card"><h2>To do</h2><ul class="todo">
        ${todo('ship', '#/orders', 'Orders to fulfill', toShip)}
        ${todo('capture', '#/orders', 'Payments to capture', toCapture)}
        ${todo('unpaid', '#/orders', 'Orders awaiting payment', unpaid)}
        ${todo('', '#/returns', 'Return requests to review', returns)}
      </ul></div>
      <div class="card"><h2>Low stock <a class="tiny" href="#/inventory">Inventory</a></h2>
        ${lowStock.items.map((v) => `<div class="with-thumb" style="margin-bottom:var(--s-3)">${thumb(v.productId, v.productTitle)}<div style="flex:1;min-width:0"><a href="#/products/${v.productId}">${esc(v.productTitle)}</a><div class="muted tiny">${esc(v.title)} · ${esc(v.sku)}</div></div><span class="pill ${v.totalAvailable <= 0 ? 'out-of-stock' : 'low-stock'}">${v.totalAvailable}</span></div>`).join('') || '<p class="muted">Everything is well stocked.</p>'}
        ${lowStock.total > lowStock.items.length ? `<p class="muted tiny">+ ${lowStock.total - lowStock.items.length} more variants below ${STOCK_LOW}</p>` : ''}
      </div>
    </div></div>`,
    wire(root) {
      wireChart(root);
      $$('[data-go]', root).forEach((a) => { a.onclick = () => { ui.f.orderTab = a.dataset.go; }; });
      $$('[data-href]', root).forEach((tr) => { tr.onclick = (e) => { if (!e.target.closest('a')) location.hash = tr.dataset.href; }; });
      $('#home-new-order', root).onclick = () => newOrderForm();
    },
  };
};

// ---- orders
const ORDER_TABS = [['all', 'All'], ['ship', 'Unfulfilled'], ['unpaid', 'Unpaid'], ['capture', 'To capture'], ['open', 'Open'], ['closed', 'Closed'], ['cancelled', 'Cancelled']];
PAGES.orders = () => {
  const tab = ui.f.orderTab || 'all';
  const p = { storeId: ui.store, q: ui.f.orderQ || undefined, tag: ui.f.orderTag || undefined };
  if (tab === 'ship') Object.assign(p, { status: 'open', fulfillmentStatus: 'unfulfilled' });
  if (tab === 'unpaid') Object.assign(p, { status: 'open', financialStatus: 'pending' });
  if (tab === 'capture') Object.assign(p, { status: 'open', financialStatus: 'authorized' });
  if (['open', 'closed', 'cancelled'].includes(tab)) p.status = tab;
  const rows = Q('listOrders', p).items;
  const t = table('orders', rows, [
    { label: 'Order', render: (o) => `<a class="cell-title" href="#/orders/${o.id}">${esc(o.name)}</a>` },
    { label: 'Date', cls: 'nowrap', render: (o) => when(o.createdAt) },
    { label: 'Customer', render: (o) => esc(custName(o.customerId)) },
    { label: 'Payment', render: (o) => pill(o.financialStatus) },
    { label: 'Fulfillment', render: (o) => pill(o.fulfillmentStatus) },
    { label: 'Status', render: (o) => pill(o.status) },
    { label: 'Tags', render: (o) => tagsHtml(o.tags) },
    { label: 'Items', num: true, render: (o) => o.lineItems.reduce((a, l) => a + l.quantity, 0) },
    { label: 'Total', num: true, render: (o) => `<strong>${money(o.totalCents)}</strong>` },
  ], { href: (o) => `#/orders/${o.id}`, noun: 'order', empty: 'No orders match these filters.' });
  return {
    title: 'Orders',
    subtitle: `${plural(rows.length, 'order')} in ${esc(store().name)}`,
    actions: btnIcon('new-order', 'Create order'),
    html: tableCard(t, { tabsHtml: cardTabs('orderTab', ORDER_TABS, tab), toolbar: `${searchInput('orderQ', 'Order # or email')} ${filterInput('orderTag', 'Tag')}` }),
    wire(root) { wireFilters(root); t.wire(root); $('#new-order', root).onclick = () => newOrderForm(); },
  };
};

function newOrderForm(customerId) {
  const c = customerId ? get('customers', customerId) : null;
  openForm({
    title: `Create order · ${store().name}`,
    fields: [
      { name: 'customer', label: 'Customer email or ID', value: c ? c.email : '', full: true, placeholder: 'CUS-00001 or someone@example.com' },
      { name: 'lines', label: 'Items — one per line: SKU x quantity', type: 'textarea', full: true, placeholder: 'FH-001-M-BLA x 2' },
      { name: 'discountCode', label: 'Discount code (optional)' },
      { name: 'shippingMethod', label: 'Shipping', type: 'select', options: C.SHIPPING_METHODS.map((m) => [m, C.SHIPPING_LABELS[m]]) },
      { name: 'paymentStatus', label: 'Payment', type: 'select', options: [['paid', 'Paid'], ['pending', 'Payment pending'], ['authorized', 'Authorized (capture later)']] },
      { name: 'tags', label: 'Tags (comma separated)' },
      { name: 'note', label: 'Note', full: true },
    ],
    submitLabel: 'Create order',
    onSubmit(v) {
      const who = v.customer.trim();
      const params = { storeId: ui.store, lineItems: parseLines(v.lines), discountCode: v.discountCode || undefined, shippingMethod: v.shippingMethod, paymentStatus: v.paymentStatus, tags: v.tags, note: v.note || undefined };
      if (/^CUS-/.test(who)) params.customerId = who; else if (who) params.email = who;
      const r = submit('createOrder', params, 'Order created');
      if (r.ok) setTimeout(() => { location.hash = `#/orders/${r.result.order.id}`; });
      return r;
    },
  });
}

function fulfillForm(o) {
  const open = o.lineItems.filter((l) => l.fulfillableQty > 0);
  openForm({
    title: `Fulfill ${o.name}`,
    fields: [
      { type: 'html', html: `<table><thead><tr><th>Item</th><th class="num">Remaining</th><th class="num">Ship now</th></tr></thead><tbody>${open.map((l) => `<tr><td>${esc(l.title)} — ${esc(l.variantTitle)}<div class="muted tiny">${esc(l.sku)}</div></td><td class="num">${l.fulfillableQty}</td><td class="num"><input class="qty" type="number" min="0" max="${l.fulfillableQty}" value="${l.fulfillableQty}" data-li="${l.id}"></td></tr>`).join('')}</tbody></table>
        <p class="muted tiny">Ships from ${esc(locLabel(o.locationId))}.</p>` },
      { name: 'trackingCompany', label: 'Carrier', type: 'select', options: [['', '— none —'], ...C.CARRIERS] },
      { name: 'trackingNumber', label: 'Tracking number' },
      { name: 'notifyCustomer', label: 'Send shipping confirmation to customer', type: 'checkbox', value: true, full: true },
    ],
    submitLabel: 'Fulfill items',
    onSubmit(v, m) {
      const lineItems = $$('[data-li]', m).map((i) => ({ lineItemId: i.dataset.li, quantity: Number(i.value) })).filter((x) => x.quantity > 0);
      return submit('createFulfillment', { orderId: o.id, lineItems, trackingCompany: v.trackingCompany || undefined, trackingNumber: v.trackingNumber || undefined, notifyCustomer: v.notifyCustomer }, 'Items fulfilled');
    },
  });
}

function refundForm(o) {
  const lines = o.lineItems.filter((l) => l.quantity - l.refundedQty > 0);
  const locs = S().locations.filter((l) => l.storeId === o.storeId);
  openForm({
    title: `Refund ${o.name}`,
    fields: [
      { type: 'html', html: `<table><thead><tr><th>Item</th><th class="num">Refundable</th><th class="num">Refund qty</th><th>Restock</th></tr></thead><tbody>${lines.map((l) => `<tr><td>${esc(l.title)} — ${esc(l.variantTitle)}<div class="muted tiny">${esc(l.sku)} · ${money(l.priceCents)}</div></td><td class="num">${l.quantity - l.refundedQty}</td><td class="num"><input class="qty" type="number" min="0" max="${l.quantity - l.refundedQty}" value="0" data-li="${l.id}"></td><td><input type="checkbox" data-restock="${l.id}" checked></td></tr>`).join('') || '<tr><td colspan="4" class="muted">No refundable items.</td></tr>'}</tbody></table>
        <p class="muted tiny">Refundable now: ${money(o.money.refundableCents)} · shipping refundable: ${money(o.money.shippingRefundableCents)}. The amount is computed from items (incl. discount and tax) unless you override it.</p>` },
      { name: 'locationId', label: 'Restock at', type: 'select', options: locs.map((l) => [l.id, l.name]), value: o.locationId },
      { name: 'reason', label: 'Reason', type: 'select', options: C.REFUND_REASONS },
      { name: 'refundShipping', label: `Refund shipping (${money(o.money.shippingRefundableCents)})`, type: 'checkbox' },
      { name: 'amount', label: 'Override amount $ (optional)', type: 'number', step: '0.01' },
      { name: 'note', label: 'Note', full: true },
    ],
    submitLabel: 'Refund',
    onSubmit(v, m) {
      const lineItems = $$('[data-li]', m).map((i) => ({ lineItemId: i.dataset.li, quantity: Number(i.value), restock: $(`[data-restock="${i.dataset.li}"]`, m).checked, locationId: v.locationId })).filter((x) => x.quantity > 0);
      return submit('createRefund', { orderId: o.id, lineItems, refundShipping: v.refundShipping, amountCents: toCents(v.amount), reason: v.reason, note: v.note || undefined }, 'Refund issued');
    },
  });
}

function returnForm(o) {
  const lines = o.lineItems.filter((l) => l.fulfilledQty > 0);
  openForm({
    title: `Create return · ${o.name}`,
    fields: [
      { type: 'html', html: `<table><thead><tr><th>Item</th><th class="num">Fulfilled</th><th class="num">Return qty</th></tr></thead><tbody>${lines.map((l) => `<tr><td>${esc(l.title)} — ${esc(l.variantTitle)}</td><td class="num">${l.fulfilledQty}</td><td class="num"><input class="qty" type="number" min="0" max="${l.fulfilledQty}" value="0" data-li="${l.id}"></td></tr>`).join('')}</tbody></table>` },
      { name: 'reason', label: 'Reason', type: 'select', options: C.RETURN_REASONS },
      { name: 'note', label: 'Note', full: true },
    ],
    submitLabel: 'Create return',
    onSubmit(v, m) {
      const lineItems = $$('[data-li]', m).map((i) => ({ lineItemId: i.dataset.li, quantity: Number(i.value), reason: v.reason })).filter((x) => x.quantity > 0);
      return submit('requestReturn', { orderId: o.id, lineItems, note: v.note || undefined }, 'Return created');
    },
  });
}

function refundReturnForm(r, o) {
  openForm({
    title: `Refund return ${r.id}`,
    fields: [
      { name: 'restock', label: 'Restock returned items', type: 'checkbox', value: true },
      { name: 'locationId', label: 'Restock at', type: 'select', options: S().locations.filter((l) => l.storeId === o.storeId).map((l) => [l.id, l.name]), value: o.locationId },
      { name: 'refundShipping', label: 'Also refund shipping', type: 'checkbox' },
    ],
    submitLabel: 'Refund & close return',
    onSubmit: (v) => submit('refundReturn', { returnId: r.id, ...v }, 'Return refunded'),
  });
}

PAGES.order = (id) => {
  const o = Q('getOrder', { orderId: id });
  const open = o.status !== 'cancelled';
  const B = (k, label, cls = '') => `<button class="btn ${cls}" data-a="${k}">${esc(label)}</button>`;
  const btns = [];
  if (open && o.lineItems.some((l) => l.fulfillableQty > 0)) btns.push(B('fulfill', 'Fulfill items', 'primary'));
  if (open && ['pending', 'partially_paid'].includes(o.financialStatus)) btns.push(B('paid', 'Mark as paid', 'primary'));
  if (open && o.money.capturableCents > 0) btns.push(B('capture', `Capture ${money(o.money.capturableCents)}`, 'primary'));
  if (o.money.refundableCents > 0 || o.lineItems.some((l) => l.quantity > l.refundedQty)) btns.push(B('refund', 'Refund'));
  if (open && o.lineItems.some((l) => l.fulfilledQty > 0)) btns.push(B('return', 'Create return'));
  btns.push(B('edit', 'Edit note & tags'));
  if (o.status === 'open') btns.push(B('close', 'Archive'));
  if (o.status === 'closed') btns.push(B('reopen', 'Unarchive'));
  if (open && o.lineItems.every((l) => l.fulfilledQty === 0)) btns.push(B('cancel', 'Cancel order', 'danger'));
  const addr = o.shippingAddress;
  const skuOf = (lid) => esc(o.lineItems.find((l) => l.id === lid).sku);
  const units = o.lineItems.reduce((a, l) => a + l.quantity, 0);
  const html = `<div class="layout"><div>
    <div class="card flush"><h2>Items <span>${pill(o.fulfillmentStatus)}</span></h2><div class="table-wrap"><table><thead><tr><th>Product</th><th>SKU</th><th class="num">Price</th><th class="num">Qty</th><th class="num">Discount</th><th class="num">Fulfilled</th><th class="num">Refunded</th><th class="num">To ship</th><th class="num">Line total</th></tr></thead><tbody>
      ${o.lineItems.map((l) => `<tr><td><div class="with-thumb">${thumb(l.productId, l.title)}<div><a href="#/products/${l.productId}">${esc(l.title)}</a><div class="muted tiny">${esc(l.variantTitle)}</div></div></div></td><td class="muted nowrap">${esc(l.sku)}</td><td class="num">${money(l.priceCents)}</td><td class="num">${l.quantity}</td><td class="num">${l.discountCents ? `−${money(l.discountCents)}` : ''}</td><td class="num">${l.fulfilledQty}</td><td class="num">${l.refundedQty || ''}</td><td class="num">${l.fulfillableQty}</td><td class="num">${money(l.priceCents * l.quantity - (l.discountCents || 0))}</td></tr>`).join('')}
    </tbody></table></div></div>
    <div class="card"><h2>Payment <span>${pill(o.financialStatus)}</span></h2><dl class="sum">
      <dt>Subtotal <span class="muted tiny">${plural(units, 'item')}</span></dt><dd>${money(o.subtotalCents)}</dd>
      <dt>Discount ${o.discountCode ? `<span class="tag">${esc(o.discountCode)}</span>` : ''}</dt><dd>${o.discountCode ? `−${money(o.discountCents + o.shippingDiscountCents)}` : '—'}</dd>
      <dt>Shipping <span class="muted tiny">${esc(C.SHIPPING_LABELS[o.shippingMethod])}</span></dt><dd>${money(o.shippingCents - o.shippingDiscountCents)}</dd>
      <dt>Tax</dt><dd>${money(o.taxCents)}</dd>
      <dt class="total">Total</dt><dd class="total">${money(o.totalCents)}</dd>
      <div class="sep"></div>
      <dt>Paid by customer</dt><dd>${money(o.money.paidCents)}</dd>
      <dt>Refunded</dt><dd>${o.money.refundedCents ? `−${money(o.money.refundedCents)}` : money(0)}</dd>
      <dt><strong>Net payment</strong></dt><dd><strong>${money(o.money.netPaidCents)}</strong></dd>
    </dl></div>
    <div class="card flush"><h2>Fulfillments</h2>${o.fulfillments.length ? `<div class="table-wrap"><table><thead><tr><th>ID</th><th>Date</th><th>Items</th><th>Tracking</th><th>Status</th><th></th></tr></thead><tbody>${o.fulfillments.map((f) => `<tr><td>${f.id}</td><td>${when(f.createdAt)}</td><td>${f.lineItems.map((x) => `${x.quantity} × ${skuOf(x.lineItemId)}`).join('<br>')}</td><td>${f.trackingNumber ? `${esc(f.trackingCompany)} ${f.trackingUrl ? `<a href="${esc(f.trackingUrl)}" target="_blank" rel="noopener">${esc(f.trackingNumber)}</a>` : esc(f.trackingNumber)}` : '<span class="muted">none</span>'}</td><td>${pill(f.status)}</td><td class="num">${f.status === 'success' ? `<span class="inline-save"><button class="btn small" data-track="${f.id}">Edit tracking</button><button class="btn small danger" data-fcancel="${f.id}">Cancel</button></span>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="card-section muted">No fulfillments yet.</div>'}</div>
    <div class="card flush"><h2>Returns</h2>${o.returns.length ? `<div class="table-wrap"><table><thead><tr><th>ID</th><th>Created</th><th>Items</th><th>Status</th><th></th></tr></thead><tbody>${o.returns.map((r) => `<tr><td>${r.id}</td><td>${when(r.createdAt)}</td><td>${r.lineItems.map((x) => `${x.quantity} × ${skuOf(x.lineItemId)} <span class="muted tiny">(${esc(x.reason.replace(/_/g, ' '))})</span>`).join('<br>')}</td><td>${pill(r.status)}</td><td class="num">${r.status === 'requested' ? `<span class="inline-save"><button class="btn small primary" data-rapprove="${r.id}">Approve</button><button class="btn small danger" data-rdecline="${r.id}">Decline</button></span>` : r.status === 'open' ? `<button class="btn small primary" data-rrefund="${r.id}">Refund…</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="card-section muted">No returns.</div>'}</div>
    <div class="card flush"><h2>Refunds</h2>${o.refunds.length ? `<div class="table-wrap"><table><thead><tr><th>ID</th><th>Date</th><th>Items</th><th>Reason</th><th class="num">Shipping</th><th class="num">Amount</th></tr></thead><tbody>${o.refunds.map((r) => `<tr><td>${r.id}</td><td>${when(r.createdAt)}</td><td>${r.lineItems.map((x) => `${x.quantity} × ${skuOf(x.lineItemId)}${x.restock ? ` <span class="muted tiny">restocked @ ${esc(locLabel(x.locationId))}</span>` : ''}`).join('<br>') || '—'}</td><td>${esc(r.reason.replace(/_/g, ' '))}</td><td class="num">${money(r.shippingCents)}</td><td class="num">${money(r.amountCents)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="card-section muted">No refunds.</div>'}</div>
  </div><div>
    <div class="card"><h2>Customer</h2>
      ${o.customerId ? `<div class="with-thumb">${avatar(o.customerId, custName(o.customerId))}<div>${custLink(o.customerId)}<div class="muted tiny">${esc(o.email)}</div></div></div>` : `<p>${custLink(o.customerId)}<br><span class="muted">${esc(o.email)}</span></p>`}
      <h3>Shipping address</h3><div class="addr">${addr ? `${esc(addr.name)}<br>${esc(addr.address1)}<br>${esc(addr.city)}, ${esc(addr.province)} ${esc(addr.zip)}<br>${esc(addr.country)}` : '<span class="muted">Local pickup</span>'}</div></div>
    <div class="card"><h2>Order details</h2><dl class="kv">
      <dt>Status</dt><dd>${pill(o.status)}${o.cancelReason ? ` <span class="muted tiny">${esc(o.cancelReason)}</span>` : ''}</dd>
      <dt>Placed</dt><dd>${when(o.createdAt)}</dd>
      <dt>Channel</dt><dd>${esc(o.source.replace('_', ' '))}</dd>
      <dt>Location</dt><dd>${esc(locLabel(o.locationId))}</dd>
      <dt>Tags</dt><dd>${tagsHtml(o.tags)}</dd>
      <dt>Note</dt><dd>${o.note ? esc(o.note) : '<span class="muted">—</span>'}</dd>
      <dt>ID</dt><dd class="muted">${o.id}</dd>
    </dl></div>
    <div class="card"><h2>Timeline</h2>${o.transactions.length ? `<ul class="timeline">${o.transactions.map((t) => `<li><strong style="text-transform:capitalize">${esc(t.kind)}</strong> ${t.amountCents ? money(t.amountCents) : ''} <span class="muted">· ${esc(t.gateway)}</span><div class="muted tiny">${when(t.createdAt)}</div></li>`).join('')}</ul>` : '<p class="muted">No transactions.</p>'}</div>
  </div></div>`;
  return {
    title: `Order ${o.name}`,
    titleHtml: `${esc(o.name)} ${pill(o.financialStatus)} ${pill(o.fulfillmentStatus)}`,
    crumbs: [['Orders', '#/orders']],
    subtitle: `${when(o.createdAt)} · ${esc(o.source.replace('_', ' '))} · ${esc(o.email)}`,
    actions: [...btns.filter((b) => !b.includes('primary')), ...btns.filter((b) => b.includes('primary'))].join(''),
    html,
    wire(root) {
      const on = (k, fn) => { const b = $(`[data-a="${k}"]`, root); if (b) b.onclick = fn; };
      on('fulfill', () => fulfillForm(o));
      on('paid', () => act('markOrderPaid', { orderId: o.id }, 'Marked as paid'));
      on('capture', () => act('capturePayment', { orderId: o.id }, 'Payment captured'));
      on('refund', () => refundForm(o));
      on('return', () => returnForm(o));
      on('close', () => act('closeOrder', { orderId: o.id }, 'Order archived'));
      on('reopen', () => act('reopenOrder', { orderId: o.id }, 'Order unarchived'));
      on('edit', () => openForm({ title: `Edit ${o.name}`, fields: [{ name: 'tags', label: 'Tags (comma separated)', value: o.tags.join(', '), full: true }, { name: 'note', label: 'Note', type: 'textarea', value: o.note, full: true }], onSubmit: (v) => submit('updateOrder', { orderId: o.id, tags: v.tags, note: v.note }, 'Order updated') }));
      on('cancel', () => openForm({
        title: `Cancel ${o.name}`,
        fields: [{ name: 'reason', label: 'Reason', type: 'select', options: C.CANCEL_REASONS }, { name: 'refund', label: `Refund payment (${money(o.money.refundableCents)})`, type: 'checkbox', value: true }, { name: 'restock', label: 'Restock items', type: 'checkbox', value: true }],
        submitLabel: 'Cancel order',
        onSubmit: (v) => submit('cancelOrder', { orderId: o.id, ...v }, 'Order cancelled'),
      }));
      $$('[data-track]', root).forEach((b) => { b.onclick = () => { const f = o.fulfillments.find((x) => x.id === b.dataset.track); openForm({ title: `Tracking for ${f.id}`, fields: [{ name: 'trackingCompany', label: 'Carrier', type: 'select', options: C.CARRIERS, value: f.trackingCompany }, { name: 'trackingNumber', label: 'Tracking number', value: f.trackingNumber }], onSubmit: (v) => submit('updateFulfillmentTracking', { fulfillmentId: f.id, ...v }, 'Tracking updated') }); }; });
      $$('[data-fcancel]', root).forEach((b) => { b.onclick = () => act('cancelFulfillment', { fulfillmentId: b.dataset.fcancel }, 'Fulfillment cancelled'); });
      $$('[data-rapprove]', root).forEach((b) => { b.onclick = () => act('approveReturn', { returnId: b.dataset.rapprove }, 'Return approved'); });
      $$('[data-rdecline]', root).forEach((b) => { b.onclick = () => act('declineReturn', { returnId: b.dataset.rdecline }, 'Return declined'); });
      $$('[data-rrefund]', root).forEach((b) => { b.onclick = () => refundReturnForm(o.returns.find((r) => r.id === b.dataset.rrefund), o); });
    },
  };
};

PAGES.returns = () => {
  const tab = ui.f.returnTab || 'requested';
  const rows = Q('listReturns', { storeId: ui.store, status: tab === 'all' ? undefined : tab }).items;
  const t = table('returns', rows, [
    { label: 'Return', render: (r) => `<span class="cell-title">${r.id}</span>` },
    { label: 'Order', render: (r) => orderLink(r.orderId) },
    { label: 'Customer', render: (r) => custLink(r.customerId) },
    { label: 'Created', cls: 'nowrap', render: (r) => when(r.createdAt) },
    { label: 'Items', render: (r) => r.lineItems.map((x) => `${x.quantity} × ${esc(get('orders', r.orderId).lineItems.find((l) => l.id === x.lineItemId).sku)} <span class="muted tiny">${esc(x.reason.replace(/_/g, ' '))}</span>`).join('<br>') },
    { label: 'Status', render: (r) => pill(r.status) },
  ], { href: (r) => `#/orders/${r.orderId}`, noun: 'return', empty: 'No returns in this view.' });
  return {
    title: 'Returns',
    crumbs: [['Orders', '#/orders']],
    subtitle: 'Review return requests, approve them, and refund returned items.',
    html: tableCard(t, { tabsHtml: cardTabs('returnTab', [['requested', 'Requested'], ['open', 'Open'], ['closed', 'Closed'], ['declined', 'Declined'], ['all', 'All']], tab) }),
    wire(root) { wireFilters(root); t.wire(root); },
  };
};

// ---- products
PAGES.products = () => {
  const tab = ui.f.prodTab || 'all';
  const rows = Q('listProducts', { storeId: ui.store, status: tab === 'all' ? undefined : tab, q: ui.f.prodQ || undefined, vendor: ui.f.prodVendor || undefined, sku: ui.f.prodSku || undefined }).items;
  const vendors = [...new Set(S().products.filter((p) => p.storeId === ui.store).map((p) => p.vendor))].sort();
  const t = table('products', rows, [
    { label: 'Product', render: (p) => `<div class="with-thumb">${thumb(p.id, p.title)}<div><a class="cell-title" href="#/products/${p.id}">${esc(p.title)}</a><div class="muted tiny">${esc(p.productType)}</div></div></div>` },
    { label: 'Status', render: (p) => pill(p.status) },
    { label: 'Stock', render: (p) => stockPill(p.totalInventory) },
    { label: 'Inventory', num: true, render: (p) => `${p.totalInventory}<div class="muted tiny">${plural(p.variantsCount, 'variant')}</div>` },
    { label: 'Vendor', render: (p) => esc(p.vendor) },
    { label: 'Tags', render: (p) => tagsHtml(p.tags) },
    { label: 'Price', num: true, render: (p) => (p.minPriceCents === p.maxPriceCents ? money(p.minPriceCents) : `${money(p.minPriceCents)}–${money(p.maxPriceCents)}`) },
  ], { href: (p) => `#/products/${p.id}`, noun: 'product', empty: 'No products match these filters.' });
  return {
    title: 'Products',
    subtitle: `${plural(rows.length, 'product')} in ${esc(store().name)}`,
    actions: `<a class="btn" href="#/collections">Collections</a>${btnIcon('new-product', 'Add product')}`,
    html: tableCard(t, {
      tabsHtml: cardTabs('prodTab', [['all', 'All'], ['active', 'Active'], ['draft', 'Draft'], ['archived', 'Archived']], tab),
      toolbar: `${searchInput('prodQ', 'Search title')} ${filterInput('prodSku', 'SKU')}
        <select data-filter="prodVendor"><option value="">All vendors</option>${vendors.map((v) => `<option${ui.f.prodVendor === v ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>`,
    }),
    wire(root) { wireFilters(root); t.wire(root); $('#new-product', root).onclick = newProductForm; },
  };
};

function newProductForm() {
  const locs = store().locationIds;
  openForm({
    title: `Add product · ${store().name}`,
    fields: [
      { name: 'title', label: 'Title', full: true },
      { name: 'vendor', label: 'Vendor', value: store().name },
      { name: 'productType', label: 'Product type' },
      { name: 'status', label: 'Status', type: 'select', options: C.PRODUCT_STATUSES },
      { name: 'tags', label: 'Tags (comma separated)' },
      { name: 'options', label: 'Options — one per line, "Name: value, value"', type: 'textarea', full: true, placeholder: 'Size: S, M, L\nColor: Black, White' },
      { name: 'price', label: 'Price $ (every variant)', type: 'number', step: '0.01' },
      { name: 'compareAt', label: 'Compare-at price $ (optional)', type: 'number', step: '0.01' },
      { name: 'sku', label: 'SKU (only for products without options)' },
      { name: 'qty', label: `Initial stock per variant at ${locLabel(locs[0])}`, type: 'number', value: 0 },
    ],
    submitLabel: 'Create product',
    onSubmit(v) {
      const options = v.options.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [name, vals = ''] = l.split(':'); return { name: name.trim(), values: vals.split(',').map((x) => x.trim()).filter(Boolean) }; });
      const r = submit('createProduct', { storeId: ui.store, title: v.title, vendor: v.vendor, productType: v.productType, status: v.status, tags: v.tags, options, priceCents: toCents(v.price), compareAtCents: toCents(v.compareAt), sku: v.sku || undefined, inventory: Number(v.qty) ? { [locs[0]]: Number(v.qty) } : undefined }, 'Product created');
      if (r.ok) setTimeout(() => { location.hash = `#/products/${r.result.product.id}`; });
      return r;
    },
  });
}

function variantForm(v) {
  openForm({
    title: `Edit variant ${v.title}`,
    fields: [
      { name: 'price', label: 'Price $', type: 'number', step: '0.01', value: dollars(v.priceCents) },
      { name: 'compareAt', label: 'Compare-at price $ (blank = none)', type: 'number', step: '0.01', value: dollars(v.compareAtCents) },
      { name: 'sku', label: 'SKU', value: v.sku },
      { name: 'inventoryPolicy', label: 'When out of stock', type: 'select', options: [['deny', 'Stop selling'], ['continue', 'Continue selling']], value: v.inventoryPolicy },
      { name: 'weightGrams', label: 'Weight (g)', type: 'number', value: v.weightGrams },
    ],
    onSubmit: (x) => submit('updateVariant', { variantId: v.id, priceCents: toCents(x.price), compareAtCents: x.compareAt === '' ? null : toCents(x.compareAt), sku: x.sku, inventoryPolicy: x.inventoryPolicy, weightGrams: Number(x.weightGrams) }, 'Variant saved'),
  });
}

function stockForm(v, locationId) {
  openForm({
    title: `Inventory · ${v.sku || v.title}`,
    fields: [
      { name: 'locationId', label: 'Location', type: 'select', options: store().locationIds.map((l) => [l, `${locLabel(l)} (${v.inventory[l] ?? 0} available)`]), value: locationId, full: true },
      { name: 'mode', label: 'Change', type: 'select', options: [['adjust', 'Adjust by (+/-)'], ['set', 'Set available to']] },
      { name: 'qty', label: 'Quantity', type: 'number', value: 0 },
      { name: 'reason', label: 'Reason', type: 'select', options: C.ADJUST_REASONS },
      { name: 'note', label: 'Note' },
    ],
    onSubmit: (x) => (x.mode === 'set'
      ? submit('setInventory', { variantId: v.id, locationId: x.locationId, quantity: Number(x.qty), reason: x.reason }, 'Inventory updated')
      : submit('adjustInventory', { variantId: v.id, locationId: x.locationId, delta: Number(x.qty), reason: x.reason, note: x.note || undefined }, 'Inventory adjusted')),
  });
}

PAGES.product = (id) => {
  const p = Q('getProduct', { productId: id });
  if (p.storeId !== ui.store) { ui.store = p.storeId; localStorage.setItem('cartwright:ui:store', p.storeId); }
  const locs = get('stores', p.storeId).locationIds;
  const html = `<div class="layout"><div>
    <div class="card"><h2>Details</h2><form class="form" id="pform" onsubmit="return false">
      ${fieldHtml({ name: 'title', label: 'Title', value: p.title, full: true })}
      ${fieldHtml({ name: 'description', label: 'Description', type: 'textarea', value: p.description, full: true })}
      ${fieldHtml({ name: 'vendor', label: 'Vendor', value: p.vendor })}
      ${fieldHtml({ name: 'productType', label: 'Product type', value: p.productType })}
      ${fieldHtml({ name: 'status', label: 'Status', type: 'select', options: C.PRODUCT_STATUSES, value: p.status })}
      ${fieldHtml({ name: 'tags', label: 'Tags (comma separated)', value: p.tags.join(', ') })}
      <div class="full" style="display:flex;justify-content:flex-end"><button class="btn primary" id="psave">Save product</button></div></form></div>
    <div class="card flush"><h2>Variants ${p.options.length ? `<button class="btn small" id="addvar">${icon('plus')}Add variant</button>` : ''}</h2>
      <div class="card-section muted tiny">${p.options.map((o) => `<strong>${esc(o.name)}</strong>: ${o.values.map(esc).join(', ')}`).join(' · ') || 'No options (single default variant)'}</div>
      <div class="table-wrap"><table><thead><tr><th>Variant</th><th>SKU</th><th>Stock</th><th class="num">Price</th><th class="num">Compare-at</th>${locs.map((l) => `<th class="num">${esc(locLabel(l))}</th>`).join('')}<th></th></tr></thead><tbody>
      ${p.variants.map((v) => { const tot = locs.reduce((a, l) => a + (v.inventory[l] ?? 0), 0); return `<tr><td><span class="cell-title">${esc(v.title)}</span>${v.inventoryPolicy === 'continue' ? '<div class="muted tiny">sells when out of stock</div>' : ''}</td><td class="muted nowrap">${esc(v.sku)}</td><td>${stockPill(tot)}</td><td class="num">${money(v.priceCents)}</td><td class="num">${v.compareAtCents != null ? `<span class="strike" style="margin:0">${money(v.compareAtCents)}</span>` : '—'}</td>
        ${locs.map((l) => `<td class="num"><a href="#" data-stock="${v.id}|${l}" title="Adjust stock at ${esc(locLabel(l))}">${v.inventory[l] ?? 0}</a></td>`).join('')}<td class="num"><button class="btn small" data-var="${v.id}">Edit</button></td></tr>`; }).join('')}
      </tbody></table></div><div class="card-foot muted tiny">Click a stock number to adjust inventory at that location.</div></div>
  </div><div>
    <div class="card"><h2>Status</h2><dl class="kv"><dt>Status</dt><dd>${pill(p.status)}</dd><dt>Availability</dt><dd>${stockPill(p.totalInventory)}</dd><dt>Created</dt><dd>${when(p.createdAt)}</dd></dl></div>
    <div class="card"><h2>Inventory</h2><dl class="sum">${locs.map((l) => `<dt>${esc(locLabel(l))}</dt><dd>${p.variants.reduce((a, v) => a + (v.inventory[l] ?? 0), 0)}</dd>`).join('')}<dt class="total">Total available</dt><dd class="total">${p.totalInventory}</dd></dl></div>
    <div class="card"><h2>Organization</h2><dl class="kv"><dt>Vendor</dt><dd>${esc(p.vendor)}</dd><dt>Type</dt><dd>${esc(p.productType) || '—'}</dd><dt>Handle</dt><dd>${esc(p.handle)}</dd><dt>Tags</dt><dd>${tagsHtml(p.tags)}</dd><dt>ID</dt><dd class="muted">${p.id}</dd></dl></div>
    <div class="card"><h2>Collections</h2>${p.collections.map((c) => `<div style="display:flex;justify-content:space-between;margin-bottom:var(--s-2)"><a href="#/collections/${c.id}">${esc(c.title)}</a> <span class="muted tiny">${c.type === 'smart' ? 'Automated' : 'Manual'}</span></div>`).join('') || '<p class="muted">Not in any collection.</p>'}</div>
  </div></div>`;
  return {
    title: p.title,
    titleHtml: `${esc(p.title)} ${pill(p.status)}`,
    crumbs: [['Products', '#/products']],
    subtitle: `${esc(p.vendor)} · ${plural(p.variants.length, 'variant')} · ${p.totalInventory} in stock`,
    actions: p.status === 'active' ? `<a class="btn" href="#/storefront">${icon('ext')}View in storefront</a>` : '',
    html,
    wire(root) {
      $('#psave', root).onclick = () => { const f = $('#pform', root); const val = (n) => $(`[name=${n}]`, f).value; act('updateProduct', { productId: p.id, title: val('title'), description: val('description'), vendor: val('vendor'), productType: val('productType'), status: val('status'), tags: val('tags') }, 'Product saved'); };
      $$('[data-var]', root).forEach((b) => { b.onclick = () => variantForm(get('variants', b.dataset.var)); });
      $$('[data-stock]', root).forEach((a) => { a.onclick = (e) => { e.preventDefault(); const [vid, loc] = a.dataset.stock.split('|'); stockForm(get('variants', vid), loc); }; });
      const add = $('#addvar', root);
      if (add) add.onclick = () => openForm({
        title: `Add variant to ${p.title}`,
        fields: [...p.options.map((o, i) => ({ name: `opt${i}`, label: o.name, placeholder: o.values.join(', ') })), { name: 'price', label: 'Price $', type: 'number', step: '0.01', value: dollars(p.variants[0].priceCents) }, { name: 'sku', label: 'SKU' }, { name: 'qty', label: `Stock at ${locLabel(locs[0])}`, type: 'number', value: 0 }],
        onSubmit: (v) => submit('addVariant', { productId: p.id, options: p.options.map((_, i) => v[`opt${i}`]), priceCents: toCents(v.price), sku: v.sku || undefined, inventory: Number(v.qty) ? { [locs[0]]: Number(v.qty) } : undefined }, 'Variant added'),
      });
    },
  };
};

PAGES.inventory = () => {
  const loc = ui.f.invLoc && store().locationIds.includes(ui.f.invLoc) ? ui.f.invLoc : store().locationIds[0];
  const all = Q('inventoryLevels', { storeId: ui.store, locationId: loc, sku: ui.f.invSku || undefined, belowQty: ui.f.invBelow || undefined }).items;
  const stockTab = ui.f.invStock || 'all';
  const rows = all.filter((r) => (stockTab === 'out' ? r.available <= 0 : stockTab === 'low' ? r.available > 0 && r.available < STOCK_LOW : stockTab === 'in' ? r.available >= STOCK_LOW : true));
  const t = table('inventory', rows, [
    { label: 'Product', render: (r) => `<div class="with-thumb">${thumb(r.productId, r.productTitle)}<div><a class="cell-title" href="#/products/${r.productId}">${esc(r.productTitle)}</a> ${r.productStatus !== 'active' ? pill(r.productStatus) : ''}<div class="muted tiny">${esc(r.variantTitle)}</div></div></div>` },
    { label: 'SKU', cls: 'nowrap', render: (r) => `<span class="muted">${esc(r.sku)}</span>` },
    { label: 'Stock', render: (r) => stockPill(r.available) },
    { label: 'Available', num: true, render: (r) => `<strong>${r.available}</strong>` },
    { label: 'Set to', num: true, render: (r) => `<span class="inline-save"><input class="qty" type="number" min="0" value="${r.available}" data-set="${r.variantId}"><button class="btn small" data-save="${r.variantId}">Save</button></span>` },
  ], { noun: 'variant', empty: 'No inventory matches these filters.' });
  const adj = Q('listInventoryAdjustments', { storeId: ui.store, limit: 12 }).items;
  const count = (f) => all.filter(f).length;
  return {
    title: 'Inventory',
    crumbs: [['Products', '#/products']],
    subtitle: `Stock levels at ${esc(locLabel(loc))}`,
    html: `<div class="layout"><div>${tableCard(t, {
      tabsHtml: cardTabs('invStock', [['all', `All (${all.length})`], ['in', 'In stock'], ['low', `Low stock (${count((r) => r.available > 0 && r.available < STOCK_LOW)})`], ['out', `Out of stock (${count((r) => r.available <= 0)})`]], stockTab),
      toolbar: `<label>Location <select data-filter="invLoc">${store().locationIds.map((l) => `<option value="${l}"${l === loc ? ' selected' : ''}>${esc(locLabel(l))}</option>`).join('')}</select></label>
        ${searchInput('invSku', 'SKU')} <label>Below <input data-filter="invBelow" size="4" style="width:72px" value="${esc(ui.f.invBelow || '')}" placeholder="qty"></label>`,
    })}</div><div>
      <div class="card"><h2>Recent adjustments</h2>${adj.length ? `<ul class="timeline">${adj.map((a) => `<li><strong style="color:${a.delta > 0 ? 'var(--ok)' : 'var(--bad)'}">${a.delta > 0 ? '+' : ''}${a.delta}</strong> ${esc(a.sku)} <span class="muted">@ ${esc(locLabel(a.locationId))}</span><div class="muted tiny">${esc(a.reason)} · ${when(a.createdAt)}</div></li>`).join('')}</ul>` : '<p class="muted">No adjustments yet this session.</p>'}</div>
    </div></div>`,
    wire(root) {
      wireFilters(root); t.wire(root);
      $$('[data-save]', root).forEach((b) => { b.onclick = () => act('setInventory', { variantId: b.dataset.save, locationId: loc, quantity: Number($(`[data-set="${b.dataset.save}"]`, root).value), reason: 'correction' }, 'Inventory updated'); });
    },
  };
};

// ---- collections
const ruleRow = (r = {}) => `<div class="rule" style="display:flex;gap:6px;margin-bottom:6px">
  <select class="r-col">${C.SMART_COLUMNS.map((c) => `<option${r.column === c ? ' selected' : ''}>${c}</option>`).join('')}</select>
  <select class="r-rel">${C.SMART_RELATIONS.map((c) => `<option${r.relation === c ? ' selected' : ''}>${c}</option>`).join('')}</select>
  <input class="r-cond" value="${esc(r.condition || '')}" placeholder="condition"></div>`;
const readRules = (m) => $$('.rule', m).map((d) => ({ column: $('.r-col', d).value, relation: $('.r-rel', d).value, condition: $('.r-cond', d).value })).filter((r) => r.condition.trim());

function collectionForm(col) {
  openForm({
    title: col ? `Edit ${col.title}` : `Create collection · ${store().name}`,
    fields: [
      { name: 'title', label: 'Title', value: col?.title || '', full: true },
      ...(col ? [] : [{ name: 'type', label: 'Type', type: 'select', options: [['manual', 'Manual (pick products)'], ['smart', 'Automated (rules)']] }]),
      ...(!col || col.type === 'smart' ? [
        { name: 'disjunctive', label: 'Products must match', type: 'select', options: [['false', 'all conditions'], ['true', 'any condition']], value: String(col?.disjunctive ?? false) },
        { type: 'html', html: `<div class="muted tiny">Conditions (automated only; prices in dollars, e.g. 30.00)</div><div id="rules">${(col?.rules?.length ? col.rules : [{}, {}]).map(ruleRow).join('')}</div><button type="button" class="btn small" id="add-rule">+ condition</button>` },
      ] : []),
    ],
    onMount(m) { const b = $('#add-rule', m); if (b) b.onclick = () => $('#rules', m).insertAdjacentHTML('beforeend', ruleRow()); },
    onSubmit(v, m) {
      if (col) return submit('updateCollection', { collectionId: col.id, title: v.title, ...(col.type === 'smart' ? { rules: readRules(m), disjunctive: v.disjunctive === 'true' } : {}) }, 'Collection saved');
      const r = submit('createCollection', { storeId: ui.store, title: v.title, type: v.type, ...(v.type === 'smart' ? { rules: readRules(m), disjunctive: v.disjunctive === 'true' } : {}) }, 'Collection created');
      if (r.ok) setTimeout(() => { location.hash = `#/collections/${r.result.collection.id}`; });
      return r;
    },
  });
}

PAGES.collections = () => {
  const rows = Q('listCollections', { storeId: ui.store });
  const t = table('collections', rows, [
    { label: 'Title', render: (c) => `<div class="with-thumb">${thumb(c.id, c.title)}<a class="cell-title" href="#/collections/${c.id}">${esc(c.title)}</a></div>` },
    { label: 'Type', render: (c) => `<span class="pill ${c.type === 'smart' ? 'open' : ''}">${c.type === 'smart' ? 'Automated' : 'Manual'}</span>` },
    { label: 'Conditions', render: (c) => (c.type === 'smart' ? c.rules.map((r) => `${esc(r.column)} ${esc(r.relation)} <strong>${esc(r.condition)}</strong>`).join(c.disjunctive ? ' <em>or</em> ' : ' <em>and</em> ') : '<span class="muted">—</span>') },
    { label: 'Products', num: true, render: (c) => c.productsCount },
  ], { href: (c) => `#/collections/${c.id}`, noun: 'collection', empty: 'No collections yet.' });
  return {
    title: 'Collections',
    crumbs: [['Products', '#/products']],
    subtitle: 'Group products manually or automatically with conditions.',
    actions: btnIcon('new-col', 'Create collection'),
    html: tableCard(t),
    wire(root) { t.wire(root); $('#new-col', root).onclick = () => collectionForm(); },
  };
};

PAGES.collection = (id) => {
  const c = Q('getCollection', { collectionId: id });
  const manual = c.type === 'manual';
  const t = table('colprods', c.products, [
    { label: 'Product', render: (p) => `<div class="with-thumb">${thumb(p.id, p.title)}<a class="cell-title" href="#/products/${p.id}">${esc(p.title)}</a></div>` },
    { label: 'Status', render: (p) => pill(p.status) },
    { label: 'Stock', render: (p) => stockPill(p.totalInventory) },
    { label: 'Inventory', num: true, render: (p) => p.totalInventory },
    { label: 'Price', num: true, render: (p) => money(p.minPriceCents) },
    ...(manual ? [{ label: '', num: true, render: (p) => `<button class="btn small danger" data-rm="${p.id}">Remove</button>` }] : []),
  ], { noun: 'product', empty: 'No products in this collection.' });
  const candidates = S().products.filter((p) => p.storeId === c.storeId && !c.products.some((x) => x.id === p.id));
  return {
    title: c.title,
    crumbs: [['Collections', '#/collections']],
    subtitle: `${manual ? 'Manual' : 'Automated'} collection · ${plural(c.productsCount, 'product')}`,
    actions: '<button class="btn" id="edit-col">Edit collection</button>',
    html: `<div class="layout"><div>${tableCard(t, { title: 'Products' })}</div><div>
      <div class="card"><h2>Collection type</h2>${manual ? '<p>Manual — products are added and removed by hand.</p>' : `<p>Automated — products must match <strong>${c.disjunctive ? 'any' : 'all'}</strong> conditions:</p><ul class="timeline">${c.rules.map((r) => `<li>${esc(r.column)} ${esc(r.relation)} <strong>${esc(r.condition)}</strong></li>`).join('')}</ul>`}<dl class="kv"><dt>ID</dt><dd class="muted">${c.id}</dd></dl></div>
      ${manual ? `<div class="card"><h2>Add product</h2><div class="stack"><select id="add-pid" style="width:100%;height:32px;border:1px solid var(--line-strong);border-radius:var(--radius-sm);font:inherit;padding:0 var(--s-2)">${candidates.map((p) => `<option value="${p.id}">${esc(p.title)} (${p.id})</option>`).join('')}</select><button class="btn primary" id="add-p" style="width:100%">${icon('plus')}Add product</button></div></div>` : ''}
    </div></div>`,
    wire(root) {
      t.wire(root);
      $('#edit-col', root).onclick = () => collectionForm(get('collections', c.id));
      if (manual) {
        $('#add-p', root).onclick = () => act('addProductsToCollection', { collectionId: c.id, productIds: [$('#add-pid', root).value] }, 'Product added');
        $$('[data-rm]', root).forEach((b) => { b.onclick = () => act('removeProductsFromCollection', { collectionId: c.id, productIds: [b.dataset.rm] }, 'Product removed'); });
      }
    },
  };
};

// ---- customers
const addressFields = (a = {}) => [
  { name: 'address1', label: 'Address', value: a.address1 || '', full: true },
  { name: 'city', label: 'City', value: a.city || '' },
  { name: 'province', label: 'State / province', value: a.province || '' },
  { name: 'zip', label: 'ZIP / postal code', value: a.zip || '' },
  { name: 'country', label: 'Country', value: a.country || 'US' },
];

PAGES.customers = () => {
  const rows = Q('listCustomers', { storeId: ui.store, q: ui.f.custQ || undefined, tag: ui.f.custTag || undefined, sort: ui.f.custSort || 'newest' }).items;
  const t = table('customers', rows, [
    { label: 'Customer', render: (c) => `<div class="with-thumb">${avatar(c.id, `${c.firstName} ${c.lastName}`)}<div><a class="cell-title" href="#/customers/${c.id}">${esc(`${c.firstName} ${c.lastName}`)}</a><div class="muted tiny">${esc(c.email)}</div></div></div>` },
    { label: 'Location', render: (c) => { const a = c.addresses.find((x) => x.isDefault); return a ? `${esc(a.city)}, ${esc(a.province)}` : '—'; } },
    { label: 'Marketing', render: (c) => (c.acceptsMarketing ? '<span class="pill active">Subscribed</span>' : '<span class="pill">Not subscribed</span>') },
    { label: 'Tags', render: (c) => tagsHtml(c.tags) },
    { label: 'Orders', num: true, render: (c) => c.ordersCount },
    { label: 'Amount spent', num: true, render: (c) => `<strong>${money(c.totalSpentCents)}</strong>` },
  ], { href: (c) => `#/customers/${c.id}`, noun: 'customer', empty: 'No customers match these filters.' });
  return {
    title: 'Customers',
    subtitle: `${plural(rows.length, 'customer')} in ${esc(store().name)}`,
    actions: btnIcon('new-cust', 'Add customer'),
    html: tableCard(t, { toolbar: `${searchInput('custQ', 'Name or email')} ${filterInput('custTag', 'Tag')}
      <select data-filter="custSort">${[['newest', 'Newest'], ['spent', 'Most spent'], ['orders', 'Most orders'], ['name', 'Name']].map(([v, l]) => `<option value="${v}"${(ui.f.custSort || 'newest') === v ? ' selected' : ''}>Sort: ${l}</option>`).join('')}</select>` }),
    wire(root) {
      wireFilters(root); t.wire(root);
      $('#new-cust', root).onclick = () => openForm({
        title: `Add customer · ${store().name}`,
        fields: [{ name: 'firstName', label: 'First name' }, { name: 'lastName', label: 'Last name' }, { name: 'email', label: 'Email' }, { name: 'phone', label: 'Phone' }, { name: 'tags', label: 'Tags (comma separated)' }, { name: 'acceptsMarketing', label: 'Agreed to receive marketing emails', type: 'checkbox' }, ...addressFields()],
        submitLabel: 'Save customer',
        onSubmit(v) {
          const { address1, city, province, zip, country, ...rest } = v;
          const r = submit('createCustomer', { storeId: ui.store, ...rest, address: address1 ? { address1, city, province, zip, country } : undefined }, 'Customer created');
          if (r.ok) setTimeout(() => { location.hash = `#/customers/${r.result.customer.id}`; });
          return r;
        },
      });
    },
  };
};

PAGES.customer = (id) => {
  const c = Q('getCustomer', { customerId: id });
  const t = table('custorders', c.orders, [
    { label: 'Order', render: (o) => `<a class="cell-title" href="#/orders/${o.id}">${esc(o.name)}</a>` },
    { label: 'Date', cls: 'nowrap', render: (o) => when(o.createdAt) },
    { label: 'Payment', render: (o) => pill(o.financialStatus) },
    { label: 'Fulfillment', render: (o) => pill(o.fulfillmentStatus) },
    { label: 'Status', render: (o) => pill(o.status) },
    { label: 'Total', num: true, render: (o) => money(o.totalCents) },
  ], { href: (o) => `#/orders/${o.id}`, pageSize: 10, noun: 'order', empty: 'This customer has no orders yet.' });
  const full = `${c.firstName} ${c.lastName}`.trim() || c.email;
  return {
    title: `${c.firstName} ${c.lastName}`,
    titleHtml: `${esc(full)}${c.acceptsMarketing ? ' <span class="pill active">Subscribed</span>' : ''}`,
    crumbs: [['Customers', '#/customers']],
    subtitle: `${esc(c.email)} · customer since ${esc(C.dateOf(c.createdAt))}`,
    actions: btnIcon('cust-order', 'Create order'),
    html: `<div class="layout"><div>
      <div class="tiles"><div class="tile"><div class="label"><span class="ic">${icon('money')}</span>Amount spent</div><div class="value">${money(c.totalSpentCents)}</div></div><div class="tile"><div class="label"><span class="ic">${icon('cart')}</span>Orders</div><div class="value">${c.ordersCount}</div></div><div class="tile"><div class="label"><span class="ic amber">${icon('avg')}</span>Average order</div><div class="value">${money(c.ordersCount ? Math.round(c.totalSpentCents / c.ordersCount) : 0)}</div></div></div>
      ${tableCard(t, { title: 'Orders' })}
    </div><div>
      <div class="card"><h2>Contact <button class="btn small" id="edit-cust">Edit</button></h2><div class="with-thumb" style="margin-bottom:var(--s-3)">${avatar(c.id, full)}<div><strong>${esc(full)}</strong><div class="muted tiny">${esc(c.email)}</div></div></div><dl class="kv"><dt>Phone</dt><dd>${esc(c.phone) || '—'}</dd><dt>Marketing</dt><dd>${c.acceptsMarketing ? 'Subscribed' : 'Not subscribed'}</dd><dt>Note</dt><dd>${esc(c.note) || '—'}</dd><dt>ID</dt><dd class="muted">${c.id}</dd></dl></div>
      <div class="card"><h2>Tags</h2><div>${c.tags.map((t2) => `<span class="tag">${esc(t2)} <a href="#" data-untag="${esc(t2)}" aria-label="remove">×</a></span>`).join('') || '<span class="muted">No tags</span>'}</div>
        <div class="toolbar" style="margin:var(--s-3) 0 0"><input id="tag-in" placeholder="Add tag" style="flex:1;min-width:0"><button class="btn small" id="tag-add" style="height:32px">Add</button></div></div>
      <div class="card"><h2>Addresses <button class="btn small" id="addr-add">${icon('plus')}Add</button></h2>${c.addresses.map((a) => `<div class="addr" style="padding:var(--s-2) 0;border-top:1px solid var(--line)">${esc(a.address1)}<br>${esc(a.city)}, ${esc(a.province)} ${esc(a.zip)}<br>${esc(a.country)}<div style="margin-top:var(--s-2)" class="actions">${a.isDefault ? '<span class="pill active">Default</span>' : `<button class="btn small" data-def="${a.id}">Make default</button><button class="btn small danger" data-deladdr="${a.id}">Delete</button>`}</div></div>`).join('') || '<p class="muted">No addresses.</p>'}</div>
    </div></div>`,
    wire(root) {
      t.wire(root);
      $('#cust-order', root).onclick = () => newOrderForm(c.id);
      $('#edit-cust', root).onclick = () => openForm({ title: 'Edit customer', fields: [{ name: 'firstName', label: 'First name', value: c.firstName }, { name: 'lastName', label: 'Last name', value: c.lastName }, { name: 'email', label: 'Email', value: c.email }, { name: 'phone', label: 'Phone', value: c.phone }, { name: 'acceptsMarketing', label: 'Agreed to receive marketing emails', type: 'checkbox', value: c.acceptsMarketing }, { name: 'note', label: 'Note', type: 'textarea', value: c.note, full: true }], onSubmit: (v) => submit('updateCustomer', { customerId: c.id, ...v }, 'Customer saved') });
      $('#tag-add', root).onclick = () => act('addTags', { resource: 'customer', id: c.id, tags: $('#tag-in', root).value }, 'Tag added');
      $$('[data-untag]', root).forEach((a) => { a.onclick = (e) => { e.preventDefault(); act('removeTags', { resource: 'customer', id: c.id, tags: [a.dataset.untag] }, 'Tag removed'); }; });
      $('#addr-add', root).onclick = () => openForm({ title: 'Add address', fields: [...addressFields(), { name: 'setDefault', label: 'Make default address', type: 'checkbox' }], onSubmit: (v) => submit('addCustomerAddress', { customerId: c.id, ...v }, 'Address added') });
      $$('[data-def]', root).forEach((b) => { b.onclick = () => act('setDefaultAddress', { customerId: c.id, addressId: b.dataset.def }, 'Default address updated'); });
      $$('[data-deladdr]', root).forEach((b) => { b.onclick = () => act('deleteCustomerAddress', { customerId: c.id, addressId: b.dataset.deladdr }, 'Address deleted'); });
    },
  };
};

// ---- discounts
const discountValue = (d) => (d.type === 'percentage' ? `${d.value}% off` : d.type === 'fixed_amount' ? `${money(d.value)} off` : 'Free shipping');
const discountMin = (d) => (d.minType === 'subtotal' ? `min. ${money(d.minValue)}` : d.minType === 'quantity' ? `min. ${d.minValue} items` : 'no minimum');
PAGES.discounts = () => {
  const tab = ui.f.discTab || 'all';
  const rows = Q('listDiscounts', { storeId: ui.store, status: tab === 'all' ? undefined : tab });
  const t = table('discounts', rows, [
    { label: 'Code', render: (d) => `<div class="with-thumb"><span class="thumb" style="background:var(--accent-soft);color:var(--accent)">${icon('tag')}</span><div><span class="cell-title">${esc(d.code)}</span><div class="muted tiny">${esc(d.title)}</div></div></div>` },
    { label: 'Status', render: (d) => pill(d.status) },
    { label: 'Value', render: (d) => `${discountValue(d)}${d.scope === 'collections' ? ` · ${d.collectionIds.map((x) => esc(get('collections', x)?.title)).join(', ')}` : d.scope === 'products' ? ` · ${d.productIds.length} products` : ''}` },
    { label: 'Requirements', render: (d) => `${discountMin(d)}${d.oncePerCustomer ? ' · once per customer' : ''}` },
    { label: 'Active dates', render: (d) => `${esc(d.startsAt)} → ${esc(d.endsAt || 'no end')}` },
    { label: 'Used', num: true, render: (d) => `${d.usageCount}${d.usageLimit != null ? ` / ${d.usageLimit}` : ''}` },
    { label: '', num: true, render: (d) => `<span class="inline-save"><button class="btn small" data-dedit="${d.id}">Edit</button>${d.enabled ? `<button class="btn small danger" data-doff="${d.id}">Deactivate</button>` : `<button class="btn small" data-don="${d.id}">Activate</button>`}</span>` },
  ], { noun: 'discount', empty: 'No discounts in this view.' });
  return {
    title: 'Discounts',
    subtitle: 'Codes customers enter at checkout for money off or free shipping.',
    actions: btnIcon('new-disc', 'Create discount'),
    html: tableCard(t, { tabsHtml: cardTabs('discTab', [['all', 'All'], ['active', 'Active'], ['scheduled', 'Scheduled'], ['expired', 'Expired'], ['disabled', 'Disabled']], tab) }),
    wire(root) {
      wireFilters(root); t.wire(root);
      $('#new-disc', root).onclick = () => discountForm();
      $$('[data-doff]', root).forEach((b) => { b.onclick = () => act('deactivateDiscount', { discountId: b.dataset.doff }, 'Discount deactivated'); });
      $$('[data-don]', root).forEach((b) => { b.onclick = () => act('activateDiscount', { discountId: b.dataset.don }, 'Discount activated'); });
      $$('[data-dedit]', root).forEach((b) => { b.onclick = () => discountForm(get('discounts', b.dataset.dedit)); });
    },
  };
};

function discountForm(d) {
  const cols = S().collections.filter((c) => c.storeId === ui.store);
  const valOf = (x) => (x.type === 'fixed_amount' ? dollars(x.value) : x.value);
  openForm({
    title: d ? `Edit ${d.code}` : `Create discount · ${store().name}`,
    fields: [
      ...(d ? [] : [{ name: 'code', label: 'Code' }, { name: 'type', label: 'Type', type: 'select', options: [['percentage', 'Percentage'], ['fixed_amount', 'Fixed amount'], ['free_shipping', 'Free shipping']] }]),
      { name: 'title', label: 'Title', value: d?.title || '' },
      { name: 'value', label: 'Value (% or $; ignored for free shipping)', type: 'number', step: '0.01', value: d ? valOf(d) : '' },
      { name: 'scope', label: 'Applies to', type: 'select', options: [['all', 'Entire order'], ['collections', 'Specific collections']], value: d?.scope || 'all' },
      { name: 'collectionIds', label: 'Collections', type: 'select', multiple: true, options: cols.map((c) => [c.id, c.title]), value: d?.collectionIds || [] },
      { name: 'minType', label: 'Minimum requirement', type: 'select', options: [['none', 'None'], ['subtotal', 'Minimum purchase amount ($)'], ['quantity', 'Minimum quantity of items']], value: d?.minType || 'none' },
      { name: 'minValue', label: 'Minimum value', type: 'number', step: '0.01', value: d ? (d.minType === 'subtotal' ? dollars(d.minValue) : d.minValue || '') : '' },
      { name: 'usageLimit', label: 'Total usage limit (blank = unlimited)', type: 'number', value: d?.usageLimit ?? '' },
      { name: 'oncePerCustomer', label: 'Limit to one use per customer', type: 'checkbox', value: d?.oncePerCustomer },
      { name: 'startsAt', label: 'Start date', type: 'date', value: d?.startsAt || S().meta.today },
      { name: 'endsAt', label: 'End date (optional)', type: 'date', value: d?.endsAt || '' },
    ],
    onSubmit(v) {
      const type = d ? d.type : v.type;
      const params = {
        title: v.title || undefined, scope: type === 'free_shipping' ? undefined : v.scope, collectionIds: v.scope === 'collections' ? v.collectionIds : undefined,
        minType: v.minType, minValue: v.minType === 'subtotal' ? toCents(v.minValue) : v.minType === 'quantity' ? Number(v.minValue) : undefined,
        usageLimit: v.usageLimit === '' ? null : Number(v.usageLimit), oncePerCustomer: v.oncePerCustomer, startsAt: v.startsAt, endsAt: v.endsAt || null,
      };
      if (type !== 'free_shipping' && v.value !== '') params.value = type === 'fixed_amount' ? toCents(v.value) : Number(v.value);
      return d ? submit('updateDiscount', { discountId: d.id, ...params }, 'Discount saved') : submit('createDiscount', { storeId: ui.store, code: v.code, type, ...params }, 'Discount created');
    },
  });
}

// ---- analytics
PAGES.analytics = () => {
  const to = ui.f.anTo || S().meta.today;
  const from = ui.f.anFrom || C.addDays(to, -29);
  const interval = ui.f.anInt || 'day';
  const by = ui.f.anBy || 'units';
  const sum = Q('analyticsSummary', { storeId: ui.store, from, to });
  const sales = Q('salesOverTime', { storeId: ui.store, from, to, interval });
  const top = Q('topProducts', { storeId: ui.store, from, to, by, limit: 10 });
  const tile = (l, v) => `<div class="tile"><div class="label">${l}</div><div class="value">${v}</div></div>`;
  return {
    title: 'Analytics',
    subtitle: `${esc(from)} → ${esc(to)} · ${esc(store().name)}`,
    html: `<div class="card" style="padding:var(--s-3) var(--s-4)"><div class="toolbar" style="margin:0"><label>From <input type="date" data-filter="anFrom" value="${from}"></label><label>To <input type="date" data-filter="anTo" value="${to}"></label>
      <select data-filter="anInt">${['day', 'week', 'month'].map((i) => `<option value="${i}"${i === interval ? ' selected' : ''}>By ${i}</option>`).join('')}</select><span class="muted tiny">Press Enter in a date field to apply.</span></div></div>
    <div class="tiles">${tile('Gross sales', money(sum.grossSalesCents))}${tile('Discounts', money(-sum.discountsCents))}${tile('Returns', money(-sum.returnsCents))}${tile('Net sales', money(sum.netSalesCents))}${tile('Total sales', money(sum.totalSalesCents))}${tile('Orders', sum.orders)}${tile('Average order value', money(sum.averageOrderValueCents))}${tile('Returning customers', `${(sum.returningCustomerRate * 100).toFixed(1)}%`)}</div>
    <div class="card"><h2>Net sales by ${interval} <button class="btn small" id="toggle-table">Show table</button></h2><div class="chart-head"><span class="big">${money(sum.netSalesCents)}</span><span class="muted">net sales · ${plural(sum.orders, 'order')}</span></div>${columnChart(sales.rows, { value: (r) => r.netSalesCents, label: (r) => r.period, fmt: shortMoney, title: `Net sales by ${interval}` })}
      <div id="sales-table" hidden>${table('salesrows', sales.rows, [{ label: 'Period', render: (r) => r.period }, { label: 'Orders', num: true, render: (r) => r.orders }, { label: 'Gross', num: true, render: (r) => money(r.grossSalesCents) }, { label: 'Discounts', num: true, render: (r) => money(r.discountsCents) }, { label: 'Returns', num: true, render: (r) => money(r.returnsCents) }, { label: 'Net', num: true, render: (r) => money(r.netSalesCents) }], { pageSize: 200 }).html}</div></div>
    <div class="card flush"><h2>Top products ${tabs('anBy', [['units', 'By units'], ['revenue', 'By net sales']], by)}</h2>${table('top', top.items, [{ label: '#', render: (r) => `<span class="muted">${top.items.indexOf(r) + 1}</span>` }, { label: 'Product', render: (r) => `<div class="with-thumb">${thumb(r.productId, r.title)}<a class="cell-title" href="#/products/${r.productId}">${esc(r.title)}</a></div>` }, { label: 'Net units', num: true, render: (r) => r.unitsSold }, { label: 'Orders', num: true, render: (r) => r.orders }, { label: 'Net sales', num: true, render: (r) => `<strong>${money(r.netSalesCents)}</strong>` }], { noun: 'product', empty: 'No sales in this period.' }).html}</div>`,
    wire(root) {
      wireFilters(root); wireChart(root);
      $('#toggle-table', root).onclick = (e) => { const t = $('#sales-table', root); t.hidden = !t.hidden; e.target.textContent = t.hidden ? 'Show table' : 'Hide table'; };
    },
  };
};

// ---- storefront
function currentCart() {
  const id = ui.carts[ui.store];
  const c = id && get('carts', id);
  return c && c.status === 'open' ? c : null;
}
PAGES.storefront = () => {
  const col = ui.f.sfCol || '';
  const items = Q('storefrontProducts', { storeId: ui.store, collectionId: col || undefined, q: ui.f.sfQ || undefined, limit: 48 }).items;
  const cart = currentCart();
  const view = cart ? Q('getCart', { cartId: cart.id }) : null;
  const pr = view?.pricing;
  const cols = S().collections.filter((c) => c.storeId === ui.store);
  return {
    title: `Storefront · ${store().name}`,
    titleHtml: 'Storefront',
    subtitle: `Shop ${esc(store().name)} as a customer would. Checkout creates a real order in the admin.`,
    html: `<div class="storefront-banner"><h2>${esc(store().name)}</h2><div class="tiny">${esc(store().domain)} — simulated shopper view</div></div>
    <div class="layout"><div>
      <div class="card" style="padding:var(--s-3) var(--s-4)"><div class="toolbar" style="margin:0"><select data-filter="sfCol"><option value="">All products</option>${cols.map((c) => `<option value="${c.id}"${c.id === col ? ' selected' : ''}>${esc(c.title)}</option>`).join('')}</select>${filterInput('sfQ', 'Search')}</div></div>
      <div class="store-grid">${items.map((p) => `<div class="product-card"><div class="swatch" style="background:${swatchColor(p.id)}">${esc(p.title.split(' ').map((w) => w[0]).join('').slice(0, 3))}</div>
        <strong>${esc(p.title)}</strong><div class="price">${money(p.minPriceCents)}${p.variants[0].compareAtCents ? `<span class="strike">${money(p.variants[0].compareAtCents)}</span>` : ''}</div>
        <select data-vsel="${p.id}">${p.variants.map((v) => `<option value="${v.id}"${v.available ? '' : ' disabled'}>${esc(v.title)} — ${money(v.priceCents)}${v.available ? '' : ' (sold out)'}</option>`).join('')}</select>
        <button class="btn primary small" data-add="${p.id}"${p.variants.some((v) => v.available) ? '' : ' disabled'}>Add to cart</button></div>`).join('') || '<p class="muted">No products.</p>'}</div>
    </div><div>
      <div class="card"><h2>Cart ${cart ? `<span class="muted tiny">${cart.id}</span>` : ''}</h2>
      ${cart && cart.lines.length ? `<div class="table-wrap"><table><tbody>${pr.lines.map((l) => `<tr><td>${esc(l.title)}<div class="muted tiny">${esc(l.variantTitle)}</div></td><td><input class="qty" type="number" min="0" value="${l.quantity}" data-cq="${l.variantId}"></td><td class="num">${money(l.priceCents * l.quantity)}</td></tr>`).join('')}</tbody></table></div>
        <div class="toolbar" style="margin-top:8px"><input id="code-in" placeholder="Discount code" value="${esc(cart.discountCode || '')}"><button class="btn small" id="code-apply">Apply</button></div>
        ${view.discountError ? `<div class="tiny" style="color:var(--bad)">${esc(view.discountError)}</div>` : ''}
        <dl class="sum"><dt>Subtotal</dt><dd>${money(pr.subtotalCents)}</dd><dt>Discount ${pr.discountCode ? `<span class="tag">${esc(pr.discountCode)}</span>` : ''}</dt><dd>${pr.discountCode ? `−${money(pr.discountCents + pr.shippingDiscountCents)}` : '—'}</dd><dt>Shipping <span class="muted tiny">standard</span></dt><dd>${money(pr.shippingCents - pr.shippingDiscountCents)}</dd><dt>Tax</dt><dd>${money(pr.taxCents)}</dd><dt class="total">Total</dt><dd class="total">${money(pr.totalCents)}</dd></dl>
        <button class="btn primary" id="checkout" style="margin-top:10px;width:100%">Checkout</button>` : '<p class="muted">Your cart is empty. Add a product to start a checkout.</p>'}</div>
    </div></div>`,
    wire(root) {
      wireFilters(root);
      const ensureCart = () => {
        let c = currentCart();
        if (!c) { const r = cw.dispatch('createCart', { storeId: ui.store }); if (!r.ok) { toast(r.error.message, true); return null; } c = r.result.cart; ui.carts[ui.store] = c.id; saveCarts(); }
        return c;
      };
      $$('[data-add]', root).forEach((b) => { b.onclick = () => { const c = ensureCart(); if (c) act('addToCart', { cartId: c.id, variantId: $(`[data-vsel="${b.dataset.add}"]`, root).value, quantity: 1 }, 'Added to cart'); }; });
      $$('[data-cq]', root).forEach((i) => { i.onchange = () => act('updateCartLine', { cartId: cart.id, variantId: i.dataset.cq, quantity: Number(i.value) }); });
      const ap = $('#code-apply', root);
      if (ap) ap.onclick = () => act('applyDiscountCode', { cartId: cart.id, code: $('#code-in', root).value }, 'Discount applied');
      const co = $('#checkout', root);
      if (co) co.onclick = () => openForm({
        title: 'Checkout',
        fields: [{ name: 'email', label: 'Email (existing customers use their saved address)', full: true }, { name: 'firstName', label: 'First name' }, { name: 'lastName', label: 'Last name' }, ...addressFields().map((f) => ({ ...f, label: `${f.label} (blank = saved address)` })), { name: 'shippingMethod', label: 'Delivery', type: 'select', options: C.SHIPPING_METHODS.map((m) => [m, `${C.SHIPPING_LABELS[m]} (${money(m === 'pickup' ? 0 : store().shipping[m])})`]) }],
        submitLabel: 'Pay now',
        onSubmit(v) {
          const { address1, city, province, zip, country, ...rest } = v;
          const r = submit('checkout', { cartId: cart.id, ...rest, shippingAddress: address1 ? { address1, city, province, zip, country } : undefined }, 'Order placed!');
          if (r.ok) setTimeout(() => { location.hash = `#/orders/${r.result.order.id}`; });
          return r;
        },
      });
    },
  };
};

// ---- tasks & API
PAGES.tasks = () => {
  const html = `<div class="card" id="active-task"></div><div class="card flush"><h2>All tasks</h2><div id="task-list" class="card-section muted">Loading…</div></div>`;
  return {
    title: 'Agent tasks',
    subtitle: 'Seeded scenarios with automatic checkers. Starting a task resets the world to its seed.',
    html,
    async wire(root) {
      const list = await cw.listTasks();
      const active = list.find((t) => t.id === cw.activeTaskId);
      $('#active-task', root).innerHTML = active ? `<h2>Active: ${esc(active.id)} <button class="btn small primary" id="check-task">Check</button></h2><p>${esc(active.prompt)}</p><div id="check-out"></div>` : '<p class="muted">No active task. Starting a task resets the world to the task\'s seed.</p>';
      $('#task-list', root).className = '';
      $('#task-list', root).innerHTML = `<div class="table-wrap"><table><thead><tr><th>ID</th><th>Title</th><th class="num">Seed</th><th></th></tr></thead><tbody>${list.map((t) => `<tr><td>${esc(t.id)}</td><td>${esc(t.title)}<div class="muted tiny">${esc(t.prompt)}</div></td><td class="num">${t.seed}</td><td class="num"><button class="btn small${t.id === cw.activeTaskId ? ' primary' : ''}" data-start="${esc(t.id)}">${t.id === cw.activeTaskId ? 'Restart' : 'Start'}</button></td></tr>`).join('')}</tbody></table></div>`;
      $$('[data-start]', root).forEach((b) => { b.onclick = async () => { await cw.startTask(b.dataset.start); toast(`Started ${b.dataset.start}`); render(); }; });
      const cb = $('#check-task', root);
      if (cb) cb.onclick = async () => { const r = await cw.checkTask(); $('#check-out', root).innerHTML = r.pass ? '<div class="check pass"><span class="pill paid">PASS</span> The checker accepted the current state.</div>' : `<div class="check fail"><span class="pill refunded">FAIL</span><ul>${(r.reasons || [r.error?.message]).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`; };
    },
  };
};

PAGES.api = () => ({
  title: 'API',
  subtitle: 'Drive the simulator programmatically from the browser console or over HTTP.',
  html: `<div class="card"><h2>Browser API — <code>window.cartwright</code></h2><p>Open the developer console: every admin action is available as <code>cartwright.&lt;action&gt;(params)</code> or <code>cartwright.dispatch(name, params)</code>; reads via <code>cartwright.query(name, params)</code>. State persists in localStorage as the seed plus the action log.</p><pre class="code">${esc(cw.help())}</pre></div>
  <div class="card"><h2>REST server</h2><p>Run <code>npm start</code> for an Express server exposing the same actions (<code>POST /api/actions/:name</code>), queries (<code>POST /api/queries/:name</code>), resource-style routes (<code>/api/orders/:id/fulfillments</code>, …), <code>POST /reset</code> and task endpoints. See README.md.</p></div>`,
  wire() {},
});

// ---- router & chrome ---------------------------------------------------------------------
const DETAIL = { orders: 'order', products: 'product', collections: 'collection', customers: 'customer' };
function route() {
  const [, name = 'home', id] = (location.hash || '#/home').split('/');
  if (id && DETAIL[name]) return { nav: name, page: DETAIL[name], id: decodeURIComponent(id) };
  return { nav: PAGES[name] ? name : 'home', page: PAGES[name] ? name : 'home' };
}

function render() {
  const r = route();
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === r.nav));
  const sel = $('#store-select');
  sel.innerHTML = S().stores.map((s) => `<option value="${s.id}"${s.id === ui.store ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
  $('#store-avatar').textContent = initials(store().name);
  $('#top-store').textContent = store().domain || store().name;
  $('#clock').textContent = `${S().meta.today} ${S().meta.time}`;
  $('#seed-input').value = cw.seed;
  $('#session-info').textContent = `${S().actionLog.length} actions this session${cw.activeTaskId ? ` · task ${cw.activeTaskId}` : ''}`;
  let page;
  try {
    page = PAGES[r.page](r.id);
  } catch (e) {
    page = { title: 'Not found', subtitle: 'The page or record you asked for does not exist in this store.', html: `<div class="card"><p>${esc(e.message)}</p><a class="btn" href="#/home">Back to home</a></div>`, wire() {} };
  }
  if (r.page === 'product' || r.page === 'collection' || r.page === 'customer' || r.page === 'order') {
    const ent = get({ product: 'products', collection: 'collections', customer: 'customers', order: 'orders' }[r.page], r.id);
    if (ent && ent.storeId !== ui.store) { ui.store = ent.storeId; localStorage.setItem('cartwright:ui:store', ui.store); sel.value = ui.store; }
  }
  $('#crumbs').innerHTML = (page.crumbs || []).map(([label, href]) => `<a href="${href}">${icon('back')}${esc(label)}</a>`).join('<span class="sep">/</span>');
  $('#page-title').innerHTML = page.titleHtml || esc(page.title);
  $('#page-subtitle').innerHTML = page.subtitle || '';
  $('#page-actions').innerHTML = page.actions || '';
  document.title = `${page.title} · Cartwright`;
  $('#view').innerHTML = page.html;
  // Header actions live outside #view, so pages wire against the whole page container.
  page.wire($('#page'));
}

// ---- global search ---------------------------------------------------------------------------
const gs = { hits: [], sel: 0 };
function searchHits(q) {
  const sid = ui.store;
  const groups = [
    ['Orders', Q('listOrders', { storeId: sid, q, status: 'any', limit: 5 }).items.map((o) => ({ href: `#/orders/${o.id}`, label: o.name, meta: `${custName(o.customerId)} · ${money(o.totalCents)}` }))],
    ['Products', Q('listProducts', { storeId: sid, q, limit: 5 }).items.map((p) => ({ href: `#/products/${p.id}`, label: p.title, meta: `${p.totalInventory} in stock` }))],
    ['Customers', Q('listCustomers', { storeId: sid, q, limit: 5 }).items.map((c) => ({ href: `#/customers/${c.id}`, label: `${c.firstName} ${c.lastName}`.trim() || c.email, meta: c.email }))],
  ];
  return groups.filter(([, items]) => items.length);
}
function renderSearch() {
  const input = $('#global-search');
  const pop = $('#search-pop');
  const q = input.value.trim();
  if (!q) { pop.hidden = true; gs.hits = []; return; }
  const groups = searchHits(q);
  gs.hits = groups.flatMap(([, items]) => items);
  gs.sel = Math.min(gs.sel, Math.max(0, gs.hits.length - 1));
  let i = 0;
  pop.innerHTML = groups.length ? groups.map(([name, items]) => `<h4>${name}</h4>${items.map((h) => { const n = i++; return `<a href="${h.href}" data-i="${n}"${n === gs.sel ? ' class="sel"' : ''}><span>${esc(h.label)}</span><small>${esc(h.meta)}</small></a>`; }).join('')}`).join('') : `<div class="empty">No results for “${esc(q)}”.</div>`;
  pop.hidden = false;
}
function closeSearch() { $('#search-pop').hidden = true; }
$('#global-search').addEventListener('input', () => { gs.sel = 0; renderSearch(); });
$('#global-search').addEventListener('focus', renderSearch);
$('#global-search').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); gs.sel = (gs.sel + (e.key === 'ArrowDown' ? 1 : -1) + gs.hits.length) % Math.max(1, gs.hits.length); renderSearch(); }
  if (e.key === 'Enter' && gs.hits[gs.sel]) { location.hash = gs.hits[gs.sel].href; e.target.value = ''; e.target.blur(); closeSearch(); }
  if (e.key === 'Escape') { e.target.blur(); closeSearch(); }
});
$('#search-pop').addEventListener('mousedown', (e) => { if (e.target.closest('a')) { $('#global-search').value = ''; } });
document.addEventListener('mousedown', (e) => { if (!e.target.closest('.global-search')) closeSearch(); });
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !e.target.closest('input,textarea,select') && !$('#modal-root').children.length) { e.preventDefault(); $('#global-search').focus(); }
});

// ---- responsive sidebar
const setNav = (open) => document.body.classList.toggle('nav-open', open);
$('#menu-btn').onclick = () => setNav(!document.body.classList.contains('nav-open'));
$('#scrim').onclick = () => setNav(false);

$('#store-select').onchange = (e) => {
  ui.store = e.target.value;
  localStorage.setItem('cartwright:ui:store', ui.store);
  ui.pages = {};
  const r = route();
  if (r.id) location.hash = `#/${r.nav}`; else render();
};
$('#reset-btn').onclick = () => {
  const seed = $('#seed-input').value.trim() || cw.seed;
  if (!confirm(`Reset the simulated world to seed ${seed}? All changes in this session are discarded.`)) return;
  cw.reset(seed);
  ui.carts = {}; saveCarts();
  toast(`Reset to seed ${seed}`);
  render();
};
window.addEventListener('hashchange', () => { closeModal(); closeSearch(); setNav(false); render(); window.scrollTo(0, 0); });
cw.subscribe((evt) => { if (evt.kind !== 'action') render(); });
render();
