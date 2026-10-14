import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Materials per piece, the tech pack and buying for a master batch: a style's
 * bill of materials worked out over its colours and sizes, one purchase order
 * per supplier for the batch with each line shared out over the styles, colours
 * and sizes (the style-wise breakdown and the collar matrix), prices left for
 * receive and taken from the bill, and the tech pack and order PDFs. Changes go
 * through the Server Actions the buttons call, as each role.
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
import { getFileForDownload } from "@/modules/files/file.service";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as styles from "@/modules/inventory/style.service";
import * as materials from "@/modules/materials/material.service";
import { purchaseOrderDocument, purchaseOrderPdf } from "@/modules/materials/order-pdf.service";
import * as orders from "@/modules/materials/purchase-order.service";
import * as purchases from "@/modules/materials/purchase.service";
import * as parties from "@/modules/parties/party.service";
import * as batchOrders from "@/modules/production/batch-orders.service";
import * as batches from "@/modules/production/batch.service";
import * as bookings from "@/modules/production/booking.service";
import { storeMaterialImage } from "@/modules/production/material-image.service";
import * as needs from "@/modules/production/material-need.service";
import * as materialScreens from "@/modules/production/material-screens.service";
import * as projects from "@/modules/production/project.service";
import { techPackDocument, techPackPdf } from "@/modules/production/tech-pack.service";
import {
  createBatchOrdersAction,
  getNeedsPanelAction,
  setMaterialNeedsAction,
  uploadMaterialImageAction,
} from "@/server/actions/production.actions";

import { png } from "../fixtures/images";
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
 * Extras with one person per role; a Classic Polo in Navy and White × S M L; a
 * batch with two styles (a polo with a grid, a tee with only its total); a mill,
 * a trims house, and jersey, rib, buttons and a label (the label has no usual supplier).
 */
async function setup() {
  const { company, roles } = await makeCompany("Extras");
  const people = {} as Record<Who, { id: string }>;
  for (const [who, role] of Object.entries(ROLES) as Array<[Who, keyof typeof roles]>) {
    const user = await makeUser(`${who}@extras.test`);
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
  const tops = await catalog.createCategory(owner, { name: "Tops" });
  const style = await styles.createStyle(owner, {
    code: "EX-PL-001",
    name: "Classic Polo",
    categoryId: tops.id,
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
  const knit = await supplier("Gazipur Knit Factory");
  const jersey = await materials.createMaterial(pm, {
    name: "Single Jersey 180 GSM",
    kind: "FABRIC",
    unit: "KG",
    supplierId: mill.id,
  });
  const rib = await materials.createMaterial(pm, {
    name: "1x1 Rib 220 GSM",
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
  const label = await materials.createMaterial(pm, {
    name: "Woven Main Label",
    kind: "ACCESSORY",
    unit: "PCS",
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
    jersey,
    rib,
    buttons,
    label,
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

/** The label artwork, uploaded by the Production Manager. */
async function labelPicture(env: Env) {
  await signInAs(env, "production");
  const form = new FormData();
  form.set(
    "file",
    new File([new Uint8Array(png({ width: 60, height: 40, colorType: 2 }))], "label.png", {
      type: "image/png",
    }),
  );
  return data(await uploadMaterialImageAction(form), "upload");
}

/** The polo: jersey by colour (+5%), rib collars by colour and size, 3 buttons, a label. The tee: jersey and buttons. */
async function giveNeeds(env: Env, labelImageId: string | null = null) {
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
        { materialId: env.rib.id, perPiece: 0.03, split: "COLOUR_SIZE", placement: "Collar" },
        { materialId: env.buttons.id, perPiece: 3, placement: "Button" },
        { materialId: env.label.id, perPiece: 1, placement: "Main label", imageId: labelImageId },
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

run("Materials per piece and the tech pack", () => {
  beforeEach(resetDb);

  it("works out what the pieces need per colour and size, rounded up", async () => {
    const env = await setup();
    const picture = await labelPicture(env);
    await giveNeeds(env, picture.id);

    const polo = await needs.getMaterialNeeds(env.pm, env.polo.id);
    const [jersey, rib, buttons, label] = polo.needs;
    // 0.285 kg × 100 navy pieces + 5% = 29.925 kg; × 40 white = 11.97 kg.
    expect(jersey!.parts.map((p) => [p.colorName, p.pieces, p.quantity.toFixed(3)])).toEqual([
      ["Navy", 100, "29.925"],
      ["White", 40, "11.970"],
    ]);
    expect(jersey!.total.toFixed(3)).toBe("41.895");
    // Collars by colour and size: 0.03 kg × 20 navy S = 0.6 kg...
    expect(rib!.parts).toHaveLength(6);
    expect(rib!.parts[0]).toMatchObject({ colorName: "Navy", sizeName: "S", pieces: 20 });
    expect(rib!.parts[0]!.quantity.toFixed(3)).toBe("0.600");
    expect(rib!.total.toFixed(3)).toBe("4.200");
    expect(buttons!.total.toFixed(0)).toBe("420");
    expect(label!.imageId).toBe(picture.id);
    // The tee has no grid: one total whatever the split.
    const tee = await needs.getMaterialNeeds(env.pm, env.tee.id);
    expect(tee.needs[0]!.parts).toEqual([expect.objectContaining({ colorName: null, pieces: 50 })]);
    expect(tee.needs[0]!.total.toFixed(3)).toBe("15.000");

    // The store sees the panel (no prices on it) but cannot change it; Sales sees nothing.
    await signInAs(env, "store");
    const panel = data(await getNeedsPanelAction(env.polo.id), "store panel");
    expect(panel.needs.map((n) => n.toOrder)).toEqual(["41.895", "4.2", "420", "140"]);
    expect(panel.can.edit).toBe(false);
    const refused = await setMaterialNeedsAction(env.polo.id, { needs: [] });
    expect(!refused.ok && refused.error.code).toBe("FORBIDDEN");
    await expect(getFileForDownload(env.store, picture.id)).resolves.toBeTruthy();
    await signInAs(env, "sales");
    const hidden = await getNeedsPanelAction(env.polo.id);
    expect(!hidden.ok && hidden.error.code).toBe("FORBIDDEN");
    const sales = await contextFor(env.people.sales.id, env.company.id);
    await expectAppError(getFileForDownload(sales, picture.id), "FORBIDDEN");

    // Clearing the needs deletes the picture nothing points to any more.
    await signInAs(env, "production");
    data(await setMaterialNeedsAction(env.polo.id, { needs: [] }), "clear");
    expect(await prisma.fileAsset.count({ where: { id: picture.id } })).toBe(0);
    const audit = await prisma.auditLog.findFirst({
      where: { entityId: env.polo.id, summary: { startsWith: "Cleared the materials" } },
    });
    expect(audit).not.toBeNull();
  });

  it("refuses materials that are archived or pictures from elsewhere, and closed projects", async () => {
    const env = await setup();
    await materials.updateMaterial(env.pm, env.label.id, { isActive: false });
    await expectAppError(
      needs.setMaterialNeeds(env.pm, env.polo.id, {
        needs: [{ materialId: env.label.id, perPiece: 1 }],
      }),
      "VALIDATION",
    );
    // Someone else's picture that is on nothing yet cannot be borrowed.
    const owners = await storeMaterialImage(env.owner, {
      fileName: "x.png",
      bytes: png({ width: 20, height: 20, colorType: 2 }),
    });
    await expectAppError(
      needs.setMaterialNeeds(env.pm, env.polo.id, {
        needs: [{ materialId: env.jersey.id, perPiece: 0.2, imageId: owners.id }],
      }),
      "NOT_FOUND",
    );
    await projects.cancelProject(env.pm, env.tee.id, { reason: "Buyer dropped it" });
    await expectAppError(
      needs.setMaterialNeeds(env.pm, env.tee.id, {
        needs: [{ materialId: env.jersey.id, perPiece: 0.2 }],
      }),
      "CONFLICT",
    );
  });

  it("drafts the making notes from rules without AI and prints the tech pack without prices", async () => {
    const env = await setup();
    await giveNeeds(env);
    const draft = await needs.draftTechPackNotes(env.pm, env.polo.id);
    expect(draft.byAi).toBe(false);
    expect(draft.text).toMatch(/^• Brand A polo: 140 pieces in Navy, White, sizes S, M, L\./);
    expect(draft.text).toContain("Main body: Single Jersey 180 GSM, 0.285 kg a piece + 5%");
    expect(draft.text).toContain("Match each collar and cuff");
    await needs.setTechPackNotes(env.pm, env.polo.id, { notes: draft.text });

    const data = await needs.getMaterialNeeds(env.store, env.polo.id);
    const model = techPackDocument(env.store, data, draft.text);
    const tables = model.blocks.filter((b) => b.kind === "table");
    expect(tables.map((t) => t.title)).toEqual([
      "Pieces per colour and size",
      "Materials per piece",
      "Collar: 1x1 Rib 220 GSM by colour and size (kg)",
    ]);
    const grid = tables[0]!;
    expect(grid.rows.at(-1)!.cells).toEqual(["Total", "30", "60", "50", "140"]);
    expect(JSON.stringify(model)).not.toMatch(/BDT|Unit price|Amount/);
    expect(tables[1]!.rows[2]!.cells).toEqual([
      "3",
      "Button: Polo Button 18L",
      "3 a piece",
      "One total",
      "420 pcs",
    ]);
    const pdf = await techPackPdf(env.store, env.polo.id);
    expect(pdf.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.fileName).toMatch(/Tech pack PRD-\d{4}-\d+ Brand A polo\.pdf$/);
  });
});

run("Purchase orders for a master batch", () => {
  beforeEach(resetDb);

  it("makes one order per supplier, shared out by style, colour and size", async () => {
    const env = await setup();
    const picture = await labelPicture(env);
    await giveNeeds(env, picture.id);

    const plan = await materialScreens.getBatchMaterials(env.pm, env.batch.id);
    expect(plan.materials.map((m) => [m.material.code, m.needed, m.toOrder, m.styles])).toEqual([
      [env.jersey.code, "56.895", "56.895", [env.polo.code, env.tee.code]],
      [env.rib.code, "4.2", "4.2", [env.polo.code]],
      [env.buttons.code, "570", "570", [env.polo.code, env.tee.code]],
      [env.label.code, "140", "140", [env.polo.code]],
    ]);
    const form = await materialScreens.getBatchOrdersForm(env.pm, env.batch.id);
    // Fabric is listed apart, to book with a booking; the rest by usual supplier.
    expect(form.fabric.map((m) => m.material.code)).toEqual([env.jersey.code, env.rib.code]);
    expect(form.groups.map((g) => g.supplier?.name ?? null)).toEqual(["Dhaka Trims House", null]);

    // The store may not buy.
    await signInAs(env, "store");
    const refused = await createBatchOrdersAction(env.batch.id, {
      orders: [{ supplierId: env.mill.id, lines: [{ materialId: env.jersey.id, quantity: 60 }] }],
    });
    expect(!refused.ok && refused.error.code).toBe("FORBIDDEN");

    await signInAs(env, "production");
    // A batch's fabric is booked with a booking, never on its purchase orders.
    await expectAppError(
      batchOrders.createBatchOrders(env.pm, env.batch.id, {
        orders: [{ supplierId: env.mill.id, lines: [{ materialId: env.jersey.id, quantity: 60 }] }],
      }),
      "VALIDATION",
    );
    const booked = await bookings.createBooking(env.pm, {
      source: "SUPPLIER_PO",
      category: "KNITWEAR",
      supplierId: env.mill.id,
      batchId: env.batch.id,
      lines: [
        { materialId: env.jersey.id, quantity: 60, unitPrice: null },
        { materialId: env.rib.id, quantity: 4.2, unitPrice: 520 },
      ],
    });
    const trimsMade = data(
      await createBatchOrdersAction(env.batch.id, {
        orders: [
          {
            supplierId: env.trims.id,
            lines: [
              { materialId: env.buttons.id, quantity: 600, unitPrice: 1.5 },
              { materialId: env.label.id, quantity: 140, unitPrice: null },
            ],
          },
        ],
      }),
      "orders",
    );
    const made = { orders: [{ id: booked.orderId, number: booked.number }, ...trimsMade.orders] };
    expect(made.orders).toHaveLength(2);
    const fabric = await orders.getPurchaseOrder(env.pm, made.orders[0]!.id);
    expect(fabric.batch?.id).toBe(env.batch.id);
    expect(fabric.project).toBeNull();
    const [jersey, rib] = fabric.lines;
    expect(jersey!.priceLater).toBe(true);
    expect(jersey!.unitPrice?.toFixed(2)).toBe("0.00");
    // 60 kg over the needs (29.925 navy, 11.97 white, 15 tee) in proportion; the last takes the rest.
    expect(jersey!.shares.map((s) => [s.project.code, s.colorName, s.quantity.toFixed(3)])).toEqual(
      [
        [env.polo.code, "Navy", "31.558"],
        [env.polo.code, "White", "12.623"],
        [env.tee.code, null, "15.819"],
      ],
    );
    expect(rib!.shares).toHaveLength(6);
    expect(rib!.shares.every((s) => s.sizeName)).toBe(true);
    expect(fabric.totalAmount?.toFixed(2)).toBe("2184.00");
    const trimOrder = await orders.getPurchaseOrder(env.pm, made.orders[1]!.id);
    expect(trimOrder.lines[1]!.imageId).toBe(picture.id);
    expect(trimOrder.lines[0]!.description).toBe("Button");

    // What is ordered now covers the needs.
    const after = await materialScreens.getBatchMaterials(env.pm, env.batch.id);
    expect(after.materials.map((m) => m.toOrder)).toEqual(["0", "0", "0", "0"]);
    const panel = await materialScreens.getNeedsPanel(env.pm, env.polo.id);
    expect(panel.orders.map((o) => o.number)).toEqual(made.orders.map((o) => o.number));

    // A material no style needs is refused.
    const stray = await materials.createMaterial(env.pm, {
      name: "Zipper 20 cm",
      kind: "TRIM",
      unit: "PCS",
    });
    await expectAppError(
      batchOrders.createBatchOrders(env.pm, env.batch.id, {
        orders: [{ supplierId: env.trims.id, lines: [{ materialId: stray.id, quantity: 10 }] }],
      }),
      "VALIDATION",
    );

    // Printed: style-wise breakdown and the collar matrix; no prices for the store.
    const sizeRank = (s: string) => ["S", "M", "L"].indexOf(s);
    const forPm = purchaseOrderDocument(env.pm, fabric, sizeRank);
    const titles = forPm.blocks.flatMap((b) =>
      b.kind === "table" || b.kind === "heading" ? [b.title ?? ""] : [],
    );
    expect(titles).toEqual([
      "",
      "Style-wise breakdown",
      `Line 1: ${env.jersey.code} Single Jersey 180 GSM by style`,
      `Line 2: ${env.rib.code} 1x1 Rib 220 GSM by style`,
      "1x1 Rib 220 GSM: colour and size matrix",
      `${env.polo.code} · Brand A polo`,
    ]);
    const matrixTable = forPm.blocks.find(
      (b) => b.kind === "table" && b.title === `${env.polo.code} · Brand A polo`,
    );
    expect(matrixTable?.kind === "table" && matrixTable.rows.map((r) => r.cells)).toEqual([
      ["Navy", "0.6", "1.2", "1.2", "3"],
      ["White", "0.3", "0.6", "0.3", "1.2"],
      ["Total", "0.9", "1.8", "1.5", "4.2"],
    ]);
    const firstTable = forPm.blocks[0]!;
    expect(firstTable.kind === "table" && firstTable.rows[0]!.cells[3]).toBe("At receive");
    const forStore = purchaseOrderDocument(env.store, fabric, sizeRank);
    const storeTable = forStore.blocks[0]!;
    expect(storeTable.kind === "table" && storeTable.columns.map((c) => c.label)).toEqual([
      "#",
      "Material",
      "Quantity",
    ]);
    const pdf = await purchaseOrderPdf(env.pm, fabric.id);
    expect(pdf.bytes.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("asks for the agreed price on receive and keeps the shares when the order changes", async () => {
    const env = await setup();
    await giveNeeds(env);
    const booked = await bookings.createBooking(env.pm, {
      source: "SUPPLIER_PO",
      category: "KNITWEAR",
      supplierId: env.mill.id,
      batchId: env.batch.id,
      lines: [{ materialId: env.jersey.id, quantity: 60 }],
    });
    const made = await batchOrders.createBatchOrders(env.pm, env.batch.id, {
      orders: [
        {
          supplierId: env.trims.id,
          lines: [{ materialId: env.buttons.id, quantity: 570, unitPrice: 1.5 }],
        },
      ],
    });
    const [fabricId, trimsId] = [booked.orderId, made.orders[0]!.id];
    const fabric = await orders.getPurchaseOrder(env.pm, fabricId!);
    const line = fabric.lines[0]!;

    // Receiving without the agreed price is refused; with it, the order takes the price.
    await expectAppError(
      purchases.createPurchase(env.pm, {
        purchaseOrderId: fabricId,
        paymentType: "DUE",
        items: [{ purchaseOrderLineId: line.id, quantity: 30 }],
      }),
      "VALIDATION",
    );
    await purchases.createPurchase(env.pm, {
      purchaseOrderId: fabricId,
      paymentType: "DUE",
      items: [{ purchaseOrderLineId: line.id, quantity: 30, unitPrice: 420 }],
    });
    const priced = await orders.getPurchaseOrder(env.pm, fabricId!);
    expect(priced.lines[0]!.priceLater).toBe(false);
    expect(priced.lines[0]!.unitPrice?.toFixed(2)).toBe("420.00");
    expect(priced.totalAmount?.toFixed(2)).toBe("25200.00");
    expect(priced.status).toBe("PARTIALLY_RECEIVED");
    // The next arrival defaults to the agreed price.
    const second = await purchases.createPurchase(env.pm, {
      purchaseOrderId: fabricId,
      paymentType: "DUE",
      items: [{ purchaseOrderLineId: line.id, quantity: 30 }],
    });
    expect(second.totalAmount.toFixed(2)).toBe("12600.00");

    // Changing a batch order's lines keeps their shares (in proportion) and price at receive.
    await orders.updatePurchaseOrder(env.pm, trimsId!, {
      lines: [{ materialId: env.buttons.id, quantity: 600, unitPrice: null }],
    });
    const trims = await orders.getPurchaseOrder(env.pm, trimsId!);
    expect(trims.lines[0]!.priceLater).toBe(true);
    expect(trims.lines[0]!.shares.map((s) => [s.project.code, s.quantity.toFixed(0)])).toEqual([
      [env.polo.code, "442"],
      [env.tee.code, "158"],
    ]);
    // A plain order can leave its price for receive too.
    const plain = await orders.createPurchaseOrder(env.pm, {
      supplierId: env.mill.id,
      lines: [{ materialId: env.rib.id, quantity: 5, unitPrice: null }],
    });
    expect(plain.lines[0]!.priceLater).toBe(true);
    expect(plain.totalAmount?.toFixed(2)).toBe("0.00");
  });
});
