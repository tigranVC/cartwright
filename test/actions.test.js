import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, validateState, lineRefundAmounts, allocate, byId } from '../core/index.js';

const fresh = () => createEngine(42);
const ok = (r) => { assert.ok(r.ok, r.error && `${r.error.code}: ${r.error.message}`); return r.result; };
const fails = (r, code) => { assert.equal(r.ok, false); if (code) assert.equal(r.error.code, code); };
const readyOrder = (e, extra = () => true) => e.state.orders.find((o) => o.status === 'open' && o.financialStatus === 'paid' && o.fulfillmentStatus === 'unfulfilled' && o.shippingMethod !== 'pickup' && extra(o));
const stockVariant = (e, storeId, min = 5) => e.state.variants.find((v) => v.storeId === storeId && v.inventoryPolicy === 'deny' && byId(e.state, 'products', v.productId).status === 'active' && v.inventory[e.state.stores.find((s) => s.id === storeId).locationIds[0]] >= min);

test('allocate splits exactly and refunds telescope', () => {
  assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
  assert.equal(allocate(999, [5, 7, 11]).reduce((a, b) => a + b), 999);
  const li = { priceCents: 1999, quantity: 3, discountCents: 600, taxCents: 413, refundedQty: 0 };
  let sub = 0; let tax = 0;
  for (let i = 0; i < 3; i++) { const a = lineRefundAmounts(li, 1); sub += a.subtotalCents; tax += a.taxCents; li.refundedQty++; }
  assert.equal(sub, 1999 * 3 - 600);
  assert.equal(tax, 413);
});

test('products: create with options generates variants, SKUs and stock', () => {
  const e = fresh();
  const r = ok(e.dispatch('createProduct', { storeId: 'STO-1', title: 'Test Tee', options: [{ name: 'Size', values: ['S', 'M'] }, { name: 'Color', values: ['Red', 'Blue'] }], priceCents: 2500, inventory: { 'LOC-01': 4 } }));
  assert.equal(r.variants.length, 4);
  assert.equal(r.variants[0].title, 'S / Red');
  assert.equal(r.variants[0].inventory['LOC-01'], 4);
  ok(e.dispatch('addVariant', { productId: r.product.id, options: ['L', 'Red'], priceCents: 2700, sku: 'TT-L-RED' }));
  assert.ok(e.state.products.find((p) => p.id === r.product.id).options[0].values.includes('L'));
  fails(e.dispatch('addVariant', { productId: r.product.id, options: ['L', 'Red'], priceCents: 2700 }), 'DUPLICATE');
  fails(e.dispatch('addVariant', { productId: r.product.id, options: ['XL', 'Red'], priceCents: 2700, sku: 'tt-l-red' }), 'DUPLICATE');
  fails(e.dispatch('createProduct', { storeId: 'STO-1', title: 'No price' }), 'INVALID_PARAMS');
  ok(e.dispatch('updateVariant', { variantId: r.variants[0].id, priceCents: 2000, compareAtCents: 2500 }));
  ok(e.dispatch('updateProduct', { productId: r.product.id, status: 'draft', tags: ['a', 'b', 'A'] }));
  assert.deepEqual(e.state.products.find((p) => p.id === r.product.id).tags, ['a', 'b']);
  assert.deepEqual(validateState(e.state), []);
});

test('inventory: adjust, set, transfer and guard against negative stock', () => {
  const e = fresh();
  const v = stockVariant(e, 'STO-3', 10);
  const before = { ...v.inventory };
  ok(e.dispatch('adjustInventory', { variantId: v.id, locationId: 'LOC-05', delta: 5, reason: 'received' }));
  ok(e.dispatch('transferInventory', { variantId: v.id, fromLocationId: 'LOC-05', toLocationId: 'LOC-07', quantity: 3 }));
  assert.equal(v.inventory['LOC-05'], before['LOC-05'] + 2);
  assert.equal(v.inventory['LOC-07'], before['LOC-07'] + 3);
  ok(e.dispatch('setInventory', { storeId: 'STO-3', sku: v.sku, locationId: 'LOC-06', quantity: 0 }));
  fails(e.dispatch('adjustInventory', { variantId: v.id, locationId: 'LOC-06', delta: -1 }), 'NEGATIVE_INVENTORY');
  fails(e.dispatch('adjustInventory', { variantId: v.id, locationId: 'LOC-01', delta: 1 }), 'WRONG_STORE');
  assert.equal(e.state.inventoryAdjustments.length, 4);
});

test('collections: manual membership and smart rules', () => {
  const e = fresh();
  const smart = ok(e.dispatch('createCollection', { storeId: 'STO-2', title: 'Cheap mugs', type: 'smart', rules: [{ column: 'type', relation: 'equals', condition: 'Mug' }, { column: 'variant_price', relation: 'less_than', condition: '25.00' }] })).collection;
  const got = ok(e.query('getCollection', { collectionId: smart.id }));
  assert.ok(got.products.length > 0);
  for (const p of got.products) { assert.equal(p.productType, 'Mug'); assert.ok(p.minPriceCents < 2500); }
  const manual = ok(e.dispatch('createCollection', { storeId: 'STO-2', title: 'Picks', type: 'manual', productIds: [got.products[0].id] })).collection;
  fails(e.dispatch('addProductsToCollection', { collectionId: smart.id, productIds: [got.products[0].id] }), 'NOT_MANUAL');
  fails(e.dispatch('addProductsToCollection', { collectionId: manual.id, productIds: ['PRD-0001'] }), 'WRONG_STORE');
  fails(e.dispatch('createCollection', { storeId: 'STO-2', title: 'Bad', type: 'smart', rules: [{ column: 'vendor', relation: 'greater_than', condition: 'x' }] }), 'INVALID_PARAMS');
});

test('fulfillment: partial, full, tracking update and cancel', () => {
  const e = fresh();
  const o = readyOrder(e, (x) => x.lineItems.length >= 2);
  ok(e.dispatch('createFulfillment', { orderId: o.id, lineItems: [{ lineItemId: o.lineItems[0].id, quantity: o.lineItems[0].quantity }], trackingCompany: 'USPS', trackingNumber: '9400111' }));
  assert.equal(o.fulfillmentStatus, 'partial');
  fails(e.dispatch('createFulfillment', { orderId: o.id, lineItems: [{ lineItemId: o.lineItems[0].id, quantity: 1 }] }), 'INVALID_QUANTITY');
  const f2 = ok(e.dispatch('createFulfillment', { orderId: o.id, trackingCompany: 'UPS', trackingNumber: '1Z1' })).fulfillment;
  assert.equal(o.fulfillmentStatus, 'fulfilled');
  assert.equal(f2.trackingUrl, 'https://tracking.example/ups/1Z1');
  ok(e.dispatch('updateFulfillmentTracking', { fulfillmentId: f2.id, trackingCompany: 'FedEx', trackingNumber: '123' }));
  fails(e.dispatch('createFulfillment', { orderId: o.id }), 'NOTHING_TO_FULFILL');
  ok(e.dispatch('cancelFulfillment', { fulfillmentId: f2.id }));
  assert.equal(o.fulfillmentStatus, 'partial');
  assert.deepEqual(validateState(e.state), []);
});

test('refunds: line refund with restock, shipping refund, limits', () => {
  const e = fresh();
  const o = e.state.orders.find((x) => x.financialStatus === 'paid' && x.fulfillmentStatus === 'fulfilled' && x.shippingCents - x.shippingDiscountCents > 0 && x.lineItems.some((l) => l.quantity >= 2));
  const li = o.lineItems.find((l) => l.quantity >= 2);
  const v = e.state.variants.find((x) => x.id === li.variantId);
  const stock = v.inventory[o.locationId];
  const r = ok(e.dispatch('createRefund', { orderId: o.id, lineItems: [{ lineItemId: li.id, quantity: 1, restock: true }], refundShipping: true })).refund;
  assert.equal(v.inventory[o.locationId], stock + 1);
  assert.equal(r.shippingCents, o.shippingCents - o.shippingDiscountCents);
  assert.equal(o.financialStatus, 'partially_refunded');
  fails(e.dispatch('createRefund', { orderId: o.id, refundShipping: false, shippingCents: 1 }), 'INVALID_AMOUNT');
  fails(e.dispatch('createRefund', { orderId: o.id, lineItems: [{ lineItemId: li.id, quantity: li.quantity }] }), 'INVALID_QUANTITY');
  // refund everything else -> refunded
  const rest = o.lineItems.filter((l) => l.quantity - l.refundedQty > 0).map((l) => ({ lineItemId: l.id, quantity: l.quantity - l.refundedQty }));
  ok(e.dispatch('createRefund', { orderId: o.id, lineItems: rest }));
  assert.equal(o.financialStatus, 'refunded');
  fails(e.dispatch('createRefund', { orderId: o.id, amountCents: 1 }), 'INVALID_AMOUNT');
  assert.deepEqual(validateState(e.state), []);
});

test('returns: request, approve, refund closes; decline', () => {
  const e = fresh();
  const req = e.state.returns.find((r) => r.status === 'requested');
  fails(e.dispatch('refundReturn', { returnId: req.id }), 'INVALID_STATE');
  ok(e.dispatch('approveReturn', { returnId: req.id }));
  const res = ok(e.dispatch('refundReturn', { returnId: req.id }));
  assert.equal(res.return.status, 'closed');
  assert.equal(res.refund.returnId, req.id);
  assert.ok(res.refund.lineItems[0].restock);
  const other = e.state.returns.find((r) => r.status === 'requested');
  ok(e.dispatch('declineReturn', { returnId: other.id }));
  const o = e.state.orders.find((x) => x.fulfillmentStatus === 'fulfilled' && x.status === 'open' && !e.state.returns.some((r) => r.orderId === x.id) && x.lineItems[0].refundedQty === 0);
  const r = ok(e.dispatch('requestReturn', { orderId: o.id, lineItems: [{ lineItemId: o.lineItems[0].id, quantity: o.lineItems[0].quantity, reason: 'unwanted' }] })).return;
  assert.equal(r.status, 'open');
  fails(e.dispatch('requestReturn', { orderId: o.id, lineItems: [{ lineItemId: o.lineItems[0].id, quantity: 1 }] }), 'INVALID_QUANTITY');
  assert.deepEqual(validateState(e.state), []);
});

test('orders: cancel restocks and refunds; cannot cancel fulfilled; mark paid; capture', () => {
  const e = fresh();
  const o = readyOrder(e);
  const li = o.lineItems[0];
  const v = e.state.variants.find((x) => x.id === li.variantId);
  const stock = v.inventory[o.locationId];
  ok(e.dispatch('cancelOrder', { orderId: o.id, reason: 'customer' }));
  assert.equal(o.status, 'cancelled');
  assert.equal(o.financialStatus, 'refunded');
  assert.equal(v.inventory[o.locationId], stock + li.quantity);
  fails(e.dispatch('cancelOrder', { orderId: o.id }), 'ORDER_CANCELLED');
  const shipped = e.state.orders.find((x) => x.status === 'open' && x.fulfillmentStatus === 'fulfilled');
  fails(e.dispatch('cancelOrder', { orderId: shipped.id }), 'ORDER_FULFILLED');
  const pending = e.state.orders.find((x) => x.financialStatus === 'pending' && x.status === 'open');
  ok(e.dispatch('markOrderPaid', { orderId: pending.id }));
  assert.equal(pending.financialStatus, 'paid');
  const auth = e.state.orders.filter((x) => x.financialStatus === 'authorized' && x.status === 'open');
  fails(e.dispatch('markOrderPaid', { orderId: auth[0].id }), 'INVALID_STATE');
  ok(e.dispatch('capturePayment', { orderId: auth[0].id, amountCents: 100 }));
  assert.equal(auth[0].financialStatus, 'partially_paid');
  ok(e.dispatch('cancelOrder', { orderId: auth[1].id }));
  assert.equal(auth[1].financialStatus, 'voided');
  ok(e.dispatch('closeOrder', { orderId: shipped.id }));
  ok(e.dispatch('reopenOrder', { orderId: shipped.id }));
  assert.deepEqual(validateState(e.state), []);
});

test('discounts: validation, min requirements, usage limits, once per customer', () => {
  const e = fresh();
  const v = stockVariant(e, 'STO-1', 10);
  fails(e.dispatch('createDiscount', { storeId: 'STO-1', code: 'welcome10', type: 'percentage', value: 5 }), 'DUPLICATE');
  fails(e.dispatch('createDiscount', { storeId: 'STO-1', code: 'X1', type: 'percentage', value: 5 }), 'INVALID_PARAMS');
  ok(e.dispatch('createDiscount', { storeId: 'STO-1', code: 'ONCE', type: 'fixed_amount', value: 500, minType: 'quantity', minValue: 2, usageLimit: 1 }));
  const p1 = ok(e.query('previewPricing', { storeId: 'STO-1', lineItems: [{ variantId: v.id, quantity: 2 }], discountCode: 'once' }));
  assert.equal(p1.discountCents, 500);
  fails(e.query('previewPricing', { storeId: 'STO-1', lineItems: [{ variantId: v.id, quantity: 1 }], discountCode: 'ONCE' }), 'DISCOUNT_INVALID');
  const cust = e.state.customers.find((c) => c.storeId === 'STO-1' && c.addresses.length);
  ok(e.dispatch('createOrder', { storeId: 'STO-1', customerId: cust.id, lineItems: [{ variantId: v.id, quantity: 2 }], discountCode: 'ONCE' }));
  fails(e.dispatch('createOrder', { storeId: 'STO-1', customerId: cust.id, lineItems: [{ variantId: v.id, quantity: 2 }], discountCode: 'ONCE' }), 'DISCOUNT_INVALID');
  fails(e.query('previewPricing', { storeId: 'STO-1', lineItems: [{ variantId: v.id }], discountCode: 'FLASH30' }), 'DISCOUNT_INVALID'); // scheduled
  const pct = ok(e.query('previewPricing', { storeId: 'STO-1', lineItems: [{ variantId: v.id, quantity: 3 }], discountCode: 'SHIPFREE' }));
  assert.equal(pct.shippingDiscountCents, pct.shippingCents);
  const vip = e.state.discounts.find((d) => d.storeId === 'STO-1' && d.code === 'VIP25');
  ok(e.dispatch('deactivateDiscount', { discountId: vip.id }));
  fails(e.query('previewPricing', { storeId: 'STO-1', lineItems: [{ variantId: v.id }], discountCode: 'VIP25' }), 'DISCOUNT_INVALID');
  assert.deepEqual(validateState(e.state), []);
});

test('storefront: cart, discount, checkout creates paid order, customer and decrements stock', () => {
  const e = fresh();
  const v = stockVariant(e, 'STO-2', 3);
  const before = { ...v.inventory };
  const cart = ok(e.dispatch('createCart', { storeId: 'STO-2' })).cart;
  ok(e.dispatch('addToCart', { cartId: cart.id, variantId: v.id, quantity: 2 }));
  fails(e.dispatch('addToCart', { cartId: cart.id, variantId: v.id, quantity: 10000 }), 'OUT_OF_STOCK');
  ok(e.dispatch('applyDiscountCode', { cartId: cart.id, code: 'WELCOME10' }));
  const view = ok(e.query('getCart', { cartId: cart.id }));
  assert.equal(view.pricing.discountCode, 'WELCOME10');
  fails(e.dispatch('checkout', { cartId: cart.id, email: 'shopper@example.org' }), 'INVALID_PARAMS'); // no address
  const res = ok(e.dispatch('checkout', { cartId: cart.id, email: 'shopper@example.org', firstName: 'Sam', lastName: 'Shopper', shippingAddress: { address1: '1 Elm St', city: 'Albany', province: 'NY', zip: '12207' } }));
  assert.equal(res.order.source, 'online_store');
  assert.equal(res.order.financialStatus, 'paid');
  assert.equal(res.order.discountCode, 'WELCOME10');
  assert.equal(v.inventory[res.order.locationId], before[res.order.locationId] - 2);
  assert.ok(e.state.customers.some((c) => c.email === 'shopper@example.org' && c.id === res.order.customerId));
  fails(e.dispatch('addToCart', { cartId: cart.id, variantId: v.id }), 'CART_CLOSED');
  // same email cannot reuse a once-per-customer code
  const cart2 = ok(e.dispatch('createCart', { storeId: 'STO-2', email: 'shopper@example.org' })).cart;
  ok(e.dispatch('addToCart', { cartId: cart2.id, variantId: v.id }));
  fails(e.dispatch('applyDiscountCode', { cartId: cart2.id, code: 'WELCOME10' }), 'DISCOUNT_INVALID');
  assert.deepEqual(validateState(e.state), []);
});

test('customers: create, addresses, tags; analytics queries', () => {
  const e = fresh();
  const c = ok(e.dispatch('createCustomer', { storeId: 'STO-3', firstName: 'A', lastName: 'B', email: 'A.B@Example.com', address: { address1: '1 A St', city: 'X' } })).customer;
  assert.equal(c.email, 'a.b@example.com');
  fails(e.dispatch('createCustomer', { storeId: 'STO-3', firstName: 'A', lastName: 'B', email: 'a.b@example.com' }), 'DUPLICATE');
  const a2 = ok(e.dispatch('addCustomerAddress', { customerId: c.id, address1: '2 B St', city: 'Y', setDefault: true })).address;
  fails(e.dispatch('deleteCustomerAddress', { customerId: c.id, addressId: a2.id }), 'DEFAULT_ADDRESS');
  ok(e.dispatch('addTags', { resource: 'customer', id: c.id, tags: 'vip, wholesale' }));
  ok(e.dispatch('removeTags', { resource: 'customer', id: c.id, tags: ['VIP'] }));
  assert.deepEqual(e.state.customers.find((x) => x.id === c.id).tags, ['wholesale']);
  const sum = ok(e.query('analyticsSummary', { storeId: 'STO-1' }));
  assert.ok(sum.orders > 0 && sum.averageOrderValueCents > 0);
  assert.equal(sum.netSalesCents, sum.grossSalesCents - sum.discountsCents - sum.returnsCents);
  const sot = ok(e.query('salesOverTime', { storeId: 'STO-1', interval: 'week', from: '2026-05-01', to: '2026-06-15' }));
  assert.ok(sot.rows.length >= 6);
  const full = ok(e.query('salesOverTime', { storeId: 'STO-1' }));
  assert.equal(full.rows.reduce((a, r) => a + r.orders, 0), sum.orders);
  const top = ok(e.query('topProducts', { storeId: 'STO-1', limit: 5 }));
  assert.equal(top.items.length, 5);
  assert.ok(top.items[0].unitsSold >= top.items[4].unitsSold);
  const cust = ok(e.query('listCustomers', { storeId: 'STO-1', sort: 'spent', limit: 3 }));
  assert.ok(cust.items[0].totalSpentCents >= cust.items[2].totalSpentCents);
});

test('failed actions leave state untouched', () => {
  const e = fresh();
  const snap = JSON.stringify(e.state);
  fails(e.dispatch('createProduct', { storeId: 'STO-1', title: 'X', options: [{ name: 'Size', values: ['S'] }], variants: [{ options: ['S'], priceCents: 1, sku: 'A' }, { options: ['S'], priceCents: 1, sku: 'B' }] }));
  fails(e.dispatch('createOrder', { storeId: 'STO-1', lineItems: [{ variantId: 'VAR-00001', quantity: 1 }, { variantId: 'VAR-99999' }] }));
  fails(e.dispatch('nope', {}), 'UNKNOWN_ACTION');
  assert.equal(JSON.stringify(e.state), snap);
});
