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

Check the database connection at <http://localhost:3000/api/health>.

## Useful commands

| Command              | What it does                                    |
| -------------------- | ----------------------------------------------- |
| `npm run db:migrate` | Create a new migration after editing the schema |
| `npm run db:studio`  | Browse the database in a web UI                 |
| `npm run typecheck`  | TypeScript check                                |
| `npm run lint`       | ESLint                                          |
| `npm run build`      | Production build                                |

## Folder structure

```
prisma/
  schema.prisma          # full database design (85 tables)
  migrations/            # SQL migrations applied to PostgreSQL
src/
  app/                   # Next.js App Router (routes; api/health for DB check)
  components/            # shared UI components (added module by module)
  hooks/                 # shared React hooks
  lib/                   # env validation, Prisma client
  modules/<module>/      # one folder per blueprint module (sales, production, ...)
  server/actions/        # Server Actions
  server/services/       # business logic shared across modules
  styles/globals.css     # Tailwind + brand colors
  types/                 # shared TypeScript types
```

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
| `GET/POST /api/roles`, `PATCH/DELETE /api/roles/:id` | Manage roles                                             |
| `GET/POST /api/members`, `PATCH /api/members/:id`    | Add users, change role, deactivate                       |
| `POST /api/members/:id/reset-password`               | Issue a temporary password                               |
| `GET /api/audit-logs`                                | Audit trail with filters                                 |

The same operations are available as Server Actions in `src/server/actions/`.

## Inventory (backend)

Category tree → Brand → Style → color × size matrix, where each cell is one SKU
(`EX-PL-001-NAVY-XL`). Stock is kept per SKU, warehouse and grade (A / B) with a movement
log for every change. Available stock is A-grade minus reserved, and stock never goes below
zero here (Force Override comes with the Sales module). Bad stock records the loss at the
weighted average cost.

| Endpoint                                                                | Purpose                                                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------- |
| `GET /api/inventory/tree`                                               | Category → Brand → Style navigation                     |
| `GET/POST /api/inventory/categories`, `PATCH/DELETE …/:id`              | Category tree                                           |
| `GET/POST /api/inventory/brands`, `PATCH/DELETE …/:id`                  | Brands                                                  |
| `GET/POST /api/inventory/colors`, `PATCH/DELETE …/:id`                  | Colors with hex codes (matrix rows)                     |
| `GET/POST /api/inventory/sizes`, `PATCH/DELETE …/:id`, `POST …/reorder` | Sizes (matrix columns)                                  |
| `GET/POST /api/inventory/styles`, `GET/PATCH/DELETE …/:id`              | Styles; filter by category, brand, search               |
| `GET/POST /api/inventory/styles/:id/matrix`                             | Matrix with live stock / create missing SKUs            |
| `PATCH /api/inventory/variants/:id`                                     | SKU price override, barcode, deactivate                 |
| `GET /api/inventory/lookup?code=`                                       | Find a SKU by barcode or SKU                            |
| `GET/POST /api/inventory/ratio-presets`, `PATCH/DELETE …/:id`           | Saved size ratios                                       |
| `POST /api/inventory/ratio-fill`                                        | Ratio Fill quantities (packs or total, capped to stock) |
| `GET/POST /api/inventory/warehouses`                                    | Warehouses                                              |
| `POST /api/inventory/stock/adjust`                                      | Opening stock or +/- correction                         |
| `POST /api/inventory/stock/bad-stock`                                   | Move to Bad Stock (inventory loss)                      |
| `GET /api/inventory/stock/movements`                                    | Stock history                                           |
| `GET /api/inventory/stock/summary`                                      | Stock value, low / highest / slow stock, top sellers    |

Reads need `inventory.view`; changes need `inventory.manage`. Server Actions for all of these
are in `src/server/actions/inventory.actions.ts`.

## Buyers & Suppliers (backend)

One profile per buyer, supplier or both (`BUY-0001`, `SUP-0001`, `BS-0001`), with a grade
(A+, A, B, C), the Blue Verified badge, a credit limit and an account status. Closing an
account that still owes or is owed money moves it to **Settling** (no new business) and it
closes on its own once the balance reaches zero. Buyers with no business for the company's
"dormant after" period (6 months by default) become **Dormant** and wake up on their next
sale.

Balances come from the double-entry journal: every journal line tagged with a party on the
Receivable, Payable or Customer Advance account counts. Positive means they owe us, negative
means we owe them. Sales, Purchasing and Accounts will post those entries; this module reads
them and posts the one-off opening balance. Statement periods follow the company's timezone,
so `to=2026-02-28` includes everything posted on 28 February in Dhaka.

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

**Books.** Every step posts a balanced journal entry, so the buyer's ledger, statements and
the receivables overview update immediately:

| Event                  | Entry                                                         |
| ---------------------- | ------------------------------------------------------------- |
| Payment before invoice | Dr Cash / Bank / Wallet, Cr Customer Advance (buyer)          |
| Invoice                | Dr Receivable (buyer), Cr Sales / Delivery income / VAT       |
| Advance applied        | Dr Customer Advance, Cr Receivable (inside the invoice entry) |
| Payment after invoice  | Dr Cash / Bank / Wallet, Cr Receivable (buyer)                |
| Delivery               | Dr Cost of Goods Sold, Cr Inventory (at average cost)         |
| Invoice void           | Mirror entry; payments become the buyer's advance again       |

| Endpoint                                                           | Purpose                                                  |
| ------------------------------------------------------------------ | -------------------------------------------------------- |
| `GET/POST /api/sales/custom-fields`, `PATCH …/:id`                 | Extra fields for quotations and other records            |
| `GET/POST /api/sales/quotations`, `GET/PATCH/DELETE …/:id`         | Quotation builder (data for the letterhead PDF)          |
| `PUT /api/sales/quotations/:id/status`                             | Sent, accepted or rejected                               |
| `POST /api/sales/quotations/:id/convert`                           | Make the proforma invoice                                |
| `GET /api/sales/proformas`, `GET …/:id`                            | Proformas with advance due, payments and production      |
| `POST /api/sales/proformas/:id/cancel` / `…/convert`               | Cancel (no advance yet) / turn into a sales order        |
| `GET/POST /api/sales/orders`, `GET/PATCH …/:id`                    | Orders and checkout; edit before delivery and invoicing  |
| `POST /api/sales/orders/:id/cancel`                                | Cancel and free the reserved stock                       |
| `POST /api/sales/orders/:id/invoice` / `packing-list` / `challans` | Make each document later                                 |
| `GET /api/sales/invoices/:id`, `POST …/:id/void`                   | Commercial invoice / void it (audited)                   |
| `GET /api/sales/packing-lists/:id`, `PUT …/:id/pick`               | Pick-list and picking progress                           |
| `GET /api/sales/challans`, `GET …/:id`                             | Challan history and the price-free challan               |
| `GET/POST /api/sales/payments`, `GET …/:id`                        | Money received (order, proforma or on account), receipts |
| `GET /api/sales/summary?from=&to=`                                 | Today's sales, collections and open dues                 |

Reads need `sales.view`; quotations and proformas need `sales.quotation.manage`; orders and
documents need `sales.order.create`; recording money received (on its own or at checkout)
needs `accounts.receipts.record`, which only Accounts and Super Admin hold by default, so
Sales Executives create orders and proformas but never record receipts; voiding an invoice
needs `sales.invoice.edit`; custom field definitions need `company.settings`. Server Actions are in
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
ratio of A-grade (half by default), or as typed in. Each SKU's average cost is re-weighted,
so sales are costed at what the goods cost to make.

| Event                        | Entry                                                    |
| ---------------------------- | -------------------------------------------------------- |
| Supplier bill                | Dr Work in Progress (per project), Cr Payable (supplier) |
| Supplier paid                | Dr Payable (supplier), Cr Cash / Bank / Wallet           |
| Cost paid without a supplier | Dr Work in Progress, Cr Cash / Bank / Wallet             |
| Delivery moved to stock      | Dr Finished Goods Inventory, Cr Work in Progress         |
| Unrecovered cost written off | Dr Production & Inventory Losses, Cr Work in Progress    |

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
| `GET /api/files/:id`                                                | Open an uploaded file                                      |

Reads need `production.view`, which the Warehouse Team also holds. Projects, stages, cost
heads and Due bills need `production.manage`. Money paid out (bill payments, costs paid in
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
Mobile Wallets (1050), Bank (1100), Receivables, Inventory, Work in Progress, Fixed Assets
and Accumulated Depreciation, Payables (2100), Customer Advances, VAT, loans (from 2300),
investors (from 2400), owners' capital (from 3000), Drawings, Opening Balance Equity, Sales,
Other Income, Cost of Goods Sold and the expense accounts (6000 to 7000). Accounts adds
accounts (the next free code in the range by default), renames them, archives them at a zero
balance, and brings balances forward from before go-live against Opening Balance Equity.
Every account has a ledger for any period with a running balance.

**Journal and transfers.** Journal vouchers record adjustments as balanced debit and credit
lines. A posted entry is never edited or deleted: it is reversed with a reason, and the
reversal is an entry of its own. Money moved between cash, bank and wallets is a transfer.
Sales, production, expenses, assets and capital all post to the same journal, so the day
book shows everything.

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
- **Books check:** the journal balances, and the stock, fixed asset, loan, investor and
  supplier bill registers agree with their ledger accounts.
- **Overview:** cash, bank and wallet balances, stock value, fixed assets, loans and
  investors, today's sales, this month's and this year's profit, overdue installments and
  claims waiting to be paid.

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

## Backups (backend)

Every day at 02:00 (Asia/Dhaka) the server backs up the whole platform, every company, into
`BACKUP_DIR/<date_time>/`:

| File            | What it holds                                                        |
| --------------- | -------------------------------------------------------------------- |
| `database.dump` | The database (`pg_dump`, custom format)                              |
| `media.tar.gz`  | Uploaded files: logos, packing lists, bill scans (can be turned off) |
| `manifest.json` | Sizes and SHA-256 checksums of the files, and how to restore         |

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

- Install the PostgreSQL 16 client tools for `pg_dump` (`apt install postgresql-client-16`),
  or set `PG_DUMP_PATH`. When the app runs in Docker, the app image needs them too. The
  backup settings show whether `pg_dump` was found.
- Keep `BACKUP_DIR` on a persistent volume.
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

**Restoring.** Check the files against `manifest.json` (`sha256sum`), then:

```bash
pg_restore --clean --if-exists --no-owner --dbname=<database> database.dump
tar -xzf media.tar.gz -C <UPLOAD_DIR>
```
