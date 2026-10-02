import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

type TransactionOptions = { timeout?: number; maxWait?: number };

/** Postgres error codes for a transaction cancelled to break a deadlock, or a serialization failure. */
const RETRYABLE_CODES = ["40P01", "40001"];

/**
 * True when Postgres cancelled the transaction so that another one could finish
 * (a deadlock or a serialization failure). Nothing it did was saved, so it can
 * simply run again.
 */
export function isRetryableTransactionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2034") return true;
    // Raw queries (row and advisory locks) carry the Postgres code in `meta`.
    const code = (error.meta as { code?: unknown } | undefined)?.code;
    return error.code === "P2010" && typeof code === "string" && RETRYABLE_CODES.includes(code);
  }
  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    // Other queries only name the Postgres code in the message.
    return RETRYABLE_CODES.some((code) => error.message.includes(`code: "${code}"`));
  }
  return false;
}

/**
 * Runs an interactive transaction and runs it again (up to `attempts` times in
 * all) when Postgres cancels it to break a deadlock. Transactions that lock
 * several rows can meet another one locking the same rows in a different order,
 * e.g. a supplier's bills while the supplier is settled; Postgres then cancels
 * one of them, and running it again lets it finish once the other has.
 * The callback must only change the database, so a second run starts clean.
 */
export async function runTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: TransactionOptions,
  attempts = 4,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(fn, options);
    } catch (error) {
      if (attempt >= attempts || !isRetryableTransactionError(error)) throw error;
      // A short, random pause so the two transactions do not meet again.
      await new Promise((resolve) => setTimeout(resolve, 25 * attempt + Math.random() * 50));
    }
  }
}
