# Vertical simulator template

A minimal, **runnable** skeleton for a new vertical simulator ("MyVertical": a toy item tracker with one task). Copy it to start a new vertical, rename it, and grow it. It follows the same architecture as [Cartwright](../README.md) (e-commerce admin) and [FieldForge](https://github.com/tigranVC/fieldforge) (field-service management). Read [CONTRIBUTING.md](../CONTRIBUTING.md) for the rules every vertical must meet.

```bash
cp -r template ../myvertical && cd ../myvertical
npm install
npm run tasks:generate   # writes tasks/tasks.json from tasks/specs.js
npm run tasks:verify     # every checker fails on seed, passes after its reference solution
npm run build            # copies core/ + tasks into docs/ for the static SPA
npm test
```

## Layout

| Path | Role |
|---|---|
| `core/prng.js` | Seeded PRNG (copy verbatim; never use `Math.random`) |
| `core/model.js` | `ActionError`, id generation, lookups, `emptyState`, the fixed clock |
| `core/seed.js` | `generateState(seed)`: a pure, deterministic world generator |
| `core/actions.js` | `ACTIONS` registry: `{description, params: [[name, type, required, desc]], run(state, p)}` |
| `core/queries.js` | `QUERIES` registry (read-only) |
| `core/validate.js` | `validateState(state) -> problems[]` (global invariants) |
| `core/engine.js` | `createEngine` / `runAction` / `runQuery` / `replay` (copy verbatim) |
| `server/app.js` | Express app: resource routes mapped 1:1 to actions/queries, plus `/reset`, generic `/api/actions/:name`, `/api/queries/:name`, `/api/tasks/...` |
| `docs/` | Static SPA (GitHub Pages) using `docs/core` (a synced copy) and localStorage `{seed, actions}`, exposing `window.<name>` |
| `tasks/kinds.js` | Task kinds: `candidates`, `prompt`, `solve`, `check` |
| `tasks/specs.js` | The task list (id, kind, seed, variant) |
| `tasks/generate.js`, `index.js`, `run.js` | Generator, harness and verifier (copy verbatim) |
| `test/vertical.test.js` | Minimum test bar (expand into engine, determinism, server, docs and tasks suites) |
| `SPEC.template.md` | Skeleton for your `SPEC.md`, including the required Sources section |

## The checker interface

```js
check(finalState, initialState, params) -> string[]   // [] means PASS; each string is a human-readable failure reason
```

* `finalState`: the state after the agent acted. `initialState`: the pristine seeded state for the task's seed (do not mutate either). `params`: the hidden task parameters chosen by `candidates`.
* It **must fail on the untouched seeded state** and **pass after `solve(env, params)`**. `tasks/run.js` and the tests enforce both for every task.
* Check *outcomes*, not call sequences, so any valid path (REST, browser API or UI) can pass.
* Reject collateral damage (e.g. other entities changed) and call `validateState(finalState)`.
* Keep it deterministic and side-effect free.

`solve(env, params)` uses only the public API: `env.act(actionName, params)` (throws on failure) and `env.query(queryName, params)`.
