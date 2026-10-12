import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Master batches and the cost guard: a batch is an umbrella over style projects
 * (each its own colours and sizes, target price, costs and deliveries) whose
 * state and totals come from its styles; a style's cost per piece is watched
 * against its target price and the people who run production get a message the
 * moment it comes near (85%) or goes over. Screens and actions are opened as each
 * role through the same Server Actions the buttons call.
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
import { addDays, localDay } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import type { ActionResult } from "@/lib/result";
import { createSession } from "@/modules/auth/session.service";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as styles from "@/modules/inventory/style.service";
import * as parties from "@/modules/parties/party.service";
import * as batchScreens from "@/modules/production/batch-screens.service";
import * as batches from "@/modules/production/batch.service";
import * as costs from "@/modules/production/cost.service";
import * as projects from "@/modules/production/project.service";
import * as screens from "@/modules/production/screens.service";
import { recordHref } from "@/modules/reminders/links";
import {
  createBatchAction,
  deleteBatchAction,
  getBatchFormAction,
  getBatchListAction,
  getBatchScreenAction,
  getProjectFormAction,
  updateBatchAction,
} from "@/server/actions/production.actions";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const ROLES = {
  owner: "SUPER_ADMIN",
  production: "PRODUCTION_MANAGER",
  store: "WAREHOUSE_TEAM",
  accounts: "ACCOUNTS",
  sales: "SALES_EXECUTIVE",
} as const;
type Who = keyof typeof ROLES;

function data<T>(result: ActionResult<T>, label: string): T {
  if (!result.ok) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

/** Extras with one person per role, a Classic Polo (Navy, White × S M L), a factory and a mill. */
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
  const knit = await supplier("Gazipur Knit Factory");
  const mill = await supplier("Narayanganj Fabrics");
  const heads = Object.fromEntries(
    (await costs.listCostHeads(owner)).map((h) => [h.name, h.id]),
  ) as Record<string, string>;
  const today = localDay(new Date(), company.timezone);
  return { company, people, owner, pm, style, sku, knit, mill, heads, today, sizes };
}

type Env = Awaited<ReturnType<typeof setup>>;

async function signInAs(env: Env, who: Who) {
  const { token } = await createSession(env.people[who].id, env.company.id);
  browser.cookies.set(SESSION_COOKIE, token);
}

/** A Due fabric cost on a project from the mill. */
const fabricCost = (env: Env, projectId: string, amount: number) =>
  costs.addProjectCost(env.owner, projectId, {
    expenseHeadId: env.heads.Fabric,
    amount,
    paymentType: "DUE",
    supplierId: env.mill.id,
    allowDuplicate: true,
  });

const inbox = (env: Env, who: Who) =>
  prisma.notificationLog.findMany({
    where: { companyId: env.company.id, userId: env.people[who].id },
    orderBy: { createdAt: "asc" },
  });

run("Master batches", () => {
  beforeEach(resetDb);

  it("groups styles under a batch: MB number, the batch's factory and day, and totals from its styles", async () => {
    const env = await setup();
    const due = addDays(env.today, 40);
    const batch = await batches.createBatch(env.pm, {
      name: "Winter polo, three brands",
      factoryId: env.knit.id,
      targetDate: due,
    });
    expect(batch.code).toMatch(/^MB-\d{4}-00001$/);
    expect(batch.kind).toBe("CM");
    expect(batch.state).toBe("EMPTY");

    // "Add a style": the form starts in the batch, at its factory and by its day.
    const form = await screens.getProjectForm(env.pm, undefined, { batchId: batch.id });
    expect(form.batch).toMatchObject({ id: batch.id, targetOn: due, factory: { id: env.knit.id } });
    expect(form.defaultTargetOn).toBe(due);

    // No factory given: the style is made at the batch's factory.
    const navy = await projects.createProject(env.pm, {
      name: "Brand A navy polo",
      batchId: batch.id,
      targetDate: due,
      targetUnitCost: 50,
      targets: [
        { variantId: env.sku("Navy", "S"), quantity: 20 },
        { variantId: env.sku("Navy", "M"), quantity: 40 },
        { variantId: env.sku("Navy", "L"), quantity: 40 },
      ],
    });
    expect(navy.batch).toMatchObject({ id: batch.id, code: batch.code });
    expect(navy.factory?.id).toBe(env.knit.id);
    expect(navy.targetUnitCost?.toFixed(2)).toBe("50.00");
    // A factory name given by hand wins over the batch's.
    const white = await projects.createProject(env.pm, {
      name: "Brand B white polo",
      batchId: batch.id,
      factoryName: "Tongi Stitch",
      targetDate: due,
      targetQuantity: 50,
      status: "PLANNED",
    });
    expect(white.factory).toBeNull();
    expect(white.factoryLabel).toBe("Tongi Stitch");

    await fabricCost(env, navy.id, 2000);
    const screen = await batchScreens.getBatchScreen(env.pm, batch.id);
    expect(screen.batch.state).toBe("ACTIVE");
    expect(screen.batch.styleCount).toBe(2);
    expect(screen.batch.quantities.target).toBe(150);
    expect(screen.styles.map((s) => s.code)).toEqual([navy.code, white.code]);
    expect(screen.batch.costs).toMatchObject({
      totalCost: "2000.00",
      perPiece: "13.33",
      // Only the navy style has a target price: 100 × 50 = 5,000.
      guard: { level: "OK", percent: 40, budget: "5000.00", spent: "2000.00", styles: 1 },
    });
    expect(screen.styles[0]!.costGuard).toMatchObject({
      level: "OK",
      perPiece: "20.00",
      target: "50.00",
      percent: 40,
    });
    expect(screen.can).toEqual({ edit: true, addStyle: true, delete: false });

    // The project's list filter and its card name the batch.
    const listed = await projects.listProjects(env.pm, { batchId: batch.id });
    expect(listed.items).toHaveLength(2);

    // Audit lines name the batch.
    const audit = await prisma.auditLog.findMany({
      where: { companyId: env.company.id, entityId: { in: [batch.id, navy.id] } },
    });
    expect(audit.map((a) => a.summary).join("\n")).toContain(`a style of ${batch.code}`);
    expect(audit.some((a) => a.entityType === "ProductionBatch" && a.action === "CREATE")).toBe(
      true,
    );
  });

  it("follows its styles' state and finds batches by state, a style or the factory", async () => {
    const env = await setup();
    const make = (name: string) => batches.createBatch(env.pm, { name, factoryId: env.knit.id });
    const empty = await make("Empty batch");
    const planned = await make("Planned batch");
    const active = await make("Active batch");
    const done = await make("Done batch");
    const style = (batchId: string, name: string, status: "PLANNED" | "ACTIVE" = "ACTIVE") =>
      projects.createProject(env.pm, {
        name,
        batchId,
        targetDate: addDays(env.today, 20),
        targetQuantity: 10,
        status,
      });
    await style(planned.id, "Planned style", "PLANNED");
    await style(active.id, "Running style");
    await style(active.id, "Waiting style", "PLANNED");
    const finished = await style(done.id, "Cancelled style");
    await projects.cancelProject(env.pm, finished.id, { reason: "Buyer dropped it" });

    const states = async (query: object) =>
      (await batches.listBatches(env.pm, query)).items.map((b) => b.name).sort();
    expect(await states({ state: "EMPTY" })).toEqual(["Empty batch"]);
    expect(await states({ state: "PLANNED" })).toEqual(["Planned batch"]);
    expect(await states({ state: "ACTIVE" })).toEqual(["Active batch"]);
    expect(await states({ state: "DONE" })).toEqual(["Done batch"]);
    expect(await states({ search: "waiting" })).toEqual(["Active batch"]);
    expect(await states({ search: "gazipur" })).toHaveLength(4);

    // Only batches not done take new styles; a done batch offers no "Add a style".
    const open = (await batches.findOpenBatches(env.pm)).map((b) => b.name).sort();
    expect(open).toEqual(["Active batch", "Empty batch", "Planned batch"]);
    expect((await batchScreens.getBatchScreen(env.pm, done.id)).can.addStyle).toBe(false);
    await expect(
      screens.getProjectForm(env.pm, undefined, { batchId: done.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Only an empty batch can be deleted.
    await expect(batches.deleteBatch(env.pm, active.id)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await batches.deleteBatch(env.pm, empty.id);
    expect(await prisma.productionBatch.count({ where: { id: empty.id } })).toBe(0);
  });

  it("moves a project into and out of a batch, and keeps batches apart between companies", async () => {
    const env = await setup();
    const batch = await batches.createBatch(env.pm, { name: "Spring batch" });
    const project = await projects.createProject(env.pm, {
      name: "Loose project",
      targetDate: addDays(env.today, 20),
      targetQuantity: 30,
    });
    expect(project.batch).toBeNull();
    const moved = await projects.updateProject(env.pm, project.id, { batchId: batch.id });
    expect(moved.batch?.id).toBe(batch.id);
    const out = await projects.updateProject(env.pm, project.id, { batchId: null });
    expect(out.batch).toBeNull();
    const audit = await prisma.auditLog.findMany({
      where: { entityId: project.id, action: "UPDATE" },
      orderBy: { createdAt: "asc" },
    });
    expect(audit.map((a) => a.summary)).toEqual([
      expect.stringContaining(`now a style of ${batch.code}`),
      expect.stringContaining("taken out of its batch"),
    ]);

    // Another company's batch is not found.
    const { company: other, roles } = await makeCompany("Other");
    const stranger = await makeUser("owner@other.test");
    await addToCompany(stranger.id, other.id, roles.SUPER_ADMIN);
    const otherCtx = await contextFor(stranger.id, other.id);
    await expect(batches.getBatch(otherCtx, batch.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      projects.createProject(otherCtx, {
        name: "Sneaky",
        batchId: batch.id,
        targetDate: addDays(env.today, 20),
        targetQuantity: 5,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

run("The cost guard", () => {
  beforeEach(resetDb);

  it("messages the people who run production when a style comes near its target price and when it goes over", async () => {
    const env = await setup();
    const project = await projects.createProject(env.pm, {
      name: "Navy polo",
      factoryId: env.knit.id,
      targetDate: addDays(env.today, 30),
      targetQuantity: 100,
      targetUnitCost: 100,
    });
    // 100 pieces at most 100 each: 10,000 in all.
    await fabricCost(env, project.id, 5000); // 50%
    expect(await inbox(env, "production")).toHaveLength(0);

    await fabricCost(env, project.id, 3600); // 86%: near
    let pm = await inbox(env, "production");
    expect(pm).toHaveLength(1);
    expect(pm[0]).toMatchObject({
      subject: `Near the target price: ${project.code}`,
      entityType: "ProductionProject",
      entityId: project.id,
    });
    expect(pm[0]!.body).toContain("86.00 a piece against a target price of BDT 100.00 (86%)");

    await fabricCost(env, project.id, 400); // 90%: still near, no new message
    expect(await inbox(env, "production")).toHaveLength(1);

    await fabricCost(env, project.id, 1500); // 105%: over
    pm = await inbox(env, "production");
    expect(pm).toHaveLength(2);
    expect(pm[1]!.subject).toBe(`Over the target price: ${project.code}`);

    // Production Managers and the Super Admin get it; the store, Accounts and Sales do not.
    expect(await inbox(env, "owner")).toHaveLength(2);
    expect(await inbox(env, "store")).toHaveLength(0);
    expect(await inbox(env, "accounts")).toHaveLength(0);
    expect(await inbox(env, "sales")).toHaveLength(0);

    // The message opens the project for people who see production.
    expect(recordHref(env.pm, { type: "ProductionProject", id: project.id })).toBe(
      `/production/projects/${project.id}`,
    );
    const card = await projects.getProject(env.pm, project.id);
    expect(card.costGuard?.level).toBe("OVER");
    expect(card.costGuard?.leftPerPiece.toFixed(2)).toBe("0.00");
  });

  it("also warns when the target price is lowered below what a piece already costs", async () => {
    const env = await setup();
    const project = await projects.createProject(env.pm, {
      name: "White polo",
      targetDate: addDays(env.today, 30),
      targetQuantity: 50,
    });
    await fabricCost(env, project.id, 4000); // 80 a piece, no target yet
    expect(await inbox(env, "production")).toHaveLength(0);
    await projects.updateProject(env.pm, project.id, { targetUnitCost: 120 }); // 66%
    expect(await inbox(env, "production")).toHaveLength(0);
    await projects.updateProject(env.pm, project.id, { targetUnitCost: 75 }); // 106%
    const pm = await inbox(env, "production");
    expect(pm.map((m) => m.subject)).toEqual([`Over the target price: ${project.code}`]);
    // Clearing the target price turns the guard off.
    const cleared = await projects.updateProject(env.pm, project.id, { targetUnitCost: null });
    expect(cleared.costGuard).toBeNull();
    expect(cleared.targetUnitCost).toBeNull();
  });

  it("shows the target price and the guard only to people who see production costs", async () => {
    const env = await setup();
    const batch = await batches.createBatch(env.pm, { name: "Guarded batch" });
    const project = await projects.createProject(env.pm, {
      name: "Navy polo",
      batchId: batch.id,
      targetDate: addDays(env.today, 30),
      targetQuantity: 10,
      targetUnitCost: 100,
    });
    await fabricCost(env, project.id, 500);
    const store = await contextFor(env.people.store.id, env.company.id);
    const accounts = await contextFor(env.people.accounts.id, env.company.id);
    const storeCard = await projects.getProject(store, project.id);
    expect(storeCard.costGuard).toBeNull();
    expect(storeCard.targetUnitCost).toBeNull();
    expect((await batchScreens.getBatchScreen(store, batch.id)).batch.costs).toBeNull();
    const accountsCard = await projects.getProject(accounts, project.id);
    expect(accountsCard.costGuard?.percent).toBe(50);
    expect((await batchScreens.getBatchScreen(accounts, batch.id)).batch.costs?.guard?.level).toBe(
      "OK",
    );
  });
});

run("Batch actions by role", () => {
  beforeEach(resetDb);

  it("lets Production Managers start, change and delete batches, and shows them to whoever sees production", async () => {
    const env = await setup();
    const batch = await batches.createBatch(env.pm, { name: "Role batch" });
    const may = {
      owner: { view: true, manage: true },
      production: { view: true, manage: true },
      store: { view: true, manage: false },
      accounts: { view: true, manage: false },
      sales: { view: false, manage: false },
    } satisfies Record<Who, { view: boolean; manage: boolean }>;
    for (const who of Object.keys(ROLES) as Who[]) {
      await signInAs(env, who);
      expect((await getBatchListAction({})).ok, `${who}: list`).toBe(may[who].view);
      expect((await getBatchScreenAction(batch.id)).ok, `${who}: batch`).toBe(may[who].view);
      expect((await getBatchFormAction(batch.id)).ok, `${who}: form`).toBe(may[who].manage);
      const created = await createBatchAction({ name: `By ${who}` });
      expect(created.ok, `${who}: create`).toBe(may[who].manage);
      if (!created.ok) expect(created.error.code).toBe("FORBIDDEN");
      expect((await updateBatchAction(batch.id, { notes: who })).ok, `${who}: edit`).toBe(
        may[who].manage,
      );
      if (created.ok) {
        expect((await deleteBatchAction(created.data.id)).ok, `${who}: delete`).toBe(true);
      }
    }
    await signInAs(env, "production");
    const form = data(await getProjectFormAction(undefined, { batchId: batch.id }), "form");
    expect(form.batch?.id).toBe(batch.id);
    expect(form.batches.map((b) => b.id)).toContain(batch.id);
  });
});
