import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import * as chart from "@/modules/accounts/chart.service";
import { type ControlAccountKey, ensureControlAccounts } from "@/modules/accounts/control-accounts";
import * as reports from "@/modules/accounts/reports.service";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as stock from "@/modules/inventory/stock.service";
import * as styles from "@/modules/inventory/style.service";
import * as issues from "@/modules/materials/issue.service";
import * as materials from "@/modules/materials/material.service";
import * as orders from "@/modules/materials/purchase-order.service";
import * as purchases from "@/modules/materials/purchase.service";
import * as returns from "@/modules/materials/supplier-return.service";
import * as parties from "@/modules/parties/party.service";
import * as costs from "@/modules/production/cost.service";
import * as intakes from "@/modules/production/intake.service";
import * as projects from "@/modules/production/project.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const TZ = "Asia/Dhaka";

/** A calendar day `n` days from today in company time, e.g. "2026-10-12". */
function dayFromToday(n: number) {
  const d = new Date(`${localDay(new Date(), TZ)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * A company with a main store and a cutting-floor store, a fabric mill and a
 * trims house as suppliers, a buyer, a polo style, one production project,
 * four raw materials (two fabrics, buttons, thread) and one user per role.
 */
async function setup(companyName = "Extras") {
  const { company, roles } = await makeCompany(companyName);
  const member = async (role: keyof typeof roles, who: string) => {
    const user = await makeUser(`${who}@${company.slug}.test`);
    await addToCompany(user.id, company.id, roles[role]);
    return contextFor(user.id, company.id);
  };
  const admin = await member("SUPER_ADMIN", "admin");
  const pm = await member("PRODUCTION_MANAGER", "production");
  const accounts = await member("ACCOUNTS", "accounts");
  const store = await member("WAREHOUSE_TEAM", "store");
  const sales = await member("SALES_EXECUTIVE", "sales");

  const supplier = async (name: string) =>
    (await parties.createParty(admin, { kind: "SUPPLIER", name })).party;
  const mill = await supplier("Narayanganj Fabrics");
  const trims = await supplier("Dhaka Trims House");
  const buyer = (
    await parties.createParty(admin, { kind: "BUYER", name: "Rahim Traders", phone: "01711223344" })
  ).party;
  const main = await stock.getDefaultWarehouse(admin);
  const floor = await stock.createWarehouse(admin, { name: "Cutting Floor Store" });

  const size = await catalog.createSize(admin, { name: "M" });
  const navy = await catalog.createColor(admin, { name: "Navy", hexCode: "#1f2a44" });
  const tops = await catalog.createCategory(admin, { name: "Tops" });
  const style = await styles.createStyle(admin, {
    code: "EX-PL-001",
    name: "Classic Polo",
    categoryId: tops.id,
    retailPrice: 1450,
    wholesalePrice: 900,
  });
  await matrix.generateMatrix(admin, style.id, { colorIds: [navy.id], sizeIds: [size.id] });
  const variant = await prisma.productVariant.findFirstOrThrow({ where: { styleId: style.id } });
  const project = await projects.createProject(pm, {
    name: "Classic Polo run",
    styleId: style.id,
    targetDate: dayFromToday(30),
    targetQuantity: 1000,
  });

  const fabric = await materials.createMaterial(pm, {
    name: "Single Jersey 180 GSM",
    kind: "FABRIC",
    unit: "METER",
    color: "Navy",
    specification: "100% cotton, 72 in open width",
    supplierId: mill.id,
    reorderLevel: 100,
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
  const thread = await materials.createMaterial(store, {
    name: "Sewing Thread 40/2",
    kind: "TRIM",
    unit: "CONE",
  });
  const acc = await ensureControlAccounts(company.id);
  return {
    company,
    admin,
    pm,
    accounts,
    store,
    sales,
    mill,
    trims,
    buyer,
    main,
    floor,
    variant,
    project,
    fabric,
    rib,
    buttons,
    thread,
    acc,
  };
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

/** A control account's balance in its normal direction, e.g. "1500.00". */
async function balance(env: Env, key: ControlAccountKey) {
  return (await chart.getAccount(env.admin, env.acc[key])).balance;
}

/** Every check of the books passes, raw materials and work in progress included. */
async function expectBooksOk(env: Env) {
  const check = await reports.getBooksCheck(env.accounts);
  expect(check.checks.filter((c) => !c.ok)).toEqual([]);
  expect(check.checks.map((c) => c.key)).toEqual(
    expect.arrayContaining(["RAW_MATERIALS", "WORK_IN_PROGRESS"]),
  );
}

type Line = { materialId: string; quantity: number; unitPrice: number };

/** A bill from the mill on credit (Due), received into the main store. */
const buy = (env: Env, items: Line[], extra: Record<string, unknown> = {}) =>
  purchases.createPurchase(env.pm, {
    supplierId: env.mill.id,
    paymentType: "DUE",
    items,
    ...extra,
  });

const pair = (m: {
  quantity: { toString(): string };
  stockValue: { toFixed(n: number): string } | null;
}) => [m.quantity.toString(), m.stockValue?.toFixed(2)];

run("raw materials", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("numbers materials per kind and guards codes, units and archiving", async () => {
    const env = await setup();
    expect([env.fabric.code, env.rib.code, env.buttons.code, env.thread.code]).toEqual([
      "FAB-0001",
      "FAB-0002",
      "TRM-0001",
      "TRM-0002",
    ]);
    const label = await materials.createMaterial(env.pm, {
      code: "LBL-MAIN",
      name: "Main woven label",
      kind: "ACCESSORY",
      unit: "PCS",
    });
    expect(label.code).toBe("LBL-MAIN");
    await expectAppError(
      materials.createMaterial(env.pm, {
        code: "lbl-main",
        name: "Copy of the label",
        kind: "ACCESSORY",
        unit: "PCS",
      }),
      "CONFLICT",
    );
    // A code typed in the FAB series moves the automatic numbering past it.
    await materials.createMaterial(env.pm, {
      code: "FAB-0010",
      name: "Pique 220 GSM",
      kind: "FABRIC",
      unit: "METER",
    });
    const interlock = await materials.createMaterial(env.pm, {
      name: "Interlock 240 GSM",
      kind: "FABRIC",
      unit: "KG",
    });
    expect(interlock.code).toBe("FAB-0011");

    // Pieces are counted whole; only suppliers supply; Sales has no say over materials.
    await expectAppError(
      materials.createMaterial(env.pm, {
        name: "Poly bag 12x16",
        kind: "PACKAGING",
        unit: "PCS",
        reorderLevel: 10.5,
      }),
      "VALIDATION",
    );
    await expectAppError(
      materials.createMaterial(env.pm, {
        name: "Twill tape",
        kind: "TRIM",
        unit: "METER",
        supplierId: env.buyer.id,
      }),
      "VALIDATION",
    );
    await expectAppError(
      materials.createMaterial(env.sales, { name: "Carton", kind: "PACKAGING", unit: "PCS" }),
      "FORBIDDEN",
    );

    // The unit can change until the material has stock or orders.
    expect((await materials.updateMaterial(env.pm, interlock.id, { unit: "METER" })).unit).toBe(
      "METER",
    );
    await materials.addOpeningStock(env.pm, interlock.id, { quantity: 40, unitCost: 220 });
    await expectAppError(
      materials.updateMaterial(env.pm, interlock.id, { unit: "KG" }),
      "CONFLICT",
    );

    // Archiving waits until the stock is gone.
    await expectAppError(
      materials.updateMaterial(env.pm, interlock.id, { isActive: false }),
      "CONFLICT",
    );
    await materials.recordWastage(env.store, interlock.id, {
      quantity: 40,
      reason: "Damp damage in the store",
    });
    const archived = await materials.updateMaterial(env.pm, interlock.id, { isActive: false });
    expect(archived.isActive).toBe(false);
    expect(pair(archived)).toEqual(["0", "0.00"]);
    await expectAppError(
      materials.addOpeningStock(env.pm, interlock.id, { quantity: 1, unitCost: 1 }),
      "CONFLICT",
    );

    // Lists: search, kind, low stock (the jersey's reorder level is 100 m) and archived ones.
    const found = await materials.listMaterials(env.store, { search: "jersey" });
    expect(found.items.map((m) => m.code)).toEqual(["FAB-0001"]);
    // The store sees quantities but not what they cost.
    expect(found.items[0]).toMatchObject({ isLow: true, avgCost: null, stockValue: null });
    expect(
      (await materials.listMaterials(env.pm, { kind: "TRIM" })).items.map((m) => m.code),
    ).toEqual(["TRM-0001", "TRM-0002"]);
    expect(
      (await materials.listMaterials(env.pm, { lowStock: "true" })).items.map((m) => m.code),
    ).toEqual(["FAB-0001"]);
    expect(
      (
        await materials.listMaterials(env.pm, { kind: "FABRIC", includeInactive: "true" })
      ).items.map((m) => m.code),
    ).toEqual(["FAB-0001", "FAB-0002", "FAB-0010", "FAB-0011"]);
    await expectBooksOk(env);
  });

  it("orders fabric, receives it on the supplier's bill and leaves the paying to Accounts", async () => {
    const env = await setup();
    const order = await orders.createPurchaseOrder(env.pm, {
      supplierId: env.mill.id,
      projectId: env.project.id,
      expectedDate: dayFromToday(10),
      supplierRef: "PI-2026-118",
      lines: [
        { materialId: env.fabric.id, quantity: 500, unitPrice: 175 },
        { materialId: env.rib.id, quantity: 60, unitPrice: 420 },
      ],
    });
    expect(order).toMatchObject({ status: "OPEN", isOverdue: false });
    expect(order.number).toMatch(/^PO-/);
    expect(order.totalAmount?.toFixed(2)).toBe("112700.00");
    // The store sees what is coming, without the prices.
    const storeView = await orders.getPurchaseOrder(env.store, order.id);
    expect(storeView.totalAmount).toBeNull();
    expect(
      storeView.lines.map((l) => [l.material.code, l.pending.toString(), l.unitPrice]),
    ).toEqual([
      ["FAB-0001", "500", null],
      ["FAB-0002", "60", null],
    ]);

    // The first lot arrives with the bill: 300 m of jersey and all the rib.
    const [jersey, rib] = order.lines;
    const bill = await purchases.createPurchase(env.pm, {
      purchaseOrderId: order.id,
      supplierRef: "NF-7781",
      paymentType: "DUE",
      items: [
        { purchaseOrderLineId: jersey!.id, quantity: 300 },
        { purchaseOrderLineId: rib!.id, quantity: 60 },
      ],
    });
    expect(bill).toMatchObject({
      status: "UNPAID",
      supplierId: env.mill.id,
      warehouse: { id: env.main.id },
      purchaseOrder: { id: order.id },
    });
    expect(bill.totalAmount.toFixed(2)).toBe("77700.00");
    const partly = await orders.getPurchaseOrder(env.pm, order.id);
    expect(partly.status).toBe("PARTIALLY_RECEIVED");
    expect(partly.lines.map((l) => [l.receivedQty.toString(), l.pending.toString()])).toEqual([
      ["300", "200"],
      ["60", "0"],
    ]);
    const fabric = await materials.getMaterial(env.pm, env.fabric.id);
    expect(pair(fabric)).toEqual(["300", "52500.00"]);
    expect(fabric.avgCost?.toFixed(4)).toBe("175.0000");
    expect(fabric.isLow).toBe(false);
    expect(fabric.incomingQuantity.toString()).toBe("200");
    expect(fabric.stores.map((s) => [s.warehouse.name, s.quantity.toString()])).toEqual([
      ["Main Warehouse", "300"],
    ]);
    expect(await balance(env, "RAW_MATERIALS")).toBe("77700.00");
    expect(await balance(env, "PAYABLE")).toBe("77700.00");

    // Production records bills on credit; paying out is Accounts' job.
    await expectAppError(
      purchases.createPurchase(env.pm, {
        supplierId: env.mill.id,
        paymentType: "CASH_BANK",
        items: [{ materialId: env.fabric.id, quantity: 1, unitPrice: 175 }],
      }),
      "FORBIDDEN",
    );
    await expectAppError(
      purchases.payPurchase(env.pm, bill.id, { amount: 1000, method: "CASH" }),
      "FORBIDDEN",
    );
    const paid = await purchases.payPurchase(env.accounts, bill.id, {
      amount: 30000,
      method: "CASH",
    });
    expect(paid.status).toBe("PARTIALLY_PAID");
    expect(paid.dueAmount.toFixed(2)).toBe("47700.00");
    expect(await balance(env, "CASH")).toBe("-30000.00");

    // The rest of the jersey comes at a higher price, 10 m over the order.
    const second = await purchases.createPurchase(env.pm, {
      purchaseOrderId: order.id,
      paymentType: "DUE",
      items: [{ purchaseOrderLineId: jersey!.id, quantity: 210, unitPrice: 180 }],
    });
    expect(second.totalAmount.toFixed(2)).toBe("37800.00");
    const received = await orders.getPurchaseOrder(env.pm, order.id);
    expect(received.status).toBe("RECEIVED");
    expect(received.bills.map((b) => b.number)).toEqual([bill.number, second.number]);
    const now = await materials.getMaterial(env.pm, env.fabric.id);
    expect(pair(now)).toEqual(["510", "90300.00"]);
    expect(now.avgCost?.toFixed(4)).toBe("177.0588");
    expect(now.incomingQuantity.toString()).toBe("0");

    // A received order takes no more goods and has nothing left to close.
    await expectAppError(
      purchases.createPurchase(env.pm, {
        purchaseOrderId: order.id,
        paymentType: "DUE",
        items: [{ purchaseOrderLineId: jersey!.id, quantity: 1 }],
      }),
      "CONFLICT",
    );
    await expectAppError(
      orders.closePurchaseOrder(env.pm, order.id, { reason: "Nothing more to come" }),
      "CONFLICT",
    );
    // Production's bill list shows the material bill; voiding it belongs to Raw materials.
    expect((await costs.getBill(env.pm, bill.id)).items).toHaveLength(2);
    await expectAppError(
      costs.voidBill(env.pm, bill.id, { reason: "Entered against the wrong project" }),
      "CONFLICT",
    );
    await expectBooksOk(env);
  });

  it("issues materials to production at average cost and takes unused ones back at their charge", async () => {
    const env = await setup();
    await buy(env, [{ materialId: env.fabric.id, quantity: 100, unitPrice: 150 }]);
    await buy(env, [{ materialId: env.fabric.id, quantity: 100, unitPrice: 170 }]);
    await buy(env, [{ materialId: env.buttons.id, quantity: 3000, unitPrice: 1.2 }], {
      supplierId: env.trims.id,
    });
    // Jersey: 200 m worth 32,000 (160 a metre). Buttons: 3,000 worth 3,600.

    const issue = await issues.issueToProduction(env.store, {
      projectId: env.project.id,
      receivedBy: "Karim (cutting master)",
      lines: [
        { materialId: env.fabric.id, quantity: 120 },
        { materialId: env.buttons.id, quantity: 2000 },
      ],
    });
    expect(issue).toMatchObject({ kind: "ISSUE", receivedBy: "Karim (cutting master)" });
    expect(issue.number).toMatch(/^MI-/);
    // The store hands materials out without seeing what they cost.
    expect(issue.totalValue).toBeNull();
    expect(issue.lines.map((l) => [l.material.code, l.quantity.toString(), l.value])).toEqual([
      ["FAB-0001", "120", null],
      ["TRM-0001", "2000", null],
    ]);
    const priced = await issues.getIssue(env.pm, issue.id);
    expect(priced.totalValue?.toFixed(2)).toBe("21600.00");
    expect(priced.lines.map((l) => l.value?.toFixed(2))).toEqual(["19200.00", "2400.00"]);
    expect(await balance(env, "WORK_IN_PROGRESS")).toBe("21600.00");
    expect(await balance(env, "RAW_MATERIALS")).toBe("14000.00");

    // The project's costing now carries the materials.
    const sheet = await costs.getProjectCostSheet(env.pm, env.project.id);
    expect(sheet.summary.materialCost.toFixed(2)).toBe("21600.00");
    expect(sheet.summary.totalCost.toFixed(2)).toBe("21600.00");
    expect(
      sheet.byMaterial.map((m) => [
        m.material.code,
        m.netQuantity.toString(),
        m.netValue.toFixed(2),
      ]),
    ).toEqual([
      ["FAB-0001", "120", "19200.00"],
      ["TRM-0001", "2000", "2400.00"],
    ]);
    expect(sheet.entries.map((e) => [e.kind, e.number])).toEqual([
      ["MATERIAL_ISSUE", issue.number],
    ]);

    // Not more than the store holds, not half a button, each material once, not by Accounts.
    await expectAppError(
      issues.issueToProduction(env.store, {
        projectId: env.project.id,
        lines: [{ materialId: env.fabric.id, quantity: 80.5 }],
      }),
      "CONFLICT",
    );
    await expectAppError(
      issues.issueToProduction(env.store, {
        projectId: env.project.id,
        lines: [{ materialId: env.buttons.id, quantity: 10.5 }],
      }),
      "VALIDATION",
    );
    await expect(
      issues.issueToProduction(env.store, {
        projectId: env.project.id,
        lines: [
          { materialId: env.fabric.id, quantity: 1 },
          { materialId: env.fabric.id, quantity: 2 },
        ],
      }),
    ).rejects.toBeInstanceOf(ZodError);
    await expectAppError(
      issues.issueToProduction(env.accounts, {
        projectId: env.project.id,
        lines: [{ materialId: env.fabric.id, quantity: 1 }],
      }),
      "FORBIDDEN",
    );

    // New jersey arrives at 200 a metre: the store's average moves, the project's charge does not.
    await buy(env, [{ materialId: env.fabric.id, quantity: 100, unitPrice: 200 }]);
    const back = await issues.returnFromProduction(env.store, {
      projectId: env.project.id,
      receivedBy: "Karim (cutting master)",
      lines: [{ materialId: env.fabric.id, quantity: 20 }],
    });
    expect(back.kind).toBe("RETURN");
    expect(back.number).toMatch(/^MR-/);
    expect((await issues.getIssue(env.pm, back.id)).totalValue?.toFixed(2)).toBe("3200.00");
    const fabric = await materials.getMaterial(env.pm, env.fabric.id);
    expect(pair(fabric)).toEqual(["200", "36000.00"]);
    expect(fabric.avgCost?.toFixed(4)).toBe("180.0000");
    expect(await balance(env, "WORK_IN_PROGRESS")).toBe("18400.00");

    // Only what the project still holds can come back.
    await expectAppError(
      issues.returnFromProduction(env.store, {
        projectId: env.project.id,
        lines: [{ materialId: env.fabric.id, quantity: 100.5 }],
      }),
      "VALIDATION",
    );
    await expectAppError(
      issues.returnFromProduction(env.store, {
        projectId: env.project.id,
        lines: [{ materialId: env.thread.id, quantity: 1 }],
      }),
      "VALIDATION",
    );

    const usage = await issues.getProjectMaterials(env.pm, env.project.id);
    expect(usage.materialCost?.toFixed(2)).toBe("18400.00");
    expect(
      usage.materials.map((m) => [
        m.material.code,
        m.issuedQuantity.toString(),
        m.returnedQuantity.toString(),
        m.netQuantity.toString(),
        m.netValue?.toFixed(2),
      ]),
    ).toEqual([
      ["FAB-0001", "120", "20", "100", "16000.00"],
      ["TRM-0001", "2000", "0", "2000", "2400.00"],
    ]);
    expect(usage.notes.map((n) => n.kind)).toEqual(["ISSUE", "RETURN"]);
    expect((await issues.getProjectMaterials(env.store, env.project.id)).materialCost).toBeNull();
    expect(
      (await issues.listIssues(env.store, { projectId: env.project.id, kind: "RETURN" })).items.map(
        (n) => n.number,
      ),
    ).toEqual([back.number]);

    // The factory delivers all 1,000 polos: the material cost moves into finished stock.
    const delivery = await intakes.createIntake(env.pm, {
      projectId: env.project.id,
      lines: [{ variantId: env.variant.id, quantity: 1000 }],
    });
    const confirmed = await intakes.confirmIntake(env.pm, delivery.id, { finalDelivery: true });
    expect(confirmed.totalCost?.toFixed(2)).toBe("18400.00");
    expect(await balance(env, "WORK_IN_PROGRESS")).toBe("0.00");
    expect(await balance(env, "INVENTORY")).toBe("18400.00");
    // Once the cost has moved into stock, materials can no longer come back at cost.
    await expectAppError(
      issues.returnFromProduction(env.store, {
        projectId: env.project.id,
        lines: [{ materialId: env.buttons.id, quantity: 10 }],
      }),
      "CONFLICT",
    );
    await expectBooksOk(env);
  });

  it("counts, writes off and moves stock between stores, keeping the stock card", async () => {
    const env = await setup();
    // 50 cones held before the ERP, at 120 each.
    const opened = await materials.addOpeningStock(env.pm, env.thread.id, {
      quantity: 50,
      unitCost: 120,
      date: dayFromToday(-3),
      note: "Count on the first day",
    });
    expect(pair(opened)).toEqual(["50", "6000.00"]);
    expect(await balance(env, "OPENING_EQUITY")).toBe("6000.00");
    await expectAppError(
      materials.addOpeningStock(env.store, env.thread.id, { quantity: 1, unitCost: 1 }),
      "FORBIDDEN",
    );

    // 20 cones go to the cutting floor: the quantities move, the value does not.
    const moved = await materials.transferStock(env.store, env.thread.id, {
      fromWarehouseId: env.main.id,
      toWarehouseId: env.floor.id,
      quantity: 20,
    });
    expect(moved.stores.map((s) => [s.warehouse.name, s.quantity.toString()])).toEqual([
      ["Cutting Floor Store", "20"],
      ["Main Warehouse", "30"],
    ]);
    await expectAppError(
      materials.transferStock(env.store, env.thread.id, {
        fromWarehouseId: env.floor.id,
        toWarehouseId: env.main.id,
        quantity: 25,
      }),
      "CONFLICT",
    );

    // Counts: two cones missing in the main store, one extra on the floor.
    await materials.countStock(env.store, env.thread.id, { countedQuantity: 28 });
    await materials.countStock(env.store, env.thread.id, {
      warehouseId: env.floor.id,
      countedQuantity: 21,
    });
    await expectAppError(
      materials.countStock(env.store, env.thread.id, { countedQuantity: 28 }),
      "VALIDATION",
    );
    await expectAppError(
      materials.countStock(env.accounts, env.thread.id, { countedQuantity: 27 }),
      "FORBIDDEN",
    );
    // Wet cones are thrown away: whole cones only.
    await expectAppError(
      materials.recordWastage(env.store, env.thread.id, {
        warehouseId: env.floor.id,
        quantity: 1.5,
        reason: "Wet in the rain",
      }),
      "VALIDATION",
    );
    await materials.recordWastage(env.store, env.thread.id, {
      warehouseId: env.floor.id,
      quantity: 3,
      reason: "Wet in the rain",
    });

    const thread = await materials.getMaterial(env.pm, env.thread.id);
    expect(pair(thread)).toEqual(["46", "5520.00"]);
    expect(await balance(env, "PRODUCTION_LOSS")).toBe("480.00");

    // The stock card for the whole company, in date order with running balances.
    const card = await materials.getStockCard(env.pm, env.thread.id);
    expect(card.lines.map((l) => [l.type, l.quantity.toString(), l.balance.toString()])).toEqual([
      ["OPENING", "50", "50"],
      ["TRANSFER_OUT", "-20", "30"],
      ["TRANSFER_IN", "20", "50"],
      ["ADJUSTMENT", "-2", "48"],
      ["ADJUSTMENT", "1", "49"],
      ["WASTAGE", "-3", "46"],
    ]);
    expect(card.lines[1]!.otherStore?.name).toBe("Cutting Floor Store");
    expect(card.lines.map((l) => l.balanceValue?.toFixed(2))).toEqual([
      "6000.00",
      "6000.00",
      "6000.00",
      "5760.00",
      "5880.00",
      "5520.00",
    ]);
    expect(card.closing.value?.toFixed(2)).toBe("5520.00");
    // One store: its quantities only (values are kept for the whole company).
    const floorCard = await materials.getStockCard(env.pm, env.thread.id, {
      warehouseId: env.floor.id,
    });
    expect(floorCard.lines.map((l) => [l.type, l.balance.toString(), l.balanceValue])).toEqual([
      ["TRANSFER_IN", "20", null],
      ["ADJUSTMENT", "21", null],
      ["WASTAGE", "18", null],
    ]);
    // From today: the opening stock is brought forward.
    const recent = await materials.getStockCard(env.pm, env.thread.id, { from: dayFromToday(0) });
    expect(recent.opening.quantity.toString()).toBe("50");
    expect(recent.opening.value?.toFixed(2)).toBe("6000.00");
    expect(recent.lines).toHaveLength(5);
    // The store reads the card without values.
    const storeCard = await materials.getStockCard(env.store, env.thread.id);
    expect(storeCard.lines.every((l) => l.value === null && l.unitCost === null)).toBe(true);

    const wasted = await materials.listMovements(env.pm, {
      materialId: env.thread.id,
      type: "WASTAGE",
    });
    expect(wasted.items).toHaveLength(1);
    expect(wasted.items[0]).toMatchObject({
      note: "Wet in the rain",
      warehouse: { name: "Cutting Floor Store" },
      material: { code: "TRM-0002" },
    });
    expect(wasted.items[0]!.value?.toFixed(2)).toBe("-360.00");

    const summary = await materials.getMaterialsSummary(env.pm);
    expect(summary.totals).toMatchObject({ materials: 4, inStock: 1 });
    expect(summary.totals.value?.toFixed(2)).toBe("5520.00");
    expect(summary.stores.map((s) => [s.warehouse.name, s.materials])).toEqual([
      ["Cutting Floor Store", 1],
      ["Main Warehouse", 1],
    ]);
    expect(summary.lowStock.map((m) => m.code)).toEqual(["FAB-0001"]);
    expect((await materials.getMaterialsSummary(env.store)).totals.value).toBeNull();
    await expectBooksOk(env);
  });

  it("sends goods back to the supplier at the bill price and voids purchases cleanly", async () => {
    const env = await setup();
    const first = await buy(env, [{ materialId: env.fabric.id, quantity: 100, unitPrice: 10 }]);
    const second = await buy(env, [{ materialId: env.fabric.id, quantity: 100, unitPrice: 20 }], {
      supplierRef: "NF-7790",
    });
    // 200 m worth 3,000 (15 a metre).

    // 40 m of the second lot have a shade problem and go back at its price.
    const lot = second.items[0]!;
    const note = await returns.createSupplierReturn(env.pm, {
      billId: second.id,
      reason: "Shade variation on 40 m",
      lines: [{ billItemId: lot.id, quantity: 40 }],
    });
    expect(note.number).toMatch(/^DN-/);
    expect([note.totalAmount.toFixed(2), note.stockValue.toFixed(2)]).toEqual(["800.00", "800.00"]);
    expect(pair(await materials.getMaterial(env.pm, env.fabric.id))).toEqual(["160", "2200.00"]);
    // The supplier is owed 800 less, settled against the oldest bill first.
    expect(await balance(env, "PAYABLE")).toBe("2200.00");
    expect((await purchases.getPurchase(env.pm, first.id)).dueAmount.toFixed(2)).toBe("200.00");
    const afterReturn = await purchases.getPurchase(env.pm, second.id);
    expect([
      afterReturn.items[0]!.returnedQty.toString(),
      afterReturn.items[0]!.returnableQty.toString(),
    ]).toEqual(["40", "60"]);

    // No more than the bill line can go back, and the store does not send goods back.
    await expectAppError(
      returns.createSupplierReturn(env.pm, {
        billId: second.id,
        reason: "Shade variation again",
        lines: [{ billItemId: lot.id, quantity: 60.5 }],
      }),
      "VALIDATION",
    );
    await expectAppError(
      returns.createSupplierReturn(env.store, {
        billId: second.id,
        reason: "Shade variation again",
        lines: [{ billItemId: lot.id, quantity: 1 }],
      }),
      "FORBIDDEN",
    );
    // A bill with goods sent back stays until the return is undone.
    await expectAppError(
      purchases.voidPurchase(env.pm, second.id, { reason: "Entered twice" }),
      "CONFLICT",
    );
    await returns.voidSupplierReturn(env.pm, note.id, { reason: "Supplier took the shade back" });
    expect(pair(await materials.getMaterial(env.pm, env.fabric.id))).toEqual(["200", "3000.00"]);
    expect(await balance(env, "PAYABLE")).toBe("3000.00");
    await expectAppError(
      returns.voidSupplierReturn(env.pm, note.id, { reason: "Supplier took the shade back" }),
      "CONFLICT",
    );

    // Accounts had paid part of the second bill before it turned out to be a duplicate.
    await purchases.payPurchase(env.accounts, second.id, { amount: 500, method: "CASH" });
    const voided = await purchases.voidPurchase(env.pm, second.id, { reason: "Entered twice" });
    expect(voided.status).toBe("VOID");
    const left = await materials.getMaterial(env.pm, env.fabric.id);
    expect(pair(left)).toEqual(["100", "1000.00"]);
    expect(left.avgCost?.toFixed(4)).toBe("10.0000");
    // What was paid on it now settles the first bill.
    expect((await purchases.getPurchase(env.pm, first.id)).dueAmount.toFixed(2)).toBe("500.00");
    expect(await balance(env, "PAYABLE")).toBe("500.00");
    await expectAppError(
      purchases.voidPurchase(env.pm, second.id, { reason: "Entered twice" }),
      "CONFLICT",
    );

    // Goods already handed to production cannot be un-bought.
    await issues.issueToProduction(env.store, {
      projectId: env.project.id,
      lines: [{ materialId: env.fabric.id, quantity: 30 }],
    });
    await expectAppError(
      purchases.voidPurchase(env.pm, first.id, { reason: "Wrong bill" }),
      "CONFLICT",
    );
    await expectAppError(
      purchases.voidPurchase(env.store, first.id, { reason: "Wrong bill" }),
      "FORBIDDEN",
    );
    await expectBooksOk(env);
  });

  it("books the cost difference when goods go back at a price the stock no longer carries", async () => {
    const env = await setup();
    const dear = await buy(env, [{ materialId: env.rib.id, quantity: 100, unitPrice: 20 }]);
    await buy(env, [{ materialId: env.rib.id, quantity: 300, unitPrice: 1 }]);
    // 400 kg worth 2,300 (5.75 a kg); 250 kg go to production at that average.
    await issues.issueToProduction(env.store, {
      projectId: env.project.id,
      lines: [{ materialId: env.rib.id, quantity: 250 }],
    });
    // 150 kg worth 862.50 are left when the dear lot (2,000) goes back.
    const note = await returns.createSupplierReturn(env.pm, {
      billId: dear.id,
      reason: "Wrong GSM delivered",
      lines: [{ billItemId: dear.items[0]!.id, quantity: 100 }],
    });
    expect([note.totalAmount.toFixed(2), note.stockValue.toFixed(2)]).toEqual([
      "2000.00",
      "862.50",
    ]);
    expect(pair(await materials.getMaterial(env.pm, env.rib.id))).toEqual(["50", "0.00"]);
    expect(await balance(env, "RAW_MATERIALS")).toBe("0.00");
    expect(await balance(env, "PRODUCTION_LOSS")).toBe("-1137.50");
    expect(await balance(env, "PAYABLE")).toBe("300.00");
    await expectBooksOk(env);
  });

  it("edits, closes and cancels purchase orders and flags late deliveries", async () => {
    const env = await setup();
    const buttons = [{ materialId: env.buttons.id, quantity: 5000, unitPrice: 1.1 }];
    await expectAppError(
      orders.createPurchaseOrder(env.pm, { supplierId: env.buyer.id, lines: buttons }),
      "VALIDATION",
    );
    await expectAppError(
      orders.createPurchaseOrder(env.pm, {
        supplierId: env.trims.id,
        orderDate: dayFromToday(0),
        expectedDate: dayFromToday(-1),
        lines: buttons,
      }),
      "VALIDATION",
    );
    await expectAppError(
      orders.createPurchaseOrder(env.store, { supplierId: env.trims.id, lines: buttons }),
      "FORBIDDEN",
    );
    const late = await orders.createPurchaseOrder(env.pm, {
      supplierId: env.trims.id,
      orderDate: dayFromToday(-20),
      expectedDate: dayFromToday(-5),
      lines: buttons,
    });
    expect(late.isOverdue).toBe(true);
    // Lines can change while nothing has arrived.
    const edited = await orders.updatePurchaseOrder(env.pm, late.id, {
      lines: [
        { materialId: env.buttons.id, quantity: 4000, unitPrice: 1.15 },
        { materialId: env.thread.id, quantity: 200, unitPrice: 95 },
      ],
    });
    expect(edited.totalAmount?.toFixed(2)).toBe("23600.00");
    expect(
      (await orders.listPurchaseOrders(env.pm, { overdue: "true" })).items.map((o) => o.number),
    ).toEqual([late.number]);
    const summary = await materials.getMaterialsSummary(env.pm);
    expect(summary.purchaseOrders).toMatchObject({ open: 1, partiallyReceived: 0 });
    expect(summary.purchaseOrders.overdue.map((o) => [o.number, o.daysLate])).toEqual([
      [late.number, 5],
    ]);
    const overview = await reports.getAccountsOverview(env.accounts);
    expect(overview.rawMaterials).toMatchObject({
      value: "0.00",
      lowStock: 1,
      openPurchaseOrders: 1,
      overdueDeliveries: 1,
    });

    // Half the buttons arrive.
    const bill = await purchases.createPurchase(env.pm, {
      purchaseOrderId: late.id,
      paymentType: "DUE",
      items: [{ purchaseOrderLineId: edited.lines[0]!.id, quantity: 2000 }],
    });
    expect(bill.totalAmount.toFixed(2)).toBe("2300.00");
    await expectAppError(
      orders.updatePurchaseOrder(env.pm, late.id, {
        lines: [{ materialId: env.buttons.id, quantity: 1, unitPrice: 1 }],
      }),
      "CONFLICT",
    );
    await expectAppError(
      orders.cancelPurchaseOrder(env.pm, late.id, { reason: "Supplier stopped" }),
      "CONFLICT",
    );
    const rescheduled = await orders.updatePurchaseOrder(env.pm, late.id, {
      expectedDate: dayFromToday(3),
      supplierRef: "DTH-PI-55",
    });
    expect(rescheduled).toMatchObject({ isOverdue: false, supplierRef: "DTH-PI-55" });
    // The rest will not come.
    const closed = await orders.closePurchaseOrder(env.pm, late.id, {
      reason: "Supplier out of stock",
    });
    expect(closed).toMatchObject({ status: "CLOSED", closedReason: "Supplier out of stock" });
    await expectAppError(
      purchases.createPurchase(env.pm, {
        purchaseOrderId: late.id,
        paymentType: "DUE",
        items: [{ purchaseOrderLineId: edited.lines[0]!.id, quantity: 10 }],
      }),
      "CONFLICT",
    );
    // Voiding its bill leaves it closed, with nothing received.
    await purchases.voidPurchase(env.pm, bill.id, { reason: "Bill entered on the wrong order" });
    const after = await orders.getPurchaseOrder(env.pm, late.id);
    expect(after.status).toBe("CLOSED");
    expect(after.lines.map((l) => l.receivedQty.toString())).toEqual(["0", "0"]);

    // An order nothing arrived on is cancelled, not closed.
    const spare = await orders.createPurchaseOrder(env.pm, {
      supplierId: env.mill.id,
      lines: [{ materialId: env.fabric.id, quantity: 50, unitPrice: 170 }],
    });
    await expectAppError(
      orders.closePurchaseOrder(env.pm, spare.id, { reason: "Not needed now" }),
      "CONFLICT",
    );
    expect(
      await orders.cancelPurchaseOrder(env.pm, spare.id, { reason: "Not needed now" }),
    ).toMatchObject({ status: "CANCELLED", closedReason: "Not needed now" });

    // A material still due on an open order cannot be archived.
    const pending = await orders.createPurchaseOrder(env.pm, {
      supplierId: env.trims.id,
      lines: [{ materialId: env.thread.id, quantity: 10, unitPrice: 95 }],
    });
    await expectAppError(
      materials.updateMaterial(env.pm, env.thread.id, { isActive: false }),
      "CONFLICT",
    );
    await orders.cancelPurchaseOrder(env.pm, pending.id, { reason: "Ordered elsewhere" });
    expect(
      (await materials.updateMaterial(env.pm, env.thread.id, { isActive: false })).isActive,
    ).toBe(false);
    await expectBooksOk(env);
  });

  it("lets only Accounts record a purchase paid on the spot", async () => {
    const env = await setup();
    const items = [{ materialId: env.buttons.id, quantity: 1000, unitPrice: 1.25 }];
    await expectAppError(
      purchases.createPurchase(env.store, { supplierId: env.trims.id, paymentType: "DUE", items }),
      "FORBIDDEN",
    );
    const cash = await purchases.createPurchase(env.accounts, {
      supplierId: env.trims.id,
      paymentType: "CASH_BANK",
      method: "CASH",
      reference: "Cash memo 55",
      warehouseId: env.floor.id,
      items,
    });
    expect(cash).toMatchObject({ status: "PAID", warehouse: { name: "Cutting Floor Store" } });
    expect(cash.paidAmount.toFixed(2)).toBe("1250.00");
    expect(cash.payments).toHaveLength(1);
    expect(await balance(env, "CASH")).toBe("-1250.00");
    expect(await balance(env, "PAYABLE")).toBe("0.00");
    expect(await balance(env, "RAW_MATERIALS")).toBe("1250.00");
    await expectAppError(
      purchases.payPurchase(env.accounts, cash.id, { amount: 1, method: "CASH" }),
      "CONFLICT",
    );
    // A bill carries a price.
    await expectAppError(
      purchases.createPurchase(env.pm, {
        supplierId: env.trims.id,
        paymentType: "DUE",
        items: [{ materialId: env.buttons.id, quantity: 10, unitPrice: 0 }],
      }),
      "VALIDATION",
    );
    // Bills are about prices: the store cannot read them.
    await expectAppError(purchases.listPurchases(env.store), "FORBIDDEN");
    expect(
      (await purchases.listPurchases(env.accounts, { warehouseId: env.floor.id })).items.map(
        (b) => b.number,
      ),
    ).toEqual([cash.number]);
    await expectBooksOk(env);
  });

  it("keeps each company's materials apart and catches a value that drifts from the ledger", async () => {
    const env = await setup("Extras");
    const other = await setup("Other Co");
    await buy(env, [{ materialId: env.fabric.id, quantity: 10, unitPrice: 100 }]);
    await expectAppError(materials.getMaterial(other.pm, env.fabric.id), "NOT_FOUND");
    await expectAppError(
      issues.issueToProduction(other.store, {
        projectId: other.project.id,
        lines: [{ materialId: env.fabric.id, quantity: 1 }],
      }),
      "NOT_FOUND",
    );
    await expectAppError(
      purchases.createPurchase(other.pm, {
        supplierId: other.mill.id,
        paymentType: "DUE",
        items: [{ materialId: env.fabric.id, quantity: 1, unitPrice: 1 }],
      }),
      "NOT_FOUND",
    );
    expect((await materials.listMaterials(other.pm)).items.map((m) => m.id)).not.toContain(
      env.fabric.id,
    );
    await expectBooksOk(env);

    // A value changed behind the ledger's back is caught.
    await prisma.rawMaterial.update({ where: { id: env.fabric.id }, data: { stockValue: 900 } });
    const check = await reports.getBooksCheck(env.accounts);
    const raw = check.checks.find((c) => c.key === "RAW_MATERIALS");
    expect(raw).toMatchObject({ ok: false, books: "1000.00", register: "900.00" });
    expect(raw?.note).toContain("FAB-0001");
  });
});
