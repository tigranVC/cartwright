// Deterministic world generator: same seed => byte-identical state.
// Rules: all randomness from Rng(seed); no Date.now(), Math.random(), locale or timezone use.
import { Rng } from './prng.js';
import { emptyState, nextId } from './model.js';

export const DEFAULT_SEED = 42;
const NAMES = ['Anvil', 'Bracket', 'Cog', 'Dowel', 'Eyelet', 'Flange', 'Gasket', 'Hinge'];

export function generateState(seed = DEFAULT_SEED) {
  const rng = new Rng(`myvertical:${seed}`); // namespace the seed per vertical
  const state = emptyState(seed);
  for (let i = 0; i < 200; i++) {
    state.items.push({ id: nextId(state, 'item'), name: `${rng.pick(NAMES)} ${rng.int(100, 999)}`, status: rng.weighted([['open', 0.7], ['done', 0.3]]), qty: rng.int(0, 50) });
  }
  return state;
}
