import { Prisma } from "@prisma/client";

import { addDays, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { formatAmount } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import type { CompanyContext } from "@/modules/auth/context";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as styles from "@/modules/inventory/style.service";
import * as materials from "@/modules/materials/material.service";
import { getPartyBalance } from "@/modules/parties/ledger.service";
import * as parties from "@/modules/parties/party.service";
import * as batchIssue from "@/modules/production/batch-issue.service";
import * as batchMoney from "@/modules/production/batch-money.service";
import * as batchOrders from "@/modules/production/batch-orders.service";
import * as batches from "@/modules/production/batch.service";
import * as bookings from "@/modules/production/booking.service";
import * as contracts from "@/modules/production/contract.service";
import * as costs from "@/modules/production/cost.service";
import * as cutting from "@/modules/production/cutting.service";
import * as finishing from "@/modules/production/finishing.service";
import * as needs from "@/modules/production/material-need.service";
import * as projects from "@/modules/production/project.service";
import * as receive from "@/modules/production/receive.service";
import { type SimulationRecords, simulationRecords } from "./records";

/*
 * The Five Style Polo simulation: one master batch of 6,000 polo shirts in five
 * brand styles taken through a whole CM production cycle on the app's own
 * services, as the staff would on the screens, with the real CM rules:
 *   - master data: the embroidery house "Demo Embo" (Gazipur) and two accessories
 *     suppliers are added; the company's own active fabric supplier and CM
 *     factory are used;
 *   - the batch and its five styles (S to XXL), a target price of 450-500 a piece,
 *     the CM a piece agreed per style, the fabric (700 a kg), collar and cuff sets
 *     (70-90 a set) and eight accessories per piece, and the purchase orders;
 *   - the advance CM; the fabric received a little short of its challan (within
 *     the allowance); materials issued; 6,000+ pieces cut;
 *   - four styles embroidered and one printed at Demo Embo (10-12 a piece), with
 *     spoiled pieces taken off Demo Embo's own Supplier Due and cut again;
 *   - finishing: rejects under the 2% allowance on one style, at 3% on another
 *     (the 1% over is charged at the target price), 12 pieces missing (charged to
 *     the factory in full); the overheads "Outsourcing QC" and "Office Manpower"
 *     split over the batch; the factory's CM bills;
 *   - the full packing lists (A and B to stock) and the final CM settlement with
 *     the penalties, which posts its journal entry.
 * The run keeps a manifest of everything it made and what it found before, so
 * wipeSimulation() (tests/simulation/five-style-polo/wipe.ts) can take it all
 * away again. It loads the demo site (load-demo.ts) and runs in the GitHub
 * workflow "Production simulation" (tests/integration/five-style-polo.test.ts).
 */

export const POLO_BATCH = "Five Style Polo";
export const POLO_SIZES = ["S", "M", "L", "XL", "XXL"] as const;

/** Embroidery or print, at Demo Embo. */
type Work = "EMBROIDERY" | "PRINT";

/**
 * The five styles: the colour, the CM a piece, embroidery or print, the pieces to
 * make by size (S to XXL, 1,200 a style), the pieces Demo Embo spoils by size,
 * and what finishing finds (B, C, rejects and missing, spread over the sizes).
 * Ralph Lauren's rejects stay under the 2% allowance; Tommy's reach 3%.
 */
export const POLO_STYLES = [
  {
    code: "RL",
    brand: "Ralph Lauren",
    colour: { name: "Navy", hexCode: "#1F2A44" },
    cmRate: 95,
    work: "EMBROIDERY" as Work,
    sizes: [120, 300, 360, 300, 120],
    spoiled: [1, 2, 2, 1, 0],
    b: 18,
    c: 10,
    reject: 15,
    missing: 2,
  },
  {
    code: "TH",
    brand: "Tommy",
    colour: { name: "White", hexCode: "#FFFFFF" },
    cmRate: 90,
    work: "EMBROIDERY" as Work,
    sizes: [150, 330, 330, 270, 120],
    spoiled: [0, 1, 2, 1, 0],
    b: 20,
    c: 12,
    reject: 37,
    missing: 3,
  },
  {
    code: "CK",
    brand: "CK",
    colour: { name: "Black", hexCode: "#111111" },
    cmRate: 88,
    work: "PRINT" as Work,
    sizes: [100, 280, 380, 300, 140],
    spoiled: [0, 1, 1, 1, 1],
    b: 16,
    c: 9,
    reject: 20,
    missing: 2,
  },
  {
    code: "BS",
    brand: "Boss",
    colour: { name: "Charcoal", hexCode: "#36454F" },
    cmRate: 92,
    work: "EMBROIDERY" as Work,
    sizes: [120, 270, 360, 300, 150],
    spoiled: [1, 1, 2, 1, 0],
    b: 19,
    c: 11,
    reject: 22,
    missing: 3,
  },
  {
    code: "LC",
    brand: "Lacoste",
    colour: { name: "Bottle Green", hexCode: "#0B3D2E" },
    cmRate: 95,
    work: "EMBROIDERY" as Work,
    sizes: [140, 320, 340, 280, 120],
    spoiled: [0, 1, 1, 1, 0],
    b: 15,
    c: 8,
    reject: 18,
    missing: 2,
  },
] as const;

/** Pieces cut over the pieces to make: 2%. */
const CUT_EXTRA = 1.02;
const FABRIC = { name: "Pique 220 GSM, 100% cotton", perPiece: 0.27, wastage: 3, price: 700 };
/** Ordered, what the challan said, and what the scale said: 0.7% short, within the 2% allowance. */
const FABRIC_ORDERED_KG = 1700;
const FABRIC_RECEIVED_KG = 1688.4;
/** Issued to a style: 2% over what its pieces take; used at cutting: what they take. */
const FABRIC_ISSUE_EXTRA = 1.02;

/** The accessories of a piece, by supplier; brand-made for the main label and hand tag. */
const ACCESSORIES = [
  {
    key: "main",
    name: "Main label",
    perBrand: true,
    kind: "TRIM",
    perPiece: 1,
    price: 3.5,
    at: "trims",
  },
  {
    key: "care",
    name: "Care label",
    perBrand: false,
    kind: "TRIM",
    perPiece: 1,
    price: 1.2,
    at: "trims",
  },
  {
    key: "size",
    name: "Size label",
    perBrand: false,
    kind: "TRIM",
    perPiece: 1,
    price: 0.8,
    at: "trims",
  },
  {
    key: "button",
    name: "Polo button 18L",
    perBrand: false,
    kind: "TRIM",
    perPiece: 3,
    price: 1.5,
    at: "buttons",
  },
  {
    key: "poly",
    name: "Poly bag",
    perBrand: false,
    kind: "PACKAGING",
    perPiece: 1,
    price: 4,
    at: "buttons",
  },
  {
    key: "tag",
    name: "Hand tag",
    perBrand: true,
    kind: "ACCESSORY",
    perPiece: 1,
    price: 3,
    at: "trims",
  },
  {
    key: "tissue",
    name: "Tissue paper",
    perBrand: false,
    kind: "PACKAGING",
    perPiece: 1,
    price: 1.5,
    at: "trims",
  },
  {
    key: "silica",
    name: "Silica gel",
    perBrand: false,
    kind: "PACKAGING",
    perPiece: 1,
    price: 1,
    at: "trims",
  },
] as const;
const ACCESSORY_WASTAGE = 3;
const COLLAR_WASTAGE = 2;

/** Overheads split equally over the batch's styles. */
const OVERHEADS = [
  { head: "Outsourcing QC", amount: 45_000, method: "BANK_TRANSFER" as const },
  { head: "Office Manpower", amount: 60_000, method: "CASH" as const },
];
export const POLO_ADVANCE = 200_000;
/** Print at Demo Embo, a piece. */
const PRINT_RATE = 9;

/** The suppliers the run adds (wiped with it). */
const DEMO_SUPPLIERS = {
  embo: {
    name: "Demo Embo",
    categories: ["EMBROIDERY_PRINT"] as const,
    contactPerson: "Demo Contact",
    phone: "01700-000001",
    address: "Plot 12, BSCIC Industrial Area, Konabari",
    city: "Gazipur",
  },
  trims: {
    name: "Demo Trims House",
    categories: ["ACCESSORIES"] as const,
    contactPerson: "Demo Contact",
    phone: "01700-000002",
    address: "House 5, Road 3, Section 7, Mirpur",
    city: "Dhaka",
  },
  buttons: {
    name: "Demo Button & Poly",
    categories: ["ACCESSORIES"] as const,
    contactPerson: "Demo Contact",
    phone: "01700-000003",
    address: "Holding 22, Fatullah",
    city: "Narayanganj",
  },
};

type Party = { id: string; name: string };

/** Everything a run made, and what it found before it started (to put back on the wipe). */
export type SimulationManifest = {
  version: 1;
  scenario: "FIVE_STYLE_POLO";
  companyId: string;
  seed: number;
  batchId: string | null;
  batchCode: string | null;
  factory: Party | null;
  mill: Party | null;
  bank: { id: string; code: string; name: string } | null;
  /** The suppliers the run added: Demo Embo, the accessories suppliers. */
  added: { embo: Party | null; trims: Party | null; buttons: Party | null };
  styles: Array<{
    code: string;
    brand: string;
    projectId: string;
    projectCode: string;
    targetUnitCost: string;
    cmRate: string;
    work: Work;
    workRate: string;
    collarPrice: string;
  }>;
  /** Master data and set-up the run had to add (the company's own is reused). */
  created: {
    partyIds: string[];
    brandIds: string[];
    categoryIds: string[];
    colorIds: string[];
    sizeIds: string[];
    styleIds: string[];
    materialIds: string[];
    ledgerAccountIds: string[];
    expenseHeadIds: string[];
    warehouseIds: string[];
  };
  /** What the company had before: set-up rows (to tell what the run added) and what it touches. */
  known: { ledgerAccountIds: string[]; expenseHeadIds: string[]; warehouseIds: string[] };
  before: {
    /** Supplier Due of the factory and the fabric supplier. */
    due: Record<string, string>;
    sequences: Array<{ id: string; nextNumber: number; year: number | null }>;
    parties: Array<{ id: string; lastTransactionAt: string | null; updatedAt: string }>;
    bills: Array<{
      id: string;
      updatedAt: string;
      paidAmount: string;
      dueAmount: string;
      status: string;
    }>;
  };
  /** When the run ended: counters and the touched suppliers' last activity, put back only if unchanged since. */
  after: {
    sequences: Array<{ id: string; nextNumber: number }>;
    parties: Array<{ id: string; lastTransactionAt: string | null; updatedAt: string }>;
  } | null;
  /** The records the run left in the books when it ended (records.ts), by table. */
  made: SimulationRecords | null;
  steps: string[];
  /** Where the run stopped, when it failed. */
  error: string | null;
};

export type SimulationOptions = {
  /** Seeds the prices (target 450-500, collars 70-90, embroidery 10-12); random when left out. */
  seed?: number;
  /** Told the manifest after each step, to keep it as it goes. */
  onProgress?: (manifest: SimulationManifest) => Promise<void>;
};

/** A small seeded random number generator (mulberry32), for a repeatable run. */
function seeded(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const fixed = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value).toFixed(2);
const bdt = (value: Prisma.Decimal.Value) => `BDT ${formatAmount(value, 2, "BDT")}`;
const pcs = (n: number) => formatAmount(n, 0, "BDT");
const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** `total` spread over `weights` in whole pieces, the remainders to the largest shares. */
export function spread(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((t, w) => t + w, 0);
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((t, n) => t + n, 0);
  const order = raw
    .map((r, i) => ({ i, rest: r - Math.floor(r) }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i]! += 1;
    left -= 1;
  }
  return out;
}

/** Each style's pieces by size: to make, cut, spoiled at Demo Embo and graded at finishing. */
export function poloPlan(style: (typeof POLO_STYLES)[number]) {
  const cut = style.sizes.map((n) => Math.round(n * CUT_EXTRA));
  const b = spread(style.b, cut);
  const c = spread(style.c, cut);
  const reject = spread(style.reject, cut);
  const missing = spread(style.missing, cut);
  return POLO_SIZES.map((size, i) => ({
    size,
    target: style.sizes[i]!,
    cut: cut[i]!,
    spoiled: style.spoiled[i]!,
    a: cut[i]! - b[i]! - c[i]! - reject[i]! - missing[i]!,
    b: b[i]!,
    c: c[i]!,
    reject: reject[i]!,
    missing: missing[i]!,
  }));
}

async function supplierDue(ctx: CompanyContext, partyId: string) {
  return (await getPartyBalance(ctx, partyId)).neg().toFixed(2);
}

/** The company's active supplier for a category: the one with the most bills, then the oldest. */
async function activeSupplier(companyId: string, category: "CM" | "FABRIC", not?: string) {
  const found = await prisma.party.findMany({
    where: {
      companyId,
      kind: "SUPPLIER",
      status: "ACTIVE",
      supplierCategories: { has: category },
      ...(not ? { id: { not } } : {}),
    },
    select: { id: true, name: true, _count: { select: { supplierBills: true } } },
    orderBy: { createdAt: "asc" },
  });
  found.sort((a, b) => b._count.supplierBills - a._count.supplierBills);
  return found[0] ? { id: found[0].id, name: found[0].name } : null;
}

/** The bank account the advance and the QC are paid from: a real bank account first, else the main Bank. */
async function bankLedger(companyId: string) {
  const bank = await prisma.bankAccount.findFirst({
    where: { companyId, isActive: true },
    select: { ledgerAccount: { select: { id: true, code: true, name: true, isActive: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (bank?.ledgerAccount?.isActive) {
    const { id, code, name } = bank.ledgerAccount;
    return { id, code, name };
  }
  return prisma.ledgerAccount.findFirst({
    where: { companyId, subType: "BANK", isActive: true },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });
}

const ids = async (rows: Promise<Array<{ id: string }>>) => (await rows).map((r) => r.id);

/** The company's set-up rows now (ledger accounts, cost heads, warehouses). */
async function setUpIds(companyId: string) {
  return {
    ledgerAccountIds: await ids(
      prisma.ledgerAccount.findMany({ where: { companyId }, select: { id: true } }),
    ),
    expenseHeadIds: await ids(
      prisma.expenseHead.findMany({ where: { companyId }, select: { id: true } }),
    ),
    warehouseIds: await ids(
      prisma.warehouse.findMany({ where: { companyId }, select: { id: true } }),
    ),
  };
}

/** Closes a manifest: the set-up the run added, and the counters and activity it left. */
async function close(m: SimulationManifest) {
  const now = await setUpIds(m.companyId);
  const added = (all: string[], known: string[]) => {
    const was = new Set(known);
    return all.filter((id) => !was.has(id));
  };
  m.created.ledgerAccountIds = added(now.ledgerAccountIds, m.known.ledgerAccountIds);
  m.created.expenseHeadIds = added(now.expenseHeadIds, m.known.expenseHeadIds);
  m.created.warehouseIds = added(now.warehouseIds, m.known.warehouseIds);
  m.after = {
    sequences: await prisma.documentSequence.findMany({
      where: { companyId: m.companyId },
      select: { id: true, nextNumber: true },
    }),
    parties: (
      await prisma.party.findMany({
        where: { id: { in: m.before.parties.map((p) => p.id) } },
        select: { id: true, lastTransactionAt: true, updatedAt: true },
      })
    ).map((p) => ({
      id: p.id,
      lastTransactionAt: p.lastTransactionAt?.toISOString() ?? null,
      updatedAt: p.updatedAt.toISOString(),
    })),
  };
  m.made = await simulationRecords({
    companyId: m.companyId,
    batchId: m.batchId,
    partyIds: m.created.partyIds,
    styleIds: m.created.styleIds,
  });
}

/**
 * What a run needs, checked before it starts: no earlier run still on the books,
 * and the company's own active CM factory, fabric supplier and bank account.
 */
export async function fiveStylePoloSetUp(companyId: string) {
  if (await prisma.productionBatch.findFirst({ where: { companyId, name: POLO_BATCH } })) {
    throw new AppError(
      "CONFLICT",
      `A "${POLO_BATCH}" batch is there already. Wipe the earlier simulation first.`,
    );
  }
  if (await prisma.party.findFirst({ where: { companyId, name: DEMO_SUPPLIERS.embo.name } })) {
    throw new AppError(
      "CONFLICT",
      `A supplier named "${DEMO_SUPPLIERS.embo.name}" is there already. Wipe the earlier simulation first.`,
    );
  }
  const factory = await activeSupplier(companyId, "CM");
  if (!factory) throw new AppError("VALIDATION", "Add an active CM factory (a supplier) first.");
  const mill = await activeSupplier(companyId, "FABRIC", factory.id);
  if (!mill) throw new AppError("VALIDATION", "Add an active fabric supplier first.");
  const bank = await bankLedger(companyId);
  if (!bank) throw new AppError("VALIDATION", "Add a bank account first.");
  return { factory, mill, bank };
}

/**
 * Runs the whole scenario as `ctx` (a Super Admin, who may do every step).
 * Refuses when a Five Style Polo batch is there already: wipe it first. When a
 * step fails, the manifest so far is kept (with the error) so the wipe can take
 * away what was made, and the error is thrown on.
 */
export async function runFiveStylePolo(
  ctx: CompanyContext,
  options: SimulationOptions = {},
): Promise<SimulationManifest> {
  const companyId = ctx.company.id;
  const seed = options.seed ?? Date.now() % 2_147_483_647;
  const random = seeded(seed);
  const today = localDay(new Date(), ctx.company.timezone);

  // 0. The real suppliers and accounts, and what they stand at now.
  const { factory, mill, bank } = await fiveStylePoloSetUp(companyId);
  const touched = [factory.id, mill.id];
  const m: SimulationManifest = {
    version: 1,
    scenario: "FIVE_STYLE_POLO",
    companyId,
    seed,
    batchId: null,
    batchCode: null,
    factory,
    mill,
    bank,
    added: { embo: null, trims: null, buttons: null },
    styles: [],
    created: {
      partyIds: [],
      brandIds: [],
      categoryIds: [],
      colorIds: [],
      sizeIds: [],
      styleIds: [],
      materialIds: [],
      ledgerAccountIds: [],
      expenseHeadIds: [],
      warehouseIds: [],
    },
    known: await setUpIds(companyId),
    before: {
      due: {
        [factory.id]: await supplierDue(ctx, factory.id),
        [mill.id]: await supplierDue(ctx, mill.id),
      },
      sequences: await prisma.documentSequence.findMany({
        where: { companyId },
        select: { id: true, nextNumber: true, year: true },
      }),
      parties: (
        await prisma.party.findMany({
          where: { id: { in: touched } },
          select: { id: true, lastTransactionAt: true, updatedAt: true },
        })
      ).map((p) => ({
        id: p.id,
        lastTransactionAt: p.lastTransactionAt?.toISOString() ?? null,
        updatedAt: p.updatedAt.toISOString(),
      })),
      bills: (
        await prisma.supplierBill.findMany({
          where: { companyId, supplierId: { in: touched } },
          select: { id: true, paidAmount: true, dueAmount: true, status: true, updatedAt: true },
        })
      ).map((b) => ({
        id: b.id,
        paidAmount: fixed(b.paidAmount),
        dueAmount: fixed(b.dueAmount),
        status: b.status,
        updatedAt: b.updatedAt.toISOString(),
      })),
    },
    after: null,
    made: null,
    steps: [],
    error: null,
  };
  const step = async (text: string) => {
    m.steps.push(text);
    await options.onProgress?.(m);
  };
  await step(
    `Found the factory ${factory.name}, the fabric supplier ${mill.name} and the bank account ${bank.code} ${bank.name}.`,
  );

  try {
    await runSteps(ctx, m, { random, today, factory, mill, bank, step });
  } catch (error) {
    m.error = error instanceof Error ? error.message : String(error);
    await close(m);
    await options.onProgress?.(m);
    throw error;
  }
  await close(m);
  await options.onProgress?.(m);
  return m;
}

async function runSteps(
  ctx: CompanyContext,
  m: SimulationManifest,
  env: {
    random: () => number;
    today: string;
    factory: Party;
    mill: Party;
    bank: { id: string; code: string; name: string };
    step: (text: string) => Promise<void>;
  },
) {
  const { random, today, factory, mill, bank, step } = env;
  const companyId = ctx.company.id;
  const created = m.created;
  const insensitive = (name: string) => ({ equals: name, mode: "insensitive" as const });

  // 1. Master data: Demo Embo (Gazipur) and two accessories suppliers.
  const supplier = async (s: (typeof DEMO_SUPPLIERS)[keyof typeof DEMO_SUPPLIERS]) => {
    const { party } = await parties.createParty(ctx, {
      kind: "SUPPLIER",
      name: s.name,
      contactPerson: s.contactPerson,
      phone: s.phone,
      address: s.address,
      city: s.city,
      country: "Bangladesh",
      supplierCategories: [...s.categories],
      notes: "Made by the Five Style Polo simulation; wiped with it.",
    });
    created.partyIds.push(party.id);
    return { id: party.id, name: party.name };
  };
  const embo = await supplier(DEMO_SUPPLIERS.embo);
  m.added.embo = embo;
  const trims = await supplier(DEMO_SUPPLIERS.trims);
  m.added.trims = trims;
  const buttons = await supplier(DEMO_SUPPLIERS.buttons);
  m.added.buttons = buttons;
  await step(
    `Added the embroidery and print house ${embo.name} (Gazipur) and the accessories suppliers ${trims.name} and ${buttons.name}.`,
  );

  // 2. The catalogue: reused when the company has it, added otherwise.
  const sizeIds: string[] = [];
  for (const size of POLO_SIZES) {
    const found = await prisma.size.findFirst({ where: { companyId, name: insensitive(size) } });
    if (found) sizeIds.push(found.id);
    else {
      const made = await catalog.createSize(ctx, { name: size });
      created.sizeIds.push(made.id);
      sizeIds.push(made.id);
    }
  }
  const sizeName = new Map(
    (await prisma.size.findMany({ where: { id: { in: sizeIds } } })).map((s) => [
      s.name.toUpperCase(),
      s.name,
    ]),
  );
  let category = await prisma.category.findFirst({
    where: { companyId, name: insensitive("Polo Shirts") },
  });
  if (!category) {
    category = await catalog.createCategory(ctx, { name: "Polo Shirts" });
    created.categoryIds.push(category.id);
  }
  const colours = new Map<string, { id: string; name: string }>();
  for (const s of POLO_STYLES) {
    let colour = await prisma.color.findFirst({
      where: { companyId, name: insensitive(s.colour.name) },
    });
    if (!colour) {
      colour = await catalog.createColor(ctx, s.colour);
      created.colorIds.push(colour.id);
    }
    colours.set(s.code, { id: colour.id, name: colour.name });
  }

  // 3. Materials: the fabric, a collar and cuff set per colour, and the accessories.
  const material = async (input: {
    name: string;
    kind: "FABRIC" | "TRIM" | "ACCESSORY" | "PACKAGING";
    unit: "KG" | "PCS" | "SET";
    supplierId: string;
    color?: string;
    specification?: string;
  }) => {
    const made = await materials.createMaterial(ctx, {
      ...input,
      notes: "Five Style Polo simulation",
    });
    created.materialIds.push(made.id);
    return made.id;
  };
  const fabricId = await material({
    name: `${FABRIC.name} (Five Style Polo)`,
    kind: "FABRIC",
    unit: "KG",
    specification: "Pique 220 GSM, 100% cotton, dyed to colour",
    supplierId: mill.id,
  });
  const collarIds = new Map<string, string>();
  const collarPrice = new Map<string, number>();
  for (const s of POLO_STYLES) {
    collarIds.set(
      s.code,
      await material({
        name: `Collar & cuff set, ${s.colour.name} (Five Style Polo)`,
        kind: "TRIM",
        unit: "SET",
        color: s.colour.name,
        specification: "Flat knit collar and two cuffs",
        supplierId: mill.id,
      }),
    );
    collarPrice.set(s.code, round2(70 + random() * 20));
  }
  const accessoryIds = new Map<string, string>();
  for (const a of ACCESSORIES) {
    const supplierId = a.at === "trims" ? trims.id : buttons.id;
    if (a.perBrand) {
      for (const s of POLO_STYLES) {
        accessoryIds.set(
          `${a.key}|${s.code}`,
          await material({
            name: `${a.name}, ${s.brand} (Five Style Polo)`,
            kind: a.kind,
            unit: "PCS",
            supplierId,
          }),
        );
      }
    } else {
      accessoryIds.set(
        a.key,
        await material({
          name: `${a.name} (Five Style Polo)`,
          kind: a.kind,
          unit: "PCS",
          supplierId,
        }),
      );
    }
  }
  const accessoryOf = (key: string, code: string) =>
    accessoryIds.get(`${key}|${code}`) ?? accessoryIds.get(key)!;
  await step(
    `Added ${pcs(created.materialIds.length)} materials: the fabric (${FABRIC.name}, ${bdt(FABRIC.price)} a kg), a collar and cuff set per colour and ${ACCESSORIES.length} accessories a piece.`,
  );

  // 4. The master batch and its five styles of 1,200 pieces, S to XXL.
  const targetDate = addDays(today, 50);
  const batch = await batches.createBatch(ctx, {
    name: POLO_BATCH,
    factoryId: factory.id,
    targetDate,
    rejectTolerancePercent: 2,
    notes: "Made by the Five Style Polo simulation (6,000 pieces, five styles). Wiped with it.",
  });
  m.batchId = batch.id;
  m.batchCode = batch.code;
  await step(
    `Opened the master batch ${batch.code} "${POLO_BATCH}" at ${factory.name}: 6,000 pieces, all done by ${targetDate}, rejects allowed up to 2% of the pieces cut.`,
  );
  for (const s of POLO_STYLES) {
    let brand = await prisma.brand.findFirst({ where: { companyId, name: insensitive(s.brand) } });
    if (!brand) {
      brand = await catalog.createBrand(ctx, { name: s.brand });
      created.brandIds.push(brand.id);
    }
    const colour = colours.get(s.code)!;
    const style = await styles.createStyle(ctx, {
      code: `FSP-${s.code}`,
      name: `${s.brand} Pique Polo`,
      categoryId: category.id,
      brandId: brand.id,
      fabric: FABRIC.name,
      retailPrice: 2450,
      wholesalePrice: 1450,
    });
    created.styleIds.push(style.id);
    await matrix.generateMatrix(ctx, style.id, { colorIds: [colour.id], sizeIds });
    const variants = await prisma.productVariant.findMany({
      where: { styleId: style.id },
      select: { id: true, size: { select: { name: true } } },
    });
    const sku = (size: string) => variants.find((v) => v.size.name.toUpperCase() === size)!.id;
    const targetUnitCost = round2(450 + random() * 50);
    const project = await projects.createProject(ctx, {
      name: `${s.brand} pique polo`,
      batchId: batch.id,
      styleId: style.id,
      categoryId: category.id,
      factoryId: factory.id,
      targetDate,
      targetUnitCost,
      targets: POLO_SIZES.map((size, i) => ({ variantId: sku(size), quantity: s.sizes[i]! })),
    });
    const workRate = s.work === "PRINT" ? PRINT_RATE : round2(10 + random() * 2);
    m.styles.push({
      code: s.code,
      brand: s.brand,
      projectId: project.id,
      projectCode: project.code,
      targetUnitCost: fixed(targetUnitCost),
      cmRate: fixed(s.cmRate),
      work: s.work,
      workRate: fixed(workRate),
      collarPrice: fixed(collarPrice.get(s.code)!),
    });
    await needs.setMaterialNeeds(ctx, project.id, {
      needs: [
        {
          materialId: fabricId,
          perPiece: FABRIC.perPiece,
          wastagePercent: FABRIC.wastage,
          split: "COLOUR",
          placement: "Body",
        },
        {
          materialId: collarIds.get(s.code)!,
          perPiece: 1,
          wastagePercent: COLLAR_WASTAGE,
          placement: "Collar and cuffs",
        },
        ...ACCESSORIES.map((a) => ({
          materialId: accessoryOf(a.key, s.code),
          perPiece: a.perPiece,
          wastagePercent: ACCESSORY_WASTAGE,
          placement: a.name,
        })),
      ],
    });
  }
  await step(
    `Added the five styles, 1,200 pieces each in S, M, L, XL and XXL: ${m.styles
      .map((s) => `${s.projectCode} ${s.brand} (target ${bdt(s.targetUnitCost)} a piece)`)
      .join(", ")}.`,
  );

  // 5. The factory agreement with each style's CM a piece, signed today.
  const agreement = await contracts.createContract(ctx, batch.id, {
    kind: "FACTORY_CM",
    partyId: factory.id,
  });
  const drafted = await contracts.getContractScreen(ctx, agreement.id);
  await contracts.updateContract(ctx, agreement.id, {
    clauses: drafted.contract.clauses,
    signedOn: today,
    cmRates: m.styles.map((s) => ({ projectId: s.projectId, cmRate: Number(s.cmRate) })),
  });
  await step(
    `Signed the factory CM agreement: ${m.styles.map((s) => `${s.brand} ${bdt(s.cmRate)}`).join(", ")} a piece.`,
  );

  // 6. The purchase orders, one per supplier.
  const plans = new Map<string, ReturnType<typeof poloPlan>>(
    POLO_STYLES.map((s) => [s.code, poloPlan(s)]),
  );
  const cutOf = (code: string) => plans.get(code)!.reduce((t, z) => t + z.cut, 0);
  const spoiledOf = (code: string) => plans.get(code)!.reduce((t, z) => t + z.spoiled, 0);
  const allCut = POLO_STYLES.reduce((t, s) => t + cutOf(s.code), 0);
  /** What a style's cutting takes (spoiled pieces cut again included), with the wastage allowed. */
  const needOf = (code: string, perPiece: number, wastage: number) =>
    Math.ceil((cutOf(code) + spoiledOf(code)) * perPiece * (1 + wastage / 100));
  /** Ordered: what the styles take, rounded up to tens. */
  const orderOf = (needs: number[]) => Math.ceil(needs.reduce((t, n) => t + n, 0) / 10) * 10;
  const accessoryLines = (
    at: "trims" | "buttons",
  ): Array<{ materialId: string; quantity: number; unitPrice: number }> =>
    ACCESSORIES.filter((a) => a.at === at).flatMap((a) =>
      a.perBrand
        ? POLO_STYLES.map((s): { materialId: string; quantity: number; unitPrice: number } => ({
            materialId: accessoryOf(a.key, s.code),
            quantity: orderOf([needOf(s.code, a.perPiece, ACCESSORY_WASTAGE)]),
            unitPrice: a.price,
          }))
        : [
            {
              materialId: accessoryIds.get(a.key)!,
              quantity: orderOf(
                POLO_STYLES.map((s) => needOf(s.code, a.perPiece, ACCESSORY_WASTAGE)),
              ),
              unitPrice: a.price,
            },
          ],
    );
  // The fabric (and the collar sets knitted with it) is booked with the mill: a batch's
  // fabric always is. The accessories go on the batch's own purchase orders.
  await bookings.createBooking(ctx, {
    source: "SUPPLIER_PO",
    category: "KNITWEAR",
    supplierId: mill.id,
    batchId: batch.id,
    expectedDate: addDays(today, 10),
    title: POLO_BATCH,
    styleRef: POLO_STYLES.map((s) => s.code).join(", "),
    lines: [
      {
        materialId: fabricId,
        quantity: FABRIC_ORDERED_KG,
        unitPrice: FABRIC.price,
        specs: {
          role: "FABRIC",
          fabricType: "Pique",
          composition: "100% cotton",
          weight: 220,
          weightUnit: "GSM",
          diaType: "OPEN",
        },
      },
      ...POLO_STYLES.map((s) => ({
        materialId: collarIds.get(s.code)!,
        quantity: orderOf([needOf(s.code, 1, COLLAR_WASTAGE)]),
        unitPrice: collarPrice.get(s.code)!,
        specs: { role: "COLLAR" as const, colour: s.colour.name },
      })),
    ],
  });
  await batchOrders.createBatchOrders(ctx, batch.id, {
    orders: [
      { supplierId: trims.id, expectedDate: addDays(today, 12), lines: accessoryLines("trims") },
      {
        supplierId: buttons.id,
        expectedDate: addDays(today, 12),
        lines: accessoryLines("buttons"),
      },
    ],
  });
  const orders = await prisma.purchaseOrder.findMany({
    where: { companyId, batchId: batch.id },
    select: { id: true, number: true, supplierId: true, totalAmount: true },
  });
  await step(
    `Sent ${orders.length} purchase orders: ${orders
      .map((o) => {
        const to = [mill, trims, buttons].find((p) => p.id === o.supplierId)!;
        return `${o.number} to ${to.name} (${bdt(o.totalAmount)})`;
      })
      .join(", ")}.`,
  );

  // 7. The advance CM to the factory, from the bank.
  const advance = await batchMoney.payForBatch(ctx, batch.id, {
    amount: POLO_ADVANCE,
    method: "BANK_TRANSFER",
    accountId: bank.id,
    reference: "FSP-ADVANCE",
  });
  await step(`Paid the advance CM ${advance.number}: ${bdt(POLO_ADVANCE)} to ${factory.name}.`);

  // 8. Receiving: the fabric 0.7% short of its challan (within the 2% allowance), the rest in full.
  for (const order of orders) {
    const screen = await receive.getBatchReceive(ctx, batch.id, order.id);
    await receive.receiveBatchDelivery(ctx, batch.id, {
      orderId: order.id,
      supplierRef: `FSP-CHALLAN-${order.number}`,
      lines: screen.order!.lines.map((l) => {
        const ordered = Number(l.toCome);
        const actual = l.material.id === fabricId ? FABRIC_RECEIVED_KG : ordered;
        return { lineId: l.id, challanQuantity: ordered, quantity: actual };
      }),
    });
  }
  await step(
    `Received everything: the fabric weighed ${formatAmount(FABRIC_RECEIVED_KG, 1, "BDT")} kg against a challan of ${pcs(FABRIC_ORDERED_KG)} kg (${round2(((FABRIC_ORDERED_KG - FABRIC_RECEIVED_KG) / FABRIC_ORDERED_KG) * 100)}% short, within the 2% allowance, so no fault), the collars and accessories in full. Each delivery became the supplier's bill.`,
  );

  // 9. The store issues each style its fabric, collars and accessories.
  const issueLines = POLO_STYLES.flatMap((s) => {
    const projectId = m.styles.find((x) => x.code === s.code)!.projectId;
    const cut = cutOf(s.code);
    return [
      {
        projectId,
        materialId: fabricId,
        colorName: colours.get(s.code)!.name,
        quantity: round3(Math.round(cut * FABRIC.perPiece * FABRIC_ISSUE_EXTRA * 10) / 10),
      },
      {
        projectId,
        materialId: collarIds.get(s.code)!,
        quantity: needOf(s.code, 1, COLLAR_WASTAGE),
      },
      ...ACCESSORIES.map((a) => ({
        projectId,
        materialId: accessoryOf(a.key, s.code),
        quantity: needOf(s.code, a.perPiece, ACCESSORY_WASTAGE),
      })),
    ];
  });
  await batchIssue.issueToStyles(ctx, batch.id, {
    receivedBy: "Cutting master and the factory's store (simulation)",
    lines: issueLines,
  });
  await step(
    `Issued each style its fabric (2% over what its pieces take), and its collar and cuff sets and accessories with the wastage allowed (2% and 3%): ${pcs(issueLines.length)} lines.`,
  );

  // 10. Cutting: 2% over the pieces to make.
  for (const s of m.styles) {
    const colour = colours.get(s.code)!.name;
    const plan = plans.get(s.code)!;
    const cut = cutOf(s.code);
    await cutting.createCuttingReport(ctx, s.projectId, {
      lines: plan.map((z) => ({
        colorName: colour,
        sizeName: sizeName.get(z.size)!,
        quantity: z.cut,
      })),
      fabricUsed: [{ materialId: fabricId, quantity: round3(cut * FABRIC.perPiece) }],
      note: "Five Style Polo cutting",
    });
  }
  await step(
    `Cut ${pcs(allCut)} pieces: ${m.styles.map((s) => `${s.brand} ${pcs(cutOf(s.code))}`).join(", ")}.`,
  );

  // 11. Embroidery and print at Demo Embo: spoiled pieces come off Demo Embo's own
  //     Supplier Due and are cut again at once; Demo Embo bills the good pieces.
  await costs.ensureProductionCostHeads(companyId);
  const head = async (name: string) => {
    const found = await prisma.expenseHead.findFirst({
      where: { companyId, name: insensitive(name), isProductionCost: true },
    });
    if (found) return found;
    return costs.createCostHead(ctx, { name });
  };
  const embroideryHead = await head("Print & Embroidery");
  let spoiledValue = new Prisma.Decimal(0);
  for (const s of m.styles) {
    const colour = colours.get(s.code)!.name;
    const plan = plans.get(s.code)!;
    const job = await cutting.sendToEmbroidery(ctx, s.projectId, {
      kind: s.work,
      partyId: embo.id,
      dueOn: addDays(today, 7),
      lines: plan.map((z) => ({
        colorName: colour,
        sizeName: sizeName.get(z.size)!,
        quantity: z.cut,
      })),
      note: s.work === "PRINT" ? "Chest print" : "Chest logo embroidery",
    });
    const back = await cutting.receiveFromEmbroidery(ctx, job.id, {
      lines: plan.map((z) => ({
        colorName: colour,
        sizeName: sizeName.get(z.size)!,
        received: z.cut - z.spoiled,
        spoiled: z.spoiled,
      })),
    });
    if (back.charged?.amount) spoiledValue = spoiledValue.plus(back.charged.amount);
    await cutting.replaceFromCutting(ctx, job.id, {
      lines: plan
        .filter((z) => z.spoiled > 0)
        .map((z) => ({ colorName: colour, sizeName: sizeName.get(z.size)!, quantity: z.spoiled })),
    });
    const good = cutOf(s.code) - spoiledOf(s.code);
    await costs.addProjectCost(ctx, s.projectId, {
      expenseHeadId: embroideryHead.id,
      amount: round2(good * Number(s.workRate)),
      paymentType: "DUE",
      supplierId: embo.id,
      supplierRef: `FSP-EMB-${s.code}`,
      description: `${s.work === "PRINT" ? "Print" : "Embroidery"}: ${pcs(good)} pieces at ${s.workRate}`,
    });
  }
  const spoiledAll = POLO_STYLES.reduce((t, s) => t + spoiledOf(s.code), 0);
  await step(
    `Sent every cut piece to ${embo.name}: four styles embroidered at ${m.styles
      .filter((s) => s.work === "EMBROIDERY")
      .map((s) => bdt(s.workRate))
      .join(
        ", ",
      )} a piece, ${m.styles.find((s) => s.work === "PRINT")!.brand} printed at ${bdt(PRINT_RATE)}. ${pcs(spoiledAll)} pieces came back spoiled: ${bdt(spoiledValue)} came off ${embo.name}'s own Supplier Due (never the factory's), and they were cut again at once.`,
  );

  // 12. Finishing: graded A, B and C with rejects (sewing faults, bodies ruined
  //     attaching accessories) apart.
  for (const s of m.styles) {
    const colour = colours.get(s.code)!.name;
    await finishing.createFinishingCount(ctx, s.projectId, {
      lines: plans.get(s.code)!.map((z) => ({
        colorName: colour,
        sizeName: sizeName.get(z.size)!,
        a: z.a,
        b: z.b,
        c: z.c,
        reject: z.reject,
      })),
    });
  }
  await step(
    `Graded at finishing: ${POLO_STYLES.map((s) => {
      const pct = round2((s.reject / cutOf(s.code)) * 100);
      return `${s.brand} ${s.reject} rejects (${pct}%)`;
    }).join(", ")}.`,
  );

  // 13. The overheads, split equally over the five styles.
  for (const o of OVERHEADS) {
    const h = await head(o.head);
    await costs.addBatchCost(ctx, batch.id, {
      expenseHeadId: h.id,
      amount: o.amount,
      paymentType: "CASH_BANK",
      method: o.method,
      ...(o.method === "BANK_TRANSFER" ? { accountId: bank.id } : {}),
      split: "EQUAL",
      reference: `FSP-${o.head.toUpperCase().replace(/[^A-Z]+/g, "-")}`,
      description: `${o.head} for ${POLO_BATCH}`,
    });
  }
  await step(
    `Logged the overheads, split equally over the five styles: ${OVERHEADS.map(
      (o) => `${o.head} ${bdt(o.amount)} (${o.method === "CASH" ? "cash" : "bank"})`,
    ).join(", ")}.`,
  );

  // 14. The factory's CM bills: the CM a piece times the pieces it handed over (A+B+C+rejects).
  const sewing = await head("Sewing (CM)");
  for (const s of m.styles) {
    const handed = plans.get(s.code)!.reduce((t, z) => t + z.a + z.b + z.c + z.reject, 0);
    await costs.addProjectCost(ctx, s.projectId, {
      expenseHeadId: sewing.id,
      amount: round2(handed * Number(s.cmRate)),
      paymentType: "DUE",
      supplierId: factory.id,
      supplierRef: `FSP-CM-${s.code}`,
      description: `CM: ${pcs(handed)} pieces at ${s.cmRate}`,
    });
  }
  await step(
    `Entered ${factory.name}'s CM bills: each style's CM a piece times the pieces handed over.`,
  );

  // 15. The full packing lists: A and B to stock, missing pieces into the factory's fault log.
  for (const s of m.styles) {
    const colour = colours.get(s.code)!.name;
    await finishing.receivePackingList(ctx, s.projectId, {
      missing: plans
        .get(s.code)!
        .map((z) => ({ colorName: colour, sizeName: sizeName.get(z.size)!, quantity: z.missing })),
      note: "Five Style Polo full packing list",
    });
  }
  const stocked = POLO_STYLES.reduce(
    (t, s) => t + plans.get(s.code)!.reduce((n, z) => n + z.a + z.b, 0),
    0,
  );
  const missing = POLO_STYLES.reduce((t, s) => t + s.missing, 0);
  await step(
    `Received the full packing lists: ${pcs(stocked)} A and B pieces to stock, ${pcs(missing)} missing (charged to ${factory.name} in full, at the final unit cost).`,
  );

  // 16. The final CM settlement with the penalties, the C-grade CM taken off: it posts its entry.
  const settled = await batchMoney.settleCm(ctx, batch.id, {
    deductCGrade: true,
    note: "Five Style Polo settlement (simulation)",
  });
  await step(
    `Saved the final CM settlement ${settled.number}: ${bdt(settled.deducted)} of penalties and deductions came off ${factory.name}'s Supplier Due on ${settled.entry}; final payable ${bdt(settled.payable)}.`,
  );
}
