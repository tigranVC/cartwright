// Shared model helpers: errors, ids, lookups, the empty state.
// TEMPLATE: rename the product, add your ID formats and collections.
export const TODAY = '2026-01-05'; // fixed simulated clock: never read Date.now()

export class ActionError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ActionError';
    this.code = code;
    if (details) this.details = details;
  }
}

export const ID_FORMATS = { item: ['ITM', 4] };

export function nextId(state, kind) {
  const [prefix, width] = ID_FORMATS[kind];
  const n = (state.meta.counters[kind] || 0) + 1;
  state.meta.counters[kind] = n;
  return `${prefix}-${String(n).padStart(width, '0')}`;
}

export function mustGet(state, collection, id, label) {
  const e = typeof id === 'string' ? state[collection].find((x) => x.id === id) : null;
  if (!id) throw new ActionError('INVALID_PARAMS', `${label}Id is required`);
  if (!e) throw new ActionError('NOT_FOUND', `${label} ${id} not found`);
  return e;
}

export function emptyState(seed) {
  return { meta: { schema: 1, product: 'MyVertical', seed, today: TODAY, counters: {} }, items: [], actionLog: [] };
}

export function clone(v) {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}
