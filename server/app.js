// Express REST API around a single in-memory engine. Every mutating route
// maps 1:1 onto a core action, every read route onto a core query.
import express from 'express';
import { createEngine, ACTIONS, QUERIES, DEFAULT_SEED, validateState } from '../core/index.js';
import { loadTasks, checkTask } from '../tasks/index.js';

const STATE_COLLECTIONS = ['stores', 'locations', 'products', 'variants', 'collections', 'customers', 'orders', 'transactions', 'fulfillments', 'refunds', 'returns', 'discounts', 'carts', 'inventoryAdjustments', 'actionLog'];

const body = (r) => r.body || {};
const withId = (key) => (r) => ({ ...body(r), [key]: r.params.id });

// Mutations: [method, path, action, map(req) -> params]
export const ROUTES = [
  ['post', '/api/products', 'createProduct', body],
  ['patch', '/api/products/:id', 'updateProduct', withId('productId')],
  ['post', '/api/products/:id/variants', 'addVariant', withId('productId')],
  ['patch', '/api/variants/:id', 'updateVariant', withId('variantId')],
  ['post', '/api/inventory/adjust', 'adjustInventory', body],
  ['post', '/api/inventory/set', 'setInventory', body],
  ['post', '/api/inventory/transfer', 'transferInventory', body],
  ['post', '/api/collections', 'createCollection', body],
  ['patch', '/api/collections/:id', 'updateCollection', withId('collectionId')],
  ['post', '/api/collections/:id/products', 'addProductsToCollection', withId('collectionId')],
  ['delete', '/api/collections/:id/products', 'removeProductsFromCollection', withId('collectionId')],
  ['post', '/api/customers', 'createCustomer', body],
  ['patch', '/api/customers/:id', 'updateCustomer', withId('customerId')],
  ['post', '/api/customers/:id/addresses', 'addCustomerAddress', withId('customerId')],
  ['patch', '/api/customers/:id/addresses/:addressId', 'updateCustomerAddress', (r) => ({ ...body(r), customerId: r.params.id, addressId: r.params.addressId })],
  ['post', '/api/customers/:id/addresses/:addressId/default', 'setDefaultAddress', (r) => ({ customerId: r.params.id, addressId: r.params.addressId })],
  ['delete', '/api/customers/:id/addresses/:addressId', 'deleteCustomerAddress', (r) => ({ customerId: r.params.id, addressId: r.params.addressId })],
  ['post', '/api/tags/add', 'addTags', body],
  ['post', '/api/tags/remove', 'removeTags', body],
  ['post', '/api/orders', 'createOrder', body],
  ['patch', '/api/orders/:id', 'updateOrder', withId('orderId')],
  ['post', '/api/orders/:id/mark-paid', 'markOrderPaid', withId('orderId')],
  ['post', '/api/orders/:id/capture', 'capturePayment', withId('orderId')],
  ['post', '/api/orders/:id/cancel', 'cancelOrder', withId('orderId')],
  ['post', '/api/orders/:id/close', 'closeOrder', withId('orderId')],
  ['post', '/api/orders/:id/reopen', 'reopenOrder', withId('orderId')],
  ['post', '/api/orders/:id/fulfillments', 'createFulfillment', withId('orderId')],
  ['patch', '/api/fulfillments/:id/tracking', 'updateFulfillmentTracking', withId('fulfillmentId')],
  ['post', '/api/fulfillments/:id/cancel', 'cancelFulfillment', withId('fulfillmentId')],
  ['post', '/api/orders/:id/refunds', 'createRefund', withId('orderId')],
  ['post', '/api/orders/:id/returns', 'requestReturn', withId('orderId')],
  ['post', '/api/returns/:id/approve', 'approveReturn', withId('returnId')],
  ['post', '/api/returns/:id/decline', 'declineReturn', withId('returnId')],
  ['post', '/api/returns/:id/refund', 'refundReturn', withId('returnId')],
  ['post', '/api/discounts', 'createDiscount', body],
  ['patch', '/api/discounts/:id', 'updateDiscount', withId('discountId')],
  ['post', '/api/discounts/:id/deactivate', 'deactivateDiscount', withId('discountId')],
  ['post', '/api/discounts/:id/activate', 'activateDiscount', withId('discountId')],
  ['post', '/api/carts', 'createCart', body],
  ['post', '/api/carts/:id/lines', 'addToCart', withId('cartId')],
  ['patch', '/api/carts/:id/lines/:variantId', 'updateCartLine', (r) => ({ ...body(r), cartId: r.params.id, variantId: r.params.variantId })],
  ['post', '/api/carts/:id/discount', 'applyDiscountCode', withId('cartId')],
  ['post', '/api/carts/:id/checkout', 'checkout', withId('cartId')],
];

// Reads: [path, query, map(req) -> params]
export const READS = [
  ['/api/stores', 'listStores', (r) => r.query],
  ['/api/locations', 'listLocations', (r) => r.query],
  ['/api/products', 'listProducts', (r) => r.query],
  ['/api/products/:id', 'getProduct', (r) => ({ productId: r.params.id })],
  ['/api/variants', 'listVariants', (r) => r.query],
  ['/api/variants/:id', 'getVariant', (r) => ({ variantId: r.params.id })],
  ['/api/inventory', 'inventoryLevels', (r) => r.query],
  ['/api/inventory/adjustments', 'listInventoryAdjustments', (r) => r.query],
  ['/api/collections', 'listCollections', (r) => r.query],
  ['/api/collections/:id', 'getCollection', (r) => ({ collectionId: r.params.id })],
  ['/api/customers', 'listCustomers', (r) => r.query],
  ['/api/customers/:id', 'getCustomer', (r) => ({ customerId: r.params.id })],
  ['/api/orders', 'listOrders', (r) => r.query],
  ['/api/orders/:id', 'getOrder', (r) => ({ orderId: r.params.id })],
  ['/api/returns', 'listReturns', (r) => r.query],
  ['/api/refunds', 'listRefunds', (r) => r.query],
  ['/api/discounts', 'listDiscounts', (r) => r.query],
  ['/api/discounts/:id', 'getDiscount', (r) => ({ discountId: r.params.id })],
  ['/api/storefront/products', 'storefrontProducts', (r) => r.query],
  ['/api/carts', 'listCarts', (r) => r.query],
  ['/api/carts/:id', 'getCart', (r) => ({ cartId: r.params.id })],
  ['/api/analytics/summary', 'analyticsSummary', (r) => r.query],
  ['/api/analytics/sales', 'salesOverTime', (r) => r.query],
  ['/api/analytics/top-products', 'topProducts', (r) => r.query],
];

const describe = (reg) => Object.fromEntries(Object.entries(reg).map(([k, v]) => [k, { description: v.description, params: v.params.map(([name, type, required, description]) => ({ name, type, required, description })) }]));

export function createApp({ seed = DEFAULT_SEED } = {}) {
  const engine = createEngine(seed);
  let activeTask = null;
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const status = (code) => (code === 'NOT_FOUND' || code.startsWith('UNKNOWN') ? 404 : 422);
  const send = (res, r) => res.status(r.ok ? 200 : status(r.error.code)).json(r);
  const counts = () => Object.fromEntries(STATE_COLLECTIONS.map((k) => [k, engine.state[k].length]));

  app.get('/api/health', (req, res) => res.json({ ok: true, seed: engine.seed, today: engine.state.meta.today }));

  const reset = (req, res) => {
    const s = req.body?.seed ?? req.query.seed ?? engine.seed;
    engine.reset(/^\d+$/.test(String(s)) ? Number(s) : String(s));
    activeTask = null;
    res.json({ ok: true, seed: engine.seed, counts: counts() });
  };
  app.post('/reset', reset);
  app.post('/api/reset', reset);

  app.get('/api/state', (req, res) => {
    const include = req.query.include ? String(req.query.include).split(',') : STATE_COLLECTIONS;
    const out = { meta: engine.state.meta };
    for (const k of include) if (STATE_COLLECTIONS.includes(k)) out[k] = engine.state[k];
    res.json(out);
  });
  app.get('/api/state/summary', (req, res) => res.json({ meta: engine.state.meta, counts: counts(), activeTask: activeTask?.id ?? null }));
  app.get('/api/state/validate', (req, res) => { const problems = validateState(engine.state); res.json({ ok: problems.length === 0, problems }); });
  app.get('/api/action-log', (req, res) => res.json(engine.state.actionLog));

  app.get('/api/actions', (req, res) => res.json(describe(ACTIONS)));
  app.get('/api/queries', (req, res) => res.json(describe(QUERIES)));
  app.post('/api/actions/:type', (req, res) => send(res, engine.dispatch(req.params.type, req.body || {})));
  app.post('/api/queries/:name', (req, res) => send(res, engine.query(req.params.name, req.body || {})));

  // Specific read paths (e.g. /api/inventory/adjustments) must win over /:id patterns.
  for (const [path, query, map] of READS) app.get(path, (req, res) => send(res, engine.query(query, map(req))));
  for (const [method, path, action, map] of ROUTES) app[method](path, (req, res) => send(res, engine.dispatch(action, map(req))));
  app.get('/api/orders/by-name/:storeId/:name', (req, res) => send(res, engine.query('getOrder', { storeId: req.params.storeId, name: req.params.name })));
  for (const coll of ['fulfillments', 'returns', 'refunds', 'transactions']) {
    app.get(`/api/${coll}/:id`, (req, res) => {
      const e = engine.state[coll].find((x) => x.id === req.params.id);
      if (!e) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: `${req.params.id} not found` } });
      res.json({ ok: true, result: e });
    });
  }

  // ---- tasks (RL episode helpers) ----
  const tasks = loadTasks();
  const findTask = (id) => tasks.find((t) => t.id === id);
  const notFound = (res) => res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'task not found' } });
  app.get('/api/tasks', (req, res) => res.json(tasks.map(({ params, ...t }) => t)));
  app.get('/api/tasks/:id', (req, res) => {
    const t = findTask(req.params.id);
    if (!t) return notFound(res);
    const { params, ...pub } = t;
    res.json(pub);
  });
  app.post('/api/tasks/:id/start', (req, res) => {
    const t = findTask(req.params.id);
    if (!t) return notFound(res);
    engine.reset(t.seed);
    activeTask = t;
    res.json({ ok: true, task: { id: t.id, seed: t.seed, prompt: t.prompt } });
  });
  app.post('/api/tasks/:id/check', (req, res) => {
    const t = findTask(req.params.id);
    if (!t) return notFound(res);
    res.json({ ok: true, taskId: t.id, ...checkTask(t, engine.state) });
  });

  app.use((req, res) => res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: `no route ${req.method} ${req.path}` } }));
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err.type === 'entity.parse.failed') return res.status(400).json({ ok: false, error: { code: 'BAD_JSON', message: err.message } });
    res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: err.message } });
  });

  app.engine = engine;
  return app;
}
