import { addDays, dateColumn, localDay } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import type { CompanyContext } from "@/modules/auth/context";
import * as leads from "@/modules/leads/lead.service";
import { completeFromFacts, syncOrderTa } from "@/modules/ta/ta.service";

import { V641_SAMPLE_ORDERS } from "./v641-samples";

/*
 * Release 6 samples on the demo site, so Sales > Leads, Lead 360, the lead
 * reports, Do not contact, the T&A calendar and an order's T&A panel show
 * real-looking records (and the Help pictures have them). Made-up companies and
 * people only; nothing is ever sent from them.
 *   Leads: five leads in different stages, one with a contact, a sample, history
 *   and a follow-up that is late, and one "Do not contact" entry. Once: when the
 *   first lead is there already it does nothing.
 *   T&A: two of the v6.4.1 sample orders get a ship date (when they have none),
 *   one close enough that its first steps are late; every demo order with a ship
 *   date then gets its T&A. Running it again changes nothing.
 */

export const R6_SAMPLE_LEAD = "Nordic Threads AB";

export async function loadLeadsSamples(ctx: CompanyContext) {
  const there = await prisma.lead.findFirst({
    where: { companyId: ctx.company.id, name: R6_SAMPLE_LEAD },
    select: { id: true },
  });
  if (there) return null;
  const today = localDay(new Date(), ctx.company.timezone);
  await leads.ensureSources(ctx.company.id);
  const source = async (name: string) =>
    (
      await prisma.leadSource.findFirstOrThrow({
        where: { companyId: ctx.company.id, name },
        select: { id: true },
      })
    ).id;
  const fair = await source("Trade fair");
  const linkedin = await source("LinkedIn");
  const referral = await source("Referral");

  // 1. Met at a fair: a contact, history, a sample on the way and a late follow-up.
  const nordic = await leads.addLead(ctx, {
    name: R6_SAMPLE_LEAD,
    website: "https://www.nordicthreads.example",
    country: "Sweden",
    city: "Stockholm",
    category: "BRAND",
    products: ["Polo", "T-shirt"],
    piecesPerStyle: 3000,
    targetPrice: 520,
    expectedValue: 4_680_000,
    paymentTerms: "TT",
    contact: {
      name: "Anna Lindqvist",
      jobTitle: "Sourcing manager",
      email: "anna@nordicthreads.example",
      phone: "+46 70 123 4567",
      whatsapp: "+46 70 123 4567",
      isDecisionMaker: true,
    },
    sourceId: fair,
    sourceNote: "Dhaka Apparel Expo, Hall 2, stall B12",
    nextActionOn: addDays(today, -2),
    nextActionKind: "EMAIL",
    nextActionNote: "Send the polo price for 3 colours",
  });
  await leads.logLeadActivity(ctx, nordic.id, {
    kind: "FAIR_MEETING",
    summary: "Met at the fair; wants piqué polos in navy, white and bottle green",
    occurredOn: addDays(today, -12),
  });
  await leads.logLeadActivity(ctx, nordic.id, {
    kind: "EMAIL_OUT",
    summary: "Sent our company profile and the polo catalogue",
    occurredOn: addDays(today, -9),
  });
  await leads.changeLeadStage(ctx, nordic.id, { stage: "SAMPLING" });
  await leads.addLeadSample(ctx, nordic.id, {
    description: "Piqué polo, navy, size M, 220 GSM",
    quantity: 2,
    status: "DISPATCHED",
    courier: "DHL",
    trackingNo: "DHL-SAMPLE-0001",
    sentOn: addDays(today, -5),
  });

  // 2. Found on LinkedIn, follow-up today.
  await leads.addLead(ctx, {
    name: "Maple Uniforms Ltd",
    country: "Canada",
    category: "CORPORATE_UNIFORM",
    products: ["Polo"],
    piecesPerStyle: 1500,
    contact: { name: "David Chen", jobTitle: "Purchasing", email: "david@mapleuniforms.example" },
    sourceId: linkedin,
    nextActionOn: today,
    nextActionKind: "CALL",
    nextActionNote: "First call about their staff polos",
  });

  // 3. In talks, from a referral.
  const rhine = await leads.addLead(ctx, {
    name: "Rhine Basics GmbH",
    country: "Germany",
    category: "IMPORTER",
    products: ["T-shirt"],
    piecesPerStyle: 5000,
    targetPrice: 310,
    expectedValue: 1_550_000,
    paymentTerms: "LC",
    contact: { name: "Jonas Weber", jobTitle: "Buyer", email: "jonas@rhinebasics.example" },
    sourceId: referral,
    nextActionOn: addDays(today, 6),
    nextActionKind: "QUOTE",
  });
  await leads.changeLeadStage(ctx, rhine.id, { stage: "IN_TALKS" });

  // 4. Lost, with its reason.
  const coast = await leads.addLead(ctx, {
    name: "Coastline Promo Co",
    country: "Australia",
    category: "PROMOTIONAL",
    products: ["T-shirt"],
    piecesPerStyle: 400,
    targetPrice: 150,
    sourceId: linkedin,
    nextActionOn: addDays(today, 3),
    nextActionKind: "EMAIL",
  });
  await leads.changeLeadStage(ctx, coast.id, {
    stage: "LOST",
    reason: "Price too low for our quality",
  });

  // 5. New, from the fair.
  await leads.addLead(ctx, {
    name: "Atlas Retail Group",
    country: "United Kingdom",
    category: "RETAIL_CHAIN",
    products: ["Polo", "Hoodie"],
    sourceId: fair,
    sourceNote: "Visiting card only",
    nextActionOn: addDays(today, 2),
    nextActionKind: "EMAIL",
  });

  // A person who asked not to be contacted again.
  await leads.addSuppression(ctx, {
    kind: "EMAIL",
    value: "no-contact@unsubscribed.example",
    note: "Asked by email not to be contacted again",
  });
  return { leads: 5, late: 1 };
}

export async function loadTaSamples(ctx: CompanyContext) {
  const today = localDay(new Date(), ctx.company.timezone);
  // Ship in 36 days: the tech pack and fabric booking steps are late, fabric in-house due soon.
  const dates: Array<[string, string]> = [
    [V641_SAMPLE_ORDERS.open, addDays(today, 36)],
    [V641_SAMPLE_ORDERS.revise, addDays(today, 80)],
  ];
  let dated = 0;
  for (const [notes, ship] of dates) {
    const { count } = await prisma.salesOrder.updateMany({
      where: { companyId: ctx.company.id, notes, shipmentDate: null },
      data: { shipmentDate: dateColumn(ship) },
    });
    dated += count;
  }
  const withShip = await prisma.salesOrder.findMany({
    where: { companyId: ctx.company.id, shipmentDate: { not: null }, status: { not: "CANCELLED" } },
    select: { id: true },
  });
  const ids = withShip.map((o) => o.id);
  await syncOrderTa(ctx.company.id, ids);
  await completeFromFacts(ctx.company.id, ids, today);
  const steps = await prisma.orderTaStep.count({ where: { companyId: ctx.company.id } });
  return { dated, orders: ids.length, steps };
}
