// window.myvertical: browser API mirroring every action. Persists {seed, actions} and rebuilds by replay.
import * as core from './core/index.js';
const KEY = 'myvertical:v1';
const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } })();
const engine = core.createEngine(saved?.seed ?? core.DEFAULT_SEED, saved ? { state: core.replay(saved.seed, saved.actions) } : {});
engine.subscribe(() => localStorage.setItem(KEY, JSON.stringify({ seed: engine.seed, actions: engine.state.actionLog.map(({ type, params }) => ({ type, params })) })));
const api = {
  core,
  get state() { return engine.state; },
  dispatch: (t, p) => engine.dispatch(t, p),
  query: (n, p) => engine.query(n, p),
  reset: (seed = engine.seed) => { engine.reset(seed); return { ok: true, seed }; },
  subscribe: (fn) => engine.subscribe(fn),
};
for (const name of Object.keys(core.ACTIONS)) api[name] = (params) => engine.dispatch(name, params);
window.myvertical = api;
export default api;
