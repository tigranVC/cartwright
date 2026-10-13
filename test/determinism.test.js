import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateState, validateState, Rng, replay, createEngine } from '../core/index.js';

test('same seed produces identical state', () => {
  assert.equal(JSON.stringify(generateState(42)), JSON.stringify(generateState(42)));
  assert.equal(JSON.stringify(generateState('abc')), JSON.stringify(generateState('abc')));
});

test('different seeds produce different worlds', () => {
  assert.notEqual(JSON.stringify(generateState(1).orders), JSON.stringify(generateState(2).orders));
});

test('PRNG sequence is stable across runs and engines', () => {
  const a = new Rng(7);
  const seq = Array.from({ length: 5 }, () => a.int(0, 1000));
  const b = new Rng(7);
  assert.deepEqual(seq, Array.from({ length: 5 }, () => b.int(0, 1000)));
});

test('seeded world has the expected shape and size', () => {
  const s = generateState(42);
  assert.equal(s.stores.length, 3);
  assert.equal(s.locations.length, 7);
  assert.equal(s.products.length, 300);
  assert.ok(s.variants.length > 1000, `variants=${s.variants.length}`);
  assert.ok(s.customers.length >= 1900);
  assert.ok(s.orders.length >= 4000);
  assert.ok(s.collections.some((c) => c.type === 'manual') && s.collections.some((c) => c.type === 'smart'));
  for (const k of ['financialStatus', 'fulfillmentStatus', 'status']) {
    const vals = new Set(s.orders.map((o) => o[k]));
    assert.ok(vals.size >= 3, `${k}: ${[...vals]}`);
  }
  for (const st of ['pending', 'authorized', 'paid', 'partially_refunded', 'refunded', 'voided']) assert.ok(s.orders.some((o) => o.financialStatus === st), `no ${st} orders`);
  for (const st of ['unfulfilled', 'partial', 'fulfilled']) assert.ok(s.orders.some((o) => o.fulfillmentStatus === st), `no ${st} orders`);
  assert.ok(s.returns.some((r) => r.status === 'requested'));
  assert.ok(s.orders.some((o) => o.discountId));
});

test('seeded worlds satisfy all invariants', () => {
  for (const seed of [42, 1, 101, 'xyz']) assert.deepEqual(validateState(generateState(seed)), [], `seed ${seed}`);
});

test('replaying the action log reproduces the state', () => {
  const e = createEngine(5);
  const o = e.state.orders.find((x) => x.status === 'open' && x.financialStatus === 'paid' && x.fulfillmentStatus === 'unfulfilled');
  assert.ok(e.dispatch('createFulfillment', { orderId: o.id, trackingCompany: 'UPS', trackingNumber: '1Z1' }).ok);
  assert.ok(e.dispatch('createRefund', { orderId: o.id, lineItems: [{ lineItemId: o.lineItems[0].id, quantity: 1, restock: true }] }).ok);
  const cart = e.dispatch('createCart', { storeId: 'STO-3' }).result.cart;
  const v = e.query('storefrontProducts', { storeId: 'STO-3' }).result.items.flatMap((p) => p.variants).find((x) => x.available);
  assert.ok(e.dispatch('addToCart', { cartId: cart.id, variantId: v.id }).ok);
  assert.ok(e.dispatch('checkout', { cartId: cart.id, email: 'replay@example.com', shippingMethod: 'pickup' }).ok);
  assert.equal(e.dispatch('closeOrder', { orderId: 'ORD-999999' }).ok, false); // failures are not logged
  const again = replay(5, e.state.actionLog);
  assert.equal(JSON.stringify(again), JSON.stringify(e.state));
  assert.deepEqual(validateState(e.state), []);
});
