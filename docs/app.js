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
function table(key, rows, columns, { pageSize = 50, href } = {}) {
  const pageNo = Math.min(ui.pages[key] || 0, Math.max(0, Math.ceil(rows.length / pageSize) - 1));
  const slice = rows.slice(pageNo * pageSize, pageNo * pageSize + pageSize);
  const html = `<div class="table-wrap"><table><thead><tr>${columns.map((c) => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${slice.map((r) => `<tr${href ? ` data-href="${esc(href(r))}" style="cursor:pointer"` : ''}>${columns.map((c) => `<td class="${c.num ? 'num' : ''}">${c.render(r)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${columns.length}" class="muted">Nothing here.</td></tr>`}</tbody></table></div>
    ${rows.length > pageSize ? `<div class="pager" data-pager="${key}">${rows.length} rows · page ${pageNo + 1} / ${Math.ceil(rows.length / pageSize)}
      <button class="btn small" data-page="-1"${pageNo === 0 ? ' disabled' : ''}>‹ Prev</button>
      <button class="btn small" data-page="1"${(pageNo + 1) * pageSize >= rows.length ? ' disabled' : ''}>Next ›</button></div>` : `<div class="pager">${rows.length} rows</div>`}`;
  return { html, wire(root) {
    $$(`[data-pager="${key}"] [data-page]`, root).forEach((b) => { b.onclick = () => { ui.pages[key] = pageNo + Number(b.dataset.page); render(); }; });
    if (href) $$('[data-href]', root).forEach((tr) => { tr.onclick = (e) => { if (!e.target.closest('a,button,input,select')) location.hash = tr.dataset.href; }; });
  } };
}
const tabs = (key, options, current) => `<div class="tabs" data-tabs="${key}">${options.map(([v, l]) => `<button data-v="${esc(v)}" class="${v === current ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
function wireFilters(root) {
  $$('[data-tabs]', root).forEach((t) => $$('button', t).forEach((b) => { b.onclick = () => { ui.f[t.dataset.tabs] = b.dataset.v; ui.pages = {}; render(); }; }));
  $$('[data-filter]', root).forEach((el) => {
    const ev = el.tagName === 'SELECT' ? 'change' : 'keydown';
    el.addEventListener(ev, (e) => { if (ev === 'keydown' && e.key !== 'Enter') return; ui.f[el.dataset.filter] = el.value; ui.pages = {}; render(); });
  });
}
const filterInput = (key, placeholder) => `<input data-filter="${key}" placeholder="${esc(placeholder)} (Enter)" value="${esc(ui.f[key] || '')}">`;

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
  return {
    title: `Home · ${store().name}`,
    html: `<div class="tiles">
      <a class="tile" href="#/orders" data-go="ship"><div class="label">Orders to fulfill</div><div class="value">${toShip}</div><div class="sub">paid &amp; unfulfilled</div></a>
      <a class="tile" href="#/orders" data-go="capture"><div class="label">Payments to capture</div><div class="value">${toCapture}</div><div class="sub">authorized</div></a>
      <a class="tile" href="#/orders" data-go="unpaid"><div class="label">Awaiting payment</div><div class="value">${unpaid}</div><div class="sub">pending</div></a>
      <a class="tile" href="#/returns"><div class="label">Return requests</div><div class="value">${returns}</div><div class="sub">to review</div></a>
    </div>
    <div class="tiles">
      <div class="tile"><div class="label">Total sales · 30 days</div><div class="value">${money(sum.totalSalesCents)}</div></div>
      <div class="tile"><div class="label">Orders · 30 days</div><div class="value">${sum.orders}</div></div>
      <div class="tile"><div class="label">Average order value</div><div class="value">${money(sum.averageOrderValueCents)}</div></div>
      <div class="tile"><div class="label">Returning customer rate</div><div class="value">${(sum.returningCustomerRate * 100).toFixed(1)}%</div></div>
    </div>
    <div class="card"><h2>Net sales by day · last 30 days</h2>${columnChart(sales.rows, { value: (r) => r.netSalesCents, label: (r) => r.period, fmt: shortMoney, title: 'Net sales by day' })}</div>`,
    wire(root) {
      wireChart(root);
      $$('[data-go]', root).forEach((a) => { a.onclick = () => { ui.f.orderTab = a.dataset.go; }; });
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
    { label: 'Order', render: (o) => `<a href="#/orders/${o.id}"><strong>${esc(o.name)}</strong></a>` },
    { label: 'Date', render: (o) => when(o.createdAt) },
    { label: 'Customer', render: (o) => esc(custName(o.customerId)) },
    { label: 'Total', num: true, render: (o) => money(o.totalCents) },
    { label: 'Payment', render: (o) => pill(o.financialStatus) },
    { label: 'Fulfillment', render: (o) => pill(o.fulfillmentStatus) },
    { label: 'Status', render: (o) => pill(o.status) },
    { label: 'Items', num: true, render: (o) => o.lineItems.reduce((a, l) => a + l.quantity, 0) },
    { label: 'Tags', render: (o) => tagsHtml(o.tags) },
  ], { href: (o) => `#/orders/${o.id}` });
  return {
    title: 'Orders',
    html: `<div class="toolbar">${tabs('orderTab', ORDER_TABS, tab)} ${filterInput('orderQ', 'Order # or email')} ${filterInput('orderTag', 'Tag')}
      <span style="flex:1"></span><button class="btn primary" id="new-order">Create order</button></div><div class="card">${t.html}</div>`,
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
  const html = `<div class="card"><div class="actions">${btns.join('')}</div></div>
  <div class="grid2"><div>
    <div class="card"><h2>Items <span>${pill(o.fulfillmentStatus)}</span></h2><div class="table-wrap"><table><thead><tr><th>Product</th><th>SKU</th><th class="num">Price</th><th class="num">Qty</th><th class="num">Discount</th><th class="num">Fulfilled</th><th class="num">Refunded</th><th class="num">To ship</th></tr></thead><tbody>
      ${o.lineItems.map((l) => `<tr><td><a href="#/products/${l.productId}">${esc(l.title)}</a><div class="muted tiny">${esc(l.variantTitle)}</div></td><td>${esc(l.sku)}</td><td class="num">${money(l.priceCents)}</td><td class="num">${l.quantity}</td><td class="num">${l.discountCents ? `−${money(l.discountCents)}` : ''}</td><td class="num">${l.fulfilledQty}</td><td class="num">${l.refundedQty || ''}</td><td class="num">${l.fulfillableQty}</td></tr>`).join('')}
    </tbody></table></div></div>
    <div class="card"><h2>Payment <span>${pill(o.financialStatus)}</span></h2><dl class="kv">
      <dt>Subtotal</dt><dd>${money(o.subtotalCents)}</dd>
      <dt>Discount</dt><dd>${o.discountCode ? `${esc(o.discountCode)} · −${money(o.discountCents + o.shippingDiscountCents)}` : '—'}</dd>
      <dt>Shipping</dt><dd>${esc(C.SHIPPING_LABELS[o.shippingMethod])} · ${money(o.shippingCents - o.shippingDiscountCents)}</dd>
      <dt>Tax</dt><dd>${money(o.taxCents)}</dd>
      <dt><strong>Total</strong></dt><dd><strong>${money(o.totalCents)}</strong></dd>
      <dt>Paid</dt><dd>${money(o.money.paidCents)}</dd>
      <dt>Refunded</dt><dd>${money(o.money.refundedCents)}</dd>
      <dt>Net payment</dt><dd>${money(o.money.netPaidCents)}</dd>
    </dl></div>
    <div class="card"><h2>Fulfillments</h2>${o.fulfillments.length ? `<table><thead><tr><th>ID</th><th>Date</th><th>Items</th><th>Tracking</th><th>Status</th><th></th></tr></thead><tbody>${o.fulfillments.map((f) => `<tr><td>${f.id}</td><td>${when(f.createdAt)}</td><td>${f.lineItems.map((x) => `${x.quantity} × ${esc(o.lineItems.find((l) => l.id === x.lineItemId).sku)}`).join('<br>')}</td><td>${f.trackingNumber ? `${esc(f.trackingCompany)} ${f.trackingUrl ? `<a href="${esc(f.trackingUrl)}" target="_blank" rel="noopener">${esc(f.trackingNumber)}</a>` : esc(f.trackingNumber)}` : '<span class="muted">none</span>'}</td><td>${pill(f.status)}</td><td>${f.status === 'success' ? `<button class="btn small" data-track="${f.id}">Edit tracking</button> <button class="btn small danger" data-fcancel="${f.id}">Cancel</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No fulfillments yet.</p>'}</div>
    <div class="card"><h2>Returns</h2>${o.returns.length ? `<table><thead><tr><th>ID</th><th>Created</th><th>Items</th><th>Status</th><th></th></tr></thead><tbody>${o.returns.map((r) => `<tr><td>${r.id}</td><td>${when(r.createdAt)}</td><td>${r.lineItems.map((x) => `${x.quantity} × ${esc(o.lineItems.find((l) => l.id === x.lineItemId).sku)} <span class="muted tiny">(${esc(x.reason.replace(/_/g, ' '))})</span>`).join('<br>')}</td><td>${pill(r.status)}</td><td>${r.status === 'requested' ? `<button class="btn small primary" data-rapprove="${r.id}">Approve</button> <button class="btn small danger" data-rdecline="${r.id}">Decline</button>` : r.status === 'open' ? `<button class="btn small primary" data-rrefund="${r.id}">Refund…</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No returns.</p>'}</div>
    <div class="card"><h2>Refunds</h2>${o.refunds.length ? `<table><thead><tr><th>ID</th><th>Date</th><th>Items</th><th class="num">Shipping</th><th class="num">Amount</th><th>Reason</th></tr></thead><tbody>${o.refunds.map((r) => `<tr><td>${r.id}</td><td>${when(r.createdAt)}</td><td>${r.lineItems.map((x) => `${x.quantity} × ${esc(o.lineItems.find((l) => l.id === x.lineItemId).sku)}${x.restock ? ` <span class="muted tiny">restocked @ ${esc(locLabel(x.locationId))}</span>` : ''}`).join('<br>') || '—'}</td><td class="num">${money(r.shippingCents)}</td><td class="num">${money(r.amountCents)}</td><td>${esc(r.reason.replace(/_/g, ' '))}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No refunds.</p>'}</div>
  </div><div>
    <div class="card"><h2>Order</h2><dl class="kv">
      <dt>Status</dt><dd>${pill(o.status)}${o.cancelReason ? ` <span class="muted tiny">${esc(o.cancelReason)}</span>` : ''}</dd>
      <dt>Placed</dt><dd>${when(o.createdAt)}</dd>
      <dt>Channel</dt><dd>${esc(o.source.replace('_', ' '))}</dd>
      <dt>Location</dt><dd>${esc(locLabel(o.locationId))}</dd>
      <dt>Tags</dt><dd>${tagsHtml(o.tags)}</dd>
      <dt>Note</dt><dd>${o.note ? esc(o.note) : '<span class="muted">—</span>'}</dd>
      <dt>ID</dt><dd class="muted">${o.id}</dd>
    </dl></div>
    <div class="card"><h2>Customer</h2><p>${custLink(o.customerId)}<br><span class="muted">${esc(o.email)}</span></p>
      <h2>Shipping address</h2><p>${addr ? `${esc(addr.name)}<br>${esc(addr.address1)}<br>${esc(addr.city)}, ${esc(addr.province)} ${esc(addr.zip)}<br>${esc(addr.country)}` : '<span class="muted">Local pickup</span>'}</p></div>
    <div class="card"><h2>Timeline</h2>${o.transactions.map((t) => `<div class="tiny"><strong>${esc(t.kind)}</strong> ${t.amountCents ? money(t.amountCents) : ''} · ${esc(t.gateway)} <span class="muted">${when(t.createdAt)}</span></div>`).join('') || '<p class="muted">No transactions.</p>'}</div>
  </div></div>`;
  return {
    title: `Order ${o.name}`,
    titleHtml: `<a href="#/orders">Orders</a> › ${esc(o.name)} ${pill(o.financialStatus)} ${pill(o.fulfillmentStatus)}`,
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
    { label: 'Return', render: (r) => r.id },
    { label: 'Order', render: (r) => orderLink(r.orderId) },
    { label: 'Customer', render: (r) => custLink(r.customerId) },
    { label: 'Created', render: (r) => when(r.createdAt) },
    { label: 'Items', render: (r) => r.lineItems.map((x) => `${x.quantity} × ${esc(get('orders', r.orderId).lineItems.find((l) => l.id === x.lineItemId).sku)} <span class="muted tiny">${esc(x.reason.replace(/_/g, ' '))}</span>`).join('<br>') },
    { label: 'Status', render: (r) => pill(r.status) },
  ], { href: (r) => `#/orders/${r.orderId}` });
  return { title: 'Returns', html: `<div class="toolbar">${tabs('returnTab', [['requested', 'Requested'], ['open', 'Open'], ['closed', 'Closed'], ['declined', 'Declined'], ['all', 'All']], tab)}</div><div class="card">${t.html}</div>`, wire(root) { wireFilters(root); t.wire(root); } };
};

// ---- products
PAGES.products = () => {
  const tab = ui.f.prodTab || 'all';
  const rows = Q('listProducts', { storeId: ui.store, status: tab === 'all' ? undefined : tab, q: ui.f.prodQ || undefined, vendor: ui.f.prodVendor || undefined, sku: ui.f.prodSku || undefined }).items;
  const vendors = [...new Set(S().products.filter((p) => p.storeId === ui.store).map((p) => p.vendor))].sort();
  const t = table('products', rows, [
    { label: 'Product', render: (p) => `<a href="#/products/${p.id}"><strong>${esc(p.title)}</strong></a>` },
    { label: 'Status', render: (p) => pill(p.status) },
    { label: 'Inventory', num: true, render: (p) => `${p.totalInventory} in stock<div class="muted tiny">${p.variantsCount} variant${p.variantsCount > 1 ? 's' : ''}</div>` },
    { label: 'Price', num: true, render: (p) => (p.minPriceCents === p.maxPriceCents ? money(p.minPriceCents) : `${money(p.minPriceCents)}–${money(p.maxPriceCents)}`) },
    { label: 'Type', render: (p) => esc(p.productType) },
    { label: 'Vendor', render: (p) => esc(p.vendor) },
    { label: 'Tags', render: (p) => tagsHtml(p.tags) },
  ], { href: (p) => `#/products/${p.id}` });
  return {
    title: 'Products',
    html: `<div class="toolbar">${tabs('prodTab', [['all', 'All'], ['active', 'Active'], ['draft', 'Draft'], ['archived', 'Archived']], tab)} ${filterInput('prodQ', 'Search title')} ${filterInput('prodSku', 'SKU')}
      <select data-filter="prodVendor"><option value="">All vendors</option>${vendors.map((v) => `<option${ui.f.prodVendor === v ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>
      <span style="flex:1"></span><button class="btn primary" id="new-product">Add product</button></div><div class="card">${t.html}</div>`,
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
  const html = `<div class="grid2"><div>
    <div class="card"><h2>Details</h2><form class="form" id="pform" onsubmit="return false">
      ${fieldHtml({ name: 'title', label: 'Title', value: p.title, full: true })}
      ${fieldHtml({ name: 'description', label: 'Description', type: 'textarea', value: p.description, full: true })}
      ${fieldHtml({ name: 'vendor', label: 'Vendor', value: p.vendor })}
      ${fieldHtml({ name: 'productType', label: 'Product type', value: p.productType })}
      ${fieldHtml({ name: 'status', label: 'Status', type: 'select', options: C.PRODUCT_STATUSES, value: p.status })}
      ${fieldHtml({ name: 'tags', label: 'Tags (comma separated)', value: p.tags.join(', ') })}
      <div class="full"><button class="btn primary" id="psave">Save product</button></div></form></div>
    <div class="card"><h2>Variants ${p.options.length ? '<button class="btn small" id="addvar">Add variant</button>' : ''}</h2>
      <p class="muted tiny">${p.options.map((o) => `${esc(o.name)}: ${o.values.map(esc).join(', ')}`).join(' · ') || 'No options (single default variant)'}</p>
      <div class="table-wrap"><table><thead><tr><th>Variant</th><th>SKU</th><th class="num">Price</th><th class="num">Compare-at</th>${locs.map((l) => `<th class="num">${esc(locLabel(l))}</th>`).join('')}<th></th></tr></thead><tbody>
      ${p.variants.map((v) => `<tr><td>${esc(v.title)}${v.inventoryPolicy === 'continue' ? ' <span class="muted tiny">(sells when out)</span>' : ''}</td><td>${esc(v.sku)}</td><td class="num">${money(v.priceCents)}</td><td class="num">${v.compareAtCents != null ? money(v.compareAtCents) : '—'}</td>
        ${locs.map((l) => `<td class="num"><a href="#" data-stock="${v.id}|${l}">${v.inventory[l] ?? 0}</a></td>`).join('')}<td><button class="btn small" data-var="${v.id}">Edit</button></td></tr>`).join('')}
      </tbody></table></div><p class="muted tiny">Click a stock number to adjust inventory at that location.</p></div>
  </div><div>
    <div class="card"><h2>Summary</h2><dl class="kv"><dt>Status</dt><dd>${pill(p.status)}</dd><dt>Total stock</dt><dd>${p.totalInventory}</dd><dt>Handle</dt><dd>${esc(p.handle)}</dd><dt>ID</dt><dd class="muted">${p.id}</dd><dt>Created</dt><dd>${when(p.createdAt)}</dd></dl></div>
    <div class="card"><h2>Collections</h2>${p.collections.map((c) => `<div><a href="#/collections/${c.id}">${esc(c.title)}</a> <span class="muted tiny">${c.type}</span></div>`).join('') || '<p class="muted">Not in any collection.</p>'}</div>
  </div></div>`;
  return {
    title: p.title,
    titleHtml: `<a href="#/products">Products</a> › ${esc(p.title)} ${pill(p.status)}`,
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
  const rows = Q('inventoryLevels', { storeId: ui.store, locationId: loc, sku: ui.f.invSku || undefined, belowQty: ui.f.invBelow || undefined }).items;
  const t = table('inventory', rows, [
    { label: 'Product', render: (r) => `<a href="#/products/${r.productId}">${esc(r.productTitle)}</a> ${r.productStatus !== 'active' ? pill(r.productStatus) : ''}<div class="muted tiny">${esc(r.variantTitle)}</div>` },
    { label: 'SKU', render: (r) => esc(r.sku) },
    { label: 'Available', num: true, render: (r) => `<strong>${r.available}</strong>` },
    { label: 'Set to', num: true, render: (r) => `<input class="qty" type="number" min="0" value="${r.available}" data-set="${r.variantId}"> <button class="btn small" data-save="${r.variantId}">Save</button>` },
  ]);
  const adj = Q('listInventoryAdjustments', { storeId: ui.store, limit: 12 }).items;
  return {
    title: 'Inventory',
    html: `<div class="toolbar"><label>Location <select data-filter="invLoc">${store().locationIds.map((l) => `<option value="${l}"${l === loc ? ' selected' : ''}>${esc(locLabel(l))}</option>`).join('')}</select></label>
      ${filterInput('invSku', 'SKU')} <label>Below <input data-filter="invBelow" size="4" value="${esc(ui.f.invBelow || '')}" placeholder="qty"></label></div>
      <div class="grid2"><div class="card">${t.html}</div><div class="card"><h2>Recent adjustments</h2>${adj.map((a) => `<div class="tiny">${a.delta > 0 ? '+' : ''}${a.delta} ${esc(a.sku)} @ ${esc(locLabel(a.locationId))} <span class="muted">${esc(a.reason)} · ${when(a.createdAt)}</span></div>`).join('') || '<p class="muted">No adjustments yet this session.</p>'}</div></div>`,
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
    { label: 'Title', render: (c) => `<a href="#/collections/${c.id}"><strong>${esc(c.title)}</strong></a>` },
    { label: 'Type', render: (c) => (c.type === 'smart' ? 'Automated' : 'Manual') },
    { label: 'Conditions', render: (c) => (c.type === 'smart' ? c.rules.map((r) => `${esc(r.column)} ${esc(r.relation)} <strong>${esc(r.condition)}</strong>`).join(c.disjunctive ? ' <em>or</em> ' : ' <em>and</em> ') : '<span class="muted">—</span>') },
    { label: 'Products', num: true, render: (c) => c.productsCount },
  ], { href: (c) => `#/collections/${c.id}` });
  return { title: 'Collections', html: `<div class="toolbar"><span style="flex:1"></span><button class="btn primary" id="new-col">Create collection</button></div><div class="card">${t.html}</div>`, wire(root) { t.wire(root); $('#new-col', root).onclick = () => collectionForm(); } };
};

PAGES.collection = (id) => {
  const c = Q('getCollection', { collectionId: id });
  const manual = c.type === 'manual';
  const t = table('colprods', c.products, [
    { label: 'Product', render: (p) => `<a href="#/products/${p.id}">${esc(p.title)}</a>` },
    { label: 'Status', render: (p) => pill(p.status) },
    { label: 'Price', num: true, render: (p) => money(p.minPriceCents) },
    { label: 'Inventory', num: true, render: (p) => p.totalInventory },
    ...(manual ? [{ label: '', render: (p) => `<button class="btn small danger" data-rm="${p.id}">Remove</button>` }] : []),
  ]);
  const candidates = S().products.filter((p) => p.storeId === c.storeId && !c.products.some((x) => x.id === p.id));
  return {
    title: c.title,
    titleHtml: `<a href="#/collections">Collections</a> › ${esc(c.title)}`,
    html: `<div class="card"><div class="actions"><button class="btn" id="edit-col">Edit</button>
      ${manual ? `<select id="add-pid">${candidates.map((p) => `<option value="${p.id}">${esc(p.title)} (${p.id})</option>`).join('')}</select><button class="btn primary" id="add-p">Add product</button>` : `<span class="muted">Automated: ${c.rules.map((r) => `${esc(r.column)} ${esc(r.relation)} ${esc(r.condition)}`).join(c.disjunctive ? ' OR ' : ' AND ')}</span>`}</div></div>
      <div class="card"><h2>${c.productsCount} products</h2>${t.html}</div>`,
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
    { label: 'Customer', render: (c) => `<a href="#/customers/${c.id}"><strong>${esc(`${c.firstName} ${c.lastName}`)}</strong></a><div class="muted tiny">${esc(c.email)}</div>` },
    { label: 'Location', render: (c) => { const a = c.addresses.find((x) => x.isDefault); return a ? `${esc(a.city)}, ${esc(a.province)}` : '—'; } },
    { label: 'Orders', num: true, render: (c) => c.ordersCount },
    { label: 'Amount spent', num: true, render: (c) => money(c.totalSpentCents) },
    { label: 'Marketing', render: (c) => (c.acceptsMarketing ? 'Subscribed' : '<span class="muted">—</span>') },
    { label: 'Tags', render: (c) => tagsHtml(c.tags) },
  ], { href: (c) => `#/customers/${c.id}` });
  return {
    title: 'Customers',
    html: `<div class="toolbar">${filterInput('custQ', 'Name or email')} ${filterInput('custTag', 'Tag')}
      <select data-filter="custSort">${[['newest', 'Newest'], ['spent', 'Most spent'], ['orders', 'Most orders'], ['name', 'Name']].map(([v, l]) => `<option value="${v}"${(ui.f.custSort || 'newest') === v ? ' selected' : ''}>Sort: ${l}</option>`).join('')}</select>
      <span style="flex:1"></span><button class="btn primary" id="new-cust">Add customer</button></div><div class="card">${t.html}</div>`,
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
    { label: 'Order', render: (o) => `<a href="#/orders/${o.id}">${esc(o.name)}</a>` },
    { label: 'Date', render: (o) => when(o.createdAt) },
    { label: 'Total', num: true, render: (o) => money(o.totalCents) },
    { label: 'Payment', render: (o) => pill(o.financialStatus) },
    { label: 'Fulfillment', render: (o) => pill(o.fulfillmentStatus) },
    { label: 'Status', render: (o) => pill(o.status) },
  ], { href: (o) => `#/orders/${o.id}`, pageSize: 20 });
  return {
    title: `${c.firstName} ${c.lastName}`,
    titleHtml: `<a href="#/customers">Customers</a> › ${esc(`${c.firstName} ${c.lastName}`)}`,
    html: `<div class="tiles"><div class="tile"><div class="label">Amount spent</div><div class="value">${money(c.totalSpentCents)}</div></div><div class="tile"><div class="label">Orders</div><div class="value">${c.ordersCount}</div></div><div class="tile"><div class="label">Customer since</div><div class="value" style="font-size:18px">${esc(C.dateOf(c.createdAt))}</div></div></div>
    <div class="grid2"><div><div class="card"><h2>Orders <button class="btn small primary" id="cust-order">Create order</button></h2>${t.html}</div></div><div>
      <div class="card"><h2>Contact <button class="btn small" id="edit-cust">Edit</button></h2><dl class="kv"><dt>Email</dt><dd>${esc(c.email)}</dd><dt>Phone</dt><dd>${esc(c.phone) || '—'}</dd><dt>Marketing</dt><dd>${c.acceptsMarketing ? 'Subscribed' : 'Not subscribed'}</dd><dt>Note</dt><dd>${esc(c.note) || '—'}</dd><dt>ID</dt><dd class="muted">${c.id}</dd></dl></div>
      <div class="card"><h2>Tags</h2><div>${c.tags.map((t2) => `<span class="tag">${esc(t2)} <a href="#" data-untag="${esc(t2)}" aria-label="remove">×</a></span>`).join('') || '<span class="muted">No tags</span>'}</div>
        <div class="toolbar" style="margin-top:8px"><input id="tag-in" placeholder="Add tag"><button class="btn small" id="tag-add">Add</button></div></div>
      <div class="card"><h2>Addresses <button class="btn small" id="addr-add">Add</button></h2>${c.addresses.map((a) => `<div style="margin-bottom:10px">${esc(a.address1)}, ${esc(a.city)}, ${esc(a.province)} ${esc(a.zip)} ${esc(a.country)} ${a.isDefault ? '<span class="pill active">default</span>' : `<button class="btn small" data-def="${a.id}">Make default</button> <button class="btn small danger" data-deladdr="${a.id}">Delete</button>`}</div>`).join('') || '<p class="muted">No addresses.</p>'}</div>
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
    { label: 'Code', render: (d) => `<strong>${esc(d.code)}</strong><div class="muted tiny">${esc(d.title)}</div>` },
    { label: 'Status', render: (d) => pill(d.status) },
    { label: 'Value', render: (d) => `${discountValue(d)}${d.scope === 'collections' ? ` · ${d.collectionIds.map((x) => esc(get('collections', x)?.title)).join(', ')}` : d.scope === 'products' ? ` · ${d.productIds.length} products` : ''}` },
    { label: 'Requirements', render: (d) => `${discountMin(d)}${d.oncePerCustomer ? ' · once per customer' : ''}` },
    { label: 'Used', num: true, render: (d) => `${d.usageCount}${d.usageLimit != null ? ` / ${d.usageLimit}` : ''}` },
    { label: 'Active dates', render: (d) => `${esc(d.startsAt)} → ${esc(d.endsAt || 'no end')}` },
    { label: '', render: (d) => `<button class="btn small" data-dedit="${d.id}">Edit</button> ${d.enabled ? `<button class="btn small danger" data-doff="${d.id}">Deactivate</button>` : `<button class="btn small" data-don="${d.id}">Activate</button>`}` },
  ]);
  return {
    title: 'Discounts',
    html: `<div class="toolbar">${tabs('discTab', [['all', 'All'], ['active', 'Active'], ['scheduled', 'Scheduled'], ['expired', 'Expired'], ['disabled', 'Disabled']], tab)}<span style="flex:1"></span><button class="btn primary" id="new-disc">Create discount</button></div><div class="card">${t.html}</div>`,
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
    html: `<div class="toolbar"><label>From <input type="date" data-filter="anFrom" value="${from}"></label><label>To <input type="date" data-filter="anTo" value="${to}"></label>
      <select data-filter="anInt">${['day', 'week', 'month'].map((i) => `<option value="${i}"${i === interval ? ' selected' : ''}>By ${i}</option>`).join('')}</select><span class="muted tiny">Press Enter in a date field to apply.</span></div>
    <div class="tiles">${tile('Gross sales', money(sum.grossSalesCents))}${tile('Discounts', money(-sum.discountsCents))}${tile('Returns', money(-sum.returnsCents))}${tile('Net sales', money(sum.netSalesCents))}${tile('Total sales', money(sum.totalSalesCents))}${tile('Orders', sum.orders)}${tile('Average order value', money(sum.averageOrderValueCents))}${tile('Returning customers', `${(sum.returningCustomerRate * 100).toFixed(1)}%`)}</div>
    <div class="card"><h2>Net sales by ${interval} <button class="btn small" id="toggle-table">Show table</button></h2>${columnChart(sales.rows, { value: (r) => r.netSalesCents, label: (r) => r.period, fmt: shortMoney, title: `Net sales by ${interval}` })}
      <div id="sales-table" hidden>${table('salesrows', sales.rows, [{ label: 'Period', render: (r) => r.period }, { label: 'Orders', num: true, render: (r) => r.orders }, { label: 'Gross', num: true, render: (r) => money(r.grossSalesCents) }, { label: 'Discounts', num: true, render: (r) => money(r.discountsCents) }, { label: 'Returns', num: true, render: (r) => money(r.returnsCents) }, { label: 'Net', num: true, render: (r) => money(r.netSalesCents) }], { pageSize: 200 }).html}</div></div>
    <div class="card"><h2>Top products ${tabs('anBy', [['units', 'By units'], ['revenue', 'By net sales']], by)}</h2>${table('top', top.items, [{ label: '#', render: (r) => top.items.indexOf(r) + 1 }, { label: 'Product', render: (r) => `<a href="#/products/${r.productId}">${esc(r.title)}</a>` }, { label: 'Net units', num: true, render: (r) => r.unitsSold }, { label: 'Net sales', num: true, render: (r) => money(r.netSalesCents) }, { label: 'Orders', num: true, render: (r) => r.orders }]).html}</div>`,
    wire(root) {
      wireFilters(root); wireChart(root);
      $('#toggle-table', root).onclick = (e) => { const t = $('#sales-table', root); t.hidden = !t.hidden; e.target.textContent = t.hidden ? 'Show table' : 'Hide table'; };
    },
  };
};

// ---- storefront
const swatchColor = (id) => { const h = (200 + (C.hashSeed(id) % 170)) % 360; return `hsl(${h} 45% 42%)`; }; // blues→purples→reds→oranges
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
    html: `<div class="storefront-banner"><h2>${esc(store().name)}</h2><div class="tiny">${esc(store().domain)} — a simulated shopper view. Checkout creates a real order in the admin.</div></div>
    <div class="grid2"><div>
      <div class="toolbar"><select data-filter="sfCol"><option value="">All products</option>${cols.map((c) => `<option value="${c.id}"${c.id === col ? ' selected' : ''}>${esc(c.title)}</option>`).join('')}</select>${filterInput('sfQ', 'Search')}</div>
      <div class="store-grid">${items.map((p) => `<div class="product-card"><div class="swatch" style="background:${swatchColor(p.id)}">${esc(p.title.split(' ').map((w) => w[0]).join('').slice(0, 3))}</div>
        <strong>${esc(p.title)}</strong><div>${money(p.minPriceCents)}${p.variants[0].compareAtCents ? `<span class="strike">${money(p.variants[0].compareAtCents)}</span>` : ''}</div>
        <select data-vsel="${p.id}">${p.variants.map((v) => `<option value="${v.id}"${v.available ? '' : ' disabled'}>${esc(v.title)} — ${money(v.priceCents)}${v.available ? '' : ' (sold out)'}</option>`).join('')}</select>
        <button class="btn primary small" data-add="${p.id}"${p.variants.some((v) => v.available) ? '' : ' disabled'}>Add to cart</button></div>`).join('') || '<p class="muted">No products.</p>'}</div>
    </div><div>
      <div class="card"><h2>Cart ${cart ? `<span class="muted tiny">${cart.id}</span>` : ''}</h2>
      ${cart && cart.lines.length ? `<table><tbody>${pr.lines.map((l) => `<tr><td>${esc(l.title)}<div class="muted tiny">${esc(l.variantTitle)}</div></td><td><input class="qty" type="number" min="0" value="${l.quantity}" data-cq="${l.variantId}"></td><td class="num">${money(l.priceCents * l.quantity)}</td></tr>`).join('')}</tbody></table>
        <div class="toolbar" style="margin-top:8px"><input id="code-in" placeholder="Discount code" value="${esc(cart.discountCode || '')}"><button class="btn small" id="code-apply">Apply</button></div>
        ${view.discountError ? `<div class="tiny" style="color:var(--bad)">${esc(view.discountError)}</div>` : ''}
        <dl class="kv"><dt>Subtotal</dt><dd>${money(pr.subtotalCents)}</dd><dt>Discount</dt><dd>${pr.discountCode ? `${esc(pr.discountCode)} −${money(pr.discountCents + pr.shippingDiscountCents)}` : '—'}</dd><dt>Shipping</dt><dd>${money(pr.shippingCents - pr.shippingDiscountCents)} <span class="muted tiny">(standard)</span></dd><dt>Tax</dt><dd>${money(pr.taxCents)}</dd><dt><strong>Total</strong></dt><dd><strong>${money(pr.totalCents)}</strong></dd></dl>
        <button class="btn primary" id="checkout" style="margin-top:10px;width:100%">Checkout</button>` : '<p class="muted">Your cart is empty.</p>'}</div>
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
  const html = `<div class="card" id="active-task"></div><div class="card"><h2>Agent tasks</h2><div id="task-list" class="muted">Loading…</div></div>`;
  return {
    title: 'Agent tasks',
    html,
    async wire(root) {
      const list = await cw.listTasks();
      const active = list.find((t) => t.id === cw.activeTaskId);
      $('#active-task', root).innerHTML = active ? `<h2>Active: ${esc(active.id)} <button class="btn small primary" id="check-task">Check</button></h2><p>${esc(active.prompt)}</p><div id="check-out"></div>` : '<p class="muted">No active task. Starting a task resets the world to the task\'s seed.</p>';
      $('#task-list', root).innerHTML = `<table><thead><tr><th>ID</th><th>Title</th><th class="num">Seed</th><th></th></tr></thead><tbody>${list.map((t) => `<tr><td>${esc(t.id)}</td><td>${esc(t.title)}<div class="muted tiny">${esc(t.prompt)}</div></td><td class="num">${t.seed}</td><td><button class="btn small" data-start="${esc(t.id)}">Start</button></td></tr>`).join('')}</tbody></table>`;
      $$('[data-start]', root).forEach((b) => { b.onclick = async () => { await cw.startTask(b.dataset.start); toast(`Started ${b.dataset.start}`); render(); }; });
      const cb = $('#check-task', root);
      if (cb) cb.onclick = async () => { const r = await cw.checkTask(); $('#check-out', root).innerHTML = r.pass ? '<p class="pill paid">PASS</p>' : `<p class="pill refunded">FAIL</p><ul>${(r.reasons || [r.error?.message]).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`; };
    },
  };
};

PAGES.api = () => ({
  title: 'API',
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
  $('#clock').textContent = `${S().meta.today} ${S().meta.time}`;
  $('#seed-input').value = cw.seed;
  $('#session-info').textContent = `${S().actionLog.length} actions this session${cw.activeTaskId ? ` · task ${cw.activeTaskId}` : ''}`;
  let page;
  try {
    page = PAGES[r.page](r.id);
  } catch (e) {
    page = { title: 'Not found', html: `<div class="card"><p>${esc(e.message)}</p></div>`, wire() {} };
  }
  if (r.page === 'product' || r.page === 'collection' || r.page === 'customer' || r.page === 'order') {
    const ent = get({ product: 'products', collection: 'collections', customer: 'customers', order: 'orders' }[r.page], r.id);
    if (ent && ent.storeId !== ui.store) { ui.store = ent.storeId; localStorage.setItem('cartwright:ui:store', ui.store); sel.value = ui.store; }
  }
  $('#page-title').innerHTML = page.titleHtml || esc(page.title);
  document.title = `${page.title} · Cartwright`;
  const view = $('#view');
  view.innerHTML = page.html;
  page.wire(view);
}

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
window.addEventListener('hashchange', () => { closeModal(); render(); window.scrollTo(0, 0); });
cw.subscribe((evt) => { if (evt.kind !== 'action') render(); });
render();
