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

The permission list and the default grants for the five blueprint roles live in
`src/modules/rbac/permissions.ts`.

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
