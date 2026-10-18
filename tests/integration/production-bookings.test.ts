import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Bookings (Production > Bookings): fabric and trims booked on their own or
 * for a master batch, a supplier PO or a market purchase, with the specification
 * of the garment family, the fabric calculator, the collar and cuff matrix and
 * strict terms in English or Bengali; attached to a batch and taken off it,
 * changed until goods arrive, printed for the supplier, and kept to the roles
 * that may see and make them. Changes go through the Server Actions the screens
 * call, as each role.
 */
const browser = vi.hoisted(() => ({ cookies: new Map<string, string>(), headers: new Headers() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      browser.cookies.has(name) ? { name, value: browser.cookies.get(name)! } : undefined,
    set: (name: string, value: string) => void browser.cookies.set(name, value),
    delete: (name: string) => void browser.cookies.delete(name),
  }),
  headers: async () => browser.headers,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

import { SESSION_COOKIE } from "@/lib/auth/session-cookie";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { ActionResult } from "@/lib/result";
import { createSession } from "@/modules/auth/session.service";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as styles from "@/modules/inventory/style.service";
import * as materials from "@/modules/materials/material.service";
import * as orders from "@/modules/materials/purchase-order.service";
import * as purchases from "@/modules/materials/purchase.service";
import * as materialsScreens from "@/modules/materials/screens.service";
import * as parties from "@/modules/parties/party.service";
import * as batches from "@/modules/production/batch.service";
import { bookingDocument, bookingPdf } from "@/modules/production/booking-pdf.service";
import * as bookings from "@/modules/production/booking.service";
import { standardTermsText } from "@/modules/production/booking-terms";
import * as materialScreens from "@/modules/production/material-screens.service";
import * as projects from "@/modules/production/project.service";
import * as roles from "@/modules/rbac/role.service";
import {
  attachBookingAction,
  createBookingAction,
  detachBookingAction,
  getBookingFormAction,
  listAttachableBatchesAction,
  listBookingsAction,
} from "@/server/actions/booking.actions";
import { setMaterialNeedsAction } from "@/server/actions/production.actions";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const ROLES = {
  owner: "SUPER_ADMIN",
  production: "PRODUCTION_MANAGER",
  store: "WAREHOUSE_TEAM",
  sales: "SALES_EXECUTIVE",
} as const;
type Who = keyof typeof ROLES;

function data<T>(result: ActionResult<T>, label: string): T {
  if (!result.ok) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

/**
 * Extas with one person per role; a polo in Navy and White × S M L; a batch
 * with that polo (by colour and size) and a tee (a total only); a mill, a trims
 * house and a market seller; jersey and buttons in the catalogue.
 */
async function setup() {
  const { company, roles } = await makeCompany("Extas");
  const people = {} as Record<Who, { id: string }>;
  for (const [who, role] of Object.entries(ROLES) as Array<[Who, keyof typeof roles]>) {
    const user = await makeUser(`${who}@extas.test`);
    await addToCompany(user.id, company.id, roles[role]);
    people[who] = user;
  }
  const owner = await contextFor(people.owner.id, company.id);
  const pm = await contextFor(people.production.id, company.id);
  const store = await contextFor(people.store.id, company.id);
  const sizes = [];
  for (const name of ["S", "M", "L"]) sizes.push(await catalog.createSize(owner, { name }));
  const navy = await catalog.createColor(owner, { name: "Navy", hexCode: "#1f2a44" });
  const white = await catalog.createColor(owner, { name: "White", hexCode: "#FFFFFF" });
  const polos = await catalog.createCategory(owner, { name: "Polo shirts" });
  const style = await styles.createStyle(owner, {
    code: "EX-PL-001",
    name: "Classic Polo",
    categoryId: polos.id,
    retailPrice: 1450,
    wholesalePrice: 900,
  });
  await matrix.generateMatrix(owner, style.id, {
    colorIds: [navy.id, white.id],
    sizeIds: sizes.map((s) => s.id),
  });
  const variants = await prisma.productVariant.findMany({
    where: { styleId: style.id },
    include: { size: true, color: true },
  });
  const sku = (color: string, size: string) =>
    variants.find((v) => v.color.name === color && v.size.name === size)!.id;
  const supplier = async (name: string) =>
    (await parties.createParty(owner, { kind: "SUPPLIER", name })).party;
  const mill = await supplier("Narayanganj Fabrics");
  const trims = await supplier("Dhaka Trims House");
  const seller = await supplier("Islampur Cloth Store");
  const knit = await supplier("Gazipur Knit Factory");
  const jersey = await materials.createMaterial(pm, {
    name: "Single Jersey 180 GSM",
    kind: "FABRIC",
    unit: "KG",
    supplierId: mill.id,
  });
  const buttons = await materials.createMaterial(pm, {
    name: "Polo Button 18L",
    kind: "TRIM",
    unit: "PCS",
    supplierId: trims.id,
  });
  const batch = await batches.createBatch(pm, {
    name: "Winter 2026",
    factoryId: knit.id,
    targetDate: "2026-12-20",
  });
  const polo = await projects.createProject(pm, {
    name: "Brand A polo",
    batchId: batch.id,
    targetDate: "2026-12-20",
    targets: [
      { variantId: sku("Navy", "S"), quantity: 20 },
      { variantId: sku("Navy", "M"), quantity: 40 },
      { variantId: sku("Navy", "L"), quantity: 40 },
      { variantId: sku("White", "S"), quantity: 10 },
      { variantId: sku("White", "M"), quantity: 20 },
      { variantId: sku("White", "L"), quantity: 10 },
    ],
  });
  const tee = await projects.createProject(pm, {
    name: "Brand B tee",
    batchId: batch.id,
    targetDate: "2026-12-20",
    targetQuantity: 50,
  });
  return {
    company,
    people,
    owner,
    pm,
    store,
    mill,
    trims,
    seller,
    jersey,
    buttons,
    batch,
    polo,
    tee,
  };
}

type Env = Awaited<ReturnType<typeof setup>>;

async function signInAs(env: Env, who: Who) {
  const { token } = await createSession(env.people[who].id, env.company.id);
  browser.cookies.set(SESSION_COOKIE, token);
}

/** The polo takes jersey by colour (+5%) and 3 buttons; the tee jersey and buttons. */
async function giveNeeds(env: Env) {
  await signInAs(env, "production");
  data(
    await setMaterialNeedsAction(env.polo.id, {
      needs: [
        {
          materialId: env.jersey.id,
          perPiece: 0.285,
          wastagePercent: 5,
          split: "COLOUR",
          placement: "Main body",
        },
        { materialId: env.buttons.id, perPiece: 3, placement: "Button" },
      ],
    }),
    "polo needs",
  );
  data(
    await setMaterialNeedsAction(env.tee.id, {
      needs: [
        { materialId: env.jersey.id, perPiece: 0.3, split: "COLOUR", placement: "Main body" },
        { materialId: env.buttons.id, perPiece: 3 },
      ],
    }),
    "tee needs",
  );
}

/** A knitwear booking from the mill: new fabric by the calculator, collars and cuffs by matrix, buttons. */
const knitwear = (env: Env) => ({
  source: "SUPPLIER_PO",
  category: "KNITWEAR",
  supplierId: env.mill.id,
  title: "Summer polo",
  styleRef: "PL-01",
  expectedDate: "2030-11-15",
  garmentPieces: 1200,
  collar: {
    style: "TIPPING",
    extraPercent: 3,
    notes: "2 tipping lines",
    sizes: [
      { label: "S-M", collarLength: 42, collarWidth: 9, cuffLength: 38, cuffWidth: 3.5 },
      { label: "L-XL", collarLength: 44, collarWidth: 9, cuffLength: 38, cuffWidth: 3.5 },
    ],
    colours: [
      { garmentColour: "Navy", tippingColour: "White", pieces: [500, 400] },
      { garmentColour: "White", collarColour: "Navy", pieces: [200, 0] },
    ],
  },
  lines: [
    {
      name: "Pique body fabric",
      kind: "FABRIC",
      unit: "KG",
      unitPrice: 520,
      specs: {
        fabricType: "Pique",
        composition: "100% cotton",
        colour: "Navy",
        weight: 220,
        dia: 36,
        diaType: "OPEN",
        pieces: 1200,
        perDozen: 2.75,
        lossPercent: 10,
      },
    },
    { name: "Flat knit collar", kind: "TRIM", unit: "PCS", specs: { role: "COLLAR" } },
    { name: "Flat knit cuff", kind: "TRIM", unit: "PCS", specs: { role: "CUFF" } },
    {
      materialId: env.buttons.id,
      quantity: 3600,
      unitPrice: 1.5,
      specs: { size: "18L, 4 holes" },
    },
  ],
});

run("Bookings", () => {
  beforeEach(resetDb);

  it("books knitwear on its own: new items, the fabric calculator and the collar matrix", async () => {
    const env = await setup();
    await signInAs(env, "production");
    const made = data(await createBookingAction(knitwear(env)), "booking");
    const b = await bookings.getBooking(env.pm, made.id);
    expect(b.number).toBe(made.number);

    // 1,200 pieces = 100 dozen × 2.75 kg + 10% = 302.5 kg. Sets: Navy 515 + 412, White 206 = 1,133.
    expect(b.lines.map((l) => [l.role, l.quantity])).toEqual([
      ["FABRIC", "302.5"],
      ["COLLAR", "1133"],
      ["CUFF", "2266"],
      ["TRIM", "3600"],
    ]);
    expect(b.totalAmount).toBe("162700.00"); // 302.5 × 520 + 3,600 × 1.5; collars at receive
    expect(b.lines.map((l) => l.priceLater)).toEqual([false, true, true, false]);
    expect(b.collar).toMatchObject({
      style: "TIPPING",
      extraPercent: 3,
      bySize: [721, 412],
      byColour: [927, 206],
      totalPieces: 1100,
      totalSets: 1133,
    });
    expect(
      b.collar!.colours.map((c) => [c.garmentColour, c.collarColour, c.tippingColour]),
    ).toEqual([
      ["Navy", "Navy", "White"],
      ["White", "Navy", null],
    ]);
    // The standard strict terms, with the collar clause.
    expect(b.terms).toBe(standardTermsText("SUPPLIER_PO", "KNITWEAR", "EN", { collar: true }));
    expect(b.batch).toBeNull();
    // A new booking is a draft: nothing arrives on it until the owner approves it.
    expect(b.stage).toBe("DRAFT");
    expect(b.can).toMatchObject({
      edit: true,
      attach: true,
      detach: false,
      receive: false,
      approve: false,
      markSent: false,
    });

    // The new fabric is in the catalogue with its specification and the mill as its supplier.
    const fabric = await prisma.rawMaterial.findUniqueOrThrow({
      where: { id: b.lines[0]!.material.id },
    });
    expect(fabric).toMatchObject({
      name: "Pique body fabric",
      kind: "FABRIC",
      unit: "KG",
      color: "Navy",
      specification: 'Pique · 100% cotton · 220 GSM · DIA 36" open',
      supplierId: env.mill.id,
    });
    // A booking is a purchase order too, and its lines change only on the booking.
    const order = await orders.getPurchaseOrder(env.pm, b.orderId);
    expect(order.bookingId).toBe(b.id);
    await expectAppError(
      orders.updatePurchaseOrder(env.pm, b.orderId, {
        lines: [{ materialId: env.buttons.id, quantity: 10, unitPrice: 1 }],
      }),
      "CONFLICT",
    );
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "Booking", entityId: b.id, action: "CREATE" },
    });
    expect(audit.summary).toMatch(/4 item\(s\), 1133 collar sets/);

    // The next booking of the same fabric finds it again instead of adding a second one.
    const again = await bookings.createBooking(env.pm, {
      source: "SUPPLIER_PO",
      category: "KNITWEAR",
      supplierId: env.mill.id,
      lines: [
        {
          name: "pique BODY fabric",
          kind: "FABRIC",
          unit: "KG",
          quantity: 50,
          specs: { colour: "navy" },
        },
      ],
    });
    expect(again.lines[0]!.material.id).toBe(fabric.id);
    expect(again.collar).toBeNull();
    expect(again.terms).toBe(standardTermsText("SUPPLIER_PO", "KNITWEAR", "EN"));

    const list = data(await listBookingsAction({ category: "KNITWEAR" }), "list");
    expect(list.items.map((i) => [i.number, i.lineCount, i.collarSets])).toEqual([
      [again.number, 1, 0],
      [b.number, 4, 1133],
    ]);
    expect(list.items[1]!.fabric).toEqual([{ unit: "KG", quantity: "302.5" }]);
    const found = data(await listBookingsAction({ search: "summer" }), "search");
    expect(found.items.map((i) => i.id)).toEqual([b.id]);
  });

  it("refuses what cannot be booked", async () => {
    const env = await setup();
    const base = knitwear(env);
    // Collars by the kilogram while the matrix counts sets.
    await expectAppError(
      bookings.createBooking(env.pm, {
        ...base,
        lines: [base.lines[0], { ...base.lines[1], unit: "KG" }],
      }),
      "VALIDATION",
    );
    // A matrix with nothing to take its sets.
    await expectAppError(
      bookings.createBooking(env.pm, { ...base, lines: [base.lines[0], base.lines[3]] }),
      "VALIDATION",
    );
    // A line with no quantity and nothing to work it out from.
    await expectAppError(
      bookings.createBooking(env.pm, {
        ...base,
        collar: null,
        lines: [{ name: "Rib", kind: "FABRIC", unit: "KG" }],
      }),
      "VALIDATION",
    );
    // Half a button.
    await expectAppError(
      bookings.createBooking(env.pm, {
        ...base,
        collar: null,
        lines: [{ materialId: env.buttons.id, quantity: 10.5 }],
      }),
      "VALIDATION",
    );
    // Goods expected yesterday.
    await expectAppError(
      bookings.createBooking(env.pm, { ...base, expectedDate: "2020-01-01" }),
      "VALIDATION",
    );
    // A trim booked as fabric would skip the tech pack wait of collar, cuff and trims;
    // fabric counts as fabric only (as the form offers).
    for (const line of [
      { materialId: env.buttons.id, quantity: 10, specs: { role: "FABRIC" } },
      {
        name: "Flat knit collar",
        kind: "TRIM",
        unit: "PCS",
        quantity: 10,
        specs: { role: "FABRIC" },
      },
      { name: "Rib", kind: "FABRIC", unit: "KG", quantity: 10, specs: { role: "COLLAR" } },
      { name: "Rib", kind: "FABRIC", unit: "KG", quantity: 10, specs: { role: "TRIM" } },
    ]) {
      const refused = await expectAppError(
        bookings.createBooking(env.pm, { ...base, collar: null, lines: [line] }),
        "VALIDATION",
      );
      expect(refused.message).toMatch(/fabric/i);
    }
    expect(await prisma.booking.count()).toBe(0);
    expect(await prisma.purchaseOrder.count()).toBe(0);
  });

  it("adds a market purchase to stock as it is saved, on a bill Due to the seller", async () => {
    const env = await setup();
    const market = {
      source: "MARKET_PURCHASE",
      category: "WOVEN",
      supplierId: env.seller.id,
      styleRef: "Oxford shirt",
      receiveNow: true,
      lines: [
        {
          name: "Oxford shirting",
          kind: "FABRIC",
          unit: "YARD",
          quantity: 1500,
          unitPrice: 160,
          specs: { width: 58, construction: "40x40 / 133x72", colour: "Sky blue" },
        },
        { name: "Interlining", kind: "TRIM", unit: "YARD", quantity: 100, unitPrice: 95 },
        { name: "Button", kind: "ACCESSORY", unit: "PCS", quantity: 2000, unitPrice: 0.8 },
      ],
    };
    await signInAs(env, "production");
    const saved = data(await createBookingAction(market), "market purchase into stock");
    expect(saved.stocked).toBe(true);
    const b = await bookings.getBooking(env.pm, saved.id);
    expect(b.status).toBe("RECEIVED");
    expect(b.lines.map((l) => [l.receivedQty, l.pending])).toEqual([
      ["1500", "0"],
      ["100", "0"],
      ["2000", "0"],
    ]);
    // One bill, Due to the seller: nobody paid anything.
    const bill = await prisma.supplierBill.findFirstOrThrow({
      where: { purchaseOrderId: b.orderId },
    });
    expect(bill).toMatchObject({ supplierId: env.seller.id, paymentType: "DUE" });
    expect(bill.totalAmount.toFixed(2)).toBe("251100.00");
    expect(bill.dueAmount.toFixed(2)).toBe("251100.00");
    expect(await prisma.payment.count()).toBe(0);
    // The goods are in the main store.
    const stock = await prisma.rawMaterialStock.findMany({
      where: { companyId: env.company.id },
      include: { rawMaterial: { select: { name: true } } },
      orderBy: { rawMaterial: { name: "asc" } },
    });
    expect(stock.map((s) => [s.rawMaterial.name, s.quantity.toString()])).toEqual([
      ["Button", "2000"],
      ["Interlining", "100"],
      ["Oxford shirting", "1500"],
    ]);

    // Without it, a market purchase still waits for its goods.
    const waiting = data(
      await createBookingAction({ ...market, receiveNow: false }),
      "market purchase to receive later",
    );
    expect(waiting.stocked).toBeNull();
    expect((await bookings.getBooking(env.pm, waiting.id)).status).toBe("OPEN");

    // Only a market purchase on its own, with every price.
    await expectAppError(
      bookings.createBooking(env.pm, { ...market, source: "SUPPLIER_PO" }),
      "VALIDATION",
    );
    await expectAppError(
      bookings.createBooking(env.pm, { ...market, batchId: env.batch.id }),
      "VALIDATION",
    );
    const unpriced = await expectAppError(
      bookings.createBooking(env.pm, {
        ...market,
        lines: [market.lines[0], { ...market.lines[1], unitPrice: null }],
      }),
      "VALIDATION",
    );
    expect(unpriced.details).toHaveProperty(["lines.1.unitPrice"]);
    expect(await prisma.booking.count()).toBe(2);
    expect(await prisma.supplierBill.count()).toBe(1);
  });

  it("prints a market purchase in Bengali, bound, with a QR code and many pages", async () => {
    const env = await setup();
    const market = await bookings.createBooking(env.pm, {
      source: "MARKET_PURCHASE",
      category: "WOVEN",
      supplierId: env.seller.id,
      termsLanguage: "BN",
      paymentTerms: "Cash on delivery",
      lines: [
        {
          name: "Oxford shirting",
          kind: "FABRIC",
          unit: "YARD",
          quantity: 850,
          unitPrice: 165,
          specs: {
            colour: "Sky",
            width: 58,
            construction: "40x40 / 133x72",
            weight: 120,
            weightUnit: "GSM",
          },
        },
      ],
    });
    expect(market.terms).toBe(standardTermsText("MARKET_PURCHASE", "WOVEN", "BN"));

    const link = `https://erp.example/production/bookings/${market.id}`;
    const doc = bookingDocument(env.pm, market, { link });
    expect(doc).toMatchObject({
      type: "BOOKING",
      title: "Market Purchase Order",
      reference: market.docNo,
      stamp: { text: "Draft", tone: "danger" },
      qr: { data: link },
      initials: "Seller's initials",
      frame: { orientation: "landscape", tagline: "Manufacturing | Sourcing | Export" },
    });
    expect(doc.frame!.fields).toEqual([
      { label: "Doc no", value: `${market.number}-R0` },
      { label: "Buyer · PO", value: "" },
      { label: "Date", value: expect.any(String) },
      // The person who made the booking, with a line beside the name to sign.
      { label: "Prepared by", value: "production", sign: true },
    ]);
    const parties = doc.blocks.find((b) => b.kind === "parties");
    expect(parties?.kind === "parties" && parties.parties.map((p) => p.heading)).toEqual([
      "Seller",
      "Deliver to",
      "Booked for",
    ]);
    // The swatch list closes the booking, a row per fabric colour.
    const swatches = doc.blocks.find((b) => b.kind === "section" && b.label === "Swatch list");
    expect(swatches).toMatchObject({ title: "Fabric swatch list · Islampur Cloth Store" });
    const tables = doc.blocks.flatMap((b) => (b.kind === "table" ? [b] : []));
    expect(tables[0]!.title).toBe("Fabric · main fabric");
    expect(tables[0]!.columns.map((c) => c.label)).toEqual(
      expect.arrayContaining(["Width", "Construction", "Weight", "Rate", "Amount"]),
    );
    expect(tables[0]!.rows[0]!.cells).toEqual(
      expect.arrayContaining(['58"', "40x40 / 133x72", "120 GSM"]),
    );
    const terms = doc.blocks.find((b) => b.kind === "list" && b.numbered);
    expect(terms).toMatchObject({ title: "শর্তাবলি · Terms & conditions" });
    // The store sees the booking without prices.
    const forStore = bookingDocument(env.store, await bookings.getBooking(env.store, market.id));
    const storeColumns = forStore.blocks.flatMap((b) =>
      b.kind === "table" ? b.columns.map((c) => c.label) : [],
    );
    expect(storeColumns).not.toContain("Rate");
    expect((await bookings.getBooking(env.store, market.id)).totalAmount).toBeNull();

    const pdf = await bookingPdf(env.pm, market.id);
    expect(pdf.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.fileName).toBe(`Extas - Booking ${market.docNo} Islampur Cloth Store.pdf`);
    // Landscape until the person picks; their pick is kept for the next download.
    expect(pdf.orientation).toBe("landscape");
    const upright = await bookingPdf(env.pm, market.id, undefined, "portrait");
    expect(upright.orientation).toBe("portrait");
    expect((await bookingPdf(env.pm, market.id)).orientation).toBe("portrait");
    expect((await bookingPdf(env.store, market.id)).orientation).toBe("landscape");
    expect((await bookingPdf(env.pm, market.id, undefined, "sideways")).orientation).toBe(
      "portrait",
    );

    // A long booking runs on over pages, its table header repeated.
    const long = await bookings.createBooking(env.pm, {
      source: "SUPPLIER_PO",
      category: "WOVEN",
      supplierId: env.mill.id,
      lines: Array.from({ length: 45 }, (_, i) => ({
        name: `Poplin shade ${i + 1}`,
        kind: "FABRIC",
        unit: "YARD",
        quantity: 100 + i,
        specs: { colour: `Shade ${i + 1}`, width: 58, construction: "40x40 / 133x72" },
      })),
    });
    const many = await bookingPdf(env.pm, long.id);
    const pages = Number(/\/Count (\d+)/.exec(many.bytes.toString("latin1"))?.[1]);
    expect(pages).toBeGreaterThanOrEqual(3);
  });

  it("attaches to a batch, shares out over its styles, and comes off until goods arrive", async () => {
    const env = await setup();
    await giveNeeds(env);
    const own = await bookings.createBooking(env.pm, {
      source: "SUPPLIER_PO",
      category: "KNITWEAR",
      supplierId: env.mill.id,
      expectedDate: "2030-11-15",
      lines: [
        { materialId: env.jersey.id, quantity: 60, unitPrice: 400 },
        { name: "Sewing thread", kind: "OTHER", unit: "CONE", quantity: 5 },
      ],
    });
    const before = await materialScreens.getBatchMaterials(env.pm, env.batch.id);
    const jerseyRow = () => before.materials.find((m) => m.material.id === env.jersey.id)!;
    expect(jerseyRow().toOrder).toBe("56.895");

    await signInAs(env, "production");
    expect(data(await listAttachableBatchesAction(), "batches").map((b) => b.code)).toEqual([
      env.batch.code,
    ]);
    const attached = data(await attachBookingAction(own.id, { batchId: env.batch.id }), "attach");
    expect(attached.unmatched).toEqual([`${own.lines[1]!.material.code} Sewing thread`]);
    const on = await bookings.getBooking(env.pm, own.id);
    expect(on.batch?.id).toBe(env.batch.id);
    expect(on.lines[0]!.shares.map((s) => [s.project.code, s.colorName])).toEqual([
      [env.polo.code, "Navy"],
      [env.polo.code, "White"],
      [env.tee.code, null],
    ]);
    expect(on.lines[0]!.shares.reduce((t, s) => t + Number(s.quantity), 0)).toBeCloseTo(60, 3);
    expect(on.lines[1]!.shares).toEqual([]);
    const covered = await materialScreens.getBatchMaterials(env.pm, env.batch.id);
    expect(covered.materials.find((m) => m.material.id === env.jersey.id)!.toOrder).toBe("0");
    const panel = await bookings.getBatchBookings(env.pm, env.batch.id);
    expect(panel.attached.map((b) => b.number)).toEqual([own.number]);
    expect(panel.attachable).toEqual([]);

    // Once on a batch, it is not attached again.
    await expectAppError(
      bookings.attachBooking(env.pm, own.id, { batchId: env.batch.id }),
      "CONFLICT",
    );

    // Off again while nothing has arrived: nothing counts for the styles any more.
    data(await detachBookingAction(own.id), "detach");
    const off = await bookings.getBooking(env.pm, own.id);
    expect(off.batch).toBeNull();
    expect(off.lines[0]!.shares).toEqual([]);
    const again = await materialScreens.getBatchMaterials(env.pm, env.batch.id);
    expect(again.materials.find((m) => m.material.id === env.jersey.id)!.toOrder).toBe("56.895");

    // On again, and once goods arrive it stays on the batch.
    data(await attachBookingAction(own.id, { batchId: env.batch.id }), "attach again");
    // The thread is in no style's materials list, so it waits for the tech packs like any
    // trim (v6.3): the owner approves past that with a reason.
    await expect(bookings.approveBooking(env.owner, own.id)).rejects.toThrow(
      /Collar, cuff and trims wait for the tech pack/,
    );
    await bookings.approveBooking(env.owner, own.id, undefined, {
      overrideReason: "Thread is ordinary stock for every style",
    });
    const line = (await orders.getPurchaseOrder(env.pm, own.orderId)).lines[0]!;
    await purchases.createPurchase(env.pm, {
      purchaseOrderId: own.orderId,
      paymentType: "DUE",
      items: [{ purchaseOrderLineId: line.id, quantity: 20 }],
    });
    const received = await bookings.getBooking(env.pm, own.id);
    expect(received.status).toBe("PARTIALLY_RECEIVED");
    expect(received.can).toMatchObject({ detach: false, edit: false, editPaperwork: true });
    await expectAppError(bookings.detachBooking(env.pm, own.id), "CONFLICT");
  });

  it("starts the wizard from a batch: its fabric, its garment family and its colours", async () => {
    const env = await setup();
    await giveNeeds(env);
    await signInAs(env, "production");
    const form = data(await getBookingFormAction({ batchId: env.batch.id }), "form");
    expect(form.batch?.id).toBe(env.batch.id);
    expect(form.values.category).toBe("KNITWEAR"); // "Polo shirts"
    expect(form.values.supplier?.id).toBe(env.mill.id);
    expect(form.values.garmentPieces).toBe(190);
    expect(form.values.lines.map((l) => [l.materialId, l.quantity, l.specs.role])).toEqual([
      [env.jersey.id, "56.895", "FABRIC"],
    ]);
    // The polo's colours by collar size group: S and M in S-M, L in L-XL.
    expect(form.values.collar?.sizes.map((s) => s.label)).toEqual(["S-M", "L-XL", "2XL"]);
    expect(form.values.collar?.colours.map((c) => [c.garmentColour, c.pieces])).toEqual(
      expect.arrayContaining([
        ["Navy", [60, 40, 0]],
        ["White", [30, 10, 0]],
      ]),
    );
    expect(form.batchMaterials.map((m) => m.material.id)).toEqual([env.jersey.id, env.buttons.id]);

    // Made from the batch, it is on the batch at once.
    const made = data(
      await createBookingAction({
        source: "SUPPLIER_PO",
        category: "KNITWEAR",
        supplierId: env.mill.id,
        batchId: env.batch.id,
        lines: [{ materialId: env.jersey.id, quantity: 56.895 }],
      }),
      "booking",
    );
    const b = await bookings.getBooking(env.pm, made.id);
    expect(b.batch?.code).toBe(env.batch.code);
    expect(b.lines[0]!.shares.length).toBe(3);

    // A batch with no open style is refused.
    const empty = await batches.createBatch(env.pm, { name: "Empty" });
    const refused = await getBookingFormAction({ batchId: empty.id });
    expect(!refused.ok && refused.error.code).toBe("CONFLICT");
  });

  it("changes everything until goods arrive, then only the paperwork", async () => {
    const env = await setup();
    const b = await bookings.createBooking(env.pm, knitwear(env));
    const changed = await bookings.updateBooking(env.pm, b.id, {
      ...knitwear(env),
      category: "KNITWEAR",
      collar: { ...knitwear(env).collar, extraPercent: 0 },
      lines: knitwear(env).lines.slice(0, 3),
    });
    // No extra, yet never fewer than 5 collars (10 cuffs) over each colour and size: 505 + 405 + 205.
    expect(changed.lines.map((l) => l.quantity)).toEqual(["302.5", "1115", "2230"]);
    expect(changed.collar?.totalSets).toBe(1115);

    await bookings.approveBooking(env.owner, b.id);
    // An approved booking's in-house date, references and notes change on the booking
    // (a new revision, approved again), never from Materials as a plain order.
    const approvedOn = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: changed.orderId },
    });
    for (const change of [
      { expectedDate: "2031-01-30" },
      { supplierRef: "Mine" },
      { notes: "Changed quietly" },
      { projectId: null },
    ]) {
      const refused = await expectAppError(
        orders.updatePurchaseOrder(env.pm, changed.orderId, change),
        "CONFLICT",
      );
      expect(refused.message).toContain("change it on the booking");
    }
    await expectAppError(
      materialsScreens.getOrderForm(env.pm, { orderId: changed.orderId }),
      "CONFLICT",
    );
    expect(
      await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: changed.orderId } }),
    ).toEqual(approvedOn);
    expect((await bookings.getBooking(env.pm, b.id)).stage).toBe("APPROVED");
    const fabricLine = changed.lines[0]!;
    await purchases.createPurchase(env.pm, {
      purchaseOrderId: changed.orderId,
      paymentType: "DUE",
      items: [{ purchaseOrderLineId: fabricLine.id, quantity: 100 }],
    });
    await expectAppError(bookings.updateBooking(env.pm, b.id, knitwear(env)), "CONFLICT");
    await expectAppError(
      bookings.updateBookingPaperwork(env.pm, b.id, { expectedDate: "2020-01-01" }),
      "VALIDATION",
    );
    const paper = await bookings.updateBookingPaperwork(env.pm, b.id, {
      termsLanguage: "BN",
      paymentTerms: "30 days after delivery",
      supplierRef: "NF-778",
    });
    expect(paper.terms).toBe(standardTermsText("SUPPLIER_PO", "KNITWEAR", "BN", { collar: true }));
    expect(paper).toMatchObject({ paymentTerms: "30 days after delivery", supplierRef: "NF-778" });
    expect(paper.lines.map((l) => l.quantity)).toEqual(["302.5", "1115", "2230"]);

    // Closed: the rest will not come, and nothing changes any more.
    const closed = await bookings.closeBooking(env.pm, b.id, { reason: "Mill stopped the line" });
    expect(closed.status).toBe("CLOSED");
    expect(closed.can).toMatchObject({ edit: false, editPaperwork: false, close: false });

    const fresh = await bookings.createBooking(env.pm, {
      ...knitwear(env),
      collar: null,
      lines: [knitwear(env).lines[3]],
    });
    const cancelled = await bookings.cancelBooking(env.pm, fresh.id, { reason: "Booked twice" });
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("keeps bookings to the roles that may see and make them", async () => {
    const env = await setup();
    const b = await bookings.createBooking(env.pm, knitwear(env));

    await signInAs(env, "sales");
    const sales = await listBookingsAction({});
    expect(!sales.ok && sales.error.code).toBe("FORBIDDEN");

    await signInAs(env, "store");
    const seen = data(await listBookingsAction({}), "store list");
    expect(seen.items.map((i) => [i.number, i.totalAmount])).toEqual([[b.number, null]]);
    expect(seen.can.create).toBe(false);
    const make = await createBookingAction(knitwear(env));
    expect(!make.ok && make.error.code).toBe("FORBIDDEN");
    const attach = await attachBookingAction(b.id, { batchId: env.batch.id });
    expect(!attach.ok && attach.error.code).toBe("FORBIDDEN");
    const form = await getBookingFormAction({});
    expect(!form.ok && form.error.code).toBe("FORBIDDEN");
    expect((await bookings.getBooking(env.store, b.id)).can).toMatchObject({
      edit: false,
      attach: false,
      cancel: false,
    });
  });

  it("gives each part of bookings its own permission", async () => {
    const env = await setup();
    const person = async (email: string, name: string, permissions: string[]) => {
      const role = await roles.createRole(env.owner, { name, permissions });
      const user = await makeUser(email);
      await addToCompany(user.id, env.company.id, role.id);
      return contextFor(user.id, env.company.id);
    };
    const market = {
      source: "MARKET_PURCHASE",
      category: "WOVEN",
      supplierId: env.seller.id,
      lines: [{ name: "Poplin", kind: "FABRIC", unit: "YARD", quantity: 100, unitPrice: 170 }],
    };
    // Ready stock only: makes market purchases, not supplier POs, and cannot add
    // to stock as it saves without the buyers' permission.
    const shop = await person("shop@extas.test", "Market buyer", ["production.bookings.market"]);
    const bought = await bookings.createBooking(shop, market);
    expect(bought.can).toMatchObject({ edit: true, cancel: false, attach: false });
    await expectAppError(bookings.createBooking(shop, knitwear(env)), "FORBIDDEN");
    await expectAppError(
      bookings.createBooking(shop, { ...market, receiveNow: true }),
      "FORBIDDEN",
    );
    expect((await bookings.getBookingForm(shop)).can).toEqual({
      sources: ["MARKET_PURCHASE"],
      receiveNow: false,
    });
    await expectAppError(
      bookings.cancelBooking(shop, bought.id, { reason: "Not needed" }),
      "FORBIDDEN",
    );
    await expectAppError(
      bookings.attachBooking(shop, bought.id, { batchId: env.batch.id }),
      "FORBIDDEN",
    );
    const mill = await bookings.createBooking(env.pm, knitwear(env));
    await expectAppError(
      bookings.updateBookingPaperwork(shop, mill.id, { title: "Mine now" }),
      "FORBIDDEN",
    );

    // Seeing only.
    const viewer = await person("viewer@extas.test", "Booking viewer", [
      "production.bookings.view",
    ]);
    const seen = await bookings.listBookings(viewer);
    expect(seen.items).toHaveLength(2);
    expect(seen.can.create).toBe(false);
    await expectAppError(bookings.getBookingForm(viewer), "FORBIDDEN");

    // Closing and cancelling only.
    const closer = await person("closer@extas.test", "Booking closer", [
      "production.bookings.close",
    ]);
    await bookings.cancelBooking(closer, bought.id, { reason: "The shop sold it" });
    expect((await bookings.getBooking(closer, bought.id)).status).toBe("CANCELLED");

    // Buying raw materials no longer opens bookings by itself.
    const buyer = await person("buyer@extas.test", "Buyer", ["materials.purchase"]);
    await expectAppError(bookings.listBookings(buyer), "FORBIDDEN");
    await expectAppError(bookings.createBooking(buyer, market), "FORBIDDEN");
    // Nor does it cancel or close a booking from Materials: that needs the booking permission.
    const store = await person("storebuyer@extas.test", "Store buyer", [
      "materials.view",
      "materials.purchase",
    ]);
    await expectAppError(
      orders.cancelPurchaseOrder(store, mill.orderId, { reason: "Not needed" }),
      "FORBIDDEN",
    );
    await expectAppError(
      orders.closePurchaseOrder(store, mill.orderId, { reason: "Not needed" }),
      "FORBIDDEN",
    );
    expect((await materialsScreens.getOrderScreen(store, mill.orderId)).can).toMatchObject({
      cancel: false,
      close: false,
    });
    expect((await bookings.getBooking(env.pm, mill.id)).status).toBe("OPEN");
    // Someone who may close bookings may do it from the order too.
    const both = await person("both@extas.test", "Buyer and closer", [
      "materials.view",
      "materials.purchase",
      "production.bookings.close",
    ]);
    expect((await materialsScreens.getOrderScreen(both, mill.orderId)).can.cancel).toBe(true);
    const ended = await orders.cancelPurchaseOrder(both, mill.orderId, { reason: "Booked twice" });
    expect(ended.status).toBe("CANCELLED");
  });
});
