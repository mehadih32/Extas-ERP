import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * A style's finishing and QC: counts grading pieces A, B or C (mending) with
 * rejects kept apart, mended pieces coming back, Receive Full Packing List
 * moving only the A and B pieces to the Sales stock and logging what is missing
 * in the factory's fault log at the final unit cost (total cost ÷ (A + B)),
 * and the Employee Action Log of the style and its batch.
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
import * as parties from "@/modules/parties/party.service";
import * as actionLog from "@/modules/production/action-log.service";
import * as batches from "@/modules/production/batch.service";
import * as costs from "@/modules/production/cost.service";
import * as cutting from "@/modules/production/cutting.service";
import * as finishing from "@/modules/production/finishing.service";
import * as intakes from "@/modules/production/intake.service";
import * as projects from "@/modules/production/project.service";
import {
  createFinishingCountAction,
  getActionLogAction,
  receivePackingListAction,
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

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

function data<T>(result: ActionResult<T>, label: string): T {
  if (!result.ok) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

/**
 * A polo of 20 pieces (Navy S 10, Navy M 10) at a factory on the app, in a
 * master batch, with 1,800 of making charge on it and all 20 pieces cut.
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
  const small = await catalog.createSize(owner, { name: "S" });
  const medium = await catalog.createSize(owner, { name: "M" });
  const navy = await catalog.createColor(owner, { name: "Navy", hexCode: "#1f2a44" });
  const tops = await catalog.createCategory(owner, { name: "Tops" });
  const style = await styles.createStyle(owner, {
    code: "EX-PL-001",
    name: "Classic Polo",
    categoryId: tops.id,
    retailPrice: 1450,
    wholesalePrice: 900,
  });
  await matrix.generateMatrix(owner, style.id, {
    colorIds: [navy.id],
    sizeIds: [small.id, medium.id],
  });
  const variants = await prisma.productVariant.findMany({
    where: { styleId: style.id },
    include: { size: true },
  });
  const sku = (size: string) => variants.find((v) => v.size.name === size)!.id;
  const { party: factory } = await parties.createParty(owner, {
    kind: "SUPPLIER",
    name: "Gazipur Knit Factory",
  });
  const batch = await batches.createBatch(pm, {
    name: "Winter 2030",
    factoryId: factory.id,
    targetDate: "2030-12-20",
  });
  const polo = await projects.createProject(pm, {
    name: "Brand A polo",
    batchId: batch.id,
    factoryId: factory.id,
    targetDate: "2030-12-20",
    targets: [
      { variantId: sku("S"), quantity: 10 },
      { variantId: sku("M"), quantity: 10 },
    ],
  });
  await costs.ensureProductionCostHeads(company.id);
  const sewing = await prisma.expenseHead.findFirstOrThrow({
    where: { companyId: company.id, name: "Sewing (CM)" },
  });
  await costs.addProjectCost(pm, polo.id, {
    expenseHeadId: sewing.id,
    amount: 1800,
    paymentType: "DUE",
    supplierId: factory.id,
  });
  await cutting.createCuttingReport(pm, polo.id, {
    lines: [
      { colorName: "Navy", sizeName: "S", quantity: 10 },
      { colorName: "Navy", sizeName: "M", quantity: 10 },
    ],
  });
  await prisma.notificationLog.deleteMany();
  return { company, people, owner, pm, accounts, store, factory, batch, polo, sku };
}

type Env = Awaited<ReturnType<typeof setup>>;

async function signInAs(env: Env, who: Who) {
  const { token } = await createSession(env.people[who].id, env.company.id);
  browser.cookies.set(SESSION_COOKIE, token);
}

const graded = (sizeName: string, a: number, b: number, c: number, reject: number) => ({
  colorName: "Navy",
  sizeName,
  a,
  b,
  c,
  reject,
});

/** S: 6 A, 2 B, 1 C; M: 7 A, 1 B, 1 reject. One of each size not counted. */
const firstCount = (env: Env) =>
  finishing.createFinishingCount(env.store, env.polo.id, {
    lines: [graded("S", 6, 2, 1, 0), graded("M", 7, 1, 0, 1)],
  });

run("Production renovation: finishing, the full packing list and the action log", () => {
  let env: Env;

  beforeEach(async () => {
    await resetDb();
    env = await setup();
  });

  it("grades pieces A, B and C with rejects apart, never more than was cut", async () => {
    const empty = await finishing.getFinishingScreen(env.pm, env.polo.id);
    expect(empty.cells.map((c) => [c.sizeName, c.cut, c.notCounted])).toEqual([
      ["S", 10, 10],
      ["M", 10, 10],
    ]);
    expect(empty.can).toMatchObject({ count: true, mend: false, receive: false });

    const count = await firstCount(env);
    expect(count).toMatchObject({ a: 13, b: 3, c: 1, reject: 1 });
    const screen = await finishing.getFinishingScreen(env.pm, env.polo.id);
    expect(screen.totals).toMatchObject({
      cut: 20,
      a: 13,
      b: 3,
      c: 1,
      reject: 1,
      missing: 0,
      notCounted: 2,
      toStock: { a: 13, b: 3 },
      inStock: { a: 0, b: 0 },
    });
    expect(screen.cells.map((c) => [c.sizeName, c.a, c.b, c.c, c.reject, c.notCounted])).toEqual([
      ["S", 6, 2, 1, 0, 1],
      ["M", 7, 1, 0, 1, 1],
    ]);
    // Final unit cost: 1,800 over the 16 A and B pieces; the store sees no costs.
    expect(screen.cost).toEqual({ total: "1800.00", good: 16, perPiece: "112.50" });
    expect((await finishing.getFinishingScreen(env.store, env.polo.id)).cost).toBeNull();
    expect(screen.can).toMatchObject({ count: true, mend: true, receive: true });

    // Only one S piece is left to count.
    const tooMany = await expectAppError(
      finishing.createFinishingCount(env.pm, env.polo.id, {
        lines: [graded("M", 0, 0, 0, 0), graded("S", 2, 0, 0, 0)],
      }),
      "VALIDATION",
    );
    expect(tooMany.message).toBe("Only 1 more Navy S piece is cut and back to count.");
    expect(tooMany.details).toEqual({ "lines.1": ["No more than 1"] });
    await expectAppError(
      finishing.createFinishingCount(env.pm, env.polo.id, {
        lines: [{ colorName: "Olive", sizeName: "S", a: 1, b: 0, c: 0, reject: 0 }],
      }),
      "VALIDATION",
    );

    // Accounts reads finishing but does not count.
    await signInAs(env, "accounts");
    const refused = await createFinishingCountAction(env.polo.id, {
      lines: [graded("S", 1, 0, 0, 0)],
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("FORBIDDEN");
    expect(await prisma.finishingReport.count()).toBe(1);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "FinishingReport", entityId: count.id },
    });
    expect(audit.userId).toBe(env.people.store.id);
    expect(audit.summary).toBe(
      `Finishing count ${count.number} for ${env.polo.code}: 13 A-grade, 3 B-grade, 1 C-grade (mending), 1 rejects`,
    );
  });

  it("brings mended pieces back as A, B or reject and keeps deletes honest", async () => {
    const count = await firstCount(env);
    await expectAppError(
      finishing.backFromMending(env.pm, env.polo.id, {
        lines: [{ colorName: "Navy", sizeName: "S", a: 1, b: 1, reject: 0 }],
      }),
      "VALIDATION",
    );
    const mended = await finishing.backFromMending(env.pm, env.polo.id, {
      lines: [{ colorName: "Navy", sizeName: "S", a: 1, b: 0, reject: 0 }],
    });
    expect(mended).toMatchObject({ a: 1, b: 0, reject: 0 });
    const screen = await finishing.getFinishingScreen(env.pm, env.polo.id);
    expect(screen.totals).toMatchObject({ a: 14, b: 3, c: 0, reject: 1, notCounted: 2 });
    expect(screen.can.mend).toBe(false);

    // The count cannot go while its C piece is back from mending; the return can.
    await expectAppError(finishing.deleteFinishingReport(env.pm, count.id), "CONFLICT");
    await finishing.deleteFinishingReport(env.pm, mended.id);
    await finishing.deleteFinishingReport(env.store, count.id);
    expect(await prisma.finishingReport.count()).toBe(0);

    // A cutting report whose pieces are counted at finishing stays.
    const again = await firstCount(env);
    const cut = await prisma.cuttingReport.findFirstOrThrow();
    await expectAppError(cutting.deleteCuttingReport(env.pm, cut.id), "CONFLICT");
    expect(again.number).toMatch(/^FIN-\d{4}-\d{5}$/);
  });

  it("receives the full packing list: only A and B to stock, missing to the fault log", async () => {
    await firstCount(env);
    // The store receives goods but does not close a style; nor can more go missing than is uncounted.
    await expectAppError(
      finishing.receivePackingList(env.store, env.polo.id, { closeStyle: true }),
      "FORBIDDEN",
    );
    await expectAppError(
      finishing.receivePackingList(env.pm, env.polo.id, {
        missing: [{ colorName: "Navy", sizeName: "S", quantity: 2 }],
      }),
      "VALIDATION",
    );
    expect(await prisma.stockIntake.count()).toBe(0);

    await signInAs(env, "production");
    const done = data(
      await receivePackingListAction(env.polo.id, {
        missing: [
          { colorName: "Navy", sizeName: "S", quantity: 1 },
          { colorName: "Navy", sizeName: "M", quantity: 1 },
        ],
        closeStyle: true,
      }),
      "packing list",
    );
    expect(done).toMatchObject({ a: 13, b: 3, missing: 2, closed: true, unitCost: "112.50" });

    // One confirmed delivery of A and B pieces only, each at 1,800 ÷ 16.
    const intake = await prisma.stockIntake.findUniqueOrThrow({
      where: { id: done.intake!.id },
      include: { lines: { orderBy: [{ grade: "asc" }, { quantity: "desc" }] } },
    });
    expect(intake.status).toBe("CONFIRMED");
    expect(intake.totalCost.toFixed(2)).toBe("1800.00");
    expect(intake.lines.map((l) => [l.grade, l.quantity])).toEqual([
      ["A_GRADE", 7],
      ["A_GRADE", 6],
      ["B_GRADE", 2],
      ["B_GRADE", 1],
    ]);
    for (const l of intake.lines)
      expect(l.unitCost.plus(l.costAdjustment.dividedBy(l.quantity)).toFixed(2)).toBe("112.50");
    const stock = await prisma.stockBalance.findMany({ orderBy: [{ grade: "asc" }] });
    expect(stock.reduce((t, s) => t + s.quantity, 0)).toBe(16);
    expect(
      stock.filter((s) => s.variantId === env.sku("S")).map((s) => [s.grade, s.quantity]),
    ).toEqual([
      ["A_GRADE", 6],
      ["B_GRADE", 2],
    ]);

    // The style is closed with 13 A and 3 B; the missing pieces are the factory's fault.
    const polo = await prisma.productionProject.findUniqueOrThrow({ where: { id: env.polo.id } });
    expect([polo.status, polo.producedQtyA, polo.producedQtyB]).toEqual(["COMPLETED", 13, 3]);
    const fault = await prisma.supplierFault.findUniqueOrThrow({ where: { id: done.fault!.id } });
    expect(fault).toMatchObject({
      supplierId: env.factory.id,
      kind: "MISSING_PIECES",
      status: "OPEN",
      projectId: env.polo.id,
      batchId: env.batch.id,
    });
    expect([fault.quantity?.toFixed(0), fault.amount?.toFixed(2)]).toEqual(["2", "225.00"]);
    expect(fault.note).toBe(
      `2 pieces of ${env.polo.code} missing at the full packing list ${done.number}: Navy S 1, Navy M 1`,
    );
    const told = await prisma.notificationLog.findMany({
      where: { subject: `Missing pieces: ${env.polo.code}` },
    });
    expect(told.length).toBeGreaterThan(0);

    const screen = await finishing.getFinishingScreen(env.pm, env.polo.id);
    expect(screen.totals).toMatchObject({
      a: 13,
      b: 3,
      c: 1,
      reject: 1,
      missing: 2,
      notCounted: 0,
      toStock: { a: 0, b: 0 },
      inStock: { a: 13, b: 3 },
    });
    expect(screen.packed).toMatchObject({ number: done.number, missing: 2 });
    expect(screen.can).toMatchObject({ count: false, receive: false });
    await expectAppError(firstCount(env), "CONFLICT");
  });

  it("an undone packing list is replaced, and its missing pieces waived", async () => {
    await firstCount(env);
    const first = await finishing.receivePackingList(env.store, env.polo.id, {
      missing: [{ colorName: "Navy", sizeName: "S", quantity: 1 }],
    });
    await expectAppError(finishing.deleteFinishingReport(env.pm, first.id), "CONFLICT");
    await intakes.reverseIntake(env.pm, first.intake!.id, { reason: "Counted the wrong carton" });
    const undone = await finishing.getFinishingScreen(env.pm, env.polo.id);
    expect(undone.packed).toBeNull();
    expect(undone.totals).toMatchObject({ missing: 0, toStock: { a: 13, b: 3 } });

    const second = await finishing.receivePackingList(env.store, env.polo.id, {
      missing: [{ colorName: "Navy", sizeName: "M", quantity: 1 }],
    });
    const faults = await prisma.supplierFault.findMany({ orderBy: { number: "asc" } });
    expect(faults.map((f) => [f.id, f.status])).toEqual([
      [first.fault!.id, "WAIVED"],
      [second.fault!.id, "OPEN"],
    ]);
    expect(faults[0]!.settledNote).toBe(`Replaced by the packing list ${second.number}`);
    const polo = await prisma.productionProject.findUniqueOrThrow({ where: { id: env.polo.id } });
    expect([polo.status, polo.producedQtyA, polo.producedQtyB]).toEqual(["ACTIVE", 13, 3]);
  });

  it("keeps the Employee Action Log of the style and its batch", async () => {
    await firstCount(env);
    await finishing.receivePackingList(env.store, env.polo.id, {});

    const log = await actionLog.getActionLog(env.pm, { projectId: env.polo.id });
    const kinds = log.rows.map((r) => r.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(["Style", "Cutting", "Finishing", "Delivery to stock", "Bill"]),
    );
    const cutLine = log.rows.find((r) => r.kind === "Cutting")!;
    expect(cutLine.who?.id).toBe(env.people.production.id);
    expect(cutLine.action).toBe("Added");
    expect(log.people.map((p) => p.id).sort()).toEqual(
      [env.people.production.id, env.people.store.id].sort(),
    );
    // Newest first.
    const times = log.rows.map((r) => r.at);
    expect([...times].sort().reverse()).toEqual(times);

    const byStore = await actionLog.getActionLog(
      env.pm,
      { projectId: env.polo.id },
      // As the filter form sends it, with "Everything" left as the kind.
      { userId: env.people.store.id, kind: "" },
    );
    expect(byStore.rows.length).toBeGreaterThan(0);
    expect(byStore.rows.every((r) => r.who?.id === env.people.store.id)).toBe(true);
    const cuts = await actionLog.getActionLog(
      env.pm,
      { projectId: env.polo.id },
      { kind: "CuttingReport" },
    );
    expect(cuts.rows.map((r) => r.kind)).toEqual(["Cutting"]);

    // The batch's log covers the batch and its styles; Accounts reads it, the store does not.
    await signInAs(env, "accounts");
    const batchLog = data(await getActionLogAction({ batchId: env.batch.id }, {}), "batch log");
    expect(batchLog.rows.map((r) => r.kind)).toEqual(
      expect.arrayContaining(["Master batch", "Style", "Cutting", "Finishing"]),
    );
    expect(batchLog.subject).toMatchObject({ kind: "batch", code: env.batch.code });
    await signInAs(env, "store");
    const refused = await getActionLogAction({ projectId: env.polo.id }, {});
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("FORBIDDEN");
  });
});
