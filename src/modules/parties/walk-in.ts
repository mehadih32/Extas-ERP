import { randomUUID } from "node:crypto";

import type { Party } from "@prisma/client";

import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

/*
 * Walk-in customers: the books account of every sale without a buyer profile
 * (counter sales, and website or social orders taken by name only). Their
 * invoices, payments and refunds post their receivable and advance lines to it,
 * so every buyer-account line in the books names an account, the receivables
 * overview counts what walk-in customers still owe, and its statement lists
 * every walk-in sale. The orders keep no buyer: the customer's name and phone
 * stay on the order and its documents.
 *
 * The system keeps the account. It is made with the company's first walk-in
 * sale, stays an open buyer account, and is never the buyer of a quotation,
 * proforma, order or payment: those leave the buyer empty instead.
 */

export const WALK_IN_NAME = "Walk-in customers";
export const WALK_IN_CODE = "WALK-IN";
const WALK_IN_NOTE = "Kept by the system: the books account of every sale without a buyer profile.";

export function isWalkIn(party: Pick<Party, "systemRole">): boolean {
  return party.systemRole === "WALK_IN";
}

/** Refuses to change or use the Walk-in customers account as if it were a buyer. */
export function assertNotWalkIn(party: Pick<Party, "systemRole">, message: string) {
  if (isWalkIn(party)) throw new AppError("VALIDATION", message);
}

/** The message for anything that would name Walk-in customers as a document's buyer. */
export const WALK_IN_NOT_A_BUYER =
  "Walk-in customers is the books account for sales without a buyer: leave the buyer empty instead.";

/**
 * Id of the company's Walk-in customers account, made on first use. Safe inside
 * a transaction and when two first walk-in sales come at once: the insert skips
 * an account another transaction just made and the read then finds it.
 */
export async function ensureWalkInParty(companyId: string, db: Db = prisma): Promise<string> {
  const find = () =>
    db.party.findUnique({
      where: { companyId_systemRole: { companyId, systemRole: "WALK_IN" } },
      select: { id: true },
    });
  const existing = await find();
  if (existing) return existing.id;
  // WALK-IN, unless a buyer or supplier already has that code.
  for (let attempt = 1; attempt <= 20; attempt++) {
    const code = attempt === 1 ? WALK_IN_CODE : `${WALK_IN_CODE}-${attempt}`;
    await db.$executeRaw`
      INSERT INTO "Party" ("id", "companyId", "code", "kind", "buyerType", "name", "notes", "systemRole", "createdAt", "updatedAt")
      VALUES (${randomUUID()}, ${companyId}, ${code}, 'BUYER', 'RETAIL', ${WALK_IN_NAME}, ${WALK_IN_NOTE}, 'WALK_IN', now(), now())
      ON CONFLICT DO NOTHING`;
    const made = await find();
    if (made) return made.id;
  }
  throw new AppError("CONFLICT", "Could not set up the Walk-in customers account.");
}
