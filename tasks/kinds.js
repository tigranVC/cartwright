// Task kinds: each kind knows how to pick concrete entities from a seeded
// world (candidates), phrase the instruction (prompt), solve it through the
// public action API (reference solution) and verify the resulting state (check).
//
// check(final, initial, params) returns a list of failure reasons; [] = pass.
import {
  byId, validateState, fmtMoney, addDays, CARRIERS, lineRefundAmounts, customerStats, topProducts, collectionProductIds,
  chooseLocation, priceLines, customerUsedDiscount, findDiscountByCode, discountStatus, hasTag, customerName, dateOf, trackingNumberFor,
} from '../core/index.js';

// ---- helpers -----------------------------------------------------------------
const created = (initial, final, coll) => {
  const ids = new Set(initial[coll].map((e) => e.id));
  return final[coll].filter((e) => !ids.has(e.id));
};
const get = (s, coll, id) => byId(s, coll, id);
function checker() {
  const reasons = [];
  return { reasons, need(cond, msg) { if (!cond) reasons.push(msg); return Boolean(cond); } };
}
function integrity(c, final) {
  const problems = validateState(final);
  c.need(problems.length === 0, `state invariants violated: ${problems.slice(0, 3).join('; ')}`);
}
const storeName = (s, id) => `${get(s, 'stores', id).name} (${id})`;
const locName = (s, id) => `${get(s, 'locations', id).name} (${id})`;
const inv = (s, variantId, loc) => get(s, 'variants', variantId).inventory[loc] ?? 0;
const custLabel = (s, id) => { const c = get(s, 'customers', id); return `${customerName(c)} (${c.email}, ${c.id})`; };
const orderLabel = (s, o) => `${o.name} (${o.id}) in ${storeName(s, o.storeId)}`;
const lineLabel = (li) => `${li.title} — ${li.variantTitle} (SKU ${li.sku})`;
const variantLabel = (s, v) => `${get(s, 'products', v.productId).title} — ${v.title} (SKU ${v.sku}, ${v.id})`;
const fmtLines = (s, lines) => lines.map((l) => `${l.quantity} x ${variantLabel(s, get(s, 'variants', l.variantId))}`).join(', ');
const sameStr = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
const activeOrders = (s) => s.orders.filter((o) => o.status !== 'cancelled');
const readyToShip = (s) => s.orders.filter((o) => o.status === 'open' && o.financialStatus === 'paid' && o.fulfillmentStatus === 'unfulfilled' && o.shippingMethod !== 'pickup');
const sumBy = (list, f) => list.reduce((a, x) => a + f(x), 0);
const STORE_IDS = ['STO-1', 'STO-2', 'STO-3'];
function newRefunds(initial, final, orderId) {
  return created(initial, final, 'refunds').filter((r) => r.orderId === orderId);
}
function stockDeltaCheck(c, initial, final, expect, label) {
  // expect: Map "variantId|loc" -> expected delta; every other level of those variants must be unchanged
  const variants = new Set([...expect.keys()].map((k) => k.split('|')[0]));
  for (const vid of variants) {
    for (const loc of Object.keys(get(initial, 'variants', vid).inventory)) {
      const want = inv(initial, vid, loc) + (expect.get(`${vid}|${loc}`) || 0);
      c.need(inv(final, vid, loc) === want, `${label}: ${vid} at ${loc} should be ${want}, is ${inv(final, vid, loc)}`);
    }
  }
}
const randCode = (rng, stem) => `${stem}${rng.int(10, 99)}`;
const NEW_TITLES = [['Lantern Bay', 'Overshirt'], ['Driftwood', 'Henley'], ['Kettle Ridge', 'Camp Shirt'], ['Saltmarsh', 'Utility Tee'], ['Pinecrest', 'Quarter Zip'], ['Bramble', 'Work Shirt']];

// ---- kinds ---------------------------------------------------------------------
export const KINDS = {
  fulfill_tracking: {
    title: 'Fulfill a paid order with tracking',
    candidates(s, rng) {
      return rng.shuffle(readyToShip(s)).map((o) => { const carrier = rng.pick(CARRIERS); return { orderId: o.id, carrier, trackingNumber: trackingNumberFor(rng, carrier) }; });
    },
    prompt(s, p) {
      const o = get(s, 'orders', p.orderId);
      return `Order ${orderLabel(s, o)} for ${custLabel(s, o.customerId)} is paid and ready to ship. Fulfill every item on it in a single shipment with ${p.carrier} tracking number ${p.trackingNumber}.`;
    },
    solve(env, p) { env.act('createFulfillment', { orderId: p.orderId, trackingCompany: p.carrier, trackingNumber: p.trackingNumber }); },
    check(final, initial, p) {
      const c = checker();
      const o = get(final, 'orders', p.orderId);
      c.need(o.fulfillmentStatus === 'fulfilled', `order should be fulfilled, is ${o.fulfillmentStatus}`);
      const fs = created(initial, final, 'fulfillments').filter((f) => f.orderId === o.id && f.status === 'success');
      c.need(fs.length === 1, `expected exactly 1 new fulfillment, found ${fs.length}`);
      if (fs[0]) c.need(sameStr(fs[0].trackingCompany, p.carrier) && String(fs[0].trackingNumber).trim() === p.trackingNumber, 'tracking company/number do not match');
      integrity(c, final);
      return c.reasons;
    },
  },

  partial_fulfill: {
    title: 'Ship only one line item of an order',
    candidates(s, rng) {
      return rng.shuffle(readyToShip(s).filter((o) => o.lineItems.length >= 2)).map((o) => {
        const li = o.lineItems[rng.int(0, o.lineItems.length - 1)];
        const carrier = rng.pick(CARRIERS);
        return { orderId: o.id, lineItemId: li.id, carrier, trackingNumber: trackingNumberFor(rng, carrier) };
      });
    },
    prompt(s, p) {
      const o = get(s, 'orders', p.orderId);
      const li = o.lineItems.find((l) => l.id === p.lineItemId);
      return `For order ${orderLabel(s, o)}, only ${lineLabel(li)} is ready to go out. Create a fulfillment for just that line item (all ${li.quantity} unit(s)) with ${p.carrier} tracking number ${p.trackingNumber}. Leave every other item on the order unfulfilled.`;
    },
    solve(env, p) {
      const o = get(env.state, 'orders', p.orderId);
      const li = o.lineItems.find((l) => l.id === p.lineItemId);
      env.act('createFulfillment', { orderId: o.id, lineItems: [{ lineItemId: li.id, quantity: li.quantity }], trackingCompany: p.carrier, trackingNumber: p.trackingNumber });
    },
    check(final, initial, p) {
      const c = checker();
      const o = get(final, 'orders', p.orderId);
      for (const li of o.lineItems) {
        if (li.id === p.lineItemId) c.need(li.fulfilledQty === li.quantity, `${li.sku} should be fully fulfilled`);
        else c.need(li.fulfilledQty === 0, `${li.sku} must stay unfulfilled`);
      }
      c.need(o.fulfillmentStatus === 'partial', `order should be partially fulfilled, is ${o.fulfillmentStatus}`);
      const fs = created(initial, final, 'fulfillments').filter((f) => f.orderId === o.id && f.status === 'success');
      c.need(fs.some((f) => sameStr(f.trackingCompany, p.carrier) && f.trackingNumber === p.trackingNumber && f.lineItems.some((x) => x.lineItemId === p.lineItemId)), 'no fulfillment with the requested tracking covers the line item');
      integrity(c, final);
      return c.reasons;
    },
  },

  refund_item: {
    title: 'Refund one unit of an order line (with or without restock)',
    candidates(s, rng, v) {
      const out = [];
      for (const o of rng.shuffle(s.orders.filter((x) => x.fulfillmentStatus === 'fulfilled' && x.financialStatus === 'paid' && x.status !== 'cancelled'))) {
        const li = o.lineItems.find((l) => l.sku && l.refundedQty === 0 && l.priceCents * l.quantity - l.discountCents > 0);
        if (li) out.push({ orderId: o.id, lineItemId: li.id, restock: v.restock, locationId: o.locationId });
      }
      return out;
    },
    prompt(s, p) {
      const o = get(s, 'orders', p.orderId);
      const li = o.lineItems.find((l) => l.id === p.lineItemId);
      return p.restock
        ? `The customer sent back one unit of ${lineLabel(li)} from order ${orderLabel(s, o)} in resalable condition. Refund that one unit (do not refund shipping) and restock it at ${locName(s, p.locationId)}.`
        : `One unit of ${lineLabel(li)} on order ${orderLabel(s, o)} arrived damaged and the customer will not send it back. Refund that one unit (do not refund shipping) without restocking it.`;
    },
    solve(env, p) {
      env.act('createRefund', { orderId: p.orderId, lineItems: [{ lineItemId: p.lineItemId, quantity: 1, restock: p.restock, locationId: p.locationId }], reason: p.restock ? 'customer_request' : 'damaged' });
    },
    check(final, initial, p) {
      const c = checker();
      const li0 = get(initial, 'orders', p.orderId).lineItems.find((l) => l.id === p.lineItemId);
      const li = get(final, 'orders', p.orderId).lineItems.find((l) => l.id === p.lineItemId);
      c.need(li.refundedQty === li0.refundedQty + 1, `exactly one unit should be refunded (refundedQty ${li.refundedQty})`);
      const refs = newRefunds(initial, final, p.orderId);
      const want = lineRefundAmounts(li0, 1);
      c.need(sumBy(refs, (r) => r.amountCents) === want.subtotalCents + want.taxCents, `refunded ${fmtMoney(sumBy(refs, (r) => r.amountCents))}, expected ${fmtMoney(want.subtotalCents + want.taxCents)}`);
      c.need(sumBy(refs, (r) => r.shippingCents) === 0, 'shipping must not be refunded');
      c.need(get(final, 'orders', p.orderId).lineItems.every((l) => l.id === p.lineItemId || l.refundedQty === get(initial, 'orders', p.orderId).lineItems.find((x) => x.id === l.id).refundedQty), 'other line items must not be refunded');
      stockDeltaCheck(c, initial, final, new Map(p.restock ? [[`${li0.variantId}|${p.locationId}`, 1]] : [[`${li0.variantId}|${p.locationId}`, 0]]), 'inventory');
      integrity(c, final);
      return c.reasons;
    },
  },

  cancel_order: {
    title: 'Cancel an order, refund and restock',
    candidates(s, rng) { return rng.shuffle(readyToShip(s)).map((o) => ({ orderId: o.id })); },
    prompt(s, p) {
      const o = get(s, 'orders', p.orderId);
      return `${custLabel(s, o.customerId)} asked to cancel order ${orderLabel(s, o)} before it ships. Cancel the order with reason "customer", refund the full payment, and restock all items.`;
    },
    solve(env, p) { env.act('cancelOrder', { orderId: p.orderId, reason: 'customer', refund: true, restock: true }); },
    check(final, initial, p) {
      const c = checker();
      const o0 = get(initial, 'orders', p.orderId);
      const o = get(final, 'orders', p.orderId);
      c.need(o.status === 'cancelled', `order should be cancelled, is ${o.status}`);
      c.need(o.cancelReason === 'customer', `cancel reason should be customer, is ${o.cancelReason}`);
      c.need(o.financialStatus === 'refunded', `order should be fully refunded, is ${o.financialStatus}`);
      const expect = new Map();
      for (const li of o0.lineItems) expect.set(`${li.variantId}|${o0.locationId}`, (expect.get(`${li.variantId}|${o0.locationId}`) || 0) + li.quantity);
      stockDeltaCheck(c, initial, final, expect, 'restock');
      integrity(c, final);
      return c.reasons;
    },
  },

  mark_paid: {
    title: 'Record a manual payment on a pending order',
    candidates(s, rng) { return rng.shuffle(s.orders.filter((o) => o.status === 'open' && o.financialStatus === 'pending')).map((o) => ({ orderId: o.id })); },
    prompt(s, p) {
      const o = get(s, 'orders', p.orderId);
      return `${custLabel(s, o.customerId)} paid the full ${fmtMoney(o.totalCents)} for order ${orderLabel(s, o)} by bank transfer. Mark the order as paid.`;
    },
    solve(env, p) { env.act('markOrderPaid', { orderId: p.orderId, gateway: 'bank_transfer' }); },
    check(final, initial, p) {
      const c = checker();
      const o = get(final, 'orders', p.orderId);
      c.need(o.financialStatus === 'paid', `order should be paid, is ${o.financialStatus}`);
      const txs = created(initial, final, 'transactions').filter((t) => t.orderId === o.id && (t.kind === 'sale' || t.kind === 'capture'));
      c.need(sumBy(txs, (t) => t.amountCents) === o.totalCents, 'payment amount should equal the order total');
      c.need(o.status === 'open', 'order should stay open');
      integrity(c, final);
      return c.reasons;
    },
  },

  capture_all_authorized: {
    title: 'Capture every authorized payment in a store',
    candidates(s, rng) {
      return rng.shuffle(STORE_IDS).map((id) => ({ storeId: id, orderIds: s.orders.filter((o) => o.storeId === id && o.status === 'open' && o.financialStatus === 'authorized').map((o) => o.id) })).filter((p) => p.orderIds.length >= 2);
    },
    prompt(s, p) {
      return `Card payments in ${storeName(s, p.storeId)} are only authorized at checkout. Capture the full payment on every open order in that store whose payment is authorized but not yet captured. Do not touch orders in other stores.`;
    },
    solve(env, p) {
      const list = env.query('listOrders', { storeId: p.storeId, status: 'open', financialStatus: 'authorized' }).items;
      for (const o of list) env.act('capturePayment', { orderId: o.id });
    },
    check(final, initial, p) {
      const c = checker();
      for (const id of p.orderIds) { const o = get(final, 'orders', id); c.need(o.financialStatus === 'paid', `${o.name} should be paid, is ${o.financialStatus}`); }
      const ids = new Set(p.orderIds);
      const changed = initial.orders.filter((o) => !ids.has(o.id) && get(final, 'orders', o.id).financialStatus !== o.financialStatus);
      c.need(changed.length === 0, `other orders changed payment status: ${changed.slice(0, 3).map((o) => o.id).join(', ')}`);
      integrity(c, final);
      return c.reasons;
    },
  },

  approve_return_refund: {
    title: 'Approve a return request, refund and restock',
    candidates(s, rng) { return rng.shuffle(s.returns.filter((r) => r.status === 'requested')).map((r) => ({ returnId: r.id, locationId: get(s, 'orders', r.orderId).locationId })); },
    prompt(s, p) {
      const r = get(s, 'returns', p.returnId);
      const o = get(s, 'orders', r.orderId);
      const li = o.lineItems.find((l) => l.id === r.lineItems[0].lineItemId);
      return `Return request ${r.id} on order ${orderLabel(s, o)} (${r.lineItems[0].quantity} x ${lineLabel(li)}, reason ${r.lineItems[0].reason}) has been accepted and the item came back in good condition. Approve the return, refund the returned item (not shipping) and restock it at ${locName(s, p.locationId)}.`;
    },
    solve(env, p) {
      env.act('approveReturn', { returnId: p.returnId });
      env.act('refundReturn', { returnId: p.returnId, restock: true, locationId: p.locationId });
    },
    check(final, initial, p) {
      const c = checker();
      const r0 = get(initial, 'returns', p.returnId);
      const r = get(final, 'returns', p.returnId);
      c.need(r.status === 'closed', `return should be closed (refunded), is ${r.status}`);
      const o0 = get(initial, 'orders', r0.orderId);
      const expect = new Map();
      let amount = 0;
      for (const x of r0.lineItems) {
        const li = o0.lineItems.find((l) => l.id === x.lineItemId);
        expect.set(`${li.variantId}|${p.locationId}`, x.quantity);
        const a = lineRefundAmounts(li, x.quantity);
        amount += a.subtotalCents + a.taxCents;
      }
      const refs = newRefunds(initial, final, r0.orderId);
      c.need(sumBy(refs, (x) => x.amountCents) === amount, `refunded ${fmtMoney(sumBy(refs, (x) => x.amountCents))}, expected ${fmtMoney(amount)}`);
      c.need(sumBy(refs, (x) => x.shippingCents) === 0, 'shipping must not be refunded');
      stockDeltaCheck(c, initial, final, expect, 'restock');
      integrity(c, final);
      return c.reasons;
    },
  },

  decline_return: {
    title: 'Decline a return request',
    candidates(s, rng) { return rng.shuffle(s.returns.filter((r) => r.status === 'requested')).map((r) => ({ returnId: r.id })); },
    prompt(s, p) {
      const r = get(s, 'returns', p.returnId);
      const o = get(s, 'orders', r.orderId);
      return `The item in return request ${r.id} (order ${orderLabel(s, o)}) was bought as final sale. Decline the return request; do not issue any refund.`;
    },
    solve(env, p) { env.act('declineReturn', { returnId: p.returnId, note: 'Final sale item' }); },
    check(final, initial, p) {
      const c = checker();
      const r = get(final, 'returns', p.returnId);
      c.need(r.status === 'declined', `return should be declined, is ${r.status}`);
      c.need(newRefunds(initial, final, r.orderId).length === 0, 'no refund should be issued');
      integrity(c, final);
      return c.reasons;
    },
  },

  create_percentage_discount: {
    title: 'Create a percentage discount code with requirements and limits',
    candidates(s, rng) {
      return rng.shuffle(STORE_IDS).map((storeId) => ({ storeId, code: randCode(rng, 'SUMMER'), percent: rng.pick([10, 15, 20, 25]), minSubtotalCents: rng.pick([4000, 5000, 7500]), usageLimit: rng.pick([50, 100, 250]), endsAt: addDays(s.meta.today, rng.pick([14, 30, 45])) }));
    },
    prompt(s, p) {
      return `In ${storeName(s, p.storeId)}, create discount code ${p.code}: ${p.percent}% off the entire order, minimum purchase ${fmtMoney(p.minSubtotalCents)}, limited to ${p.usageLimit} total uses and one use per customer, active from today (${s.meta.today}) through ${p.endsAt}.`;
    },
    solve(env, p) {
      env.act('createDiscount', { storeId: p.storeId, code: p.code, type: 'percentage', value: p.percent, scope: 'all', minType: 'subtotal', minValue: p.minSubtotalCents, usageLimit: p.usageLimit, oncePerCustomer: true, endsAt: p.endsAt });
    },
    check(final, initial, p) {
      const c = checker();
      const d = findDiscountByCode(final, p.storeId, p.code);
      if (!c.need(d, `discount ${p.code} not found in ${p.storeId}`)) return c.reasons;
      c.need(d.type === 'percentage' && d.value === p.percent, `should be ${p.percent}% off`);
      c.need(d.scope === 'all', 'should apply to the entire order');
      c.need(d.minType === 'subtotal' && d.minValue === p.minSubtotalCents, 'minimum purchase requirement is wrong');
      c.need(d.usageLimit === p.usageLimit, `usage limit should be ${p.usageLimit}`);
      c.need(d.oncePerCustomer === true, 'should be limited to one use per customer');
      c.need(d.endsAt === p.endsAt, `should end on ${p.endsAt}`);
      c.need(discountStatus(d, final.meta.today) === 'active', 'discount should be active today');
      integrity(c, final);
      return c.reasons;
    },
  },

  create_free_shipping: {
    title: 'Create a scheduled free-shipping code with a minimum quantity',
    candidates(s, rng) {
      return rng.shuffle(STORE_IDS).map((storeId) => { const start = addDays(s.meta.today, rng.int(2, 6)); return { storeId, code: randCode(rng, 'SHIPWEEK'), minQty: rng.pick([2, 3, 4]), startsAt: start, endsAt: addDays(start, 6) }; });
    },
    prompt(s, p) {
      return `Set up a free-shipping promotion in ${storeName(s, p.storeId)}: code ${p.code} gives free shipping on orders with at least ${p.minQty} items. It should run from ${p.startsAt} through ${p.endsAt} (inclusive), with no usage limit.`;
    },
    solve(env, p) { env.act('createDiscount', { storeId: p.storeId, code: p.code, type: 'free_shipping', minType: 'quantity', minValue: p.minQty, startsAt: p.startsAt, endsAt: p.endsAt }); },
    check(final, initial, p) {
      const c = checker();
      const d = findDiscountByCode(final, p.storeId, p.code);
      if (!c.need(d, `discount ${p.code} not found`)) return c.reasons;
      c.need(d.type === 'free_shipping', 'should be a free shipping discount');
      c.need(d.minType === 'quantity' && d.minValue === p.minQty, `should require at least ${p.minQty} items`);
      c.need(d.startsAt === p.startsAt && d.endsAt === p.endsAt, 'start/end dates are wrong');
      c.need(d.usageLimit == null, 'should have no usage limit');
      c.need(d.enabled, 'should be enabled');
      integrity(c, final);
      return c.reasons;
    },
  },

  create_collection_discount: {
    title: 'Create a fixed-amount discount for one collection',
    candidates(s, rng) {
      return rng.shuffle(s.collections.filter((x) => collectionProductIds(s, x).length >= 3)).map((col) => ({ storeId: col.storeId, collectionId: col.id, code: randCode(rng, 'COLLECT'), amountCents: rng.pick([500, 1000, 1500]) }));
    },
    prompt(s, p) {
      const col = get(s, 'collections', p.collectionId);
      return `In ${storeName(s, p.storeId)}, create discount code ${p.code} worth ${fmtMoney(p.amountCents)} off, applying only to products in the "${col.title}" collection (${col.id}). No minimum purchase, no usage limit, starting today.`;
    },
    solve(env, p) { env.act('createDiscount', { storeId: p.storeId, code: p.code, type: 'fixed_amount', value: p.amountCents, scope: 'collections', collectionIds: [p.collectionId] }); },
    check(final, initial, p) {
      const c = checker();
      const d = findDiscountByCode(final, p.storeId, p.code);
      if (!c.need(d, `discount ${p.code} not found`)) return c.reasons;
      c.need(d.type === 'fixed_amount' && d.value === p.amountCents, `should be ${fmtMoney(p.amountCents)} off`);
      c.need(d.scope === 'collections' && d.collectionIds.length === 1 && d.collectionIds[0] === p.collectionId, 'should apply only to the collection');
      c.need(d.minType === 'none' && d.usageLimit == null, 'should have no minimum and no usage limit');
      c.need(discountStatus(d, final.meta.today) === 'active', 'should be active today');
      integrity(c, final);
      return c.reasons;
    },
  },

  deactivate_code: {
    title: 'Disable a leaked discount code',
    candidates(s, rng) {
      return rng.shuffle(s.discounts.filter((d) => ['VIP25', 'WELCOME10', 'TAKE20'].includes(d.code) && discountStatus(d, s.meta.today) === 'active')).map((d) => ({ storeId: d.storeId, discountId: d.id }));
    },
    prompt(s, p) {
      const d = get(s, 'discounts', p.discountId);
      return `The code ${d.code} for ${storeName(s, p.storeId)} was posted on a public coupon site. Disable it immediately so it can no longer be used (keep it on record; don't change any other discount).`;
    },
    solve(env, p) { env.act('deactivateDiscount', { discountId: p.discountId }); },
    check(final, initial, p) {
      const c = checker();
      const d = get(final, 'discounts', p.discountId);
      c.need(d && discountStatus(d, final.meta.today) !== 'active', 'discount is still usable');
      const others = initial.discounts.filter((x) => x.id !== p.discountId && discountStatus(x, initial.meta.today) !== discountStatus(get(final, 'discounts', x.id), final.meta.today));
      c.need(others.length === 0, `other discounts changed: ${others.map((x) => x.code).join(', ')}`);
      integrity(c, final);
      return c.reasons;
    },
  },

  create_product_variants: {
    title: 'Create a product with size x color variants, SKUs and stock',
    candidates(s, rng) {
      return rng.shuffle(NEW_TITLES).map(([a, b]) => {
        const sizes = rng.pick([['S', 'M', 'L'], ['M', 'L', 'XL'], ['S', 'M', 'L', 'XL']]);
        const colors = rng.shuffle(['Black', 'Natural', 'Olive', 'Navy']).slice(0, 2);
        const prefix = (a[0] + a.split(' ').pop()[0] + b[0]).toUpperCase() + rng.int(1, 9);
        return { storeId: 'STO-1', title: `${a} ${b}`, vendor: 'Fernhollow', productType: 'Shirt', sizes, colors, priceCents: rng.pick([4800, 5400, 6200]), skuPrefix: prefix, locationId: 'LOC-01', quantity: rng.pick([6, 10, 12]) };
      });
    },
    feasible: (s, p) => !s.products.some((x) => x.storeId === p.storeId && sameStr(x.title, p.title)),
    prompt(s, p) {
      return `Add a new product to ${storeName(s, p.storeId)}: "${p.title}", vendor ${p.vendor}, product type ${p.productType}, status active. It has two options: Size (${p.sizes.join(', ')}) and Color (${p.colors.join(', ')}), with one variant for every combination, each priced ${fmtMoney(p.priceCents)}. Give each variant the SKU ${p.skuPrefix}-<SIZE>-<COLOR in upper case> (e.g. ${p.skuPrefix}-${p.sizes[0]}-${p.colors[0].toUpperCase()}) and stock ${p.quantity} units of every variant at ${locName(s, p.locationId)}.`;
    },
    solve(env, p) {
      const variants = [];
      for (const size of p.sizes) for (const color of p.colors) variants.push({ options: [size, color], sku: `${p.skuPrefix}-${size}-${color.toUpperCase()}`, priceCents: p.priceCents, inventory: { [p.locationId]: p.quantity } });
      env.act('createProduct', { storeId: p.storeId, title: p.title, vendor: p.vendor, productType: p.productType, status: 'active', options: [{ name: 'Size', values: p.sizes }, { name: 'Color', values: p.colors }], variants });
    },
    check(final, initial, p) {
      const c = checker();
      const prods = created(initial, final, 'products').filter((x) => x.storeId === p.storeId && sameStr(x.title, p.title));
      if (!c.need(prods.length === 1, `expected exactly one new product titled ${p.title}, found ${prods.length}`)) return c.reasons;
      const pr = prods[0];
      c.need(pr.status === 'active', 'product should be active');
      c.need(sameStr(pr.vendor, p.vendor) && sameStr(pr.productType, p.productType), 'vendor or product type is wrong');
      c.need(pr.options.length === 2 && sameStr(pr.options[0].name, 'Size') && sameStr(pr.options[1].name, 'Color'), 'options should be Size and Color');
      const vs = pr.variantIds.map((id) => get(final, 'variants', id));
      c.need(vs.length === p.sizes.length * p.colors.length, `expected ${p.sizes.length * p.colors.length} variants, found ${vs.length}`);
      for (const size of p.sizes) for (const color of p.colors) {
        const v = vs.find((x) => sameStr(x.options[0], size) && sameStr(x.options[1], color));
        if (!c.need(v, `missing variant ${size} / ${color}`)) continue;
        c.need(v.priceCents === p.priceCents, `${v.title}: price should be ${fmtMoney(p.priceCents)}`);
        c.need(v.sku === `${p.skuPrefix}-${size}-${color.toUpperCase()}`, `${v.title}: SKU should be ${p.skuPrefix}-${size}-${color.toUpperCase()}`);
        c.need(v.inventory[p.locationId] === p.quantity, `${v.title}: stock at ${p.locationId} should be ${p.quantity}`);
      }
      integrity(c, final);
      return c.reasons;
    },
  },

  put_on_sale: {
    title: 'Put a product on sale using compare-at prices',
    candidates(s, rng) {
      return rng.shuffle(s.products.filter((x) => x.status === 'active' && x.variantIds.length >= 2 && x.variantIds.every((id) => get(s, 'variants', id).compareAtCents == null)))
        .map((x) => ({ productId: x.id, percent: rng.pick([20, 25, 30]) }));
    },
    prompt(s, p) {
      const pr = get(s, 'products', p.productId);
      return `Put "${pr.title}" (${pr.id}) in ${storeName(s, pr.storeId)} on sale: for every variant, set the compare-at price to the variant's current price and lower the price by ${p.percent}% (rounded to the nearest cent).`;
    },
    solve(env, p) {
      for (const id of get(env.state, 'products', p.productId).variantIds) {
        const v = get(env.state, 'variants', id);
        env.act('updateVariant', { variantId: id, compareAtCents: v.priceCents, priceCents: Math.round((v.priceCents * (100 - p.percent)) / 100) });
      }
    },
    check(final, initial, p) {
      const c = checker();
      for (const id of get(initial, 'products', p.productId).variantIds) {
        const v0 = get(initial, 'variants', id);
        const v = get(final, 'variants', id);
        c.need(v.compareAtCents === v0.priceCents, `${v.title}: compare-at should be ${fmtMoney(v0.priceCents)}`);
        c.need(v.priceCents === Math.round((v0.priceCents * (100 - p.percent)) / 100), `${v.title}: price should be ${fmtMoney(Math.round((v0.priceCents * (100 - p.percent)) / 100))}`);
      }
      integrity(c, final);
      return c.reasons;
    },
  },

  receive_inventory: {
    title: 'Receive a stock delivery',
    candidates(s, rng) {
      return rng.shuffle(s.variants.filter((v) => get(s, 'products', v.productId).status === 'active')).map((v) => {
        const store = get(s, 'stores', v.storeId);
        return { variantId: v.id, locationId: store.locationIds[0], quantity: rng.pick([24, 36, 48]) };
      });
    },
    prompt(s, p) {
      const v = get(s, 'variants', p.variantId);
      return `A supplier delivery of ${p.quantity} units of ${variantLabel(s, v)} arrived at ${locName(s, p.locationId)}. Add them to available inventory there, recording the adjustment with reason "received".`;
    },
    solve(env, p) { env.act('adjustInventory', { variantId: p.variantId, locationId: p.locationId, delta: p.quantity, reason: 'received' }); },
    check(final, initial, p) {
      const c = checker();
      stockDeltaCheck(c, initial, final, new Map([[`${p.variantId}|${p.locationId}`, p.quantity]]), 'stock');
      const adj = created(initial, final, 'inventoryAdjustments').filter((a) => a.variantId === p.variantId && a.locationId === p.locationId && a.reason === 'received');
      c.need(sumBy(adj, (a) => a.delta) === p.quantity, 'the increase should be recorded with reason "received"');
      integrity(c, final);
      return c.reasons;
    },
  },

  transfer_stock: {
    title: 'Transfer stock between locations',
    candidates(s, rng) {
      return rng.shuffle(s.variants.filter((v) => get(s, 'products', v.productId).status === 'active')).flatMap((v) => {
        const locs = get(s, 'stores', v.storeId).locationIds;
        if ((v.inventory[locs[0]] ?? 0) < 12) return [];
        return [{ variantId: v.id, fromLocationId: locs[0], toLocationId: locs[locs.length - 1], quantity: rng.int(4, 10) }];
      });
    },
    prompt(s, p) {
      const v = get(s, 'variants', p.variantId);
      return `Move ${p.quantity} units of ${variantLabel(s, v)} from ${locName(s, p.fromLocationId)} to ${locName(s, p.toLocationId)}.`;
    },
    solve(env, p) { env.act('transferInventory', p); },
    check(final, initial, p) {
      const c = checker();
      stockDeltaCheck(c, initial, final, new Map([[`${p.variantId}|${p.fromLocationId}`, -p.quantity], [`${p.variantId}|${p.toLocationId}`, p.quantity]]), 'stock');
      integrity(c, final);
      return c.reasons;
    },
  },

  cycle_count: {
    title: 'Apply cycle-count results',
    candidates(s, rng) {
      return rng.shuffle(STORE_IDS).map((storeId) => {
        const loc = get(s, 'stores', storeId).locationIds[0];
        const vs = rng.shuffle(s.variants.filter((v) => v.storeId === storeId && v.sku && get(s, 'products', v.productId).status === 'active')).slice(0, 3);
        return { storeId, locationId: loc, counts: vs.map((v) => ({ variantId: v.id, sku: v.sku, quantity: Math.max(0, (v.inventory[loc] ?? 0) + rng.pick([-3, -2, -1, 2, 4])) })) };
      });
    },
    feasible: (s, p) => p.counts.every((x) => x.quantity !== inv(s, x.variantId, p.locationId)),
    prompt(s, p) {
      return `A cycle count at ${locName(s, p.locationId)} (${storeName(s, p.storeId)}) found these on-hand quantities: ${p.counts.map((x) => `SKU ${x.sku}: ${x.quantity}`).join('; ')}. Set the available inventory at that location to the counted numbers.`;
    },
    solve(env, p) { for (const x of p.counts) env.act('setInventory', { storeId: p.storeId, sku: x.sku, locationId: p.locationId, quantity: x.quantity, reason: 'cycle_count' }); },
    check(final, initial, p) {
      const c = checker();
      stockDeltaCheck(c, initial, final, new Map(p.counts.map((x) => [`${x.variantId}|${p.locationId}`, x.quantity - inv(initial, x.variantId, p.locationId)])), 'count');
      integrity(c, final);
      return c.reasons;
    },
  },

  smart_collection: {
    title: 'Create an automated (smart) collection',
    candidates(s, rng) {
      const groups = new Map();
      for (const pr of s.products) { const k = `${pr.storeId}|${pr.vendor}|${pr.productType}`; groups.set(k, (groups.get(k) || 0) + 1); }
      return rng.shuffle([...groups.entries()].filter(([, n]) => n >= 2 && n <= 8)).map(([k]) => { const [storeId, vendor, productType] = k.split('|'); return { storeId, vendor, productType, title: `${vendor} ${productType} Edit` }; });
    },
    feasible: (s, p) => !s.collections.some((x) => x.storeId === p.storeId && sameStr(x.title, p.title)),
    prompt(s, p) {
      return `In ${storeName(s, p.storeId)}, create an automated (smart) collection titled "${p.title}" that automatically includes every product whose vendor is ${p.vendor} AND whose product type is ${p.productType}.`;
    },
    solve(env, p) {
      env.act('createCollection', { storeId: p.storeId, title: p.title, type: 'smart', disjunctive: false, rules: [{ column: 'vendor', relation: 'equals', condition: p.vendor }, { column: 'type', relation: 'equals', condition: p.productType }] });
    },
    check(final, initial, p) {
      const c = checker();
      const col = final.collections.find((x) => x.storeId === p.storeId && sameStr(x.title, p.title));
      if (!c.need(col, `collection "${p.title}" not found`)) return c.reasons;
      c.need(col.type === 'smart', 'collection should be automated (smart), not manual');
      const want = final.products.filter((x) => x.storeId === p.storeId && sameStr(x.vendor, p.vendor) && sameStr(x.productType, p.productType)).map((x) => x.id).sort();
      const got = collectionProductIds(final, col).sort();
      c.need(JSON.stringify(want) === JSON.stringify(got), `collection contains ${got.length} products, expected ${want.length}`);
      integrity(c, final);
      return c.reasons;
    },
  },

  manual_collection_add: {
    title: 'Add products to a manual collection',
    candidates(s, rng) {
      return rng.shuffle(s.collections.filter((x) => x.type === 'manual')).map((col) => ({
        collectionId: col.id,
        productIds: rng.shuffle(s.products.filter((x) => x.storeId === col.storeId && x.status === 'active' && !col.productIds.includes(x.id))).slice(0, 3).map((x) => x.id),
      }));
    },
    prompt(s, p) {
      const col = get(s, 'collections', p.collectionId);
      return `Add these products to the "${col.title}" collection (${col.id}) in ${storeName(s, col.storeId)}, keeping everything already in it: ${p.productIds.map((id) => `"${get(s, 'products', id).title}" (${id})`).join(', ')}.`;
    },
    solve(env, p) { env.act('addProductsToCollection', p); },
    check(final, initial, p) {
      const c = checker();
      const col = get(final, 'collections', p.collectionId);
      for (const id of p.productIds) c.need(col.productIds.includes(id), `${id} is not in the collection`);
      for (const id of get(initial, 'collections', p.collectionId).productIds) c.need(col.productIds.includes(id), `${id} was removed from the collection`);
      c.need(col.productIds.length === get(initial, 'collections', p.collectionId).productIds.length + p.productIds.length, 'unexpected products in the collection');
      integrity(c, final);
      return c.reasons;
    },
  },

  archive_vendor_type: {
    title: 'Archive a discontinued product line',
    candidates(s, rng) {
      const groups = new Map();
      for (const pr of s.products) if (pr.status !== 'archived') { const k = `${pr.storeId}|${pr.vendor}|${pr.productType}`; groups.set(k, (groups.get(k) || 0) + 1); }
      return rng.shuffle([...groups.entries()].filter(([, n]) => n >= 2 && n <= 8)).map(([k]) => { const [storeId, vendor, productType] = k.split('|'); return { storeId, vendor, productType }; });
    },
    prompt(s, p) {
      return `${p.vendor} has discontinued its ${p.productType} line. In ${storeName(s, p.storeId)}, archive every ${p.vendor} product with product type ${p.productType}. Leave all other products as they are.`;
    },
    solve(env, p) {
      for (const pr of env.query('listProducts', { storeId: p.storeId, vendor: p.vendor, productType: p.productType }).items) if (pr.status !== 'archived') env.act('updateProduct', { productId: pr.id, status: 'archived' });
    },
    check(final, initial, p) {
      const c = checker();
      for (const pr0 of initial.products) {
        const pr = get(final, 'products', pr0.id);
        const target = pr0.storeId === p.storeId && pr0.vendor === p.vendor && pr0.productType === p.productType;
        if (target) c.need(pr.status === 'archived', `${pr.title} should be archived`);
        else c.need(pr.status === pr0.status, `${pr.title} (${pr.id}) should not change status`);
      }
      integrity(c, final);
      return c.reasons;
    },
  },

  tag_vip_customers: {
    title: 'Tag high-spending customers',
    candidates(s, rng) {
      return rng.shuffle(STORE_IDS).flatMap((storeId) => {
        const spent = [...customerStats(s, storeId).values()].map((x) => x.totalSpentCents).sort((a, b) => b - a);
        const k = rng.int(6, 12);
        const t = Math.floor(spent[k - 1] / 10000) * 10000;
        return t > spent[k] ? [{ storeId, thresholdCents: t, tag: 'VIP' }] : [];
      });
    },
    prompt(s, p) {
      return `In ${storeName(s, p.storeId)}, add the tag "${p.tag}" to every customer whose total amount spent (payments minus refunds, over all their orders) is at least ${fmtMoney(p.thresholdCents)}. No other customer should have that tag.`;
    },
    solve(env, p) {
      for (const cu of env.query('listCustomers', { storeId: p.storeId, minSpentCents: p.thresholdCents }).items) env.act('addTags', { resource: 'customer', id: cu.id, tags: [p.tag] });
    },
    check(final, initial, p) {
      const c = checker();
      const stats = customerStats(initial, p.storeId);
      const want = new Set([...stats.entries()].filter(([, x]) => x.totalSpentCents >= p.thresholdCents).map(([id]) => id));
      for (const cu of final.customers.filter((x) => x.storeId === p.storeId)) {
        if (want.has(cu.id)) c.need(hasTag(cu.tags, p.tag), `${cu.id} should be tagged ${p.tag}`);
        else c.need(!hasTag(cu.tags, p.tag), `${cu.id} should not be tagged ${p.tag}`);
      }
      integrity(c, final);
      return c.reasons;
    },
  },

  update_default_address: {
    title: "Change a customer's default address",
    candidates(s, rng) {
      return rng.shuffle(s.customers.filter((x) => x.addresses.length === 1)).map((cu) => ({ customerId: cu.id, address1: `${rng.int(10, 999)} Harbor View Rd`, city: 'Bend', province: 'OR', zip: '97701' }));
    },
    prompt(s, p) {
      return `Customer ${custLabel(s, p.customerId)} moved. Add their new address — ${p.address1}, ${p.city}, ${p.province} ${p.zip}, US — and make it their default address. Keep the old address on file.`;
    },
    solve(env, p) { env.act('addCustomerAddress', { customerId: p.customerId, address1: p.address1, city: p.city, province: p.province, zip: p.zip, country: 'US', setDefault: true }); },
    check(final, initial, p) {
      const c = checker();
      const cu = get(final, 'customers', p.customerId);
      const def = cu.addresses.find((a) => a.isDefault);
      c.need(def && sameStr(def.address1, p.address1) && sameStr(def.city, p.city) && String(def.zip).trim() === p.zip, 'default address is not the new address');
      const old = get(initial, 'customers', p.customerId).addresses[0];
      c.need(cu.addresses.some((a) => a.id === old.id), 'old address should be kept');
      integrity(c, final);
      return c.reasons;
    },
  },

  create_customer: {
    title: 'Create a customer record',
    candidates(s, rng) {
      return rng.shuffle([['Marisol', 'Quintero'], ['Desmond', 'Achterberg'], ['Ingrid', 'Solheim'], ['Kofi', 'Mensah']]).map(([f, l]) => ({ storeId: rng.pick(STORE_IDS), firstName: f, lastName: l, email: `${f}.${l}@example.net`.toLowerCase(), phone: `+1555${rng.int(1000000, 9999999)}`, tag: 'wholesale', address1: `${rng.int(10, 999)} Canal St`, city: 'Albany', province: 'NY', zip: '12207' }));
    },
    prompt(s, p) {
      return `Create a customer in ${storeName(s, p.storeId)}: ${p.firstName} ${p.lastName}, email ${p.email}, phone ${p.phone}, tagged "${p.tag}", who has agreed to receive marketing emails, with default address ${p.address1}, ${p.city}, ${p.province} ${p.zip}, US.`;
    },
    solve(env, p) {
      env.act('createCustomer', { storeId: p.storeId, firstName: p.firstName, lastName: p.lastName, email: p.email, phone: p.phone, tags: [p.tag], acceptsMarketing: true, address: { address1: p.address1, city: p.city, province: p.province, zip: p.zip, country: 'US' } });
    },
    check(final, initial, p) {
      const c = checker();
      const list = created(initial, final, 'customers').filter((x) => x.storeId === p.storeId && x.email === p.email);
      if (!c.need(list.length === 1, `expected one new customer with email ${p.email}`)) return c.reasons;
      const cu = list[0];
      c.need(sameStr(cu.firstName, p.firstName) && sameStr(cu.lastName, p.lastName), 'name is wrong');
      c.need(cu.phone.replace(/[^\d+]/g, '') === p.phone, 'phone is wrong');
      c.need(hasTag(cu.tags, p.tag), `should be tagged ${p.tag}`);
      c.need(cu.acceptsMarketing === true, 'should accept marketing');
      const def = cu.addresses.find((a) => a.isDefault);
      c.need(def && sameStr(def.address1, p.address1) && sameStr(def.city, p.city), 'default address is wrong');
      integrity(c, final);
      return c.reasons;
    },
  },

  storefront_checkout: {
    title: 'Place an order through the storefront with a discount code',
    candidates(s, rng, v) {
      const out = [];
      for (const cu of rng.shuffle(s.customers.filter((x) => x.addresses.length)).slice(0, 60)) {
        const store = get(s, 'stores', cu.storeId);
        const d = findDiscountByCode(s, store.id, v.code);
        if (!d || discountStatus(d, s.meta.today) !== 'active' || customerUsedDiscount(s, d, cu.id, cu.email)) continue;
        const vs = rng.shuffle(s.variants.filter((x) => x.storeId === store.id && x.inventoryPolicy === 'deny' && get(s, 'products', x.productId).status === 'active')).slice(0, 2);
        const lines = vs.map((x, i) => ({ variantId: x.id, quantity: i === 0 ? 2 : 1 }));
        if (!chooseLocation(s, store, lines)) continue;
        try { priceLines(s, store, lines, { discount: d, shippingMethod: 'standard' }); } catch { continue; }
        out.push({ storeId: store.id, customerId: cu.id, lines, code: v.code });
      }
      return out;
    },
    prompt(s, p) {
      return `Acting as the shopper ${custLabel(s, p.customerId)} on the ${storeName(s, p.storeId)} storefront, use a cart and checkout to buy ${fmtLines(s, p.lines)}. Apply discount code ${p.code} and choose standard shipping to the customer's default address.`;
    },
    solve(env, p) {
      const { cart } = env.act('createCart', { storeId: p.storeId, customerId: p.customerId });
      for (const l of p.lines) env.act('addToCart', { cartId: cart.id, variantId: l.variantId, quantity: l.quantity });
      env.act('applyDiscountCode', { cartId: cart.id, code: p.code });
      env.act('checkout', { cartId: cart.id, shippingMethod: 'standard' });
    },
    check(final, initial, p) {
      const c = checker();
      const orders = created(initial, final, 'orders').filter((o) => o.customerId === p.customerId);
      if (!c.need(orders.length === 1, `expected exactly 1 new order for ${p.customerId}, found ${orders.length}`)) return c.reasons;
      const o = orders[0];
      c.need(o.source === 'online_store', 'order should come from the storefront checkout');
      c.need(final.carts.some((x) => x.orderId === o.id && x.status === 'completed'), 'no completed cart produced the order');
      c.need(sameStr(o.discountCode, p.code) && o.discountCents > 0, `discount ${p.code} was not applied`);
      c.need(o.shippingMethod === 'standard', 'shipping should be standard');
      c.need(o.financialStatus === 'paid', 'order should be paid');
      const want = p.lines.map((l) => `${l.variantId}x${l.quantity}`).sort().join(',');
      const got = o.lineItems.map((l) => `${l.variantId}x${l.quantity}`).sort().join(',');
      c.need(want === got, `items mismatch: want ${want}, got ${got}`);
      stockDeltaCheck(c, initial, final, new Map(o.lineItems.map((l) => [`${l.variantId}|${o.locationId}`, -l.quantity])), 'inventory');
      integrity(c, final);
      return c.reasons;
    },
  },

  manual_order_pending: {
    title: 'Create a manual order with payment pending',
    candidates(s, rng) {
      return rng.shuffle(s.customers.filter((x) => x.addresses.length)).slice(0, 40).flatMap((cu) => {
        const store = get(s, 'stores', cu.storeId);
        const vs = rng.shuffle(s.variants.filter((x) => x.storeId === store.id && x.sku && get(s, 'products', x.productId).status === 'active')).slice(0, 2);
        const lines = vs.map((x) => ({ variantId: x.id, quantity: rng.int(2, 4) }));
        return chooseLocation(s, store, lines) ? [{ storeId: store.id, customerId: cu.id, lines, tag: 'wholesale' }] : [];
      });
    },
    prompt(s, p) {
      return `${custLabel(s, p.customerId)} phoned in a wholesale order to ${storeName(s, p.storeId)}: ${fmtLines(s, p.lines)}. Create the order from the admin for this customer with standard shipping to their default address, no discount, payment pending (they will pay by invoice), and tag it "${p.tag}".`;
    },
    solve(env, p) { env.act('createOrder', { storeId: p.storeId, customerId: p.customerId, lineItems: p.lines, shippingMethod: 'standard', paymentStatus: 'pending', tags: [p.tag] }); },
    check(final, initial, p) {
      const c = checker();
      const orders = created(initial, final, 'orders').filter((o) => o.customerId === p.customerId);
      if (!c.need(orders.length === 1, `expected exactly 1 new order for ${p.customerId}, found ${orders.length}`)) return c.reasons;
      const o = orders[0];
      c.need(o.financialStatus === 'pending', `payment should be pending, is ${o.financialStatus}`);
      c.need(hasTag(o.tags, p.tag), `order should be tagged ${p.tag}`);
      c.need(!o.discountId, 'no discount should be applied');
      const want = p.lines.map((l) => `${l.variantId}x${l.quantity}`).sort().join(',');
      const got = o.lineItems.map((l) => `${l.variantId}x${l.quantity}`).sort().join(',');
      c.need(want === got, `items mismatch: want ${want}, got ${got}`);
      integrity(c, final);
      return c.reasons;
    },
  },

  update_tracking: {
    title: 'Correct the tracking number on a shipment',
    candidates(s, rng) {
      return rng.shuffle(s.fulfillments.filter((f) => f.status === 'success' && f.trackingCompany && get(s, 'orders', f.orderId).status === 'open'))
        .map((f) => { const carrier = rng.pick(CARRIERS.filter((x) => x !== f.trackingCompany)); return { fulfillmentId: f.id, orderId: f.orderId, carrier, trackingNumber: trackingNumberFor(rng, carrier) }; });
    },
    prompt(s, p) {
      const f = get(s, 'fulfillments', p.fulfillmentId);
      return `The warehouse entered the wrong tracking on shipment ${f.id} of order ${orderLabel(s, get(s, 'orders', p.orderId))} (currently ${f.trackingCompany} ${f.trackingNumber}). It actually shipped with ${p.carrier}, tracking number ${p.trackingNumber}. Correct the tracking on that fulfillment.`;
    },
    solve(env, p) { env.act('updateFulfillmentTracking', { fulfillmentId: p.fulfillmentId, trackingCompany: p.carrier, trackingNumber: p.trackingNumber }); },
    check(final, initial, p) {
      const c = checker();
      const f = get(final, 'fulfillments', p.fulfillmentId);
      c.need(f.status === 'success', 'the fulfillment should not be cancelled');
      c.need(sameStr(f.trackingCompany, p.carrier) && f.trackingNumber === p.trackingNumber, 'tracking was not corrected');
      c.need(get(final, 'orders', p.orderId).fulfillmentStatus === get(initial, 'orders', p.orderId).fulfillmentStatus, 'order fulfillment status should not change');
      integrity(c, final);
      return c.reasons;
    },
  },

  refund_shipping: {
    title: 'Refund only the shipping charge',
    candidates(s, rng) {
      return rng.shuffle(s.orders.filter((o) => o.financialStatus === 'paid' && o.fulfillmentStatus === 'fulfilled' && o.shippingCents - o.shippingDiscountCents > 0 && o.status === 'open')).map((o) => ({ orderId: o.id }));
    },
    prompt(s, p) {
      const o = get(s, 'orders', p.orderId);
      return `Order ${orderLabel(s, o)} was delivered a week late. As an apology, refund the customer's full shipping charge (${fmtMoney(o.shippingCents - o.shippingDiscountCents)}) — shipping only, no items.`;
    },
    solve(env, p) { env.act('createRefund', { orderId: p.orderId, refundShipping: true, reason: 'late_delivery' }); },
    check(final, initial, p) {
      const c = checker();
      const o = get(final, 'orders', p.orderId);
      const ship = o.shippingCents - o.shippingDiscountCents;
      const refs = newRefunds(initial, final, p.orderId);
      c.need(sumBy(refs, (r) => r.shippingCents) === ship, `shipping refunded ${fmtMoney(sumBy(refs, (r) => r.shippingCents))}, expected ${fmtMoney(ship)}`);
      c.need(sumBy(refs, (r) => r.amountCents) === ship, 'refund amount should equal the shipping charge');
      c.need(refs.every((r) => r.lineItems.length === 0), 'no items should be refunded');
      c.need(o.financialStatus === 'partially_refunded', `order should be partially refunded, is ${o.financialStatus}`);
      integrity(c, final);
      return c.reasons;
    },
  },

  close_fulfilled_orders: {
    title: 'Archive completed orders from a date window',
    candidates(s, rng) {
      const out = [];
      for (const storeId of rng.shuffle(STORE_IDS)) {
        for (let back = 35; back <= 90; back += 7) {
          const to = addDays(s.meta.today, -back);
          const from = addDays(to, -2);
          const ids = s.orders.filter((o) => o.storeId === storeId && o.status === 'open' && o.fulfillmentStatus === 'fulfilled' && o.financialStatus === 'paid' && dateOf(o.createdAt) >= from && dateOf(o.createdAt) <= to).map((o) => o.id);
          if (ids.length >= 4 && ids.length <= 15) out.push({ storeId, from, to, orderIds: ids });
        }
      }
      return out;
    },
    prompt(s, p) {
      return `Housekeeping for ${storeName(s, p.storeId)}: archive (close) every open order placed between ${p.from} and ${p.to} (inclusive) that is fully fulfilled and fully paid (payment status "paid"). Do not change any other order.`;
    },
    solve(env, p) {
      for (const o of env.query('listOrders', { storeId: p.storeId, status: 'open', fulfillmentStatus: 'fulfilled', financialStatus: 'paid', from: p.from, to: p.to }).items) env.act('closeOrder', { orderId: o.id });
    },
    check(final, initial, p) {
      const c = checker();
      const ids = new Set(p.orderIds);
      for (const o0 of initial.orders) {
        const o = get(final, 'orders', o0.id);
        if (ids.has(o0.id)) c.need(o.status === 'closed', `${o.name} (${o.id}) should be closed`);
        else c.need(o.status === o0.status, `${o.name} (${o.id}) should not change status`);
      }
      integrity(c, final);
      return c.reasons;
    },
  },

  restock_low_inventory: {
    title: 'Top up low stock for one vendor at one location',
    candidates(s, rng) {
      const out = [];
      for (const storeId of rng.shuffle(STORE_IDS)) {
        const store = get(s, 'stores', storeId);
        for (const vendor of [...new Set(s.products.filter((x) => x.storeId === storeId).map((x) => x.vendor))].sort()) {
          const loc = store.locationIds[0];
          const rows = s.variants.filter((v) => v.storeId === storeId && get(s, 'products', v.productId).vendor === vendor && get(s, 'products', v.productId).status === 'active' && (v.inventory[loc] ?? 0) < 5);
          if (rows.length >= 3 && rows.length <= 15) out.push({ storeId, vendor, locationId: loc, below: 5, target: 20, variantIds: rows.map((v) => v.id) });
        }
      }
      return out;
    },
    prompt(s, p) {
      return `A ${p.vendor} restock arrived at ${locName(s, p.locationId)} (${storeName(s, p.storeId)}). For every variant of an active ${p.vendor} product that currently has fewer than ${p.below} units available at that location, set its available quantity there to ${p.target}. Leave all other inventory unchanged.`;
    },
    solve(env, p) {
      for (const id of env.state.variants.filter((v) => v.storeId === p.storeId).map((v) => v.id)) {
        const v = get(env.state, 'variants', id);
        const pr = get(env.state, 'products', v.productId);
        if (pr.vendor === p.vendor && pr.status === 'active' && (v.inventory[p.locationId] ?? 0) < p.below) env.act('setInventory', { variantId: v.id, locationId: p.locationId, quantity: p.target, reason: 'received' });
      }
    },
    check(final, initial, p) {
      const c = checker();
      const ids = new Set(p.variantIds);
      for (const v0 of initial.variants.filter((v) => v.storeId === p.storeId)) {
        const want = ids.has(v0.id) ? p.target : inv(initial, v0.id, p.locationId);
        c.need(inv(final, v0.id, p.locationId) === want, `${v0.sku} at ${p.locationId} should be ${want}, is ${inv(final, v0.id, p.locationId)}`);
      }
      integrity(c, final);
      return c.reasons;
    },
  },

  tag_top_product: {
    title: 'Tag the best-selling product (analytics)',
    candidates(s, rng) { return rng.shuffle(STORE_IDS).map((storeId) => ({ storeId, tag: 'top-seller', productId: topProducts(s, { storeId, by: 'units', limit: 1 }).items[0].productId })); },
    feasible(s, p) {
      const top = topProducts(s, { storeId: p.storeId, by: 'units', limit: 2 }).items;
      return top.length === 2 && top[0].unitsSold > top[1].unitsSold && !s.products.some((x) => hasTag(x.tags, p.tag));
    },
    prompt(s, p) {
      return `Using the sales analytics for ${storeName(s, p.storeId)}, find the product with the most net units sold over the last 30 days (${addDays(s.meta.today, -29)} to ${s.meta.today}, excluding cancelled orders and refunded units) and add the tag "${p.tag}" to it. No other product should carry that tag.`;
    },
    solve(env, p) {
      const top = env.query('topProducts', { storeId: p.storeId, by: 'units', limit: 1 }).items[0];
      env.act('addTags', { resource: 'product', id: top.productId, tags: [p.tag] });
    },
    check(final, initial, p) {
      const c = checker();
      c.need(hasTag(get(final, 'products', p.productId).tags, p.tag), `${p.productId} should be tagged ${p.tag}`);
      const others = final.products.filter((x) => x.id !== p.productId && hasTag(x.tags, p.tag));
      c.need(others.length === 0, `other products are tagged ${p.tag}: ${others.map((x) => x.id).join(', ')}`);
      integrity(c, final);
      return c.reasons;
    },
  },

  order_note_tags: {
    title: 'Tag an order and add a note',
    candidates(s, rng) { return rng.shuffle(readyToShip(s).filter((o) => !o.note && !o.tags.length)).map((o) => ({ orderId: o.id, tag: 'priority', note: `Ship before ${addDays(s.meta.today, 2)} - customer travelling` })); },
    prompt(s, p) {
      const o = get(s, 'orders', p.orderId);
      return `Flag order ${orderLabel(s, o)} for the warehouse: add the tag "${p.tag}" and set the order note to "${p.note}". Do not fulfill it yet.`;
    },
    solve(env, p) {
      env.act('addTags', { resource: 'order', id: p.orderId, tags: [p.tag] });
      env.act('updateOrder', { orderId: p.orderId, note: p.note });
    },
    check(final, initial, p) {
      const c = checker();
      const o = get(final, 'orders', p.orderId);
      c.need(hasTag(o.tags, p.tag), `order should be tagged ${p.tag}`);
      c.need(String(o.note).trim() === p.note, 'order note is wrong');
      c.need(o.fulfillmentStatus === 'unfulfilled', 'order must not be fulfilled');
      integrity(c, final);
      return c.reasons;
    },
  },
};
