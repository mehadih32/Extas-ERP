import type { PettyCashBox } from "@prisma/client";

import { localDay, toInstant } from "@/lib/dates";
import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { accountTotals, money, ZERO } from "@/modules/accounts/balances";
import { createNumberedAccount, isCashSubType } from "@/modules/accounts/chart";
import { buildLedger, listCashAccounts } from "@/modules/accounts/chart.service";
import { isMoneyAccountKind, LEDGER_LINES_SHOWN } from "@/modules/accounts/choices";
import { assertCanManageAccounts, assertCanPayMoney } from "@/modules/accounts/money-guards";
import { boxBalance } from "@/modules/accounts/petty-cash-balance";
import { createPettyCashBoxSchema, updatePettyCashBoxSchema } from "@/modules/accounts/schemas";
import { postTransferTx } from "@/modules/accounts/voucher.service";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";

/*
 * Petty cash boxes: cash one person keeps for small daily costs, each on its own
 * cash ledger account ("Petty cash — Factory"), so the main cash and bank ledgers
 * only show the top-ups:
 *   Top up              Dr Petty cash — <box>   Cr Bank / Cash          (a transfer, Accounts)
 *   A cost from the box Dr the head's account   Cr Petty cash — <box>   (an expense, the holder)
 *   Money taken back    Dr Bank / Cash          Cr Petty cash — <box>   (a transfer, Accounts)
 * The holder records each cost straight into the books with no approval step (the
 * owner's decision), never more than is in the box. Accounts sees every entry on
 * the box's page and voids a cost like any other expense.
 */

const TX_OPTIONS = { timeout: 30_000 };

/** The box's cash account: "Petty cash — Factory". */
const accountNameOf = (name: string) => `Petty cash — ${name}`;

const holderSelect = { id: true, name: true, email: true } as const;

/**
 * People who may hold a box: active members who record expenses, by their role
 * (unless it was taken away from them) or given it for themselves.
 */
async function holderChoices(ctx: CompanyContext) {
  const records = { permission: { key: "expenses.create" } } as const;
  const members = await prisma.companyMembership.findMany({
    where: {
      companyId: ctx.company.id,
      isActive: true,
      user: { status: "ACTIVE" },
      OR: [
        {
          role: { permissions: { some: records } },
          permissionChanges: { none: { ...records, granted: false } },
        },
        { permissionChanges: { some: { ...records, granted: true } } },
      ],
    },
    select: { user: { select: holderSelect } },
    orderBy: { user: { name: "asc" } },
  });
  return members.map((m) => m.user);
}

async function assertHolder(ctx: CompanyContext, holderId: string) {
  const holders = await holderChoices(ctx);
  const holder = holders.find((h) => h.id === holderId);
  if (!holder) {
    throw new AppError("VALIDATION", "Choose someone in the company whose role records expenses.", {
      holderId: ["Choose who keeps the box."],
    });
  }
  return holder;
}

/** A box name and its account name must both be free. */
async function assertNameFree(db: Db, companyId: string, name: string, exceptBoxId?: string) {
  const [box, account] = await Promise.all([
    db.pettyCashBox.findFirst({
      where: {
        companyId,
        name: { equals: name, mode: "insensitive" },
        ...(exceptBoxId ? { id: { not: exceptBoxId } } : {}),
      },
      select: { id: true },
    }),
    db.ledgerAccount.findFirst({
      where: {
        companyId,
        name: { equals: accountNameOf(name), mode: "insensitive" },
        ...(exceptBoxId ? { pettyCashBox: { id: { not: exceptBoxId } } } : {}),
      },
      select: { id: true },
    }),
  ]);
  if (box || account) {
    throw new AppError("CONFLICT", `There is already a petty cash box called "${name}".`, {
      name: ["Choose another name."],
    });
  }
}

const holds = (ctx: CompanyContext, box: Pick<PettyCashBox, "holderId">) =>
  box.holderId === ctx.user.id;

/** Its holder sees the box; so does everyone who sees the books. */
function assertCanSeeBox(ctx: CompanyContext, box: Pick<PettyCashBox, "holderId">) {
  if (!holds(ctx, box) && !ctx.can("accounts.view")) {
    throw new AppError("FORBIDDEN", "Only the box's holder and Accounts see this petty cash box.");
  }
}

/** The cash, bank and wallet accounts money moves between, for the top-up and take-back windows. */
async function moneyAccounts(ctx: CompanyContext) {
  const accounts = await listCashAccounts(ctx);
  return accounts.flatMap((a) =>
    isMoneyAccountKind(a.subType)
      ? [{ id: a.id, name: a.name, kind: a.subType, balance: a.balance }]
      : [],
  );
}

async function loadBox(ctx: CompanyContext, boxId: string) {
  const box = await ctx.db.pettyCashBox.findFirst({
    where: { id: boxId, companyId: ctx.company.id },
    include: { holder: { select: holderSelect }, ledgerAccount: true },
  });
  if (!box) throw new AppError("NOT_FOUND", "Petty cash box not found.");
  return box;
}

// =============================================================================
// Spending from a box (used by the expense service)
// =============================================================================

/**
 * The box an expense is paid from: open, and held by the person recording it
 * (Accounts, who pay money out anyway, may record from any box).
 */
export async function pettyCashBoxForCost(ctx: CompanyContext, boxId: string) {
  const box = await ctx.db.pettyCashBox.findFirst({
    where: { id: boxId, companyId: ctx.company.id },
  });
  if (!box) throw new AppError("NOT_FOUND", "Petty cash box not found.");
  if (!holds(ctx, box) && !ctx.can("accounts.payments.record")) {
    throw new AppError("FORBIDDEN", `Only the holder of ${box.name} records costs from it.`);
  }
  if (!box.isActive) throw new AppError("CONFLICT", `${box.name} is closed.`);
  return box;
}

// =============================================================================
// Reads
// =============================================================================

/** Every box with its holder and balance (Cash & bank, accounts.view). */
export async function listPettyCashBoxes(ctx: CompanyContext) {
  const [boxes, totals] = await Promise.all([
    ctx.db.pettyCashBox.findMany({
      include: { holder: { select: holderSelect } },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
    accountTotals(ctx.company.id),
  ]);
  return boxes.map((b) => {
    const t = totals.get(b.ledgerAccountId);
    return {
      id: b.id,
      name: b.name,
      ledgerAccountId: b.ledgerAccountId,
      holder: b.holder,
      float: b.float?.toFixed(2) ?? null,
      isActive: b.isActive,
      balance: (t ? t.debit.minus(t.credit) : ZERO).toFixed(2),
    };
  });
}

export type PettyCashBoxRow = Awaited<ReturnType<typeof listPettyCashBoxes>>[number];

/** The open boxes this person keeps, with what is in each (Expenses and the expense form). */
export async function myPettyCashBoxes(ctx: CompanyContext) {
  const boxes = await ctx.db.pettyCashBox.findMany({
    where: { holderId: ctx.user.id, isActive: true },
    select: { id: true, name: true, ledgerAccountId: true, float: true },
    orderBy: { name: "asc" },
  });
  if (boxes.length === 0) return [];
  const totals = await accountTotals(ctx.company.id);
  return boxes.map((b) => {
    const t = totals.get(b.ledgerAccountId);
    return {
      id: b.id,
      name: b.name,
      float: b.float?.toFixed(2) ?? null,
      balance: (t ? t.debit.minus(t.credit) : ZERO).toFixed(2),
    };
  });
}

export type MyPettyCashBox = Awaited<ReturnType<typeof myPettyCashBoxes>>[number];

/**
 * The boxes a new expense may be paid from: the ones this person keeps, and the
 * box asked for when Accounts records a cost from someone else's box.
 */
export async function boxesToSpendFrom(ctx: CompanyContext, boxId?: string) {
  const mine = await myPettyCashBoxes(ctx);
  if (!boxId || mine.some((b) => b.id === boxId) || !ctx.can("accounts.payments.record")) {
    return mine;
  }
  const box = await ctx.db.pettyCashBox.findFirst({
    where: { id: boxId, isActive: true },
    select: { id: true, name: true, ledgerAccountId: true, float: true },
  });
  if (!box) return mine;
  const balance = await boxBalance(ctx.company.id, box);
  return [
    ...mine,
    {
      id: box.id,
      name: box.name,
      float: box.float?.toFixed(2) ?? null,
      balance: balance.toFixed(2),
    },
  ];
}

/**
 * One box: who keeps it, what is in it, every top-up and cost from its own
 * ledger (latest last), and what this person may do with it.
 */
export async function getPettyCashScreen(ctx: CompanyContext, boxId: string) {
  const box = await loadBox(ctx, boxId);
  assertCanSeeBox(ctx, box);
  const tz = ctx.company.timezone;
  const ledger = await buildLedger(ctx.company.id, box.ledgerAccount, {});
  const shown = ledger.lines.slice(-LEDGER_LINES_SHOWN);
  const balance = ledger.closing;
  const pay = ctx.can("accounts.payments.record");
  const manage = ctx.can("accounts.manage");
  const open = box.isActive;
  // Costs (less any voided) and the rest: top-ups less money taken back.
  const spent = ledger.lines.reduce(
    (sum, l) => (l.sourceType === "EXPENSE" ? sum.plus(l.credit).minus(l.debit) : sum),
    ZERO,
  );
  const accounts = open && pay ? await moneyAccounts(ctx) : [];
  return {
    today: localDay(new Date(), tz),
    box: {
      id: box.id,
      name: box.name,
      notes: box.notes,
      isActive: box.isActive,
      float: box.float?.toFixed(2) ?? null,
      holder: box.holder,
      ledgerAccountId: box.ledgerAccountId,
      balance: balance.toFixed(2),
      /** Top-ups less money taken back (what is in it plus what was spent). */
      putIn: balance.plus(spent).toFixed(2),
      spent: spent.toFixed(2),
      /** How much brings it back to its usual amount (null when it is at or above it). */
      shortOfFloat:
        open && box.float && balance.lt(box.float) ? box.float.minus(balance).toFixed(2) : null,
    },
    lines: shown.map((l) => ({
      entryId: l.entryId,
      day: localDay(l.date, tz),
      number: l.number,
      description: l.description,
      memo: l.memo,
      sourceType: l.sourceType,
      sourceId: l.sourceId,
      debit: l.debit,
      credit: l.credit,
      balance: l.balance,
      isReversal: l.isReversal,
      isReversed: l.isReversed,
    })),
    hiddenCount: ledger.lines.length - shown.length,
    /** Where a top-up comes from and money taken back goes (the box itself among them). */
    accounts,
    can: {
      record: open && (holds(ctx, box) || pay) && ctx.can("expenses.create"),
      topUp: open && pay && accounts.length >= 2,
      takeBack: open && pay && balance.gt(0),
      edit: open && manage,
      close: open && manage && balance.isZero(),
      openEntries: ctx.can("accounts.view"),
    },
  };
}

export type PettyCashScreen = Awaited<ReturnType<typeof getPettyCashScreen>>;

/** The new-box and change-box form: who may hold it, and the box when changing it. */
export async function getPettyCashForm(ctx: CompanyContext, boxId?: string) {
  assertCanManageAccounts(ctx, "Only Accounts can set up petty cash boxes.");
  const topUp = !boxId && ctx.can("accounts.payments.record");
  const [holders, box, accounts] = await Promise.all([
    holderChoices(ctx),
    boxId ? loadBox(ctx, boxId) : Promise.resolve(null),
    topUp ? moneyAccounts(ctx) : Promise.resolve([]),
  ]);
  if (box && !box.isActive) throw new AppError("CONFLICT", `${box.name} is closed.`);
  return {
    today: localDay(new Date(), ctx.company.timezone),
    holders,
    box: box
      ? {
          id: box.id,
          name: box.name,
          holderId: box.holderId,
          float: box.float?.toFixed(2) ?? null,
          notes: box.notes,
        }
      : null,
    /** Where the first top-up comes from. */
    accounts,
    can: { topUp: topUp && accounts.length > 0 },
  };
}

export type PettyCashForm = Awaited<ReturnType<typeof getPettyCashForm>>;

// =============================================================================
// Changes (Accounts)
// =============================================================================

/**
 * Opens a box on its own cash account, optionally with its first top-up from
 * a cash, bank or wallet account.
 */
export async function createPettyCashBox(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanManageAccounts(ctx, "Only Accounts can set up petty cash boxes.");
  const input = createPettyCashBoxSchema.parse(raw);
  if (input.topUp) assertCanPayMoney(ctx, "Only Accounts can put money into a petty cash box.");
  const companyId = ctx.company.id;
  const holder = await assertHolder(ctx, input.holderId);
  const from = input.topUp
    ? await ctx.db.ledgerAccount.findFirst({
        where: { id: input.topUp.fromAccountId, isActive: true },
      })
    : null;
  if (input.topUp && (!from || !isCashSubType(from.subType))) {
    throw new AppError(
      "VALIDATION",
      "Choose the cash, bank or wallet account the money comes from.",
      {
        fromAccountId: ["Choose where the money comes from."],
      },
    );
  }

  const box = await prisma.$transaction(async (tx) => {
    await assertNameFree(tx, companyId, input.name);
    const account = await createNumberedAccount(tx, companyId, {
      name: accountNameOf(input.name),
      subType: "CASH",
    });
    const created = await tx.pettyCashBox.create({
      data: {
        companyId,
        ledgerAccountId: account.id,
        name: input.name,
        holderId: holder.id,
        float: input.float != null ? money(input.float) : null,
        notes: input.notes ?? null,
      },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "PettyCashBox",
        entityId: created.id,
        summary: `Opened petty cash box ${created.name} (${account.code}), held by ${holder.name}`,
      },
      tx,
    );
    if (input.topUp && from) {
      await postTransferTx(
        tx,
        ctx,
        {
          from,
          to: account,
          amount: money(input.topUp.amount),
          date: input.topUp.date ? toInstant(input.topUp.date, ctx.company.timezone) : new Date(),
          reference: input.topUp.reference,
          notes: "first top-up",
        },
        meta,
      );
    }
    return created;
  }, TX_OPTIONS);
  return { id: box.id, name: box.name };
}

/** Renames a box (and its account), hands it to someone else, or changes its usual amount. */
export async function updatePettyCashBox(
  ctx: CompanyContext,
  boxId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageAccounts(ctx, "Only Accounts can change petty cash boxes.");
  const input = updatePettyCashBoxSchema.parse(raw);
  const companyId = ctx.company.id;
  const holder = input.holderId ? await assertHolder(ctx, input.holderId) : null;
  const box = await prisma.$transaction(async (tx) => {
    await lockRow(tx, "PettyCashBox", boxId);
    const current = await tx.pettyCashBox.findFirst({ where: { id: boxId, companyId } });
    if (!current) throw new AppError("NOT_FOUND", "Petty cash box not found.");
    if (!current.isActive) throw new AppError("CONFLICT", `${current.name} is closed.`);
    const renamed = input.name !== undefined && input.name !== current.name;
    if (renamed) {
      await assertNameFree(tx, companyId, input.name!, current.id);
      await tx.ledgerAccount.update({
        where: { id: current.ledgerAccountId },
        data: { name: accountNameOf(input.name!) },
      });
    }
    const updated = await tx.pettyCashBox.update({
      where: { id: current.id },
      data: {
        name: input.name,
        holderId: holder?.id,
        float:
          input.float === undefined ? undefined : input.float === null ? null : money(input.float),
        notes: input.notes,
      },
    });
    const changes = [
      renamed ? `renamed to ${updated.name}` : null,
      holder && holder.id !== current.holderId ? `now held by ${holder.name}` : null,
      input.float !== undefined ? `usual amount ${updated.float?.toFixed(2) ?? "none"}` : null,
      input.notes !== undefined ? "notes" : null,
    ].filter(Boolean);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "PettyCashBox",
        entityId: current.id,
        summary: `Petty cash box ${current.name}: ${changes.join(", ") || "no change"}`,
      },
      tx,
    );
    return updated;
  }, TX_OPTIONS);
  return { id: box.id, name: box.name };
}

/** Closes an empty box; its account is archived and its entries stay in the books. */
export async function closePettyCashBox(ctx: CompanyContext, boxId: string, meta?: RequestMeta) {
  assertCanManageAccounts(ctx, "Only Accounts can close petty cash boxes.");
  const companyId = ctx.company.id;
  const box = await prisma.$transaction(async (tx) => {
    await lockRow(tx, "PettyCashBox", boxId);
    const current = await tx.pettyCashBox.findFirst({ where: { id: boxId, companyId } });
    if (!current) throw new AppError("NOT_FOUND", "Petty cash box not found.");
    if (!current.isActive) throw new AppError("CONFLICT", `${current.name} is already closed.`);
    const balance = await boxBalance(companyId, current, tx);
    if (!balance.isZero()) {
      throw new AppError(
        "CONFLICT",
        `${current.name} still has ${balance.toFixed(2)} in it. Take the money back first.`,
      );
    }
    await tx.ledgerAccount.update({
      where: { id: current.ledgerAccountId },
      data: { isActive: false },
    });
    const closed = await tx.pettyCashBox.update({
      where: { id: current.id },
      data: { isActive: false },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "PettyCashBox",
        entityId: current.id,
        summary: `Closed petty cash box ${current.name}`,
      },
      tx,
    );
    return closed;
  }, TX_OPTIONS);
  return { id: box.id, name: box.name };
}
