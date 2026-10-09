import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The Production screens decide what to show and offer from flags the server
 * sends with the data (canCreate, can.stages, can.complete, can.receive,
 * can.pay, costs). These tests open the screens' data as each built-in role and
 * then try every change through the same Server Actions the buttons call: each
 * must work exactly when the screen offers it, and cost figures must reach only
 * Production Managers and Accounts. Next.js' request helpers are replaced as in
 * screens.test.ts.
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
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`Redirected to ${url}`), {
      digest: `NEXT_REDIRECT;replace;${url};307;`,
      redirectedTo: url,
    });
  },
  notFound: () => {
    throw Object.assign(new Error("Not found"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  },
  useRouter: () => ({}),
  usePathname: () => "/production",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

import BillPage from "@/app/(app)/production/bills/[billId]/page";
import NewBillPage from "@/app/(app)/production/bills/new/page";
import BillsPage from "@/app/(app)/production/bills/page";
import CostHeadsPage from "@/app/(app)/production/cost-heads/page";
import DeliveryPage from "@/app/(app)/production/deliveries/[intakeId]/page";
import NewDeliveryPage from "@/app/(app)/production/deliveries/new/page";
import DeliveriesPage from "@/app/(app)/production/deliveries/page";
import ProductionOverviewPage from "@/app/(app)/production/page";
import EditProjectPage from "@/app/(app)/production/projects/[projectId]/edit/page";
import ProjectPage from "@/app/(app)/production/projects/[projectId]/page";
import NewProjectPage from "@/app/(app)/production/projects/new/page";
import ProjectsPage from "@/app/(app)/production/projects/page";
import { ProductionNoAccess } from "@/components/production/no-access";
import { visibleProductionTabs } from "@/components/production/tabs";
import { visibleNavItems } from "@/components/shell/nav-items";
import { SESSION_COOKIE } from "@/lib/auth/session-cookie";
import { addDays, localDay } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import type { ActionResult } from "@/lib/result";
import type { CompanyContext } from "@/modules/auth/context";
import { createSession } from "@/modules/auth/session.service";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as styles from "@/modules/inventory/style.service";
import * as parties from "@/modules/parties/party.service";
import * as costs from "@/modules/production/cost.service";
import * as intakes from "@/modules/production/intake.service";
import * as projects from "@/modules/production/project.service";
import {
  addProjectCostAction,
  cancelIntakeAction,
  cancelProjectAction,
  completeProjectAction,
  confirmIntakeAction,
  createBillAction,
  createCostHeadAction,
  createIntakeAction,
  createProjectAction,
  findProductionPartiesAction,
  findProductionStylesAction,
  findProjectsAction,
  getBillFormAction,
  getBillListAction,
  getBillScreenAction,
  getCostHeadsScreenAction,
  getIntakeFormAction,
  getIntakeListAction,
  getIntakeMatrixAction,
  getIntakeScreenAction,
  getOverviewScreenAction,
  getProjectFormAction,
  getProjectListAction,
  getProjectScreenAction,
  listBillRowsAction,
  listIntakeRowsAction,
  listProjectRowsAction,
  payBillAction,
  reverseIntakeAction,
  setProjectStageAction,
  setProjectStatusAction,
  updateIntakeAction,
  updateProjectAction,
  voidBillAction,
  voidProjectCostAction,
} from "@/server/actions/production.actions";
import { requireCompanyPage } from "@/server/pages/guards";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const ROLES = {
  owner: "SUPER_ADMIN",
  production: "PRODUCTION_MANAGER",
  sales: "SALES_EXECUTIVE",
  store: "WAREHOUSE_TEAM",
  accounts: "ACCOUNTS",
  employee: "EMPLOYEE",
} as const;
type Who = keyof typeof ROLES;

async function signInAs(userId: string, companyId: string) {
  const { token } = await createSession(userId, companyId);
  browser.cookies.set(SESSION_COOKIE, token);
}

/** A refusal must come from the access rules, not from some other failure. */
function expectRuleRefusal(result: ActionResult<unknown>, label: string) {
  if (result.ok) return;
  expect(["FORBIDDEN", "CONFLICT", "VALIDATION"], `${label}: ${result.error.message}`).toContain(
    result.error.code,
  );
}

/** The change works exactly when the screen offered it. */
function expectOffered(result: ActionResult<unknown>, offered: boolean, label: string) {
  expect(result.ok, `${label}${result.ok ? "" : `: ${result.error.message}`}`).toBe(offered);
  expectRuleRefusal(result, label);
}

function data<T>(result: ActionResult<T>, label: string): T {
  if (!result.ok) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

/** What a page rendered: the "not part of your role" notice, a redirect, or the page. */
async function rendered(page: Promise<React.ReactElement>): Promise<string> {
  try {
    const element = await page;
    return element.type === ProductionNoAccess ? "no access" : "page";
  } catch (error) {
    const to = (error as { redirectedTo?: string }).redirectedTo;
    if (to) return `redirect ${to}`;
    throw error;
  }
}

/**
 * Extras with one person in each built-in role, a Classic Polo (Navy x S M L),
 * the factory and a fabric mill as suppliers, and the buyer Rahim Traders.
 */
async function factory() {
  const { company, roles } = await makeCompany("Extras");
  const people = {} as Record<Who, { id: string }>;
  for (const [who, role] of Object.entries(ROLES) as Array<[Who, keyof typeof roles]>) {
    const user = await makeUser(`${who}@extras.test`);
    await addToCompany(user.id, company.id, roles[role]);
    people[who] = user;
  }
  const owner = await contextFor(people.owner.id, company.id);
  const sizes = [];
  for (const name of ["S", "M", "L"]) sizes.push(await catalog.createSize(owner, { name }));
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
    sizeIds: sizes.map((s) => s.id),
  });
  const variants = await prisma.productVariant.findMany({
    where: { styleId: style.id },
    include: { size: true },
  });
  const sku = (size: string) => variants.find((v) => v.size.name === size)!.id;
  const supplier = async (name: string) =>
    (await parties.createParty(owner, { kind: "SUPPLIER", name })).party;
  const knit = await supplier("Gazipur Knit Factory");
  const mill = await supplier("Narayanganj Fabrics");
  const buyer = (
    await parties.createParty(owner, { kind: "BUYER", name: "Rahim Traders", phone: "01711223344" })
  ).party;
  const heads = Object.fromEntries(
    (await costs.listCostHeads(owner)).map((h) => [h.name, h.id]),
  ) as Record<string, string>;
  const today = localDay(new Date(), company.timezone);
  return { company, people, owner, style, sku, knit, mill, buyer, heads, today };
}

type Factory = Awaited<ReturnType<typeof factory>>;

async function as(env: Factory, who: Who): Promise<CompanyContext> {
  await signInAs(env.people[who].id, env.company.id);
  return requireCompanyPage();
}

const params = <T>(value: T) => Promise.resolve(value);
const noQuery = () => Promise.resolve({});

/** An active polo project of 100 pieces, made by the owner. */
const projectFor = (env: Factory, extra: Record<string, unknown> = {}) =>
  projects.createProject(env.owner, {
    name: "Classic Polo run",
    styleId: env.style.id,
    factoryId: env.knit.id,
    buyerId: env.buyer.id,
    targetDate: addDays(env.today, 30),
    targetQuantity: 100,
    ...extra,
  });

/** A fabric bill from the mill on credit (Due). */
const fabricBill = (env: Factory, projectId: string, amount: number) =>
  costs.createBill(env.owner, {
    supplierId: env.mill.id,
    paymentType: "DUE",
    allocations: [{ projectId, expenseHeadId: env.heads.Fabric, amount }],
  });

/** A draft delivery of 30 A-grade and 10 B-grade Navy polos. */
const draftDelivery = (env: Factory, projectId: string) =>
  intakes.createIntake(env.owner, {
    projectId,
    lines: [
      { variantId: env.sku("S"), quantity: 10 },
      { variantId: env.sku("M"), quantity: 20 },
      { variantId: env.sku("L"), grade: "B_GRADE", quantity: 10 },
    ],
  });

run("Production screens", () => {
  beforeEach(resetDb);

  it("shows each page to the people its actions let in, and nothing to the others", async () => {
    const env = await factory();
    const project = await projectFor(env);
    const bill = await fabricBill(env, project.id, 5000);
    const delivery = await draftDelivery(env, project.id);
    const seen: Record<string, unknown> = {};

    for (const who of Object.keys(ROLES) as Who[]) {
      const ctx = await as(env, who);
      const view = ctx.can("production.view");
      const manage = ctx.can("production.manage");
      const receive = ctx.can("production.stock_intake");
      const payOut = ctx.can("accounts.payments.record");
      const costsShown = manage || ctx.can("accounts.view");
      seen[who] = { view, manage, receive, payOut, costs: costsShown };

      const inMenu = visibleNavItems([...ctx.permissions]).some((i) => i.href === "/production");
      expect(inMenu, who).toBe(view || receive);
      const tabs = visibleProductionTabs(ctx.permissions).map((t) => t.href);
      expect(tabs.includes("/production"), `${who}: overview tab`).toBe(view);
      expect(tabs.includes("/production/deliveries"), `${who}: deliveries tab`).toBe(
        view || receive,
      );
      expect(tabs.includes("/production/bills"), `${who}: bills tab`).toBe(view && costsShown);
      expect(tabs.includes("/production/cost-heads"), `${who}: cost heads tab`).toBe(manage);

      // Each screen's data comes exactly to the people its page is shown to.
      const overview = await getOverviewScreenAction();
      expect(overview.ok, `${who}: overview`).toBe(view);
      const list = await getProjectListAction({});
      expect(list.ok, `${who}: projects`).toBe(view);
      expect((await listProjectRowsAction({})).ok, `${who}: more projects`).toBe(view);
      expect((await getProjectScreenAction(project.id)).ok, `${who}: project`).toBe(view);
      expect((await getProjectFormAction()).ok, `${who}: project form`).toBe(manage);
      const deliveries = await getIntakeListAction({});
      expect(deliveries.ok, `${who}: deliveries`).toBe(view || receive);
      expect((await listIntakeRowsAction({})).ok, `${who}: more deliveries`).toBe(view || receive);
      expect((await getIntakeScreenAction(delivery.id)).ok, `${who}: delivery`).toBe(
        view || receive,
      );
      expect(
        (await getIntakeFormAction({ projectId: project.id })).ok,
        `${who}: delivery form`,
      ).toBe(receive);
      const bills = await getBillListAction({});
      expect(bills.ok, `${who}: bills`).toBe(view && costsShown);
      expect((await listBillRowsAction({})).ok, `${who}: more bills`).toBe(view && costsShown);
      expect((await getBillScreenAction(bill.id)).ok, `${who}: bill`).toBe(view && costsShown);
      expect((await getBillFormAction({})).ok, `${who}: bill form`).toBe(manage || payOut);
      const heads = await getCostHeadsScreenAction();
      expect(heads.ok, `${who}: cost heads`).toBe(view);
      expect(
        (await findProjectsAction({ search: "", purpose: "COST" })).ok,
        `${who}: projects to charge`,
      ).toBe(manage || payOut || receive);
      expect(
        (await findProductionPartiesAction({ kind: "SUPPLIER", search: "" })).ok,
        `${who}: suppliers`,
      ).toBe(manage || payOut);
      expect((await findProductionStylesAction({ search: "" })).ok, `${who}: styles`).toBe(
        manage || receive,
      );
      expect((await getIntakeMatrixAction(env.style.id)).ok, `${who}: matrix`).toBe(
        manage || receive,
      );
      if (overview.ok) expect(overview.data.canCreate, who).toBe(manage);
      if (list.ok) expect(list.data.canCreate, who).toBe(manage);
      if (deliveries.ok) expect(deliveries.data.canCreate, who).toBe(receive);
      if (bills.ok) expect(bills.data.canCreate, who).toBe(manage || payOut);
      if (heads.ok) expect(heads.data.canManage, who).toBe(manage);

      // The pages show "not part of your role" in the same cases.
      const page = (allowed: boolean) => (allowed ? "page" : "no access");
      expect(await rendered(ProductionOverviewPage()), `${who}: /production`).toBe(
        view ? "page" : receive ? "redirect /production/deliveries" : "no access",
      );
      const listed = { searchParams: noQuery() };
      expect(await rendered(ProjectsPage(listed)), `${who}: projects`).toBe(page(view));
      expect(await rendered(DeliveriesPage(listed)), `${who}: deliveries`).toBe(
        page(view || receive),
      );
      expect(await rendered(BillsPage(listed)), `${who}: bills`).toBe(page(view && costsShown));
      expect(await rendered(CostHeadsPage()), `${who}: cost heads`).toBe(page(view));
      const one = { searchParams: noQuery() };
      expect(
        await rendered(ProjectPage({ params: params({ projectId: project.id }), ...one })),
        `${who}: project`,
      ).toBe(page(view));
      expect(
        await rendered(DeliveryPage({ params: params({ intakeId: delivery.id }), ...one })),
        `${who}: delivery`,
      ).toBe(page(view || receive));
      expect(
        await rendered(BillPage({ params: params({ billId: bill.id }), ...one })),
        `${who}: bill`,
      ).toBe(page(view && costsShown));
      expect(await rendered(NewProjectPage()), `${who}: new project`).toBe(page(manage));
      expect(
        await rendered(EditProjectPage({ params: params({ projectId: project.id }) })),
        `${who}: edit project`,
      ).toBe(page(manage));
      expect(
        await rendered(NewDeliveryPage({ searchParams: params({ project: project.id }) })),
        `${who}: receive goods`,
      ).toBe(page(receive));
      expect(await rendered(NewBillPage(one)), `${who}: new bill`).toBe(page(manage || payOut));
    }

    expect(seen).toEqual({
      owner: { view: true, manage: true, receive: true, payOut: true, costs: true },
      production: { view: true, manage: true, receive: true, payOut: false, costs: true },
      sales: { view: false, manage: false, receive: false, payOut: false, costs: false },
      store: { view: true, manage: false, receive: true, payOut: false, costs: false },
      accounts: { view: true, manage: false, receive: false, payOut: true, costs: true },
      employee: { view: false, manage: false, receive: false, payOut: false, costs: false },
    });
  }, 120_000);

  it("keeps every cost figure to Production Managers and Accounts", async () => {
    const env = await factory();
    const project = await projectFor(env);
    await fabricBill(env, project.id, 4321);
    const delivery = await draftDelivery(env, project.id);
    const confirmed = await draftDelivery(env, project.id);
    await intakes.cancelIntake(env.owner, delivery.id);
    await intakes.confirmIntake(env.owner, confirmed.id, {});
    const open = await draftDelivery(env, project.id);

    for (const who of ["owner", "production", "accounts", "store"] as const) {
      await as(env, who);
      const costsShown = who !== "store";
      const overview = data(await getOverviewScreenAction(), who);
      const screen = data(await getProjectScreenAction(project.id), who);
      const list = data(await getProjectListAction({}), who);
      const intake = data(await getIntakeScreenAction(confirmed.id), who);
      const draft = data(await getIntakeScreenAction(open.id), who);
      const rows = data(await getIntakeListAction({}), who);
      if (costsShown) {
        expect(screen.costs?.totalCost, who).toBe("4321.00");
        // 40 of 100 pieces carried their share (30 A, 10 B at the same cost a piece).
        expect(screen.costs?.grades.a.pieces, who).toBe(30);
        expect(screen.costs?.grades.b.pieces, who).toBe(10);
        expect(screen.costs?.inStock, who).toBe("1728.40");
        expect(overview.totals?.totalCost, who).toBe("4321.00");
        expect(list.items[0]!.costs?.totalCost, who).toBe("4321.00");
        expect(intake.costs?.totalCost, who).toBe("1728.40");
        expect(draft.costs?.preview?.error, who).toBeNull();
      } else {
        expect(screen.costs, who).toBeNull();
        expect(overview.totals, who).toBeNull();
        expect(
          list.items.every((p) => p.costs === null),
          who,
        ).toBe(true);
        expect(
          screen.project.deliveries.every((d) => d.totalCost === null),
          who,
        ).toBe(true);
        expect(
          rows.items.every((d) => d.totalCost === null),
          who,
        ).toBe(true);
        expect(intake.costs, who).toBeNull();
        expect(draft.costs, who).toBeNull();
        expect(screen.can.writeOff?.amount ?? null, who).toBeNull();
        // No amount reaches the store team anywhere on these screens.
        const everything = JSON.stringify([overview, screen, list, intake, draft, rows]);
        expect(everything, who).not.toMatch(/4321|1728\.4|2592\.6/);
      }
    }
  }, 60_000);

  it("offers project changes exactly to the people the actions let make them", async () => {
    const env = await factory();
    for (const who of ["owner", "production", "accounts", "store"] as const) {
      await as(env, who);
      const list = data(await getProjectListAction({}), who);
      const created = await createProjectAction({
        name: `Polo run for ${who}`,
        styleId: env.style.id,
        targetDate: addDays(env.today, 30),
        targetQuantity: 100,
        status: "PLANNED",
      });
      expectOffered(created, list.canCreate, `${who}: create a project`);
      const project = created.ok
        ? created.data
        : await projectFor(env, { name: `Polo run for ${who}`, status: "PLANNED" });

      // A planned project: started, then moved on, held and resumed.
      const planned = data(await getProjectScreenAction(project.id), who);
      expect(planned.can.stages, who).toEqual([]);
      expectOffered(
        await updateProjectAction(project.id, { notes: "Navy only" }),
        planned.can.edit,
        `${who}: edit`,
      );
      expectOffered(
        await setProjectStatusAction(project.id, { status: "ACTIVE" }),
        planned.can.start,
        `${who}: start`,
      );
      if (!planned.can.start)
        await projects.setProjectStatus(env.owner, project.id, { status: "ACTIVE" });

      const active = data(await getProjectScreenAction(project.id), who);
      const next = active.can.stages[0];
      expect(active.can.stages.length > 0, who).toBe(active.can.edit);
      expectOffered(
        await setProjectStageAction(project.id, { stage: "CUTTING" }),
        Boolean(next && next.stage === "CUTTING"),
        `${who}: move to cutting`,
      );
      expectOffered(
        await setProjectStatusAction(project.id, { status: "ON_HOLD", note: "Fabric late" }),
        active.can.hold,
        `${who}: hold`,
      );
      if (!active.can.hold) {
        await projects.setProjectStatus(env.owner, project.id, { status: "ON_HOLD" });
      }
      const held = data(await getProjectScreenAction(project.id), who);
      expectOffered(
        await setProjectStatusAction(project.id, { status: "ACTIVE" }),
        held.can.resume,
        `${who}: resume`,
      );
      if (!held.can.resume) {
        await projects.setProjectStatus(env.owner, project.id, { status: "ACTIVE" });
      }

      // Costs: owed to a supplier (Production and Accounts), or paid now (Accounts).
      const working = data(await getProjectScreenAction(project.id), who);
      expectOffered(
        await addProjectCostAction(project.id, {
          expenseHeadId: env.heads.Fabric,
          amount: 3000,
          paymentType: "DUE",
          supplierId: env.mill.id,
        }),
        working.can.addDueCost,
        `${who}: add a cost owed`,
      );
      const paid = await addProjectCostAction(project.id, {
        expenseHeadId: env.heads.Fabric,
        amount: 500,
        paymentType: "CASH_BANK",
        method: "CASH",
      });
      expectOffered(paid, working.can.addPaidCost, `${who}: add a cost paid now`);
      expect((await getBillFormAction({ projectId: project.id })).ok, who).toBe(
        working.can.newBill,
      );
      if (!paid.ok) {
        await costs.addProjectCost(env.owner, project.id, {
          expenseHeadId: env.heads.Fabric,
          amount: 500,
          paymentType: "CASH_BANK",
          method: "CASH",
        });
      }

      // The cost paid now is voided by Accounts while it is still in production.
      const sheet = data(await getProjectScreenAction(project.id), who);
      const direct = sheet.costs?.entries.find((e) => e.kind === "DIRECT");
      if (sheet.costs) {
        expect(direct, who).toBeDefined();
        expectOffered(
          await voidProjectCostAction(direct!.id, { reason: "Entered twice" }),
          direct!.canVoid,
          `${who}: void a cost`,
        );
      }

      // Receiving goods: the store team and Production.
      const receiving = data(await getProjectScreenAction(project.id), who);
      const intake = await createIntakeAction({
        projectId: project.id,
        lines: [{ variantId: env.sku("M"), quantity: 40 }],
      });
      expectOffered(intake, receiving.can.receive, `${who}: receive goods`);
      if (intake.ok) await intakes.cancelIntake(env.owner, intake.data.id);

      // Completing with cost left in production writes it off: Accounts' (and the owner's) call.
      const closing = data(await getProjectScreenAction(project.id), who);
      expect(closing.can.writeOff, who).not.toBeNull();
      expect(closing.can.complete, who).toBe(who === "owner" || who === "accounts");
      expect(closing.notes.complete !== null, `${who}: why not complete`).toBe(
        who === "production",
      );
      expectOffered(
        await completeProjectAction(project.id, { writeOffReason: "Factory closed early" }),
        closing.can.complete,
        `${who}: complete`,
      );

      const other = await projectFor(env, { name: `Second run for ${who}` });
      await fabricBill(env, other.id, 1000);
      const cancelling = data(await getProjectScreenAction(other.id), who);
      expect(cancelling.can.cancel, who).toBe(who === "owner" || who === "accounts");
      expectOffered(
        await cancelProjectAction(other.id, { reason: "Buyer withdrew the order" }),
        cancelling.can.cancel,
        `${who}: cancel`,
      );

      // With nothing left in production, Production completes it too.
      const clean = await projectFor(env, { name: `Clean run for ${who}` });
      const cleanScreen = data(await getProjectScreenAction(clean.id), who);
      expect(cleanScreen.can.writeOff, who).toBeNull();
      expect(cleanScreen.can.complete, who).toBe(who !== "store");
      expectOffered(
        await completeProjectAction(clean.id, {}),
        cleanScreen.can.complete,
        `${who}: complete with nothing to write off`,
      );
      if (!cleanScreen.can.complete) await projects.completeProject(env.owner, clean.id, {});
      const done = data(await getProjectScreenAction(clean.id), who);
      expect(done.can, who).toMatchObject({
        stages: [],
        start: false,
        hold: false,
        complete: false,
        cancel: false,
        addDueCost: false,
        receive: false,
      });
    }
  }, 120_000);

  it("offers delivery changes exactly to the people the actions let make them", async () => {
    const env = await factory();
    for (const who of ["owner", "production", "accounts", "store"] as const) {
      await as(env, who);
      const project = await projectFor(env, { name: `Run for ${who}` });
      await fabricBill(env, project.id, 10000);

      const draft = await draftDelivery(env, project.id);
      const screen = data(await getIntakeScreenAction(draft.id), who);
      expectOffered(
        await updateIntakeAction(draft.id, {
          lines: [
            { variantId: env.sku("S"), quantity: 12 },
            { variantId: env.sku("L"), grade: "B_GRADE", quantity: 8 },
          ],
        }),
        screen.can.edit,
        `${who}: correct a draft`,
      );
      expect((await getIntakeFormAction({ intakeId: draft.id })).ok, who).toBe(screen.can.edit);
      expect(screen.can.completeProject, who).toBe(who === "owner" || who === "production");
      expect(screen.can.setTotal, who).toBe(who !== "store");
      const confirmed = await confirmIntakeAction(draft.id, {});
      expectOffered(confirmed, screen.can.confirm, `${who}: confirm into stock`);
      if (!confirmed.ok) await intakes.confirmIntake(env.owner, draft.id, {});

      const other = await draftDelivery(env, project.id);
      const otherScreen = data(await getIntakeScreenAction(other.id), who);
      expectOffered(await cancelIntakeAction(other.id), otherScreen.can.cancel, `${who}: cancel`);

      // Undoing a confirmed delivery is Production's.
      const inStock = data(await getIntakeScreenAction(draft.id), who);
      expect(inStock.can.edit || inStock.can.confirm || inStock.can.cancel, who).toBe(false);
      expect(inStock.can.undo, who).toBe(who === "owner" || who === "production");
      const undone = await reverseIntakeAction(draft.id, {
        reason: "Counted the wrong sizes",
        redraft: true,
      });
      expectOffered(undone, inStock.can.undo, `${who}: undo`);
      if (undone.ok) {
        expect(undone.data.redraft, who).not.toBeNull();
        const copy = data(await getIntakeScreenAction(undone.data.redraft!.id), who);
        expect(copy.intake.correctionOf?.id, who).toBe(draft.id);
      }
    }

    // The last delivery completes the project for Production Managers.
    const env2 = env;
    await as(env2, "production");
    const project = await projectFor(env2, { name: "Final run" });
    await fabricBill(env2, project.id, 6000);
    const last = await draftDelivery(env2, project.id);
    const screen = data(await getIntakeScreenAction(last.id), "production");
    expect(screen.can.completeProject).toBe(true);
    data(await confirmIntakeAction(last.id, { completeProject: true }), "production");
    const after = data(await getProjectScreenAction(project.id), "production");
    expect(after.project.status).toBe("COMPLETED");
    expect(after.costs?.wip).toBe("0.00");
    expect(after.costs?.grades.a.perPiece).toBe("150.00");
    expect(after.costs?.grades.b.perPiece).toBe("150.00");
  }, 120_000);

  it("offers supplier bills, payments and cost heads to the people the actions let use them", async () => {
    const env = await factory();
    const project = await projectFor(env);
    for (const who of ["owner", "production", "accounts", "store"] as const) {
      await as(env, who);
      const canEnter = who !== "store";
      const created = await createBillAction({
        supplierId: env.knit.id,
        paymentType: "DUE",
        allocations: [{ projectId: project.id, expenseHeadId: env.heads.Fabric, amount: 1200 }],
      });
      expectOffered(created, canEnter, `${who}: enter a bill`);
      const paidNow = await createBillAction({
        supplierId: env.knit.id,
        paymentType: "CASH_BANK",
        method: "BKASH",
        allocations: [{ projectId: project.id, expenseHeadId: env.heads.Fabric, amount: 300 }],
      });
      const form = (await getBillFormAction({})).ok ? data(await getBillFormAction({}), who) : null;
      expectOffered(paidNow, Boolean(form?.canPayNow), `${who}: enter a bill paid now`);

      const bill = created.ok ? created.data : await fabricBill(env, project.id, 1200);
      const screen = await getBillScreenAction(bill.id);
      if (!screen.ok) {
        expect(who).toBe("store");
        expectOffered(await payBillAction(bill.id, { amount: 200, method: "CASH" }), false, who);
        expectOffered(await voidBillAction(bill.id, { reason: "Wrong supplier" }), false, who);
        continue;
      }
      expect(screen.data.can.pay, who).toBe(who === "owner" || who === "accounts");
      expect(screen.data.can.void, who).toBe(true);
      expectOffered(
        await payBillAction(bill.id, { amount: 200, method: "CASH" }),
        screen.data.can.pay,
        `${who}: pay part of the bill`,
      );
      expectOffered(
        await voidBillAction(bill.id, { reason: "Entered against the wrong supplier" }),
        screen.data.can.void,
        `${who}: void the bill`,
      );
      const heads = data(await getCostHeadsScreenAction(), who);
      expectOffered(
        await createCostHeadAction({ name: `Embroidery ${who}` }),
        heads.canManage,
        `${who}: add a cost head`,
      );
    }
  }, 120_000);
});
