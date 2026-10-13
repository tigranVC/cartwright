// Global invariants; [] == valid. Checkers call this so agents cannot "pass" by corrupting state.
export function validateState(state) {
  const problems = [];
  const ids = new Set();
  for (const i of state.items) {
    if (ids.has(i.id)) problems.push(`${i.id}: duplicate id`);
    ids.add(i.id);
    if (i.qty < 0) problems.push(`${i.id}: negative qty`);
  }
  return problems;
}
