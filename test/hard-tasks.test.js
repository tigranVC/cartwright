import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, generateState, dateOf } from '../core/index.js';
import { loadTasks, checkTask, solveTask, KINDS, makeEnv } from '../tasks/index.js';
import { instantiateTask } from '../tasks/generate.js';

const tasks = loadTasks();
const hard = tasks.filter((t) => (t.tags || []).includes('hard'));
const byKind = (kind) => hard.find((t) => t.kind === kind);

test('exactly 10 tasks are tagged hard, with distinct kinds', () => {
  assert.equal(hard.length, 10);
  assert.equal(new Set(hard.map((t) => t.kind)).size, 10);
  assert.deepEqual(hard.map((t) => t.id), tasks.slice(32).map((t) => t.id));
});

for (const t of hard) {
  for (const seed of [t.seed, 1, 2, 3]) {
    test(`hard task ${t.id} on seed ${seed}: fails untouched, passes after the scripted solution`, () => {
      const inst = seed === t.seed ? t : instantiateTask(t.id, seed);
      assert.equal(inst.seed, seed);
      assert.equal(inst.kind, t.kind);
      assert.ok(inst.prompt.length > 200);
      assert.equal(checkTask(inst, generateState(seed)).pass, false, 'checker must fail on the untouched world');
      const engine = createEngine(seed);
      KINDS[inst.kind].solve(makeEnv(engine), inst.params);
      assert.ok(engine.state.actionLog.length >= 3, 'a hard task needs several mutating actions');
      const res = checkTask(inst, engine.state);
      assert.deepEqual(res.reasons, []);
      assert.equal(res.pass, true);
    });
  }
}

// ---- negative tests: plausible but wrong or partial solutions must fail ---------------
const fresh = (t) => { const e = createEngine(t.seed); return { e, env: makeEnv(e) }; };
const fails = (t, e) => { const r = checkTask(t, e.state); assert.equal(r.pass, false); assert.ok(r.reasons.length > 0); return r.reasons; };

test('return queue: approving and restocking every request (ignoring the policy) fails', () => {
  const t = byKind('process_return_queue');
  const { e, env } = fresh(t);
  for (const r of env.query('listReturns', { storeId: t.params.storeId, status: 'requested' }).items) {
    env.act('approveReturn', { returnId: r.id });
    env.act('refundReturn', { returnId: r.id, restock: true });
  }
  const reasons = fails(t, e);
  assert.ok(reasons.some((x) => x.includes('should be declined')));
});

test('replacement: doing only the refund step fails', () => {
  const t = byKind('replace_damaged_item');
  const { e, env } = fresh(t);
  env.act('createRefund', { orderId: t.params.orderId, lineItems: [{ lineItemId: t.params.lineItemId, quantity: 1, restock: false }], reason: 'damaged' });
  const reasons = fails(t, e);
  assert.ok(reasons.some((x) => x.includes('expected exactly 1 new order')));
});

test('replacement: restocking the damaged unit instead of discarding it fails', () => {
  const t = byKind('replace_damaged_item');
  const engine = createEngine(t.seed);
  const env = makeEnv(engine);
  const act = env.act.bind(env);
  env.act = (type, p) => act(type, type === 'createRefund' ? { ...p, lineItems: p.lineItems.map((l) => ({ ...l, restock: true })) } : p);
  KINDS[t.kind].solve(env, t.params);
  fails(t, engine);
});

test('count sheet: setting the raw counted numbers (not netting out unshipped units) fails', () => {
  const t = byKind('count_sheet_committed');
  const { e, env } = fresh(t);
  for (const x of t.params.rows) env.act('setInventory', { variantId: x.variantId, locationId: t.params.locationId, quantity: x.counted, reason: 'cycle_count' });
  fails(t, e);
});

test('unpaid cleanup: cancelling the order that was paid by bank transfer (wrong entity) fails', () => {
  const t = byKind('pending_payment_cleanup');
  const { e, env } = fresh(t);
  for (const o of env.query('listOrders', { storeId: t.params.storeId, status: 'open', financialStatus: 'pending' }).items) {
    if (dateOf(o.createdAt) <= t.params.cutoff || o.id === t.params.paidOrderId) env.act('cancelOrder', { orderId: o.id, reason: 'declined', restock: true });
    else env.act('addTags', { resource: 'order', id: o.id, tags: [t.params.tag] });
  }
  const reasons = fails(t, e);
  assert.ok(reasons.some((x) => x.includes('should be open and paid')));
});

test('merge customers: keeping the newer account as primary (wrong direction) fails', () => {
  const t = byKind('merge_duplicate_customers');
  const { e, env } = fresh(t);
  KINDS[t.kind].solve(env, { ...t.params, primaryId: t.params.duplicateId, duplicateId: t.params.primaryId });
  fails(t, e);
});

test('retail top-up: setting retail stock to the target without transferring from the warehouse fails', () => {
  const t = byKind('retail_restock_transfer');
  const engine = solveTask(t);
  assert.equal(checkTask(t, engine.state).pass, true);
  const { e, env } = fresh(t);
  const p = t.params;
  for (const v of env.query('listVariants', { storeId: p.storeId, locationId: p.retailId, belowQty: p.below }).items) {
    if (v.vendor === p.vendor && v.productStatus === 'active' && v.inventoryPolicy === 'deny' && env.query('getProduct', { productId: v.productId }).productType === p.productType) {
      env.act('setInventory', { variantId: v.id, locationId: p.retailId, quantity: p.target });
    }
  }
  fails(t, e);
});

test('express batch: also shipping a standard-shipping order in the window fails', () => {
  const t = byKind('fulfill_express_batch');
  const engine = solveTask(t);
  assert.equal(checkTask(t, engine.state).pass, true);
  const extra = engine.state.orders.find((o) => o.storeId === t.params.storeId && o.status === 'open' && o.fulfillmentStatus === 'unfulfilled' && o.shippingMethod === 'standard');
  assert.ok(engine.dispatch('createFulfillment', { orderId: extra.id, trackingCompany: 'USPS', trackingNumber: `EX${extra.number}` }).ok);
  fails(t, engine);
});
