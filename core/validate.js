// Global invariants. Returns a list of human-readable problems ([] == valid).
import { byId, deriveFinancialStatus, deriveFulfillmentStatus, paymentTotals } from './model.js';

export function validateState(state) {
  const problems = [];
  const txs = new Map();
  for (const t of state.transactions) {
    if (!txs.has(t.orderId)) txs.set(t.orderId, []);
    txs.get(t.orderId).push(t);
  }
  const fulfilled = new Map();
  for (const f of state.fulfillments) {
    if (f.status !== 'success') continue;
    for (const l of f.lineItems) fulfilled.set(l.lineItemId, (fulfilled.get(l.lineItemId) || 0) + l.quantity);
  }
  const refunded = new Map();
  const refundAmt = new Map();
  for (const r of state.refunds) {
    for (const l of r.lineItems) refunded.set(l.lineItemId, (refunded.get(l.lineItemId) || 0) + l.quantity);
    refundAmt.set(r.orderId, (refundAmt.get(r.orderId) || 0) + r.amountCents);
  }
  const returned = new Map();
  for (const r of state.returns) {
    if (!['requested', 'open', 'closed'].includes(r.status)) continue;
    for (const l of r.lineItems) returned.set(l.lineItemId, (returned.get(l.lineItemId) || 0) + l.quantity);
  }
  const discountUses = new Map();
  for (const o of state.orders) {
    const sub = o.lineItems.reduce((a, l) => a + l.priceCents * l.quantity, 0);
    const disc = o.lineItems.reduce((a, l) => a + l.discountCents, 0);
    const tax = o.lineItems.reduce((a, l) => a + l.taxCents, 0);
    if (sub !== o.subtotalCents || disc !== o.discountCents || tax !== o.taxCents) problems.push(`${o.id}: totals do not match line items`);
    if (o.totalCents !== o.subtotalCents - o.discountCents + o.shippingCents - o.shippingDiscountCents + o.taxCents) problems.push(`${o.id}: totalCents mismatch`);
    for (const l of o.lineItems) {
      if ((fulfilled.get(l.id) || 0) !== l.fulfilledQty) problems.push(`${o.id}/${l.id}: fulfilledQty ${l.fulfilledQty} != fulfillments ${fulfilled.get(l.id) || 0}`);
      if ((refunded.get(l.id) || 0) !== l.refundedQty) problems.push(`${o.id}/${l.id}: refundedQty ${l.refundedQty} != refunds ${refunded.get(l.id) || 0}`);
      if (l.fulfilledQty + l.removedQty > l.quantity || l.refundedQty > l.quantity || l.fulfilledQty < 0) problems.push(`${o.id}/${l.id}: quantities out of range`);
      if ((returned.get(l.id) || 0) > l.fulfilledQty) problems.push(`${o.id}/${l.id}: more units in returns than fulfilled`);
    }
    const ot = txs.get(o.id) || [];
    if (deriveFinancialStatus(o, ot) !== o.financialStatus) problems.push(`${o.id}: financialStatus ${o.financialStatus} != derived ${deriveFinancialStatus(o, ot)}`);
    if (deriveFulfillmentStatus(o) !== o.fulfillmentStatus) problems.push(`${o.id}: fulfillmentStatus ${o.fulfillmentStatus} != derived`);
    const pay = paymentTotals(ot);
    if (pay.refunded > pay.captured) problems.push(`${o.id}: refunded more than captured`);
    if (pay.refunded !== (refundAmt.get(o.id) || 0)) problems.push(`${o.id}: refund transactions != refund records`);
    if (o.status === 'cancelled' && o.lineItems.some((l) => l.fulfilledQty > 0)) problems.push(`${o.id}: cancelled with fulfilled items`);
    if (o.discountId) discountUses.set(o.discountId, (discountUses.get(o.discountId) || 0) + 1);
  }
  for (const d of state.discounts) {
    if ((discountUses.get(d.id) || 0) !== d.usageCount) problems.push(`${d.id}: usageCount ${d.usageCount} != orders ${discountUses.get(d.id) || 0}`);
    if (d.usageLimit != null && d.usageCount > d.usageLimit) problems.push(`${d.id}: usage limit exceeded`);
  }
  const skus = new Set();
  for (const v of state.variants) {
    const p = byId(state, 'products', v.productId);
    if (!p || !p.variantIds.includes(v.id)) problems.push(`${v.id}: not linked to its product`);
    if (v.sku) {
      const k = `${v.storeId}|${v.sku.toLowerCase()}`;
      if (skus.has(k)) problems.push(`${v.id}: duplicate SKU ${v.sku}`);
      skus.add(k);
    }
    if (v.inventoryPolicy === 'deny') for (const [loc, q] of Object.entries(v.inventory)) if (q < 0) problems.push(`${v.id}: negative stock ${q} at ${loc}`);
  }
  const emails = new Set();
  for (const c of state.customers) {
    const k = `${c.storeId}|${c.email}`;
    if (emails.has(k)) problems.push(`${c.id}: duplicate email ${c.email}`);
    emails.add(k);
    if (c.addresses.length && c.addresses.filter((a) => a.isDefault).length !== 1) problems.push(`${c.id}: must have exactly one default address`);
  }
  return problems;
}
