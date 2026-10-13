# Cartwright: Functional Specification

Cartwright simulates the back office of a small multi-store online retailer: catalog, stock, orders, payments, shipping, returns, customers, promotions, a shopper-facing storefront and sales reporting. This document defines the simulated world, every workflow and its business rules, the data model, the invariants the engine guarantees, and the public references that informed each workflow.

**Clean-room statement.** The behavior below was written from publicly documented *workflows*: merchant help-center articles, public Admin API reference pages and public design-system guidelines (listed under [Sources](#sources)). No proprietary code, assets, screenshots, logos, names or styling were copied. The product name, store names, data, visual design (an indigo/amber palette), IDs and API shapes are original. Where the public docs and this simulator differ, this spec governs the simulator. Cartwright deliberately simplifies many things (see [Non-goals](#non-goals)).

---

## 1. Simulated world

| | Seed 42 |
|---|---|
| Clock | fixed at **2026-06-15 10:00** (`meta.today`, `meta.time`). Actions are stamped with this time. |
| Stores | `STO-1` Fernhollow Apparel (no sales tax), `STO-2` Saltbox Home Goods (7% tax), `STO-3` Ridgeway Trail Supply (8.25% tax) |
| Locations | 2, 2 and 3 per store (`LOC-01`..`LOC-07`). The first location of each store is its main warehouse. |
| Shipping | per store: standard and express flat rates, plus local pickup (free) |
| Catalog | 300 products (120/100/80), ~1,350 variants, vendor and type vocabularies per vertical, ~8% "continue selling" variants, 15% of products on sale (compare-at price) |
| Collections | per store: 2 manual (Staff Picks, Gift Guide) and 7 smart (New Arrivals, Bestsellers, On Sale, Under $30, 3 by product type) |
| Discounts | per store: WELCOME10, SPRING15 (expired), TAKE20 (limit 400), SHIPFREE (3+ items), VIP25 (limit 60, once per customer), FLASH30 (scheduled), STAFFPICK20 (collection-scoped) |
| Customers | 1,950 (900/600/450) with 1-2 addresses and tags (`wholesale`, `newsletter`) |
| Orders | 4,200 over 180 days (denser recently), 1-4 lines each, ~20% with discount codes. The mix covers paid/fulfilled/archived history, recent unfulfilled and partially fulfilled orders, authorized and pending payments, cancellations (voided or refunded), partial and full refunds, and open return requests. |

Generation is a pure function of the seed (`generateState(seed)`). The PRNG is mulberry32 over a string hash, and nothing reads the host clock, timezone or `Math.random`.

---

## 2. Core workflows

### 2.1 Products & variants
* A product has a title, a handle (slug, unique per store), vendor, product type, tags, description and **status** (`active`, `draft` or `archived`). Only active products appear on the storefront and can be bought there. Archived products cannot be ordered at all.
* Up to **3 options** (e.g. Size, Color) can be defined. Creating a product with options and no explicit variant list generates **one variant per combination** (max 100). A product without options has a single "Default Title" variant.
* A variant has its option values, a **SKU** (optional, unique per store and case-insensitive), a **price** and an optional **compare-at price** (the "was" price that shows a sale), a weight, and an inventory policy: `deny` (stop selling at zero) or `continue` (oversell allowed).
* Adding a variant with a new option value appends that value to the option. Option-value combinations are unique per product.
* Editing price or compare-at (null clears it) is an `updateVariant` call. Bulk changes are expressed as multiple calls.

### 2.2 Inventory
* Each variant tracks **available** quantity per location of its store.
* **Adjust** by a non-zero delta with a reason (`received`, `damaged`, `shrinkage`, `cycle_count`, `correction`, `restock`, ...). **Set** an absolute quantity, for example after a count. **Transfer** moves stock between two locations of the same store, and the source must have enough.
* `deny` variants can never go below zero. `continue` variants may go negative through sales.
* Every change writes an adjustment record (`ADJ-…`) with delta, reason, reference and resulting quantity. Sales, cancellations and restocks write them too.

### 2.3 Collections
* **Manual** collections hold an explicit, ordered list of products from the same store, with add and remove actions.
* **Smart (automated)** collections hold rules `{column, relation, condition}` and a match mode: all rules (default) or any rule. Membership is computed live, so products join and leave as their data changes.
  * Columns: `title`, `type`, `vendor`, `tag`, `variant_price`, `variant_compare_at_price`, `variant_inventory`, `variant_title`. A variant rule matches a product when any of its variants matches.
  * Relations: `equals`, `not_equals`, `contains`, `not_contains`, `starts_with`, `ends_with` for text (case-insensitive), and `equals`, `not_equals`, `greater_than`, `less_than` for numbers. Price conditions are decimal dollars.

### 2.4 Orders and payment status
* An order has a per-store **name** (`#1001` ...), customer and email, line items (variant, quantity, unit price, allocated discount, tax), shipping method and address, discount code, assigned location, channel (`online_store` or `admin`), tags and note.
* **Totals:** `total = subtotal − line discounts + shipping − shipping discount + tax`. Tax is computed per line on `(price × qty − discount) × store rate`, and shipping is untaxed.
* **Order status:** `open` → `closed` (archived; can be reopened), or `cancelled` (final).
* **Payment (financial) status** is *derived* from transactions (`authorization`, `capture`, `sale`, `refund`, `void`):
  * nothing captured: `voided` if the authorization was voided, `authorized` if authorized, otherwise `pending` (or `paid` for a $0 order);
  * refunded ≥ captured: `refunded`; some refunded: `partially_refunded`;
  * captured < total: `partially_paid`; otherwise `paid`.
* **Mark as paid** records a manual `sale` for the outstanding balance of a pending or partially paid order. **Capture** captures all or part of an authorized amount.
* **Create order (admin):** for an existing customer, or by email, which finds or creates the customer. The action takes SKUs or variant IDs, an optional code and shipping method, and a payment state of `paid`, `pending` or `authorized`. Inventory is decremented at creation (see 2.9).
* **Cancel:** only when nothing is fulfilled (cancel fulfillments first). The action takes a reason (`customer`, `inventory`, `fraud`, `declined` or `other`). It voids an uncaptured authorization, refunds captured money by default, and restocks unshipped units to the order's location by default. A cancelled order is also closed.

### 2.5 Fulfillment
* An order's **fulfillment status** is derived from its lines. It is `unfulfilled` when no units have shipped, `fulfilled` when no fulfillable units remain, and `partial` otherwise. Fulfillable quantity = `quantity − fulfilled − removed` (removed = refunded or cancelled before shipping).
* A fulfillment ships some or all remaining units from the order's assigned location. It records carrier, tracking number and tracking URL (derived from the carrier when omitted) and a notify-customer flag. Each line's quantity can't exceed its fulfillable quantity. Unpaid orders may be fulfilled, as in real admins.
* Tracking can be corrected later. Cancelling a fulfillment makes its units fulfillable again, unless those units are in a return or were refunded after shipping.

### 2.6 Refunds and returns
* A **refund** may include line units (each optionally **restocked** to a location), the remaining shipping (all or part), and/or a custom amount. The default amount is computed as follows:
  * per line unit: the line's net amount and tax, pro-rated with telescoping rounding, so refunding every unit returns exactly the line's net + tax;
  * plus the shipping being refunded.
* The amount may not exceed `captured − already refunded`. On an unpaid order, a refund of lines moves no money; it only removes or restocks the units.
* Refunding units that haven't shipped removes them from fulfillment.
* **Returns:** created for fulfilled units only (no more than fulfilled minus already-returned). Each line has a reason.
  * Customer-initiated returns start `requested` and are **approved** (→ `open`) or **declined**. Merchant-created returns start `open`.
  * **Refunding** an open return creates the linked refund, restocks by default, and **closes** the return.

### 2.7 Customers
* Fields: first and last name, **email** (required, unique per store, stored lowercase), phone, marketing consent, note, tags, and addresses with **exactly one default** when any exist. The default address can't be deleted.
* Order history and **amount spent** (captured − refunded across all the customer's orders) and order count are computed by queries.
* Tags can be edited by replacing the list (`updateCustomer`) or with `addTags` / `removeTags`, which also work on orders and products.

### 2.8 Discounts
* A code is unique per store (case-insensitive), 3-32 characters of `A-Z 0-9 _ -`.
* **Types:**
  * `percentage` (1-100) of eligible line amounts;
  * `fixed_amount` (cents) once per order, capped at the eligible subtotal and allocated across eligible lines in proportion to their amounts (largest remainder);
  * `free_shipping`, which removes the shipping charge; it is not valid for pickup.
* **Applies to:** the entire order, specific collections (smart membership is evaluated at checkout time) or specific products.
* **Minimum requirements:** none, minimum purchase amount (eligible subtotal), or minimum quantity of eligible items.
* **Limits:** total usage limit, and one use per customer (matched by customer ID or email).
* **Active dates:** `startsAt` and an optional inclusive `endsAt`. The status is computed: `disabled`, `scheduled`, `expired`, `exhausted` or `active`. Deactivating a code disables it but keeps it on record, and it can be re-activated.
* One code per order. Every order that used a code counts toward its usage, including cancelled orders.

### 2.9 Storefront, cart and checkout
* The storefront lists active products, optionally filtered by collection or search. A variant is shown as available if it uses `continue` or any location has stock.
* A **cart** is created for a store, optionally for a known customer. Lines can be added (stock-checked for `deny` variants against the best single location), and quantities updated (0 removes the line). A code is applied with immediate validation. `getCart` returns live pricing, or the reason the code no longer applies.
* **Checkout** does the following:
  * re-validates the code;
  * resolves the customer by cart, email or a newly created customer;
  * uses the given shipping address or the customer's default address (pickup needs none);
  * picks the **first store location that can supply every `deny` line** (`OUT_OF_STOCK` if none can);
  * creates a **paid** `online_store` order;
  * **decrements inventory** at that location;
  * increments the discount's usage;
  * marks the cart `completed` with the order ID.

### 2.10 Analytics
For a store and an inclusive date range (default: the last 30 days):
* *Orders* = non-cancelled orders created in range. *Gross sales* = Σ subtotal, *Discounts* = Σ line discounts.
* *Returns* = Σ refunded line net amounts for refunds created in range, on non-cancelled orders. *Net sales* = gross − discounts − returns.
* *Shipping* and *Taxes* are net of refunds. *Total sales* = net sales + shipping + taxes.
* *Average order value* = (gross − discounts) / orders.
* *Returning customer rate* = the share of ordering customers whose first order predates the range.
* *Sales over time* buckets the same measures by day, ISO week (Monday start) or month.
* *Top products* ranks by net units (quantity − refunded) or net sales.

---

## 3. Data model (state collections)

`stores`, `locations`, `products` (with `variantIds`), `variants` (with `inventory: {locationId: qty}`), `collections`, `customers` (with embedded `addresses`), `orders` (with embedded `lineItems`), `transactions`, `fulfillments`, `refunds`, `returns`, `discounts`, `carts`, `inventoryAdjustments` and `actionLog`, plus `meta` (`seed`, `today`, `time`, id `counters`). Entities are never deleted; archival is a status. Field-level details are visible via `GET /api/state` and in `core/seed.js` / `core/actions.js`.

### Invariants (`validateState`)
* order subtotal, discount and tax equal the sums over lines, and the total formula holds;
* each line's `fulfilledQty` equals the sum of its successful fulfillments, and `refundedQty` equals the sum of its refunds; `fulfilled + removed ≤ quantity`, `refunded ≤ quantity`, and returned units ≤ fulfilled;
* stored payment and fulfillment statuses equal their derivations; refunded ≤ captured; refund transactions equal refund records;
* cancelled orders have nothing fulfilled;
* discount `usageCount` equals the number of orders using it and is ≤ `usageLimit`;
* SKUs are unique per store, variants are linked to their product, and `deny` variants have no negative stock;
* customer emails are unique per store, and each customer with addresses has exactly one default.

---

## 4. Agent layer

* One action registry (`core/actions.js`) and one query registry (`core/queries.js`) back the SPA, `window.cartwright`, the REST server and the task harness, which all behave identically.
* Tasks: `tasks/kinds.js` defines, per kind, `candidates(state, rng, variant)`, `prompt(state, params)`, `solve(env, params)` and `check(final, initial, params) → reasons[]`. `tasks/specs.js` lists the 32 tasks (kind + seed). `tasks/generate.js` deterministically picks, for each task, the first candidate that is feasible, fails the checker on the seed, and passes after the reference solution. `tasks/run.js` re-verifies all of them and exits non-zero on any failure.

---

## Non-goals

These are out of scope: multi-currency, tax regions and exemptions, shipping zones and carrier-calculated rates, gift cards, draft orders as a separate object, order editing (adding or removing lines after creation), exchanges, fraud analysis, payment gateways beyond simple transaction records, fulfillment orders and holds, inventory states other than *available* (committed, incoming, ...), automatic discounts and combinations, B2B catalogs, metafields, themes, apps, and staff permissions.

---

## Sources

Public documentation consulted as **workflow references only**. Vendors reorganize their docs over time, so some paths may move; the references are listed so that reviewers can check that behavior came from public material, not proprietary code.

**Products & variants**
* https://help.shopify.com/en/manual/products
* https://help.shopify.com/en/manual/products/variants
* https://help.shopify.com/en/manual/products/details/product-pricing/sale-pricing
* https://shopify.dev/docs/api/admin-rest/latest/resources/product
* https://shopify.dev/docs/api/admin-rest/latest/resources/product-variant

**Inventory & locations**
* https://help.shopify.com/en/manual/products/inventory
* https://help.shopify.com/en/manual/products/inventory/getting-started-with-inventory/inventory-adjustments-history
* https://help.shopify.com/en/manual/locations
* https://shopify.dev/docs/api/admin-rest/latest/resources/inventorylevel
* https://shopify.dev/docs/api/admin-rest/latest/resources/inventoryitem
* https://shopify.dev/docs/api/admin-rest/latest/resources/location

**Collections**
* https://help.shopify.com/en/manual/products/collections
* https://help.shopify.com/en/manual/products/collections/automated-collections
* https://help.shopify.com/en/manual/products/collections/automated-collections/auto-select
* https://shopify.dev/docs/api/admin-rest/latest/resources/customcollection
* https://shopify.dev/docs/api/admin-rest/latest/resources/smartcollection
* https://shopify.dev/docs/api/admin-rest/latest/resources/collect

**Orders & payment status**
* https://help.shopify.com/en/manual/orders
* https://help.shopify.com/en/manual/orders/order-status
* https://help.shopify.com/en/manual/orders/create-orders
* https://help.shopify.com/en/manual/orders/cancel-delete-order
* https://help.shopify.com/en/manual/orders/manage-orders
* https://help.shopify.com/en/manual/payments/payment-authorization
* https://shopify.dev/docs/api/admin-rest/latest/resources/order
* https://shopify.dev/docs/api/admin-rest/latest/resources/transaction

**Fulfillment**
* https://help.shopify.com/en/manual/fulfillment
* https://help.shopify.com/en/manual/orders/fulfill-orders
* https://help.shopify.com/en/manual/orders/fulfillment-status
* https://shopify.dev/docs/api/admin-rest/latest/resources/fulfillment
* https://shopify.dev/docs/api/admin-rest/latest/resources/fulfillmentorder

**Refunds & returns**
* https://help.shopify.com/en/manual/orders/refund-cancel-order
* https://help.shopify.com/en/manual/orders/manage-returns
* https://shopify.dev/docs/api/admin-rest/latest/resources/refund
* https://shopify.dev/docs/api/admin-graphql/latest/objects/Return
* https://shopify.dev/docs/apps/build/orders-fulfillment/returns-apps

**Customers**
* https://help.shopify.com/en/manual/customers
* https://help.shopify.com/en/manual/customers/manage-customers
* https://shopify.dev/docs/api/admin-rest/latest/resources/customer
* https://shopify.dev/docs/api/admin-rest/latest/resources/customer-address
* https://shopify.dev/docs/api/admin-graphql/latest/mutations/tagsAdd

**Discounts**
* https://help.shopify.com/en/manual/discounts
* https://help.shopify.com/en/manual/discounts/discount-types
* https://help.shopify.com/en/manual/discounts/discount-types/percentage-fixed-amount
* https://help.shopify.com/en/manual/discounts/discount-types/free-shipping
* https://shopify.dev/docs/api/admin-rest/latest/resources/pricerule
* https://shopify.dev/docs/api/admin-rest/latest/resources/discountcode

**Storefront, cart & checkout**
* https://help.shopify.com/en/manual/checkout-settings
* https://help.shopify.com/en/manual/orders/abandoned-checkouts
* https://shopify.dev/docs/api/admin-rest/latest/resources/abandoned-checkouts
* https://shopify.dev/docs/api/admin-rest/latest/resources/draftorder

**Analytics**
* https://help.shopify.com/en/manual/reports-and-analytics
* https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/sales-reports
* https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/overview-dashboard

**Admin UI patterns (layout and interaction guidance only; no components or styles copied)**
* https://polaris.shopify.com/foundations
* https://polaris.shopify.com/components/tables/index-table
* https://polaris.shopify.com/components/feedback-indicators/badge
* https://polaris.shopify.com/components/layout-and-structure/page
* https://polaris.shopify.com/patterns
