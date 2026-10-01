import type { JournalSource } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { AppError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import type { CompanyContext } from "@/modules/auth/context";
import * as campaigns from "@/modules/parties/campaign.service";
import * as dormant from "@/modules/parties/dormant.service";
import * as ledger from "@/modules/parties/ledger.service";
import * as parties from "@/modules/parties/party.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

async function setup(companyName = "Extras") {
  const { company, roles } = await makeCompany(companyName);
  const user = await makeUser(`admin@${company.slug}.test`);
  await addToCompany(user.id, company.id, roles.SUPER_ADMIN);
  const ctx = await contextFor(user.id, company.id);
  const control = await ensureControlAccounts(company.id);
  return { ctx, company, user, roles, accounts: { ...control, PURCHASES: control.COGS } };
}

type Env = Awaited<ReturnType<typeof setup>>;

/** Posts a journal entry the way the Sales / Purchasing / Accounts modules will. */
async function post(
  env: Env,
  date: string | Date,
  sourceType: JournalSource,
  lines: Array<{ accountId: string; partyId?: string; debit?: number; credit?: number }>,
) {
  return prisma.journalEntry.create({
    data: {
      companyId: env.company.id,
      number: await nextDocumentNumber(prisma, env.company.id, "JOURNAL_VOUCHER"),
      date: new Date(date),
      sourceType,
      lines: { create: lines.map((l) => ({ ...l, debit: l.debit ?? 0, credit: l.credit ?? 0 })) },
    },
  });
}

/** Invoice to a buyer: Dr Receivable (party) / Cr Sales. */
const invoice = (env: Env, partyId: string, amount: number, date: string | Date) =>
  post(env, date, "SALE", [
    { accountId: env.accounts.RECEIVABLE, partyId, debit: amount },
    { accountId: env.accounts.SALES, credit: amount },
  ]);

/** Payment from a buyer: Dr Cash / Cr Receivable (party). */
const receipt = (env: Env, partyId: string, amount: number, date: string | Date) =>
  post(env, date, "PAYMENT", [
    { accountId: env.accounts.CASH, debit: amount },
    { accountId: env.accounts.RECEIVABLE, partyId, credit: amount },
  ]);

/** Supplier bill: Dr Purchases / Cr Payable (party). */
const bill = (env: Env, partyId: string, amount: number, date: string | Date) =>
  post(env, date, "SUPPLIER_BILL", [
    { accountId: env.accounts.PURCHASES, debit: amount },
    { accountId: env.accounts.PAYABLE, partyId, credit: amount },
  ]);

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

const buyer = (ctx: CompanyContext, name: string, extra: Record<string, unknown> = {}) =>
  parties.createParty(ctx, { kind: "BUYER", name, ...extra }).then((r) => r.party);
const supplier = (ctx: CompanyContext, name: string, extra: Record<string, unknown> = {}) =>
  parties.createParty(ctx, { kind: "SUPPLIER", name, ...extra }).then((r) => r.party);

run("buyer & supplier profiles", () => {
  beforeEach(resetDb);

  it("numbers buyers and suppliers separately and flags possible duplicates", async () => {
    const { ctx } = await setup();
    const { party: rahim } = await parties.createParty(ctx, {
      kind: "BUYER",
      name: "Rahim Traders",
      phone: "01711223344",
      email: "Rahim@Traders.test",
    });
    expect(rahim).toMatchObject({
      code: "BUY-0001",
      buyerType: "WHOLESALE",
      country: "Bangladesh",
    });

    const fabrics = await supplier(ctx, "Dhaka Fabrics", { buyerType: undefined });
    expect(fabrics).toMatchObject({ code: "SUP-0001", buyerType: null });

    const second = await parties.createParty(ctx, {
      kind: "BUYER",
      name: "Rahim Fashion House",
      whatsapp: "01711223344",
    });
    expect(second.party.code).toBe("BUY-0002");
    expect(second.possibleDuplicates.map((d) => d.code)).toEqual(["BUY-0001"]);

    const byEmail = await parties.createParty(ctx, {
      kind: "BOTH",
      name: "Rahim Group",
      email: "rahim@traders.test",
    });
    expect(byEmail.party.code).toBe("BS-0001");
    expect(byEmail.possibleDuplicates.map((d) => d.code)).toEqual(["BUY-0001"]);

    await expectAppError(
      parties.createParty(ctx, { kind: "BUYER", name: "Copy", code: "buy-0001" }),
      "CONFLICT",
    );
  });

  it("gives unique codes when several buyers are added at the same moment", async () => {
    const { ctx } = await setup();
    const created = await Promise.all(
      ["Alpha", "Bravo", "Charlie", "Delta", "Echo"].map((n) => buyer(ctx, `${n} Traders`)),
    );
    expect(new Set(created.map((p) => p.code)).size).toBe(5);
  });

  it("filters the list by type, grade, badge and search, with balances", async () => {
    const env = await setup();
    const { ctx } = env;
    const a = await buyer(ctx, "Arif Garments", { grade: "A_PLUS", city: "Dhaka" });
    await buyer(ctx, "Bina Retail", { buyerType: "RETAIL", phone: "01811000000" });
    const both = await parties.createParty(ctx, { kind: "BOTH", name: "Chattogram Knit" });
    await supplier(ctx, "Dyeing House");
    await parties.setPartyVerified(ctx, a.id, { isVerified: true });
    await invoice(env, a.id, 2500, "2026-05-01");

    const buyers = await parties.listParties(ctx, { kind: "BUYER" });
    expect(buyers.items.map((p) => p.name)).toEqual([
      "Arif Garments",
      "Bina Retail",
      "Chattogram Knit",
    ]);
    expect(buyers.items[0]!.balance).toBe("2500.00");

    const suppliers = await parties.listParties(ctx, { kind: "SUPPLIER" });
    expect(suppliers.items.map((p) => p.name)).toEqual(["Chattogram Knit", "Dyeing House"]);

    expect((await parties.listParties(ctx, { grade: "A_PLUS" })).items.map((p) => p.id)).toEqual([
      a.id,
    ]);
    expect((await parties.listParties(ctx, { verified: "true" })).items.map((p) => p.id)).toEqual([
      a.id,
    ]);
    expect((await parties.listParties(ctx, { verified: "false" })).items).toHaveLength(3);
    expect((await parties.listParties(ctx, { search: "0181" })).items[0]!.name).toBe("Bina Retail");
    expect(
      (await parties.listParties(ctx, { withBalance: "true" })).items.map((p) => p.id),
    ).toEqual([a.id]);
    expect((await parties.listParties(ctx, { buyerType: "RETAIL" })).items).toHaveLength(1);
    expect(both.party.buyerType).toBe("WHOLESALE");

    const page1 = await parties.listParties(ctx, { take: 2 });
    const page2 = await parties.listParties(ctx, { take: 2, cursor: page1.nextCursor });
    expect([...page1.items, ...page2.items].map((p) => p.name)).toHaveLength(4);
    expect(page2.nextCursor).toBeUndefined();
  });

  it("edits details, but only switches buyer/supplier when nothing is owed", async () => {
    const env = await setup();
    const { ctx } = env;
    const p = await buyer(ctx, "Karim Store", { grade: "B" });
    const { party: updated } = await parties.updateParty(ctx, p.id, {
      kind: "SUPPLIER",
      phone: "01999000111",
    });
    expect(updated).toMatchObject({ kind: "SUPPLIER", buyerType: null, phone: "01999000111" });

    const q = await buyer(ctx, "Owing Buyer");
    await invoice(env, q.id, 1000, "2026-06-01");
    await expectAppError(parties.updateParty(ctx, q.id, { kind: "SUPPLIER" }), "CONFLICT");
    const { party: both } = await parties.updateParty(ctx, q.id, { kind: "BOTH" });
    expect(both.kind).toBe("BOTH");
    await expectAppError(
      parties.updateParty(ctx, updated.id, { buyerType: "RETAIL" }),
      "VALIDATION",
    );

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: p.id, action: "UPDATE" },
    });
    expect(audit?.summary).toContain("kind");
  });

  it("sets grades and the Blue Verified badge with an audit trail", async () => {
    const { ctx } = await setup();
    const p = await buyer(ctx, "Nahar Fashion");
    expect((await parties.setPartyGrade(ctx, p.id, { grade: "A_PLUS" })).grade).toBe("A_PLUS");
    const verified = await parties.setPartyVerified(ctx, p.id, { isVerified: true });
    expect(verified.isVerified).toBe(true);
    expect(verified.verifiedAt).toBeInstanceOf(Date);
    const removed = await parties.setPartyVerified(ctx, p.id, { isVerified: false });
    expect(removed.verifiedAt).toBeNull();
    await expect(parties.setPartyGrade(ctx, p.id, { grade: "D" })).rejects.toMatchObject({
      name: "ZodError",
    });

    const summaries = (
      await prisma.auditLog.findMany({
        where: { entityId: p.id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      })
    ).map((a) => a.summary);
    expect(summaries).toEqual([
      expect.stringContaining("Created buyer"),
      "Grade of BUY-0001: none → A_PLUS",
      "Verified BUY-0001",
      "Removed verified badge from BUY-0001",
    ]);
  });

  it("builds the 360° profile with balance, credit headroom and activity", async () => {
    const env = await setup();
    const p = await buyer(env.ctx, "Profile Buyer", { creditLimit: 50000 });
    await invoice(env, p.id, 20000, "2026-07-01");
    await parties.recordPartyActivity(p.id, new Date("2026-07-01"));
    const profile = await parties.getPartyProfile(env.ctx, p.id);
    expect(profile).toMatchObject({
      balance: "20000.00",
      position: "RECEIVABLE",
      creditAvailable: "30000.00",
      counts: { quotations: 0, orders: 0, invoices: 0, supplierBills: 0 },
      lastPayment: null,
    });
    expect(profile.daysInactive).toBeGreaterThanOrEqual(0);
    await expectAppError(parties.getPartyProfile(env.ctx, "missing"), "NOT_FOUND");
  });
});

run("ledger, statements and opening balances", () => {
  beforeEach(resetDb);

  it("produces a statement with a running balance and a page-1 summary", async () => {
    const env = await setup();
    const { ctx } = env;
    const p = await buyer(ctx, "Statement Buyer");
    const opening = await ledger.setOpeningBalance(ctx, p.id, { amount: 5000, asOf: "2026-01-01" });
    expect(opening.balance).toBe("5000.00");
    await invoice(env, p.id, 12000, "2026-02-10");
    await receipt(env, p.id, 7000, "2026-03-05");

    const lifetime = await ledger.getStatement(ctx, p.id);
    expect(lifetime.lines.map((l) => [l.sourceType, l.debit, l.credit, l.balance])).toEqual([
      ["OPENING_BALANCE", "5000.00", "0.00", "5000.00"],
      ["SALE", "12000.00", "0.00", "17000.00"],
      ["PAYMENT", "0.00", "7000.00", "10000.00"],
    ]);
    expect(lifetime.summary).toEqual({
      openingBalance: "0.00",
      totalDebit: "17000.00",
      totalCredit: "7000.00",
      closingBalance: "10000.00",
      position: "RECEIVABLE",
      transactionCount: 3,
    });
    expect(lifetime.company.name).toBe("Extras");
    expect(lifetime.lines[0]!.number).toMatch(/^JV-\d{4}-\d{5}$/);

    const range = await ledger.getStatement(ctx, p.id, { from: "2026-02-01", to: "2026-02-28" });
    expect(range.summary).toMatchObject({
      openingBalance: "5000.00",
      totalDebit: "12000.00",
      closingBalance: "17000.00",
      transactionCount: 1,
    });
    await expectAppError(
      ledger.getStatement(ctx, p.id, { from: "2026-03-01", to: "2026-02-01" }),
      "VALIDATION",
    );
  });

  it("cuts statement periods at midnight company time (Dhaka)", async () => {
    const env = await setup();
    const p = await buyer(env.ctx, "Late Night Buyer");
    await invoice(env, p.id, 100, "2026-02-28T20:00:00+06:00"); // last evening of February
    await invoice(env, p.id, 200, "2026-03-01T03:00:00+06:00"); // early 1 March (still Feb in UTC)
    const feb = await ledger.getStatement(env.ctx, p.id, { from: "2026-02-01", to: "2026-02-28" });
    expect(feb.lines.map((l) => l.debit)).toEqual(["100.00"]);
    const march = await ledger.getStatement(env.ctx, p.id, { from: "2026-03-01" });
    expect(march.summary).toMatchObject({ openingBalance: "100.00", closingBalance: "300.00" });
    expect(march.period).toEqual({ from: "2026-03-01", to: null, timezone: "Asia/Dhaka" });
    await expect(ledger.getStatement(env.ctx, p.id, { from: "2026-02-30" })).rejects.toMatchObject({
      name: "ZodError",
    });
  });

  it("replaces the opening balance when it is set again", async () => {
    const env = await setup();
    const p = await buyer(env.ctx, "Reset Buyer");
    await ledger.setOpeningBalance(env.ctx, p.id, { amount: 5000 });
    const again = await ledger.setOpeningBalance(env.ctx, p.id, { amount: 6000.5 });
    expect(again.balance).toBe("6000.50");
    expect(
      await prisma.journalEntry.count({ where: { sourceType: "OPENING_BALANCE", sourceId: p.id } }),
    ).toBe(1);
    expect(
      (await prisma.party.findUnique({ where: { id: p.id } }))!.openingBalance.toFixed(2),
    ).toBe("6000.50");
    const cleared = await ledger.setOpeningBalance(env.ctx, p.id, { amount: 0 });
    expect(cleared.balance).toBe("0.00");
    expect(await prisma.journalEntry.count({ where: { sourceId: p.id } })).toBe(0);
  });

  it("books negative openings to Payables for suppliers and Advances for buyers", async () => {
    const env = await setup();
    const s = await supplier(env.ctx, "Thread Supplier");
    const b = await buyer(env.ctx, "Advance Buyer");
    await expectAppError(ledger.setOpeningBalance(env.ctx, s.id, { amount: 100 }), "VALIDATION");
    await ledger.setOpeningBalance(env.ctx, s.id, { amount: -3000 });
    await ledger.setOpeningBalance(env.ctx, b.id, { amount: -1000 });
    const partyLine = (partyId: string) =>
      prisma.journalLine.findFirstOrThrow({ where: { partyId }, include: { account: true } });
    expect((await partyLine(s.id)).account.subType).toBe("ACCOUNTS_PAYABLE");
    expect((await partyLine(b.id)).account.subType).toBe("CUSTOMER_ADVANCE");

    // Every opening voucher balances.
    const lines = await prisma.journalLine.findMany({
      where: { entry: { companyId: env.company.id } },
    });
    const debit = lines.reduce((sum, l) => sum + Number(l.debit), 0);
    const credit = lines.reduce((sum, l) => sum + Number(l.credit), 0);
    expect(debit).toBe(credit);
  });

  it("totals what the market owes us and what we owe suppliers", async () => {
    const env = await setup();
    const { ctx } = env;
    const a = await buyer(ctx, "Big Buyer");
    const b = await buyer(ctx, "Small Buyer");
    const c = await buyer(ctx, "Prepaid Buyer");
    const s = await supplier(ctx, "Fabric Mill");
    await buyer(ctx, "Settled Buyer");
    await invoice(env, a.id, 30000, "2026-04-01");
    await receipt(env, a.id, 5000, "2026-04-20");
    await invoice(env, b.id, 4000, "2026-05-01");
    await ledger.setOpeningBalance(ctx, c.id, { amount: -1500 });
    await bill(env, s.id, 8000, "2026-05-10");

    const overview = await ledger.getReceivablesPayables(ctx);
    expect(overview).toMatchObject({
      totalReceivable: "29000.00",
      totalPayable: "9500.00",
      receivableCount: 2,
      payableCount: 2,
    });
    expect(overview.receivables.map((r) => [r.name, r.balance])).toEqual([
      ["Big Buyer", "25000.00"],
      ["Small Buyer", "4000.00"],
    ]);
    expect(overview.payables.map((r) => [r.name, r.balance])).toEqual([
      ["Fabric Mill", "8000.00"],
      ["Prepaid Buyer", "1500.00"],
    ]);
  });
});

run("account status and trading guard", () => {
  beforeEach(resetDb);

  it("moves a closing account with dues to SETTLING, then closes it once settled", async () => {
    const env = await setup();
    const { ctx } = env;
    const p = await buyer(ctx, "Closing Buyer");
    await invoice(env, p.id, 9000, "2026-06-01");
    const result = await parties.changePartyStatus(ctx, p.id, {
      status: "CLOSED",
      reason: "Shop closed",
    });
    expect(result.party.status).toBe("SETTLING");
    expect(result.note).toContain("9000.00");
    await expectAppError(parties.assertPartyCanTransact(ctx, p.id, "SALE"), "CONFLICT");

    expect((await dormant.refreshPartyStatuses(ctx)).closed).toBe(0);
    await receipt(env, p.id, 9000, "2026-06-20");
    const refresh = await dormant.refreshPartyStatuses(ctx);
    expect(refresh).toMatchObject({ closed: 1, closedCodes: [p.code] });
    expect((await prisma.party.findUnique({ where: { id: p.id } }))!.status).toBe("CLOSED");

    const q = await buyer(ctx, "Clean Buyer");
    expect((await parties.changePartyStatus(ctx, q.id, { status: "CLOSED" })).party.status).toBe(
      "CLOSED",
    );
    const s = await supplier(ctx, "Some Supplier");
    await expectAppError(parties.changePartyStatus(ctx, s.id, { status: "DORMANT" }), "VALIDATION");
  });

  it("checks party type, status and credit limit before new business", async () => {
    const env = await setup();
    const { ctx } = env;
    const b = await buyer(ctx, "Limited Buyer", { creditLimit: 10000 });
    const s = await supplier(ctx, "Button Supplier");
    const both = (await parties.createParty(ctx, { kind: "BOTH", name: "Two Way Ltd" })).party;

    await expectAppError(parties.assertPartyCanTransact(ctx, s.id, "SALE"), "VALIDATION");
    await expectAppError(parties.assertPartyCanTransact(ctx, b.id, "PURCHASE"), "VALIDATION");
    await expect(parties.assertPartyCanTransact(ctx, both.id, "SALE")).resolves.toBeTruthy();
    await expect(parties.assertPartyCanTransact(ctx, both.id, "PURCHASE")).resolves.toBeTruthy();

    await invoice(env, b.id, 7000, "2026-06-01");
    await expect(parties.assertPartyCanTransact(ctx, b.id, "SALE", 3000)).resolves.toBeTruthy();
    const err = await expectAppError(
      parties.assertPartyCanTransact(ctx, b.id, "SALE", 3000.01),
      "CONFLICT",
    );
    expect(err.message).toContain("Credit limit exceeded");
  });
});

run("dormant buyers and re-engagement campaigns", () => {
  beforeEach(resetDb);

  /** Buyers last active 2, 8 and 14 months ago, plus a retail buyer and a supplier. */
  async function dormantSetup() {
    const env = await setup();
    const { ctx } = env;
    const make = async (name: string, monthsIdle: number, extra: Record<string, unknown> = {}) => {
      const p = await buyer(ctx, name, extra);
      await prisma.party.update({
        where: { id: p.id },
        data: {
          lastTransactionAt: dormant.monthsAgo(monthsIdle),
          createdAt: dormant.monthsAgo(30),
        },
      });
      return p;
    };
    const recent = await make("Recent Wholesale", 2, { whatsapp: "01700000001" });
    const eight = await make("Eight Month Wholesale", 8, {
      whatsapp: "01700000002",
      contactPerson: "Sumi",
      email: "sumi@eight.test",
    });
    const fourteen = await make("Fourteen Month Corporate", 14, {
      buyerType: "B2B_CORPORATE",
      phone: "+8801700000003",
    });
    const retail = await make("Old Retail", 9, { buyerType: "RETAIL", phone: "01700000004" });
    const noPhone = await make("No Phone Wholesale", 7);
    const never = await buyer(ctx, "Never Ordered");
    await prisma.party.update({
      where: { id: never.id },
      data: { createdAt: dormant.monthsAgo(13) },
    });
    const s = await supplier(ctx, "Idle Supplier");
    await prisma.party.update({
      where: { id: s.id },
      data: { lastTransactionAt: dormant.monthsAgo(20) },
    });
    return { ...env, recent, eight, fourteen, retail, noPhone, never, supplier: s };
  }

  it("filters dormant B2B buyers by 6 or 12 months of inactivity", async () => {
    const env = await dormantSetup();
    const six = await dormant.listDormantBuyers(env.ctx); // company default: 6 months
    expect(six.months).toBe(6);
    expect(six.items.map((p) => p.name)).toEqual([
      "Never Ordered",
      "Fourteen Month Corporate",
      "Eight Month Wholesale",
      "No Phone Wholesale",
    ]);
    expect(six.items[1]!.daysInactive).toBeGreaterThan(400);

    const twelve = await dormant.listDormantBuyers(env.ctx, { months: "12" });
    expect(twelve.items.map((p) => p.name)).toEqual(["Never Ordered", "Fourteen Month Corporate"]);

    const retail = await dormant.listDormantBuyers(env.ctx, { months: 6, buyerTypes: "RETAIL" });
    expect(retail.items.map((p) => p.name)).toEqual(["Old Retail"]);
  });

  it("marks idle buyers dormant and wakes them on new business", async () => {
    const env = await dormantSetup();
    const refresh = await dormant.refreshPartyStatuses(env.ctx);
    expect(refresh.markedDormant).toBe(5); // all buyer types; suppliers never go dormant
    expect(refresh.dormantCodes).not.toContain(env.recent.code);
    expect(refresh.dormantCodes).not.toContain(env.supplier.code);
    expect((await dormant.refreshPartyStatuses(env.ctx)).markedDormant).toBe(0);

    const statusOf = async (id: string) =>
      (await prisma.party.findUniqueOrThrow({ where: { id } })).status;
    expect(await statusOf(env.eight.id)).toBe("DORMANT");

    // A sale backdated before the last activity does not move the date backwards.
    const before = (await prisma.party.findUniqueOrThrow({ where: { id: env.eight.id } }))
      .lastTransactionAt!;
    await parties.recordPartyActivity(env.eight.id, dormant.monthsAgo(10));
    expect(
      (await prisma.party.findUniqueOrThrow({ where: { id: env.eight.id } })).lastTransactionAt,
    ).toEqual(before);
    await parties.recordPartyActivity(env.eight.id);
    expect(await statusOf(env.eight.id)).toBe("ACTIVE");
    // Still listed as dormant B2B? No: they just traded.
    const list = await dormant.listDormantBuyers(env.ctx);
    expect(list.items.map((p) => p.id)).not.toContain(env.eight.id);

    const audit = await prisma.auditLog.findFirst({
      where: { summary: { startsWith: "Status refresh" } },
    });
    expect(audit?.summary).toContain("5 buyer(s) marked dormant");
  });

  it("creates a WhatsApp campaign with personalised one-click links", async () => {
    const env = await dormantSetup();
    const { ctx } = env;
    const created = await campaigns.createCampaign(ctx, {
      name: "Eid restock",
      inactivityMonths: 6,
      channel: "WHATSAPP",
      message: "Assalamu alaikum {ContactPerson}! {CompanyName} has new Eid stock for {BuyerName}.",
      catalogFileUrl: "https://extras.example/catalog/eid.pdf",
    });
    expect(created.recipientCount).toBe(2); // Eight Month + Fourteen Month
    expect(created.skipped.map((s) => s.name).sort()).toEqual([
      "Never Ordered",
      "No Phone Wholesale",
    ]);
    expect(created.campaign.status).toBe("DRAFT");

    const detail = await campaigns.getCampaign(ctx, created.campaign.id);
    const eight = detail.recipients.find((r) => r.party.id === env.eight.id)!;
    expect(eight.message).toBe(
      "Assalamu alaikum Sumi! Extras has new Eid stock for Eight Month Wholesale.\n\nhttps://extras.example/catalog/eid.pdf",
    );
    expect(eight.link).toBe(
      `https://wa.me/8801700000002?text=${encodeURIComponent(eight.message)}`,
    );
    const corp = detail.recipients.find((r) => r.party.id === env.fourteen.id)!;
    expect(corp.message.startsWith("Assalamu alaikum Fourteen Month Corporate!")).toBe(true);
    expect(corp.link).toContain("https://wa.me/8801700000003?text=");

    // Work through the list.
    await campaigns.updateRecipientStatus(ctx, created.campaign.id, eight.id, { status: "SENT" });
    await campaigns.updateRecipientStatus(ctx, created.campaign.id, eight.id, {
      status: "READ",
      responded: true,
    });
    await campaigns.updateRecipientStatus(ctx, created.campaign.id, corp.id, {
      status: "FAILED",
      error: "Number not on WhatsApp",
    });
    const [summary] = await campaigns.listCampaigns(ctx);
    expect(summary).toMatchObject({
      status: "SENDING",
      recipients: 2,
      responded: 1,
      delivery: { PENDING: 0, READ: 1, FAILED: 1 },
    });

    const done = await campaigns.completeCampaign(ctx, created.campaign.id);
    expect(done.status).toBe("SENT");
    expect(done.sentAt).toBeInstanceOf(Date);
    await expectAppError(campaigns.completeCampaign(ctx, created.campaign.id), "CONFLICT");
    await expectAppError(campaigns.cancelCampaign(ctx, created.campaign.id), "CONFLICT");
  });

  it("builds email campaigns for chosen buyers and rejects non-buyers", async () => {
    const env = await dormantSetup();
    const { ctx } = env;
    await expectAppError(
      campaigns.createCampaign(ctx, {
        name: "Mixed",
        inactivityMonths: 6,
        channel: "EMAIL",
        message: "Hello {BuyerName}",
        partyIds: [env.eight.id, env.supplier.id],
      }),
      "VALIDATION",
    );
    await expectAppError(
      campaigns.createCampaign(ctx, {
        name: "Nobody reachable",
        inactivityMonths: 6,
        channel: "EMAIL",
        message: "Hello {BuyerName}",
        partyIds: [env.fourteen.id],
      }),
      "VALIDATION",
    );
    const created = await campaigns.createCampaign(ctx, {
      name: "Autumn catalogue",
      inactivityMonths: 6,
      channel: "EMAIL",
      message: "Dear {ContactPerson}, see {CatalogLink}",
      catalogFileUrl: "https://extras.example/c.pdf",
      partyIds: [env.eight.id, env.fourteen.id],
    });
    expect(created.recipientCount).toBe(1);
    const [r] = (await campaigns.getCampaign(ctx, created.campaign.id)).recipients;
    expect(r!.message).toBe("Dear Sumi, see https://extras.example/c.pdf");
    expect(r!.link).toBe(
      `mailto:sumi@eight.test?subject=Autumn%20catalogue&body=${encodeURIComponent(r!.message)}`,
    );
    const cancelled = await campaigns.cancelCampaign(ctx, created.campaign.id);
    expect(cancelled.status).toBe("CANCELLED");
    await expectAppError(
      campaigns.updateRecipientStatus(ctx, created.campaign.id, r!.id, { status: "SENT" }),
      "CONFLICT",
    );
  });
});

run("company isolation", () => {
  beforeEach(resetDb);

  it("keeps each company's buyers, ledgers and campaigns apart", async () => {
    const extras = await setup("Extras");
    const other = await setup("Fabric Apparel");
    const p = await buyer(extras.ctx, "Private Buyer", { whatsapp: "01700000009" });
    await prisma.party.update({
      where: { id: p.id },
      data: { lastTransactionAt: dormant.monthsAgo(9) },
    });
    await invoice(extras, p.id, 4000, "2026-05-05");
    const campaign = await campaigns.createCampaign(extras.ctx, {
      name: "Only Extras",
      inactivityMonths: 6,
      channel: "WHATSAPP",
      message: "Hi {BuyerName}",
    });
    const [recipient] = (await campaigns.getCampaign(extras.ctx, campaign.campaign.id)).recipients;

    // Each company numbers its own buyers from 0001.
    expect((await buyer(other.ctx, "Their Buyer")).code).toBe("BUY-0001");
    expect((await parties.listParties(other.ctx)).items.map((x) => x.name)).toEqual([
      "Their Buyer",
    ]);
    await expectAppError(parties.getPartyProfile(other.ctx, p.id), "NOT_FOUND");
    await expectAppError(parties.updateParty(other.ctx, p.id, { name: "Hijack" }), "NOT_FOUND");
    await expectAppError(ledger.getStatement(other.ctx, p.id), "NOT_FOUND");
    await expectAppError(ledger.setOpeningBalance(other.ctx, p.id, { amount: 1 }), "NOT_FOUND");
    expect((await ledger.getReceivablesPayables(other.ctx)).totalReceivable).toBe("0.00");
    expect((await dormant.listDormantBuyers(other.ctx)).items).toHaveLength(0);
    expect(await campaigns.listCampaigns(other.ctx)).toHaveLength(0);
    await expectAppError(campaigns.getCampaign(other.ctx, campaign.campaign.id), "NOT_FOUND");
    await expectAppError(
      campaigns.updateRecipientStatus(other.ctx, campaign.campaign.id, recipient!.id, {
        status: "SENT",
      }),
      "NOT_FOUND",
    );
    await expectAppError(
      campaigns.createCampaign(other.ctx, {
        name: "Steal",
        inactivityMonths: 6,
        channel: "WHATSAPP",
        message: "Hi {BuyerName}",
        partyIds: [p.id],
      }),
      "VALIDATION",
    );
    expect((await dormant.refreshPartyStatuses(other.ctx)).markedDormant).toBe(0);
    expect((await prisma.party.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("ACTIVE");
  });
});

run("document numbering", () => {
  beforeEach(resetDb);

  it("hands out unique numbers under concurrency and restarts each year", async () => {
    const { company } = await setup();
    const numbers = await Promise.all(
      Array.from({ length: 20 }, () =>
        nextDocumentNumber(prisma, company.id, "JOURNAL_VOUCHER", new Date("2026-03-01")),
      ),
    );
    expect(new Set(numbers).size).toBe(20);
    expect([...numbers].sort().at(-1)).toBe("JV-2026-00020");
    expect(
      await nextDocumentNumber(prisma, company.id, "JOURNAL_VOUCHER", new Date("2027-01-02")),
    ).toBe("JV-2027-00001");
    expect(await nextDocumentNumber(prisma, company.id, "QUOTATION", new Date("2027-01-02"))).toBe(
      "QT-2027-00001",
    );
  });
});
