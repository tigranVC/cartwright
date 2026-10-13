import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, ROUTES, READS } from '../server/app.js';
import { ACTIONS, QUERIES } from '../core/index.js';
import { loadTasks, KINDS } from '../tasks/index.js';

let server;
let base;
before(async () => {
  const app = createApp({ seed: 42 });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const call = async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};

test('every core action and query has a REST route', () => {
  assert.deepEqual([...new Set(ROUTES.map((r) => r[2]))].sort(), Object.keys(ACTIONS).sort());
  const missing = Object.keys(QUERIES).filter((q) => !READS.some((r) => r[1] === q) && !['getOrder', 'previewPricing'].includes(q));
  assert.deepEqual(missing, []);
});

test('health, summary, catalog endpoints', async () => {
  const { body } = await call('GET', '/api/state/summary');
  assert.equal(body.meta.seed, 42);
  assert.equal(body.counts.stores, 3);
  assert.equal(body.counts.products, 300);
  const stores = (await call('GET', '/api/stores')).body.result;
  assert.equal(stores[0].locations.length, 2);
  const prods = (await call('GET', '/api/products?storeId=STO-2&limit=5')).body.result;
  assert.equal(prods.items.length, 5);
  const p = (await call('GET', `/api/products/${prods.items[0].id}`)).body.result;
  assert.ok(p.variants.length >= 1);
  assert.ok((await call('GET', '/api/inventory?storeId=STO-1&locationId=LOC-01&belowQty=3&limit=5')).body.result.items.every((r) => r.available < 3));
  assert.ok(Array.isArray((await call('GET', '/api/inventory/adjustments')).body.result.items));
  assert.equal((await call('GET', '/api/products/PRD-9999')).status, 404);
  assert.equal((await call('GET', '/api/nope')).status, 404);
  assert.equal((await call('GET', '/api/state/validate')).body.ok, true);
});

test('order workflow over REST: fulfill, refund, close; reset restores seed', async () => {
  await call('POST', '/reset', { seed: 42 });
  const o = (await call('GET', '/api/orders?storeId=STO-1&financialStatus=paid&fulfillmentStatus=unfulfilled&limit=1')).body.result.items[0];
  const byName = (await call('GET', `/api/orders/by-name/STO-1/${o.name.slice(1)}`)).body.result;
  assert.equal(byName.id, o.id);
  const f = await call('POST', `/api/orders/${o.id}/fulfillments`, { trackingCompany: 'UPS', trackingNumber: '1Z42' });
  assert.equal(f.status, 200);
  assert.equal(f.body.result.order.fulfillmentStatus, 'fulfilled');
  const bad = await call('POST', `/api/orders/${o.id}/fulfillments`, {});
  assert.equal(bad.status, 422);
  assert.equal(bad.body.error.code, 'NOTHING_TO_FULFILL');
  const r = await call('POST', `/api/orders/${o.id}/refunds`, { lineItems: [{ lineItemId: o.lineItems[0].id, quantity: 1, restock: true }] });
  assert.equal(r.status, 200);
  assert.equal((await call('POST', `/api/orders/${o.id}/close`)).status, 200);
  const detail = (await call('GET', `/api/orders/${o.id}`)).body.result;
  assert.equal(detail.status, 'closed');
  assert.equal(detail.refunds.length, 1);
  assert.equal((await call('GET', `/api/fulfillments/${detail.fulfillments[0].id}`)).body.result.trackingNumber, '1Z42');
  const reset = await call('POST', '/api/reset');
  assert.ok(reset.body.ok);
  assert.equal((await call('GET', `/api/orders/${o.id}`)).body.result.status, 'open');
  assert.equal((await call('GET', '/api/action-log')).body.length, 0);
});

test('storefront and discounts over REST', async () => {
  await call('POST', '/reset', { seed: 42 });
  const d = await call('POST', '/api/discounts', { storeId: 'STO-3', code: 'REST15', type: 'percentage', value: 15 });
  assert.equal(d.status, 200);
  assert.equal(d.body.result.status, 'active');
  const items = (await call('GET', '/api/storefront/products?storeId=STO-3&limit=20')).body.result.items;
  const v = items.flatMap((p) => p.variants).find((x) => x.available);
  const cart = (await call('POST', '/api/carts', { storeId: 'STO-3' })).body.result.cart;
  assert.equal((await call('POST', `/api/carts/${cart.id}/lines`, { variantId: v.id, quantity: 1 })).status, 200);
  assert.equal((await call('POST', `/api/carts/${cart.id}/discount`, { code: 'rest15' })).status, 200);
  const co = await call('POST', `/api/carts/${cart.id}/checkout`, { email: 'rest@example.com', shippingMethod: 'pickup' });
  assert.equal(co.status, 200);
  assert.equal(co.body.result.order.discountCode, 'REST15');
  const sum = (await call('GET', '/api/analytics/summary?storeId=STO-3')).body.result;
  assert.ok(sum.orders > 0);
  const top = (await call('GET', '/api/analytics/top-products?storeId=STO-3&by=revenue&limit=3')).body.result;
  assert.equal(top.items.length, 3);
  const generic = await call('POST', '/api/actions/deactivateDiscount', { discountId: d.body.result.discount.id });
  assert.equal(generic.status, 200);
  const q = await call('POST', '/api/queries/getDiscount', { storeId: 'STO-3', code: 'REST15' });
  assert.equal(q.body.result.status, 'disabled');
  assert.equal(q.body.result.ordersCount, 1);
  assert.equal((await call('POST', '/api/actions/bogus', {})).status, 404);
});

test('task endpoints: start, solve via REST, check', async () => {
  const list = (await call('GET', '/api/tasks')).body;
  assert.equal(list.length, loadTasks().length);
  assert.equal(list[0].params, undefined);
  const t = loadTasks().find((x) => x.kind === 'mark_paid');
  const start = await call('POST', `/api/tasks/${t.id}/start`);
  assert.equal(start.body.task.seed, t.seed);
  assert.equal((await call('POST', `/api/tasks/${t.id}/check`)).body.pass, false);
  assert.equal((await call('POST', `/api/orders/${t.params.orderId}/mark-paid`, {})).status, 200);
  const check = (await call('POST', `/api/tasks/${t.id}/check`)).body;
  assert.deepEqual(check.reasons, []);
  assert.equal(check.pass, true);
  assert.ok(KINDS[t.kind]);
});
