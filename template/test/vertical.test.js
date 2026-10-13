// Minimum test bar for a vertical: determinism, invariants, replay, server, and task verification.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateState, validateState, createEngine, replay } from '../core/index.js';
import { loadTasks, checkTask, solveTask } from '../tasks/index.js';
import { buildAll } from '../tasks/generate.js';
import { createApp } from '../server/app.js';

test('same seed => identical state; different seeds differ', () => {
  assert.equal(JSON.stringify(generateState(42)), JSON.stringify(generateState(42)));
  assert.notEqual(JSON.stringify(generateState(1)), JSON.stringify(generateState(2)));
});
test('seeded worlds are valid', () => { for (const s of [42, 7, 'x']) assert.deepEqual(validateState(generateState(s)), []); });
test('failed actions do not mutate; replay reproduces state', () => {
  const e = createEngine(3);
  const snap = JSON.stringify(e.state);
  assert.equal(e.dispatch('createItem', { name: '' }).ok, false);
  assert.equal(JSON.stringify(e.state), snap);
  assert.ok(e.dispatch('createItem', { name: 'New', qty: 2 }).ok);
  assert.equal(JSON.stringify(replay(3, e.state.actionLog)), JSON.stringify(e.state));
});

const tasks = loadTasks();
test('tasks.json is reproducible', () => assert.deepEqual(buildAll(), tasks));
for (const t of tasks) {
  test(`${t.id}: fails on seed, passes after reference`, () => {
    assert.equal(checkTask(t, generateState(t.seed)).pass, false);
    assert.deepEqual(checkTask(t, solveTask(t).state).reasons, []);
  });
}

let server; let base;
before(async () => { const app = createApp({ seed: 42 }); await new Promise((r) => { server = app.listen(0, r); }); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
test('REST mirrors actions and reset restores the seed', async () => {
  const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) });
  assert.equal((await post('/api/items', { name: 'Via REST' })).status, 200);
  assert.equal((await post('/api/items', {})).status, 422);
  await post('/reset');
  assert.equal((await (await fetch(`${base}/api/items`)).json()).result.length, 200);
});
