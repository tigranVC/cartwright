import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateState } from '../core/index.js';
import { loadTasks, checkTask, solveTask, KINDS } from '../tasks/index.js';
import { buildAll } from '../tasks/generate.js';

const tasks = loadTasks();

test('there are ~30 well-formed tasks', () => {
  assert.ok(tasks.length >= 30);
  assert.equal(new Set(tasks.map((t) => t.id)).size, tasks.length);
  for (const t of tasks) {
    assert.equal(typeof t.id, 'string');
    assert.equal(typeof t.prompt, 'string');
    assert.ok(t.prompt.length > 40);
    assert.ok(Number.isInteger(t.seed));
    assert.ok(KINDS[t.kind], t.kind);
    for (const fn of ['candidates', 'prompt', 'solve', 'check']) assert.equal(typeof KINDS[t.kind][fn], 'function', `${t.kind}.${fn}`);
  }
});

test('tasks.json is reproducible from specs (deterministic generator)', () => {
  assert.deepEqual(buildAll(), tasks);
});

for (const task of tasks) {
  test(`task ${task.id}: checker fails on untouched state, passes after reference solution`, () => {
    const untouched = checkTask(task, generateState(task.seed));
    assert.equal(untouched.pass, false, 'checker must fail on untouched state');
    const solved = checkTask(task, solveTask(task).state);
    assert.deepEqual(solved.reasons, []);
    assert.equal(solved.pass, true);
  });
}

test('checker rejects a state from the wrong seed', () => {
  const t = tasks[0];
  assert.equal(checkTask(t, generateState(t.seed + 1)).pass, false);
});

test('refund checker rejects a refund that also refunds shipping', () => {
  const t = tasks.find((x) => x.kind === 'refund_item' && x.params.restock);
  const engine = solveTask(t);
  assert.equal(checkTask(t, engine.state).pass, true);
  const o = engine.state.orders.find((x) => x.id === t.params.orderId);
  if (o.shippingCents - o.shippingDiscountCents > 0) {
    assert.ok(engine.dispatch('createRefund', { orderId: o.id, refundShipping: true }).ok);
    assert.equal(checkTask(t, engine.state).pass, false);
  }
});

test('VIP checker rejects tagging an extra customer', () => {
  const t = tasks.find((x) => x.kind === 'tag_vip_customers');
  const engine = solveTask(t);
  const extra = engine.state.customers.find((c) => c.storeId === t.params.storeId && !c.tags.includes('VIP'));
  assert.ok(engine.dispatch('addTags', { resource: 'customer', id: extra.id, tags: ['VIP'] }).ok);
  assert.equal(checkTask(t, engine.state).pass, false);
});
