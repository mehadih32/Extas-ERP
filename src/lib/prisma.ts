import { PrismaClient } from "@prisma/client";

import { env } from "@/lib/env";
import { guardOperation, insideReadOnlyWork } from "@/lib/read-only";
import { noteQueryTime } from "@/lib/slow-queries";

/**
 * Single shared Prisma client. In development, Next.js hot reload would create
 * a new client (and a new connection pool) on every change, so the instance is
 * cached on `globalThis`.
 *
 * Every write first asks lib/read-only.ts whether it may run: a Full check
 * session on the live site and Bug Guard's checks only read, whatever the
 * code they reach does (v6.4 A4). Calls over a second are noted for Bug Guard
 * (lib/slow-queries.ts: the table and the kind of call, never the values),
 * except Bug Guard's own (its checks read whole tables on purpose).
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function makeClient(): PrismaClient {
  const base = new PrismaClient({
    datasourceUrl: env.DATABASE_URL,
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
  return base.$extends({
    name: "read-only-guard",
    query: {
      async $allOperations({ model, operation, args, query }) {
        await guardOperation(operation, args);
        const started = performance.now();
        try {
          return await query(args);
        } finally {
          if (!insideReadOnlyWork()) noteQueryTime(model, operation, performance.now() - started);
        }
      },
    },
  }) as unknown as PrismaClient;
}

export const prisma = globalForPrisma.prisma ?? makeClient();

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
