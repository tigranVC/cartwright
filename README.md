# Cartwright

**Cartwright** is a clean-room, fully deterministic simulator of an e-commerce **merchant admin**: products and variants, multi-location inventory, collections, orders, payments, fulfillment, refunds and returns, customers, discount codes, a simple storefront with cart and checkout, and basic sales analytics. It is built as an **RL environment and evaluation harness for AI agents**. The same pure-JS engine runs in the browser (a static single-page admin) and behind an Express REST API, and the repo ships 32 graded tasks. Each task has an automatic checker and a reference solution.

**Live demo:** https://tigranvc.github.io/cartwright/

> Cartwright is an independent project. It is not affiliated with, endorsed by, or derived from Shopify or any other commerce platform's code, assets or branding. Public help-center and API documentation was used only as a reference for *workflows*; see [SPEC.md](SPEC.md#sources).

It is a sibling of [FieldForge](https://github.com/tigranVC/fieldforge), a field-service management simulator. Both follow the same layout and conventions, and new verticals are welcome (see [CONTRIBUTING.md](CONTRIBUTING.md)).

## What's simulated

| Area | Highlights |
|---|---|
| Products & variants | up to 3 options, one variant per combination, SKU (unique per store), price, compare-at price, weight, "continue selling when out of stock" policy, active/draft/archived |
| Inventory | per-location available quantities, adjustments with reasons (received, damaged, cycle count, ...), transfers, full adjustment history |
| Collections | manual (fixed list) and automated/smart (rules on title, type, vendor, tag, variant price/compare-at/inventory/title; match all or any) |
| Orders | order status (open / closed (archived) / cancelled), payment status (pending, authorized, partially_paid, paid, partially_refunded, refunded, voided) derived from transactions, fulfillment status (unfulfilled, partial, fulfilled) |
| Fulfillment | partial fulfillments, carriers + tracking numbers/URLs, tracking corrections, cancel fulfillment |
| Refunds & returns | line-item refunds with exact discount/tax allocation, optional restock to a location, shipping refunds, custom amounts; return requests -> approve/decline -> refund & restock |
| Customers | contact details, marketing consent, tags, multiple addresses with a default, order history and amount spent |
| Discounts | percentage / fixed amount / free shipping; whole order, specific collections or products; minimum subtotal or quantity; total usage limit; once per customer; start/end dates; enable/disable |
| Storefront | catalog of active products, cart, discount codes, checkout -> paid order, inventory decrement, customer auto-created by email |
| Analytics | sales summary (gross, discounts, returns, net, total, AOV, returning customer rate), sales over time (day/week/month), top products by units or revenue |

**Seeded world (seed 42):** 3 stores with 7 locations, 300 products / ~1,350 variants, 27 collections, 21 discount codes, ~1,950 customers and 4,200 orders spanning 180 days. Those orders come with ~4,500 transactions, ~3,800 fulfillments, ~250 refunds and ~150 returns. The simulated clock is fixed at **2026-06-15 10:00**. All money is integer cents (USD).

## Why: agent RL / evals

* **Deterministic.** A seeded PRNG (mulberry32) generates the world, and nothing reads the wall clock or `Math.random`, so the same seed gives a byte-identical state in Node and in every browser.
* **Resettable.** Use `POST /reset` (server), `cartwright.reset(seed)` (browser) or the *Reset to seed* button.
* **Replayable.** The state equals the seed plus the log of successful actions. The SPA persists only `{seed, actions}` in localStorage and rebuilds by replay.
* **Validated.** Every action validates fully before it mutates anything, so a failed action leaves the state untouched and returns `{ok:false, error:{code, message}}`. `validateState` checks global invariants: order totals vs. lines, fulfilled and refunded quantities vs. records, payment and fulfillment status vs. derivation, discount usage counts and limits, SKU and email uniqueness, and non-negative stock for "deny" variants.
* **Graded.** Every task has `check(finalState, initialState, params) -> reasons[]`, and `[]` means pass. `npm run tasks:verify` proves that every checker **fails on the fresh seed** and **passes after the reference solution**.

A typical episode:

```bash
curl -X POST localhost:3040/api/tasks/t05-cancel-order/start      # resets to the task seed, returns the prompt
# ... agent calls REST endpoints ...
curl -X POST localhost:3040/api/tasks/t05-cancel-order/check      # {"pass": true|false, "reasons": [...]}
```

## Quick start

```bash
npm install
npm test                 # engine, determinism, server, docs and task-verification suites
npm run tasks:verify     # each task: fails on seed, passes after reference solution
npm start                # REST API on http://localhost:3040  (--port N, --seed S or PORT/SEED env)
npm run serve:docs       # the SPA on http://localhost:8080 (ES modules need http://)
npm run build            # after editing core/ or tasks/: sync them into docs/
npm run tasks:generate   # rebuild tasks/tasks.json from tasks/specs.js
```

Requires Node >= 18. Express is the only dependency.

### GitHub Pages

`docs/` is a self-contained static site. Its `docs/core` and `docs/tasks` folders are copies made by `npm run build`, and a test asserts they are identical to the sources. Point Pages at the `docs/` folder of the default branch.

### Using the SPA

Pick a store in the top bar. The admin has these pages: Home (to-dos and KPIs), Orders (fulfill, mark paid, capture, refund, return, cancel, archive, notes/tags), Returns, Products (edit, variants, per-location stock), Inventory, Collections, Customers, Discounts, Analytics, a shopper-facing **Storefront** (cart, discount code, checkout) and **Agent tasks** (start/check). Every button calls `window.cartwright.dispatch`, so the UI and the programmatic API cannot diverge. **Reset to seed** in the sidebar restores the pristine world for any seed.

## Conventions

* IDs are prefixed and zero-padded: `STO-1`, `LOC-01`, `PRD-0001`, `VAR-00001`, `COL-001`, `CUS-00001`, `ADR-00001`, `ORD-000001` (order *names* are per store: `#1001`, ...), `LI-000001`, `TRX-000001`, `FUL-00001`, `REF-00001`, `RET-0001`, `DSC-001`, `CRT-0001`, `ADJ-000001`.
* Money is integer **cents** everywhere in the API (`priceCents`, `amountCents`, `minValue` for subtotal minimums). The one exception is smart-collection price conditions, which are decimal dollar strings (`"30.00"`), as in the public commerce APIs that inspired them.
* Dates are `YYYY-MM-DD` and timestamps are `YYYY-MM-DDTHH:MM`, with no timezone.
* Errors are `{ok:false, error:{code, message}}`. Codes include `INVALID_PARAMS`, `NOT_FOUND`, `WRONG_STORE`, `DUPLICATE`, `OUT_OF_STOCK`, `DISCOUNT_INVALID`, `INVALID_STATE`, `INVALID_QUANTITY`, `INVALID_AMOUNT`, `ORDER_FULFILLED`, `ORDER_CANCELLED`, `NEGATIVE_INVENTORY` and `NOTHING_TO_FULFILL`. REST maps `NOT_FOUND` to 404 and the other codes to 422.
* Inventory is committed at the order's assigned location when the order is created: the first location that can supply every "deny" line, unless a location is specified. Fulfillments ship from that location. Restocks add stock back to a chosen location.
* Refund math: a line's net amount (price x qty - allocated discount) and its tax are refunded pro-rata per unit, with rounding that telescopes, so refunding all units returns exactly the line total. Refunding units that have not shipped yet also removes them from fulfillment.

## API reference

The same registry backs the browser API, the REST server and the generic endpoints `POST /api/actions/:name` and `POST /api/queries/:name`. Its live descriptions are served at `GET /api/actions` and `GET /api/queries`.

### Actions (mutations)

| Action | Params | REST route | Description |
|---|---|---|---|
| `createProduct` | storeId, title, vendor?, productType?, tags?, status?, description?, options?, variants?, priceCents?, compareAtCents?, sku?, inventory? | `POST /api/products` | Create a product with options and variants (or a single default variant). |
| `updateProduct` | productId, title?, vendor?, productType?, tags?, status?, description? | `PATCH /api/products/:id` | Update product fields (title, vendor, type, tags, status, description). |
| `addVariant` | productId, options, priceCents, compareAtCents?, sku?, inventoryPolicy?, weightGrams?, inventory? | `POST /api/products/:id/variants` | Add a variant to a product (new option values are appended to the option). |
| `updateVariant` | variantId, priceCents?, compareAtCents?, sku?, inventoryPolicy?, weightGrams? | `PATCH /api/variants/:id` | Update a variant: price, compare-at price (null clears), SKU, inventory policy, weight. |
| `adjustInventory` | variantId, locationId, delta, reason?, note? | `POST /api/inventory/adjust` | Adjust available stock of a variant at a location by a delta (+received / -damaged ...). |
| `setInventory` | variantId, locationId, quantity, reason? | `POST /api/inventory/set` | Set the available quantity of a variant at a location (e.g. after a count). |
| `transferInventory` | variantId, fromLocationId, toLocationId, quantity | `POST /api/inventory/transfer` | Move stock of a variant from one location to another in the same store. |
| `createCollection` | storeId, title, type, productIds?, rules?, disjunctive?, description? | `POST /api/collections` | Create a manual collection (fixed product list) or a smart collection (rules). |
| `updateCollection` | collectionId, title?, description?, rules?, disjunctive? | `PATCH /api/collections/:id` | Update a collection title/description; for smart collections also rules and match mode. |
| `addProductsToCollection` | collectionId, productIds | `POST /api/collections/:id/products` | Add products to a manual collection (already-present products are ignored). |
| `removeProductsFromCollection` | collectionId, productIds | `DELETE /api/collections/:id/products` | Remove products from a manual collection. |
| `createCustomer` | storeId, firstName, lastName, email, phone?, tags?, acceptsMarketing?, note?, address? | `POST /api/customers` | Create a customer (email must be unique within the store). |
| `updateCustomer` | customerId, firstName?, lastName?, email?, phone?, acceptsMarketing?, note?, tags? | `PATCH /api/customers/:id` | Update customer contact details, marketing consent, note or tags (tags replaces all). |
| `addCustomerAddress` | customerId, address1, city, province?, zip?, country?, firstName?, lastName?, setDefault? | `POST /api/customers/:id/addresses` | Add an address to a customer, optionally making it the default. |
| `updateCustomerAddress` | customerId, addressId, address1?, city?, province?, zip?, country? | `PATCH /api/customers/:id/addresses/:addressId` | Edit an existing customer address. |
| `setDefaultAddress` | customerId, addressId | `POST /api/customers/:id/addresses/:addressId/default` | Make one of the customer's addresses the default. |
| `deleteCustomerAddress` | customerId, addressId | `DELETE /api/customers/:id/addresses/:addressId` | Delete a non-default customer address. |
| `addTags` | resource, id, tags | `POST /api/tags/add` | Add tags to an order, customer or product. |
| `removeTags` | resource, id, tags | `POST /api/tags/remove` | Remove tags from an order, customer or product. |
| `createOrder` | storeId, lineItems, customerId?, email?, firstName?, lastName?, discountCode?, shippingMethod?, shippingAddress?, locationId?, paymentStatus?, note?, tags? | `POST /api/orders` | Create an order from the admin (decrements inventory at the chosen location). |
| `updateOrder` | orderId, note?, email?, tags?, shippingAddress? | `PATCH /api/orders/:id` | Edit order note, email, tags (replaces) or shipping address. |
| `markOrderPaid` | orderId, gateway? | `POST /api/orders/:id/mark-paid` | Record a manual payment for the outstanding balance of a pending / partially paid order. |
| `capturePayment` | orderId, amountCents? | `POST /api/orders/:id/capture` | Capture an authorized payment (default: the full authorized amount). |
| `cancelOrder` | orderId, reason?, refund?, restock?, note? | `POST /api/orders/:id/cancel` | Cancel an unfulfilled order: voids an authorization or refunds payment, optionally restocks. |
| `closeOrder` | orderId | `POST /api/orders/:id/close` | Archive (close) an open order. |
| `reopenOrder` | orderId | `POST /api/orders/:id/reopen` | Unarchive (reopen) a closed order. |
| `createFulfillment` | orderId, lineItems?, trackingCompany?, trackingNumber?, trackingUrl?, notifyCustomer? | `POST /api/orders/:id/fulfillments` | Fulfill some or all remaining items of an order from its assigned location, with optional tracking. |
| `updateFulfillmentTracking` | fulfillmentId, trackingCompany, trackingNumber, trackingUrl?, notifyCustomer? | `PATCH /api/fulfillments/:id/tracking` | Set or correct the tracking information on a fulfillment. |
| `cancelFulfillment` | fulfillmentId | `POST /api/fulfillments/:id/cancel` | Cancel a fulfillment; its units become unfulfilled again. |
| `createRefund` | orderId, lineItems?, refundShipping?, shippingCents?, amountCents?, reason?, note? | `POST /api/orders/:id/refunds` | Refund line items (optionally restocking them), shipping, and/or a custom amount. |
| `requestReturn` | orderId, lineItems, requestedBy?, note? | `POST /api/orders/:id/returns` | Create a return for fulfilled items (merchant-created returns start open; customer requests start requested). |
| `approveReturn` | returnId | `POST /api/returns/:id/approve` | Approve a requested return (status -> open). |
| `declineReturn` | returnId, note? | `POST /api/returns/:id/decline` | Decline a requested return. |
| `refundReturn` | returnId, restock?, locationId?, refundShipping?, note? | `POST /api/returns/:id/refund` | Receive an open return: refund its items (optionally restock) and close it. |
| `createDiscount` | storeId, code, type, value?, title?, scope?, collectionIds?, productIds?, minType?, minValue?, usageLimit?, oncePerCustomer?, startsAt?, endsAt? | `POST /api/discounts` | Create a discount code: percentage, fixed amount or free shipping, with requirements and limits. |
| `updateDiscount` | discountId, title?, value?, scope?, collectionIds?, productIds?, minType?, minValue?, usageLimit?, oncePerCustomer?, startsAt?, endsAt?, enabled? | `PATCH /api/discounts/:id` | Edit a discount (value, requirements, limits, dates, title, enabled). Type and code are fixed. |
| `deactivateDiscount` | discountId | `POST /api/discounts/:id/deactivate` | Disable a discount code immediately. |
| `activateDiscount` | discountId | `POST /api/discounts/:id/activate` | Re-enable a disabled discount code. |
| `createCart` | storeId, customerId?, email?, lines? | `POST /api/carts` | Storefront: start a cart (optionally for a known customer). |
| `addToCart` | cartId, variantId?, sku?, quantity? | `POST /api/carts/:id/lines` | Storefront: add a variant to a cart. |
| `updateCartLine` | cartId, variantId, quantity | `PATCH /api/carts/:id/lines/:variantId` | Storefront: change the quantity of a cart line (0 removes it). |
| `applyDiscountCode` | cartId, code? | `POST /api/carts/:id/discount` | Storefront: apply a discount code to a cart (empty code removes it). Validated immediately. |
| `checkout` | cartId, email?, firstName?, lastName?, shippingAddress?, shippingMethod? | `POST /api/carts/:id/checkout` | Storefront: complete checkout for a cart - creates a paid order, decrements inventory, records discount usage, creates the customer if new. |

### Queries (read-only)

| Query | Params | REST route | Description |
|---|---|---|---|
| `listStores` |  | `GET /api/stores` | All stores with their locations and shipping rates. |
| `listLocations` | storeId? | `GET /api/locations` | Inventory locations (optionally for one store). |
| `listProducts` | storeId?, status?, vendor?, productType?, tag?, q?, collectionId?, sku?, offset?, limit? | `GET /api/products` | Products with summary (variant count, total inventory, price range). Filters: status, vendor, productType, tag, q (title), collectionId, sku. |
| `getProduct` | productId | `GET /api/products/:id` | A product with its variants (incl. inventory per location) and the collections it belongs to. |
| `listVariants` | storeId?, productId?, sku?, lowStock?, locationId?, belowQty?, offset?, limit? | `GET /api/variants` | Variants with product title. Filters: productId, sku (substring), lowStock (total available below N), locationId+belowQty. |
| `getVariant` | variantId?, storeId?, sku? | `GET /api/variants/:id` | One variant by variantId or storeId + sku. |
| `inventoryLevels` | storeId, locationId?, productId?, sku?, belowQty?, offset?, limit? | `GET /api/inventory` | Inventory rows (variant x location). Filters: locationId, productId, belowQty, sku. |
| `listInventoryAdjustments` | storeId?, variantId?, locationId?, reason?, offset?, limit? | `GET /api/inventory/adjustments` | Inventory adjustment history, newest first. |
| `listCollections` | storeId?, type?, q? | `GET /api/collections` | Collections with product counts. |
| `getCollection` | collectionId | `GET /api/collections/:id` | A collection with its (computed) products. |
| `listCustomers` | storeId?, q?, tag?, minOrders?, minSpentCents?, sort?, offset?, limit? | `GET /api/customers` | Customers with order count and amount spent. Filters: q (name/email), tag, minOrders, minSpentCents. sort: name\|spent\|orders\|newest. |
| `getCustomer` | customerId | `GET /api/customers/:id` | A customer with addresses, stats and order history (newest first). |
| `listOrders` | storeId?, status?, financialStatus?, fulfillmentStatus?, customerId?, q?, tag?, from?, to?, discountCode?, sku?, sort?, offset?, limit? | `GET /api/orders` | Orders, newest first. Filters: status, financialStatus, fulfillmentStatus, customerId, q (name/email), tag, from/to (dates), discountCode, sku. sort: newest\|oldest. |
| `getOrder` | orderId?, storeId?, name? | `GET /api/orders/:id` | Full order: line items (with fulfillable qty), money summary, transactions, fulfillments, refunds, returns. By orderId or storeId + name ("#1234"). |
| `listReturns` | storeId?, status?, orderId?, offset?, limit? | `GET /api/returns` | Returns, newest first. Filters: status (requested\|open\|closed\|declined), orderId. |
| `listRefunds` | storeId?, orderId?, offset?, limit? | `GET /api/refunds` | Refunds, newest first. |
| `listDiscounts` | storeId?, status?, q? | `GET /api/discounts` | Discount codes with computed status (active, scheduled, expired, exhausted, disabled). |
| `getDiscount` | discountId?, storeId?, code? | `GET /api/discounts/:id` | One discount by discountId or storeId + code. |
| `previewPricing` | storeId, lineItems, discountCode?, shippingMethod?, customerId?, email? | `POST /api/queries/previewPricing` | Price a hypothetical order (lines, discount code, shipping) without creating anything. |
| `storefrontProducts` | storeId, collectionId?, q?, offset?, limit? | `GET /api/storefront/products` | Storefront catalog: active products with variants and availability. Filters: collectionId, q. |
| `listCarts` | storeId?, status? | `GET /api/carts` | Carts (storefront sessions). |
| `getCart` | cartId | `GET /api/carts/:id` | A cart with live pricing (discount applied when valid; discountError explains why not). |
| `analyticsSummary` | storeId, from?, to? | `GET /api/analytics/summary` | Sales summary for a date range (default last 30 days): orders, gross/net sales, discounts, returns, AOV, returning customers. |
| `salesOverTime` | storeId, from?, to?, interval? | `GET /api/analytics/sales` | Sales bucketed by day, week (Monday start) or month. |
| `topProducts` | storeId, from?, to?, by?, limit? | `GET /api/analytics/top-products` | Best-selling products by net units or net sales in a date range. |

### Other REST endpoints

| Method & path | Purpose |
|---|---|
| `POST /reset`, `POST /api/reset` | Reset to a pristine world. Body or query `{seed}`; defaults to the current seed. |
| `GET /api/health` | `{ok, seed, today}` |
| `GET /api/state?include=orders,products` | Raw state, optionally restricted to some collections |
| `GET /api/state/summary` | Meta, collection counts and the active task |
| `GET /api/state/validate` | Invariant check `{ok, problems[]}` |
| `GET /api/action-log` | Successful actions since the last reset |
| `GET /api/fulfillments/:id`, `/api/refunds/:id`, `/api/returns/:id`, `/api/transactions/:id` | Single records |
| `GET /api/tasks`, `GET /api/tasks/:id` | Task list and task details (prompt, seed; no solution params) |
| `POST /api/tasks/:id/start` | Reset to the task's seed and mark it active |
| `POST /api/tasks/:id/check` | Run the checker against the current state: `{pass, reasons}` |

Examples:

```bash
# Fulfill an order with tracking
curl -s -X POST localhost:3040/api/orders/ORD-000004/fulfillments -H 'content-type: application/json' \
  -d '{"trackingCompany":"UPS","trackingNumber":"1Z999AA10123456784"}'
# Refund one unit and restock it
curl -s -X POST localhost:3040/api/orders/ORD-000002/refunds -H 'content-type: application/json' \
  -d '{"lineItems":[{"lineItemId":"LI-000002","quantity":1,"restock":true}],"reason":"customer_request"}'
# Create a discount code
curl -s -X POST localhost:3040/api/discounts -H 'content-type: application/json' \
  -d '{"storeId":"STO-1","code":"SUMMER20","type":"percentage","value":20,"minType":"subtotal","minValue":5000,"usageLimit":100,"oncePerCustomer":true}'
# Storefront: cart -> code -> checkout
curl -s -X POST localhost:3040/api/carts -d '{"storeId":"STO-2","customerId":"CUS-00902"}' -H 'content-type: application/json'
curl -s -X POST localhost:3040/api/carts/CRT-0001/lines -d '{"sku":"SB-001-CHA","quantity":2}' -H 'content-type: application/json'
curl -s -X POST localhost:3040/api/carts/CRT-0001/discount -d '{"code":"WELCOME10"}' -H 'content-type: application/json'
curl -s -X POST localhost:3040/api/carts/CRT-0001/checkout -d '{"shippingMethod":"standard"}' -H 'content-type: application/json'
# Analytics
curl -s 'localhost:3040/api/analytics/top-products?storeId=STO-1&by=units&limit=5'
```

### Browser API (`window.cartwright`)

```js
cartwright.help()                                   // list every action/query with params
cartwright.createFulfillment({ orderId: 'ORD-000004', trackingCompany: 'UPS', trackingNumber: '1Z...' })
cartwright.query('listOrders', { storeId: 'STO-1', financialStatus: 'authorized' })
cartwright.reset(42)                                // pristine world
await cartwright.startTask('t07-capture-authorized'); /* ... */ await cartwright.checkTask()
cartwright.validate()                               // [] when all invariants hold
```

### Node library

```js
import { createEngine, validateState } from './core/index.js';
const engine = createEngine(42);
engine.dispatch('markOrderPaid', { orderId: 'ORD-003318' });   // {ok, result} | {ok:false, error}
engine.query('analyticsSummary', { storeId: 'STO-1' });
engine.reset();
```

## Tasks

`tasks/tasks.json` holds 42 tasks: the 32 original single-workflow tasks (`t01`-`t32`) plus 10 harder multi-step tasks (`t33`-`t42`) tagged `"hard"` (`tags: ["hard"]` in the task JSON). Each has an `id`, `kind`, `title`, `seed`, natural-language `prompt` and hidden `params`. `tasks/kinds.js` defines each kind's `candidates` (how concrete entities are picked from the seeded world), `prompt`, reference solution `solve(env, params)` and checker `check(final, initial, params)`.

| ID | What the agent must do |
|---|---|
| `t01-fulfill-with-tracking` | Fulfill a paid order with tracking |
| `t02-partial-fulfillment` | Ship only one line item of an order |
| `t03-refund-and-restock` | Refund one unit of an order line (with or without restock) |
| `t04-refund-damaged-no-restock` | Refund one unit of an order line (with or without restock) |
| `t05-cancel-order` | Cancel an order, refund and restock |
| `t06-mark-order-paid` | Record a manual payment on a pending order |
| `t07-capture-authorized` | Capture every authorized payment in a store |
| `t08-approve-return-refund` | Approve a return request, refund and restock |
| `t09-decline-return` | Decline a return request |
| `t10-percentage-discount` | Create a percentage discount code with requirements and limits |
| `t11-free-shipping-discount` | Create a scheduled free-shipping code with a minimum quantity |
| `t12-collection-discount` | Create a fixed-amount discount for one collection |
| `t13-disable-leaked-code` | Disable a leaked discount code |
| `t14-create-product-variants` | Create a product with size x color variants, SKUs and stock |
| `t15-put-product-on-sale` | Put a product on sale using compare-at prices |
| `t16-receive-inventory` | Receive a stock delivery |
| `t17-transfer-stock` | Transfer stock between locations |
| `t18-cycle-count` | Apply cycle-count results |
| `t19-smart-collection` | Create an automated (smart) collection |
| `t20-manual-collection-add` | Add products to a manual collection |
| `t21-archive-product-line` | Archive a discontinued product line |
| `t22-tag-vip-customers` | Tag high-spending customers |
| `t23-customer-new-address` | Change a customer's default address |
| `t24-create-customer` | Create a customer record |
| `t25-storefront-checkout` | Place an order through the storefront with a discount code |
| `t26-manual-wholesale-order` | Create a manual order with payment pending |
| `t27-correct-tracking` | Correct the tracking number on a shipment |
| `t28-refund-shipping` | Refund only the shipping charge |
| `t29-archive-completed-orders` | Archive completed orders from a date window |
| `t30-restock-low-inventory` | Top up low stock for one vendor at one location |
| `t31-tag-top-seller` | Tag the best-selling product (analytics) |
| `t32-flag-priority-order` | Tag an order and add a note |
| `t33-damaged-item-complaint` | **hard** Complaint: refund one damaged unit (no restock), create a one-use apology code, tag customer and order, set order note |
| `t34-return-queue-policy` | **hard** Process every requested return in a store: decline those outside the return window (with note), approve + refund the rest, restocking unless the reason is defective |
| `t35-replace-broken-item` | **hard** Refund a broken unit, transfer stock to the shipping warehouse if it has none, create a paid replacement order there and fulfill it with tracking |
| `t36-vendor-season-markdown` | **hard** Mark down a vendor's active, not-yet-on-sale products of one type (compare-at prices), put them in a new manual collection and add a collection-scoped code |
| `t37-count-sheet-net-pending` | **hard** Apply a count sheet, subtracting units still waiting to ship from that location |
| `t38-express-shipping-batch` | **hard** Fulfill all paid, unshipped express orders from a date window, carrier chosen by order total, tracking derived from the order number |
| `t39-merge-duplicate-customer` | **hard** Consolidate a duplicate customer into the older account (tags, address, consent, notes, open order emails) |
| `t40-retail-topup-transfers` | **hard** Top up a retail location from the warehouse with a reserve rule; tag products that are still short "reorder" |
| `t41-winback-campaign` | **hard** Tag lapsed high-spending customers and create a once-per-customer code limited to that many uses |
| `t42-unpaid-orders-cleanup` | **hard** Pending-payment orders: cancel expired ones (restock), tag recent ones for a reminder, record one bank transfer |

Hard tasks typically need 4-12 mutating actions plus several lookups (the reference solutions use 3-19 depending on the world), and include distractors (similar orders, returns, products or customers that must not change), which the checkers verify.

Every task can also be instantiated in another seeded world: `POST /api/tasks/:id/start` accepts an optional JSON body `{"seed": N}`, which re-picks the task's entities in the world generated from seed `N` (in code: `instantiateTask(id, seed)` from `tasks/generate.js`). Every task, hard ones included, has a feasible instance on seeds 1, 2 and 3.

```bash
npm run tasks:verify            # all tasks; exits 1 if any checker passes on seed or fails after its reference solution
node tasks/run.js t03 t25       # a subset by id prefix
npm run tasks:generate          # regenerate tasks.json (deterministic; a test asserts it is reproducible)
```

The checkers verify **outcomes** rather than call sequences, so any valid path works: REST resource routes, generic actions, or the SPA. They also check for collateral damage, such as other orders changing status or extra customers being tagged, and they require all global invariants to still hold.

## Repository layout

```
core/        pure, dependency-free ES modules shared by browser and Node
  prng.js      seeded PRNG                 seed.js      world generator
  catalog.js   static vocabularies         model.js     ids, pricing, discounts, refund math, derived statuses
  actions.js   ACTIONS registry            queries.js   QUERIES registry + analytics
  validate.js  invariants                  engine.js    createEngine / runAction / replay
docs/        static SPA for GitHub Pages (docs/core + docs/tasks are synced copies)
server/      Express REST API over one in-memory engine
tasks/       task kinds, specs, generator, runner, tasks.json
test/        node --test suites
template/    skeleton for a new vertical simulator (see CONTRIBUTING.md)
scripts/     sync-core.js, serve-docs.js
```

## License

MIT, see [LICENSE](LICENSE).
