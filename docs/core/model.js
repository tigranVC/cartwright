// Shared model helpers used by the seed generator, actions, queries and
// validation: ids, lookups, collection membership, discount evaluation,
// order pricing, refund math and derived order statuses.
import { TODAY, NOW_TIME, hasTag, dateOf } from './util.js';

export class ActionError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ActionError';
    this.code = code;
    if (details) this.details = details;
  }
}

export const ID_FORMATS = {
  product: ['PRD', 4],
  variant: ['VAR', 5],
  collection: ['COL', 3],
  customer: ['CUS', 5],
  address: ['ADR', 5],
  order: ['ORD', 6],
  lineItem: ['LI', 6],
  transaction: ['TRX', 6],
  fulfillment: ['FUL', 5],
  refund: ['REF', 5],
  return: ['RET', 4],
  discount: ['DSC', 3],
  cart: ['CRT', 4],
  adjustment: ['ADJ', 6],
};

export function nextId(state, kind) {
  const [prefix, width] = ID_FORMATS[kind];
  const n = (state.meta.counters[kind] || 0) + 1;
  state.meta.counters[kind] = n;
  return `${prefix}-${String(n).padStart(width, '0')}`;
}

// id -> entity index cache. Entities are only ever appended (never removed),
// so an index is valid as long as the array length is unchanged.
const indexCache = new WeakMap();
export function byId(state, collection, id) {
  const arr = state[collection];
  if (!arr) return undefined;
  let entry = indexCache.get(arr);
  if (!entry || entry.len !== arr.length) {
    entry = { len: arr.length, map: new Map(arr.map((e) => [e.id, e])) };
    indexCache.set(arr, entry);
  }
  return entry.map.get(id);
}

export function mustGet(state, collection, id, label) {
  if (typeof id !== 'string' || !id) throw new ActionError('INVALID_PARAMS', `${label}Id is required`);
  const e = byId(state, collection, id);
  if (!e) throw new ActionError('NOT_FOUND', `${label} ${id} not found`);
  return e;
}

export function mustStore(state, storeId) {
  if (typeof storeId !== 'string' || !storeId) throw new ActionError('INVALID_PARAMS', 'storeId is required');
  const s = byId(state, 'stores', storeId);
  if (!s) throw new ActionError('NOT_FOUND', `store ${storeId} not found`);
  return s;
}

export const nowStamp = (state) => `${state.meta.today}T${state.meta.time}`;

export const variantTitleOf = (options) => (options && options.length ? options.join(' / ') : 'Default Title');

export const variantsOf = (state, productId) => {
  const p = byId(state, 'products', productId);
  return p ? p.variantIds.map((id) => byId(state, 'variants', id)) : [];
};

export const totalAvailable = (variant) => Object.values(variant.inventory).reduce((a, b) => a + b, 0);

export function findVariantBySku(state, storeId, sku) {
  if (!sku) return undefined;
  const k = String(sku).trim().toLowerCase();
  return state.variants.find((v) => v.storeId === storeId && v.sku && v.sku.toLowerCase() === k);
}

// ---- collections -----------------------------------------------------------------
const toCents = (v) => Math.round(parseFloat(v) * 100);

function strMatch(value, relation, cond) {
  const a = String(value ?? '').toLowerCase();
  const b = String(cond ?? '').toLowerCase();
  switch (relation) {
    case 'equals': return a === b;
    case 'not_equals': return a !== b;
    case 'contains': return a.includes(b);
    case 'not_contains': return !a.includes(b);
    case 'starts_with': return a.startsWith(b);
    case 'ends_with': return a.endsWith(b);
    default: return false;
  }
}
function numMatch(value, relation, cond) {
  if (value == null) return false;
  switch (relation) {
    case 'equals': return value === cond;
    case 'not_equals': return value !== cond;
    case 'greater_than': return value > cond;
    case 'less_than': return value < cond;
    default: return false;
  }
}

/** Does a product satisfy one smart-collection rule? Variant rules match if any variant matches. */
export function ruleMatches(state, product, rule) {
  const { column, relation, condition } = rule;
  switch (column) {
    case 'title': return strMatch(product.title, relation, condition);
    case 'type': return strMatch(product.productType, relation, condition);
    case 'vendor': return strMatch(product.vendor, relation, condition);
    case 'tag':
      if (relation === 'equals') return hasTag(product.tags, condition);
      if (relation === 'not_equals') return !hasTag(product.tags, condition);
      if (relation === 'not_contains') return !product.tags.some((t) => strMatch(t, 'contains', condition));
      return product.tags.some((t) => strMatch(t, relation, condition));
    case 'variant_price':
      return variantsOf(state, product.id).some((v) => numMatch(v.priceCents, relation, toCents(condition)));
    case 'variant_compare_at_price':
      return variantsOf(state, product.id).some((v) => numMatch(v.compareAtCents, relation, toCents(condition)));
    case 'variant_inventory':
      return variantsOf(state, product.id).some((v) => numMatch(totalAvailable(v), relation, Number(condition)));
    case 'variant_title':
      return variantsOf(state, product.id).some((v) => strMatch(v.title, relation, condition));
    default: return false;
  }
}

export function productInCollection(state, collection, product) {
  if (product.storeId !== collection.storeId) return false;
  if (collection.type === 'manual') return collection.productIds.includes(product.id);
  if (!collection.rules.length) return false;
  return collection.disjunctive
    ? collection.rules.some((r) => ruleMatches(state, product, r))
    : collection.rules.every((r) => ruleMatches(state, product, r));
}

/** Product ids in a collection (manual: in stored order; smart: by product id). */
export function collectionProductIds(state, collection) {
  if (collection.type === 'manual') return collection.productIds.slice();
  return state.products.filter((p) => productInCollection(state, collection, p)).map((p) => p.id);
}

// ---- discounts ---------------------------------------------------------------------
export function discountStatus(d, date = TODAY) {
  if (!d.enabled) return 'disabled';
  if (d.startsAt && date < d.startsAt) return 'scheduled';
  if (d.endsAt && date > d.endsAt) return 'expired';
  if (d.usageLimit != null && d.usageCount >= d.usageLimit) return 'exhausted';
  return 'active';
}

export const findDiscountByCode = (state, storeId, code) => {
  const k = String(code ?? '').trim().toLowerCase();
  return state.discounts.find((d) => d.storeId === storeId && d.code.toLowerCase() === k);
};

/** Has this customer (by id or email) already used the discount? */
export function customerUsedDiscount(state, discount, customerId, email) {
  const em = email ? String(email).toLowerCase() : null;
  return state.orders.some((o) => o.discountId === discount.id &&
    ((customerId && o.customerId === customerId) || (em && o.email && o.email.toLowerCase() === em)));
}

/** Validate a code for a checkout context; returns the discount or throws DISCOUNT_INVALID. */
export function resolveDiscount(state, store, code, { customerId = null, email = null } = {}) {
  if (code == null || String(code).trim() === '') return null;
  const d = findDiscountByCode(state, store.id, code);
  if (!d) throw new ActionError('DISCOUNT_INVALID', `discount code ${String(code).trim()} does not exist in ${store.id}`);
  const st = discountStatus(d, state.meta.today);
  if (st !== 'active') throw new ActionError('DISCOUNT_INVALID', `discount code ${d.code} is ${st}`);
  if (d.oncePerCustomer && (customerId || email) && customerUsedDiscount(state, d, customerId, email)) {
    throw new ActionError('DISCOUNT_INVALID', `discount code ${d.code} can only be used once per customer`);
  }
  return d;
}

function eligibleLine(state, discount, line, collCache) {
  if (discount.type === 'free_shipping' || discount.scope === 'all') return true;
  if (discount.scope === 'products') return discount.productIds.includes(line.productId);
  const product = byId(state, 'products', line.productId);
  return discount.collectionIds.some((cid) => {
    if (!collCache.has(cid)) {
      const c = byId(state, 'collections', cid);
      collCache.set(cid, new Set(c ? collectionProductIds(state, c) : []));
    }
    return collCache.get(cid).has(product.id);
  });
}

/** Split `amount` across weights proportionally (largest remainder); sums exactly to amount. */
export function allocate(amount, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (amount * w) / total);
  const out = raw.map(Math.floor);
  let rest = amount - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) out[order[k][1]]++;
  return out;
}

/**
 * Price a set of lines for a store. `lines` = [{variantId, quantity}].
 * `discount` is an already-resolved discount object (or null). Throws
 * DISCOUNT_INVALID if the discount's minimum requirement / eligibility fails.
 */
export function priceLines(state, store, lines, { discount = null, shippingMethod = 'standard' } = {}) {
  if (!Array.isArray(lines) || lines.length === 0) throw new ActionError('INVALID_PARAMS', 'lineItems must be a non-empty array');
  const merged = new Map();
  lines.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') throw new ActionError('INVALID_PARAMS', `lineItems[${i}] must be an object`);
    let v = raw.variantId ? byId(state, 'variants', raw.variantId) : raw.sku ? findVariantBySku(state, store.id, raw.sku) : null;
    if (!v) throw new ActionError('NOT_FOUND', `lineItems[${i}]: variant ${raw.variantId ?? raw.sku ?? '(missing)'} not found`);
    if (v.storeId !== store.id) throw new ActionError('WRONG_STORE', `variant ${v.id} belongs to ${v.storeId}, not ${store.id}`);
    const q = raw.quantity == null ? 1 : Number(raw.quantity);
    if (!Number.isInteger(q) || q <= 0) throw new ActionError('INVALID_PARAMS', `lineItems[${i}].quantity must be a positive integer`);
    merged.set(v.id, (merged.get(v.id) || 0) + q);
  });
  const out = [];
  for (const [variantId, quantity] of merged) {
    const v = byId(state, 'variants', variantId);
    const p = byId(state, 'products', v.productId);
    out.push({ variantId, productId: p.id, title: p.title, variantTitle: v.title, sku: v.sku, quantity, priceCents: v.priceCents, discountCents: 0, taxCents: 0 });
  }
  const subtotalCents = out.reduce((a, l) => a + l.priceCents * l.quantity, 0);
  if (!['standard', 'express', 'pickup'].includes(shippingMethod)) throw new ActionError('INVALID_PARAMS', 'shippingMethod must be standard, express or pickup');
  const shippingCents = shippingMethod === 'pickup' ? 0 : store.shipping[shippingMethod];
  let shippingDiscountCents = 0;
  if (discount) {
    const cache = new Map();
    const elig = out.map((l) => eligibleLine(state, discount, l, cache));
    const eligSub = out.reduce((a, l, i) => a + (elig[i] ? l.priceCents * l.quantity : 0), 0);
    const eligQty = out.reduce((a, l, i) => a + (elig[i] ? l.quantity : 0), 0);
    if (eligQty === 0) throw new ActionError('DISCOUNT_INVALID', `discount code ${discount.code} does not apply to any item in the cart`);
    if (discount.minType === 'subtotal' && eligSub < discount.minValue) throw new ActionError('DISCOUNT_INVALID', `discount code ${discount.code} requires a minimum purchase of ${discount.minValue} cents`);
    if (discount.minType === 'quantity' && eligQty < discount.minValue) throw new ActionError('DISCOUNT_INVALID', `discount code ${discount.code} requires at least ${discount.minValue} items`);
    if (discount.type === 'percentage') {
      out.forEach((l, i) => { if (elig[i]) l.discountCents = Math.round((l.priceCents * l.quantity * discount.value) / 100); });
    } else if (discount.type === 'fixed_amount') {
      const amt = Math.min(discount.value, eligSub);
      const parts = allocate(amt, out.map((l, i) => (elig[i] ? l.priceCents * l.quantity : 0)));
      out.forEach((l, i) => { l.discountCents = parts[i]; });
    } else if (discount.type === 'free_shipping') {
      if (shippingMethod === 'pickup') throw new ActionError('DISCOUNT_INVALID', `discount code ${discount.code} is a shipping discount and the order has no shipping`);
      shippingDiscountCents = shippingCents;
    }
  }
  for (const l of out) l.taxCents = Math.round((l.priceCents * l.quantity - l.discountCents) * store.taxRate);
  const discountCents = out.reduce((a, l) => a + l.discountCents, 0);
  const taxCents = out.reduce((a, l) => a + l.taxCents, 0);
  return {
    lines: out, subtotalCents, discountCents, shippingCents, shippingDiscountCents, taxCents,
    totalCents: subtotalCents - discountCents + shippingCents - shippingDiscountCents + taxCents,
    discountId: discount ? discount.id : null, discountCode: discount ? discount.code : null, shippingMethod,
  };
}

/** Pick the first location able to supply all deny-policy lines; null if none. */
export function chooseLocation(state, store, lines, preferredId) {
  const ok = (locId) => lines.every((l) => {
    const v = byId(state, 'variants', l.variantId);
    return v.inventoryPolicy === 'continue' || (v.inventory[locId] ?? 0) >= l.quantity;
  });
  if (preferredId) return ok(preferredId) ? preferredId : null;
  return store.locationIds.find(ok) ?? null;
}

// ---- inventory ---------------------------------------------------------------------
export function moveStock(state, variant, locationId, delta, reason, { refType = null, refId = null, note = '' } = {}) {
  variant.inventory[locationId] = (variant.inventory[locationId] ?? 0) + delta;
  const adj = {
    id: nextId(state, 'adjustment'), storeId: variant.storeId, variantId: variant.id, sku: variant.sku, locationId,
    delta, reason, refType, refId, note, availableAfter: variant.inventory[locationId], createdAt: nowStamp(state),
  };
  state.inventoryAdjustments.push(adj);
  return adj;
}

// ---- orders --------------------------------------------------------------------------
export const fulfillableQty = (li) => li.quantity - li.fulfilledQty - li.removedQty;

export function paymentTotals(txs) {
  let captured = 0;
  let refunded = 0;
  let authorized = 0;
  let voided = false;
  for (const t of txs) {
    if (t.status !== 'success') continue;
    if (t.kind === 'sale' || t.kind === 'capture') captured += t.amountCents;
    else if (t.kind === 'refund') refunded += t.amountCents;
    else if (t.kind === 'authorization') authorized += t.amountCents;
    else if (t.kind === 'void') voided = true;
  }
  const capturedFromAuth = txs.filter((t) => t.status === 'success' && t.kind === 'capture').reduce((a, t) => a + t.amountCents, 0);
  return { captured, refunded, authorized, voided, capturable: voided ? 0 : Math.max(0, authorized - capturedFromAuth) };
}

export function deriveFinancialStatus(order, txs) {
  const t = paymentTotals(txs);
  if (t.captured === 0) {
    if (t.voided) return 'voided';
    if (t.authorized > 0) return 'authorized';
    return order.totalCents === 0 ? 'paid' : 'pending';
  }
  if (t.refunded >= t.captured) return 'refunded';
  if (t.refunded > 0) return 'partially_refunded';
  if (t.captured < order.totalCents) return 'partially_paid';
  return 'paid';
}

export function deriveFulfillmentStatus(order) {
  const fulfilled = order.lineItems.reduce((a, l) => a + l.fulfilledQty, 0);
  const open = order.lineItems.reduce((a, l) => a + fulfillableQty(l), 0);
  if (fulfilled === 0) return 'unfulfilled';
  return open === 0 ? 'fulfilled' : 'partial';
}

export const orderTransactions = (state, orderId) => state.transactions.filter((t) => t.orderId === orderId);

export function recomputeOrder(state, order) {
  order.financialStatus = deriveFinancialStatus(order, orderTransactions(state, order.id));
  order.fulfillmentStatus = deriveFulfillmentStatus(order);
  return order;
}

/** Amount (subtotal and tax parts) to refund for `qty` more units of a line. Telescopes exactly. */
export function lineRefundAmounts(li, qty) {
  const net = li.priceCents * li.quantity - li.discountCents;
  const r = li.refundedQty;
  const part = (x, n) => Math.round((x * n) / li.quantity);
  return {
    subtotalCents: part(net, r + qty) - part(net, r),
    taxCents: part(li.taxCents, r + qty) - part(li.taxCents, r),
  };
}

export const refundsOf = (state, orderId) => state.refunds.filter((r) => r.orderId === orderId);

export function refundedShipping(state, orderId) {
  return refundsOf(state, orderId).reduce((a, r) => a + r.shippingCents, 0);
}

export function addTransaction(state, order, kind, amountCents, { gateway, parentId = null, at } = {}) {
  const t = {
    id: nextId(state, 'transaction'), orderId: order.id, storeId: order.storeId, kind, status: 'success', amountCents,
    gateway: gateway || order.gateway, parentId, createdAt: at || nowStamp(state),
  };
  state.transactions.push(t);
  return t;
}

export function customerName(c) {
  return c ? `${c.firstName} ${c.lastName}`.trim() : '';
}

export function emptyState(seed) {
  return {
    meta: { schema: 1, product: 'Cartwright', seed, today: TODAY, time: NOW_TIME, counters: {} },
    stores: [],
    locations: [],
    products: [],
    variants: [],
    collections: [],
    customers: [],
    orders: [],
    transactions: [],
    fulfillments: [],
    refunds: [],
    returns: [],
    discounts: [],
    carts: [],
    inventoryAdjustments: [],
    actionLog: [],
  };
}

export { dateOf };
