// Task kinds. Checker contract:
//   check(finalState, initialState, params) -> string[]   ([] = pass)
// - must FAIL on the untouched seeded state and PASS after solve();
// - must be pure (no mutation), deterministic, and check outcomes, not call sequences;
// - should also reject collateral damage and call validateState.
import { validateState } from '../core/index.js';

const get = (s, id) => s.items.find((i) => i.id === id);

export const KINDS = {
  complete_item: {
    title: 'Complete an open item',
    candidates: (s, rng) => rng.shuffle(s.items.filter((i) => i.status === 'open')).map((i) => ({ itemId: i.id })),
    prompt: (s, p) => `Item ${get(s, p.itemId).name} (${p.itemId}) is finished. Mark it done and change nothing else.`,
    solve: (env, p) => env.act('completeItem', { itemId: p.itemId }),
    check(final, initial, p) {
      const reasons = [];
      if (get(final, p.itemId)?.status !== 'done') reasons.push(`${p.itemId} should be done`);
      const others = initial.items.filter((i) => i.id !== p.itemId && get(final, i.id)?.status !== i.status);
      if (others.length) reasons.push(`other items changed: ${others.map((i) => i.id).join(', ')}`);
      const problems = validateState(final);
      if (problems.length) reasons.push(`invariants violated: ${problems[0]}`);
      return reasons;
    },
  },
};
