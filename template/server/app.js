// Express REST API over one in-memory engine. Keep a 1:1 mapping from routes to actions/queries.
import express from 'express';
import { createEngine, ACTIONS, QUERIES, DEFAULT_SEED, validateState } from '../core/index.js';
import { loadTasks, checkTask } from '../tasks/index.js';

export const ROUTES = [
  ['post', '/api/items', 'createItem', (r) => r.body || {}],
  ['post', '/api/items/:id/complete', 'completeItem', (r) => ({ itemId: r.params.id })],
];
export const READS = [
  ['/api/items', 'listItems', (r) => r.query],
  ['/api/items/:id', 'getItem', (r) => ({ itemId: r.params.id })],
];

export function createApp({ seed = DEFAULT_SEED } = {}) {
  const engine = createEngine(seed);
  const app = express();
  app.use(express.json());
  const send = (res, r) => res.status(r.ok ? 200 : r.error.code === 'NOT_FOUND' || r.error.code.startsWith('UNKNOWN') ? 404 : 422).json(r);
  const reset = (req, res) => { const s = req.body?.seed ?? req.query.seed ?? engine.seed; engine.reset(/^\d+$/.test(String(s)) ? Number(s) : String(s)); res.json({ ok: true, seed: engine.seed }); };
  app.post('/reset', reset);
  app.post('/api/reset', reset);
  app.get('/api/state', (req, res) => res.json(engine.state));
  app.get('/api/state/validate', (req, res) => { const problems = validateState(engine.state); res.json({ ok: !problems.length, problems }); });
  app.get('/api/actions', (req, res) => res.json(Object.keys(ACTIONS)));
  app.get('/api/queries', (req, res) => res.json(Object.keys(QUERIES)));
  app.post('/api/actions/:type', (req, res) => send(res, engine.dispatch(req.params.type, req.body || {})));
  app.post('/api/queries/:name', (req, res) => send(res, engine.query(req.params.name, req.body || {})));
  for (const [path, q, map] of READS) app.get(path, (req, res) => send(res, engine.query(q, map(req))));
  for (const [m, path, a, map] of ROUTES) app[m](path, (req, res) => send(res, engine.dispatch(a, map(req))));
  const tasks = loadTasks();
  app.get('/api/tasks', (req, res) => res.json(tasks.map(({ params, ...t }) => t)));
  app.post('/api/tasks/:id/start', (req, res) => { const t = tasks.find((x) => x.id === req.params.id); if (!t) return res.status(404).json({ ok: false }); engine.reset(t.seed); res.json({ ok: true, task: { id: t.id, prompt: t.prompt, seed: t.seed } }); });
  app.post('/api/tasks/:id/check', (req, res) => { const t = tasks.find((x) => x.id === req.params.id); if (!t) return res.status(404).json({ ok: false }); res.json({ ok: true, ...checkTask(t, engine.state) }); });
  app.engine = engine;
  return app;
}
