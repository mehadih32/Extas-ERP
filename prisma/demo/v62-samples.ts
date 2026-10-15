import { addDays, localDay } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import * as orders from "@/modules/ai/orders/order-run.service";
import type { CompanyContext } from "@/modules/auth/context";
import * as costing from "@/modules/costing/costing.service";
import * as parties from "@/modules/parties/party.service";

/*
 * The v6.2 sample on the demo site: a new order given to Mehedi 2.0 the way
 * the owner would give it, waiting for the owner's Approve, so the Orders
 * tab, the costing rules and the Order check card can be tried at once:
 *   - a buyer who pays by LC, and a factory with its monthly capacity;
 *   - the mill's fabric quote, priced per kg;
 *   - the order's form filled in, its costing sheet made from it, with the
 *     quote, consumption, the CM fixed per style and the owner's profit %;
 *   - the plan written by the ERP (the AI stays off), for Approve or Return.
 * Once: when the sample order is there already it does nothing.
 */

export const V62_SAMPLE_ORDER = "Sample: Nordic Wear pique polos";

async function party(
  ctx: CompanyContext,
  kind: "BUYER" | "SUPPLIER",
  name: string,
  extra: Record<string, unknown>,
) {
  const found = await prisma.party.findFirst({
    where: { companyId: ctx.company.id, kind, name },
    select: { id: true },
  });
  if (found) {
    if (Object.keys(extra).length > 0) await parties.updateParty(ctx, found.id, extra);
    return found.id;
  }
  return (await parties.createParty(ctx, { kind, name, ...extra })).party.id;
}

export async function loadV62Samples(ctx: CompanyContext) {
  const there = await prisma.aiOrderRun.findFirst({
    where: { companyId: ctx.company.id, title: V62_SAMPLE_ORDER },
    select: { number: true },
  });
  if (there) return null;

  const today = localDay(new Date(), ctx.company.timezone);
  const buyerId = await party(ctx, "BUYER", "Nordic Wear AB", {
    tradePayment: "LC",
    country: "Sweden",
  });
  const factoryId = await party(ctx, "SUPPLIER", "Gazipur Knit Composite", {
    monthlyCapacity: 30_000,
  });
  const millId = await party(ctx, "SUPPLIER", "Noman Textile Mills", {});
  const quote = await costing.addFabricQuote(ctx, {
    supplierId: millId,
    fabric: "Cotton pique 220 GSM",
    unit: "KG",
    price: "3.6",
    currency: "USD",
    quotedOn: today,
    validUntil: addDays(today, 30),
    note: "Sample quote for the v6.2 demo",
  });

  const run = await orders.createRun(ctx, {
    title: V62_SAMPLE_ORDER,
    buyerId,
    po: "NW-2027-118",
  });
  const lines = [
    ["NW-PL-01", "Navy", "S", 600],
    ["NW-PL-01", "Navy", "M", 900],
    ["NW-PL-01", "Navy", "L", 900],
    ["NW-PL-01", "Navy", "XL", 600],
    ["NW-PL-02", "White", "M", 800],
    ["NW-PL-02", "White", "L", 700],
  ] as const;
  await orders.updateRun(ctx, run.id, {
    buyerId,
    fields: {
      buyer: "Nordic Wear AB",
      po: "NW-2027-118",
      lines: lines.map(([style, colour, size, quantity]) => ({ style, colour, size, quantity })),
      quantity: 4500,
      shipDate: addDays(today, 110),
      price: 4.2,
      currency: "USD",
      fabric: "Cotton pique 220 GSM",
      logo: "Chest embroidery, 7 cm",
      packing: "Single polybag, 24 pieces a carton",
      notes: "Sample order on the demo site.",
    },
  });

  const sheet = await orders.makeCosting(ctx, run.id, { exchangeRate: "122" });
  const current = await prisma.orderCosting.findUniqueOrThrow({ where: { id: sheet.id } });
  await costing.updateCosting(ctx, sheet.id, {
    title: current.title,
    buyerId,
    factoryId,
    currency: "USD",
    exchangeRate: "122",
    profitPercent: "10",
    sourceTaxPercent: "1",
    bankChargePercent: "0.15",
    commissionPercent: "",
    shipDate: addDays(today, 110),
    fabricDays: "",
    makingDays: "",
    risks: [],
    notes: current.notes ?? "",
  });
  const styles = await prisma.orderCostingStyle.findMany({
    where: { costingId: sheet.id },
    orderBy: { styleRef: "asc" },
  });
  for (const style of styles) {
    await costing.saveCostingStyle(ctx, sheet.id, style.id, {
      styleRef: style.styleRef,
      description: "Pique polo 220 GSM",
      quantity: style.quantity,
      fabricQuoteId: quote.id,
      fabricName: "Cotton pique 220 GSM",
      fabricUnit: "KG",
      consumption: "2.2",
      // The fabric price is the mill's quote, per kg.
      fabricPrice: "3.6",
      trimsPerDozen: "3",
      valueAddPerDozen: style.styleRef === "NW-PL-01" ? "2" : "0",
      otherPerDozen: "0.5",
      // CM is fixed per style with the factory.
      cmAmount: style.styleRef === "NW-PL-01" ? "1.25" : "1.1",
      cmPer: "PIECE",
      buyerPrice: "4.2",
    });
  }

  // The AI stays off on the demo: the ERP writes the plan from its own data.
  await orders.makePlan(ctx, run.id, { byAi: false }, undefined, { ask: null });
  return { order: run.number, costing: sheet.number };
}
