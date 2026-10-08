# Extras ERP

Enterprise apparel ERP (multi-company, wholesale matrix, production, accounts, HR) built from
[`ERP_Blueprint.md`](./ERP_Blueprint.md).

**Stack:** Next.js (App Router, TypeScript) · PostgreSQL + Prisma · Tailwind CSS · Docker

## Local setup

Requires Node.js 22 and Docker.

```bash
cp .env.example .env        # then edit the values
npm install                 # installs packages and generates the Prisma client
npm run db:up               # starts PostgreSQL in Docker
npm run db:deploy           # creates all database tables
npm run db:seed             # permissions, companies, built-in roles and the owner account
npm run dev                 # http://localhost:3000
```

Sign in at <http://localhost:3000> with the owner account from `.env` (`SEED_ADMIN_EMAIL` and
`SEED_ADMIN_PASSWORD`). Check the database connection at <http://localhost:3000/api/health>.

## Useful commands

| Command              | What it does                                    |
| -------------------- | ----------------------------------------------- |
| `npm run db:migrate` | Create a new migration after editing the schema |
| `npm run db:studio`  | Browse the database in a web UI                 |
| `npm run typecheck`  | TypeScript check                                |
| `npm run lint`       | ESLint                                          |
| `npm run build`      | Production build                                |

## Running on the server

The ERP runs on one Azure Ubuntu 24.04 server in Docker: PostgreSQL 16, the app, and Caddy
for HTTPS with a free Let's Encrypt certificate. [`deploy/README.md`](./deploy/README.md) is
the step-by-step guide, from creating the server to backups, restoring, updates and moving
to a new server. The scripts and settings are in [`deploy/`](./deploy), and the app's image
in the [`Dockerfile`](./Dockerfile).

In production the app runs three clocks of its own: the daily backup (02:00), reminders, and
the nightly housekeeping (03:30, Asia/Dhaka), which marks idle buyers dormant, closes settled
accounts and removes expired sign-ins (`src/modules/housekeeping/scheduler.ts`). Each is off
in development; set `BACKUP_SCHEDULER`, `REMINDER_SCHEDULER` or `HOUSEKEEPING_SCHEDULER` to
`on` or `off` to choose.

## Folder structure

```
deploy/                  # the server: Docker, HTTPS, backups and restore (see deploy/README.md)
prisma/
  schema.prisma          # full database design (97 tables)
  migrations/            # SQL migrations applied to PostgreSQL
src/
  app/                   # Next.js App Router: (auth) sign-in screens, (app) signed-in screens, api/
  components/            # ui/ (shadcn/ui), shell/ (top bar, menus), then one folder per module
  hooks/                 # shared React hooks
  lib/                   # env validation, Prisma client
  modules/<module>/      # one folder per blueprint module (sales, production, ...)
  proxy.ts               # sends visitors without a session to sign in
  server/actions/        # Server Actions
  server/pages/          # the screens' gatekeepers (session, new password, company)
  server/services/       # business logic shared across modules
  styles/globals.css     # Tailwind + brand colors
  types/                 # shared TypeScript types
```

## Screens

Built one module at a time, each in its own pull request. So far:

- **Sign in** (`/sign-in`) with email and password. Someone with a temporary password (a new
  member, or a reset by the administrator) sets their own at `/change-password` before
  anything else opens. Anyone can change their password from the account menu, and sign out
  their other phones and computers at the same time.
- **Choose a company** (`/select-company`) when no company is open or access to it was
  removed. The switcher in the top bar changes company at any time.
- **Dashboard** (`/`): the key figures (stock value, fixed assets, liabilities, today's sales,
  net profit), each with an eye that hides it on that person's screens, and the Insights: top
  sellers (period, SKUs or styles, by pieces or sales value, kept in the address so a link
  shows the same list), highest stock, dead and slow stock, and low stock.
- **Settings** (`/settings`), in three tabs:
  - **Team**: everyone in the company, with a search and a list of deactivated people. Adding
    a person takes their email, name and role; someone new gets a temporary password, shown
    once with a copy button, for the administrator to hand over (sending it by email or
    WhatsApp comes with the integrations). Each person's menu changes their role, issues a new
    temporary password (signing them out everywhere), or deactivates or reactivates them.
  - **Roles**: the built-in and custom roles and what each allows. A new role starts empty or
    from a copy of another role's permissions, which are grouped by area. Ticking a money
    permission (recording money received or paid) for a role other than Accounts shows a
    warning. Built-in roles keep their names and cannot be deleted; Super Admin always has
    every permission.
  - **Company**: name and contact details, the letterhead (logo, colours, footer), business
    rules (low stock level, advance percentage, when a buyer counts as dormant) and money and
    time (currency, time zone, first month of the financial year).
- **Products** (`/products`), in four tabs:
  - **Styles**: the styles as cards with the pieces ready to sell, B-grade and SKU count,
    browsed by category (a tree on computers, a picker on phones) and brand, with archived
    styles on request. The search takes a style's name or code, or an exact SKU or barcode,
    which opens that SKU. A brand's stock sheet (PDF) prints from here. A style's page shows
    its details, its **stock matrix** (colours down, sizes across, all warehouses or one; red
    below the low stock level) and its stock history. A matrix cell opens its SKU: prices,
    barcode and stock in each warehouse, and for managers editing the SKU (barcode, own
    prices, offered for sale), correcting its stock and moving pieces to bad stock. Managers
    also add styles, add colours or sizes to a style (making its SKUs), edit, archive and
    restore it, and delete a style that has no history yet.
  - **Stock count**: pick a style, warehouse and grade, type the pieces found on the shelf
    for each SKU and save only the differences (missing pieces are booked as a loss). If stock
    moves while counting (a sale, another count), the save is refused and the sheet reloads
    the new shelf numbers, keeping what was typed. The same tab enters **opening stock**: the
    pieces held before starting with Extras ERP, at an optional cost per piece.
  - **Bad stock**: the pieces taken out of the sellable stock, for a period, with why, where
    from and who recorded them. Managers record bad stock from a SKU or barcode.
  - **Setup**: colours (with their swatch), sizes (in matrix order), the category tree,
    brands and warehouses. Something already in use cannot be deleted. Names are unique
    whatever their letter case ("maroon" next to Maroon is refused).

The screens ask the same Server Actions as the API, so the backend's permissions decide what
appears. With the built-in roles' default permissions:

| Role                       | Key figures | Insights | Sales values | Stock values, costs, margins |
| -------------------------- | ----------- | -------- | ------------ | ---------------------------- |
| Super Admin, Accounts      | Yes         | Yes      | Yes          | Yes                          |
| Sales Executive, Warehouse | No          | Yes      | Yes          | No                           |
| Production Manager         | No          | Yes      | No           | No                           |
| Employee                   | No          | No       | No           | No                           |

Products follows the inventory permissions:

| Role                               | Products menu | Changes (styles, SKUs, counts, bad stock, setup) | Costs and losses |
| ---------------------------------- | ------------- | ------------------------------------------------ | ---------------- |
| Super Admin                        | Yes           | Yes                                              | Yes              |
| Production Manager, Warehouse Team | Yes           | Yes                                              | No               |
| Sales Executive                    | Yes (to look) | No (no Stock count tab, Setup is read-only)      | No               |
| Accounts, Employee                 | No            | No                                               | No               |

Reading needs `inventory.view` and changing needs `inventory.manage`. What stock cost (a
SKU's average cost, the value of each stock movement, the loss on bad stock) shows only to
people who see the financials (`dashboard.financials` or `accounts.view`); for everyone else
the server leaves it out. Opening stock asks for a cost per piece, so the people who enter it
(those with `inventory.manage`) decide what it is worth in the books.

Settings follows the same rule. The Team tab needs `company.members.manage`. The Roles tab
opens with `company.members.manage` (to read them) or `company.roles.manage` (to change them).
Everyone can read the company details, and `company.settings` lets them be changed. Settings
shows in the menu for people holding any of these three, which by default is only Super Admin.

On the Team tab, someone who manages the team without being a Super Admin cannot give the
Super Admin role or change, deactivate, reactivate or reset a Super Admin. The company always
keeps one active Super Admin. Nobody can deactivate or reset themselves; they change their own
password instead. Only the platform owner can reset the platform owner or someone who also
works in another company. Each person's menu offers exactly what these rules allow.

For developers:

- `src/proxy.ts` only checks that a session cookie is there: visitors without one go to sign
  in and come back to the page afterwards. It renews the cookie but never decides access.
- Every screen starts with `requireCompanyPage()` from `src/server/pages/guards.ts`, the same
  check the Server Actions make. It sends people to sign in, to set a new password or to
  choose a company.
- A module's screens add their menu entry, with the permissions that open it, in
  `src/components/shell/nav-items.ts`.
- When a screen offers actions on each row, the service that enforces them sends a flag for
  each one, decided by the same rules, so a button never appears for something the server
  refuses (or goes missing for something it allows). The Team and Roles rules live in
  `src/modules/rbac/rules.ts` and the catalogue's (what may be deleted) in
  `src/modules/inventory/rules.ts`; `tests/integration/team-screens.test.ts` and
  `tests/integration/products-screens.test.ts` try every action as different people and check
  it works exactly when it is offered.
- Filters and pickers that live in the address (the style list, the stock count, the matrix's
  warehouse) show the choice at once and dim the list until the new one arrives.
- A page (a Server Component) gets only the components of a `"use client"` file, so values
  both sides need (like a page size) go in a plain module next to it;
  `tests/unit/server-client-imports.test.ts` checks this.
- Components are [shadcn/ui](https://ui.shadcn.com) in `src/components/ui` (add more with
  `npx shadcn@latest add <name>`), in the brand colours from `src/styles/globals.css`. The
  fonts (Inter, Playfair Display, Noto Sans Bengali) are bundled with the app.
- When something fails, the screen shows the blueprint's error window: "An error occurred.
  Error Code: ERR-…". The server log has the same code next to the error.

## Login, companies and roles (backend)

Sessions use an httpOnly cookie; only a SHA-256 hash of the token is stored. Passwords use
scrypt. Five failed logins lock an account for 15 minutes. Every request re-checks the user's
membership, so deactivating someone takes effect immediately.

Server code gets the signed-in context from `src/modules/auth/context.ts`:

```ts
const ctx = await requirePermission("sales.order.create");
ctx.db.salesOrder.findMany(); // ctx.db only ever sees the active company's rows
```

The permission list and the default grants for the built-in roles (the five from the blueprint
plus **Accounts**) live in `src/modules/rbac/permissions.ts`. Recording money is kept apart from
selling and producing: by default only Super Admin and Accounts hold `accounts.receipts.record`
(money received from buyers) and `accounts.payments.record` (money paid to suppliers).

| Endpoint                                             | Purpose                                                  |
| ---------------------------------------------------- | -------------------------------------------------------- |
| `POST /api/auth/login`                               | Sign in (`email`, `password`)                            |
| `POST /api/auth/logout`                              | Sign out this device                                     |
| `GET /api/auth/me`                                   | User, company switcher list, active company, permissions |
| `POST /api/auth/switch-company`                      | Change the active company (`companyId`)                  |
| `POST /api/auth/change-password`                     | Change own password                                      |
| `GET/POST /api/companies`                            | List switchable companies / create one (platform owner)  |
| `GET/PATCH /api/company`                             | Active company profile and letterhead details            |
| `GET /api/permissions`                               | Permission catalogue for the role editor                 |
| `GET/POST /api/roles`, `PATCH/DELETE /api/roles/:id` | List roles (either team permission) and manage them      |
| `GET/POST /api/members`, `PATCH /api/members/:id`    | Add users, change role, deactivate                       |
| `POST /api/members/:id/reset-password`               | Issue a temporary password                               |
| `GET /api/audit-logs`                                | Audit trail with filters                                 |

The same operations are available as Server Actions in `src/server/actions/`.

## Inventory (backend)

Category tree → Brand → Style → color × size matrix, where each cell is one SKU
(`EX-PL-001-NAVY-XL`). Stock is kept per SKU, warehouse and grade (A / B) with a movement
log for every change. Available stock is A-grade minus reserved, and stock never goes below
zero here (Force Override comes with the Sales module). Each SKU keeps two weighted average
costs, one for A-grade and one for B-grade (`avgCost` and `bGradeAvgCost`), so cheaper seconds
never pull down the cost of first-quality stock. Stock coming in re-weights only its own grade's
cost; corrections, bad stock, deliveries and the stock value all use the grade's own cost. Bad
stock records the loss at that cost.

| Endpoint                                                                | Purpose                                                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------- |
| `GET /api/inventory/tree`                                               | Category → Brand → Style navigation                     |
| `GET/POST /api/inventory/categories`, `PATCH/DELETE …/:id`              | Category tree                                           |
| `GET/POST /api/inventory/brands`, `PATCH/DELETE …/:id`                  | Brands                                                  |
| `GET/POST /api/inventory/colors`, `PATCH/DELETE …/:id`                  | Colors with hex codes (matrix rows)                     |
| `GET/POST /api/inventory/sizes`, `PATCH/DELETE …/:id`, `POST …/reorder` | Sizes (matrix columns)                                  |
| `GET/POST /api/inventory/styles`, `GET/PATCH/DELETE …/:id`              | Styles; filter by category, brand, search               |
| `GET/POST /api/inventory/styles/:id/matrix`                             | Matrix with live stock / create missing SKUs            |
| `GET/PATCH /api/inventory/variants/:id`                                 | SKU with stock per warehouse / price, barcode, on sale  |
| `GET /api/inventory/lookup?code=`                                       | Find a SKU by barcode or SKU                            |
| `GET/POST /api/inventory/ratio-presets`, `PATCH/DELETE …/:id`           | Saved size ratios                                       |
| `POST /api/inventory/ratio-fill`                                        | Ratio Fill quantities (packs or total, capped to stock) |
| `GET/POST /api/inventory/warehouses`                                    | Warehouses                                              |
| `POST /api/inventory/stock/adjust`                                      | Opening stock or +/- correction                         |
| `POST /api/inventory/stock/count`                                       | Stock count (only differences) or opening stock         |
| `GET/POST /api/inventory/stock/bad-stock`                               | Bad stock entries / move to Bad Stock (inventory loss)  |
| `GET /api/inventory/stock/movements`                                    | Stock history                                           |
| `GET /api/inventory/stock/summary`                                      | Stock value, low / highest / slow stock, top sellers    |

Reads need `inventory.view`; changes need `inventory.manage`. Costs (average costs, movement
values, bad stock losses) come back only to people who see the financials, and the SKU lookup
and SKU change return prices but never costs. Server Actions for all of these are in
`src/server/actions/inventory.actions.ts`.

## Buyers & Suppliers (backend)

One profile per buyer, supplier or both (`BUY-0001`, `SUP-0001`, `BS-0001`), with a grade
(A+, A, B, C), the Blue Verified badge, a credit limit and an account status. Closing an
account that still owes or is owed money moves it to **Settling** (no new business) and it
closes on its own once the balance reaches zero. Buyers with no business for the company's
"dormant after" period (6 months by default) become **Dormant** and wake up on their next
sale. The server checks every night at 03:30 (Asia/Dhaka) for every company, and the refresh
endpoint below runs the same check on demand.

Balances come from the double-entry journal: every journal line tagged with a party on the
Receivable, Payable or Customer Advance account counts. Positive means they owe us, negative
means we owe them. Sales, Purchasing and Accounts will post those entries; this module reads
them and posts the one-off opening balance. Statement periods follow the company's timezone,
so `to=2026-02-28` includes everything posted on 28 February in Dhaka.

**Walk-in customers.** Sales without a buyer profile (counter sales, and website or social
orders taken by name only) post their receivable and advance lines to one account the system
keeps for each company: **Walk-in customers** (`WALK-IN`, marked `systemRole: WALK_IN`), made
with the company's first such sale. Its statement lists every walk-in sale, and the
receivables overview counts what walk-in customers still owe. The orders, invoices and
payments themselves keep no buyer; the customer's name and phone stay on the order. The
account is never the buyer on a quotation, proforma, order or payment (leave the buyer empty
instead), stays open and ungraded, is left out of dormant lists, status refreshes and
campaigns, and only its name and notes can be changed. On a database with walk-in sales from
before this account existed, the upgrade makes it and names it on those sales' lines.

| Endpoint                                                   | Purpose                                                     |
| ---------------------------------------------------------- | ----------------------------------------------------------- |
| `GET/POST /api/parties`                                    | List (type, grade, badge, status, city, search) / create    |
| `GET/PATCH /api/parties/:id`                               | 360° profile with balance and activity / edit               |
| `PUT /api/parties/:id/grade`                               | Set A+, A, B, C or none                                     |
| `PUT /api/parties/:id/verify`                              | Give or remove the Blue Verified badge                      |
| `PUT /api/parties/:id/status`                              | Active, Dormant, Closed (Settling while dues remain)        |
| `PUT /api/parties/:id/opening-balance`                     | Balance brought forward (posts a journal voucher)           |
| `GET /api/parties/:id/statement?from=&to=`                 | Statement: summary page plus date-wise log, running balance |
| `GET /api/parties/receivables-payables`                    | Total receivables and payables with per-party breakdown     |
| `GET /api/parties/dormant?months=6\|12&buyerTypes=`        | Dormant buyers (wholesale and B2B by default)               |
| `POST /api/parties/refresh-statuses`                       | Mark idle buyers dormant, close settled accounts            |
| `GET/POST /api/parties/campaigns`                          | Re-engagement campaigns (WhatsApp, email or SMS)            |
| `GET /api/parties/campaigns/:id`                           | Personalised message and one-click link for each buyer      |
| `PATCH /api/parties/campaigns/:id/recipients/:recipientId` | Log sent, delivered, read, failed or responded              |
| `POST /api/parties/campaigns/:id/complete` / `…/cancel`    | Finish or cancel a campaign                                 |

Campaign messages can use `{BuyerName}`, `{ContactPerson}`, `{CompanyName}` and
`{CatalogLink}`. Automatic sending through a WhatsApp Business or email provider comes with
the notifications work; for now each buyer gets a ready-to-send link.

Profiles and the dormant list need `parties.view`; changes need `parties.manage`; statements
and the receivables overview need `parties.ledger.view`; opening balances need
`accounts.manage`; campaigns need `sales.campaigns.manage`. Server Actions for all of these
are in `src/server/actions/parties.actions.ts`. Sales and Purchasing will call
`assertPartyCanTransact` (type, status and credit limit check) and `recordPartyActivity`
from `src/modules/parties/party.service.ts`.

## Sales: quotations and orders (backend)

**B2B pre-order flow.** Quotation (items by category / style, fabric, quantity or a size
breakdown, styling rules such as "the placket should not have a black border", and the
company's custom fields) → one-click Proforma Invoice with an advance (30% by default) → when
the advance is fully paid a Production project starts on its own → when the goods are ready
the proforma becomes a sales order and the advance moves with it.

**Orders and stock.** Orders are entered as SKU lines or straight from the color × size
matrix. Confirming an order reserves its stock, so the matrix shows the real available
quantity at once. The delivery challan takes the pieces out of stock. Asking for more than is
available returns `409 INSUFFICIENT_STOCK` with the short SKUs, which is the cue for the
"Force Override & Sell" warning. Overriding needs `sales.force_override`, is recorded on each
line and lands in the audit log.

**Documents at checkout (optional).** Commercial Invoice (made by default), Packing List /
pick-list and Delivery Challan (price-free). Payment taken at the counter can be included when
the user may record money (see below). Everything is saved together or not at all.

**Shipment date.** An order can carry the day it is due to ship (`shipmentDate`), set at
checkout, when a proforma becomes an order, or later. It cannot be before the order date and
can change until the goods are delivered; changes are in the audit log. Shipment reminders
follow it (see [automatic reminders](#notepad-tasks-and-reminders-backend)).

**Refunds and cancelling paid work.** Money a buyer paid can be taken back off an order or a
proforma, or off the credit on their account, in one of three ways: paid back (cash, bank or a
wallet), kept as credit on the buyer's account, or kept as a cancellation charge. Each refund is
a numbered voucher (`RF-2026-00001`). An order or proforma holds what was received on it less
its refunds, which is its paid amount; a proforma whose advance a refund brings back under the
required amount keeps its production running, but cannot become an order until the advance is
paid again. Money on a live invoice is not refunded on its own: the invoice is voided first,
which turns its payments back into an advance.

An order or proforma that still holds money cannot be cancelled until that money is settled.
Either Accounts refunds it first and Sales then cancels as usual, or whoever cancels says how
to settle it (`settle`) and the whole amount is refunded as part of the cancel. Cancelling an
invoiced order also voids its invoice, which needs `sales.invoice.edit`, so a paid, invoiced
order is cancelled by the Super Admin by default. A refund recorded by mistake can be voided,
which puts the money back where it came from, but not once its order or proforma is cancelled,
the order is invoiced again, the order or proforma has since been paid up to its total, or
credit it left on the account has been used. A walk-in customer has no account of their own,
so their money is paid back or kept as a charge, never kept as credit.

**Books.** Every step posts a balanced journal entry, so the buyer's ledger, statements and
the receivables overview update immediately. For a sale without a buyer, the lines marked
"buyer" below name the [Walk-in customers](#buyers--suppliers-backend) account:

| Event                  | Entry                                                          |
| ---------------------- | -------------------------------------------------------------- |
| Payment before invoice | Dr Cash / Bank / Wallet, Cr Customer Advance (buyer)           |
| Invoice                | Dr Receivable (buyer), Cr Sales / Delivery income / VAT        |
| Advance applied        | Dr Customer Advance, Cr Receivable (inside the invoice entry)  |
| Payment after invoice  | Dr Cash / Bank / Wallet, Cr Receivable (buyer)                 |
| Delivery               | Dr Cost of Goods Sold, Cr Inventory (at average cost)          |
| Invoice void           | Mirror entry; payments become the buyer's advance again        |
| Refund paid back       | Dr Customer Advance (buyer), Cr Cash / Bank / Wallet           |
| Refund kept as credit  | Dr Customer Advance, Cr Receivable (buyer)                     |
| Cancellation charge    | Dr Customer Advance (buyer), Cr Other Income                   |
| Account credit refund  | Dr Receivable (buyer), Cr Cash / Bank / Wallet or Other Income |
| Refund void            | Mirror entry; the money is held where it came from again       |

| Endpoint                                                           | Purpose                                                  |
| ------------------------------------------------------------------ | -------------------------------------------------------- |
| `GET/POST /api/sales/custom-fields`, `PATCH …/:id`                 | Extra fields for quotations and other records            |
| `GET/POST /api/sales/quotations`, `GET/PATCH/DELETE …/:id`         | Quotation builder (data for the letterhead PDF)          |
| `PUT /api/sales/quotations/:id/status`                             | Sent, accepted or rejected                               |
| `POST /api/sales/quotations/:id/convert`                           | Make the proforma invoice                                |
| `GET /api/sales/proformas`, `GET …/:id`                            | Proformas with advance due, payments and production      |
| `POST /api/sales/proformas/:id/cancel` / `…/convert`               | Cancel, settling any advance / turn into a sales order   |
| `GET/POST /api/sales/orders`, `GET/PATCH …/:id`                    | Orders and checkout; edit before delivery and invoicing  |
| `POST /api/sales/orders/:id/cancel`                                | Cancel, settling any money paid, and free the stock      |
| `POST /api/sales/orders/:id/shipment`                              | Set, move or clear the shipment date: `{ shipmentDate }` |
| `POST /api/sales/orders/:id/invoice` / `packing-list` / `challans` | Make each document later                                 |
| `GET /api/sales/invoices/:id`, `POST …/:id/void`                   | Commercial invoice / void it (audited)                   |
| `GET /api/sales/packing-lists/:id`, `PUT …/:id/pick`               | Pick-list and picking progress                           |
| `GET /api/sales/challans`, `GET …/:id`                             | Challan history and the price-free challan               |
| `GET/POST /api/sales/payments`, `GET …/:id`                        | Money received (order, proforma or on account), receipts |
| `GET/POST /api/sales/refunds`, `GET …/:id`, `POST …/:id/void`      | Refunds to buyers (paid back, credit, charge) / void one |
| `GET /api/sales/summary?from=&to=`                                 | Today's sales, collections less refunds, and open dues   |

Reads need `sales.view`; quotations and proformas need `sales.quotation.manage`; orders and
documents need `sales.order.create`; recording money received (on its own or at checkout)
needs `accounts.receipts.record`, which only Accounts and Super Admin hold by default, so
Sales Executives create orders and proformas but never record receipts; voiding an invoice
needs `sales.invoice.edit`; custom field definitions need `company.settings`. Refunds, and a
cancel that settles money, are Accounts' work too: paying money back needs
`accounts.payments.record`, keeping it as credit `accounts.receipts.record`, and keeping it as a
cancellation charge `accounts.manage`. Cancel bodies are `{ reason, settle?: { kind, method?,
accountId?, refundDate?, reference?, notes? } }`. Server Actions are in
`src/server/actions/sales.actions.ts`. Website / courier sync and returns QC come next in
this module.

## Production (backend)

**Projects.** A production project records the item (category / style), the factory (a
supplier profile, or just its name), the target date and quantity, and the buyer or
In-House. Projects start Active, or Planned for later. A fully paid proforma advance starts
one on its own with a 45-day target. The overview shows a card for each open project with its
elapsed and remaining days in company time. A card turns red once its target date has passed,
and shows the stage badge: Fabric Sourcing → Cutting → Sewing → Wash/QC → Finishing. Every
stage change is logged; going back a stage (rework) needs a note.

**Costs.** Every cost names an expense head (Fabric, Trims & Accessories, Cutting, Sewing
(CM), Wash...). It is either Due to a supplier or paid now from cash, bank or a mobile
wallet. One supplier bill can be split across several projects (Split Bill). Production
Managers record Due bills. Paying suppliers and costs paid in cash or bank are for Accounts.
Voiding a bill reverses it, and anything already paid on it stays with the supplier as an
advance.

**Move to Stock.** A factory delivery is typed in (SKU lines or the color × size matrix, A-
and B-grade), or read by AI from a packing-list photo or PDF and matched to the style's SKUs
for a person to check. Confirming a delivery puts the pieces into stock and moves its share
of the project's cost from work in progress into inventory. That share follows the pieces
still expected (300 of 1,000 take 30%), and the final delivery takes the rest. Within the
delivery the cost is split per piece in one of three ways: equally, with B-grade valued at a
ratio of A-grade (half by default), or as typed in. Each SKU's average cost for that grade is
re-weighted, so sales are costed at what the goods cost to make.

**Undoing a delivery.** A delivery moved to stock by mistake (wrong counts, wrong SKUs, the
wrong project) can be undone with a reason, as long as the warehouse still has that many free
pieces of each SKU and grade. Its pieces leave stock, its cost goes back to the project's work
in progress, each SKU's average cost is put back as if the pieces had never come in, and the
project's produced counts go down. A completed project is reopened at its last working stage.
If the stock's value moved in between (other deliveries came and went), the small difference is
booked to Production & Inventory Losses so the inventory account keeps matching the stock.
With `redraft` a draft copy opens, linked to the undone one, to correct and confirm again.

| Event                        | Entry                                                    |
| ---------------------------- | -------------------------------------------------------- |
| Supplier bill                | Dr Work in Progress (per project), Cr Payable (supplier) |
| Supplier paid                | Dr Payable (supplier), Cr Cash / Bank / Wallet           |
| Cost paid without a supplier | Dr Work in Progress, Cr Cash / Bank / Wallet             |
| Delivery moved to stock      | Dr Finished Goods Inventory, Cr Work in Progress         |
| Unrecovered cost written off | Dr Production & Inventory Losses, Cr Work in Progress    |
| Delivery undone              | Mirror of the delivery entry, plus any value difference  |

| Endpoint                                                            | Purpose                                                    |
| ------------------------------------------------------------------- | ---------------------------------------------------------- |
| `GET /api/production/overview`                                      | Dashboard: counts, projects per stage, project cards       |
| `GET/POST /api/production/projects`, `GET/PATCH …/:id`              | Projects (status, stage, buyer, In-House, overdue, search) |
| `POST /api/production/projects/:id/stage`                           | Move the stage badge                                       |
| `POST /api/production/projects/:id/status`                          | Start, hold or resume                                      |
| `POST /api/production/projects/:id/complete` / `…/cancel`           | Close a project (leftover cost written off by Accounts)    |
| `GET/POST /api/production/projects/:id/costs`                       | Cost sheet / add one cost, Due or paid now                 |
| `POST /api/production/costs/:id/void`                               | Void a cost paid in cash or bank                           |
| `GET/POST /api/production/cost-heads`, `PATCH …/:id`                | Expense heads for production costs                         |
| `GET/POST /api/production/bills`, `GET …/:id`                       | Supplier bills split across projects                       |
| `POST /api/production/bills/:id/payments` / `…/void`                | Pay a bill / void it                                       |
| `POST /api/production/files`                                        | Upload a packing list or bill scan (photo or PDF, 10 MB)   |
| `GET/POST /api/production/intakes`, `GET/PATCH …/:id`               | Deliveries for Move to Stock, with a cost preview          |
| `POST /api/production/intakes/:id/parse` / `…/confirm` / `…/cancel` | Read with AI / put into stock / drop the draft             |
| `POST /api/production/intakes/:id/reverse`                          | Undo a confirmed delivery: `{ reason, redraft? }`          |
| `GET /api/files/:id`                                                | Open an uploaded file                                      |

Reads need `production.view`, which the Warehouse Team also holds. Projects, stages, cost
heads, Due bills and undoing a delivery need `production.manage`. Money paid out (bill payments, costs paid in
cash or bank) needs `accounts.payments.record`, and writing leftover cost off when a project
is completed or cancelled needs `accounts.manage`; by default only Accounts and Super Admin
hold either. Deliveries need `production.stock_intake`. Cost figures are shown only to
holders of `production.manage` or `accounts.view`, so the warehouse never sees them. Server
Actions are in `src/server/actions/production.actions.ts`.

AI reading needs `AI_API_KEY` (a Claude API key) and `AI_INTAKE_MODEL` (a Claude model that
reads images and PDFs) in `.env`. Without them, deliveries are typed in. Uploads are kept
under `UPLOAD_DIR`; photos sent to the AI reader can be up to 5 MB.

## Accounts (backend)

**Chart of accounts.** Every company starts with a standard chart: Cash in Hand (1000),
Mobile Wallets (1050), Bank (1100), Receivables, Inventory, Work in Progress, Raw Materials &
Accessories (1400), Fixed Assets and Accumulated Depreciation, Payables (2100), Customer
Advances, VAT, loans (from 2300), investors (from 2400), owners' capital (from 3000),
Drawings, Opening Balance Equity, Sales, Other Income, Cost of Goods Sold and the expense
accounts (6000 to 7000). Accounts adds
accounts (the next free code in the range by default), renames them, archives them at a zero
balance, and brings balances forward from before go-live against Opening Balance Equity.
Every account has a ledger for any period with a running balance.

**Journal and transfers.** Journal vouchers record adjustments as balanced debit and credit
lines. A posted entry is never edited or deleted: it is reversed with a reason, and the
reversal is an entry of its own. Money moved between cash, bank and wallets is a transfer.
Sales, production, raw materials, expenses, assets and capital all post to the same journal,
so the day book shows everything.

**Bank accounts.** Each bank account has its own ledger account. Its statement shows the
opening and closing balance, every deposit and withdrawal with a running balance, and a
month-by-month summary with the average daily balance, the figures a bank or loan officer
asks for.

**Fixed assets.** The register holds machines, furniture, vehicles and computers, whether
bought for cash, bought on credit from a supplier, or already owned at go-live.
Depreciation is straight line or reducing balance, monthly, and counts part of the first
month. A run can be previewed first, and running it again only posts what is missing.
Selling or scrapping an asset books the gain or the loss.

**Capital, investors and loans.** Each owner, investor, bank loan and private loan has its
own ledger account, so the balance sheet lists every one. Installment plans are EMI, flat or
interest-only, monthly or quarterly. An installment is paid (split into principal and
interest) or skipped with a reason, and overdue ones are listed. Interest and investor
profit go to Finance Costs; owners' withdrawals go to Drawings.

**Supplier payments.** A payment on account settles the supplier's oldest dues first: the
opening balance, bills, assets bought on credit and Due expenses. Anything left over stays
as an advance and settles the next bill. Bill paid and due figures are always recomputed
from the supplier's ledger, so voiding a payment or a bill keeps them right.

**Expenses (Quick Add).** Expense heads come ready (Office Rent, Electricity, Water & Gas,
Salaries & Wages, Marketing & Ads, Courier & Delivery, Conveyance, Food & Refreshments...).
Conveyance and food name the employee and the purpose. Accounts records an expense as paid
now or owed to a supplier. An expense recorded by anyone else is a claim that stays out of
the books until Accounts pays it back, puts it on the supplier's account, or turns it down.

**Automatic reports.** All of them are worked out from the journal, so they always agree
with the ledgers.

- **Profit and loss** for this month, last month, this or last financial year (July to June
  by default), 1 week, 1 month, 1 year or any dates, optionally month by month: Sales less
  Cost of Goods Sold is gross profit; plus other income, less expenses, is net profit.
- **Balance sheet** on any day, with profit kept in the business split into earlier years
  and this year.
- **Trial balance.**
- **Books check:** the journal balances; every receivable, payable and customer advance line
  names a buyer, a supplier or Walk-in customers (when one doesn't, the check lists the
  entries); and the stock, raw material, work in progress, fixed asset, loan, investor,
  supplier bill, employee advance and unpaid salary registers agree with their ledger
  accounts.
- **Overview:** cash, bank and wallet balances, stock value, raw materials (with low stock
  and late purchase orders), work in progress, fixed assets, loans and investors, today's
  sales, this month's and this year's profit, overdue installments, claims waiting to be
  paid, salary advances owed and payrolls waiting to be approved or paid.

| Event                      | Entry                                                      |
| -------------------------- | ---------------------------------------------------------- |
| Expense paid now           | Dr Expense, Cr Cash / Bank / Wallet                        |
| Expense owed to a supplier | Dr Expense, Cr Payable (supplier)                          |
| Supplier paid on account   | Dr Payable (supplier), Cr Cash / Bank / Wallet             |
| Asset bought               | Dr Fixed Assets, Cr Cash / Bank / Wallet or Payable        |
| Depreciation               | Dr Depreciation, Cr Accumulated Depreciation               |
| Asset sold or scrapped     | Dr Cash + Accumulated Depreciation, Cr Fixed Assets (cost) |
| Capital or loan received   | Dr Cash / Bank / Wallet, Cr Capital / Investor / Loan      |
| Installment paid           | Dr Loan (principal) + Finance Costs, Cr Cash / Bank        |
| Balance brought forward    | The account against Opening Balance Equity                 |

| Endpoint                                                               | Purpose                                                 |
| ---------------------------------------------------------------------- | ------------------------------------------------------- |
| `GET /api/accounts/overview`                                           | Money cards and Accounts' to-do counts                  |
| `GET/POST /api/accounts/chart`, `GET/PATCH …/:id`                      | Chart of accounts with balances                         |
| `GET /api/accounts/chart/:id/ledger`, `PUT …/:id/opening-balance`      | An account's ledger / balance brought forward           |
| `GET /api/accounts/cash-accounts`                                      | Cash, bank and wallet accounts with balances            |
| `GET/POST /api/accounts/journal`, `GET …/:id`, `POST …/:id/reverse`    | Day book, journal vouchers and reversals                |
| `POST /api/accounts/transfers`                                         | Move money between cash, bank and wallets               |
| `GET/POST /api/accounts/bank-accounts`, `GET/PATCH …/:id`              | Bank accounts                                           |
| `GET /api/accounts/bank-accounts/:id/statement?from=&to=`              | Bank statement with monthly average balances            |
| `GET/POST /api/accounts/assets`, `GET/PATCH …/:id`                     | Fixed asset register                                    |
| `POST /api/accounts/assets/:id/dispose` / `…/void`                     | Sell or scrap an asset / remove one entered by mistake  |
| `GET/POST /api/accounts/depreciation`                                  | Preview / post depreciation up to a day                 |
| `GET/POST /api/accounts/capital`, `GET/PATCH …/:id`                    | Owners' capital, investors and loans                    |
| `POST /api/accounts/capital/:id/receipts` / `…/repayments`             | Money in / repayments                                   |
| `POST /api/accounts/capital/:id/schedule` / `…/schedule/preview`       | Installment plan (EMI, flat, interest-only)             |
| `POST /api/accounts/capital/:id/installments`, `…/entries/:id/reverse` | Add one installment / undo an entry                     |
| `GET /api/accounts/installments`, `POST …/:id/pay` / `…/skip`          | Installment payouts, overdue ones first                 |
| `GET/POST /api/accounts/supplier-payments`, `GET …/:id`, `POST …/void` | Supplier payments on account                            |
| `GET /api/accounts/reports/profit-and-loss?period=&from=&to=`          | Automatic profit and loss                               |
| `GET /api/accounts/reports/balance-sheet?asOf=` / `trial-balance`      | Balance sheet / trial balance                           |
| `GET /api/accounts/reports/books-check`                                | Do the ledgers agree with the registers?                |
| `GET/POST /api/expenses`, `GET/PATCH …/:id`                            | Expenses and claims                                     |
| `POST /api/expenses/:id/approve` / `…/reject` / `…/void`               | Pay or post a claim / turn it down / reverse an expense |
| `GET/POST /api/expenses/heads`, `PATCH …/:id`                          | Expense heads                                           |

Reads need `accounts.view` (the overview also opens with `dashboard.financials`). Journal
vouchers, the chart, bank accounts, fixed assets, capital and installments need
`accounts.manage`, and an entry that moves money also needs `accounts.receipts.record` (money
in) or `accounts.payments.record` (money out). Supplier payments, transfers and paying claims
need `accounts.payments.record`. By default only Accounts and Super Admin hold any of these;
Sales, Production, Warehouse and Employees hold none. Anyone with `expenses.create` records
expenses, but unless they can pay money out each one is a claim for Accounts. Holders of
`expenses.manage` see, edit and void any expense, manage expense heads and post Due expenses.
Server Actions are in `src/server/actions/accounts.actions.ts` and `expenses.actions.ts`.

## HR & Payroll (backend)

**Employees.** Each employee gets a code (EMP-0001 onwards) and a profile with contact
details, NID, blood group, emergency contact, joining day, monthly salary and how they are
paid (cash, bank or wallet). A raise or a cut is a salary revision from a day onwards, so
past months keep the salary they were paid at. Leaving is recorded with a day and a reason
(resigned or terminated), and a leaver can be reinstated. An employee with payroll, advance,
attendance, leave or expense records cannot be deleted; record their leaving day instead. HR
gives an employee a portal login: a member already in the company, or a new login with the
Employee role.

**Attendance.** Attendance is marked by exception: a working day nobody marked counts as
present, so HR only marks late, half-day and absent days, and overtime minutes. Employees
can also check in and out from the portal. A check-in after the office start time plus the
grace minutes (09:00 and 15 minutes by default) is late. The HR rules set the weekly days off
(Friday by default) and the holiday list; both are paid days off. A company can also decide
that every few lates cost a day's salary.

**Leave.** Casual (10 days a year), Sick (14), Earned (16), Maternity (112) and Unpaid leave
come ready; a company changes them or adds its own. Leave counts working days only, can be a
half day, and is counted again when holidays or days off change. Paid leave has a yearly
allowance, shared out by the months worked for people who join or leave during the year
(not Maternity). HR can set a different allowance for one person and year. Unpaid leave has
no limit and is deducted in payroll. Employees ask from the portal and HR approves or rejects.
Overlapping requests are refused, and so is full-day leave on a day the person was marked at
work. Nobody approves their own leave or cancels their own approved leave, and nobody
changes their own salary; only a Super Admin can.

**Salary advances.** Accounts pays an advance from cash, bank or a wallet, or brings one
forward from before go-live. Each advance is recovered from salary all at once or in monthly
installments, from a chosen month, oldest first, and never more than the month's pay; when
someone leaves, everything still owed is recovered. Accounts can also take money back in
cash. A conveyance or food expense for an employee is paid from their advance first, and
only the rest in cash (Accounts can choose to pay it all in cash instead). Voiding the
expense puts the advance back.

**Monthly payroll.** A draft covers everyone employed in the month. Each person earns their
salary for the days they were employed (1/days-in-month a day, at the salary in force that
day), so joiners and leavers are paid for their days. Unpaid leave and absent days are
deducted, overtime is hours x the employee's hourly rate, and advances are recovered.
Payroll adds allowances, a bonus (an amount, or a percentage of salary for everyone, such as
an Eid bonus), tax (TDS) and other deductions, and can change overtime hours or the advance
recovery. Recalculating picks up later attendance, leave, salary and advance changes and
keeps those edits. Someone holding the approval permission (Super Admin by default) then
approves it; a draft that is out of date is refused, so what was checked is what gets posted. Approval posts one entry dated the month's last day
and freezes the month's attendance, leave, holidays and salaries. Accounts then pays
everyone, or chosen people in batches, from cash, bank or a wallet. A payment can be voided.
A payroll can be reopened (its entry reversed and the advances owed again) only while none
of it is paid. Every employee gets a payslip on the company letterhead, with the net pay in
words, and sees their own payslips in the portal.

**Employee portal.** With `portal.self`, an employee sees their own profile and pay details,
leave balances, this month's attendance, advances and payslips, checks in and out, and asks
for or cancels leave. Nothing else in HR is open to them.

| Event                        | Entry                                                                    |
| ---------------------------- | ------------------------------------------------------------------------ |
| Advance given                | Dr Advances to Employees (1250), Cr Cash / Bank / Wallet                 |
| Advance brought forward      | Dr Advances to Employees, Cr Opening Balance Equity                      |
| Advance returned in cash     | Dr Cash / Bank / Wallet, Cr Advances to Employees                        |
| Expense paid from an advance | Dr Expense, Cr Advances to Employees (and Cr Cash for any rest)          |
| Payroll approved, per person | Dr Salaries & Wages (6200) gross pay, Cr Salaries Payable (2250) net pay |
| ...and the deductions        | Cr Advances to Employees, Tax Deducted (2260), Other Income (4200)       |
| Salaries paid                | Dr Salaries Payable (employee), Cr Cash / Bank / Wallet                  |

| Endpoint                                                                          | Purpose                                                  |
| --------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `GET/PATCH /api/hr/settings`                                                      | Weekly days off, office start time, late rules, check-in |
| `GET/POST /api/hr/holidays`, `DELETE …/:id`                                       | Holiday list (one or many at once)                       |
| `GET/POST /api/hr/leave-types`, `PATCH …/:id`                                     | Leave types and yearly days                              |
| `GET/POST /api/hr/employees`, `GET/PATCH/DELETE …/:id`                            | Employees and the 360° profile                           |
| `GET /api/hr/employees/directory`                                                 | Names and codes for pickers (no pay details)             |
| `POST /api/hr/employees/:id/salary`, `DELETE …/salary/:revisionId`                | Salary revisions                                         |
| `POST /api/hr/employees/:id/exit` / `…/reinstate`                                 | Leaving / coming back                                    |
| `POST/DELETE /api/hr/employees/:id/portal-access`                                 | Give or take away a portal login                         |
| `GET /api/hr/employees/:id/statement` / `…/attendance?month=`                     | Advances, salaries and payments / the month day by day   |
| `GET/POST /api/hr/attendance?date=`, `DELETE …/:id`, `GET …/summary`              | Day register and marking / monthly day counts            |
| `GET/POST /api/hr/leave`, `GET …/:id`, `POST …/:id/approve` / `reject` / `cancel` | Leave requests                                           |
| `GET/PUT /api/hr/leave/balances`                                                  | Leave balances / set one person's allowance for a year   |
| `GET/POST /api/hr/advances`, `GET/PATCH …/:id`                                    | Salary advances and their recovery plan                  |
| `POST /api/hr/advances/:id/return` / `…/void`, `…/returns/:id/void`               | Money given back / undo an advance or a return           |
| `GET/POST /api/hr/payroll`, `GET/DELETE …/:id`                                    | Monthly payroll runs                                     |
| `POST /api/hr/payroll/:id/recalculate` / `…/bonus`, `PATCH …/items/:id`           | Prepare the draft                                        |
| `POST /api/hr/payroll/:id/approve` / `…/reopen`                                   | Post to the books / undo                                 |
| `POST /api/hr/payroll/:id/pay`, `POST /api/hr/payroll/payments/:id/void`          | Pay salaries / void a payment                            |
| `GET /api/hr/payroll/:id/items/:id/payslip`                                       | Payslip                                                  |
| `GET /api/portal/me`, `…/attendance`, `…/payslips`, `…/advances`                  | Employee portal: my records                              |
| `POST /api/portal/attendance/check-in` / `check-out`                              | Employee portal: check in and out                        |
| `GET/POST /api/portal/leave`, `POST …/:id/cancel`                                 | Employee portal: my leave                                |

`hr.view` sees profiles, attendance, leave and holidays, but no salaries. `hr.manage` adds
and edits employees and salaries, marks attendance, approves leave and sets the HR rules.
`hr.payroll` prepares payroll and sees salaries, payslips and advances; `hr.payroll.approve`
approves or reopens it. Salaries, bank details, advances and payslips are shown only to
holders of `hr.manage`, `hr.payroll` or `accounts.view`. Paying advances and salaries needs
`accounts.payments.record`, and taking money back needs `accounts.receipts.record`, so by
default only Accounts and Super Admin move money. By default Accounts holds `hr.view` and
`hr.payroll`, Super Admin holds everything (so a Super Admin approves what Accounts
prepares), and every role holds `portal.self`. A company can make an "HR Manager" role with
`hr.view` and `hr.manage`. The books check also compares the advances and unpaid salaries
with their ledger accounts, employee by employee, and the Accounts overview shows advances
owed, salaries payable and payrolls waiting for approval or payment. Server Actions are in
`src/server/actions/hr.actions.ts` and `portal.actions.ts`.

## Raw materials & purchasing (backend)

**Materials and stores.** Fabric, trims, accessories, packaging and other materials each get
a code per kind (FAB-0001, TRM-0001, ACC-0001, PKG-0001, RM-0001) or the company's own code,
a unit (pcs, m, yd, kg, g, rolls, dozen, gross, cones or sets; pieces, rolls, cones and sets
are counted whole) and, optionally, a color, a specification (e.g. 180 GSM single jersey),
the usual supplier and a reorder level. A material is low on stock at or below its reorder
level. Stock is kept per store (the same warehouses as finished goods) and valued for the
whole company at moving average cost, to the paisa: the last unit out takes whatever value
is left. A material's unit cannot change once it has been ordered, bought or moved. It is
archived only when none is left and nothing is still on order, and no stock comes into it
until it is made active again.

**Purchase orders.** A purchase order (PO-) books fabric or trims with a supplier, for a
production project if wanted, with the day the goods are expected. Nothing reaches the books
until the goods arrive. Bills received against the order count towards its lines, so it
shows as Open, Partially Received or Received; a delivery a little over the order is
accepted. Lines can be changed until something arrives. An order nothing has arrived on can
be cancelled, and a partly received one closed, each with a reason. An order is late once
its expected day has passed with goods still to come, and the summary lists late deliveries
with the days late.

**Buying.** The supplier's bill is the goods received note: its lines come into the chosen
store at the bill price and are owed to the supplier (Due), or paid in full straight away
from cash, bank or a wallet. Production Managers record Due bills; only Accounts records a
bill paid now or pays a Due one, and payments settle the supplier's oldest dues first, as in
Accounts. Voiding a bill takes its goods back out of the store, and anything already paid
stays with the supplier as an advance. A bill with goods sent back to the supplier is voided
only after those returns are voided.

**Returns to suppliers.** A debit note (DN-) sends goods from one of the supplier's bills
back at the bill price, never more than is left on the bill line. The amount comes off what
is owed to the supplier, oldest due first, or stays with them as an advance. If the stock's
average cost has moved away from the bill price since the goods arrived, the difference goes
to Production & Inventory Losses, so the stock value always matches the ledger.

**The store.** A stock count sets a store's quantity to what was counted: a shortfall is
written off at average cost, and a surplus comes in at average cost. Wastage is written off
with a reason. Stock moves between stores without changing its value. Opening stock from
before go-live is entered per material and store at its cost. Every change appears on the
material's stock card with a running quantity and value, for any dates and any store.

**Issues to production.** An issue note (MI-) hands materials from a store to an open
production project at average cost, and that cost joins the project's work in progress. A
return note (MR-) brings unused materials back at what the project was charged for them,
never more than the project holds. Notes are not voided: a mistaken issue is corrected with
a return. The project's cost sheet lists the materials it used and their net cost next to
its bills and costs, and Move to Stock carries that cost into the finished goods.

| Event                     | Entry                                                            |
| ------------------------- | ---------------------------------------------------------------- |
| Opening stock             | Dr Raw Materials & Accessories (1400), Cr Opening Balance Equity |
| Bill received             | Dr Raw Materials, Cr Payable (supplier)                          |
| Bill paid                 | Dr Payable (supplier), Cr Cash / Bank / Wallet                   |
| Goods sent back           | Dr Payable (supplier), Cr Raw Materials (± the cost difference)  |
| Bill voided               | Its entry reversed (± the cost difference)                       |
| Issued to production      | Dr Work in Progress (project), Cr Raw Materials                  |
| Returned from production  | Dr Raw Materials, Cr Work in Progress (project)                  |
| Count shortfall / wastage | Dr Production & Inventory Losses (5100), Cr Raw Materials        |
| Count surplus             | Dr Raw Materials, Cr Production & Inventory Losses               |
| Moved between stores      | No entry: quantities only                                        |

| Endpoint                                                                            | Purpose                                                      |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `GET /api/materials/summary`                                                        | Stock value by kind, low stock, stores, open and late orders |
| `GET/POST /api/materials`, `GET/PATCH …/:id`                                        | Materials with stock per store and quantity on order         |
| `GET /api/materials/:id/stock-card?from=&to=&warehouseId=`                          | Stock card with running quantity and value                   |
| `GET /api/materials/movements`                                                      | Every stock movement (material, store, project, type, dates) |
| `POST /api/materials/:id/opening-stock`                                             | Stock from before go-live                                    |
| `POST /api/materials/:id/count` / `…/wastage` / `…/transfer`                        | Stock count / write off / move between stores                |
| `GET/POST /api/materials/purchase-orders`, `GET/PATCH …/:id`                        | Purchase orders (status, supplier, project, late)            |
| `POST /api/materials/purchase-orders/:id/cancel` / `…/close`                        | Cancel an order / close it with what has arrived             |
| `GET/POST /api/materials/purchases`, `GET …/:id`                                    | Material bills (goods received)                              |
| `POST /api/materials/purchases/:id/payments` / `…/void`                             | Pay a bill (Accounts) / void it                              |
| `GET/POST /api/materials/supplier-returns`, `GET …/:id`, `POST …/:id/void`          | Returns to suppliers (debit notes)                           |
| `GET/POST /api/materials/issues`, `GET …/:id`, `POST /api/materials/issues/returns` | Issue notes to production / return notes from it             |
| `GET /api/production/projects/:id/materials`                                        | A project's materials: issued, returned, cost, orders        |

Reads need `materials.view`. Adding and editing materials needs `materials.manage` or
`materials.purchase`. Counts, wastage, transfers and issues to and from production need
`materials.manage`; purchase orders, Due bills, returns to suppliers and opening stock need
`materials.purchase`. A bill paid now and paying a bill need `accounts.payments.record`, and
Accounts (`accounts.manage`) can also void bills, send goods back and enter opening stock. By
default Production Managers hold all three `materials.*` permissions, the Warehouse Team
views and keeps the store but does not buy, and Accounts views; only Accounts and Super Admin
move money. Bills and returns, and prices and values everywhere, are shown only to holders of
`materials.purchase`, `production.manage`, `accounts.view`, `accounts.manage` or
`accounts.payments.record`, so the store team sees quantities. The books check compares the Raw Materials ledger with the
stock value, material by material and against each stock card, and the Work in Progress
ledger with the projects; the Accounts overview shows raw material stock, low stock, open and
late purchase orders and work in progress. Server Actions are in
`src/server/actions/materials.actions.ts`.

Everything that adds, pays, voids or returns goods on a supplier's bills (here and in
Production) first locks that supplier's account (`lockSupplierAccount`), so two people working
on one supplier at once queue up instead of blocking each other. Raw material changes also
run again automatically if the database ever cancels one to break such a conflict
(`runTransaction` in `src/lib/transaction.ts`).

## Dashboard & reports (backend)

**Metric cards.** The owner's five cards come from the books, so they always agree with the
Accounts overview and the statements. Each card also carries the figures behind it.

| Card                            | Figure                                                        | Behind it                                         |
| ------------------------------- | ------------------------------------------------------------- | ------------------------------------------------- |
| Total active stock value        | Finished goods on hand (A and B grade), each at its own cost  | Pieces and value per grade; raw materials and WIP |
| Fixed assets                    | Book value (cost less depreciation)                           | Cost, depreciation so far, assets in use          |
| Liabilities (loans / investors) | What is owed to lenders and investors                         | Loans and investors apart                         |
| Today's sales                   | The Sales account today (after discounts, no delivery or VAT) | Invoices, pieces, yesterday and the change        |
| Net profit (this month)         | Profit from the books since the 1st                           | Last month, this financial year                   |

Each person can hide cards (the eye icon). The choice is saved per person, and hidden cards
still come with their figures, marked `hidden`, so the screen can show dots.

**Insights.** Top sellers for a period (the past month by default), per SKU or per style, by
pieces or by sales value; the SKUs holding the most stock; dead and slow stock; low stock.

- Sales count on the invoice day in the company's time zone. Void invoices and cancelled
  orders never count. Amounts are after line and order discounts, without delivery charges or
  VAT. An order discount is shared across the order's lines by value, to the paisa, so the
  products always add up to the order and to the books.
- Low stock: sellable pieces (A grade less those reserved for orders) below the company's
  threshold (5 by default), for SKUs that have been stocked before. Out-of-stock SKUs come
  first, then the ones that sold most in the last 30 days.
- Dead stock: held 90 days ago and nothing sold since. Slow stock: it sells, but at the pace of
  those 90 days the pieces available would last more than 180 days. Both windows can be
  changed per request (14 to 365 days, and 30 to 730 days). Stock that arrived within the
  window is not judged yet.
- The Inventory stock summary (`/api/inventory/stock/summary`) uses the same rules.

Quantities are for anyone who sees the dashboard or inventory. Sales values need `sales.view`
or the financials (`dashboard.financials` or `accounts.view`); costs, stock values and
margins need the financials. Amounts a person may not see come back as `null`.

**Report Builder.** A report for any period (today, this or last month, this or last
financial year, the past week, month or year, or chosen days up to 10 years) with the metrics
picked, as a PDF or an Excel file:

| Metric          | What it shows                                                                  | Needs                                              |
| --------------- | ------------------------------------------------------------------------------ | -------------------------------------------------- |
| Key figures     | Sales, profit and margins for the period; stock, assets and loans at its end   | `dashboard.financials` or `accounts.view`          |
| Sales           | Sales by day (by month beyond 62 days) and by channel                          | `sales.view` or the financials                     |
| Profit and loss | Sales, cost of goods sold, expenses and net profit, from the books             | `dashboard.financials` or `accounts.view`          |
| Top sellers     | Best SKUs and styles, with sales values, margins and stock left when permitted | `dashboard.view`, `inventory.view` or `sales.view` |
| Stock alerts    | Low, dead and slow stock and the highest stock, on the day the report is made  | `dashboard.view` or `inventory.view`               |

The PDF is A4 with the company's details, the period, who made it and page numbers on every
page; long tables carry their header onto the next page. English and Bengali text both print
(see [Bengali in PDFs](#bengali-in-pdfs)); other scripts show as "?" in the PDF, and the Excel
file keeps them. The Excel file has an overview sheet and one sheet
per table with real numbers and dates (so they add up and sort), a header row that stays in
view and filter buttons.

Making a report needs `reports.export` (Super Admin, Accounts and Production Managers by
default) plus each metric's own permission. Files are made straight away and kept under
`UPLOAD_DIR/<company>/reports/`, so they are part of the media backup. A saved report opens
only for people who may see everything in it, including the money columns its maker could
see, and is deleted by the person who made it or a Super Admin. Making and downloading reports
are recorded in the audit log, and a person can make up to 10 reports a minute.

| Endpoint                                                                                     | Purpose                                            |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `GET /api/dashboard/cards`                                                                   | The owner's metric cards                           |
| `GET /api/dashboard/insights?period=&from=&to=&limit=&groupBy=&sortBy=&slowDays=&coverDays=` | Top sellers, highest, dead / slow and low stock    |
| `GET/PATCH /api/dashboard/preferences`                                                       | Hidden cards: `{ metric, hidden }` or the list     |
| `GET /api/reports/builder`                                                                   | Metrics this person may pick, periods, defaults    |
| `GET /api/reports/preview?period=&from=&to=&metrics=SALES,TOP_SELLERS&…`                     | The report as data, without a file                 |
| `GET/POST /api/reports/exports`, `GET/DELETE …/:id`                                          | Saved reports / make one: `{ format: PDF\|EXCEL }` |
| `GET /api/reports/exports/:id/download`                                                      | The PDF or Excel file                              |

Server Actions are in `src/server/actions/dashboard.actions.ts` and
`src/server/actions/reports.actions.ts`. Marketing Sync (ad spend against sales, ROAS) comes
later with the other outside integrations.

## Printable documents (backend)

Quotations, proforma and commercial invoices, packing lists, delivery challans, money receipts,
refund vouchers, buyer and supplier statements, stock availability sheets and a blank letterhead pad print as A4
PDFs on the company letterhead: the logo, name, legal name and contact details on top, the
company colours, and the footer line with page numbers on every page. Everything on the page
comes from the same data as the screens, with amounts in lakh and crore for taka and dates in
the company's time zone.

**BIN and trade licence.** Under the contact details, every document prints the company's VAT
registration (`BIN: …`) and trade licence number (`Trade licence: …`), taken from the
[licence records](#licences-and-registrations-backend) in force. Nothing is added while neither
is on file. Renewing a licence under a new number prints the new one from then on; a renewal
that keeps the number changes nothing, so kept PDFs are reused. The print data behind the
screens (`letterhead` in the quotation, proforma, order, invoice, packing list, challan,
receipt, payslip and bank statement endpoints) carries them as `bin` and `tradeLicense`.

| Document             | What it shows                                                                                                               | Needs                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Quotation            | Items with style, fabric and sizes, discount, VAT, the total in words, styling instructions, custom fields and terms        | `sales.view`           |
| Proforma invoice     | The quotation's items and total, the advance with what is received and due, and payments; CANCELLED across a cancelled one  | `sales.view`           |
| Commercial invoice   | Each SKU with pieces and price (a discount column only when used), delivery charge, VAT, paid and due; PAID or VOID marks   | `sales.view`           |
| Packing list         | SKU, item, colour, size and pieces by carton (each carton totalled), a tick box per line, cartons, gross weight; no prices  | `sales.view`           |
| Delivery challan     | SKU, item, colour, size and pieces with the total, vehicle and driver, received by; no prices                               | `sales.view`           |
| Money receipt        | Who paid, the amount in figures and words, method and cheque / transaction no., what it was for, and the balance after it   | `sales.view`           |
| Refund voucher       | Money taken back off a proforma, order or account: paid back, credit note or cancellation charge, with what it left held    | `sales.view`           |
| Statement of account | Opening balance, debits, credits and closing balance (Dr / Cr), then every transaction with the running balance, any period | `parties.ledger.view`  |
| Stock availability   | Pieces ready to ship per colour and size for chosen styles or a whole brand, in one warehouse or all; no prices             | `inventory.view`       |
| Blank letterhead     | The letterhead and footer on an empty page, for letters                                                                     | `documents.letterhead` |

`documents.letterhead` is new: Sales Executives, Accounts and Production Managers have it by
default (Super Admin has every permission). The stock sheet counts first-quality pieces less
those set aside for orders, never below zero. A brand sheet leaves out styles with nothing to
sell unless `includeEmpty` is set, and shows up to 100 styles.

**Packing list.** The pick-list for the warehouse: lines packed in cartons are sorted by carton
number (2 before 10), with each carton's pieces and loose pieces last; without carton numbers
the lines are numbered. A line already picked in the system has a ticked box, the rest an
empty box to tick by hand, and the details show how many pieces are picked.

**Money receipt.** Printed for any payment received from a buyer (`id` is the payment's id;
money paid to suppliers is not a receipt). It says what the money was for: an advance against
a proforma or an order, a payment against the invoice, or on account. The figures show where
the proforma (total, advance, received, advance due) or the order (total, received, balance
due) stood once this payment came in, counting earlier payments only, so a receipt printed
again later shows the same figures and reuses its kept copy. A cheque receipt notes that it
holds once the cheque is cleared. Refunds made before a payment are taken off what it shows
as received so far ("less 2,500.00 refunded").

**Refund voucher.** Printed for any refund (`type: "REFUND_VOUCHER"`, `id` is the refund's id).
Money paid back is a Refund Voucher the buyer signs for, with the method and transaction no.;
money kept on the buyer's account is a Credit Note; money kept by the company is a
Cancellation Charge. Each shows the amount in figures and words, the reason, and what the
proforma or order held before and after it, by date, so printing it again later shows the same
figures. A voided refund prints with a VOID mark and why. Proformas and invoices list the
refunds under their payments and show the paid amount net of them.

**Kept copies.** Every PDF is kept under `UPLOAD_DIR/<company>/documents/` (so it is part of the
media backup) and listed with who made it and what for. Printing something that has not
changed returns the kept copy (`reused: true`) instead of making a new file. When anything on
it changed (a payment, a price, the logo), a new PDF is made and the earlier one stays as a
record of what was sent. A kept file that went missing is made again. Making and downloading
PDFs are recorded in the audit log, and a person can print up to 30 documents a minute.

**Logo.** Upload a PNG or JPG of up to 2 MB and 3000 pixels a side (needs `company.settings`).
It is checked thoroughly before it is kept, and every print makes sure the file is still the
one that was checked, so a damaged image can never break a PDF. Replacing or removing it deletes the old file; PDFs made
earlier keep the logo they had.

### Bengali in PDFs

Bengali text (names, addresses, notes, amounts in words) prints in every PDF, the reports and
the documents alike, mixed freely with English on the same line. English text uses the
built-in Helvetica and Times fonts; Bengali uses Noto Sans Bengali (regular and bold, SIL Open
Font License, in `assets/fonts/`). Bengali letters join into conjuncts and vowel signs, so each
Bengali run is shaped by HarfBuzz, the same engine browsers use, and set on the English text's
baseline. Copying text out of the PDF gives the words as typed. The font is only embedded in a
PDF that has Bengali in it, and only the letters used. Other scripts (Chinese, emoji...) still
show as "?".

The helpers are in `src/lib/pdf.ts`: make documents with `createPdf()` and draw text with
`drawText()`, `fitText()` and `wrapText()`. The production build copies the font files into
the server bundle (`outputFileTracingIncludes` in `next.config.js`).

| Endpoint                                                       | Purpose                                                                |
| -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `POST /api/documents`                                          | Print a document (see below); returns it with `reused`                 |
| `GET /api/documents?type=&referenceId=&partyId=&cursor=&take=` | Printed documents this person may see, newest first                    |
| `GET /api/documents/:id`                                       | One printed document                                                   |
| `GET /api/documents/:id/download?inline=1`                     | The file (`inline=1` opens a PDF in the browser to print)              |
| `GET/POST/DELETE /api/company/logo`                            | The letterhead logo: see it, upload it (multipart `file`) or remove it |

What to print:

- `{ type: "QUOTATION" | "PROFORMA_INVOICE" | "COMMERCIAL_INVOICE" | "PACKING_LIST" | "DELIVERY_CHALLAN", id }`
- `{ type: "PAYMENT_RECEIPT", id }` (the payment's id)
- `{ type: "LEDGER_STATEMENT", partyId, from?, to? }` (calendar days; none = the whole account)
- `{ type: "STOCK_AVAILABILITY", styleIds?, brandId?, warehouseId?, includeEmpty? }`
- `{ type: "LETTERHEAD" }`

Server Actions are in `src/server/actions/documents.actions.ts`, with `uploadCompanyLogoAction`
and `removeCompanyLogoAction` in `src/server/actions/company.actions.ts`.

## Document templates (backend)

Besides the built-in PDFs, a company can upload its own designs for quotations, proforma
invoices, commercial invoices, delivery challans and letters, and the system fills in the data.
A template has tags in curly brackets where the data goes: `{BuyerName}`, `{InvoiceNo}`,
`{TotalAmount}`, `{ItemQuantity}`... (`{{BuyerName}}` and `{ BuyerName }` work too).

| Kind                                            | How the values go in                                                                                                                           | What comes out                         |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Word (.docx)                                    | Tags anywhere in the text, tables, headers and footers, even when Word split a tag into pieces; each value keeps the tag's bold, size, colour  | A Word file                            |
| HTML page                                       | Tags in the text or in attribute values; values are escaped, so data can never change the page                                                 | An HTML file to open and print         |
| PDF (a form from the printer, up to 20 pages)   | Each tag is placed on a page: its top-left corner in points (72 = 1 inch), text size, bold, alignment and a box width that long text is cut to | The same PDF with the values on it     |
| Image (a JPG or PNG scan, up to 5000 px a side) | Placed like a PDF's tags, on one page                                                                                                          | A PDF: the image as an A4 page, filled |

**Tags.** `GET /api/templates/catalog?documentType=` lists every tag a document can fill and
what it prints: the company (with the BIN, TIN, trade licence, IRC and ERC numbers from its
[licence records](#licences-and-registrations-backend)), the buyer, numbers and dates, amounts
with the total in words, the challan's vehicle and driver, and the document's lines. Word and
HTML tags are found when the file is uploaded. A tag with a known name means its data straight
away; any other (`{Customer}`) can be mapped to any data, in upper or lower case if wanted, and a
tag left unmapped prints nothing. In a table row, line tags (`{ItemDescription}`,
`{ItemQuantity}`, `{ItemAmount}`...) repeat the row once per line of the document; anywhere else
they list every line. English and Bengali both print, in PDF and image templates too.

**Filling.** `POST /api/templates/:id/fill` with the quotation, proforma, invoice or challan
(for a letter, optionally the buyer or supplier it is addressed to). The result is kept with
the printed documents and downloads from `/api/documents/:id/download`; filling again when
nothing changed returns the kept copy (`reused: true`). Each document type can have one default
template. Replacing a template's file keeps the mapping of the tags still in it, and deleting a
template keeps the documents already filled from it.

**Safety.** Files are checked before they are kept: damaged files, Word files with macros and
very large Word files are refused; HTML templates with scripts, frames, forms, event handlers
(`onclick`...) or `javascript:` links are refused; password-protected and rotated PDFs are
refused with what to do instead. Files can be up to 10 MB. Word and HTML files (templates and
filled copies) always download and never open inside the app, so they can never run as one of
its pages. Only photos and PDFs open in the browser (this now applies to every stored file).

Uploading, mapping, editing and deleting templates, and downloading their files, need
`templates.manage` (Super Admin by default). Everyone else sees the active templates of the
documents they may print, and filling one needs the same permission as printing that
document.

| Endpoint                                    | Purpose                                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| `GET /api/templates?documentType=&active=1` | Templates, defaults first                                                               |
| `POST /api/templates`                       | Upload one (multipart `file`, `name`, `documentType`, `isDefault`), or JSON with `html` |
| `GET/PATCH/DELETE /api/templates/:id`       | The template with its tags / rename, default, active, HTML text / delete                |
| `PUT /api/templates/:id/placeholders`       | Map tags to data; for PDF and image templates, place them on the page                   |
| `GET/POST /api/templates/:id/file`          | Download the uploaded file / upload a new version                                       |
| `GET /api/templates/catalog?documentType=`  | The tags a document can fill and what each prints                                       |
| `POST /api/templates/:id/fill`              | Fill it: `{ id, partyId? }`; returns the kept document with `reused`                    |

## Notepad, tasks and reminders (backend)

**Notepad & planner.** Each person has a private notepad with three tabs. Nobody else, not even
a Super Admin, can read it. Needs `notepad.use` (everyone by default).

- Daily routine: a checklist for every day. Ticking an item marks it done for today only, so the
  list starts fresh each morning.
- Next 3 days: the plan for today, tomorrow and the day after. Items not done by their day come
  back as overdue.
- General notes: free notes, pinned ones first, with search.

**Tasks.** Management gives staff a piece of work ("Nazrul: factory visit on Tuesday 10:00")
with a due day or time, a priority (low to urgent) and, if it belongs to one, a production
project. The employee hears about it in the app through the login linked to their employee
profile, sees it in the employee portal and marks it started or done there; whoever gave it
hears when it is done. Creating, editing, cancelling and seeing every task need
`reminders.manage` (Super Admin, Production Managers and Sales Executives by default).

**Reminders set by hand.** "Call Rahim Traders about the advance on Monday 10:00", "file the VAT
return on the 15th of every month": a time (or a day and time in company time), optionally
repeating every so many days, weeks, months or years until a chosen day, and optionally linked
to a project, order, purchase order, licence or task. Anyone can set reminders for themselves;
reminding other people needs `reminders.manage`. Whoever gets a reminder can mark it as dealt
with.

**Automatic reminders.** The system watches these dates and tells the people who can act on
them. These are the defaults; each company can change the days, the time (09:00 company time),
the overdue repeat and who hears, per kind of date.

| Date                                                                       | Before the date                                                 | Overdue      | Who hears                                   |
| -------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------ | ------------------------------------------- |
| Production deadline: a planned or active project's target date             | 7, 3 and 1 days before, and on the day                          | Every 3 days | People who manage production                |
| Goods in-house: a purchase order's expected date, until everything arrived | 3 and 1 days before, and on the day                             | Every 2 days | People who buy materials, and who raised it |
| Shipment: a sales order's shipment date, until it is delivered             | 7, 3 and 1 days before, and on the day                          | Every day    | People who take orders                      |
| Licence renewal: the expiry date                                           | From the licence's own alert days, then 15, 7, 1 and on the day | Every 7 days | People who see or manage licences           |
| Task due                                                                   | 1 day before, and on the day                                    | Every day    | The employee and whoever gave the task      |

Each reminder goes out once, even when two servers run. A moved date starts its reminders
afresh, a project on hold or a cancelled order stops them, and renewing a licence or finishing
a task marks the alerts already sent as dealt with.

**Inbox and planner.** Every reminder lands in the person's in-app inbox (with an unread count
for the bell). `GET /api/reminders/upcoming?days=7` is the planner's agenda: the deadlines,
goods due, shipments and renewals the person's role can see, their tasks and their reminders,
day by day, plus everything overdue. Only in-app messages go out for now; WhatsApp and email
come with the other outside integrations at the end. Staff without a login are kept as
recipients for those.

**Server setup.** The reminder clock checks every minute. It runs in production and not in
development; set `REMINDER_SCHEDULER=on` or `off` to choose.

| Endpoint                                                  | Purpose                                                                          |
| --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `GET/POST /api/notepad?tab=`, `PATCH/DELETE …/:id`        | Your notes, one tab at a time / write, edit, move or delete one                  |
| `POST /api/notepad/:id/done`, `POST /api/notepad/reorder` | Tick a routine or plan item / put a tab in order                                 |
| `GET/POST /api/tasks`, `GET/PATCH/DELETE …/:id`           | Every task (soonest due first) / give one, edit or remove it                     |
| `POST /api/tasks/:id/status`                              | To do, in progress, done or cancelled                                            |
| `GET /api/portal/tasks`, `POST …/:id/status`              | The tasks given to you / start, finish or reopen one                             |
| `GET/POST /api/reminders`, `GET/PATCH/DELETE …/:id`       | Reminders you set or are on (`all=1` for everyone's) / set, change, remove       |
| `POST /api/reminders/:id/cancel` / `…/acknowledge`        | Stop one before it goes out / mark it as dealt with                              |
| `GET /api/reminders/upcoming?days=`                       | The planner's agenda, with everything overdue                                    |
| `GET /api/reminders/rules`, `PATCH …/:type`               | Automatic reminder settings per kind of date (changing needs `company.settings`) |
| `GET /api/notifications?unread=1`, `GET …/unread-count`   | Your in-app inbox / the bell's count                                             |
| `POST /api/notifications/:id/read`, `POST …/read-all`     | Mark one or all as read                                                          |

## Licences and registrations (backend)

The company's trade licence, VAT registration (BIN), TIN, IRC, ERC, BGMEA / BKMEA membership,
fire licence, environment clearance and any other, each with its number, issuing authority,
issue and expiry dates, notes and a scan (JPG, PNG, WebP or PDF up to 10 MB).

Each record is valid, expiring (inside its renewal window: 30 days before expiry unless set
otherwise for that record), expired, or has no expiry (a TIN or BIN). The summary counts them,
lists what needs renewing (soonest first), shows which of the trade licence, BIN and TIN are not
on file, and gives the numbers in force. Every built-in document prints the BIN and trade
licence number under the letterhead's contact details, and custom templates print any of them
(`{CompanyBIN}`, `{CompanyTIN}`, `{CompanyTradeLicense}`, `{CompanyIRC}`, `{CompanyERC}`).

**Renewing** adds the next term (the new expiry, and the number or authority if they changed);
the old term stays as history and its alerts stop. Deleting a renewal entered by mistake puts
the term before it back in force. Archiving takes a record off the list and stops its alerts;
restoring brings it back. Renewal alerts follow the rules in
[automatic reminders](#notepad-tasks-and-reminders-backend), and every change is in the audit log.

`compliance.view` (Super Admin and Accounts by default) sees the records and scans and gets the
renewal alerts; `compliance.manage` (Super Admin) adds, corrects, renews, archives and deletes
them.

| Endpoint                                              | Purpose                                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `GET /api/compliance?type=&status=&history=1&search=` | Records in force (with `history=1` also renewed and archived ones), soonest expiry first   |
| `POST /api/compliance`                                | Add one: `{ type, number?, issuingAuthority?, issueDate?, expiryDate?, alertDaysBefore? }` |
| `GET /api/compliance/summary`                         | Counts, what needs renewing, what is missing and the numbers in force                      |
| `GET/PATCH/DELETE /api/compliance/:id`                | The record with its earlier terms / correct it / delete it                                 |
| `POST /api/compliance/:id/renew`                      | The next term                                                                              |
| `POST /api/compliance/:id/archive` / `…/restore`      | Take it off the list / put it back                                                         |
| `GET/POST/DELETE /api/compliance/:id/scan`            | See the scan (`?download=1` saves it) / upload one (multipart `file`) / remove             |

Server Actions are in `src/server/actions/templates.actions.ts`,
`src/server/actions/notepad.actions.ts`, `src/server/actions/reminders.actions.ts`,
`src/server/actions/compliance.actions.ts` and, for the employee's own tasks,
`src/server/actions/portal.actions.ts`.

## Backups (backend)

Every day at 02:00 (Asia/Dhaka) the server backs up the whole platform, every company, into
`BACKUP_DIR/<date_time>/`:

| File            | What it holds                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `database.dump` | The database (`pg_dump`, custom format)                                                                                        |
| `media.tar.gz`  | Stored files: logos, packing lists, bill and licence scans, templates, saved reports and printed documents (can be turned off) |
| `manifest.json` | Sizes and SHA-256 checksums of the files, and how to restore                                                                   |

Each backup is also copied to a folder in the owner's Google Drive once it is connected.
Backups older than the retention period (30 days by default) are deleted on the server and
on Drive, but the newest good one always stays. Only one backup runs at a time. A backup
missed while the server was off runs as soon as it is back. If the Drive copy fails, the
backup is still kept on the server and the run says why.

A backup holds every company, so backups are for the platform owner (the Super Admin of the
platform) only. Every download is recorded in the audit log.

| Endpoint                                                            | Purpose                                             |
| ------------------------------------------------------------------- | --------------------------------------------------- |
| `GET/PATCH /api/backups/settings`                                   | Schedule, retention, media, on/off, pg_dump check   |
| `GET/POST /api/backups/runs`, `GET …/:id`                           | Backup history / back up now (202, poll for result) |
| `GET /api/backups/runs/:id/download?file=database\|media\|manifest` | Download a file to a PC                             |
| `GET /api/backups/google/connect`, `POST …/disconnect`              | Connect or disconnect Google Drive                  |
| `GET /api/backups/google/callback`                                  | Where Google sends the owner back                   |

**Server setup.**

- The app's Docker image carries the PostgreSQL 16 client tools, and the server keeps
  `BACKUP_DIR` in `/srv/extras-erp/backups` ([`deploy/README.md`](./deploy/README.md)).
  Elsewhere, install them for `pg_dump` (`apt install postgresql-client-16`) or set
  `PG_DUMP_PATH`, and keep `BACKUP_DIR` on a persistent disk. The backup settings show
  whether `pg_dump` was found.
- The schedule runs in production and not in development; set
  `BACKUP_SCHEDULER=on` or `off` to choose.
- Google Drive: in Google Cloud console, enable the Google Drive API and create an OAuth
  client of type "Web application" with the authorised redirect URI
  `<APP_URL>/api/backups/google/callback`. Put its ID and secret in
  `GOOGLE_DRIVE_CLIENT_ID` and `GOOGLE_DRIVE_CLIENT_SECRET`, and set `ENCRYPTION_KEY`
  (`openssl rand -base64 32`), which seals the stored Google connection. The owner then
  connects their Google account once. The app only sees the files it creates (the
  `drive.file` scope), and backups use that account's storage. Changing `ENCRYPTION_KEY`
  means connecting Google Drive again.

**Restoring.** On the server, `sudo ./deploy/restore.sh <backup folder>` checks the files,
saves a safety copy and restores the database and the files
([`deploy/README.md`](./deploy/README.md#restoring-a-backup)). By hand, check the files
against `manifest.json` (`sha256sum`), then:

```bash
pg_restore --clean --if-exists --no-owner --dbname=<database> database.dump
tar -xzf media.tar.gz -C <UPLOAD_DIR>
```
