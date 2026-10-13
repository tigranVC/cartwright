// State-mutating actions. Validate everything first, mutate last: a failed
// action must leave state untouched. params: [name, type, required, description]
import { ActionError, nextId, mustGet } from './model.js';

export const ACTIONS = {
  createItem: {
    description: 'Create an item.',
    params: [['name', 'string', true, 'Item name'], ['qty', 'integer', false, 'Default 0']],
    run(state, p) {
      if (typeof p.name !== 'string' || !p.name.trim()) throw new ActionError('INVALID_PARAMS', 'name is required');
      const qty = p.qty == null ? 0 : p.qty;
      if (!Number.isInteger(qty) || qty < 0) throw new ActionError('INVALID_PARAMS', 'qty must be a non-negative integer');
      const item = { id: nextId(state, 'item'), name: p.name.trim(), status: 'open', qty };
      state.items.push(item);
      return { item };
    },
  },
  completeItem: {
    description: 'Mark an open item done.',
    params: [['itemId', 'string', true, '']],
    run(state, p) {
      const item = mustGet(state, 'items', p.itemId, 'item');
      if (item.status !== 'open') throw new ActionError('INVALID_STATE', `item ${item.id} is ${item.status}`);
      item.status = 'done';
      return { item };
    },
  },
};
export const ACTION_NAMES = Object.keys(ACTIONS);
