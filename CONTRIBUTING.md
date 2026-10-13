# Contributing

Cartwright is one vertical in a family of **clean-room, deterministic business-software simulators** for agent RL environments and evals. Its sibling [FieldForge](https://github.com/tigranVC/fieldforge) covers field-service management. Contributions are welcome in two forms: improvements to an existing vertical, and **new verticals** (CRM, helpdesk, accounting, HR, scheduling, ...). Both go through pull requests.

Start a new vertical from [`template/`](template/README.md). It is a minimal runnable skeleton that already passes the bar below.

## 1. Repository layout (required)

```
core/      pure ES modules, no dependencies, no I/O. Shared verbatim by browser and Node.
  prng.js  seed.js  model.js  actions.js  queries.js  validate.js  engine.js  index.js
server/    Express app (app.js exports createApp) + index.js entry (port/seed via flags or env)
docs/      static SPA for GitHub Pages: index.html, app.js, api.js, style.css, .nojekyll,
           docs/core and docs/tasks are copies produced by scripts/sync-core.js (never edit by hand)
tasks/     kinds.js, specs.js, generate.js, index.js, run.js, tasks.json
test/      node --test suites
scripts/   sync-core.js, serve-docs.js
SPEC.md README.md CONTRIBUTING.md LICENSE (MIT) .gitignore (node_modules)
```

* ES modules (`"type": "module"`), Node >= 18. **Express is the only runtime dependency**, and there are no dev dependencies; tests use `node --test`.
* npm scripts: `start`, `build` (sync core into docs), `tasks:generate`, `tasks:verify`, `serve:docs`, `test`.

## 2. Engine conventions

* **One registry per kind of operation.** `ACTIONS` (mutations) and `QUERIES` (reads) are objects of `{ description, params: [[name, type, required, description], ...], run(state, params) }`. The SPA, the `window.<name>` browser API, the REST server and the reference solutions all go through them, so the surfaces cannot diverge.
* **Validate first, mutate last.** An action that throws `ActionError(code, message)` must leave state untouched. The engine returns `{ok:false, error:{code, message}}` and does not log the call.
* **Successful actions are appended to `state.actionLog`**, so `replay(seed, actionLog)` must reproduce the state exactly. The SPA persists only `{seed, actions}`.
* **Reset-to-seed** must exist in both surfaces: `POST /reset` (and `/api/reset`) on the server, and `reset(seed)` plus a visible button in the SPA.
* Entities have prefixed, zero-padded string IDs from per-kind counters in `state.meta.counters`. Prefer never deleting entities; model archival as a status.
* Money is integer cents. Dates and times are timezone-free strings. The clock is fixed (`meta.today`).
* `validateState(state)` lists the global invariants. Seeded worlds must satisfy it, and checkers should call it.

## 3. Seeding & determinism rules

* All randomness comes from `core/prng.js` (`new Rng(\`<vertical>:${seed}\`)`). **Never** use `Math.random`, `Date.now`, `new Date()` without an explicit fixed argument, `Intl`/locale-dependent formatting in state, object-key ordering tricks, or anything else that depends on the host.
* `generateState(seed)` must be a pure function. The same seed gives byte-identical JSON in Node and in browsers, and different seeds give different worlds.
* Size the world realistically (hundreds to thousands of records) with a rich status mix, so tasks have meaningful candidates. Keep generation fast (< ~0.5 s), because tests generate many seeds.
* If you change the generator, regenerate `tasks/tasks.json` (`npm run tasks:generate`) and re-run the verifier.

## 4. Tasks and the checker interface

Each task kind in `tasks/kinds.js` implements:

| Function | Contract |
|---|---|
| `candidates(state, rng, variant) -> params[]` | Deterministic list of concrete parameter sets from the seeded world |
| `feasible?(state, params) -> boolean` | Optional pre-filter |
| `prompt(state, params) -> string` | Self-contained natural-language instruction (names *and* IDs; no hidden knowledge needed) |
| `solve(env, params)` | Reference solution using only `env.act(action, params)` / `env.query(query, params)` |
| `check(finalState, initialState, params) -> string[]` | `[]` = pass; otherwise human-readable reasons |

**The fail-on-seed / pass-after-reference rule is mandatory.** For every task, `check(seed state)` must return at least one reason, and `check(state after solve)` must return `[]`. `tasks/generate.js` only emits candidates that satisfy this. `tasks/run.js` re-verifies every task and **exits non-zero** on any violation. CI (and reviewers) run it.

Checker guidelines:
* Verify **outcomes**, not the sequence of calls. Any valid path (REST, SPA, browser API) must be able to pass.
* Guard against shortcuts and collateral damage: unchanged "other" entities, exact amounts, no extra records, `validateState` clean.
* Pure and deterministic; never mutate the states passed in.
* `tasks.json` holds `{id, kind, title, seed, prompt, params}`. Servers must not expose `params` from task-listing endpoints.

Aim for about 30 tasks per vertical, covering every workflow area, with a mix of single-step, multi-step and aggregate tasks (e.g. "every X that matches Y").

## 5. Clean-room rules

* Work only from **public** material: help-center articles, public API references and public design-system guidelines. Cite specific URLs per workflow area in the `## Sources` section of `SPEC.md`.
* Do not copy code, assets, icons, logos, screenshots, CSS, copy text, product names or trademarks of the product being modelled. Choose an **original name** (not containing the original product's name) and an original visual identity (palette, logo, layout details).
* Invent all seed data (names, companies, products). Use `example` domains for emails and URLs.
* Mark the project as independent and unaffiliated in the README.
* If you have had access to a vendor's non-public code or documentation, do not contribute a simulator of that vendor's product.

## 6. Test requirements

`npm test` must pass, covering at least:

1. **Engine:** every action's happy path and key failure codes, and "failed actions leave state untouched".
2. **Determinism:** same seed gives an identical state, different seeds differ, PRNG stability, seeded worlds pass `validateState`, and replay of the action log reproduces the state.
3. **Server:** every action has a REST route, representative endpoints return the right status codes (200/404/422), reset restores the seed, and the task start/check endpoints work.
4. **Docs:** `docs/core` and `docs/tasks` are byte-identical to the sources, and the SPA entry points and browser API exist.
5. **Tasks:** `tasks.json` is reproducible from specs, and every task fails on seed and passes after its reference solution. Add a few negative tests showing that checkers reject plausible wrong answers.

Before opening a PR, run:

```bash
npm install && npm run build && npm test && npm run tasks:verify
```

## 7. Pull requests

* One vertical per PR (or one focused change to an existing vertical).
* Describe the workflows covered, the task list, and the public sources used.
* Include a screenshot of the SPA and the output of `npm run tasks:verify`.
* New verticals go in their own repository built from `template/`. Open an issue or PR here to get it listed as a sibling.
