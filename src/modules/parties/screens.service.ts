import type { PartyGrade, PartyKind, PartyStatus } from "@prisma/client";

import { localDay } from "@/lib/dates";
import type { CompanyContext } from "@/modules/auth/context";
import { PRINT_INFO } from "@/modules/documents/print.service";
import { whatsappDigits } from "@/modules/parties/contact";
import { getReceivablesPayables, getStatement } from "@/modules/parties/ledger.service";
import {
  findPossibleDuplicates,
  getPartyProfile,
  listParties,
} from "@/modules/parties/party.service";
import {
  canChangeKind,
  canChangeStanding,
  statusChoices,
  WALK_IN_EDITABLE,
} from "@/modules/parties/rules";
import { isWalkIn } from "@/modules/parties/walk-in";

/*
 * What the Buyers & suppliers screens show, as plain values (amounts as
 * "12500.00" strings, days as "2026-10-08" in company time), with what the
 * person looking may do decided by the same permissions and rules the party
 * actions enforce: changes need parties.manage, grade, badge and status follow
 * parties/rules.ts, opening balances need accounts.manage, and statements and
 * the dues overview need parties.ledger.view.
 */

const KINDS: PartyKind[] = ["BUYER", "SUPPLIER", "BOTH"];

type ListedParty = Awaited<ReturnType<typeof listParties>>["items"][number];

function presentRow(p: ListedParty) {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    kind: p.kind,
    buyerType: p.buyerType,
    contactPerson: p.contactPerson,
    phone: p.phone,
    city: p.city,
    grade: p.grade,
    isVerified: p.isVerified,
    status: p.status,
    isWalkIn: isWalkIn(p),
    /** Positive: they owe the company; negative: the company owes them. */
    balance: p.balance,
  };
}

export type PartyRow = ReturnType<typeof presentRow>;

/**
 * When Walk-in customers last did business: its latest sale. Sales name no
 * buyer for it, so its own last-transaction date is never set.
 */
async function walkInLastSale(ctx: CompanyContext): Promise<Date | null> {
  const order = await ctx.db.salesOrder.findFirst({
    where: { partyId: null, status: { notIn: ["DRAFT", "CANCELLED"] } },
    orderBy: { orderDate: "desc" },
    select: { orderDate: true },
  });
  return order?.orderDate ?? null;
}

/** A page of buyers or suppliers for the filters given (listPartiesSchema). */
export async function listPartyRows(ctx: CompanyContext, raw: unknown = {}) {
  const page = await listParties(ctx, raw);
  return { items: page.items.map(presentRow), nextCursor: page.nextCursor };
}

/** The Buyers or Suppliers tab: the first page, and whether this person may add one. */
export async function getPartyList(ctx: CompanyContext, raw: unknown = {}) {
  return {
    ...(await listPartyRows(ctx, raw)),
    canCreate: ctx.can("parties.manage"),
  };
}

export type PartyList = Awaited<ReturnType<typeof getPartyList>>;

/**
 * One buyer's or supplier's profile: details, grade, badge and status, the
 * balance with the credit headroom, activity counts, other accounts with the
 * same phone or email, and what this person may do.
 */
export async function getPartyScreen(ctx: CompanyContext, partyId: string) {
  const profile = await getPartyProfile(ctx, partyId);
  const tz = ctx.company.timezone;
  const manage = ctx.can("parties.manage");
  const possibleDuplicates = isWalkIn(profile)
    ? []
    : await findPossibleDuplicates(ctx, profile, profile.id);
  const whatsapp = whatsappDigits(profile.whatsapp ?? profile.phone);
  const lastBusiness = isWalkIn(profile) ? await walkInLastSale(ctx) : profile.lastTransactionAt;
  return {
    party: {
      id: profile.id,
      code: profile.code,
      name: profile.name,
      kind: profile.kind,
      buyerType: profile.buyerType,
      contactPerson: profile.contactPerson,
      phone: profile.phone,
      whatsapp: profile.whatsapp,
      email: profile.email,
      address: profile.address,
      city: profile.city,
      country: profile.country,
      taxId: profile.taxId,
      grade: profile.grade,
      isVerified: profile.isVerified,
      verifiedOn: profile.verifiedAt ? localDay(profile.verifiedAt, tz) : null,
      status: profile.status,
      statusChangedOn: profile.statusChangedAt ? localDay(profile.statusChangedAt, tz) : null,
      notes: profile.notes,
      isWalkIn: isWalkIn(profile),
      addedOn: localDay(profile.createdAt, tz),
    },
    money: {
      balance: profile.balance,
      position: profile.position as "RECEIVABLE" | "PAYABLE" | "SETTLED",
      creditLimit: profile.creditLimit?.toFixed(2) ?? null,
      creditAvailable: profile.creditAvailable,
      paymentTermsDays: profile.paymentTermsDays,
      openingBalance: profile.openingBalance.toFixed(2),
      lastPayment: profile.lastPayment
        ? {
            on: localDay(profile.lastPayment.paymentDate, tz),
            amount: profile.lastPayment.amount.toFixed(2),
            direction: profile.lastPayment.direction,
          }
        : null,
    },
    lastTransactionOn: lastBusiness ? localDay(lastBusiness, tz) : null,
    daysInactive: lastBusiness
      ? Math.floor((Date.now() - lastBusiness.getTime()) / 86_400_000)
      : null,
    counts: profile.counts,
    /** Digits for a wa.me chat link (WhatsApp number, else the phone). */
    whatsappDigits: whatsapp,
    possibleDuplicates,
    can: {
      /** Edit the details (only the name and notes of Walk-in customers). */
      edit: manage,
      /** Grade and the Blue Verified badge. */
      standing: manage && canChangeStanding(profile).ok,
      /** The statuses it can be moved to: reopen, mark dormant, close. */
      statuses: manage ? statusChoices(profile) : [],
      openingBalance: ctx.can("accounts.manage"),
      statement: ctx.can("parties.ledger.view"),
    },
  };
}

export type PartyScreen = Awaited<ReturnType<typeof getPartyScreen>>;

/** What the new and edit forms need: the account (when editing) and what may change. */
export async function getPartyForm(ctx: CompanyContext, partyId?: string) {
  if (!partyId) return { party: null, kinds: KINDS, editable: null };
  const screen = await getPartyProfile(ctx, partyId);
  const balanceIsZero = Number(screen.balance) === 0;
  return {
    party: {
      id: screen.id,
      code: screen.code,
      name: screen.name,
      kind: screen.kind,
      buyerType: screen.buyerType,
      contactPerson: screen.contactPerson,
      phone: screen.phone,
      whatsapp: screen.whatsapp,
      email: screen.email,
      address: screen.address,
      city: screen.city,
      country: screen.country,
      taxId: screen.taxId,
      grade: screen.grade,
      creditLimit: screen.creditLimit?.toFixed(2) ?? null,
      paymentTermsDays: screen.paymentTermsDays,
      notes: screen.notes,
      status: screen.status,
      isWalkIn: isWalkIn(screen),
    },
    /** Buyer, supplier or both: narrowing needs a zero balance (parties/rules.ts). */
    kinds: KINDS.filter((to) => canChangeKind(screen.kind, to, balanceIsZero).ok),
    /** The fields that may change, or null for all of them. */
    editable: isWalkIn(screen) ? WALK_IN_EDITABLE : null,
  };
}

export type PartyForm = Awaited<ReturnType<typeof getPartyForm>>;

/** Transactions a statement shows on screen; the PDF holds them all. */
export const STATEMENT_SCREEN_LINES = 500;

/**
 * A statement on screen: the summary and the transactions with their running
 * balance for the days given (calendar days in company time, or the whole
 * account). Long statements show their latest transactions.
 */
export async function getStatementScreen(
  ctx: CompanyContext,
  partyId: string,
  range: { from?: string; to?: string } = {},
) {
  const statement = await getStatement(ctx, partyId, range);
  const tz = ctx.company.timezone;
  const hiddenCount = Math.max(0, statement.lines.length - STATEMENT_SCREEN_LINES);
  const shown = statement.lines.slice(hiddenCount);
  return {
    party: statement.party,
    from: range.from ?? null,
    to: range.to ?? null,
    today: localDay(new Date(), tz),
    summary: statement.summary,
    lines: shown.map((line, index) => ({
      id: `${line.entryId}:${hiddenCount + index}`,
      day: localDay(line.date, tz),
      number: line.number,
      details: line.description?.trim() || line.memo?.trim() || line.account,
      memo: line.description?.trim() && line.memo?.trim() ? line.memo.trim() : null,
      source: line.sourceType,
      debit: line.debit,
      credit: line.credit,
      balance: line.balance,
    })),
    /** Earlier transactions in the period left off the screen (the PDF has them). */
    hiddenCount,
    can: { print: ctx.can(PRINT_INFO.LEDGER_STATEMENT.permission) },
  };
}

export type StatementScreen = Awaited<ReturnType<typeof getStatementScreen>>;

/**
 * The Dues tab: what buyers owe the company and what it owes suppliers, with
 * every account that has a balance, largest first.
 */
export async function getDuesScreen(ctx: CompanyContext) {
  const overview = await getReceivablesPayables(ctx);
  const tz = ctx.company.timezone;
  const walkIn = await ctx.db.party.findFirst({
    where: { systemRole: "WALK_IN" },
    select: { id: true },
  });
  const listed = [...overview.receivables, ...overview.payables];
  const walkInListed = listed.some((row) => row.partyId === walkIn?.id);
  const walkInLast = walkInListed ? await walkInLastSale(ctx) : null;
  const present = (row: (typeof overview.receivables)[number]) => {
    const last = row.partyId === walkIn?.id ? walkInLast : row.lastTransactionAt;
    return {
      id: row.partyId,
      code: row.code,
      name: row.name,
      kind: row.kind as PartyKind,
      grade: row.grade as PartyGrade | null,
      status: row.status as PartyStatus,
      lastTransactionOn: last ? localDay(last, tz) : null,
      amount: row.balance,
    };
  };
  return {
    totalReceivable: overview.totalReceivable,
    totalPayable: overview.totalPayable,
    receivables: overview.receivables.map(present),
    payables: overview.payables.map(present),
  };
}

export type DuesScreen = Awaited<ReturnType<typeof getDuesScreen>>;
export type DuesRow = DuesScreen["receivables"][number];
