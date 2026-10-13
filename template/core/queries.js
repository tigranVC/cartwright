// Read-only queries shared by UI, browser API and REST server.
import { mustGet } from './model.js';

export const QUERIES = {
  listItems: {
    description: 'Items, optionally filtered by status.',
    params: [['status', 'open|done', false, '']],
    run: (state, p) => state.items.filter((i) => !p.status || i.status === p.status),
  },
  getItem: { description: 'One item.', params: [['itemId', 'string', true, '']], run: (state, p) => mustGet(state, 'items', p.itemId, 'item') },
};
