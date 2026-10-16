import { PrismaClient } from "@prisma/client";

import { env } from "@/lib/env";
import { guardOperation } from "@/lib/read-only";

/**
 * Single shared Prisma client. In development, Next.js hot reload would create
 * a new client (and a new connection pool) on every change, so the instance is
 * cached on `globalThis`.
 *
 * Every write first asks lib/read-only.ts whether it may run: a Full check
 * session on the live site and Bug Guard's checks only read, whatever the
 * code they reach does (v6.4 A4).
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
      async $allOperations({ operation, args, query }) {
        await guardOperation(operation, args);
        return query(args);
      },
    },
  }) as unknown as PrismaClient;
}

export const prisma = globalForPrisma.prisma ?? makeClient();

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
