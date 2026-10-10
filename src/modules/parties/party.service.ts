import { Prisma, type Party, type PartyKind } from "@prisma/client";

import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { assertAllowed } from "@/lib/verdict";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { balancesFor, getPartyBalance } from "@/modules/parties/ledger.service";
import {
  canChangeKind,
  canChangeStanding,
  canEditFields,
  canSetStatus,
} from "@/modules/parties/rules";
import {
  createPartySchema,
  gradeSchema,
  listPartiesSchema,
  statusSchema,
  updatePartySchema,
  verifySchema,
} from "@/modules/parties/schemas";
import { assertNotWalkIn, isWalkIn, WALK_IN_NOT_A_BUYER } from "@/modules/parties/walk-in";

const CODE_PREFIX: Record<PartyKind, string> = { BUYER: "BUY", SUPPLIER: "SUP", BOTH: "BS" };

/** Next free code for the kind, e.g. BUY-0007. */
async function nextPartyCode(ctx: CompanyContext, kind: PartyKind): Promise<string> {
  const prefix = `${CODE_PREFIX[kind]}-`;
  const rows = await ctx.db.party.findMany({
    where: { code: { startsWith: prefix } },
    select: { code: true },
  });
  const max = rows.reduce((m, r) => {
    const n = Number(r.code.slice(prefix.length));
    return Number.isInteger(n) && n > m ? n : m;
  }, 0);
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

async function getPartyOrThrow(ctx: CompanyContext, partyId: string) {
  const party = await ctx.db.party.findUnique({ where: { id: partyId } });
  if (!party) throw new AppError("NOT_FOUND", "Buyer or supplier not found.");
  return party;
}

/** Other parties with the same phone, WhatsApp or email (a hint, not a block). */
export async function findPossibleDuplicates(
  ctx: CompanyContext,
  fields: { phone?: string | null; whatsapp?: string | null; email?: string | null },
  excludeId?: string,
) {
  const or: Prisma.PartyWhereInput[] = [];
  for (const value of [fields.phone, fields.whatsapp].filter(Boolean) as string[]) {
    or.push({ phone: value }, { whatsapp: value });
  }
  if (fields.email) or.push({ email: { equals: fields.email, mode: "insensitive" } });
  if (or.length === 0) return [];
  return ctx.db.party.findMany({
    where: { OR: or, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, code: true, name: true, kind: true },
    take: 5,
  });
}

/**
 * Creates a buyer, supplier or both. The code is generated when not given.
 * Possible duplicates (same phone / email) are returned so the UI can warn.
 */
export async function createParty(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = createPartySchema.parse(raw);
  const { customFields, code: requestedCode, ...fields } = input;
  const buyerType = input.kind === "SUPPLIER" ? null : (input.buyerType ?? ("WHOLESALE" as const));
  const possibleDuplicates = await findPossibleDuplicates(ctx, input);

  if (requestedCode && (await ctx.db.party.findFirst({ where: { code: requestedCode } }))) {
    const taken = `Code ${requestedCode} is already used.`;
    throw new AppError("CONFLICT", taken, { code: [taken] });
  }

  // Two people creating at once can pick the same generated code: retry.
  for (let attempt = 0; ; attempt++) {
    const code = requestedCode ?? (await nextPartyCode(ctx, input.kind));
    try {
      const party = await ctx.db.party.create({
        data: {
          ...fields,
          code,
          buyerType,
          companyId: ctx.company.id,
          country: fields.country ?? "Bangladesh",
          customFields: (customFields ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
      await auditInCompany(ctx, meta, {
        action: "CREATE",
        entityType: "Party",
        entityId: party.id,
        summary: `Created ${party.kind.toLowerCase()} ${party.code} "${party.name}"`,
      });
      return { party, possibleDuplicates };
    } catch (error) {
      const isCodeClash =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
      if (!isCodeClash || requestedCode || attempt >= 9) throw error;
    }
  }
}

export async function updateParty(
  ctx: CompanyContext,
  partyId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = updatePartySchema.parse(raw);
  const before = await getPartyOrThrow(ctx, partyId);
  assertAllowed(canEditFields(before, Object.keys(input)));
  const kind = input.kind ?? before.kind;
  if (kind === "SUPPLIER" && input.buyerType) {
    throw new AppError("VALIDATION", "Suppliers have no buyer type.");
  }
  if (kind === "BUYER" && input.supplierCategories?.length) {
    throw new AppError("VALIDATION", "Buyers have no supplier categories.");
  }
  if (before.kind !== kind) {
    const balanceIsZero = kind === "BOTH" || (await getPartyBalance(ctx, before.id)).isZero();
    assertAllowed(canChangeKind(before.kind, kind, balanceIsZero));
  }
  const { customFields, ...fields } = input;
  const party = await ctx.db.party.update({
    where: { id: before.id },
    data: {
      ...fields,
      ...(kind === "SUPPLIER" ? { buyerType: null } : {}),
      // A buyer supplies nothing.
      ...(kind === "BUYER" && before.supplierCategories.length > 0
        ? { supplierCategories: [] }
        : {}),
      ...(kind !== "SUPPLIER" && !before.buyerType && !input.buyerType
        ? { buyerType: "WHOLESALE" as const }
        : {}),
      ...(customFields !== undefined
        ? { customFields: (customFields ?? Prisma.JsonNull) as Prisma.InputJsonValue }
        : {}),
    },
  });
  const changed = Object.keys(input) as Array<keyof typeof input & keyof Party>;
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "Party",
    entityId: party.id,
    summary: `Updated ${party.code}: ${changed.join(", ")}`,
    before: Object.fromEntries(changed.map((k) => [k, JSON.stringify(before[k] ?? null)])),
    after: Object.fromEntries(changed.map((k) => [k, JSON.stringify(party[k] ?? null)])),
  });
  return {
    party,
    possibleDuplicates: await findPossibleDuplicates(ctx, party, party.id),
  };
}

/** Buyer / supplier list with filters and current balances. */
export async function listParties(ctx: CompanyContext, raw: unknown = {}) {
  const q = listPartiesSchema.parse(raw);
  const take = q.take ?? 50;
  const where: Prisma.PartyWhereInput = {
    ...(q.kind ? { kind: { in: [q.kind, "BOTH"] } } : {}),
    ...(q.buyerType ? { buyerType: q.buyerType } : {}),
    ...(q.grade ? { grade: q.grade } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.category ? { supplierCategories: { has: q.category } } : {}),
    ...(q.verified !== undefined ? { isVerified: q.verified } : {}),
    ...(q.city ? { city: { equals: q.city, mode: "insensitive" } } : {}),
    ...(q.search
      ? {
          OR: [
            { name: { contains: q.search, mode: "insensitive" } },
            { code: { contains: q.search, mode: "insensitive" } },
            { contactPerson: { contains: q.search, mode: "insensitive" } },
            { phone: { contains: q.search } },
            { whatsapp: { contains: q.search } },
            { email: { contains: q.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const rows = await ctx.db.party.findMany({
    where,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: take + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const balances = await balancesFor(
    ctx.company.id,
    page.map((p) => p.id),
  );
  const items = page
    .map((p) => ({ ...p, balance: balances.get(p.id)!.toFixed(2) }))
    .filter((p) => !q.withBalance || Number(p.balance) !== 0);
  return { items, nextCursor: hasMore ? page[page.length - 1]?.id : undefined };
}

/**
 * 360° profile: details, badges, status, balance, credit headroom and activity
 * counts across sales, purchasing and production.
 */
export async function getPartyProfile(ctx: CompanyContext, partyId: string) {
  const party = await getPartyOrThrow(ctx, partyId);
  const id = party.id;
  // Walk-in customers' sales are the orders without a buyer.
  const walkIn = isWalkIn(party);
  const ownSales = walkIn ? { partyId: null } : { partyId: id };
  const [
    balance,
    quotations,
    orders,
    invoices,
    bills,
    productionsAsBuyer,
    productionsAsFactory,
    payments,
  ] = await Promise.all([
    getPartyBalance(ctx, id),
    ctx.db.quotation.count({ where: { partyId: id } }),
    ctx.db.salesOrder.count({ where: ownSales }),
    ctx.db.invoice.count({ where: ownSales }),
    ctx.db.supplierBill.count({ where: { supplierId: id } }),
    ctx.db.productionProject.count({ where: { buyerId: id } }),
    ctx.db.productionProject.count({ where: { factoryId: id } }),
    ctx.db.payment.findMany({
      where: walkIn
        ? { partyId: null, direction: "RECEIVED", orderId: { not: null } }
        : { partyId: id },
      orderBy: { paymentDate: "desc" },
      take: 1,
      select: { paymentDate: true, amount: true, direction: true },
    }),
  ]);
  const daysInactive = party.lastTransactionAt
    ? Math.floor((Date.now() - party.lastTransactionAt.getTime()) / 86_400_000)
    : null;
  return {
    ...party,
    balance: balance.toFixed(2),
    position: balance.gt(0) ? "RECEIVABLE" : balance.lt(0) ? "PAYABLE" : "SETTLED",
    creditAvailable: party.creditLimit ? party.creditLimit.minus(balance).toFixed(2) : null,
    daysInactive,
    counts: {
      quotations,
      orders,
      invoices,
      supplierBills: bills,
      productionsAsBuyer,
      productionsAsFactory,
    },
    lastPayment: payments[0] ?? null,
  };
}

export async function setPartyGrade(
  ctx: CompanyContext,
  partyId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const { grade } = gradeSchema.parse(raw);
  const party = await getPartyOrThrow(ctx, partyId);
  assertAllowed(canChangeStanding(party));
  const updated = await ctx.db.party.update({ where: { id: party.id }, data: { grade } });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "Party",
    entityId: party.id,
    summary: `Grade of ${party.code}: ${party.grade ?? "none"} → ${grade ?? "none"}`,
  });
  return updated;
}

/** Grants or removes the 💙 Blue Verified badge. */
export async function setPartyVerified(
  ctx: CompanyContext,
  partyId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const { isVerified } = verifySchema.parse(raw);
  const party = await getPartyOrThrow(ctx, partyId);
  assertAllowed(canChangeStanding(party));
  const updated = await ctx.db.party.update({
    where: { id: party.id },
    data: { isVerified, verifiedAt: isVerified ? new Date() : null },
  });
  await auditInCompany(ctx, meta, {
    action: "STATUS_CHANGE",
    entityType: "Party",
    entityId: party.id,
    summary: `${isVerified ? "Verified" : "Removed verified badge from"} ${party.code}`,
  });
  return updated;
}

/**
 * Status changes. Closing an account with money still due moves it to SETTLING
 * instead (no new business, dues being cleared); it closes once settled.
 */
export async function changePartyStatus(
  ctx: CompanyContext,
  partyId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = statusSchema.parse(raw);
  const party = await getPartyOrThrow(ctx, partyId);
  assertAllowed(canSetStatus(party, input.status));
  let status = input.status;
  let note: string | undefined;
  if (status === "CLOSED") {
    const balance = await getPartyBalance(ctx, party.id);
    if (!balance.isZero()) {
      status = "SETTLING";
      note = `Balance of ${balance.abs().toFixed(2)} is still open, so the account is settling. It closes once the balance is zero.`;
    }
  }
  const updated = await ctx.db.party.update({
    where: { id: party.id },
    data: { status, statusChangedAt: new Date() },
  });
  await auditInCompany(ctx, meta, {
    action: "STATUS_CHANGE",
    entityType: "Party",
    entityId: party.id,
    summary: `${party.code}: ${party.status} → ${status}${input.reason ? ` (${input.reason})` : ""}`,
  });
  return { party: updated, note };
}

/**
 * Guard for Sales / Purchasing / Production: may we start new business with this
 * party? Checks type, status and (for sales) the credit limit.
 */
export async function assertPartyCanTransact(
  ctx: CompanyContext,
  partyId: string,
  purpose: "SALE" | "PURCHASE",
  newAmount = 0,
) {
  const party = await getPartyOrThrow(ctx, partyId);
  assertNotWalkIn(party, WALK_IN_NOT_A_BUYER);
  const allowedKinds: PartyKind[] = purpose === "SALE" ? ["BUYER", "BOTH"] : ["SUPPLIER", "BOTH"];
  if (!allowedKinds.includes(party.kind)) {
    throw new AppError(
      "VALIDATION",
      `${party.name} is not set up as a ${purpose === "SALE" ? "buyer" : "supplier"}.`,
    );
  }
  if (party.status === "CLOSED" || party.status === "SETTLING") {
    throw new AppError(
      "CONFLICT",
      `${party.name}'s account is ${party.status.toLowerCase()}; no new business is allowed.`,
    );
  }
  if (purpose === "SALE" && party.creditLimit && newAmount > 0) {
    const balance = await getPartyBalance(ctx, party.id);
    if (balance.plus(newAmount).gt(party.creditLimit)) {
      throw new AppError(
        "CONFLICT",
        `Credit limit exceeded: due ${balance.toFixed(2)} + ${newAmount.toFixed(2)} > limit ${party.creditLimit.toFixed(2)}.`,
      );
    }
  }
  return party;
}

/**
 * Called by Sales / Purchasing when a real transaction happens: updates the
 * last-transaction date and wakes a dormant buyer back to ACTIVE.
 */
export async function recordPartyActivity(
  partyId: string,
  at: Date = new Date(),
  db: Db = prisma,
): Promise<void> {
  await db.party.updateMany({
    where: { id: partyId, OR: [{ lastTransactionAt: null }, { lastTransactionAt: { lt: at } }] },
    data: { lastTransactionAt: at },
  });
  await db.party.updateMany({
    where: { id: partyId, status: "DORMANT" },
    data: { status: "ACTIVE", statusChangedAt: new Date() },
  });
}
