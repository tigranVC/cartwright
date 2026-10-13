// Read-only queries shared by the UI, window.cartwright and the REST server.
import { addDays, isDate, dateOf, hasTag, weekStart } from './util.js';
import {
  ActionError, byId, mustGet, mustStore, collectionProductIds, totalAvailable, findVariantBySku, discountStatus,
  findDiscountByCode, paymentTotals, fulfillableQty, refundedShipping, resolveDiscount, priceLines, customerName,
} from './model.js';

function page(list, p) {
  const offset = Math.max(0, Number(p.offset) || 0);
  const limit = p.limit == null || p.limit === '' ? list.length : Math.max(0, Number(p.limit));
  return { total: list.length, offset, items: list.slice(offset, offset + limit) };
}
const optStore = (state, p) => (p.storeId ? mustStore(state, p.storeId) : null);
const like = (hay, q) => String(hay ?? '').toLowerCase().includes(String(q).toLowerCase());

function txIndex(state) {
  const m = new Map();
  for (const t of state.transactions) {
    if (!m.has(t.orderId)) m.set(t.orderId, []);
    m.get(t.orderId).push(t);
  }
  return m;
}

export function productSummary(state, p) {
  const vs = p.variantIds.map((id) => byId(state, 'variants', id));
  const prices = vs.map((v) => v.priceCents);
  return {
    ...p, variantsCount: vs.length, totalInventory: vs.reduce((a, v) => a + totalAvailable(v), 0),
    minPriceCents: Math.min(...prices), maxPriceCents: Math.max(...prices),
  };
}

/** {customerId: {ordersCount, totalSpentCents, lastOrderAt}} for every customer with orders. */
export function customerStats(state, storeId) {
  const txs = txIndex(state);
  const out = new Map();
  for (const o of state.orders) {
    if (!o.customerId || (storeId && o.storeId !== storeId)) continue;
    const s = out.get(o.customerId) || { ordersCount: 0, totalSpentCents: 0, lastOrderAt: null };
    const pay = paymentTotals(txs.get(o.id) || []);
    s.ordersCount++;
    s.totalSpentCents += pay.captured - pay.refunded;
    if (!s.lastOrderAt || o.createdAt > s.lastOrderAt) s.lastOrderAt = o.createdAt;
    out.set(o.customerId, s);
  }
  return out;
}

export function orderMoney(state, order, txs) {
  const pay = paymentTotals(txs || state.transactions.filter((t) => t.orderId === order.id));
  return {
    paidCents: pay.captured, refundedCents: pay.refunded, netPaidCents: pay.captured - pay.refunded,
    refundableCents: pay.captured - pay.refunded, capturableCents: pay.capturable,
    outstandingCents: order.status === 'cancelled' ? 0 : Math.max(0, order.totalCents - pay.captured),
    shippingRefundableCents: order.shippingCents - order.shippingDiscountCents - refundedShipping(state, order.id),
  };
}

function range(p, state) {
  const to = p.to || state.meta.today;
  const from = p.from || addDays(to, -29);
  if (!isDate(from) || !isDate(to)) throw new ActionError('INVALID_PARAMS', 'from/to must be YYYY-MM-DD');
  return { from, to };
}

function salesOrders(state, store, from, to) {
  return state.orders.filter((o) => o.storeId === store.id && o.status !== 'cancelled' && dateOf(o.createdAt) >= from && dateOf(o.createdAt) <= to);
}

export function analyticsSummary(state, p) {
  const store = mustStore(state, p.storeId);
  const { from, to } = range(p, state);
  const orders = salesOrders(state, store, from, to);
  const cancelled = new Set(state.orders.filter((o) => o.status === 'cancelled').map((o) => o.id));
  const refunds = state.refunds.filter((r) => r.storeId === store.id && !cancelled.has(r.orderId) && dateOf(r.createdAt) >= from && dateOf(r.createdAt) <= to);
  const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);
  const grossSalesCents = sum(orders, (o) => o.subtotalCents);
  const discountsCents = sum(orders, (o) => o.discountCents);
  const returnsCents = sum(refunds, (r) => sum(r.lineItems, (l) => l.subtotalCents));
  const shippingCents = sum(orders, (o) => o.shippingCents - o.shippingDiscountCents) - sum(refunds, (r) => r.shippingCents);
  const taxesCents = sum(orders, (o) => o.taxCents) - sum(refunds, (r) => sum(r.lineItems, (l) => l.taxCents));
  const netSalesCents = grossSalesCents - discountsCents - returnsCents;
  const customers = new Set(orders.map((o) => o.customerId).filter(Boolean));
  const firstOrder = new Map();
  for (const o of state.orders) if (o.storeId === store.id && o.customerId && (!firstOrder.has(o.customerId) || o.createdAt < firstOrder.get(o.customerId))) firstOrder.set(o.customerId, o.createdAt);
  const returning = [...customers].filter((c) => dateOf(firstOrder.get(c)) < from).length;
  return {
    storeId: store.id, from, to, orders: orders.length, grossSalesCents, discountsCents, returnsCents, netSalesCents, shippingCents, taxesCents,
    totalSalesCents: netSalesCents + shippingCents + taxesCents,
    averageOrderValueCents: orders.length ? Math.round((grossSalesCents - discountsCents) / orders.length) : 0,
    customers: customers.size, returningCustomers: returning,
    returningCustomerRate: customers.size ? Math.round((returning / customers.size) * 1000) / 1000 : 0,
  };
}

export function salesOverTime(state, p) {
  const store = mustStore(state, p.storeId);
  const { from, to } = range(p, state);
  const interval = p.interval || 'day';
  if (!['day', 'week', 'month'].includes(interval)) throw new ActionError('INVALID_PARAMS', 'interval must be day, week or month');
  const keyOf = (d) => (interval === 'day' ? d : interval === 'week' ? weekStart(d) : `${d.slice(0, 7)}-01`);
  const buckets = new Map();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const k = keyOf(d);
    if (!buckets.has(k)) buckets.set(k, { period: k, orders: 0, grossSalesCents: 0, discountsCents: 0, returnsCents: 0, netSalesCents: 0, unitsSold: 0 });
  }
  for (const o of salesOrders(state, store, from, to)) {
    const b = buckets.get(keyOf(dateOf(o.createdAt)));
    b.orders++;
    b.grossSalesCents += o.subtotalCents;
    b.discountsCents += o.discountCents;
    b.unitsSold += o.lineItems.reduce((a, l) => a + l.quantity, 0);
  }
  const cancelled = new Set(state.orders.filter((o) => o.status === 'cancelled').map((o) => o.id));
  for (const r of state.refunds) {
    if (r.storeId !== store.id || cancelled.has(r.orderId)) continue;
    const d = dateOf(r.createdAt);
    if (d < from || d > to) continue;
    buckets.get(keyOf(d)).returnsCents += r.lineItems.reduce((a, l) => a + l.subtotalCents, 0);
  }
  const rows = [...buckets.values()];
  for (const b of rows) b.netSalesCents = b.grossSalesCents - b.discountsCents - b.returnsCents;
  return { storeId: store.id, from, to, interval, rows };
}

export function topProducts(state, p) {
  const store = mustStore(state, p.storeId);
  const { from, to } = range(p, state);
  const by = p.by || 'units';
  if (!['units', 'revenue'].includes(by)) throw new ActionError('INVALID_PARAMS', 'by must be units or revenue');
  const agg = new Map();
  for (const o of salesOrders(state, store, from, to)) {
    for (const l of o.lineItems) {
      const a = agg.get(l.productId) || { productId: l.productId, title: byId(state, 'products', l.productId).title, unitsSold: 0, netSalesCents: 0, orders: 0 };
      const net = l.priceCents * l.quantity - l.discountCents;
      const refundedNet = Math.round((net * l.refundedQty) / l.quantity);
      a.unitsSold += l.quantity - l.refundedQty;
      a.netSalesCents += net - refundedNet;
      a.orders++;
      agg.set(l.productId, a);
    }
  }
  const key = by === 'units' ? 'unitsSold' : 'netSalesCents';
  const rows = [...agg.values()].sort((a, b) => b[key] - a[key] || (a.productId < b.productId ? -1 : 1));
  return { storeId: store.id, from, to, by, items: rows.slice(0, p.limit == null ? 10 : Number(p.limit)) };
}

function orderDetail(state, o) {
  const txs = state.transactions.filter((t) => t.orderId === o.id);
  const customer = o.customerId ? byId(state, 'customers', o.customerId) : null;
  return {
    ...o,
    lineItems: o.lineItems.map((l) => ({ ...l, fulfillableQty: fulfillableQty(l) })),
    customer: customer ? { id: customer.id, name: customerName(customer), email: customer.email } : null,
    money: orderMoney(state, o, txs),
    transactions: txs,
    fulfillments: state.fulfillments.filter((f) => f.orderId === o.id),
    refunds: state.refunds.filter((r) => r.orderId === o.id),
    returns: state.returns.filter((r) => r.orderId === o.id),
  };
}

function cartView(state, cart) {
  const store = byId(state, 'stores', cart.storeId);
  let pricing = null;
  let discountError = null;
  if (cart.lines.length) {
    let d = null;
    try { d = resolveDiscount(state, store, cart.discountCode, { customerId: cart.customerId, email: cart.email }); } catch (e) { discountError = e.message; }
    try { pricing = priceLines(state, store, cart.lines, { discount: d, shippingMethod: 'standard' }); } catch (e) {
      discountError = e.message;
      pricing = priceLines(state, store, cart.lines, { shippingMethod: 'standard' });
    }
  }
  return { ...cart, pricing, discountError };
}

// ---- query registry ------------------------------------------------------------
const P = (name, type, required, description = '') => [name, type, required, description];
const pageParams = [P('offset', 'integer', false), P('limit', 'integer', false)];

export const QUERIES = {
  listStores: {
    description: 'All stores with their locations and shipping rates.',
    params: [],
    run: (state) => state.stores.map((s) => ({ ...s, locations: state.locations.filter((l) => l.storeId === s.id) })),
  },
  listLocations: {
    description: 'Inventory locations (optionally for one store).',
    params: [P('storeId', 'string', false)],
    run: (state, p) => state.locations.filter((l) => !p.storeId || l.storeId === p.storeId),
  },
  listProducts: {
    description: 'Products with summary (variant count, total inventory, price range). Filters: status, vendor, productType, tag, q (title), collectionId, sku.',
    params: [P('storeId', 'string', false), P('status', 'string', false), P('vendor', 'string', false), P('productType', 'string', false), P('tag', 'string', false), P('q', 'string', false), P('collectionId', 'string', false), P('sku', 'string', false), ...pageParams],
    run(state, p) {
      optStore(state, p);
      let list = state.products.filter((x) => (!p.storeId || x.storeId === p.storeId) && (!p.status || x.status === p.status) &&
        (!p.vendor || x.vendor.toLowerCase() === String(p.vendor).toLowerCase()) && (!p.productType || x.productType.toLowerCase() === String(p.productType).toLowerCase()) &&
        (!p.tag || hasTag(x.tags, p.tag)) && (!p.q || like(x.title, p.q)));
      if (p.collectionId) {
        const ids = new Set(collectionProductIds(state, mustGet(state, 'collections', p.collectionId, 'collection')));
        list = list.filter((x) => ids.has(x.id));
      }
      if (p.sku) list = list.filter((x) => x.variantIds.some((id) => like(byId(state, 'variants', id).sku, p.sku)));
      return page(list.map((x) => productSummary(state, x)), p);
    },
  },
  getProduct: {
    description: 'A product with its variants (incl. inventory per location) and the collections it belongs to.',
    params: [P('productId', 'string', true)],
    run(state, p) {
      const prod = mustGet(state, 'products', p.productId, 'product');
      const collections = state.collections.filter((c) => c.storeId === prod.storeId && collectionProductIds(state, c).includes(prod.id)).map((c) => ({ id: c.id, title: c.title, type: c.type }));
      return { ...productSummary(state, prod), variants: prod.variantIds.map((id) => byId(state, 'variants', id)), collections };
    },
  },
  listVariants: {
    description: 'Variants with product title. Filters: productId, sku (substring), lowStock (total available below N), locationId+belowQty.',
    params: [P('storeId', 'string', false), P('productId', 'string', false), P('sku', 'string', false), P('lowStock', 'integer', false), P('locationId', 'string', false), P('belowQty', 'integer', false), ...pageParams],
    run(state, p) {
      const list = state.variants.filter((v) => (!p.storeId || v.storeId === p.storeId) && (!p.productId || v.productId === p.productId) &&
        (!p.sku || like(v.sku, p.sku)) && (p.lowStock == null || p.lowStock === '' || totalAvailable(v) < Number(p.lowStock)) &&
        (!p.locationId || p.belowQty == null || p.belowQty === '' || (v.inventory[p.locationId] ?? 0) < Number(p.belowQty)));
      return page(list.map((v) => { const pr = byId(state, 'products', v.productId); return { ...v, productTitle: pr.title, productStatus: pr.status, vendor: pr.vendor, totalAvailable: totalAvailable(v) }; }), p);
    },
  },
  getVariant: {
    description: 'One variant by variantId or storeId + sku.',
    params: [P('variantId', 'string', false), P('storeId', 'string', false), P('sku', 'string', false)],
    run(state, p) {
      const v = p.variantId ? mustGet(state, 'variants', p.variantId, 'variant') : findVariantBySku(state, p.storeId, p.sku);
      if (!v) throw new ActionError('NOT_FOUND', `variant with SKU ${p.sku} not found in ${p.storeId}`);
      return { ...v, product: byId(state, 'products', v.productId), totalAvailable: totalAvailable(v) };
    },
  },
  inventoryLevels: {
    description: 'Inventory rows (variant x location). Filters: locationId, productId, belowQty, sku.',
    params: [P('storeId', 'string', true), P('locationId', 'string', false), P('productId', 'string', false), P('sku', 'string', false), P('belowQty', 'integer', false), ...pageParams],
    run(state, p) {
      const store = mustStore(state, p.storeId);
      const rows = [];
      for (const v of state.variants) {
        if (v.storeId !== store.id || (p.productId && v.productId !== p.productId) || (p.sku && !like(v.sku, p.sku))) continue;
        const pr = byId(state, 'products', v.productId);
        for (const locId of store.locationIds) {
          if (p.locationId && locId !== p.locationId) continue;
          const available = v.inventory[locId] ?? 0;
          if (p.belowQty != null && p.belowQty !== '' && available >= Number(p.belowQty)) continue;
          rows.push({ variantId: v.id, productId: pr.id, productTitle: pr.title, variantTitle: v.title, sku: v.sku, locationId: locId, available, inventoryPolicy: v.inventoryPolicy, productStatus: pr.status });
        }
      }
      return page(rows, p);
    },
  },
  listInventoryAdjustments: {
    description: 'Inventory adjustment history, newest first.',
    params: [P('storeId', 'string', false), P('variantId', 'string', false), P('locationId', 'string', false), P('reason', 'string', false), ...pageParams],
    run: (state, p) => page(state.inventoryAdjustments.filter((a) => (!p.storeId || a.storeId === p.storeId) && (!p.variantId || a.variantId === p.variantId) && (!p.locationId || a.locationId === p.locationId) && (!p.reason || a.reason === p.reason)).slice().reverse(), p),
  },
  listCollections: {
    description: 'Collections with product counts.',
    params: [P('storeId', 'string', false), P('type', 'manual|smart', false), P('q', 'string', false)],
    run: (state, p) => state.collections.filter((c) => (!p.storeId || c.storeId === p.storeId) && (!p.type || c.type === p.type) && (!p.q || like(c.title, p.q)))
      .map((c) => ({ ...c, productsCount: collectionProductIds(state, c).length })),
  },
  getCollection: {
    description: 'A collection with its (computed) products.',
    params: [P('collectionId', 'string', true)],
    run(state, p) {
      const c = mustGet(state, 'collections', p.collectionId, 'collection');
      const products = collectionProductIds(state, c).map((id) => productSummary(state, byId(state, 'products', id)));
      return { ...c, productsCount: products.length, products };
    },
  },
  listCustomers: {
    description: 'Customers with order count and amount spent. Filters: q (name/email), tag, minOrders, minSpentCents. sort: name|spent|orders|newest.',
    params: [P('storeId', 'string', false), P('q', 'string', false), P('tag', 'string', false), P('minOrders', 'integer', false), P('minSpentCents', 'integer', false), P('sort', 'string', false), ...pageParams],
    run(state, p) {
      optStore(state, p);
      const stats = customerStats(state, p.storeId);
      const zero = { ordersCount: 0, totalSpentCents: 0, lastOrderAt: null };
      let list = state.customers.filter((c) => (!p.storeId || c.storeId === p.storeId) && (!p.tag || hasTag(c.tags, p.tag)) &&
        (!p.q || like(`${c.firstName} ${c.lastName}`, p.q) || like(c.email, p.q))).map((c) => ({ ...c, ...(stats.get(c.id) || zero) }));
      if (p.minOrders != null && p.minOrders !== '') list = list.filter((c) => c.ordersCount >= Number(p.minOrders));
      if (p.minSpentCents != null && p.minSpentCents !== '') list = list.filter((c) => c.totalSpentCents >= Number(p.minSpentCents));
      const sorts = {
        spent: (a, b) => b.totalSpentCents - a.totalSpentCents,
        orders: (a, b) => b.ordersCount - a.ordersCount,
        newest: (a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0),
        name: (a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`),
      };
      if (p.sort && sorts[p.sort]) list.sort((a, b) => sorts[p.sort](a, b) || (a.id < b.id ? -1 : 1));
      return page(list, p);
    },
  },
  getCustomer: {
    description: 'A customer with addresses, stats and order history (newest first).',
    params: [P('customerId', 'string', true)],
    run(state, p) {
      const c = mustGet(state, 'customers', p.customerId, 'customer');
      const st = customerStats(state, c.storeId).get(c.id) || { ordersCount: 0, totalSpentCents: 0, lastOrderAt: null };
      const orders = state.orders.filter((o) => o.customerId === c.id).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .map((o) => ({ id: o.id, name: o.name, createdAt: o.createdAt, totalCents: o.totalCents, status: o.status, financialStatus: o.financialStatus, fulfillmentStatus: o.fulfillmentStatus }));
      return { ...c, ...st, orders };
    },
  },
  listOrders: {
    description: 'Orders, newest first. Filters: status, financialStatus, fulfillmentStatus, customerId, q (name/email), tag, from/to (dates), discountCode, sku. sort: newest|oldest.',
    params: [P('storeId', 'string', false), P('status', 'open|closed|cancelled|any', false), P('financialStatus', 'string', false), P('fulfillmentStatus', 'string', false), P('customerId', 'string', false), P('q', 'string', false), P('tag', 'string', false), P('from', 'date', false), P('to', 'date', false), P('discountCode', 'string', false), P('sku', 'string', false), P('sort', 'string', false), ...pageParams],
    run(state, p) {
      optStore(state, p);
      const list = state.orders.filter((o) => (!p.storeId || o.storeId === p.storeId) && (!p.status || p.status === 'any' || o.status === p.status) &&
        (!p.financialStatus || o.financialStatus === p.financialStatus) && (!p.fulfillmentStatus || o.fulfillmentStatus === p.fulfillmentStatus) &&
        (!p.customerId || o.customerId === p.customerId) && (!p.tag || hasTag(o.tags, p.tag)) &&
        (!p.q || o.name === p.q || o.name === `#${p.q}` || like(o.email, p.q)) &&
        (!p.from || dateOf(o.createdAt) >= p.from) && (!p.to || dateOf(o.createdAt) <= p.to) &&
        (!p.discountCode || (o.discountCode || '').toLowerCase() === String(p.discountCode).toLowerCase()) &&
        (!p.sku || o.lineItems.some((l) => (l.sku || '').toLowerCase() === String(p.sku).toLowerCase())));
      list.sort((a, b) => (p.sort === 'oldest' ? (a.id < b.id ? -1 : 1) : (a.id < b.id ? 1 : -1)));
      return page(list, p);
    },
  },
  getOrder: {
    description: 'Full order: line items (with fulfillable qty), money summary, transactions, fulfillments, refunds, returns. By orderId or storeId + name ("#1234").',
    params: [P('orderId', 'string', false), P('storeId', 'string', false), P('name', 'string', false)],
    run(state, p) {
      let o;
      if (p.orderId) o = mustGet(state, 'orders', p.orderId, 'order');
      else {
        const name = String(p.name ?? '').startsWith('#') ? p.name : `#${p.name}`;
        o = state.orders.find((x) => x.storeId === p.storeId && x.name === name);
        if (!o) throw new ActionError('NOT_FOUND', `order ${name} not found in ${p.storeId}`);
      }
      return orderDetail(state, o);
    },
  },
  listReturns: {
    description: 'Returns, newest first. Filters: status (requested|open|closed|declined), orderId.',
    params: [P('storeId', 'string', false), P('status', 'string', false), P('orderId', 'string', false), ...pageParams],
    run: (state, p) => page(state.returns.filter((r) => (!p.storeId || r.storeId === p.storeId) && (!p.status || r.status === p.status) && (!p.orderId || r.orderId === p.orderId))
      .slice().reverse().map((r) => ({ ...r, orderName: byId(state, 'orders', r.orderId).name })), p),
  },
  listRefunds: {
    description: 'Refunds, newest first.',
    params: [P('storeId', 'string', false), P('orderId', 'string', false), ...pageParams],
    run: (state, p) => page(state.refunds.filter((r) => (!p.storeId || r.storeId === p.storeId) && (!p.orderId || r.orderId === p.orderId)).slice().reverse(), p),
  },
  listDiscounts: {
    description: 'Discount codes with computed status (active, scheduled, expired, exhausted, disabled).',
    params: [P('storeId', 'string', false), P('status', 'string', false), P('q', 'string', false)],
    run: (state, p) => state.discounts.filter((d) => (!p.storeId || d.storeId === p.storeId) && (!p.q || like(d.code, p.q) || like(d.title, p.q)))
      .map((d) => ({ ...d, status: discountStatus(d, state.meta.today) })).filter((d) => !p.status || d.status === p.status),
  },
  getDiscount: {
    description: 'One discount by discountId or storeId + code.',
    params: [P('discountId', 'string', false), P('storeId', 'string', false), P('code', 'string', false)],
    run(state, p) {
      const d = p.discountId ? mustGet(state, 'discounts', p.discountId, 'discount') : findDiscountByCode(state, p.storeId, p.code);
      if (!d) throw new ActionError('NOT_FOUND', `discount code ${p.code} not found in ${p.storeId}`);
      return { ...d, status: discountStatus(d, state.meta.today), ordersCount: state.orders.filter((o) => o.discountId === d.id).length };
    },
  },
  previewPricing: {
    description: 'Price a hypothetical order (lines, discount code, shipping) without creating anything.',
    params: [P('storeId', 'string', true), P('lineItems', '{variantId|sku, quantity}[]', true), P('discountCode', 'string', false), P('shippingMethod', 'string', false), P('customerId', 'string', false), P('email', 'string', false)],
    run(state, p) {
      const store = mustStore(state, p.storeId);
      const d = resolveDiscount(state, store, p.discountCode, { customerId: p.customerId, email: p.email });
      return priceLines(state, store, p.lineItems, { discount: d, shippingMethod: p.shippingMethod || 'standard' });
    },
  },
  storefrontProducts: {
    description: 'Storefront catalog: active products with variants and availability. Filters: collectionId, q.',
    params: [P('storeId', 'string', true), P('collectionId', 'string', false), P('q', 'string', false), ...pageParams],
    run(state, p) {
      const store = mustStore(state, p.storeId);
      let list = state.products.filter((x) => x.storeId === store.id && x.status === 'active' && (!p.q || like(x.title, p.q)));
      if (p.collectionId) { const ids = new Set(collectionProductIds(state, mustGet(state, 'collections', p.collectionId, 'collection'))); list = list.filter((x) => ids.has(x.id)); }
      return page(list.map((x) => ({
        ...productSummary(state, x),
        variants: x.variantIds.map((id) => { const v = byId(state, 'variants', id); return { id: v.id, title: v.title, sku: v.sku, priceCents: v.priceCents, compareAtCents: v.compareAtCents, available: v.inventoryPolicy === 'continue' || Math.max(...Object.values(v.inventory)) > 0 }; }),
      })), p);
    },
  },
  listCarts: {
    description: 'Carts (storefront sessions).',
    params: [P('storeId', 'string', false), P('status', 'open|completed', false)],
    run: (state, p) => state.carts.filter((c) => (!p.storeId || c.storeId === p.storeId) && (!p.status || c.status === p.status)),
  },
  getCart: {
    description: 'A cart with live pricing (discount applied when valid; discountError explains why not).',
    params: [P('cartId', 'string', true)],
    run: (state, p) => cartView(state, mustGet(state, 'carts', p.cartId, 'cart')),
  },
  analyticsSummary: {
    description: 'Sales summary for a date range (default last 30 days): orders, gross/net sales, discounts, returns, AOV, returning customers.',
    params: [P('storeId', 'string', true), P('from', 'date', false), P('to', 'date', false)],
    run: analyticsSummary,
  },
  salesOverTime: {
    description: 'Sales bucketed by day, week (Monday start) or month.',
    params: [P('storeId', 'string', true), P('from', 'date', false), P('to', 'date', false), P('interval', 'day|week|month', false)],
    run: salesOverTime,
  },
  topProducts: {
    description: 'Best-selling products by net units or net sales in a date range.',
    params: [P('storeId', 'string', true), P('from', 'date', false), P('to', 'date', false), P('by', 'units|revenue', false), P('limit', 'integer', false)],
    run: topProducts,
  },
};
