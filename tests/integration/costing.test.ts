import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Order costing (part 7, the v6.2 costing rules): the profit % set per order
 * with no default (v6.4.2: at least 10%, no upper limit; a sheet saved under
 * 10% keeps its figure and reaches 10% when edited), the CM fixed per style with the factory, fabric at the
 * supplier's quoted price per kg beside past booking prices, the buyer's way
 * of paying (TT, bank transfer or LC), and the Order check card, which never
 * declines: only the owner takes or declines the order.
 */
const signedIn = vi.hoisted(() => ({ ctx: null as unknown }));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/modules/auth/context", async (original) => {
  const real = await original<typeof import("@/modules/auth/context")>();
  const { AppError } = await import("@/lib/errors");
  const ctx = () => {
    if (!signedIn.ctx) throw new AppError("UNAUTHENTICATED", "Please sign in to continue.");
    return signedIn.ctx as import("@/modules/auth/context").CompanyContext;
  };
  return {
    ...real,
    requireCompany: async () => ctx(),
    requirePermission: async (...keys: string[]) => {
      if (keys.some((k) => !ctx().permissions.has(k as never))) {
        throw new AppError("FORBIDDEN", "You do not have permission to do this.");
      }
      return ctx();
    },
    requireAnyPermission: async (...keys: string[]) => {
      if (!keys.some((k) => ctx().permissions.has(k as never))) {
        throw new AppError("FORBIDDEN", "You do not have permission to do this.");
      }
      return ctx();
    },
  };
});

import { addDays, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import * as costing from "@/modules/costing/costing.service";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as styles from "@/modules/inventory/style.service";
import * as materials from "@/modules/materials/material.service";
import * as parties from "@/modules/parties/party.service";
import { getPartyForm } from "@/modules/parties/screens.service";
import * as projects from "@/modules/production/project.service";
import { createRole } from "@/modules/rbac/role.service";
import {
  createCostingAction,
  decideCostingAction,
  listCostingsAction,
} from "@/server/actions/costing.actions";
import { findProductionPartiesAction } from "@/server/actions/production.actions";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

async function expectAppError(promise: Promise<unknown>, code: string, message?: RegExp) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, "expected an AppError").toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  if (message) expect((error as AppError).message).toMatch(message);
  return error as AppError;
}

/** A calendar day `n` days from today in Dhaka. */
const day = (n: number) => addDays(localDay(new Date(), "Asia/Dhaka"), n);
const at = (n: number) => new Date(`${day(n)}T00:00:00.000Z`);

async function setup() {
  const { company, roles } = await makeCompany("Extas");
  const other = await makeCompany("Extas Uttara");
  const join = async (roleId: string, who: string, companyId = company.id) => {
    const user = await makeUser(`${who}@extas.test`);
    await addToCompany(user.id, companyId, roleId);
    return contextFor(user.id, companyId);
  };
  const owner = await join(roles.SUPER_ADMIN, "owner");
  const merchRole = await createRole(owner, {
    name: "Merchandiser",
    permissions: ["dashboard.view", "costing.view", "costing.manage"],
  });
  const merch = await join(merchRole.id, "merch");
  const pm = await join(roles.PRODUCTION_MANAGER, "pm");
  const sales = await join(roles.SALES_EXECUTIVE, "sales");
  const outsider = await join(other.roles.SUPER_ADMIN, "outsider", other.company.id);

  const buyer = (
    await parties.createParty(owner, { kind: "BUYER", name: "Nordic Wear AB", tradePayment: "LC" })
  ).party;
  const mill = (await parties.createParty(owner, { kind: "SUPPLIER", name: "Narayanganj Fabrics" }))
    .party;
  const knit = (
    await parties.createParty(owner, {
      kind: "SUPPLIER",
      name: "Gazipur Knit Factory",
      monthlyCapacity: 2000,
    })
  ).party;
  const roomy = (
    await parties.createParty(owner, {
      kind: "SUPPLIER",
      name: "Ashulia Apparels",
      monthlyCapacity: 20_000,
    })
  ).party;
  const theirs = (await parties.createParty(outsider, { kind: "BUYER", name: "Uttara Buyer" }))
    .party;
  return { company, other, owner, merch, pm, sales, outsider, buyer, mill, knit, roomy, theirs };
}

type Env = Awaited<ReturnType<typeof setup>>;

/** A sheet in USD at 120 BDT, the owner's 10% profit, 1% source tax and 0.15% bank charges. */
const SHEET = (env: Env, over: Record<string, unknown> = {}) => ({
  title: "Pique polos, spring 2027",
  buyerId: env.buyer.id,
  factoryId: env.roomy.id,
  currency: "USD",
  exchangeRate: "120",
  profitPercent: "10",
  sourceTaxPercent: "1",
  bankChargePercent: "0.15",
  commissionPercent: "",
  shipDate: day(120),
  fabricDays: "",
  makingDays: "",
  risks: [],
  notes: "",
  ...over,
});

const POLO = {
  styleRef: "NW-PL-01",
  description: "Pique polo 220 GSM",
  quantity: "3000",
  fabricName: "Cotton pique 220 GSM",
  fabricUnit: "KG",
  consumption: "2.2",
  fabricPrice: "3.5",
  trimsPerDozen: "3",
  valueAddPerDozen: "2",
  otherPerDozen: "0.5",
  cmAmount: "1.2",
  cmPer: "PIECE",
  buyerPrice: "2.8",
};

/** An invoice of the buyer's, due `dueIn` days from today, with what is still owed. */
async function invoice(env: Env, n: number, dueIn: number, owed: number, paidIn?: number) {
  const order = await prisma.salesOrder.create({
    data: {
      companyId: env.company.id,
      number: `SO-T-${n}`,
      channel: "WHOLESALE",
      partyId: env.buyer.id,
    },
  });
  const inv = await prisma.invoice.create({
    data: {
      companyId: env.company.id,
      number: `INV-T-${n}`,
      orderId: order.id,
      partyId: env.buyer.id,
      issueDate: at(dueIn - 30),
      dueDate: at(dueIn),
      total: 1000,
      paidAmount: 1000 - owed,
      dueAmount: owed,
      status: owed === 0 ? "PAID" : "UNPAID",
    },
  });
  if (paidIn !== undefined) {
    const account =
      (await prisma.ledgerAccount.findFirst({
        where: { companyId: env.company.id, code: "T-BANK" },
      })) ??
      (await prisma.ledgerAccount.create({
        data: {
          companyId: env.company.id,
          code: "T-BANK",
          name: "Test bank",
          type: "ASSET",
          subType: "BANK",
        },
      }));
    await prisma.payment.create({
      data: {
        companyId: env.company.id,
        number: `RCPT-T-${n}`,
        direction: "RECEIVED",
        method: "BANK_TRANSFER",
        partyId: env.buyer.id,
        amount: 1000,
        paymentDate: at(paidIn),
        accountId: account.id,
        invoiceId: inv.id,
      },
    });
  }
  return inv;
}

const signal = (card: Awaited<ReturnType<typeof costing.orderCheck>>, key: string) =>
  card.find((r) => r.key === key)!;

run("Order costing", () => {
  let env: Env;
  beforeEach(async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await resetDb();
    env = await setup();
  });
  afterEach(() => {
    signedIn.ctx = null;
    vi.restoreAllMocks();
  });

  it("keeps costing to the people given it, and the decision to the owner", async () => {
    // New permissions start with the Super Admin only.
    await expectAppError(costing.listCostings(env.pm), "FORBIDDEN");
    await expectAppError(costing.listCostings(env.sales), "FORBIDDEN");
    await expectAppError(costing.createCosting(env.pm, SHEET(env)), "FORBIDDEN");

    signedIn.ctx = env.sales;
    const refused = await listCostingsAction();
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("FORBIDDEN");

    // A merchandiser given costing makes the sheet and picks the buyer with the shared search.
    signedIn.ctx = env.merch;
    const made = await createCostingAction(SHEET(env));
    expect(made.ok).toBe(true);
    const id = made.ok ? made.data.id : "";
    const found = await findProductionPartiesAction({ kind: "BUYER", search: "Nordic" });
    expect(found.ok && found.data.map((p) => p.name)).toEqual(["Nordic Wear AB"]);

    // Only the owner takes or declines it.
    const notMine = await decideCostingAction(id, { decision: "TAKE" });
    expect(notMine.ok).toBe(false);
    if (!notMine.ok) expect(notMine.error.code).toBe("FORBIDDEN");
    await expectAppError(
      costing.decideCosting(env.merch, id, { decision: "TAKE" }),
      "FORBIDDEN",
      /owner's decision/,
    );
    signedIn.ctx = env.owner;
    const taken = await decideCostingAction(id, { decision: "TAKE", note: "Pays on time" });
    expect(taken.ok).toBe(true);
    const sheet = await costing.getCosting(env.owner, id);
    expect(sheet).toMatchObject({
      decision: "TAKE",
      decisionNote: "Pays on time",
      decidedBy: "owner",
      can: { manage: true, decide: true },
    });
    expect((await costing.getCosting(env.merch, id)).can).toEqual({ manage: true, decide: false });
    expect(
      await prisma.auditLog.findFirst({ where: { entityId: id, action: "STATUS_CHANGE" } }),
    ).toMatchObject({ summary: expect.stringMatching(/^CST-\d{4}-00001: took the order/) });
  });

  it("sets the profit % per order with no default, and the payment way from the buyer", async () => {
    const noRate = await expectAppError(
      costing.createCosting(env.merch, SHEET(env, { exchangeRate: "" })),
      "VALIDATION",
    );
    expect(noRate.details).toMatchObject({ exchangeRate: [expect.stringContaining("BDT")] });

    const { id, number } = await costing.createCosting(
      env.merch,
      SHEET(env, { profitPercent: "", risks: ["New print house", "New print house"] }),
    );
    expect(number).toMatch(/^CST-\d{4}-00001$/);
    let sheet = await costing.getCosting(env.merch, id);
    expect(sheet).toMatchObject({
      profitPercent: null,
      tradePayment: "LC", // the buyer's
      exchangeRate: 120,
      sourceTaxPercent: 1,
      bankChargePercent: 0.15,
      commissionPercent: 0,
      risks: ["New print house"],
      fabricDays: null,
    });

    // This order pays by TT although the buyer usually opens an LC.
    await costing.updateCosting(
      env.merch,
      id,
      SHEET(env, { profitPercent: "12.5", tradePayment: "TT" }),
    );
    sheet = await costing.getCosting(env.merch, id);
    expect(sheet).toMatchObject({ profitPercent: 12.5, tradePayment: "TT" });
    expect(
      await prisma.auditLog.findFirst({
        where: { entityId: id, action: "UPDATE" },
        orderBy: { createdAt: "asc" },
      }),
    ).toMatchObject({ summary: expect.stringContaining("profit 12.5%") });
    // Left out, the order keeps its own way of paying.
    await costing.updateCosting(env.merch, id, SHEET(env, { profitPercent: "12.5" }));
    expect((await costing.getCosting(env.merch, id)).tradePayment).toBe("TT");

    // The profit hint shows the buyer's earlier sheets; a new sheet still starts empty.
    const second = await costing.createCosting(env.merch, SHEET(env, { profitPercent: "" }));
    const next = await costing.getCosting(env.merch, second.id);
    expect(next.profitPercent).toBeNull();
    expect(next.hints.profit).toEqual([
      expect.objectContaining({ number, profit: 12.5, decision: null }),
    ]);
  });

  it("takes a profit % of at least 10% with no upper limit, and lifts an old sheet to 10% when edited", async () => {
    // Below 10% is refused wherever it is set: making, changing, or the profit alone.
    for (const low of ["9.99", "8", "0", "-5"]) {
      await expect(
        costing.createCosting(env.merch, SHEET(env, { profitPercent: low })),
      ).rejects.toThrow(/Give a profit % of at least 10%\./);
    }
    signedIn.ctx = env.merch;
    const viaScreen = await createCostingAction(SHEET(env, { profitPercent: "9" }));
    expect(viaScreen.ok).toBe(false);
    if (!viaScreen.ok) {
      expect(viaScreen.error.code).toBe("VALIDATION");
      expect(viaScreen.error.fieldErrors).toMatchObject({
        profitPercent: ["Give a profit % of at least 10%."],
      });
    }

    // No fixed upper limit, but the profit and the percent lines come off the price, so
    // together they stay under 100%: a sheet that leaves no price is never saved.
    const noPrice =
      "200% profit plus 1.15% off the price (source tax, bank charges and commission) is 201.15% of the price, which leaves no price. Did you mean 200% on cost? That is 66.67% of the price.";
    await expect(
      costing.createCosting(env.merch, SHEET(env, { profitPercent: "200" })),
    ).rejects.toThrow(noPrice);
    const viaScreenHigh = await createCostingAction(SHEET(env, { profitPercent: "200" }));
    expect(viaScreenHigh).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", message: noPrice, fieldErrors: { profitPercent: [noPrice] } },
    });
    await expect(
      costing.createCosting(
        env.merch,
        SHEET(env, { profitPercent: "200", sourceTaxPercent: "", bankChargePercent: "" }),
      ),
    ).rejects.toThrow(
      "200% of the price leaves no price. Did you mean 200% on cost? That is 66.67% of the price.",
    );
    // 98.85% and the 1.15% of lines make exactly 100%: no price either.
    await expect(
      costing.createCosting(env.merch, SHEET(env, { profitPercent: "98.85" })),
    ).rejects.toThrow(/is 100% of the price, which leaves no price/);
    const { id } = await costing.createCosting(env.merch, SHEET(env, { profitPercent: "66.67" }));
    expect((await costing.getCosting(env.merch, id)).profitPercent).toBe(66.67);
    await costing.setProfitPercent(env.merch, id, { percent: "90" });
    expect((await costing.getCosting(env.merch, id)).profitPercent).toBe(90);
    // The profit alone (the sheet, or Apply on a chat card), and the percent lines changed.
    await expect(costing.setProfitPercent(env.merch, id, { percent: "350" })).rejects.toThrow(
      "350% profit plus 1.15% off the price (source tax, bank charges and commission) is 351.15% of the price, which leaves no price. Did you mean 350% on cost? That is 77.78% of the price.",
    );
    await expect(
      costing.updateCosting(
        env.merch,
        id,
        SHEET(env, { profitPercent: "90", commissionPercent: "10" }),
      ),
    ).rejects.toThrow(/is 101.15% of the price, which leaves no price/);
    await expect(
      costing.updateCosting(
        env.merch,
        id,
        SHEET(env, { profitPercent: "", sourceTaxPercent: "50", bankChargePercent: "50" }),
      ),
    ).rejects.toThrow(
      "Source tax, bank charges and commission come to 100% of the price, which leaves no price. Lower them.",
    );
    expect((await costing.getCosting(env.merch, id)).profitPercent).toBe(90);
    await expect(costing.setProfitPercent(env.merch, id, { percent: "9.5" })).rejects.toThrow(
      /at least 10%/,
    );
    await expect(costing.setProfitPercent(env.merch, id, { percent: "1000" })).rejects.toThrow(
      /999.99%/,
    );
    await costing.setProfitPercent(env.merch, id, { percent: "10" });
    expect((await costing.getCosting(env.merch, id)).profitNote).toBeNull();
    // A sheet saved with no price before this rule stays as it is.
    await prisma.orderCosting.update({ where: { id }, data: { profitPercent: 200 } });
    expect((await costing.getCosting(env.merch, id)).profitPercent).toBe(200);
    await costing.setProfitPercent(env.merch, id, { percent: "10" });

    // A sheet saved at 8% before the rule keeps its 8% and shows a note.
    const stored = async () =>
      Number((await prisma.orderCosting.findUniqueOrThrow({ where: { id } })).profitPercent);
    await prisma.orderCosting.update({ where: { id }, data: { profitPercent: 8 } });
    const old = await costing.getCosting(env.merch, id);
    expect(old.profitPercent).toBe(8);
    expect(old.profitNote).toBe(
      "Saved at 8% profit, under the 10% minimum. Raise it to at least 10% when you edit it.",
    );
    // Reading it, or the owner's decision, does not change it.
    await costing.decideCosting(env.owner, id, { decision: "TAKE" });
    expect(await stored()).toBe(8);

    // Any edit must reach 10%: the details as they are, or a style added (or changed, taken off).
    await expect(
      costing.updateCosting(
        env.merch,
        id,
        SHEET(env, { profitPercent: "8", title: "Polos, re-costed" }),
      ),
    ).rejects.toThrow(/at least 10%/);
    await expectAppError(
      costing.saveCostingStyle(env.merch, id, null, POLO),
      "VALIDATION",
      /Saved at 8% profit, under the 10% minimum/,
    );
    expect(await stored()).toBe(8);
    await costing.updateCosting(env.merch, id, SHEET(env, { profitPercent: "10" }));
    expect(await costing.getCosting(env.merch, id)).toMatchObject({
      profitPercent: 10,
      profitNote: null,
    });
    await costing.saveCostingStyle(env.merch, id, null, POLO);
    expect((await costing.getCosting(env.merch, id)).styles).toHaveLength(1);
  });

  it("costs styles per dozen with the CM fixed per style and no overhead", async () => {
    const { id } = await costing.createCosting(env.merch, SHEET(env));
    await expect(
      costing.saveCostingStyle(env.merch, id, null, { ...POLO, quantity: "0" }),
    ).rejects.toThrow(/Give the pieces/);
    const style = await costing.saveCostingStyle(env.merch, id, null, POLO);
    await costing.saveCostingStyle(env.merch, id, null, {
      ...POLO,
      styleRef: "NW-PL-02",
      quantity: "600",
      consumption: "3",
      cmAmount: "14.4",
      cmPer: "DOZEN",
      buyerPrice: "",
      fabricPrice: "",
    });

    const sheet = await costing.getCosting(env.merch, id);
    const [one, two] = sheet.styles;
    expect(one!.cost).toMatchObject({
      fabric: 7.7, // 2.2 kg × 3.50
      cm: 14.4, // 1.20 a piece × 12
      direct: 27.6,
      costPerPiece: 2.3,
      // 27.6 ÷ (1 − 0.1115) ÷ 12
      priceAtProfit: Number((27.6 / 0.8885 / 12).toFixed(4)),
      buyerProfit: 16.71,
      missing: [],
    });
    expect(two!.cost).toMatchObject({ cm: 14.4, fabric: null, missing: ["fabric price"] });
    expect(sheet.sheet.pieces).toBe(3600);
    expect(sheet.sheet.valueAtBuyerPrice).toBeNull();

    // The price card says the second style is short of a cost.
    expect(signal(sheet.card, "price")).toMatchObject({
      signal: "yellow",
      reason: expect.stringContaining("NW-PL-02 has no fabric price"),
    });

    await costing.removeCostingStyle(env.merch, id, sheet.styles[1]!.id);
    await costing.saveCostingStyle(env.merch, id, style.id, { ...POLO, buyerPrice: "2.2" });
    const cheaper = await costing.getCosting(env.merch, id);
    expect(cheaper.styles).toHaveLength(1);
    expect(signal(cheaper.card, "price")).toMatchObject({
      signal: "red",
      reason: "NW-PL-01: the buyer's 2.20 is below the cost of 2.30 a piece.",
    });
    expect(cheaper.decision).toBeNull(); // the card never declines
  });

  it("shows supplier quotes per kg beside past booking prices, and past CM to compare", async () => {
    const wrong = await expectAppError(
      costing.addFabricQuote(env.merch, {
        supplierId: env.mill.id,
        fabric: "Cotton pique 220 GSM",
        price: "3.4",
        currency: "USD",
        quotedOn: day(0),
        validUntil: day(-1),
      }),
      "VALIDATION",
    );
    expect(wrong.details).toHaveProperty("validUntil");
    await expectAppError(
      costing.addFabricQuote(env.merch, {
        supplierId: env.buyer.id,
        fabric: "Pique",
        price: "3",
        currency: "USD",
        quotedOn: day(0),
      }),
      "VALIDATION",
      /suppliers/,
    );
    const quote = await costing.addFabricQuote(env.merch, {
      supplierId: env.mill.id,
      fabric: "Cotton pique 220 GSM",
      unit: "KG",
      price: "3.4",
      currency: "USD",
      quotedOn: day(-3),
      validUntil: day(27),
    });
    await costing.addFabricQuote(env.merch, {
      supplierId: env.knit.id,
      fabric: "Pique 220 GSM, combed",
      price: "430",
      currency: "BDT",
      quotedOn: day(-40),
      validUntil: day(-10),
    });
    await costing.addFabricQuote(env.outsider, {
      supplierId: (
        await parties.createParty(env.outsider, { kind: "SUPPLIER", name: "Their mill" })
      ).party.id,
      fabric: "Pique",
      price: "1",
      currency: "USD",
      quotedOn: day(0),
    });

    // A past booking of pique at BDT 425 a kg.
    const pique = await materials.createMaterial(env.owner, {
      name: "Pique 220 GSM",
      kind: "FABRIC",
      unit: "KG",
      supplierId: env.mill.id,
    });
    const order = await prisma.purchaseOrder.create({
      data: {
        companyId: env.company.id,
        number: "PO-T-1",
        supplierId: env.mill.id,
        orderDate: at(-60),
      },
    });
    await prisma.purchaseOrderLine.create({
      data: {
        orderId: order.id,
        rawMaterialId: pique.id,
        quantity: 500,
        unitPrice: 425,
        amount: 212_500,
      },
    });

    const prices = await costing.fabricPrices(env.merch, { search: "pique" });
    expect(prices.quotes.map((q) => [q.supplier, q.price, q.currency, q.expired])).toEqual([
      ["Narayanganj Fabrics", 3.4, "USD", false],
      ["Gazipur Knit Factory", 430, "BDT", true],
    ]);
    expect(prices.past).toEqual([
      expect.objectContaining({
        number: "PO-T-1",
        supplier: "Narayanganj Fabrics",
        price: 425,
        currency: "BDT",
        unit: "KG",
      }),
    ]);
    await expectAppError(costing.fabricPrices(env.pm, { search: "pique" }), "FORBIDDEN");

    // A style priced from the quote keeps the link; the quote can go and the price stays.
    const { id } = await costing.createCosting(env.merch, SHEET(env));
    await costing.saveCostingStyle(env.merch, id, null, {
      ...POLO,
      fabricQuoteId: quote.id,
      fabricPrice: "3.4",
    });
    expect((await costing.getCosting(env.merch, id)).styles[0]!.quote).toMatchObject({
      supplier: "Narayanganj Fabrics",
      price: 3.4,
      unit: "KG",
    });
    await costing.removeFabricQuote(env.merch, quote.id);
    const kept = (await costing.getCosting(env.merch, id)).styles[0]!;
    expect(kept).toMatchObject({ fabricQuoteId: null, fabricPrice: 3.4 });

    // The CM agreed with a factory before shows beside the style, to compare.
    const polos = await catalog.createCategory(env.owner, { name: "Polo shirts" });
    const polo = await styles.createStyle(env.owner, {
      code: "NW-PL-01",
      name: "Nordic polo",
      categoryId: polos.id,
      retailPrice: 1450,
      wholesalePrice: 900,
    });
    const navy = await catalog.createColor(env.owner, { name: "Navy", hexCode: "#1f2a44" });
    const size = await catalog.createSize(env.owner, { name: "M" });
    await matrix.generateMatrix(env.owner, polo.id, { colorIds: [navy.id], sizeIds: [size.id] });
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { styleId: polo.id } });
    const project = await projects.createProject(env.pm, {
      name: "Last year's polo",
      factoryId: env.roomy.id,
      targetDate: day(30),
      targets: [{ variantId: variant.id, quantity: 500 }],
    });
    await prisma.productionProject.update({ where: { id: project.id }, data: { cmRate: 138 } });
    await costing.saveCostingStyle(env.merch, id, kept.id, { ...POLO, styleId: polo.id });
    expect((await costing.getCosting(env.merch, id)).hints.cm).toEqual([
      expect.objectContaining({
        style: "NW-PL-01",
        factory: "Ashulia Apparels",
        cm: 138,
        cmPer: "PIECE",
        cmPerDozen: null,
      }),
    ]);

    // A CM agreed at 125 a dozen comes back as 125 a dozen, not as 10.42 a piece.
    await prisma.productionProject.update({
      where: { id: project.id },
      data: { cmRate: "10.42", cmPer: "DOZEN", cmPerDozen: 125 },
    });
    expect((await costing.getCosting(env.merch, id)).hints.cm).toEqual([
      expect.objectContaining({ cm: 10.42, cmPer: "DOZEN", cmPerDozen: 125 }),
    ]);
  });

  it("reads green on every check for a sound order", async () => {
    await parties.updateParty(env.owner, env.buyer.id, { tradePayment: "TT" });
    await invoice(env, 1, -40, 0, -41); // paid a day early
    await invoice(env, 2, -10, 0, -8); // two days late: within the grace
    const { id } = await costing.createCosting(env.merch, SHEET(env));
    await costing.saveCostingStyle(env.merch, id, null, POLO);
    const card = await costing.orderCheck(env.merch, id);
    expect(card.map((r) => [r.label, r.signal])).toEqual([
      ["Price vs cost", "green"],
      ["Time to ship", "green"],
      ["Factory", "green"],
      ["Buyer payment", "green"],
      ["Risks", "green"],
    ]);
    expect(signal(card, "payment").reason).toBe("All 2 invoices were paid on time.");
  });

  it("turns each check yellow or red with its reason, and never decides", async () => {
    // Late and overdue money from the buyer.
    await invoice(env, 1, -60, 0, -45); // paid 15 days late
    let { id } = await costing.createCosting(env.merch, SHEET(env, { factoryId: env.knit.id }));
    await costing.saveCostingStyle(env.merch, id, null, POLO);
    let card = await costing.orderCheck(env.merch, id);
    expect(signal(card, "payment")).toMatchObject({
      signal: "yellow",
      reason: "1 of 1 invoices were paid late.",
    });
    await invoice(env, 2, -20, 400);
    card = await costing.orderCheck(env.merch, id);
    expect(signal(card, "payment")).toMatchObject({
      signal: "red",
      reason: "BDT 400.00 overdue on 1 invoice(s), the oldest by 20 days.",
    });

    // The small factory is full: 2,000 a month for 4 months, with 500 pieces already due.
    const polos = await catalog.createCategory(env.owner, { name: "Polo shirts" });
    const polo = await styles.createStyle(env.owner, {
      code: "EX-PL-9",
      name: "Polo",
      categoryId: polos.id,
      retailPrice: 1000,
      wholesalePrice: 700,
    });
    const navy = await catalog.createColor(env.owner, { name: "Navy", hexCode: "#1f2a44" });
    const size = await catalog.createSize(env.owner, { name: "M" });
    await matrix.generateMatrix(env.owner, polo.id, { colorIds: [navy.id], sizeIds: [size.id] });
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { styleId: polo.id } });
    await projects.createProject(env.pm, {
      name: "Open order",
      factoryId: env.knit.id,
      targetDate: day(60),
      targets: [{ variantId: variant.id, quantity: 5500 }],
    });
    card = await costing.orderCheck(env.merch, id);
    expect(signal(card, "factory")).toMatchObject({
      signal: "red",
      reason: "Gazipur Knit Factory is full: 5,500 pieces booked + 3,000 new, room for 8,000.",
    });

    // No factory: the ones with room are named.
    await costing.updateCosting(env.merch, id, SHEET(env, { factoryId: "" }));
    card = await costing.orderCheck(env.merch, id);
    expect(signal(card, "factory")).toMatchObject({
      signal: "yellow",
      reason:
        "No factory picked. Room by the ship date: Ashulia Apparels (80,000 pieces), Gazipur Knit Factory (2,500 pieces).",
    });

    // Too little time, with Eid ul-Adha ten days before the ship date, and an LC.
    await prisma.holiday.create({
      data: { companyId: env.company.id, date: at(30), name: "Eid ul-Adha" },
    });
    ({ id } = await costing.createCosting(
      env.merch,
      SHEET(env, { shipDate: day(40), risks: ["New print house"] }),
    ));
    await costing.saveCostingStyle(env.merch, id, null, POLO);
    card = await costing.orderCheck(env.merch, id);
    expect(signal(card, "time")).toMatchObject({
      signal: "red",
      reason:
        "Not enough time: about 62 days are needed, 40 are left (fabric 30 and making 25 days assumed).",
    });
    expect(signal(card, "risks")).toMatchObject({
      signal: "red",
      reason: `Eid ul-Adha on ${day(30)}, 10 days before the ship date; LC: the papers must match the LC exactly; New print house.`,
    });

    // Given its own times, the order fits.
    await costing.updateCosting(
      env.merch,
      id,
      SHEET(env, { shipDate: day(40), fabricDays: "10", makingDays: "15", risks: [] }),
    );
    card = await costing.orderCheck(env.merch, id);
    expect(signal(card, "time")).toMatchObject({
      signal: "green",
      reason: "40 days are left; about 32 are needed.",
    });
    expect(await prisma.orderCosting.count({ where: { decision: { not: null } } })).toBe(0);
  });

  it("calls a buyer with no invoices new", async () => {
    const { id } = await costing.createCosting(env.merch, SHEET(env));
    const card = await costing.orderCheck(env.merch, id);
    expect(signal(card, "payment").reason).toContain("New buyer");
    expect(signal(card, "risks")).toMatchObject({
      signal: "yellow",
      reason: "New buyer; LC: the papers must match the LC exactly.",
    });
  });

  it("keeps each company's sheets and quotes to itself", async () => {
    const { id } = await costing.createCosting(env.merch, SHEET(env));
    await expectAppError(costing.getCosting(env.outsider, id), "NOT_FOUND");
    await expectAppError(costing.updateCosting(env.outsider, id, SHEET(env)), "NOT_FOUND");
    await expectAppError(
      costing.decideCosting(env.outsider, id, { decision: "DECLINE" }),
      "NOT_FOUND",
    );
    await expectAppError(
      costing.createCosting(env.merch, SHEET(env, { buyerId: env.theirs.id })),
      "VALIDATION",
      /your buyers/,
    );
    expect(await costing.listCostings(env.outsider)).toEqual([]);
    expect(await costing.listCostings(env.merch)).toHaveLength(1);
    const rows = await prisma.orderCosting.findMany();
    expect(rows.every((r) => r.companyId === env.company.id)).toBe(true);
  });

  it("keeps how a buyer pays and a factory's monthly capacity on the account", async () => {
    await parties.updateParty(env.owner, env.buyer.id, { tradePayment: "BANK_TRANSFER" });
    await parties.updateParty(env.owner, env.knit.id, { monthlyCapacity: 15000 });
    expect((await getPartyForm(env.owner, env.buyer.id)).party).toMatchObject({
      tradePayment: "BANK_TRANSFER",
      monthlyCapacity: null,
    });
    expect((await getPartyForm(env.owner, env.knit.id)).party).toMatchObject({
      monthlyCapacity: 15000,
    });
    await expect(
      parties.updateParty(env.owner, env.knit.id, { monthlyCapacity: 0 }),
    ).rejects.toThrow();
    await expect(
      parties.updateParty(env.owner, env.buyer.id, { tradePayment: "CASH" }),
    ).rejects.toThrow();
  });
});
