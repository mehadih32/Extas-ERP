import { PrismaClient } from "@prisma/client";

import { env } from "@/lib/env";

/**
 * Single shared Prisma client. In development, Next.js hot reload would create
 * a new client (and a new connection pool) on every change, so the instance is
 * cached on `globalThis`.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: env.DATABASE_URL,
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
