// Deterministic world generator: same seed => byte-identical state.
import { Rng } from './prng.js';
import {
  STORE_TEMPLATES, VERTICALS, FIRST_NAMES, LAST_NAMES, STREETS, STREET_SUFFIXES, CITIES, CARRIERS, TRACKING_URL,
  DISCOUNT_TEMPLATES, CANCEL_REASONS, REFUND_REASONS, RETURN_REASONS,
} from './catalog.js';
import { addDays, daysBetween, pad, slugify } from './util.js';
import {
  emptyState, nextId, variantTitleOf, priceLines, deriveFinancialStatus, deriveFulfillmentStatus, lineRefundAmounts, ActionError,
} from './model.js';

export const DEFAULT_SEED = 42;
export const SEED_CONFIG = { daysBack: 180, stores: STORE_TEMPLATES.length };

const STORE_SKU = { 'STO-1': 'FH', 'STO-2': 'SB', 'STO-3': 'RW' };

function abbrev(v) {
  const s = String(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length <= 3 ? s : s.slice(0, 3);
}

export function trackingNumberFor(rng, carrier) {
  const digits = (n) => Array.from({ length: n }, () => rng.int(0, 9)).join('');
  if (carrier === 'UPS') return `1Z${digits(16)}`;
  if (carrier === 'USPS') return `9400${digits(18)}`;
  if (carrier === 'FedEx') return digits(12);
  return digits(10);
}

export function generateState(seed = DEFAULT_SEED) {
  const rng = new Rng(`cartwright:${seed}`);
  const state = emptyState(seed);
  const today = state.meta.today;
  const stamp = (date, minHour = 0) => {
    const maxHour = date === today ? 9 : 23;
    const h = Math.min(maxHour, rng.int(Math.min(minHour, maxHour), maxHour));
    return `${date}T${pad(h, 2)}:${pad(rng.int(0, 59), 2)}`;
  };

  // ---- stores & locations ---------------------------------------------------
  for (const t of STORE_TEMPLATES) {
    state.stores.push({
      id: t.id, name: t.name, domain: t.domain, city: t.city, currency: 'USD', taxRate: t.taxRate, vertical: t.vertical,
      shipping: { ...t.shipping }, locationIds: t.locations.map((l) => l.id), nextOrderNumber: 1001,
    });
    for (const l of t.locations) state.locations.push({ id: l.id, storeId: t.id, name: l.name, city: l.city, active: true });
  }

  // ---- products & variants --------------------------------------------------
  const activeByStore = {};
  for (const t of STORE_TEMPLATES) {
    const V = VERTICALS[t.vertical];
    const combos = [];
    for (const ty of V.types) for (const noun of ty.nouns) for (const adj of V.adjectives) combos.push([ty, `${adj} ${noun}`]);
    const picked = rng.shuffle(combos).slice(0, t.products);
    activeByStore[t.id] = [];
    picked.forEach(([ty, title], n) => {
      const status = rng.weighted([['active', 0.92], ['draft', 0.05], ['archived', 0.03]]);
      const tags = rng.shuffle(V.tags).slice(0, rng.weighted([[0, 0.25], [1, 0.4], [2, 0.25], [3, 0.1]]));
      const options = ty.options.map(([name, values]) => {
        let vals = values;
        if (values.length > 3 && rng.chance(0.5)) vals = rng.shuffle(values).slice(0, rng.int(2, values.length - 1)).sort((a, b) => values.indexOf(a) - values.indexOf(b));
        return { name, values: vals.slice() };
      });
      // cap combinations at 12
      while (options.reduce((a, o) => a * o.values.length, 1) > 12) {
        const big = options.reduce((a, o) => (o.values.length > a.values.length ? o : a));
        big.values.pop();
      }
      const product = {
        id: nextId(state, 'product'), storeId: t.id, title, handle: slugify(title), vendor: rng.pick(V.vendors), productType: ty.type,
        tags, status, description: `${title} from our ${ty.type.toLowerCase()} line.`, options, variantIds: [],
        createdAt: `${addDays(today, -rng.int(30, 700))}T09:00`,
      };
      state.products.push(product);
      const base = rng.int(ty.price[0], ty.price[1]) * 100 - rng.pick([0, 5, 1]);
      const onSale = rng.chance(0.15);
      let combosV = [[]];
      for (const o of options) combosV = combosV.flatMap((c) => o.values.map((v) => [...c, v]));
      const skus = new Set();
      combosV.forEach((opts, i) => {
        const step = options.findIndex((o) => ['Capacity', 'Size'].includes(o.name) && t.vertical !== 'apparel');
        const priceCents = step >= 0 ? base + options[step].values.indexOf(opts[step]) * 1000 : base;
        let sku = [STORE_SKU[t.id], pad(n + 1, 3), ...opts.map(abbrev)].join('-');
        if (skus.has(sku)) sku = `${sku}-${i + 1}`;
        skus.add(sku);
        const inventory = {};
        t.locations.forEach((l, li) => {
          const r = rng.next();
          inventory[l.id] = li === 0
            ? (r < 0.07 ? 0 : r < 0.15 ? rng.int(1, 4) : rng.int(5, 80))
            : (r < 0.25 ? 0 : rng.int(1, 25));
        });
        const v = {
          id: nextId(state, 'variant'), productId: product.id, storeId: t.id, title: variantTitleOf(opts), options: opts, sku,
          priceCents, compareAtCents: onSale ? Math.round((priceCents * 1.3) / 100) * 100 : null,
          weightGrams: rng.int(1, 40) * 50, inventoryPolicy: rng.chance(0.08) ? 'continue' : 'deny', inventory,
        };
        state.variants.push(v);
        product.variantIds.push(v.id);
      });
      if (status === 'active') activeByStore[t.id].push(product);
    });
  }

  // ---- collections -------------------------------------------------------------
  const staffPicks = {};
  for (const t of STORE_TEMPLATES) {
    const V = VERTICALS[t.vertical];
    const active = activeByStore[t.id];
    const mk = (title, type, extra) => {
      const c = { id: nextId(state, 'collection'), storeId: t.id, title, handle: slugify(title), type, productIds: [], rules: [], disjunctive: false, description: '', ...extra };
      state.collections.push(c);
      return c;
    };
    staffPicks[t.id] = mk('Staff Picks', 'manual', { productIds: rng.shuffle(active).slice(0, 8).map((p) => p.id).sort() });
    mk('Gift Guide', 'manual', { productIds: rng.shuffle(active).slice(0, 10).map((p) => p.id).sort() });
    mk('New Arrivals', 'smart', { rules: [{ column: 'tag', relation: 'equals', condition: 'new' }] });
    mk('Bestsellers', 'smart', { rules: [{ column: 'tag', relation: 'equals', condition: 'bestseller' }] });
    mk('On Sale', 'smart', { rules: [{ column: 'variant_compare_at_price', relation: 'greater_than', condition: '0' }] });
    mk('Under $30', 'smart', { rules: [{ column: 'variant_price', relation: 'less_than', condition: '30.00' }] });
    for (const ty of V.types.slice(0, 3)) mk(`${ty.type} Collection`, 'smart', { rules: [{ column: 'type', relation: 'equals', condition: ty.type }] });
  }

  // ---- discounts -----------------------------------------------------------------
  for (const t of STORE_TEMPLATES) {
    const list = [...DISCOUNT_TEMPLATES, { code: 'STAFFPICK20', title: '20% off Staff Picks', type: 'percentage', value: 20, scope: 'collections', minType: 'none', minValue: 0, usageLimit: null, oncePerCustomer: false, startOffset: -60, endOffset: null }];
    for (const d of list) {
      state.discounts.push({
        id: nextId(state, 'discount'), storeId: t.id, code: d.code, title: d.title, type: d.type, value: d.value, scope: d.scope,
        collectionIds: d.scope === 'collections' ? [staffPicks[t.id].id] : [], productIds: [],
        minType: d.minType, minValue: d.minValue, usageLimit: d.usageLimit, oncePerCustomer: d.oncePerCustomer,
        startsAt: addDays(today, d.startOffset), endsAt: d.endOffset == null ? null : addDays(today, d.endOffset),
        enabled: true, usageCount: 0, createdAt: `${addDays(today, d.startOffset - 3)}T09:00`,
      });
    }
  }

  // ---- customers -------------------------------------------------------------------
  const customersByStore = {};
  const emails = new Set();
  const randomAddress = () => {
    const [city, province, zip] = rng.pick(CITIES);
    return { address1: `${rng.int(100, 9899)} ${rng.pick(STREETS)} ${rng.pick(STREET_SUFFIXES)}`, city, province, zip, country: 'US' };
  };
  for (const t of STORE_TEMPLATES) {
    customersByStore[t.id] = [];
    for (let i = 0; i < t.customers; i++) {
      const firstName = rng.pick(FIRST_NAMES);
      const lastName = rng.pick(LAST_NAMES);
      let email = `${firstName}.${lastName}`.toLowerCase();
      let k = 1;
      while (emails.has(`${t.id}:${email}${k > 1 ? k : ''}`)) k++;
      email = `${email}${k > 1 ? k : ''}@example.com`;
      emails.add(`${t.id}:${email.replace('@example.com', '')}`);
      const addresses = [];
      const nAddr = rng.chance(0.2) ? 2 : 1;
      for (let a = 0; a < nAddr; a++) addresses.push({ id: nextId(state, 'address'), firstName, lastName, ...randomAddress(), isDefault: a === 0 });
      const tags = [];
      if (rng.chance(0.05)) tags.push('wholesale');
      if (rng.chance(0.25)) tags.push('newsletter');
      const c = {
        id: nextId(state, 'customer'), storeId: t.id, firstName, lastName, email, phone: `+1555${pad(rng.int(0, 9999999), 7)}`,
        acceptsMarketing: rng.chance(0.45), tags, note: '', addresses, state: 'enabled',
        createdAt: `${addDays(today, -rng.int(1, 500))}T${pad(rng.int(8, 20), 2)}:00`,
      };
      state.customers.push(c);
      customersByStore[t.id].push(c);
    }
  }

  // ---- orders ------------------------------------------------------------------------
  const days = SEED_CONFIG.daysBack;
  const plan = [];
  for (const t of STORE_TEMPLATES) {
    for (let i = 0; i < t.orders; i++) {
      const back = Math.floor(days * (1 - Math.sqrt(rng.next())));
      const date = addDays(today, -back);
      plan.push({ storeId: t.id, createdAt: stamp(date) });
    }
  }
  plan.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.storeId < b.storeId ? -1 : 1));

  const discountsByStore = {};
  for (const d of state.discounts) (discountsByStore[d.storeId] ||= []).push(d);
  const usedBy = new Set(); // discountId|customerId
  const firstOrder = new Map();
  const storeById = Object.fromEntries(state.stores.map((s) => [s.id, s]));

  for (const pl of plan) {
    const store = storeById[pl.storeId];
    const date = pl.createdAt.slice(0, 10);
    const age = daysBetween(date, today);
    const custs = customersByStore[store.id];
    const customer = rng.chance(0.45) ? custs[rng.int(0, Math.floor(custs.length * 0.15))] : rng.pick(custs);
    const active = activeByStore[store.id];
    const nLines = rng.weighted([[1, 0.5], [2, 0.3], [3, 0.14], [4, 0.06]]);
    const lines = [];
    const usedV = new Set();
    for (let i = 0; i < nLines; i++) {
      const p = rng.pick(active);
      const vid = rng.pick(p.variantIds);
      if (usedV.has(vid)) continue;
      usedV.add(vid);
      lines.push({ variantId: vid, quantity: rng.weighted([[1, 0.75], [2, 0.2], [3, 0.05]]) });
    }
    const shippingMethod = rng.weighted([['standard', 0.75], ['express', 0.15], ['pickup', 0.1]]);
    let pricing = null;
    if (rng.chance(0.2)) {
      const cands = discountsByStore[store.id].filter((d) => d.startsAt <= date && (!d.endsAt || date <= d.endsAt) &&
        (d.usageLimit == null || d.usageCount < d.usageLimit) && !(d.oncePerCustomer && usedBy.has(`${d.id}|${customer.id}`)));
      if (cands.length) {
        const d = rng.pick(cands);
        try {
          pricing = priceLines(state, store, lines, { discount: d, shippingMethod });
          d.usageCount++;
          usedBy.add(`${d.id}|${customer.id}`);
        } catch (e) {
          if (!(e instanceof ActionError)) throw e;
          pricing = null;
        }
      }
    }
    if (!pricing) pricing = priceLines(state, store, lines, { shippingMethod });
    const addr = customer.addresses.find((a) => a.isDefault);
    const number = store.nextOrderNumber++;
    const order = {
      id: nextId(state, 'order'), storeId: store.id, number, name: `#${number}`, customerId: customer.id, email: customer.email,
      createdAt: pl.createdAt,
      lineItems: pricing.lines.map((l) => ({ id: nextId(state, 'lineItem'), ...l, fulfilledQty: 0, refundedQty: 0, removedQty: 0 })),
      subtotalCents: pricing.subtotalCents, discountCents: pricing.discountCents, shippingCents: pricing.shippingCents,
      shippingDiscountCents: pricing.shippingDiscountCents, taxCents: pricing.taxCents, totalCents: pricing.totalCents,
      discountId: pricing.discountId, discountCode: pricing.discountCode, shippingMethod,
      shippingAddress: shippingMethod === 'pickup' ? null : { name: `${customer.firstName} ${customer.lastName}`, address1: addr.address1, city: addr.city, province: addr.province, zip: addr.zip, country: addr.country },
      locationId: shippingMethod === 'pickup' ? store.locationIds[store.locationIds.length - 1] : rng.chance(0.85) ? store.locationIds[0] : rng.pick(store.locationIds),
      gateway: 'card', source: rng.chance(0.9) ? 'online_store' : 'admin',
      status: 'open', closedAt: null, cancelledAt: null, cancelReason: null,
      financialStatus: 'pending', fulfillmentStatus: 'unfulfilled', tags: [], note: '',
    };
    if (!firstOrder.has(customer.id)) firstOrder.set(customer.id, pl.createdAt);
    if (rng.chance(0.05)) order.tags.push('gift');
    if (customer.tags.includes('wholesale')) order.tags.push('wholesale');
    if (rng.chance(0.03)) order.note = rng.pick(['Please leave at the side door.', 'Gift wrap if possible.', 'Customer asked for no plastic packaging.']);
    state.orders.push(order);

    const txs = [];
    const tx = (kind, amountCents, at, gateway = order.gateway) => {
      const t = { id: nextId(state, 'transaction'), orderId: order.id, storeId: store.id, kind, status: 'success', amountCents, gateway, parentId: null, createdAt: at };
      txs.push(t);
      state.transactions.push(t);
      return t;
    };

    // payment
    const r = rng.next();
    let payment = 'paid';
    if (age <= 3 && r < 0.1) payment = 'authorized';
    else if ((age <= 3 && r < 0.17) || (age > 3 && age <= 20 && r < 0.02)) payment = 'pending';
    else if (age >= 1 && r > 0.97) payment = 'cancelled';
    if (payment === 'pending') { order.gateway = 'manual'; order.source = 'admin'; }
    if (order.totalCents > 0) {
      if (payment === 'paid') tx('sale', order.totalCents, order.createdAt);
      if (payment === 'authorized' || payment === 'cancelled') tx('authorization', order.totalCents, order.createdAt);
    }
    if (payment === 'cancelled') {
      const when = `${addDays(date, rng.int(0, Math.min(1, age)))}T${order.createdAt.slice(11)}`;
      const cancelAt = when > `${today}T09:59` ? `${today}T09:59` : when;
      if (order.totalCents > 0) {
        if (rng.chance(0.5)) {
          tx('void', 0, cancelAt);
        } else {
          tx('capture', order.totalCents, order.createdAt);
          tx('refund', order.totalCents, cancelAt);
          const lineRefs = order.lineItems.map((li) => {
            const amt = lineRefundAmounts(li, li.quantity);
            li.refundedQty = li.quantity;
            li.removedQty = li.quantity;
            return { lineItemId: li.id, quantity: li.quantity, restock: true, locationId: order.locationId, ...amt };
          });
          state.refunds.push({ id: nextId(state, 'refund'), orderId: order.id, storeId: store.id, createdAt: cancelAt, reason: 'other', note: 'Order cancelled', lineItems: lineRefs, shippingCents: order.shippingCents - order.shippingDiscountCents, amountCents: order.totalCents, transactionId: txs[txs.length - 1].id, returnId: null });
        }
      }
      order.status = 'cancelled';
      order.cancelledAt = cancelAt;
      order.cancelReason = rng.pick(CANCEL_REASONS);
      order.closedAt = cancelAt;
    }

    // fulfillment
    if (payment === 'paid') {
      const f = rng.next();
      let mode = 'none';
      if (age >= 6) mode = f < 0.95 ? 'full' : f < 0.98 ? 'partial' : 'none';
      else if (age >= 2) mode = f < 0.55 ? 'full' : f < 0.7 ? 'partial' : 'none';
      else mode = f < 0.1 ? 'full' : 'none';
      if (mode === 'partial' && order.lineItems.length === 1 && order.lineItems[0].quantity === 1) mode = 'none';
      if (mode !== 'none') {
        const fdate = addDays(date, Math.min(age, rng.int(0, 2)));
        const at = fdate === date ? order.createdAt : stamp(fdate, 8);
        let fl;
        if (mode === 'full') fl = order.lineItems.map((li) => ({ lineItemId: li.id, quantity: li.quantity }));
        else if (order.lineItems.length > 1) fl = [{ lineItemId: order.lineItems[0].id, quantity: order.lineItems[0].quantity }];
        else fl = [{ lineItemId: order.lineItems[0].id, quantity: order.lineItems[0].quantity - 1 }];
        const carrier = order.shippingMethod === 'pickup' ? null : rng.pick(CARRIERS);
        const num = carrier ? trackingNumberFor(rng, carrier) : null;
        state.fulfillments.push({
          id: nextId(state, 'fulfillment'), orderId: order.id, storeId: store.id, locationId: order.locationId, status: 'success', lineItems: fl,
          trackingCompany: carrier, trackingNumber: num, trackingUrl: carrier ? TRACKING_URL[carrier] + num : null, notifyCustomer: true, createdAt: at,
        });
        for (const x of fl) order.lineItems.find((li) => li.id === x.lineItemId).fulfilledQty += x.quantity;
      }
    }
    order.fulfillmentStatus = deriveFulfillmentStatus(order);

    // refunds / returns on fulfilled paid orders
    if (payment === 'paid' && order.fulfillmentStatus === 'fulfilled' && order.totalCents > 0) {
      const rr = rng.next();
      if (age >= 8 && rr < 0.05) {
        const li = rng.pick(order.lineItems);
        const withReturn = rng.chance(0.6);
        const at = stamp(addDays(date, Math.min(age, rng.int(5, 8))), 8);
        let retId = null;
        if (withReturn) {
          retId = nextId(state, 'return');
          state.returns.push({ id: retId, orderId: order.id, storeId: store.id, customerId: customer.id, status: 'closed', requestedBy: 'customer', lineItems: [{ lineItemId: li.id, quantity: 1, reason: rng.pick(RETURN_REASONS) }], note: '', createdAt: at, closedAt: at, refundId: null });
        }
        const amt = lineRefundAmounts(li, 1);
        li.refundedQty += 1;
        const restock = withReturn || rng.chance(0.4);
        const t = tx('refund', amt.subtotalCents + amt.taxCents, at);
        const ref = { id: nextId(state, 'refund'), orderId: order.id, storeId: store.id, createdAt: at, reason: withReturn ? 'customer_request' : rng.pick(REFUND_REASONS), note: '', lineItems: [{ lineItemId: li.id, quantity: 1, restock, locationId: restock ? order.locationId : null, ...amt }], shippingCents: 0, amountCents: t.amountCents, transactionId: t.id, returnId: retId };
        state.refunds.push(ref);
        if (retId) state.returns[state.returns.length - 1].refundId = ref.id;
      } else if (age >= 5 && age <= 30 && rr < 0.08) {
        const li = rng.pick(order.lineItems);
        state.returns.push({
          id: nextId(state, 'return'), orderId: order.id, storeId: store.id, customerId: customer.id, status: rr < 0.07 ? 'requested' : 'open', requestedBy: 'customer',
          lineItems: [{ lineItemId: li.id, quantity: 1, reason: rng.pick(RETURN_REASONS) }], note: '', createdAt: stamp(addDays(today, -rng.int(0, Math.min(age - 3, 4))), 0), closedAt: null, refundId: null,
        });
      }
    }
    order.financialStatus = deriveFinancialStatus(order, txs);
    if (order.status === 'open' && age > 30 && order.fulfillmentStatus === 'fulfilled' && ['paid', 'partially_refunded', 'refunded'].includes(order.financialStatus) &&
      !state.returns.some((x) => x.orderId === order.id && (x.status === 'requested' || x.status === 'open')) && rng.chance(0.6)) {
      order.status = 'closed';
      order.closedAt = `${addDays(date, 14)}T09:00`;
    }
  }

  for (const c of state.customers) {
    const f = firstOrder.get(c.id);
    if (f && f < c.createdAt) c.createdAt = f;
  }
  return state;
}
