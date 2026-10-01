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
