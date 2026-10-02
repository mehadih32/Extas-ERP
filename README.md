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
  schema.prisma          # full database design (96 tables)
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
- **Books check:** the journal balances, and the stock, raw material, work in progress,
  fixed asset, loan, investor, supplier bill, employee advance and unpaid salary registers
  agree with their ledger accounts.
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
| Total active stock value        | Finished goods on hand (A and B grade) at average cost        | Pieces and value per grade; raw materials and WIP |
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
page; long tables carry their header onto the next page. It uses the built-in Helvetica font,
which covers English and Western European letters, so other scripts (such as Bengali) show as
"?" in the PDF; the Excel file keeps them. The Excel file has an overview sheet and one sheet
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

Quotations, proforma and commercial invoices, delivery challans, buyer and supplier statements,
stock availability sheets and a blank letterhead pad print as A4 PDFs on the company
letterhead: the logo, name, legal name and contact details on top, the company colours, and
the footer line with page numbers on every page. Everything on the page comes from the same
data as the screens, with amounts in lakh and crore for taka and dates in the company's time
zone.

| Document             | What it shows                                                                                                               | Needs                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Quotation            | Items with style, fabric and sizes, discount, VAT, the total in words, styling instructions, custom fields and terms        | `sales.view`           |
| Proforma invoice     | The quotation's items and total, the advance with what is received and due, and payments; CANCELLED across a cancelled one  | `sales.view`           |
| Commercial invoice   | Each SKU with pieces and price (a discount column only when used), delivery charge, VAT, paid and due; PAID or VOID marks   | `sales.view`           |
| Delivery challan     | SKU, item, colour, size and pieces with the total, vehicle and driver, received by; no prices                               | `sales.view`           |
| Statement of account | Opening balance, debits, credits and closing balance (Dr / Cr), then every transaction with the running balance, any period | `parties.ledger.view`  |
| Stock availability   | Pieces ready to ship per colour and size for chosen styles or a whole brand, in one warehouse or all; no prices             | `inventory.view`       |
| Blank letterhead     | The letterhead and footer on an empty page, for letters                                                                     | `documents.letterhead` |

`documents.letterhead` is new: Sales Executives, Accounts and Production Managers have it by
default (Super Admin has every permission). The stock sheet counts first-quality pieces less
those set aside for orders, never below zero. A brand sheet leaves out styles with nothing to
sell unless `includeEmpty` is set, and shows up to 100 styles.

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

The built-in PDF fonts cover English and Western European letters, so other scripts (such as
Bengali) show as "?" on the page. Packing lists and payment receipts are not printable yet.

| Endpoint                                                       | Purpose                                                                |
| -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `POST /api/documents`                                          | Print a document (see below); returns it with `reused`                 |
| `GET /api/documents?type=&referenceId=&partyId=&cursor=&take=` | Printed documents this person may see, newest first                    |
| `GET /api/documents/:id`                                       | One printed document                                                   |
| `GET /api/documents/:id/download?inline=1`                     | The PDF (`inline=1` opens it in the browser to print)                  |
| `GET/POST/DELETE /api/company/logo`                            | The letterhead logo: see it, upload it (multipart `file`) or remove it |

What to print:

- `{ type: "QUOTATION" | "PROFORMA_INVOICE" | "COMMERCIAL_INVOICE" | "DELIVERY_CHALLAN", id }`
- `{ type: "LEDGER_STATEMENT", partyId, from?, to? }` (calendar days; none = the whole account)
- `{ type: "STOCK_AVAILABILITY", styleIds?, brandId?, warehouseId?, includeEmpty? }`
- `{ type: "LETTERHEAD" }`

Server Actions are in `src/server/actions/documents.actions.ts`, with `uploadCompanyLogoAction`
and `removeCompanyLogoAction` in `src/server/actions/company.actions.ts`.

## Backups (backend)

Every day at 02:00 (Asia/Dhaka) the server backs up the whole platform, every company, into
`BACKUP_DIR/<date_time>/`:

| File            | What it holds                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| `database.dump` | The database (`pg_dump`, custom format)                                                                 |
| `media.tar.gz`  | Stored files: logos, packing lists, bill scans, saved reports and printed documents (can be turned off) |
| `manifest.json` | Sizes and SHA-256 checksums of the files, and how to restore                                            |

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
