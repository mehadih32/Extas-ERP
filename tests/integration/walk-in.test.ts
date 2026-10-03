import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { PARTY_SUBTYPES } from "@/modules/accounts/chart";
import * as reports from "@/modules/accounts/reports.service";
import type { CompanyContext } from "@/modules/auth/context";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as stock from "@/modules/inventory/stock.service";
import * as styles from "@/modules/inventory/style.service";
import * as campaigns from "@/modules/parties/campaign.service";
import * as dormant from "@/modules/parties/dormant.service";
import * as ledger from "@/modules/parties/ledger.service";
import * as parties from "@/modules/parties/party.service";
import { ensureWalkInParty, WALK_IN_NOT_A_BUYER } from "@/modules/parties/walk-in";
import * as orders from "@/modules/sales/order.service";
import * as payments from "@/modules/sales/payment.service";
import * as quotations from "@/modules/sales/quotation.service";
import * as refunds from "@/modules/sales/refund.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/**
 * A company with a polo style (Navy / White x S M L, retail 1450), 10 pcs of
 * each SKU, a buyer and an Accounts user.
 */
async function setup(companyName = "Extras") {
  const { company, roles } = await makeCompany(companyName);
  const admin = await makeUser(`admin@${company.slug}.test`);
  await addToCompany(admin.id, company.id, roles.SUPER_ADMIN);
  const ctx = await contextFor(admin.id, company.id);
  const accountant = await makeUser(`accounts@${company.slug}.test`);
  await addToCompany(accountant.id, company.id, roles.ACCOUNTS);
  const accountsCtx = await contextFor(accountant.id, company.id);

  const sizes = [];
  for (const name of ["S", "M", "L"]) sizes.push(await catalog.createSize(ctx, { name }));
  const navy = await catalog.createColor(ctx, { name: "Navy", hexCode: "#1f2a44" });
  const white = await catalog.createColor(ctx, { name: "White", hexCode: "#FFFFFF" });
  const tops = await catalog.createCategory(ctx, { name: "Tops" });
  const style = await styles.createStyle(ctx, {
    code: "EX-PL-001",
    name: "Classic Polo",
    categoryId: tops.id,
    retailPrice: 1450,
    wholesalePrice: 900,
  });
  await matrix.generateMatrix(ctx, style.id, {
    colorIds: [navy.id, white.id],
    sizeIds: sizes.map((s) => s.id),
  });
  const variants = await prisma.productVariant.findMany({
    where: { styleId: style.id },
    include: { color: true, size: true },
  });
  const sku = (color: string, size: string) =>
    variants.find((v) => v.color.name === color && v.size.name === size)!.id;
  for (const v of variants) {
    await stock.adjustStock(ctx, { variantId: v.id, quantity: 10, type: "OPENING", unitCost: 500 });
  }
  const buyer = (
    await parties.createParty(ctx, { kind: "BUYER", name: "Rahim Traders", phone: "01711223344" })
  ).party;
  return { ctx, accountsCtx, company, tops, style, sku, buyer };
}

type Env = Awaited<ReturnType<typeof setup>>;

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

async function expectBooksOk(ctx: CompanyContext) {
  const check = await reports.getBooksCheck(ctx);
  expect(check.checks.filter((c) => !c.ok)).toEqual([]);
  expect(check.ok).toBe(true);
}

/** The company's Walk-in customers accounts (there should only ever be one). */
const walkInAccounts = (companyId: string) =>
  prisma.party.findMany({ where: { companyId, systemRole: "WALK_IN" } });

/** Receivable, payable and advance lines naming no account. */
const untaggedLines = (companyId: string) =>
  prisma.journalLine.count({
    where: {
      partyId: null,
      entry: { companyId },
      account: { subType: { in: [...PARTY_SUBTYPES] } },
    },
  });

/** Cash at the counter for two White M polos: 2,900 taka, invoiced and paid. */
const counterSale = (env: Env) =>
  orders.createOrder(env.ctx, {
    channel: "POS",
    customerName: "Karim Uddin",
    lines: [{ variantId: env.sku("White", "M"), quantity: 2 }],
    payment: { amount: 2900, method: "CASH" },
  });

/** A website order for one White L polo (1,450 taka), invoiced and not paid yet. */
const websiteSale = (env: Env) =>
  orders.createOrder(env.ctx, {
    channel: "WEBSITE",
    customerName: "Nusrat Jahan",
    customerPhone: "01811000000",
    shippingAddress: "House 12, Road 5, Dhanmondi, Dhaka",
    lines: [{ variantId: env.sku("White", "L"), quantity: 1 }],
  });

/** A Facebook order for two Navy S polos (2,900 taka), not invoiced, with a 500 taka bKash advance. */
async function socialSaleWithAdvance(env: Env) {
  const order = await orders.createOrder(env.ctx, {
    channel: "SOCIAL_COMMERCE",
    customerName: "Sadia Islam",
    customerPhone: "01911000000",
    lines: [{ variantId: env.sku("Navy", "S"), quantity: 2 }],
    documents: { invoice: false },
  });
  await payments.receivePayment(env.accountsCtx, {
    orderId: order.id,
    amount: 500,
    method: "BKASH",
  });
  return order;
}

run("walk-in customers in the books", () => {
  beforeEach(resetDb);

  it("puts every sale without a buyer on the Walk-in customers account, so the books check passes", async () => {
    const env = await setup();
    expect(await walkInAccounts(env.company.id)).toEqual([]);

    const counter = await counterSale(env);
    const website = await websiteSale(env);
    const social = await socialSaleWithAdvance(env);
    expect([counter.total, website.total, social.total].map((t) => t.toFixed(2))).toEqual([
      "2900.00",
      "1450.00",
      "2900.00",
    ]);

    // The first walk-in sale made the account; the others used it.
    const [walkIn, ...more] = await walkInAccounts(env.company.id);
    expect(more).toEqual([]);
    expect(walkIn).toMatchObject({
      code: "WALK-IN",
      name: "Walk-in customers",
      kind: "BUYER",
      buyerType: "RETAIL",
      status: "ACTIVE",
    });
    expect(await untaggedLines(env.company.id)).toBe(0);
    await expectBooksOk(env.accountsCtx);

    // The orders, invoices and payments still have no buyer; the customer stays on the order.
    expect(await prisma.salesOrder.count({ where: { partyId: { not: null } } })).toBe(0);
    expect(await prisma.invoice.count({ where: { partyId: { not: null } } })).toBe(0);
    expect(await prisma.payment.count({ where: { partyId: { not: null } } })).toBe(0);
    expect((await orders.getOrder(env.ctx, website.id)).customerName).toBe("Nusrat Jahan");

    // The website customer owes 1,450 and the Facebook customer paid 500 ahead.
    expect((await ledger.getPartyBalance(env.ctx, walkIn!.id)).toFixed(2)).toBe("950.00");
    const overview = await ledger.getReceivablesPayables(env.accountsCtx);
    expect(overview.receivables).toEqual([
      expect.objectContaining({
        partyId: walkIn!.id,
        name: "Walk-in customers",
        balance: "950.00",
      }),
    ]);
    expect(overview.totalReceivable).toBe("950.00");

    const statement = await ledger.getStatement(env.accountsCtx, walkIn!.id);
    expect(statement.lines.map((l) => [l.account, l.debit, l.credit, l.balance])).toEqual([
      ["Accounts Receivable (Buyers)", "2900.00", "0.00", "2900.00"],
      ["Accounts Receivable (Buyers)", "0.00", "2900.00", "0.00"],
      ["Accounts Receivable (Buyers)", "1450.00", "0.00", "1450.00"],
      ["Customer Advances", "0.00", "500.00", "950.00"],
    ]);
    expect(statement.summary).toMatchObject({
      closingBalance: "950.00",
      position: "RECEIVABLE",
      transactionCount: 4,
    });

    // Its profile counts the sales without a buyer.
    const profile = await parties.getPartyProfile(env.ctx, walkIn!.id);
    expect(profile).toMatchObject({
      balance: "950.00",
      position: "RECEIVABLE",
      counts: { quotations: 0, orders: 3, invoices: 2 },
    });
    expect(profile.lastPayment?.amount.toFixed(2)).toBe("500.00");

    // Cancelling the paid counter sale voids its invoice and pays the cash back: still on the account.
    const cancelled = await orders.cancelOrder(env.ctx, counter.id, {
      reason: "Wrong size",
      settle: { kind: "CASH", method: "CASH" },
    });
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.refunds.map((r) => [r.kind, r.amount.toFixed(2)])).toEqual([
      ["CASH", "2900.00"],
    ]);
    expect((await refunds.getRefund(env.ctx, cancelled.refunds[0]!.id)).partyId).toBeNull();
    expect(await untaggedLines(env.company.id)).toBe(0);
    expect((await ledger.getPartyBalance(env.ctx, walkIn!.id)).toFixed(2)).toBe("950.00");
    await expectBooksOk(env.accountsCtx);

    // A buyer's sales stay on the buyer's own account.
    await orders.createOrder(env.ctx, {
      channel: "WHOLESALE",
      partyId: env.buyer.id,
      lines: [{ variantId: env.sku("Navy", "M"), quantity: 2 }],
    });
    expect((await ledger.getPartyBalance(env.ctx, env.buyer.id)).toFixed(2)).toBe("1800.00");
    expect((await ledger.getPartyBalance(env.ctx, walkIn!.id)).toFixed(2)).toBe("950.00");
    expect(await walkInAccounts(env.company.id)).toHaveLength(1);
    await expectBooksOk(env.accountsCtx);
  });

  it("keeps the Walk-in customers account for the books only", async () => {
    const env = await setup();
    await counterSale(env);
    const [walkIn] = await walkInAccounts(env.company.id);
    const id = walkIn!.id;

    // It is never a document's buyer.
    for (const channel of ["WHOLESALE", "POS"] as const) {
      const notBuyer = await expectAppError(
        orders.createOrder(env.ctx, {
          channel,
          partyId: id,
          lines: [{ variantId: env.sku("Navy", "M"), quantity: 1 }],
        }),
        "VALIDATION",
      );
      expect(notBuyer.message).toBe(WALK_IN_NOT_A_BUYER);
    }
    await expectAppError(
      quotations.createQuotation(env.ctx, {
        partyId: id,
        items: [
          {
            categoryId: env.tops.id,
            styleId: env.style.id,
            description: "Polo pre-order",
            sizeBreakdown: { S: 2, M: 2 },
            unitPrice: 1000,
          },
        ],
      }),
      "VALIDATION",
    );

    // Money is taken and paid back on the walk-in customer's order, never on the account.
    const onAccount = await expectAppError(
      payments.receivePayment(env.accountsCtx, { partyId: id, amount: 100, method: "CASH" }),
      "VALIDATION",
    );
    expect(onAccount.message).toBe("Take a walk-in customer's payment against their order.");
    const refundOnAccount = await expectAppError(
      refunds.refundBuyer(env.accountsCtx, {
        partyId: id,
        kind: "CASH",
        method: "CASH",
        amount: 100,
        reason: "Paid twice",
      }),
      "VALIDATION",
    );
    expect(refundOnAccount.message).toBe("A walk-in customer's money is refunded on their order.");

    // Only its name and notes can change; it stays an open, ungraded retail buyer account.
    for (const change of [
      { kind: "SUPPLIER" },
      { buyerType: "WHOLESALE" },
      { creditLimit: 5000 },
    ]) {
      const kept = await expectAppError(parties.updateParty(env.ctx, id, change), "VALIDATION");
      expect(kept.message).toBe(
        "Walk-in customers is kept by the system for sales without a buyer profile. Only its name and notes can change.",
      );
    }
    const renamed = await parties.updateParty(env.ctx, id, {
      name: "Counter and online customers",
      notes: "Sales without a buyer profile.",
    });
    expect(renamed.party).toMatchObject({
      name: "Counter and online customers",
      systemRole: "WALK_IN",
    });
    await expectAppError(
      parties.changePartyStatus(env.ctx, id, { status: "CLOSED", reason: "Not needed" }),
      "VALIDATION",
    );
    await expectAppError(parties.setPartyGrade(env.ctx, id, { grade: "A" }), "VALIDATION");
    await expectAppError(parties.setPartyVerified(env.ctx, id, { isVerified: true }), "VALIDATION");

    // It is listed with the buyers, marked as the system's account.
    const listed = await parties.listParties(env.ctx, { kind: "BUYER" });
    expect(listed.items.map((p) => [p.name, p.systemRole])).toEqual([
      ["Counter and online customers", "WALK_IN"],
      ["Rahim Traders", null],
    ]);

    // Dormant-buyer lists, the nightly status refresh and campaigns leave it out.
    const oldShop = (
      await parties.createParty(env.ctx, {
        kind: "BUYER",
        buyerType: "RETAIL",
        name: "Old Retail Shop",
        phone: "01722000000",
      })
    ).party;
    await prisma.party.updateMany({
      where: { id: { in: [id, oldShop.id] } },
      data: { createdAt: new Date("2024-01-01T00:00:00Z") },
    });
    const quiet = await dormant.listDormantBuyers(env.ctx, { months: 6, buyerTypes: "RETAIL" });
    expect(quiet.items.map((p) => p.name)).toEqual(["Old Retail Shop"]);
    const refreshed = await dormant.refreshPartyStatuses(env.ctx);
    expect(refreshed.dormantCodes).toEqual([oldShop.code]);
    expect((await prisma.party.findUniqueOrThrow({ where: { id } })).status).toBe("ACTIVE");
    const notRecipient = await expectAppError(
      campaigns.createCampaign(env.ctx, {
        name: "Eid offer",
        inactivityMonths: 6,
        channel: "WHATSAPP",
        message: "Hello {BuyerName}, our Eid collection is in.",
        partyIds: [id],
      }),
      "VALIDATION",
    );
    expect(notRecipient.message).toBe(
      "Some recipients are not open buyer accounts of this company.",
    );

    // The counter keeps selling on it.
    await counterSale(env);
    expect(await walkInAccounts(env.company.id)).toHaveLength(1);
    await expectBooksOk(env.accountsCtx);
  });

  it("makes one Walk-in customers account when first walk-in sales come at once", async () => {
    const env = await setup();
    const sales = await Promise.allSettled(
      ["S", "M", "L"].map((size) =>
        orders.createOrder(env.ctx, {
          channel: "POS",
          lines: [{ variantId: env.sku("White", size), quantity: 1 }],
          payment: { amount: 1450, method: "CASH" },
        }),
      ),
    );
    expect(sales.map((s) => s.status)).toEqual(["fulfilled", "fulfilled", "fulfilled"]);
    expect(await walkInAccounts(env.company.id)).toHaveLength(1);
    expect(await untaggedLines(env.company.id)).toBe(0);
    await expectBooksOk(env.accountsCtx);

    // Straight at the account in another company: each transaction keeps its new
    // row uncommitted for a moment, so the others run into it.
    const other = await setup("Second Shop");
    const ids = await Promise.all(
      [1, 2, 3, 4].map(() =>
        prisma.$transaction(async (tx) => {
          const walkInId = await ensureWalkInParty(other.company.id, tx);
          await tx.$executeRaw`SELECT pg_sleep(0.2)`;
          return walkInId;
        }),
      ),
    );
    const made = await walkInAccounts(other.company.id);
    expect(made.map((p) => p.code)).toEqual(["WALK-IN"]);
    expect(new Set(ids)).toEqual(new Set([made[0]!.id]));
  });

  it("names a free code when a buyer already uses WALK-IN", async () => {
    const env = await setup();
    await parties.createParty(env.ctx, { kind: "BUYER", code: "walk-in", name: "Walkin Fashion" });
    await websiteSale(env);
    const [walkIn] = await walkInAccounts(env.company.id);
    expect(walkIn).toMatchObject({ code: "WALK-IN-2", name: "Walk-in customers" });
    expect((await ledger.getPartyBalance(env.ctx, walkIn!.id)).toFixed(2)).toBe("1450.00");
    await expectBooksOk(env.accountsCtx);
  });

  it("puts walk-in sales made before this change on the account when the database is upgraded", async () => {
    // Walk-in sales from before the change, in a company that has a buyer coded WALK-IN
    // and one that sells only to buyers.
    const env = await setup();
    await counterSale(env);
    await websiteSale(env);
    await socialSaleWithAdvance(env);
    const coded = await setup("Second Shop");
    await parties.createParty(coded.ctx, {
      kind: "BUYER",
      code: "WALK-IN",
      name: "Walkin Fashion",
    });
    await websiteSale(coded);
    const buyersOnly = await setup("Third Shop");
    await orders.createOrder(buyersOnly.ctx, {
      channel: "WHOLESALE",
      partyId: buyersOnly.buyer.id,
      lines: [{ variantId: buyersOnly.sku("Navy", "M"), quantity: 2 }],
    });

    // The books as they were: no Walk-in customers account, and walk-in lines naming no one.
    await prisma.party.deleteMany({ where: { systemRole: "WALK_IN" } });
    expect(await untaggedLines(env.company.id)).toBe(4);
    expect(await untaggedLines(coded.company.id)).toBe(1);
    const failing = await reports.getBooksCheck(env.accountsCtx);
    const untaggedEntries = await prisma.journalEntry.findMany({
      where: {
        companyId: env.company.id,
        lines: { some: { partyId: null, account: { subType: { in: [...PARTY_SUBTYPES] } } } },
      },
      orderBy: { number: "asc" },
      select: { number: true },
    });
    expect(untaggedEntries).toHaveLength(4);
    expect(failing.ok).toBe(false);
    expect(failing.checks.filter((c) => !c.ok)).toEqual([
      expect.objectContaining({
        key: "PARTY_LINES",
        books: "4",
        note: `Lines naming no buyer or supplier in: ${untaggedEntries.map((e) => e.number).join(", ")}`,
      }),
    ]);

    // The upgrade's data step, as written in the migration.
    const migration = readFileSync(
      path.join(process.cwd(), "prisma/migrations/20261003120000_walk_in_customers/migration.sql"),
      "utf8",
    );
    const backfill = migration.slice(migration.indexOf("-- Backfill"));
    const statements = backfill
      .split(/;\s*$/m)
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements).toHaveLength(2);
    for (const statement of statements) await prisma.$executeRawUnsafe(statement);

    const [walkIn, ...more] = await walkInAccounts(env.company.id);
    expect(more).toEqual([]);
    expect(walkIn).toMatchObject({
      code: "WALK-IN",
      name: "Walk-in customers",
      kind: "BUYER",
      buyerType: "RETAIL",
      status: "ACTIVE",
    });
    expect((await ledger.getPartyBalance(env.ctx, walkIn!.id)).toFixed(2)).toBe("950.00");
    expect(await untaggedLines(env.company.id)).toBe(0);
    await expectBooksOk(env.accountsCtx);

    const [codedWalkIn] = await walkInAccounts(coded.company.id);
    expect(codedWalkIn!.code).toMatch(/^WALK-IN-[0-9A-F]{6}$/);
    expect((await ledger.getPartyBalance(coded.ctx, codedWalkIn!.id)).toFixed(2)).toBe("1450.00");
    await expectBooksOk(coded.accountsCtx);

    expect(await walkInAccounts(buyersOnly.company.id)).toEqual([]);
    await expectBooksOk(buyersOnly.accountsCtx);

    // New walk-in sales carry on with the account the upgrade made.
    await counterSale(env);
    expect((await walkInAccounts(env.company.id)).map((p) => p.id)).toEqual([walkIn!.id]);
    await expectBooksOk(env.accountsCtx);
  });
});
