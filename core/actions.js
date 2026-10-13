// State-mutating actions. Every action validates fully before mutating, so a
// failed action leaves state untouched. The same registry backs the SPA, the
// window.cartwright API and the REST server.
import {
  PRODUCT_STATUSES, CANCEL_REASONS, REFUND_REASONS, RETURN_REASONS, ADJUST_REASONS, DISCOUNT_TYPES, DISCOUNT_SCOPES,
  MIN_REQUIREMENTS, SMART_COLUMNS, SMART_RELATIONS, SHIPPING_METHODS, CARRIERS, TRACKING_URL,
} from './catalog.js';
import { isDate, normTags, slugify, fmtMoney } from './util.js';
import {
  ActionError, nextId, byId, mustGet, mustStore, nowStamp, variantTitleOf, findVariantBySku, findDiscountByCode,
  resolveDiscount, priceLines, chooseLocation, moveStock, fulfillableQty, paymentTotals, recomputeOrder,
  orderTransactions, lineRefundAmounts, refundedShipping, addTransaction, discountStatus,
} from './model.js';

// ---- small validators -------------------------------------------------------
const str = (v, name, { required = false, max = 500 } = {}) => {
  if (v == null || v === '') {
    if (required) throw new ActionError('INVALID_PARAMS', `${name} is required`);
    return null;
  }
  if (typeof v !== 'string') throw new ActionError('INVALID_PARAMS', `${name} must be a string`);
  const t = v.trim();
  if (required && !t) throw new ActionError('INVALID_PARAMS', `${name} is required`);
  if (t.length > max) throw new ActionError('INVALID_PARAMS', `${name} is too long`);
  return t;
};
const oneOf = (v, list, name, dflt) => {
  if (v == null || v === '') {
    if (dflt !== undefined) return dflt;
    throw new ActionError('INVALID_PARAMS', `${name} is required (one of ${list.join(', ')})`);
  }
  if (!list.includes(v)) throw new ActionError('INVALID_PARAMS', `${name} must be one of ${list.join(', ')}`);
  return v;
};
const int = (v, name, { min = -Infinity, max = Infinity, required = true, dflt } = {}) => {
  if (v == null || v === '') {
    if (!required || dflt !== undefined) return dflt ?? null;
    throw new ActionError('INVALID_PARAMS', `${name} is required`);
  }
  const n = typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v) : v;
  if (!Number.isInteger(n)) throw new ActionError('INVALID_PARAMS', `${name} must be an integer`);
  if (n < min || n > max) throw new ActionError('INVALID_PARAMS', `${name} must be between ${min} and ${max}`);
  return n;
};
const cents = (v, name, opts = {}) => int(v, name, { min: 0, ...opts });
const bool = (v, dflt = false) => (v == null || v === '' ? dflt : v === true || v === 'true' || v === 1 || v === '1');
const tagsOf = (v, name = 'tags') => {
  if (v == null) return [];
  if (!Array.isArray(v) && typeof v !== 'string') throw new ActionError('INVALID_PARAMS', `${name} must be an array of strings or a comma-separated string`);
  return normTags(v);
};
const ids = (v, name) => {
  if (v == null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new ActionError('INVALID_PARAMS', `${name} must be an array of ids`);
  return [...new Set(v)];
};

function storeLocation(state, store, locationId, name = 'locationId') {
  const loc = mustGet(state, 'locations', locationId, name.replace(/Id$/, ''));
  if (loc.storeId !== store.id) throw new ActionError('WRONG_STORE', `location ${loc.id} belongs to ${loc.storeId}, not ${store.id}`);
  return loc;
}

/** Resolve a variant by variantId, or by storeId + sku. */
function resolveVariant(state, p) {
  if (p.variantId) return mustGet(state, 'variants', p.variantId, 'variant');
  if (p.sku && p.storeId) {
    const v = findVariantBySku(state, p.storeId, p.sku);
    if (!v) throw new ActionError('NOT_FOUND', `no variant with SKU ${p.sku} in ${p.storeId}`);
    return v;
  }
  throw new ActionError('INVALID_PARAMS', 'variantId (or storeId + sku) is required');
}

function checkSku(state, storeId, sku, exceptId) {
  if (!sku) return;
  const other = findVariantBySku(state, storeId, sku);
  if (other && other.id !== exceptId) throw new ActionError('DUPLICATE', `SKU ${sku} is already used by ${other.id}`);
}

function inventoryInput(state, store, inv) {
  if (inv == null) return {};
  if (typeof inv !== 'object' || Array.isArray(inv)) throw new ActionError('INVALID_PARAMS', 'inventory must be an object {locationId: quantity}');
  const out = {};
  for (const [locId, q] of Object.entries(inv)) {
    storeLocation(state, store, locId);
    out[locId] = int(q, `inventory.${locId}`, { min: 0 });
  }
  return out;
}

function variantInput(state, store, product, raw, i, { skus }) {
  if (!raw || typeof raw !== 'object') throw new ActionError('INVALID_PARAMS', `variants[${i}] must be an object`);
  const opts = raw.options == null ? [] : raw.options;
  if (!Array.isArray(opts) || opts.length !== product.options.length) throw new ActionError('INVALID_PARAMS', `variants[${i}].options must list one value per product option (${product.options.map((o) => o.name).join(', ') || 'none'})`);
  const options = opts.map((o, k) => {
    const v = str(String(o ?? ''), `variants[${i}].options[${k}]`, { required: true, max: 100 });
    return v;
  });
  const sku = str(raw.sku, `variants[${i}].sku`, { max: 64 });
  if (sku) {
    if (skus.has(sku.toLowerCase())) throw new ActionError('DUPLICATE', `SKU ${sku} appears twice`);
    skus.add(sku.toLowerCase());
    checkSku(state, store.id, sku, null);
  }
  const priceCents = cents(raw.priceCents, `variants[${i}].priceCents`);
  const compareAtCents = raw.compareAtCents == null ? null : cents(raw.compareAtCents, `variants[${i}].compareAtCents`);
  return {
    options, sku: sku || '', priceCents, compareAtCents,
    weightGrams: int(raw.weightGrams, `variants[${i}].weightGrams`, { min: 0, dflt: 0 }),
    inventoryPolicy: oneOf(raw.inventoryPolicy, ['deny', 'continue'], `variants[${i}].inventoryPolicy`, 'deny'),
    inventory: inventoryInput(state, store, raw.inventory),
  };
}

function pushVariant(state, store, product, vin) {
  const key = vin.options.join('\u0000').toLowerCase();
  for (const vid of product.variantIds) {
    const o = byId(state, 'variants', vid);
    if (o.options.join('\u0000').toLowerCase() === key) throw new ActionError('DUPLICATE', `variant ${variantTitleOf(vin.options)} already exists on ${product.id}`);
  }
  vin.options.forEach((val, k) => {
    const opt = product.options[k];
    if (!opt.values.some((x) => x.toLowerCase() === val.toLowerCase())) opt.values.push(val);
  });
  const v = {
    id: nextId(state, 'variant'), productId: product.id, storeId: store.id, title: variantTitleOf(vin.options), options: vin.options, sku: vin.sku,
    priceCents: vin.priceCents, compareAtCents: vin.compareAtCents, weightGrams: vin.weightGrams, inventoryPolicy: vin.inventoryPolicy, inventory: {},
  };
  for (const locId of store.locationIds) v.inventory[locId] = 0;
  state.variants.push(v);
  product.variantIds.push(v.id);
  for (const [locId, q] of Object.entries(vin.inventory)) if (q) moveStock(state, v, locId, q, 'received', { refType: 'product', refId: product.id, note: 'initial quantity' });
  return v;
}

// ---- customers ------------------------------------------------------------------
function addressInput(raw, name = 'address') {
  if (!raw || typeof raw !== 'object') throw new ActionError('INVALID_PARAMS', `${name} must be an object`);
  return {
    address1: str(raw.address1, `${name}.address1`, { required: true }),
    city: str(raw.city, `${name}.city`, { required: true }),
    province: str(raw.province, `${name}.province`) || '',
    zip: str(raw.zip, `${name}.zip`) || '',
    country: str(raw.country, `${name}.country`) || 'US',
  };
}

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function emailOf(v, required = true) {
  const e = str(v, 'email', { required, max: 200 });
  if (e && !emailRe.test(e)) throw new ActionError('INVALID_PARAMS', `email ${e} is not a valid address`);
  return e ? e.toLowerCase() : null;
}
const customerByEmail = (state, storeId, email) => state.customers.find((c) => c.storeId === storeId && c.email === String(email).toLowerCase());

function makeCustomer(state, store, { firstName, lastName, email, phone = '', tags = [], acceptsMarketing = false, note = '', address = null }) {
  if (customerByEmail(state, store.id, email)) throw new ActionError('DUPLICATE', `a customer with email ${email} already exists in ${store.id}`);
  const c = {
    id: nextId(state, 'customer'), storeId: store.id, firstName: firstName || '', lastName: lastName || '', email, phone: phone || '',
    acceptsMarketing, tags, note: note || '', addresses: [], state: 'enabled', createdAt: nowStamp(state),
  };
  if (address) c.addresses.push({ id: nextId(state, 'address'), firstName: c.firstName, lastName: c.lastName, ...address, isDefault: true });
  state.customers.push(c);
  return c;
}

// ---- orders ------------------------------------------------------------------------
function shipTo(customer, address, name) {
  if (address) return { name: name || `${customer?.firstName ?? ''} ${customer?.lastName ?? ''}`.trim(), ...address };
  const def = customer?.addresses.find((a) => a.isDefault);
  if (!def) return null;
  return { name: `${def.firstName} ${def.lastName}`.trim(), address1: def.address1, city: def.city, province: def.province, zip: def.zip, country: def.country };
}

/** Shared by createOrder and checkout. Validates, then mutates. */
function placeOrder(state, store, o) {
  const pricing = priceLines(state, store, o.lines, { discount: o.discount, shippingMethod: o.shippingMethod });
  for (const l of pricing.lines) {
    const p = byId(state, 'products', l.productId);
    if (p.status !== 'active' && o.source === 'online_store') throw new ActionError('UNAVAILABLE', `product ${p.title} is not available on the storefront (${p.status})`);
    if (p.status === 'archived') throw new ActionError('UNAVAILABLE', `product ${p.title} is archived`);
  }
  const locationId = chooseLocation(state, store, pricing.lines, o.locationId);
  if (!locationId) {
    const short = pricing.lines.find((l) => byId(state, 'variants', l.variantId).inventoryPolicy === 'deny');
    throw new ActionError('OUT_OF_STOCK', o.locationId
      ? `location ${o.locationId} does not have enough stock for every item`
      : `no single location has enough stock for every item${short ? ` (check ${short.sku || short.variantId})` : ''}`);
  }
  const shippingAddress = o.shippingMethod === 'pickup' ? null : o.shippingAddress;
  if (o.shippingMethod !== 'pickup' && !shippingAddress) throw new ActionError('INVALID_PARAMS', 'shippingAddress is required (customer has no default address)');
  // ---- mutate
  let customer = o.customer;
  if (!customer && o.newCustomer) customer = makeCustomer(state, store, o.newCustomer);
  const number = store.nextOrderNumber++;
  const order = {
    id: nextId(state, 'order'), storeId: store.id, number, name: `#${number}`, customerId: customer ? customer.id : null,
    email: o.email || customer?.email || '', createdAt: nowStamp(state),
    lineItems: pricing.lines.map((l) => ({ id: nextId(state, 'lineItem'), ...l, fulfilledQty: 0, refundedQty: 0, removedQty: 0 })),
    subtotalCents: pricing.subtotalCents, discountCents: pricing.discountCents, shippingCents: pricing.shippingCents,
    shippingDiscountCents: pricing.shippingDiscountCents, taxCents: pricing.taxCents, totalCents: pricing.totalCents,
    discountId: pricing.discountId, discountCode: pricing.discountCode, shippingMethod: o.shippingMethod, shippingAddress, locationId,
    gateway: o.payment === 'pending' ? 'manual' : o.gateway || 'card', source: o.source,
    status: 'open', closedAt: null, cancelledAt: null, cancelReason: null, financialStatus: 'pending', fulfillmentStatus: 'unfulfilled',
    tags: o.tags || [], note: o.note || '',
  };
  state.orders.push(order);
  for (const li of order.lineItems) moveStock(state, byId(state, 'variants', li.variantId), locationId, -li.quantity, 'sold', { refType: 'order', refId: order.id });
  if (o.discount) o.discount.usageCount++;
  if (order.totalCents > 0) {
    if (o.payment === 'paid') addTransaction(state, order, 'sale', order.totalCents);
    else if (o.payment === 'authorized') addTransaction(state, order, 'authorization', order.totalCents);
  }
  recomputeOrder(state, order);
  return order;
}

function openOrder(state, orderId) {
  const order = mustGet(state, 'orders', orderId, 'order');
  if (order.status === 'cancelled') throw new ActionError('ORDER_CANCELLED', `order ${order.name} (${order.id}) is cancelled`);
  return order;
}

function returnedQty(state, lineItemId, exceptReturnId) {
  let n = 0;
  for (const r of state.returns) {
    if (r.id === exceptReturnId || !['requested', 'open', 'closed'].includes(r.status)) continue;
    for (const l of r.lineItems) if (l.lineItemId === lineItemId) n += l.quantity;
  }
  return n;
}

/**
 * Validate and perform a refund. lineItems: [{lineItemId, quantity, restock, locationId}].
 * Returns the refund record.
 */
function doRefund(state, order, p, { returnId = null } = {}) {
  const raw = p.lineItems == null ? [] : p.lineItems;
  if (!Array.isArray(raw)) throw new ActionError('INVALID_PARAMS', 'lineItems must be an array');
  const seen = new Set();
  const lines = raw.map((x, i) => {
    if (!x || typeof x !== 'object') throw new ActionError('INVALID_PARAMS', `lineItems[${i}] must be an object`);
    const li = order.lineItems.find((l) => l.id === x.lineItemId);
    if (!li) throw new ActionError('NOT_FOUND', `lineItems[${i}]: line item ${x.lineItemId} is not on order ${order.id}`);
    if (seen.has(li.id)) throw new ActionError('INVALID_PARAMS', `line item ${li.id} listed twice`);
    seen.add(li.id);
    const quantity = int(x.quantity, `lineItems[${i}].quantity`, { min: 1 });
    if (quantity > li.quantity - li.refundedQty) throw new ActionError('INVALID_QUANTITY', `only ${li.quantity - li.refundedQty} unit(s) of ${li.sku || li.id} can still be refunded`);
    const restock = bool(x.restock, false);
    let locationId = null;
    if (restock) locationId = storeLocation(state, byId(state, 'stores', order.storeId), x.locationId || p.locationId || order.locationId).id;
    return { li, quantity, restock, locationId, ...lineRefundAmounts(li, quantity) };
  });
  const shipLeft = order.shippingCents - order.shippingDiscountCents - refundedShipping(state, order.id);
  let shippingCents = 0;
  if (p.refundShipping === true || p.refundShipping === 'true') shippingCents = shipLeft;
  else if (p.shippingCents != null) {
    shippingCents = cents(p.shippingCents, 'shippingCents');
    if (shippingCents > shipLeft) throw new ActionError('INVALID_AMOUNT', `only ${fmtMoney(shipLeft)} of shipping can still be refunded`);
  }
  const computed = lines.reduce((a, l) => a + l.subtotalCents + l.taxCents, 0) + shippingCents;
  const pay = paymentTotals(orderTransactions(state, order.id));
  const refundable = pay.captured - pay.refunded;
  let amountCents = p.amountCents == null ? computed : cents(p.amountCents, 'amountCents');
  if (p.amountCents == null && computed > refundable) {
    if (refundable === 0) amountCents = 0; // nothing was paid: items are removed/restocked without money moving
    else throw new ActionError('INVALID_AMOUNT', `refund of ${fmtMoney(computed)} exceeds the ${fmtMoney(refundable)} still refundable; pass amountCents explicitly`);
  }
  if (amountCents > refundable) throw new ActionError('INVALID_AMOUNT', `refund of ${fmtMoney(amountCents)} exceeds the ${fmtMoney(refundable)} still refundable`);
  if (lines.length === 0 && amountCents === 0 && shippingCents === 0) throw new ActionError('INVALID_PARAMS', 'nothing to refund: give lineItems, refundShipping/shippingCents or amountCents');
  const reason = oneOf(p.reason, REFUND_REASONS, 'reason', returnId ? 'customer_request' : 'other');
  // ---- mutate
  const t = amountCents > 0 ? addTransaction(state, order, 'refund', amountCents) : null;
  const refund = {
    id: nextId(state, 'refund'), orderId: order.id, storeId: order.storeId, createdAt: nowStamp(state), reason, note: str(p.note, 'note', { max: 2000 }) || '',
    lineItems: lines.map((l) => ({ lineItemId: l.li.id, quantity: l.quantity, restock: l.restock, locationId: l.locationId, subtotalCents: l.subtotalCents, taxCents: l.taxCents })),
    shippingCents, amountCents, transactionId: t ? t.id : null, returnId,
  };
  for (const l of lines) {
    const removable = Math.min(l.quantity, fulfillableQty(l.li));
    l.li.refundedQty += l.quantity;
    l.li.removedQty += removable;
    if (l.restock) moveStock(state, byId(state, 'variants', l.li.variantId), l.locationId, l.quantity, 'restock', { refType: 'refund', refId: refund.id });
  }
  state.refunds.push(refund);
  recomputeOrder(state, order);
  return refund;
}

function returnLines(state, order, raw, exceptReturnId) {
  if (!Array.isArray(raw) || raw.length === 0) throw new ActionError('INVALID_PARAMS', 'lineItems must be a non-empty array');
  const seen = new Set();
  return raw.map((x, i) => {
    const li = order.lineItems.find((l) => l.id === x?.lineItemId);
    if (!li) throw new ActionError('NOT_FOUND', `lineItems[${i}]: line item ${x?.lineItemId} is not on order ${order.id}`);
    if (seen.has(li.id)) throw new ActionError('INVALID_PARAMS', `line item ${li.id} listed twice`);
    seen.add(li.id);
    const quantity = int(x.quantity, `lineItems[${i}].quantity`, { min: 1, dflt: 1 });
    const can = li.fulfilledQty - returnedQty(state, li.id, exceptReturnId);
    if (quantity > can) throw new ActionError('INVALID_QUANTITY', `only ${Math.max(0, can)} fulfilled unit(s) of ${li.sku || li.id} can be returned`);
    return { lineItemId: li.id, quantity, reason: oneOf(x.reason, RETURN_REASONS, `lineItems[${i}].reason`, 'other') };
  });
}

const mustReturn = (state, id) => mustGet(state, 'returns', id, 'return');

// ---- discounts --------------------------------------------------------------------
const codeRe = /^[A-Za-z0-9_-]{3,32}$/;
function discountFields(state, store, p, base) {
  const type = base ? base.type : oneOf(p.type, DISCOUNT_TYPES, 'type');
  const out = {};
  if (!base || p.value != null) {
    if (type === 'percentage') out.value = int(p.value, 'value', { min: 1, max: 100 });
    else if (type === 'fixed_amount') out.value = int(p.value, 'value (cents)', { min: 1 });
    else out.value = 0;
  }
  if (!base || p.scope != null || p.collectionIds != null || p.productIds != null) {
    const scope = type === 'free_shipping' ? 'all' : oneOf(p.scope ?? base?.scope, DISCOUNT_SCOPES, 'scope', 'all');
    out.scope = scope;
    out.collectionIds = scope === 'collections' ? ids(p.collectionIds ?? base?.collectionIds, 'collectionIds') : [];
    out.productIds = scope === 'products' ? ids(p.productIds ?? base?.productIds, 'productIds') : [];
    for (const cid of out.collectionIds) { const c = mustGet(state, 'collections', cid, 'collection'); if (c.storeId !== store.id) throw new ActionError('WRONG_STORE', `collection ${cid} is not in ${store.id}`); }
    for (const pid of out.productIds) { const pr = mustGet(state, 'products', pid, 'product'); if (pr.storeId !== store.id) throw new ActionError('WRONG_STORE', `product ${pid} is not in ${store.id}`); }
    if (scope === 'collections' && !out.collectionIds.length) throw new ActionError('INVALID_PARAMS', 'collectionIds is required when scope is collections');
    if (scope === 'products' && !out.productIds.length) throw new ActionError('INVALID_PARAMS', 'productIds is required when scope is products');
  }
  if (!base || p.minType != null || p.minValue != null) {
    out.minType = oneOf(p.minType ?? base?.minType, MIN_REQUIREMENTS, 'minType', 'none');
    out.minValue = out.minType === 'none' ? 0 : int(p.minValue ?? (p.minType == null ? base?.minValue : undefined), out.minType === 'subtotal' ? 'minValue (cents)' : 'minValue (items)', { min: 1 });
  }
  if (!base || 'usageLimit' in p) out.usageLimit = p.usageLimit == null || p.usageLimit === '' ? null : int(p.usageLimit, 'usageLimit', { min: 1 });
  if (!base || p.oncePerCustomer != null) out.oncePerCustomer = bool(p.oncePerCustomer, false);
  if (!base || p.startsAt != null) {
    out.startsAt = p.startsAt == null || p.startsAt === '' ? state.meta.today : p.startsAt;
    if (!isDate(out.startsAt)) throw new ActionError('INVALID_PARAMS', 'startsAt must be YYYY-MM-DD');
  }
  if (!base || 'endsAt' in p) {
    out.endsAt = p.endsAt == null || p.endsAt === '' ? null : p.endsAt;
    if (out.endsAt && !isDate(out.endsAt)) throw new ActionError('INVALID_PARAMS', 'endsAt must be YYYY-MM-DD');
  }
  const starts = out.startsAt ?? base?.startsAt;
  const ends = 'endsAt' in out ? out.endsAt : base?.endsAt;
  if (ends && starts && ends < starts) throw new ActionError('INVALID_PARAMS', 'endsAt must not be before startsAt');
  if (p.title != null) out.title = str(p.title, 'title', { required: true, max: 200 });
  return out;
}

// ---- carts ---------------------------------------------------------------------------
function openCart(state, cartId) {
  const cart = mustGet(state, 'carts', cartId, 'cart');
  if (cart.status !== 'open') throw new ActionError('CART_CLOSED', `cart ${cart.id} is ${cart.status}`);
  return cart;
}
function cartVariant(state, cart, p) {
  const v = resolveVariant(state, { ...p, storeId: cart.storeId });
  if (v.storeId !== cart.storeId) throw new ActionError('WRONG_STORE', `variant ${v.id} is not sold by ${cart.storeId}`);
  const prod = byId(state, 'products', v.productId);
  if (prod.status !== 'active') throw new ActionError('UNAVAILABLE', `product ${prod.title} is not available (${prod.status})`);
  return v;
}
function checkCartStock(state, v, qty) {
  if (v.inventoryPolicy === 'deny') {
    const best = Math.max(0, ...Object.values(v.inventory));
    if (qty > best) throw new ActionError('OUT_OF_STOCK', `only ${best} of ${v.sku || v.id} available`);
  }
}

// ---- action registry ---------------------------------------------------------
// params: [name, type, required, description]
export const ACTIONS = {
  // ---------------- products & variants
  createProduct: {
    description: 'Create a product with options and variants (or a single default variant).',
    params: [
      ['storeId', 'string', true, 'Store (STO-1..STO-3)'],
      ['title', 'string', true, 'Product title'],
      ['vendor', 'string', false, 'Vendor / brand'],
      ['productType', 'string', false, 'Product type'],
      ['tags', 'string[]', false, 'Tags'],
      ['status', 'active|draft|archived', false, 'Default active'],
      ['description', 'string', false, 'Description'],
      ['options', '{name, values[]}[]', false, 'Up to 3 options, e.g. [{name:"Size", values:["S","M"]}]'],
      ['variants', '{options[], sku, priceCents, compareAtCents, inventoryPolicy, weightGrams, inventory{locationId:qty}}[]', false, 'Explicit variants; omitted = one variant per option combination using the top-level price/sku/inventory'],
      ['priceCents', 'integer', false, 'Price for generated/default variants'],
      ['compareAtCents', 'integer', false, 'Compare-at price for generated/default variants'],
      ['sku', 'string', false, 'SKU of the default variant (no options)'],
      ['inventory', '{locationId: qty}', false, 'Initial stock for generated/default variants'],
    ],
    run(state, p) {
      const store = mustStore(state, p.storeId);
      const title = str(p.title, 'title', { required: true, max: 200 });
      const status = oneOf(p.status, PRODUCT_STATUSES, 'status', 'active');
      const optsRaw = p.options == null ? [] : p.options;
      if (!Array.isArray(optsRaw) || optsRaw.length > 3) throw new ActionError('INVALID_PARAMS', 'options must be an array of at most 3 {name, values}');
      const options = optsRaw.map((o, i) => {
        const name = str(o?.name, `options[${i}].name`, { required: true, max: 60 });
        const values = Array.isArray(o?.values) ? normTags(o.values) : [];
        if (!values.length && !p.variants) throw new ActionError('INVALID_PARAMS', `options[${i}].values must be a non-empty array`);
        return { name, values };
      });
      if (new Set(options.map((o) => o.name.toLowerCase())).size !== options.length) throw new ActionError('INVALID_PARAMS', 'option names must be unique');
      const product = {
        id: null, storeId: store.id, title, handle: slugify(title), vendor: str(p.vendor, 'vendor') || store.name, productType: str(p.productType, 'productType') || '',
        tags: tagsOf(p.tags), status, description: str(p.description, 'description', { max: 5000 }) || '', options, variantIds: [], createdAt: nowStamp(state),
      };
      let rawVariants = p.variants;
      if (rawVariants == null) {
        let combos = [[]];
        for (const o of options) combos = combos.flatMap((c) => o.values.map((v) => [...c, v]));
        if (combos.length > 100) throw new ActionError('INVALID_PARAMS', 'too many variant combinations (max 100)');
        rawVariants = combos.map((c) => ({ options: c, sku: options.length ? null : p.sku, priceCents: p.priceCents, compareAtCents: p.compareAtCents, inventory: p.inventory, inventoryPolicy: p.inventoryPolicy }));
      }
      if (!Array.isArray(rawVariants) || rawVariants.length === 0) throw new ActionError('INVALID_PARAMS', 'variants must be a non-empty array');
      const skus = new Set();
      const vins = rawVariants.map((v, i) => variantInput(state, store, product, v, i, { skus }));
      const keys = new Set(vins.map((v) => v.options.join('\u0000').toLowerCase()));
      if (keys.size !== vins.length) throw new ActionError('DUPLICATE', 'two variants have the same option values');
      if (state.products.some((x) => x.storeId === store.id && x.handle === product.handle)) product.handle = `${product.handle}-${(state.meta.counters.product || 0) + 1}`;
      product.id = nextId(state, 'product');
      state.products.push(product);
      const variants = vins.map((v) => pushVariant(state, store, product, v));
      return { product, variants };
    },
  },
  updateProduct: {
    description: 'Update product fields (title, vendor, type, tags, status, description).',
    params: [
      ['productId', 'string', true, 'Product id'],
      ['title', 'string', false, ''], ['vendor', 'string', false, ''], ['productType', 'string', false, ''],
      ['tags', 'string[]', false, 'Replaces all tags'], ['status', 'active|draft|archived', false, ''], ['description', 'string', false, ''],
    ],
    run(state, p) {
      const product = mustGet(state, 'products', p.productId, 'product');
      const patch = {};
      if (p.title != null) patch.title = str(p.title, 'title', { required: true, max: 200 });
      if (p.vendor != null) patch.vendor = str(p.vendor, 'vendor') || '';
      if (p.productType != null) patch.productType = str(p.productType, 'productType') || '';
      if (p.tags != null) patch.tags = tagsOf(p.tags);
      if (p.status != null) patch.status = oneOf(p.status, PRODUCT_STATUSES, 'status');
      if (p.description != null) patch.description = str(p.description, 'description', { max: 5000 }) || '';
      Object.assign(product, patch);
      return { product };
    },
  },
  addVariant: {
    description: 'Add a variant to a product (new option values are appended to the option).',
    params: [
      ['productId', 'string', true, 'Product id'],
      ['options', 'string[]', true, 'One value per product option'],
      ['priceCents', 'integer', true, 'Price in cents'],
      ['compareAtCents', 'integer', false, 'Compare-at price in cents'],
      ['sku', 'string', false, 'SKU (unique within the store)'],
      ['inventoryPolicy', 'deny|continue', false, 'Sell when out of stock? default deny'],
      ['weightGrams', 'integer', false, ''],
      ['inventory', '{locationId: qty}', false, 'Initial stock'],
    ],
    run(state, p) {
      const product = mustGet(state, 'products', p.productId, 'product');
      if (!product.options.length) throw new ActionError('NO_OPTIONS', `product ${product.id} has no options; it can only have its default variant`);
      const store = byId(state, 'stores', product.storeId);
      const vin = variantInput(state, store, product, p, 0, { skus: new Set() });
      const variant = pushVariant(state, store, product, vin);
      return { variant };
    },
  },
  updateVariant: {
    description: 'Update a variant: price, compare-at price (null clears), SKU, inventory policy, weight.',
    params: [
      ['variantId', 'string', true, 'Variant id (or storeId + sku)'],
      ['priceCents', 'integer', false, ''], ['compareAtCents', 'integer|null', false, 'null removes the compare-at price'],
      ['sku', 'string', false, ''], ['inventoryPolicy', 'deny|continue', false, ''], ['weightGrams', 'integer', false, ''],
    ],
    run(state, p) {
      const v = resolveVariant(state, p);
      const patch = {};
      if (p.priceCents != null) patch.priceCents = cents(p.priceCents, 'priceCents');
      if ('compareAtCents' in p) patch.compareAtCents = p.compareAtCents == null || p.compareAtCents === '' ? null : cents(p.compareAtCents, 'compareAtCents');
      if (p.sku != null && p.variantId) { patch.sku = str(p.sku, 'sku', { max: 64 }) || ''; checkSku(state, v.storeId, patch.sku, v.id); }
      if (p.inventoryPolicy != null) patch.inventoryPolicy = oneOf(p.inventoryPolicy, ['deny', 'continue'], 'inventoryPolicy');
      if (p.weightGrams != null) patch.weightGrams = int(p.weightGrams, 'weightGrams', { min: 0 });
      if (patch.inventoryPolicy === 'deny' && Object.values(v.inventory).some((q) => q < 0)) throw new ActionError('NEGATIVE_INVENTORY', 'set stock to zero or more at every location before switching to deny');
      Object.assign(v, patch);
      return { variant: v };
    },
  },

  // ---------------- inventory
  adjustInventory: {
    description: 'Adjust available stock of a variant at a location by a delta (+received / -damaged ...).',
    params: [
      ['variantId', 'string', true, 'Variant id (or storeId + sku)'],
      ['locationId', 'string', true, 'Location id'],
      ['delta', 'integer', true, 'Change in available quantity (non-zero)'],
      ['reason', ADJUST_REASONS.join('|'), false, 'Default correction'],
      ['note', 'string', false, ''],
    ],
    run(state, p) {
      const v = resolveVariant(state, p);
      const loc = storeLocation(state, byId(state, 'stores', v.storeId), p.locationId);
      const delta = int(p.delta, 'delta');
      if (delta === 0) throw new ActionError('INVALID_PARAMS', 'delta must be non-zero');
      const reason = oneOf(p.reason, ADJUST_REASONS, 'reason', 'correction');
      const after = (v.inventory[loc.id] ?? 0) + delta;
      if (after < 0 && v.inventoryPolicy === 'deny') throw new ActionError('NEGATIVE_INVENTORY', `${v.sku || v.id} would have ${after} available at ${loc.id}`);
      const adjustment = moveStock(state, v, loc.id, delta, reason, { note: str(p.note, 'note') || '' });
      return { adjustment, available: v.inventory[loc.id] };
    },
  },
  setInventory: {
    description: 'Set the available quantity of a variant at a location (e.g. after a count).',
    params: [
      ['variantId', 'string', true, 'Variant id (or storeId + sku)'],
      ['locationId', 'string', true, 'Location id'],
      ['quantity', 'integer', true, 'New available quantity (>= 0)'],
      ['reason', ADJUST_REASONS.join('|'), false, 'Default cycle_count'],
    ],
    run(state, p) {
      const v = resolveVariant(state, p);
      const loc = storeLocation(state, byId(state, 'stores', v.storeId), p.locationId);
      const q = int(p.quantity, 'quantity', { min: 0 });
      const reason = oneOf(p.reason, ADJUST_REASONS, 'reason', 'cycle_count');
      const delta = q - (v.inventory[loc.id] ?? 0);
      const adjustment = delta ? moveStock(state, v, loc.id, delta, reason) : null;
      return { adjustment, available: v.inventory[loc.id] };
    },
  },
  transferInventory: {
    description: 'Move stock of a variant from one location to another in the same store.',
    params: [
      ['variantId', 'string', true, 'Variant id (or storeId + sku)'],
      ['fromLocationId', 'string', true, ''], ['toLocationId', 'string', true, ''], ['quantity', 'integer', true, 'Units to move (> 0)'],
    ],
    run(state, p) {
      const v = resolveVariant(state, p);
      const store = byId(state, 'stores', v.storeId);
      const from = storeLocation(state, store, p.fromLocationId, 'fromLocationId');
      const to = storeLocation(state, store, p.toLocationId, 'toLocationId');
      if (from.id === to.id) throw new ActionError('INVALID_PARAMS', 'fromLocationId and toLocationId must differ');
      const q = int(p.quantity, 'quantity', { min: 1 });
      if ((v.inventory[from.id] ?? 0) < q) throw new ActionError('INSUFFICIENT_STOCK', `only ${v.inventory[from.id] ?? 0} of ${v.sku || v.id} at ${from.id}`);
      const note = `transfer ${from.id} -> ${to.id}`;
      moveStock(state, v, from.id, -q, 'transfer', { note });
      moveStock(state, v, to.id, q, 'transfer', { note });
      return { variantId: v.id, inventory: v.inventory };
    },
  },

  // ---------------- collections
  createCollection: {
    description: 'Create a manual collection (fixed product list) or a smart collection (rules).',
    params: [
      ['storeId', 'string', true, ''], ['title', 'string', true, ''], ['type', 'manual|smart', true, ''],
      ['productIds', 'string[]', false, 'Manual collections: products to include'],
      ['rules', '{column, relation, condition}[]', false, `Smart collections. column: ${SMART_COLUMNS.join(', ')}; relation: ${SMART_RELATIONS.join(', ')}; prices are decimal dollars ("30.00")`],
      ['disjunctive', 'boolean', false, 'Smart: true = match ANY rule, false (default) = match ALL'],
      ['description', 'string', false, ''],
    ],
    run(state, p) {
      const store = mustStore(state, p.storeId);
      const title = str(p.title, 'title', { required: true, max: 200 });
      const handle = slugify(title);
      if (state.collections.some((c) => c.storeId === store.id && c.handle === handle)) throw new ActionError('DUPLICATE', `a collection with handle ${handle} already exists`);
      const type = oneOf(p.type, ['manual', 'smart'], 'type');
      const c = { id: null, storeId: store.id, title, handle, type, productIds: [], rules: [], disjunctive: false, description: str(p.description, 'description') || '' };
      if (type === 'manual') c.productIds = productList(state, store, p.productIds);
      else { c.rules = rulesOf(p.rules); c.disjunctive = bool(p.disjunctive, false); }
      c.id = nextId(state, 'collection');
      state.collections.push(c);
      return { collection: c };
    },
  },
  updateCollection: {
    description: 'Update a collection title/description; for smart collections also rules and match mode.',
    params: [['collectionId', 'string', true, ''], ['title', 'string', false, ''], ['description', 'string', false, ''], ['rules', 'rule[]', false, 'Smart only'], ['disjunctive', 'boolean', false, 'Smart only']],
    run(state, p) {
      const c = mustGet(state, 'collections', p.collectionId, 'collection');
      const patch = {};
      if (p.title != null) patch.title = str(p.title, 'title', { required: true });
      if (p.description != null) patch.description = str(p.description, 'description') || '';
      if (p.rules != null || p.disjunctive != null) {
        if (c.type !== 'smart') throw new ActionError('NOT_SMART', `collection ${c.id} is manual`);
        if (p.rules != null) patch.rules = rulesOf(p.rules);
        if (p.disjunctive != null) patch.disjunctive = bool(p.disjunctive);
      }
      Object.assign(c, patch);
      return { collection: c };
    },
  },
  addProductsToCollection: {
    description: 'Add products to a manual collection (already-present products are ignored).',
    params: [['collectionId', 'string', true, ''], ['productIds', 'string[]', true, '']],
    run(state, p) {
      const c = mustGet(state, 'collections', p.collectionId, 'collection');
      if (c.type !== 'manual') throw new ActionError('NOT_MANUAL', `collection ${c.id} is a smart collection; edit its rules instead`);
      const list = productList(state, byId(state, 'stores', c.storeId), p.productIds);
      if (!list.length) throw new ActionError('INVALID_PARAMS', 'productIds must be a non-empty array');
      for (const id of list) if (!c.productIds.includes(id)) c.productIds.push(id);
      return { collection: c };
    },
  },
  removeProductsFromCollection: {
    description: 'Remove products from a manual collection.',
    params: [['collectionId', 'string', true, ''], ['productIds', 'string[]', true, '']],
    run(state, p) {
      const c = mustGet(state, 'collections', p.collectionId, 'collection');
      if (c.type !== 'manual') throw new ActionError('NOT_MANUAL', `collection ${c.id} is a smart collection; edit its rules instead`);
      const list = ids(p.productIds, 'productIds');
      const missing = list.filter((id) => !c.productIds.includes(id));
      if (missing.length) throw new ActionError('NOT_FOUND', `not in collection: ${missing.join(', ')}`);
      c.productIds = c.productIds.filter((id) => !list.includes(id));
      return { collection: c };
    },
  },

  // ---------------- customers
  createCustomer: {
    description: 'Create a customer (email must be unique within the store).',
    params: [
      ['storeId', 'string', true, ''], ['firstName', 'string', true, ''], ['lastName', 'string', true, ''], ['email', 'string', true, ''],
      ['phone', 'string', false, ''], ['tags', 'string[]', false, ''], ['acceptsMarketing', 'boolean', false, ''], ['note', 'string', false, ''],
      ['address', '{address1, city, province, zip, country}', false, 'Becomes the default address'],
    ],
    run(state, p) {
      const store = mustStore(state, p.storeId);
      const customer = makeCustomer(state, store, {
        firstName: str(p.firstName, 'firstName', { required: true }), lastName: str(p.lastName, 'lastName', { required: true }),
        email: emailOf(p.email), phone: str(p.phone, 'phone') || '', tags: tagsOf(p.tags), acceptsMarketing: bool(p.acceptsMarketing),
        note: str(p.note, 'note', { max: 2000 }) || '', address: p.address ? addressInput(p.address) : null,
      });
      return { customer };
    },
  },
  updateCustomer: {
    description: 'Update customer contact details, marketing consent, note or tags (tags replaces all).',
    params: [['customerId', 'string', true, ''], ['firstName', 'string', false, ''], ['lastName', 'string', false, ''], ['email', 'string', false, ''], ['phone', 'string', false, ''], ['acceptsMarketing', 'boolean', false, ''], ['note', 'string', false, ''], ['tags', 'string[]', false, '']],
    run(state, p) {
      const c = mustGet(state, 'customers', p.customerId, 'customer');
      const patch = {};
      if (p.firstName != null) patch.firstName = str(p.firstName, 'firstName', { required: true });
      if (p.lastName != null) patch.lastName = str(p.lastName, 'lastName', { required: true });
      if (p.email != null) {
        patch.email = emailOf(p.email);
        const other = customerByEmail(state, c.storeId, patch.email);
        if (other && other.id !== c.id) throw new ActionError('DUPLICATE', `email ${patch.email} belongs to ${other.id}`);
      }
      if (p.phone != null) patch.phone = str(p.phone, 'phone') || '';
      if (p.acceptsMarketing != null) patch.acceptsMarketing = bool(p.acceptsMarketing);
      if (p.note != null) patch.note = str(p.note, 'note', { max: 2000 }) || '';
      if (p.tags != null) patch.tags = tagsOf(p.tags);
      Object.assign(c, patch);
      return { customer: c };
    },
  },
  addCustomerAddress: {
    description: 'Add an address to a customer, optionally making it the default.',
    params: [['customerId', 'string', true, ''], ['address1', 'string', true, ''], ['city', 'string', true, ''], ['province', 'string', false, ''], ['zip', 'string', false, ''], ['country', 'string', false, 'Default US'], ['firstName', 'string', false, ''], ['lastName', 'string', false, ''], ['setDefault', 'boolean', false, '']],
    run(state, p) {
      const c = mustGet(state, 'customers', p.customerId, 'customer');
      const a = addressInput(p, 'address');
      const makeDefault = bool(p.setDefault) || c.addresses.length === 0;
      const addr = { id: nextId(state, 'address'), firstName: str(p.firstName, 'firstName') || c.firstName, lastName: str(p.lastName, 'lastName') || c.lastName, ...a, isDefault: false };
      if (makeDefault) for (const x of c.addresses) x.isDefault = false;
      addr.isDefault = makeDefault;
      c.addresses.push(addr);
      return { customer: c, address: addr };
    },
  },
  updateCustomerAddress: {
    description: 'Edit an existing customer address.',
    params: [['customerId', 'string', true, ''], ['addressId', 'string', true, ''], ['address1', 'string', false, ''], ['city', 'string', false, ''], ['province', 'string', false, ''], ['zip', 'string', false, ''], ['country', 'string', false, '']],
    run(state, p) {
      const c = mustGet(state, 'customers', p.customerId, 'customer');
      const a = c.addresses.find((x) => x.id === p.addressId);
      if (!a) throw new ActionError('NOT_FOUND', `address ${p.addressId} not found on ${c.id}`);
      const merged = addressInput({ ...a, ...Object.fromEntries(['address1', 'city', 'province', 'zip', 'country'].filter((k) => p[k] != null).map((k) => [k, p[k]])) });
      Object.assign(a, merged);
      return { customer: c, address: a };
    },
  },
  setDefaultAddress: {
    description: "Make one of the customer's addresses the default.",
    params: [['customerId', 'string', true, ''], ['addressId', 'string', true, '']],
    run(state, p) {
      const c = mustGet(state, 'customers', p.customerId, 'customer');
      const a = c.addresses.find((x) => x.id === p.addressId);
      if (!a) throw new ActionError('NOT_FOUND', `address ${p.addressId} not found on ${c.id}`);
      for (const x of c.addresses) x.isDefault = x.id === a.id;
      return { customer: c };
    },
  },
  deleteCustomerAddress: {
    description: 'Delete a non-default customer address.',
    params: [['customerId', 'string', true, ''], ['addressId', 'string', true, '']],
    run(state, p) {
      const c = mustGet(state, 'customers', p.customerId, 'customer');
      const a = c.addresses.find((x) => x.id === p.addressId);
      if (!a) throw new ActionError('NOT_FOUND', `address ${p.addressId} not found on ${c.id}`);
      if (a.isDefault) throw new ActionError('DEFAULT_ADDRESS', 'cannot delete the default address; set another default first');
      c.addresses = c.addresses.filter((x) => x.id !== a.id);
      return { customer: c };
    },
  },

  // ---------------- tags (orders, customers, products)
  addTags: {
    description: 'Add tags to an order, customer or product.',
    params: [['resource', 'order|customer|product', true, ''], ['id', 'string', true, 'Entity id'], ['tags', 'string[]', true, '']],
    run(state, p) {
      const e = taggable(state, p);
      const add = tagsOf(p.tags);
      if (!add.length) throw new ActionError('INVALID_PARAMS', 'tags must not be empty');
      e.tags = normTags([...e.tags, ...add]);
      return { id: e.id, tags: e.tags };
    },
  },
  removeTags: {
    description: 'Remove tags from an order, customer or product.',
    params: [['resource', 'order|customer|product', true, ''], ['id', 'string', true, 'Entity id'], ['tags', 'string[]', true, '']],
    run(state, p) {
      const e = taggable(state, p);
      const rm = new Set(tagsOf(p.tags).map((t) => t.toLowerCase()));
      if (!rm.size) throw new ActionError('INVALID_PARAMS', 'tags must not be empty');
      e.tags = e.tags.filter((t) => !rm.has(t.toLowerCase()));
      return { id: e.id, tags: e.tags };
    },
  },

  // ---------------- orders
  createOrder: {
    description: 'Create an order from the admin (decrements inventory at the chosen location).',
    params: [
      ['storeId', 'string', true, ''],
      ['lineItems', '{variantId|sku, quantity}[]', true, ''],
      ['customerId', 'string', false, 'Existing customer'],
      ['email', 'string', false, 'Finds or creates a customer by email when customerId is not given'],
      ['firstName', 'string', false, 'For a new customer'], ['lastName', 'string', false, 'For a new customer'],
      ['discountCode', 'string', false, ''],
      ['shippingMethod', SHIPPING_METHODS.join('|'), false, 'Default standard'],
      ['shippingAddress', '{name, address1, city, province, zip, country}', false, "Defaults to the customer's default address"],
      ['locationId', 'string', false, 'Fulfillment location (default: first location with stock)'],
      ['paymentStatus', 'paid|pending|authorized', false, 'Default paid'],
      ['note', 'string', false, ''], ['tags', 'string[]', false, ''],
    ],
    run(state, p) {
      const store = mustStore(state, p.storeId);
      let customer = null;
      let newCustomer = null;
      if (p.customerId) {
        customer = mustGet(state, 'customers', p.customerId, 'customer');
        if (customer.storeId !== store.id) throw new ActionError('WRONG_STORE', `customer ${customer.id} belongs to ${customer.storeId}`);
      } else if (p.email) {
        const email = emailOf(p.email);
        customer = customerByEmail(state, store.id, email) || null;
        if (!customer) newCustomer = { firstName: str(p.firstName, 'firstName') || '', lastName: str(p.lastName, 'lastName') || '', email, address: p.shippingAddress ? addressInput(p.shippingAddress, 'shippingAddress') : null };
      }
      const shippingMethod = oneOf(p.shippingMethod, SHIPPING_METHODS, 'shippingMethod', 'standard');
      const address = p.shippingAddress ? addressInput(p.shippingAddress, 'shippingAddress') : null;
      const discount = resolveDiscount(state, store, p.discountCode, { customerId: customer?.id, email: customer?.email || newCustomer?.email });
      if (p.locationId) storeLocation(state, store, p.locationId);
      const order = placeOrder(state, store, {
        customer, newCustomer, email: customer?.email || newCustomer?.email, lines: p.lineItems, discount, shippingMethod,
        shippingAddress: shipTo(customer, address, p.shippingAddress?.name), locationId: p.locationId || null,
        payment: oneOf(p.paymentStatus, ['paid', 'pending', 'authorized'], 'paymentStatus', 'paid'), source: 'admin',
        note: str(p.note, 'note', { max: 2000 }) || '', tags: tagsOf(p.tags),
      });
      return { order };
    },
  },
  updateOrder: {
    description: 'Edit order note, email, tags (replaces) or shipping address.',
    params: [['orderId', 'string', true, ''], ['note', 'string', false, ''], ['email', 'string', false, ''], ['tags', 'string[]', false, ''], ['shippingAddress', 'address', false, '']],
    run(state, p) {
      const o = mustGet(state, 'orders', p.orderId, 'order');
      const patch = {};
      if (p.note != null) patch.note = str(p.note, 'note', { max: 2000 }) || '';
      if (p.email != null) patch.email = emailOf(p.email);
      if (p.tags != null) patch.tags = tagsOf(p.tags);
      if (p.shippingAddress != null) {
        if (o.fulfillmentStatus === 'fulfilled') throw new ActionError('ORDER_FULFILLED', 'cannot change the shipping address of a fulfilled order');
        patch.shippingAddress = { name: str(p.shippingAddress.name, 'shippingAddress.name') || o.shippingAddress?.name || '', ...addressInput(p.shippingAddress, 'shippingAddress') };
      }
      Object.assign(o, patch);
      return { order: o };
    },
  },
  markOrderPaid: {
    description: 'Record a manual payment for the outstanding balance of a pending / partially paid order.',
    params: [['orderId', 'string', true, ''], ['gateway', 'string', false, 'e.g. manual, cash, bank_transfer (default manual)']],
    run(state, p) {
      const o = openOrder(state, p.orderId);
      if (o.financialStatus === 'authorized') throw new ActionError('INVALID_STATE', `order ${o.name} has an authorized card payment; use capturePayment`);
      if (!['pending', 'partially_paid'].includes(o.financialStatus)) throw new ActionError('INVALID_STATE', `order ${o.name} is ${o.financialStatus}, nothing to collect`);
      const pay = paymentTotals(orderTransactions(state, o.id));
      const transaction = addTransaction(state, o, 'sale', o.totalCents - pay.captured, { gateway: str(p.gateway, 'gateway') || 'manual' });
      recomputeOrder(state, o);
      return { order: o, transaction };
    },
  },
  capturePayment: {
    description: 'Capture an authorized payment (default: the full authorized amount).',
    params: [['orderId', 'string', true, ''], ['amountCents', 'integer', false, 'Partial capture amount']],
    run(state, p) {
      const o = openOrder(state, p.orderId);
      const pay = paymentTotals(orderTransactions(state, o.id));
      if (pay.capturable <= 0) throw new ActionError('INVALID_STATE', `order ${o.name} has no authorized amount to capture`);
      const amount = p.amountCents == null ? pay.capturable : int(p.amountCents, 'amountCents', { min: 1, max: pay.capturable });
      const transaction = addTransaction(state, o, 'capture', amount);
      recomputeOrder(state, o);
      return { order: o, transaction };
    },
  },
  cancelOrder: {
    description: 'Cancel an unfulfilled order: voids an authorization or refunds payment, optionally restocks.',
    params: [
      ['orderId', 'string', true, ''],
      ['reason', CANCEL_REASONS.join('|'), false, 'Default other'],
      ['refund', 'boolean', false, 'Refund captured payment (default true)'],
      ['restock', 'boolean', false, 'Return unfulfilled items to stock (default true)'],
      ['note', 'string', false, ''],
    ],
    run(state, p) {
      const o = openOrder(state, p.orderId);
      if (o.lineItems.some((l) => l.fulfilledQty > 0)) throw new ActionError('ORDER_FULFILLED', `order ${o.name} has fulfilled items; cancel the fulfillments first or refund instead`);
      const reason = oneOf(p.reason, CANCEL_REASONS, 'reason', 'other');
      const refund = bool(p.refund, true);
      const restock = bool(p.restock, true);
      const pay = paymentTotals(orderTransactions(state, o.id));
      let refundRec = null;
      if (refund && pay.captured - pay.refunded > 0) {
        const lines = o.lineItems.filter((l) => l.quantity - l.refundedQty > 0).map((l) => ({ lineItemId: l.id, quantity: l.quantity - l.refundedQty, restock }));
        const computed = lines.reduce((a, x) => { const li = o.lineItems.find((l) => l.id === x.lineItemId); const r = lineRefundAmounts(li, x.quantity); return a + r.subtotalCents + r.taxCents; }, 0);
        const shipLeft = o.shippingCents - o.shippingDiscountCents - refundedShipping(state, o.id);
        const refundable = pay.captured - pay.refunded;
        refundRec = doRefund(state, o, { lineItems: lines, shippingCents: shipLeft, amountCents: Math.min(refundable, computed + shipLeft), reason: 'other', note: `Order cancelled (${reason})` });
      }
      if (pay.capturable > 0 && pay.captured === 0) addTransaction(state, o, 'void', 0);
      for (const li of o.lineItems) {
        const left = li.quantity - li.fulfilledQty - li.removedQty;
        if (left > 0) {
          if (restock) moveStock(state, byId(state, 'variants', li.variantId), o.locationId, left, 'restock', { refType: 'order', refId: o.id, note: 'order cancelled' });
          li.removedQty += left;
        }
      }
      o.status = 'cancelled';
      o.cancelReason = reason;
      o.cancelledAt = nowStamp(state);
      o.closedAt = o.cancelledAt;
      if (p.note) o.note = [o.note, str(p.note, 'note')].filter(Boolean).join('\n');
      recomputeOrder(state, o);
      return { order: o, refund: refundRec };
    },
  },
  closeOrder: {
    description: 'Archive (close) an open order.',
    params: [['orderId', 'string', true, '']],
    run(state, p) {
      const o = openOrder(state, p.orderId);
      if (o.status === 'closed') throw new ActionError('INVALID_STATE', `order ${o.name} is already closed`);
      o.status = 'closed';
      o.closedAt = nowStamp(state);
      return { order: o };
    },
  },
  reopenOrder: {
    description: 'Unarchive (reopen) a closed order.',
    params: [['orderId', 'string', true, '']],
    run(state, p) {
      const o = openOrder(state, p.orderId);
      if (o.status !== 'closed') throw new ActionError('INVALID_STATE', `order ${o.name} is not closed`);
      o.status = 'open';
      o.closedAt = null;
      return { order: o };
    },
  },

  // ---------------- fulfillment
  createFulfillment: {
    description: "Fulfill some or all remaining items of an order from its assigned location, with optional tracking.",
    params: [
      ['orderId', 'string', true, ''],
      ['lineItems', '{lineItemId, quantity}[]', false, 'Default: every unfulfilled unit'],
      ['trackingCompany', CARRIERS.join('|') + '|string', false, 'Carrier'],
      ['trackingNumber', 'string', false, ''],
      ['trackingUrl', 'string', false, 'Default derived from carrier'],
      ['notifyCustomer', 'boolean', false, 'Default true'],
    ],
    run(state, p) {
      const o = openOrder(state, p.orderId);
      let lines;
      if (p.lineItems == null) {
        lines = o.lineItems.filter((l) => fulfillableQty(l) > 0).map((l) => ({ li: l, quantity: fulfillableQty(l) }));
      } else {
        if (!Array.isArray(p.lineItems) || !p.lineItems.length) throw new ActionError('INVALID_PARAMS', 'lineItems must be a non-empty array');
        const seen = new Set();
        lines = p.lineItems.map((x, i) => {
          const li = o.lineItems.find((l) => l.id === x?.lineItemId);
          if (!li) throw new ActionError('NOT_FOUND', `lineItems[${i}]: line item ${x?.lineItemId} is not on order ${o.id}`);
          if (seen.has(li.id)) throw new ActionError('INVALID_PARAMS', `line item ${li.id} listed twice`);
          seen.add(li.id);
          const quantity = int(x.quantity, `lineItems[${i}].quantity`, { min: 1, dflt: fulfillableQty(li) });
          if (quantity > fulfillableQty(li)) throw new ActionError('INVALID_QUANTITY', `only ${fulfillableQty(li)} unit(s) of ${li.sku || li.id} remain to fulfill`);
          return { li, quantity };
        });
      }
      if (!lines.length || lines.every((l) => l.quantity === 0)) throw new ActionError('NOTHING_TO_FULFILL', `order ${o.name} has no unfulfilled items`);
      const company = str(p.trackingCompany, 'trackingCompany', { max: 60 });
      const number = str(p.trackingNumber, 'trackingNumber', { max: 60 });
      if (number && !company) throw new ActionError('INVALID_PARAMS', 'trackingCompany is required with a trackingNumber');
      const f = {
        id: nextId(state, 'fulfillment'), orderId: o.id, storeId: o.storeId, locationId: o.locationId, status: 'success',
        lineItems: lines.map((l) => ({ lineItemId: l.li.id, quantity: l.quantity })),
        trackingCompany: company, trackingNumber: number,
        trackingUrl: str(p.trackingUrl, 'trackingUrl') || (company && number && TRACKING_URL[company] ? TRACKING_URL[company] + number : null),
        notifyCustomer: bool(p.notifyCustomer, true), createdAt: nowStamp(state),
      };
      for (const l of lines) l.li.fulfilledQty += l.quantity;
      state.fulfillments.push(f);
      recomputeOrder(state, o);
      return { fulfillment: f, order: o };
    },
  },
  updateFulfillmentTracking: {
    description: 'Set or correct the tracking information on a fulfillment.',
    params: [['fulfillmentId', 'string', true, ''], ['trackingCompany', 'string', true, ''], ['trackingNumber', 'string', true, ''], ['trackingUrl', 'string', false, ''], ['notifyCustomer', 'boolean', false, '']],
    run(state, p) {
      const f = mustGet(state, 'fulfillments', p.fulfillmentId, 'fulfillment');
      if (f.status !== 'success') throw new ActionError('INVALID_STATE', `fulfillment ${f.id} is ${f.status}`);
      const company = str(p.trackingCompany, 'trackingCompany', { required: true, max: 60 });
      const number = str(p.trackingNumber, 'trackingNumber', { required: true, max: 60 });
      f.trackingCompany = company;
      f.trackingNumber = number;
      f.trackingUrl = str(p.trackingUrl, 'trackingUrl') || (TRACKING_URL[company] ? TRACKING_URL[company] + number : null);
      if (p.notifyCustomer != null) f.notifyCustomer = bool(p.notifyCustomer);
      return { fulfillment: f };
    },
  },
  cancelFulfillment: {
    description: 'Cancel a fulfillment; its units become unfulfilled again.',
    params: [['fulfillmentId', 'string', true, '']],
    run(state, p) {
      const f = mustGet(state, 'fulfillments', p.fulfillmentId, 'fulfillment');
      if (f.status !== 'success') throw new ActionError('INVALID_STATE', `fulfillment ${f.id} is already ${f.status}`);
      const o = openOrder(state, f.orderId);
      for (const x of f.lineItems) {
        const li = o.lineItems.find((l) => l.id === x.lineItemId);
        if (li.fulfilledQty - x.quantity < returnedQty(state, li.id)) throw new ActionError('HAS_RETURNS', `units of ${li.sku || li.id} from this fulfillment are part of a return`);
        // refunded units that had shipped cannot become unfulfilled again
        if (li.refundedQty - li.removedQty > li.fulfilledQty - x.quantity) throw new ActionError('HAS_REFUNDS', `units of ${li.sku || li.id} from this fulfillment were refunded`);
      }
      for (const x of f.lineItems) o.lineItems.find((l) => l.id === x.lineItemId).fulfilledQty -= x.quantity;
      f.status = 'cancelled';
      recomputeOrder(state, o);
      return { fulfillment: f, order: o };
    },
  },

  // ---------------- refunds & returns
  createRefund: {
    description: 'Refund line items (optionally restocking them), shipping, and/or a custom amount.',
    params: [
      ['orderId', 'string', true, ''],
      ['lineItems', '{lineItemId, quantity, restock, locationId}[]', false, 'Units to refund; restock returns them to inventory (default the order location)'],
      ['refundShipping', 'boolean', false, 'Refund all remaining shipping'],
      ['shippingCents', 'integer', false, 'Refund part of the shipping'],
      ['amountCents', 'integer', false, 'Override the refunded amount (default: computed from items + shipping)'],
      ['reason', REFUND_REASONS.join('|'), false, ''], ['note', 'string', false, ''],
    ],
    run(state, p) {
      const o = mustGet(state, 'orders', p.orderId, 'order');
      const refund = doRefund(state, o, p);
      return { refund, order: o };
    },
  },
  requestReturn: {
    description: 'Create a return for fulfilled items (merchant-created returns start open; customer requests start requested).',
    params: [['orderId', 'string', true, ''], ['lineItems', '{lineItemId, quantity, reason}[]', true, ''], ['requestedBy', 'merchant|customer', false, 'Default merchant'], ['note', 'string', false, '']],
    run(state, p) {
      const o = openOrder(state, p.orderId);
      const lineItems = returnLines(state, o, p.lineItems);
      const by = oneOf(p.requestedBy, ['merchant', 'customer'], 'requestedBy', 'merchant');
      const r = {
        id: nextId(state, 'return'), orderId: o.id, storeId: o.storeId, customerId: o.customerId, status: by === 'customer' ? 'requested' : 'open', requestedBy: by,
        lineItems, note: str(p.note, 'note', { max: 2000 }) || '', createdAt: nowStamp(state), closedAt: null, refundId: null,
      };
      state.returns.push(r);
      return { return: r };
    },
  },
  approveReturn: {
    description: 'Approve a requested return (status -> open).',
    params: [['returnId', 'string', true, '']],
    run(state, p) {
      const r = mustReturn(state, p.returnId);
      if (r.status !== 'requested') throw new ActionError('INVALID_STATE', `return ${r.id} is ${r.status}, not requested`);
      r.status = 'open';
      return { return: r };
    },
  },
  declineReturn: {
    description: 'Decline a requested return.',
    params: [['returnId', 'string', true, ''], ['note', 'string', false, 'Reason shown to the customer']],
    run(state, p) {
      const r = mustReturn(state, p.returnId);
      if (r.status !== 'requested') throw new ActionError('INVALID_STATE', `return ${r.id} is ${r.status}, not requested`);
      r.status = 'declined';
      r.closedAt = nowStamp(state);
      if (p.note) r.note = str(p.note, 'note', { max: 2000 });
      return { return: r };
    },
  },
  refundReturn: {
    description: 'Receive an open return: refund its items (optionally restock) and close it.',
    params: [['returnId', 'string', true, ''], ['restock', 'boolean', false, 'Default true'], ['locationId', 'string', false, 'Restock location (default order location)'], ['refundShipping', 'boolean', false, ''], ['note', 'string', false, '']],
    run(state, p) {
      const r = mustReturn(state, p.returnId);
      if (r.status !== 'open') throw new ActionError('INVALID_STATE', `return ${r.id} is ${r.status}; approve it first`);
      const o = byId(state, 'orders', r.orderId);
      const restock = bool(p.restock, true);
      const refund = doRefund(state, o, {
        lineItems: r.lineItems.map((l) => ({ lineItemId: l.lineItemId, quantity: l.quantity, restock, locationId: p.locationId })),
        refundShipping: bool(p.refundShipping), reason: 'customer_request', note: p.note,
      }, { returnId: r.id });
      r.status = 'closed';
      r.closedAt = nowStamp(state);
      r.refundId = refund.id;
      return { return: r, refund };
    },
  },

  // ---------------- discounts
  createDiscount: {
    description: 'Create a discount code: percentage, fixed amount or free shipping, with requirements and limits.',
    params: [
      ['storeId', 'string', true, ''],
      ['code', 'string', true, '3-32 chars A-Z 0-9 _ - (unique per store, case-insensitive)'],
      ['type', DISCOUNT_TYPES.join('|'), true, ''],
      ['value', 'integer', false, 'percentage: 1-100; fixed_amount: cents; free_shipping: ignored'],
      ['title', 'string', false, ''],
      ['scope', DISCOUNT_SCOPES.join('|'), false, 'Which items it applies to (default all)'],
      ['collectionIds', 'string[]', false, 'scope=collections'], ['productIds', 'string[]', false, 'scope=products'],
      ['minType', MIN_REQUIREMENTS.join('|'), false, 'Minimum requirement'],
      ['minValue', 'integer', false, 'subtotal: cents; quantity: items'],
      ['usageLimit', 'integer', false, 'Total number of uses'],
      ['oncePerCustomer', 'boolean', false, ''],
      ['startsAt', 'YYYY-MM-DD', false, 'Default today'], ['endsAt', 'YYYY-MM-DD', false, 'Inclusive; default none'],
    ],
    run(state, p) {
      const store = mustStore(state, p.storeId);
      const code = str(p.code, 'code', { required: true });
      if (!codeRe.test(code)) throw new ActionError('INVALID_PARAMS', 'code must be 3-32 characters: letters, digits, _ or -');
      if (findDiscountByCode(state, store.id, code)) throw new ActionError('DUPLICATE', `discount code ${code} already exists in ${store.id}`);
      const f = discountFields(state, store, p, null);
      const d = {
        id: nextId(state, 'discount'), storeId: store.id, code, title: f.title || code, type: p.type, value: f.value, scope: f.scope,
        collectionIds: f.collectionIds, productIds: f.productIds, minType: f.minType, minValue: f.minValue, usageLimit: f.usageLimit,
        oncePerCustomer: f.oncePerCustomer, startsAt: f.startsAt, endsAt: f.endsAt, enabled: true, usageCount: 0, createdAt: nowStamp(state),
      };
      state.discounts.push(d);
      return { discount: d, status: discountStatus(d, state.meta.today) };
    },
  },
  updateDiscount: {
    description: 'Edit a discount (value, requirements, limits, dates, title, enabled). Type and code are fixed.',
    params: [['discountId', 'string', true, ''], ['title', 'string', false, ''], ['value', 'integer', false, ''], ['scope', 'string', false, ''], ['collectionIds', 'string[]', false, ''], ['productIds', 'string[]', false, ''], ['minType', 'string', false, ''], ['minValue', 'integer', false, ''], ['usageLimit', 'integer|null', false, ''], ['oncePerCustomer', 'boolean', false, ''], ['startsAt', 'date', false, ''], ['endsAt', 'date|null', false, ''], ['enabled', 'boolean', false, '']],
    run(state, p) {
      const d = mustGet(state, 'discounts', p.discountId, 'discount');
      const f = discountFields(state, byId(state, 'stores', d.storeId), p, d);
      if (f.usageLimit != null && f.usageLimit < d.usageCount) throw new ActionError('INVALID_PARAMS', `usageLimit cannot be below the ${d.usageCount} uses so far`);
      Object.assign(d, f);
      if (p.enabled != null) d.enabled = bool(p.enabled);
      return { discount: d, status: discountStatus(d, state.meta.today) };
    },
  },
  deactivateDiscount: {
    description: 'Disable a discount code immediately.',
    params: [['discountId', 'string', true, '']],
    run(state, p) {
      const d = mustGet(state, 'discounts', p.discountId, 'discount');
      if (!d.enabled) throw new ActionError('INVALID_STATE', `discount ${d.code} is already disabled`);
      d.enabled = false;
      return { discount: d, status: discountStatus(d, state.meta.today) };
    },
  },
  activateDiscount: {
    description: 'Re-enable a disabled discount code.',
    params: [['discountId', 'string', true, '']],
    run(state, p) {
      const d = mustGet(state, 'discounts', p.discountId, 'discount');
      if (d.enabled) throw new ActionError('INVALID_STATE', `discount ${d.code} is already enabled`);
      d.enabled = true;
      return { discount: d, status: discountStatus(d, state.meta.today) };
    },
  },

  // ---------------- storefront
  createCart: {
    description: 'Storefront: start a cart (optionally for a known customer).',
    params: [['storeId', 'string', true, ''], ['customerId', 'string', false, ''], ['email', 'string', false, ''], ['lines', '{variantId|sku, quantity}[]', false, 'Initial lines']],
    run(state, p) {
      const store = mustStore(state, p.storeId);
      let customer = null;
      if (p.customerId) {
        customer = mustGet(state, 'customers', p.customerId, 'customer');
        if (customer.storeId !== store.id) throw new ActionError('WRONG_STORE', `customer ${customer.id} belongs to ${customer.storeId}`);
      }
      const cart = { id: null, storeId: store.id, customerId: customer?.id ?? null, email: customer?.email || emailOf(p.email, false), lines: [], discountCode: null, status: 'open', orderId: null, createdAt: nowStamp(state) };
      const lines = p.lines == null ? [] : p.lines;
      if (!Array.isArray(lines)) throw new ActionError('INVALID_PARAMS', 'lines must be an array');
      for (const [i, l] of lines.entries()) {
        const v = cartVariant(state, cart, l || {});
        const q = int(l.quantity, `lines[${i}].quantity`, { min: 1, dflt: 1 });
        const ex = cart.lines.find((x) => x.variantId === v.id);
        checkCartStock(state, v, q + (ex?.quantity || 0));
        if (ex) ex.quantity += q; else cart.lines.push({ variantId: v.id, quantity: q });
      }
      cart.id = nextId(state, 'cart');
      state.carts.push(cart);
      return { cart };
    },
  },
  addToCart: {
    description: 'Storefront: add a variant to a cart.',
    params: [['cartId', 'string', true, ''], ['variantId', 'string', false, 'Variant id (or sku)'], ['sku', 'string', false, ''], ['quantity', 'integer', false, 'Default 1']],
    run(state, p) {
      const cart = openCart(state, p.cartId);
      const v = cartVariant(state, cart, p);
      const q = int(p.quantity, 'quantity', { min: 1, dflt: 1 });
      const ex = cart.lines.find((x) => x.variantId === v.id);
      checkCartStock(state, v, q + (ex?.quantity || 0));
      if (ex) ex.quantity += q; else cart.lines.push({ variantId: v.id, quantity: q });
      return { cart };
    },
  },
  updateCartLine: {
    description: 'Storefront: change the quantity of a cart line (0 removes it).',
    params: [['cartId', 'string', true, ''], ['variantId', 'string', true, ''], ['quantity', 'integer', true, '']],
    run(state, p) {
      const cart = openCart(state, p.cartId);
      const line = cart.lines.find((x) => x.variantId === p.variantId);
      if (!line) throw new ActionError('NOT_FOUND', `variant ${p.variantId} is not in cart ${cart.id}`);
      const q = int(p.quantity, 'quantity', { min: 0 });
      if (q === 0) cart.lines = cart.lines.filter((x) => x !== line);
      else { checkCartStock(state, byId(state, 'variants', line.variantId), q); line.quantity = q; }
      return { cart };
    },
  },
  applyDiscountCode: {
    description: 'Storefront: apply a discount code to a cart (empty code removes it). Validated immediately.',
    params: [['cartId', 'string', true, ''], ['code', 'string', false, '']],
    run(state, p) {
      const cart = openCart(state, p.cartId);
      const code = str(p.code, 'code');
      if (!code) { cart.discountCode = null; return { cart }; }
      const store = byId(state, 'stores', cart.storeId);
      const d = resolveDiscount(state, store, code, { customerId: cart.customerId, email: cart.email });
      if (cart.lines.length) priceLines(state, store, cart.lines, { discount: d, shippingMethod: 'standard' });
      cart.discountCode = d.code;
      return { cart };
    },
  },
  checkout: {
    description: 'Storefront: complete checkout for a cart - creates a paid order, decrements inventory, records discount usage, creates the customer if new.',
    params: [
      ['cartId', 'string', true, ''],
      ['email', 'string', false, 'Required unless the cart has a customer'],
      ['firstName', 'string', false, ''], ['lastName', 'string', false, ''],
      ['shippingAddress', '{address1, city, province, zip, country}', false, "Default: the customer's default address"],
      ['shippingMethod', SHIPPING_METHODS.join('|'), false, 'Default standard'],
    ],
    run(state, p) {
      const cart = openCart(state, p.cartId);
      if (!cart.lines.length) throw new ActionError('EMPTY_CART', `cart ${cart.id} is empty`);
      const store = byId(state, 'stores', cart.storeId);
      let customer = cart.customerId ? byId(state, 'customers', cart.customerId) : null;
      const email = customer?.email || emailOf(p.email ?? cart.email);
      if (!customer) customer = customerByEmail(state, store.id, email) || null;
      const address = p.shippingAddress ? addressInput(p.shippingAddress, 'shippingAddress') : null;
      const newCustomer = customer ? null : { firstName: str(p.firstName, 'firstName') || '', lastName: str(p.lastName, 'lastName') || '', email, address, acceptsMarketing: false };
      const shippingMethod = oneOf(p.shippingMethod, SHIPPING_METHODS, 'shippingMethod', 'standard');
      const discount = resolveDiscount(state, store, cart.discountCode, { customerId: customer?.id, email });
      const name = customer ? undefined : `${newCustomer.firstName} ${newCustomer.lastName}`.trim();
      const order = placeOrder(state, store, {
        customer, newCustomer, email, lines: cart.lines, discount, shippingMethod,
        shippingAddress: shipTo(customer, address, name), locationId: null, payment: 'paid', source: 'online_store', gateway: 'card',
      });
      cart.status = 'completed';
      cart.orderId = order.id;
      cart.customerId = order.customerId;
      cart.email = email;
      return { order, cart };
    },
  },
};

function productList(state, store, list) {
  const out = ids(list, 'productIds');
  for (const id of out) {
    const pr = mustGet(state, 'products', id, 'product');
    if (pr.storeId !== store.id) throw new ActionError('WRONG_STORE', `product ${id} belongs to ${pr.storeId}`);
  }
  return out;
}

function rulesOf(raw) {
  if (!Array.isArray(raw) || raw.length === 0) throw new ActionError('INVALID_PARAMS', 'rules must be a non-empty array of {column, relation, condition}');
  return raw.map((r, i) => {
    const column = oneOf(r?.column, SMART_COLUMNS, `rules[${i}].column`);
    const relation = oneOf(r?.relation, SMART_RELATIONS, `rules[${i}].relation`);
    const condition = String(r?.condition ?? '').trim();
    if (!condition) throw new ActionError('INVALID_PARAMS', `rules[${i}].condition is required`);
    const numeric = ['variant_price', 'variant_compare_at_price', 'variant_inventory'].includes(column);
    if (numeric && !/^-?\d+(\.\d+)?$/.test(condition)) throw new ActionError('INVALID_PARAMS', `rules[${i}].condition must be a number for ${column}`);
    if (numeric && !['equals', 'not_equals', 'greater_than', 'less_than'].includes(relation)) throw new ActionError('INVALID_PARAMS', `rules[${i}]: ${relation} is not valid for numeric column ${column}`);
    if (!numeric && ['greater_than', 'less_than'].includes(relation)) throw new ActionError('INVALID_PARAMS', `rules[${i}]: ${relation} is only valid for numeric columns`);
    return { column, relation, condition };
  });
}

function taggable(state, p) {
  const coll = { order: 'orders', customer: 'customers', product: 'products' }[oneOf(p.resource, ['order', 'customer', 'product'], 'resource')];
  return mustGet(state, coll, p.id, p.resource);
}

export const ACTION_NAMES = Object.keys(ACTIONS);
