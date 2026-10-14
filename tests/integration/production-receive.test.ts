import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * A master batch's central receive, colour-wise issue and the supplier fault
 * log: a delivery taken in against its challan (Challan vs Actual), a short
 * beyond the allowance logged as the supplier's fault with an instant alert,
 * the batch's materials issued to its styles colour by colour (all notes or
 * none, each style charged only for what it took), faults logged by hand and
 * settled, and the supplier's report card. Who may do each follows the
 * store, buying and money rules.
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
import * as parties from "@/modules/parties/party.service";
import * as batchIssue from "@/modules/production/batch-issue.service";
import * as batchOrders from "@/modules/production/batch-orders.service";
import * as bookings from "@/modules/production/booking.service";
import * as batches from "@/modules/production/batch.service";
import * as faults from "@/modules/production/fault.service";
import * as needs from "@/modules/production/material-need.service";
import * as projects from "@/modules/production/project.service";
import * as receive from "@/modules/production/receive.service";
import * as cards from "@/modules/production/report-card.service";
import {
  getBatchIssueAction,
  getBatchMaterialsAction,
  getBatchReceiveAction,
  listFaultsAction,
  settleFaultAction,
} from "@/server/actions/production.actions";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const ROLES = {
  owner: "SUPER_ADMIN",
  production: "PRODUCTION_MANAGER",
  accounts: "ACCOUNTS",
  store: "WAREHOUSE_TEAM",
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
 * A batch with a polo in Navy (100 pcs) and White (40 pcs) and a tee with no
 * colours (50 pcs): jersey by colour for both, rib collars by colour and size,
 * and buttons; the mill's jersey ordered at 520 a kg and its rib priced at receive.
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
  const accounts = await contextFor(people.accounts.id, company.id);
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
  await needs.setMaterialNeeds(pm, polo.id, {
    needs: [
      { materialId: jersey.id, perPiece: 0.25, split: "COLOUR", placement: "Main body" },
      { materialId: rib.id, perPiece: 0.03, split: "COLOUR_SIZE", placement: "Collar" },
      { materialId: buttons.id, perPiece: 3, placement: "Button" },
    ],
  });
  await needs.setMaterialNeeds(pm, tee.id, {
    needs: [{ materialId: jersey.id, perPiece: 0.2, split: "COLOUR", placement: "Main body" }],
  });
  // The fabric is booked (a batch's fabric always is); the buttons go on a batch order.
  const booked = await bookings.createBooking(pm, {
    source: "SUPPLIER_PO",
    category: "KNITWEAR",
    supplierId: mill.id,
    batchId: batch.id,
    expectedDate: "2030-11-15",
    lines: [
      { materialId: jersey.id, quantity: 50, unitPrice: 520 },
      { materialId: rib.id, quantity: 5 },
    ],
  });
  // The owner approves it, so its goods can arrive.
  await bookings.approveBooking(owner, booked.id);
  const made = await batchOrders.createBatchOrders(pm, batch.id, {
    orders: [
      {
        supplierId: trims.id,
        expectedDate: "2030-11-20",
        lines: [{ materialId: buttons.id, quantity: 420, unitPrice: 2 }],
      },
    ],
  });
  const orderOf = async (supplierId: string) =>
    (await prisma.purchaseOrder.findFirstOrThrow({ where: { supplierId }, select: { id: true } }))
      .id;
  expect(made.orders).toHaveLength(1);
  return {
    company,
    people,
    owner,
    pm,
    accounts,
    store,
    mill,
    trims,
    jersey,
    rib,
    buttons,
    batch,
    polo,
    tee,
    millOrderId: await orderOf(mill.id),
    trimsOrderId: await orderOf(trims.id),
  };
}

type Env = Awaited<ReturnType<typeof setup>>;

async function signInAs(env: Env, who: Who) {
  const { token } = await createSession(env.people[who].id, env.company.id);
  browser.cookies.set(SESSION_COOKIE, token);
}

/** The mill's delivery: jersey 3 kg short of a 50 kg challan (6%), rib 0.05 kg short of 5 (1%). */
async function receiveMill(env: Env) {
  const screen = await receive.getBatchReceive(env.pm, env.batch.id, env.millOrderId);
  const line = (materialId: string) =>
    screen.order!.lines.find((l) => l.material.id === materialId)!;
  return receive.receiveBatchDelivery(env.pm, env.batch.id, {
    orderId: env.millOrderId,
    supplierRef: "NF-CH-118",
    lines: [
      { lineId: line(env.jersey.id).id, challanQuantity: 50, quantity: 47 },
      { lineId: line(env.rib.id).id, challanQuantity: 5, quantity: 4.95, unitPrice: 600 },
    ],
  });
}

run("Production renovation: central receive, colour-wise issue and the fault log", () => {
  let env: Env;

  beforeEach(async () => {
    await resetDb();
    env = await setup();
  });

  it("receives Challan vs Actual, logs a short beyond the allowance and alerts at once", async () => {
    const screen = await receive.getBatchReceive(env.pm, env.batch.id);
    expect(screen.orders.map((o) => o.supplier.name).sort()).toEqual([
      "Dhaka Trims House",
      "Narayanganj Fabrics",
    ]);
    expect(screen.order).toBeNull();
    expect(screen.allowance).toEqual({ FABRIC: 2, OTHER: 1 });
    const chosen = await receive.getBatchReceive(env.pm, env.batch.id, env.millOrderId);
    expect(
      chosen.order!.lines.map((l) => [l.material.code, l.toCome, l.priceLater, l.unitPrice]),
    ).toEqual([
      [env.jersey.code, "50", false, "520.00"],
      [env.rib.code, "5", true, ""],
    ]);

    // A line priced at receive needs its agreed price when it comes.
    const rib = chosen.order!.lines.find((l) => l.priceLater)!;
    const err = await expectAppError(
      receive.receiveBatchDelivery(env.pm, env.batch.id, {
        orderId: env.millOrderId,
        lines: [{ lineId: rib.id, challanQuantity: 5, quantity: 5 }],
      }),
      "VALIDATION",
    );
    expect(err.details?.["lines.0.unitPrice"]).toBeDefined();
    // Nothing came at all.
    await expectAppError(
      receive.receiveBatchDelivery(env.pm, env.batch.id, {
        orderId: env.millOrderId,
        lines: [{ lineId: rib.id, challanQuantity: 5, quantity: 0 }],
      }),
      "VALIDATION",
    );

    const result = await receiveMill(env);
    expect(result.shorts).toHaveLength(1);
    expect(result.shorts[0]!.text).toMatch(/3 kg short \(6%\)/);
    expect(result.extras).toBe(0);

    const bill = await prisma.supplierBill.findUniqueOrThrow({
      where: { id: result.bill.id },
      include: { items: { orderBy: { rawMaterialId: "asc" } } },
    });
    expect(bill.paymentType).toBe("DUE");
    expect(bill.supplierRef).toBe("NF-CH-118");
    const items = new Map(bill.items.map((i) => [i.rawMaterialId, i]));
    expect(items.get(env.jersey.id)!.quantity.toFixed(3)).toBe("47.000");
    expect(items.get(env.jersey.id)!.challanQuantity!.toFixed(3)).toBe("50.000");
    expect(items.get(env.rib.id)!.unitPrice.toFixed(2)).toBe("600.00");
    // Only what actually came is in the store.
    const jersey = await prisma.rawMaterial.findUniqueOrThrow({ where: { id: env.jersey.id } });
    expect(jersey.quantity.toFixed(3)).toBe("47.000");

    // The jersey short (6% > 2%) is the mill's fault at the line's price; the rib (1%) is not.
    const logged = await prisma.supplierFault.findMany();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      kind: "SHORT_RECEIVE",
      status: "OPEN",
      supplierId: env.mill.id,
      batchId: env.batch.id,
      rawMaterialId: env.jersey.id,
      billId: bill.id,
    });
    expect(logged[0]!.number).toMatch(/^FLT-/);
    expect(logged[0]!.quantity!.toFixed(3)).toBe("3.000");
    expect(logged[0]!.amount!.toFixed(2)).toBe("1560.00");
    expect(logged[0]!.note).toMatch(/challan 50 kg, actual 47 kg \(6% short\), challan NF-CH-118/);

    // The instant alert reaches the Production Manager (and the owner), not the store.
    const inbox = await prisma.notificationLog.findMany({ where: { channel: "IN_APP" } });
    const to = inbox.map((n) => n.userId);
    expect(to).toContain(env.people.production.id);
    expect(to).not.toContain(env.people.store.id);
    expect(inbox[0]!.subject).toMatch(/^Short delivery: Narayanganj Fabrics on PO-/);
    expect(
      await prisma.auditLog.count({ where: { entityType: "SupplierFault", action: "CREATE" } }),
    ).toBe(1);

    // The order is part received; receiving needs the buying permission.
    expect((await receive.getBatchReceive(env.pm, env.batch.id)).orders).toHaveLength(2);
    await expectAppError(receive.getBatchReceive(env.store, env.batch.id), "FORBIDDEN");
    await expectAppError(receive.getBatchReceive(env.accounts, env.batch.id), "FORBIDDEN");
    // An order of another batch, or none, is not received here.
    const other = await batches.createBatch(env.pm, { name: "Spring 2027" });
    await expectAppError(receive.getBatchReceive(env.pm, other.id, env.millOrderId), "NOT_FOUND");
    await expectAppError(
      receive.receiveBatchDelivery(env.pm, other.id, {
        orderId: env.millOrderId,
        lines: [{ lineId: rib.id, quantity: 1, unitPrice: 600 }],
      }),
      "NOT_FOUND",
    );

    // Through the actions: buyers only, and the batch panel offers the receive.
    await signInAs(env, "production");
    expect(data(await getBatchReceiveAction(env.batch.id), "receive").orders).toHaveLength(2);
    expect(data(await getBatchMaterialsAction(env.batch.id), "materials").can).toMatchObject({
      receive: true,
      issue: true,
    });
    await signInAs(env, "store");
    expect((await getBatchReceiveAction(env.batch.id)).ok).toBe(false);
    expect(data(await getBatchMaterialsAction(env.batch.id), "materials").can).toMatchObject({
      receive: false,
      issue: true,
    });
  });

  it("issues to the styles colour by colour, all or none, charging each only what it took", async () => {
    await receiveMill(env);
    const screen = await batchIssue.getBatchIssue(env.store, env.batch.id);
    const jersey = screen.materials.find((m) => m.material.id === env.jersey.id)!;
    expect(jersey.inStore).toBe("47");
    expect(jersey.held).toBe("0");
    const polo = jersey.styles.find((s) => s.projectId === env.polo.id)!;
    const tee = jersey.styles.find((s) => s.projectId === env.tee.id)!;
    expect(polo.colours.map((c) => c.colorName)).toEqual(["Navy", "White"]);
    expect(polo.colours.map((c) => c.needed)).toEqual(["25", "10"]);
    expect(tee.colours).toEqual([{ colorName: null, needed: "10", toIssue: "10" }]);
    expect(jersey.toIssue).toBe("45");
    expect(jersey.short).toBe(false);
    const buttons = screen.materials.find((m) => m.material.id === env.buttons.id)!;
    expect(buttons.inStore).toBe("0");
    expect(buttons.short).toBe(true);

    // More than the store holds stops every note.
    await expectAppError(
      batchIssue.issueToStyles(env.store, env.batch.id, {
        lines: [
          { projectId: env.polo.id, materialId: env.jersey.id, colorName: "Navy", quantity: 25 },
          { projectId: env.tee.id, materialId: env.buttons.id, quantity: 10 },
        ],
      }),
      "CONFLICT",
    );
    expect(await prisma.materialIssue.count()).toBe(0);

    const done = await batchIssue.issueToStyles(env.store, env.batch.id, {
      receivedBy: "Rahim, cutting master",
      lines: [
        { projectId: env.polo.id, materialId: env.jersey.id, colorName: "Navy", quantity: 25 },
        { projectId: env.polo.id, materialId: env.jersey.id, colorName: "White", quantity: 10 },
        { projectId: env.tee.id, materialId: env.jersey.id, colorName: null, quantity: 5 },
      ],
    });
    expect(done.issues.map((i) => i.project)).toEqual([env.polo.code, env.tee.code].sort());
    const notes = await prisma.materialIssue.findMany({
      include: { project: { select: { code: true } } },
      orderBy: { number: "asc" },
    });
    expect(notes).toHaveLength(2);
    const poloNote = notes.find((n) => n.projectId === env.polo.id)!;
    expect(poloNote.note).toMatch(
      new RegExp(
        `^${env.batch.code} batch issue\\. by colour ${env.jersey.code}: Navy 25 kg, White 10 kg$`,
      ),
    );
    expect(poloNote.receivedBy).toBe("Rahim, cutting master");
    // Each style is charged only for what it took, at the store's average cost (520 a kg).
    expect(poloNote.totalValue.toFixed(2)).toBe("18200.00");
    expect(notes.find((n) => n.projectId === env.tee.id)!.totalValue.toFixed(2)).toBe("2600.00");
    const stock = await prisma.rawMaterial.findUniqueOrThrow({ where: { id: env.jersey.id } });
    expect(stock.quantity.toFixed(3)).toBe("7.000");
    expect(
      await prisma.auditLog.count({
        where: {
          entityType: "ProductionBatch",
          entityId: env.batch.id,
          summary: { contains: "to its styles" },
        },
      }),
    ).toBe(1);

    // What each style holds now counts against what it still needs.
    const after = await batchIssue.getBatchIssue(env.pm, env.batch.id);
    const j = after.materials.find((m) => m.material.id === env.jersey.id)!;
    expect(j.styles.find((s) => s.projectId === env.polo.id)!.toIssue).toBe("0");
    expect(j.styles.find((s) => s.projectId === env.tee.id)).toMatchObject({
      held: "5",
      toIssue: "5",
    });

    // A style of another batch, a later day, or someone outside the store is refused.
    const other = await batches.createBatch(env.pm, { name: "Spring 2027" });
    const stray = await projects.createProject(env.pm, {
      name: "Stray tee",
      batchId: other.id,
      targetDate: "2026-12-20",
      targetQuantity: 10,
    });
    await expectAppError(
      batchIssue.issueToStyles(env.store, env.batch.id, {
        lines: [{ projectId: stray.id, materialId: env.jersey.id, quantity: 1 }],
      }),
      "VALIDATION",
    );
    await expectAppError(
      batchIssue.issueToStyles(env.store, env.batch.id, {
        date: "2099-01-01",
        lines: [{ projectId: env.tee.id, materialId: env.jersey.id, quantity: 1 }],
      }),
      "VALIDATION",
    );
    await expectAppError(batchIssue.getBatchIssue(env.accounts, env.batch.id), "FORBIDDEN");
    await signInAs(env, "accounts");
    expect((await getBatchIssueAction(env.batch.id)).ok).toBe(false);
    await signInAs(env, "store");
    expect(data(await getBatchIssueAction(env.batch.id), "issue").materials.length).toBe(3);
  });

  it("keeps the fault log: values by role, logged by hand, deducted, waived and reopened", async () => {
    await receiveMill(env);
    const pmView = await faults.listFaults(env.pm);
    expect(pmView.items).toHaveLength(1);
    expect(pmView.items[0]).toMatchObject({
      kind: "SHORT_RECEIVE",
      amount: "1560.00",
      quantity: "3",
    });
    expect(pmView.openBySupplier).toEqual([
      { supplier: { id: env.mill.id, name: "Narayanganj Fabrics" }, count: 1, amount: "1560.00" },
    ]);
    expect(pmView.can).toEqual({ log: true, settle: true, seeAmounts: true });
    // The store sees the log without values and cannot change it.
    const storeView = await faults.listFaults(env.store);
    expect(storeView.items[0]!.amount).toBeNull();
    expect(storeView.openBySupplier[0]!.amount).toBeNull();
    expect(storeView.can).toEqual({ log: false, settle: false, seeAmounts: false });
    await expectAppError(
      faults.createFault(env.store, { supplierId: env.mill.id, kind: "QUALITY", note: "Holes" }),
      "FORBIDDEN",
    );

    // A Fabric Fault Note by hand, on the batch.
    const note = await faults.createFault(env.pm, {
      supplierId: env.mill.id,
      kind: "FABRIC_FAULT",
      batchId: env.batch.id,
      materialId: env.jersey.id,
      quantity: 4,
      amount: 2080,
      note: "Holes in two navy rolls, 4 kg set aside",
    });
    expect(note.number).toMatch(/^FLT-/);
    await expectAppError(
      faults.createFault(env.pm, {
        supplierId: env.mill.id,
        kind: "OTHER",
        note: "Late",
        occurredOn: "2099-01-01",
      }),
      "VALIDATION",
    );
    const batchView = await faults.listFaults(env.accounts, { batchId: env.batch.id });
    expect(batchView.items.map((f) => f.kind)).toEqual(["FABRIC_FAULT", "SHORT_RECEIVE"]);
    expect(batchView.openBySupplier[0]).toMatchObject({ count: 2, amount: "3640.00" });

    // Accounts marks one deducted; the same again, or waiving without a reason, is refused.
    await faults.settleFault(env.accounts, note.id, { status: "DEDUCTED", note: "Off PAY-0007" });
    await expectAppError(
      faults.settleFault(env.accounts, note.id, { status: "DEDUCTED" }),
      "CONFLICT",
    );
    const short = pmView.items[0]!;
    await expectAppError(faults.settleFault(env.pm, short.id, { status: "WAIVED" }), "VALIDATION");
    await expectAppError(
      faults.settleFault(env.store, short.id, { status: "WAIVED", note: "x" }),
      "FORBIDDEN",
    );
    await faults.settleFault(env.pm, short.id, { status: "WAIVED", note: "Agreed on the phone" });
    let open = await faults.listFaults(env.pm, { status: "OPEN" });
    expect(open.items).toEqual([]);
    expect(open.openBySupplier).toEqual([]);
    const deducted = (await faults.listFaults(env.pm, { status: "DEDUCTED" })).items[0]!;
    expect(deducted).toMatchObject({ settledNote: "Off PAY-0007", settledBy: expect.any(String) });

    // A mistake goes back to open, through the action too.
    await signInAs(env, "accounts");
    data(await settleFaultAction(note.id, { status: "OPEN" }), "reopen");
    open = await faults.listFaults(env.pm, { status: "OPEN" });
    expect(open.items.map((f) => f.number)).toEqual([note.number]);
    expect(open.items[0]!.settledOn).toBeNull();
    await signInAs(env, "store");
    expect(data(await listFaultsAction({}), "store list").items).toHaveLength(2);
  });

  it("makes the supplier's report card from its orders, deliveries and faults", async () => {
    await receiveMill(env);
    await faults.createFault(env.pm, {
      supplierId: env.mill.id,
      kind: "FABRIC_FAULT",
      amount: 500,
      note: "Shade variation on one white roll",
    });
    const card = await cards.supplierReportCard(env.pm, env.mill.id);
    expect(card.orders).toHaveLength(1);
    expect(card.onTime).toEqual({ judged: 1, onTime: 1, percent: 100 });
    expect(card.deliveries).toHaveLength(2);
    expect(card.shortDeliveries).toBe(2);
    expect(card.faults).toHaveLength(2);
    expect(card.openFaults.count).toBe(2);
    expect(card.openFaults.amount.toFixed(2)).toBe("2060.00");
    // On time, but two faults: B, not A.
    expect(card.grade).toBe("B");

    const summary = await cards.cardSummary(card, "BDT");
    expect(summary.byAi).toBe(false);
    expect(summary.text).toMatch(/delivered 1 of 1 orders on time \(100%\)/);
    expect(summary.text).toMatch(/2 of 2 delivery lines checked against the challan came short/);
    expect(summary.text).toMatch(/Grade B/);
    const doc = cards.reportCardDocument(env.pm, card, summary);
    const titles = doc.blocks.map((b) => ("title" in b ? b.title : b.kind));
    expect(titles).toEqual([
      "figures",
      "Summary",
      "note",
      "Orders",
      "Challan vs Actual",
      "Fault log",
    ]);
    const challan = doc.blocks.find((b) => b.kind === "table" && b.title === "Challan vs Actual");
    expect(challan && challan.kind === "table" && challan.rows[0]!.cells.slice(3)).toEqual([
      "50 kg",
      "47 kg",
      "Short 3 kg",
    ]);

    const pdf = await cards.reportCardPdf(env.pm, env.mill.id);
    expect(pdf.bytes.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.fileName).toMatch(/Report card Narayanganj Fabrics/);
    await expectAppError(cards.supplierReportCard(env.store, env.mill.id), "FORBIDDEN");
    await expectAppError(cards.supplierReportCard(env.pm, env.batch.id), "NOT_FOUND");
  });
});
