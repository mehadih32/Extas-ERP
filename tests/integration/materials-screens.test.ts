import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The Raw materials screens decide what to show and offer from flags the
 * server sends with the data (seeCosts, canCreate, can.count, can.pay...).
 * These tests open the screens' data as each built-in role and then try every
 * change through the same Server Actions the buttons call: each must work
 * exactly when the screen offers it, and prices and values must reach only
 * buyers, Production Managers and Accounts. Next.js' request helpers are
 * replaced as in screens.test.ts.
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
  usePathname: () => "/materials",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

import IssuePage from "@/app/(app)/materials/issues/[issueId]/page";
import NewIssuePage from "@/app/(app)/materials/issues/new/page";
import IssuesPage from "@/app/(app)/materials/issues/page";
import EditOrderPage from "@/app/(app)/materials/orders/[orderId]/edit/page";
import OrderPage from "@/app/(app)/materials/orders/[orderId]/page";
import NewOrderPage from "@/app/(app)/materials/orders/new/page";
import OrdersPage from "@/app/(app)/materials/orders/page";
import MaterialsOverviewPage from "@/app/(app)/materials/page";
import PurchasePage from "@/app/(app)/materials/purchases/[billId]/page";
import NewPurchasePage from "@/app/(app)/materials/purchases/new/page";
import PurchasesPage from "@/app/(app)/materials/purchases/page";
import ReturnPage from "@/app/(app)/materials/returns/[returnId]/page";
import NewReturnPage from "@/app/(app)/materials/returns/new/page";
import ReturnsPage from "@/app/(app)/materials/returns/page";
import EditMaterialPage from "@/app/(app)/materials/stock/[materialId]/edit/page";
import MaterialPage from "@/app/(app)/materials/stock/[materialId]/page";
import NewMaterialPage from "@/app/(app)/materials/stock/new/page";
import StockPage from "@/app/(app)/materials/stock/page";
import { SectionError } from "@/components/dashboard/section-error";
import { MaterialsNoAccess, PricesNoAccess } from "@/components/materials/no-access";
import { visibleMaterialsTabs } from "@/components/materials/tabs";
import { visibleNavItems } from "@/components/shell/nav-items";
import { SESSION_COOKIE } from "@/lib/auth/session-cookie";
import { addDays, localDay } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import type { ActionResult } from "@/lib/result";
import { getJournalEntryScreenAction } from "@/server/actions/accounts.actions";
import type { CompanyContext } from "@/modules/auth/context";
import { createSession } from "@/modules/auth/session.service";
import * as stock from "@/modules/inventory/stock.service";
import * as issues from "@/modules/materials/issue.service";
import * as materials from "@/modules/materials/material.service";
import * as orders from "@/modules/materials/purchase-order.service";
import * as purchases from "@/modules/materials/purchase.service";
import * as returns from "@/modules/materials/supplier-return.service";
import * as parties from "@/modules/parties/party.service";
import * as projects from "@/modules/production/project.service";
import {
  addOpeningStockAction,
  cancelPurchaseOrderAction,
  closePurchaseOrderAction,
  countMaterialAction,
  createMaterialAction,
  createPurchaseAction,
  createPurchaseOrderAction,
  createSupplierReturnAction,
  findMaterialProjectsAction,
  findMaterialsAction,
  findMaterialSuppliersAction,
  getIssueFormAction,
  getIssueListAction,
  getIssueScreenAction,
  getMaterialFormAction,
  getMaterialListAction,
  getMaterialScreenAction,
  getMaterialsOverviewScreenAction,
  getOrderFormAction,
  getOrderListAction,
  getOrderScreenAction,
  getProjectHoldingsAction,
  getProjectMaterialsPanelAction,
  getPurchaseFormAction,
  getPurchaseListAction,
  getPurchaseScreenAction,
  getReturnFormAction,
  getReturnListAction,
  getReturnScreenAction,
  issueToProductionAction,
  listIssueRowsAction,
  listMaterialRowsAction,
  listOrderRowsAction,
  listPurchaseRowsAction,
  listReturnRowsAction,
  payPurchaseAction,
  recordWastageAction,
  returnFromProductionAction,
  transferMaterialAction,
  updateMaterialAction,
  updatePurchaseOrderAction,
  voidPurchaseAction,
  voidSupplierReturnAction,
} from "@/server/actions/materials.actions";
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
const EVERYONE = Object.keys(ROLES) as Who[];

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

/** What a page rendered: the "not part of your role" notice, an error, or the page. */
async function rendered(page: Promise<React.ReactElement>): Promise<string> {
  const element = await page;
  if (element.type === MaterialsNoAccess || element.type === PricesNoAccess) return "no access";
  if (element.type === SectionError) return "error";
  return "page";
}

/**
 * Extras with one person in each built-in role, a main store and a cutting
 * floor store, a fabric mill and a trims house, one running production project
 * and two materials: fabric with 1,000 m in the main store and buttons with
 * none.
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
  const supplier = async (name: string) =>
    (await parties.createParty(owner, { kind: "SUPPLIER", name })).party;
  const mill = await supplier("Narayanganj Fabrics");
  const trims = await supplier("Dhaka Trims House");
  const main = await stock.getDefaultWarehouse(owner);
  const floor = await stock.createWarehouse(owner, { name: "Cutting Floor Store" });
  const today = localDay(new Date(), company.timezone);
  const project = await projects.createProject(owner, {
    name: "Classic Polo run",
    targetDate: addDays(today, 30),
    targetQuantity: 500,
  });
  const fabric = await materials.createMaterial(owner, {
    name: "Single Jersey 180 GSM",
    kind: "FABRIC",
    unit: "METER",
    supplierId: mill.id,
    reorderLevel: 100,
  });
  const buttons = await materials.createMaterial(owner, {
    name: "Polo Button 18L",
    kind: "TRIM",
    unit: "PCS",
    supplierId: trims.id,
  });
  await materials.addOpeningStock(owner, fabric.id, { quantity: 1000, unitCost: 432.1 });
  return { company, people, owner, mill, trims, main, floor, today, project, fabric, buttons };
}

type Factory = Awaited<ReturnType<typeof factory>>;

async function as(env: Factory, who: Who): Promise<CompanyContext> {
  await signInAs(env.people[who].id, env.company.id);
  return requireCompanyPage();
}

const params = <T>(value: T) => Promise.resolve(value);
const noQuery = () => Promise.resolve({});

/** An open order for 50 m of fabric at 440 a metre. */
const fabricOrder = (env: Factory) =>
  orders.createPurchaseOrder(env.owner, {
    supplierId: env.mill.id,
    projectId: env.project.id,
    expectedDate: addDays(env.today, 7),
    lines: [{ materialId: env.fabric.id, quantity: 50, unitPrice: 440 }],
  });

/** 20 m of fabric bought on credit at 450 a metre. */
const fabricBill = (env: Factory) =>
  purchases.createPurchase(env.owner, {
    supplierId: env.mill.id,
    paymentType: "DUE",
    items: [{ materialId: env.fabric.id, quantity: 20, unitPrice: 450 }],
  });

/** Who may do what, from the built-in roles' permissions. */
function keys(ctx: CompanyContext) {
  const buy = ctx.can("materials.purchase");
  const pay = ctx.can("accounts.payments.record");
  const accountsManage = ctx.can("accounts.manage");
  return {
    view: ctx.can("materials.view"),
    keepStore: ctx.can("materials.manage"),
    buy,
    pay,
    accountsManage,
    seeCosts:
      buy || ctx.can("production.manage") || ctx.can("accounts.view") || accountsManage || pay,
    production: ctx.can("production.view"),
  };
}

run("Raw materials screens", () => {
  beforeEach(resetDb);

  it("shows each page to the people its actions let in, and nothing to the others", async () => {
    const env = await factory();
    const order = await fabricOrder(env);
    const bill = await fabricBill(env);
    const billItem = (await purchases.getPurchase(env.owner, bill.id)).items[0]!;
    const sentBack = await returns.createSupplierReturn(env.owner, {
      billId: bill.id,
      reason: "Shade band on one roll",
      lines: [{ billItemId: billItem.id, quantity: 2 }],
    });
    const note = await issues.issueToProduction(env.owner, {
      projectId: env.project.id,
      lines: [{ materialId: env.fabric.id, quantity: 100 }],
    });
    const seen: Record<string, unknown> = {};

    for (const who of EVERYONE) {
      const ctx = await as(env, who);
      const k = keys(ctx);
      seen[who] = k;
      const priced = k.view && k.seeCosts;

      const inMenu = visibleNavItems([...ctx.permissions]).some((i) => i.href === "/materials");
      expect(inMenu, who).toBe(k.view);
      const tabs = visibleMaterialsTabs(ctx.permissions).map((t) => t.href);
      expect(tabs, who).toEqual(
        !k.view
          ? []
          : [
              "/materials",
              "/materials/stock",
              "/materials/orders",
              ...(k.seeCosts ? ["/materials/purchases", "/materials/returns"] : []),
              "/materials/issues",
            ],
      );

      // Each screen's data comes exactly to the people its page is shown to.
      const overview = await getMaterialsOverviewScreenAction();
      expect(overview.ok, `${who}: overview`).toBe(k.view);
      const list = await getMaterialListAction({});
      expect(list.ok, `${who}: stock`).toBe(k.view);
      expect((await listMaterialRowsAction({})).ok, `${who}: more stock`).toBe(k.view);
      const material = await getMaterialScreenAction(env.fabric.id);
      expect(material.ok, `${who}: material`).toBe(k.view);
      expect((await getMaterialFormAction()).ok, `${who}: material form`).toBe(
        k.keepStore || k.buy,
      );
      const orderList = await getOrderListAction({});
      expect(orderList.ok, `${who}: orders`).toBe(k.view);
      expect((await listOrderRowsAction({})).ok, `${who}: more orders`).toBe(k.view);
      expect((await getOrderScreenAction(order.id)).ok, `${who}: order`).toBe(k.view);
      expect((await getOrderFormAction({})).ok, `${who}: order form`).toBe(k.buy);
      const purchaseList = await getPurchaseListAction({});
      expect(purchaseList.ok, `${who}: purchases`).toBe(priced);
      expect((await listPurchaseRowsAction({})).ok, `${who}: more purchases`).toBe(priced);
      expect((await getPurchaseScreenAction(bill.id)).ok, `${who}: purchase`).toBe(priced);
      expect((await getPurchaseFormAction({})).ok, `${who}: purchase form`).toBe(k.buy || k.pay);
      expect((await getReturnListAction({})).ok, `${who}: returns`).toBe(priced);
      expect((await listReturnRowsAction({})).ok, `${who}: more returns`).toBe(priced);
      expect((await getReturnScreenAction(sentBack.id)).ok, `${who}: return`).toBe(priced);
      expect((await getReturnFormAction(bill.id)).ok, `${who}: return form`).toBe(
        k.buy || k.accountsManage,
      );
      const issueList = await getIssueListAction({});
      expect(issueList.ok, `${who}: issue notes`).toBe(k.view);
      expect((await listIssueRowsAction({})).ok, `${who}: more issue notes`).toBe(k.view);
      expect((await getIssueScreenAction(note.id)).ok, `${who}: issue note`).toBe(k.view);
      expect((await getIssueFormAction({ kind: "ISSUE" })).ok, `${who}: issue form`).toBe(
        k.keepStore,
      );
      expect((await getProjectHoldingsAction(env.project.id)).ok, `${who}: holdings`).toBe(
        k.keepStore,
      );
      expect(
        (await getProjectMaterialsPanelAction(env.project.id)).ok,
        `${who}: project panel`,
      ).toBe(k.view || k.production);
      expect((await findMaterialsAction({ search: "" })).ok, `${who}: material search`).toBe(
        k.view || k.keepStore || k.buy || k.pay,
      );
      expect((await findMaterialSuppliersAction({ search: "" })).ok, `${who}: suppliers`).toBe(
        k.keepStore || k.buy || k.pay,
      );
      expect((await findMaterialProjectsAction({ search: "" })).ok, `${who}: projects`).toBe(
        k.keepStore || k.buy,
      );
      if (overview.ok) {
        expect(overview.data.can, who).toEqual({
          addMaterial: k.keepStore || k.buy,
          order: k.buy,
          receive: k.buy || k.pay,
          issue: k.keepStore,
          seePurchases: k.seeCosts,
        });
      }
      if (list.ok) expect(list.data.canCreate, who).toBe(k.keepStore || k.buy);
      if (orderList.ok) expect(orderList.data.canCreate, who).toBe(k.buy);
      if (purchaseList.ok) expect(purchaseList.data.canCreate, who).toBe(k.buy || k.pay);
      if (issueList.ok) expect(issueList.data.canIssue, who).toBe(k.keepStore);

      // The pages show "not part of your role" in the same cases.
      const page = (allowed: boolean) => (allowed ? "page" : "no access");
      const listed = { searchParams: noQuery() };
      expect(await rendered(MaterialsOverviewPage()), `${who}: /materials`).toBe(page(k.view));
      expect(await rendered(StockPage(listed)), `${who}: stock`).toBe(page(k.view));
      expect(await rendered(OrdersPage(listed)), `${who}: orders`).toBe(page(k.view));
      expect(await rendered(PurchasesPage(listed)), `${who}: purchases`).toBe(page(priced));
      expect(await rendered(ReturnsPage(listed)), `${who}: returns`).toBe(page(priced));
      expect(await rendered(IssuesPage(listed)), `${who}: issue notes`).toBe(page(k.view));
      expect(
        await rendered(
          MaterialPage({ params: params({ materialId: env.fabric.id }), searchParams: noQuery() }),
        ),
        `${who}: material`,
      ).toBe(page(k.view));
      expect(await rendered(NewMaterialPage()), `${who}: new material`).toBe(
        page(k.keepStore || k.buy),
      );
      expect(
        await rendered(EditMaterialPage({ params: params({ materialId: env.fabric.id }) })),
        `${who}: edit material`,
      ).toBe(page(k.keepStore || k.buy));
      expect(
        await rendered(
          OrderPage({ params: params({ orderId: order.id }), searchParams: noQuery() }),
        ),
        `${who}: order`,
      ).toBe(page(k.view));
      expect(await rendered(NewOrderPage(listed)), `${who}: new order`).toBe(page(k.buy));
      expect(
        await rendered(EditOrderPage({ params: params({ orderId: order.id }) })),
        `${who}: edit order`,
      ).toBe(page(k.buy));
      expect(
        await rendered(
          PurchasePage({ params: params({ billId: bill.id }), searchParams: noQuery() }),
        ),
        `${who}: purchase`,
      ).toBe(page(priced));
      expect(
        await rendered(NewPurchasePage({ searchParams: params({ order: order.id }) })),
        `${who}: receive goods`,
      ).toBe(page(k.buy || k.pay));
      expect(
        await rendered(
          ReturnPage({ params: params({ returnId: sentBack.id }), searchParams: noQuery() }),
        ),
        `${who}: return`,
      ).toBe(page(priced));
      expect(
        await rendered(NewReturnPage({ searchParams: params({ bill: bill.id }) })),
        `${who}: send back`,
      ).toBe(page(k.buy || k.accountsManage));
      expect(
        await rendered(
          IssuePage({ params: params({ issueId: note.id }), searchParams: noQuery() }),
        ),
        `${who}: issue note`,
      ).toBe(page(k.view));
      expect(
        await rendered(NewIssuePage({ searchParams: params({ project: env.project.id }) })),
        `${who}: new issue note`,
      ).toBe(page(k.keepStore));
    }

    const none = {
      view: false,
      keepStore: false,
      buy: false,
      pay: false,
      accountsManage: false,
      seeCosts: false,
      production: false,
    };
    expect(seen).toEqual({
      owner: {
        view: true,
        keepStore: true,
        buy: true,
        pay: true,
        accountsManage: true,
        seeCosts: true,
        production: true,
      },
      production: {
        ...none,
        view: true,
        keepStore: true,
        buy: true,
        seeCosts: true,
        production: true,
      },
      sales: none,
      store: { ...none, view: true, keepStore: true, production: true },
      accounts: {
        ...none,
        view: true,
        pay: true,
        accountsManage: true,
        seeCosts: true,
        production: true,
      },
      employee: none,
    });
  }, 180_000);

  it("keeps every price and value to buyers, Production Managers and Accounts", async () => {
    const env = await factory();
    const order = await fabricOrder(env);
    await fabricBill(env);
    const note = await issues.issueToProduction(env.owner, {
      projectId: env.project.id,
      lines: [{ materialId: env.fabric.id, quantity: 100 }],
    });

    for (const who of ["owner", "production", "accounts", "store"] as const) {
      await as(env, who);
      const priced = who !== "store";
      const overview = data(await getMaterialsOverviewScreenAction(), who);
      const list = data(await getMaterialListAction({}), who);
      const material = data(await getMaterialScreenAction(env.fabric.id), who);
      const orderScreen = data(await getOrderScreenAction(order.id), who);
      const orderList = data(await getOrderListAction({}), who);
      const noteScreen = data(await getIssueScreenAction(note.id), who);
      const issueList = data(await getIssueListAction({}), who);
      const panel = data(await getProjectMaterialsPanelAction(env.project.id), who);
      const row = list.items.find((m) => m.id === env.fabric.id)!;
      const bought = material.card.lines.find((l) => l.type === "PURCHASE_IN")!;

      expect(overview.seeCosts, who).toBe(priced);
      expect(material.seeCosts, who).toBe(priced);
      if (priced) {
        // 1,000 m at 432.10 and 20 m at 450, less 100 m issued at the average.
        expect(row.avgCost, who).toBe("432.451");
        expect(overview.totals.value, who).toBe("397854.90");
        expect(orderScreen.order.total, who).toBe("22000.00");
        expect(orderScreen.order.lines[0]!.unitPrice, who).toBe("440.00");
        expect(noteScreen.note.total, who).toBe("43245.10");
        expect(panel.materials[0]!.value, who).toBe("43245.10");
        expect(bought.document?.href, who).toMatch(/^\/materials\/purchases\//);
      } else {
        expect(overview.totals.value, who).toBeNull();
        expect(
          overview.byKind.every((k) => k.value === null),
          who,
        ).toBe(true);
        expect(row.avgCost, who).toBeNull();
        expect(row.stockValue, who).toBeNull();
        expect(material.material.avgCost, who).toBeNull();
        expect(material.card.closing.value, who).toBeNull();
        expect(
          material.card.lines.every((l) => l.value === null && l.unitCost === null),
          who,
        ).toBe(true);
        // The bill opens only with its prices, so the stock card names it without a link.
        expect(bought.document, who).toEqual({ number: expect.any(String), href: null });
        expect(
          material.material.orders.every((o) => o.unitPrice === null),
          who,
        ).toBe(true);
        expect(orderScreen.order.total, who).toBeNull();
        expect(
          orderScreen.order.bills.every((b) => b.total === null && b.href === null),
          who,
        ).toBe(true);
        expect(noteScreen.note.total, who).toBeNull();
        expect(panel.materialCost, who).toBeNull();
        // No price or value reaches the store team anywhere on these screens.
        const everything = JSON.stringify([
          overview,
          list,
          material,
          orderScreen,
          orderList,
          noteScreen,
          issueList,
          panel,
        ]);
        expect(everything, who).not.toMatch(/432\.1|432\.45|440|450\.|22000|43245|397855/);
      }
    }
  }, 60_000);

  it("offers stock and catalogue changes exactly to the people the actions let make them", async () => {
    const env = await factory();
    for (const who of EVERYONE) {
      await as(env, who);
      const label = (what: string) => `${who}: ${what}`;
      const overview = await getMaterialsOverviewScreenAction();
      const screen = await getMaterialScreenAction(env.fabric.id);
      const can = screen.ok ? screen.data.can : null;

      expectOffered(
        await createMaterialAction({ name: `Thread for ${who}`, kind: "TRIM", unit: "CONE" }),
        overview.ok && overview.data.can.addMaterial,
        label("add a material"),
      );
      expectOffered(
        await updateMaterialAction(env.fabric.id, { color: `Navy ${who}` }),
        can?.edit ?? false,
        label("change the material"),
      );
      expectOffered(
        await addOpeningStockAction(env.fabric.id, { quantity: 10, unitCost: 432.1 }),
        can?.openingStock ?? false,
        label("opening stock"),
      );
      expectOffered(
        await countMaterialAction(env.fabric.id, { countedQuantity: 1000 }),
        can?.count ?? false,
        label("count"),
      );
      expectOffered(
        await recordWastageAction(env.fabric.id, { quantity: 1, reason: "Torn in handling" }),
        can?.wastage ?? false,
        label("wastage"),
      );
      expectOffered(
        await transferMaterialAction(env.fabric.id, {
          fromWarehouseId: env.main.id,
          toWarehouseId: env.floor.id,
          quantity: 1,
        }),
        can?.transfer ?? false,
        label("move between stores"),
      );

      // Buttons hold nothing, so they may be archived and brought back.
      const empty = await getMaterialScreenAction(env.buttons.id);
      const archive = empty.ok ? empty.data.can.archive : false;
      expectOffered(
        await updateMaterialAction(env.buttons.id, { isActive: false }),
        archive,
        label("archive"),
      );
      if (archive) {
        const archived = data(await getMaterialScreenAction(env.buttons.id), who);
        expect(archived.can.reactivate, label("bring back offered")).toBe(true);
        expect(archived.can.order, label("no ordering an archived material")).toBe(false);
        expectOffered(
          await updateMaterialAction(env.buttons.id, { isActive: true }),
          true,
          label("bring back"),
        );
      }
    }
  }, 120_000);

  it("refuses to archive a material the store still holds, and says why", async () => {
    const env = await factory();
    await as(env, "owner");
    const screen = data(await getMaterialScreenAction(env.fabric.id), "owner");
    expect(screen.can.archive).toBe(false);
    expect(screen.notes.archive).toMatch(/still has 1000 m/);
    const refused = await updateMaterialAction(env.fabric.id, { isActive: false });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toBe(screen.notes.archive);
  });

  it("offers order changes exactly to the people the actions let make them", async () => {
    const env = await factory();
    for (const who of EVERYONE) {
      await as(env, who);
      const label = (what: string) => `${who}: ${what}`;
      const fresh = await fabricOrder(env);
      const partly = await fabricOrder(env);
      const line = (await orders.getPurchaseOrder(env.owner, partly.id)).lines[0]!;
      await purchases.createPurchase(env.owner, {
        purchaseOrderId: partly.id,
        paymentType: "DUE",
        items: [{ purchaseOrderLineId: line.id, quantity: 10 }],
      });
      const open = await getOrderScreenAction(fresh.id);
      const part = await getOrderScreenAction(partly.id);
      const can = open.ok ? open.data.can : null;
      const partCan = part.ok ? part.data.can : null;
      if (part.ok) {
        // Goods arrived: no more line changes or cancelling, only closing.
        expect(partCan!.editLines, label("lines locked")).toBe(false);
        expect(partCan!.cancel, label("no cancelling")).toBe(false);
      }

      const listed = await getOrderListAction({});
      expectOffered(
        await createPurchaseOrderAction({
          supplierId: env.mill.id,
          lines: [{ materialId: env.fabric.id, quantity: 5, unitPrice: 440 }],
        }),
        listed.ok && listed.data.canCreate,
        label("raise an order"),
      );
      expectOffered(
        await updatePurchaseOrderAction(fresh.id, { supplierRef: `PI-${who}` }),
        can?.edit ?? false,
        label("change the order"),
      );
      expectOffered(
        await updatePurchaseOrderAction(partly.id, {
          lines: [{ materialId: env.fabric.id, quantity: 60, unitPrice: 440 }],
        }),
        partCan?.editLines ?? false,
        label("change the lines after goods arrived"),
      );
      expectOffered(
        await createPurchaseAction({
          purchaseOrderId: partly.id,
          paymentType: "DUE",
          items: [{ purchaseOrderLineId: line.id, quantity: 5 }],
        }),
        partCan?.receive ?? false,
        label("receive on the order"),
      );
      expectOffered(
        await cancelPurchaseOrderAction(partly.id, { reason: "Not needed any more" }),
        partCan?.cancel ?? false,
        label("cancel after goods arrived"),
      );
      expectOffered(
        await closePurchaseOrderAction(partly.id, { reason: "The rest will not come" }),
        partCan?.close ?? false,
        label("close"),
      );
      expectOffered(
        await cancelPurchaseOrderAction(fresh.id, { reason: "Not needed any more" }),
        can?.cancel ?? false,
        label("cancel"),
      );
    }
  }, 180_000);

  it("offers purchase, payment and return changes exactly to the people the actions let make them", async () => {
    const env = await factory();
    for (const who of EVERYONE) {
      await as(env, who);
      const label = (what: string) => `${who}: ${what}`;
      const toPay = await fabricBill(env);
      const toVoid = await fabricBill(env);
      const toReturn = await fabricBill(env);
      const item = (await purchases.getPurchase(env.owner, toReturn.id)).items[0]!;
      const earlier = await returns.createSupplierReturn(env.owner, {
        billId: toReturn.id,
        reason: "Holes in one roll",
        lines: [{ billItemId: item.id, quantity: 1 }],
      });
      const pay = await getPurchaseScreenAction(toPay.id);
      const voiding = await getPurchaseScreenAction(toVoid.id);
      const sending = await getPurchaseScreenAction(toReturn.id);
      const sent = await getReturnScreenAction(earlier.id);
      const listed = await getPurchaseListAction({});
      const form = await getPurchaseFormAction({});
      if (sending.ok) {
        // Goods already went back on it, so it can no longer be voided.
        expect(sending.data.can.void, label("no voiding with a return")).toBe(false);
        expect(sending.data.notes.void, label("why not")).toMatch(/DN-/);
      }

      expectOffered(
        await createPurchaseAction({
          supplierId: env.mill.id,
          paymentType: "DUE",
          items: [{ materialId: env.fabric.id, quantity: 3, unitPrice: 450 }],
        }),
        form.ok,
        label("record a purchase"),
      );
      if (listed.ok) expect(listed.data.canCreate, label("receive offered")).toBe(form.ok);
      expectOffered(
        await createPurchaseAction({
          supplierId: env.mill.id,
          paymentType: "CASH_BANK",
          items: [{ materialId: env.fabric.id, quantity: 1, unitPrice: 450 }],
        }),
        form.ok && form.data.canPayNow,
        label("a purchase paid now"),
      );
      expectOffered(
        await payPurchaseAction(toPay.id, { amount: 1000, method: "CASH" }),
        pay.ok && pay.data.can.pay,
        label("pay"),
      );
      if (pay.ok && pay.data.can.pay) {
        expect(pay.data.moneyAccounts.length, label("accounts to pay from")).toBeGreaterThan(0);
      }
      expectOffered(
        await createSupplierReturnAction({
          billId: toReturn.id,
          reason: "Wrong shade",
          lines: [{ billItemId: item.id, quantity: 2 }],
        }),
        sending.ok && sending.data.can.return,
        label("send back"),
      );
      expectOffered(
        await voidSupplierReturnAction(earlier.id, { reason: "Entered twice" }),
        sent.ok && sent.data.can.void,
        label("void the return"),
      );
      expectOffered(
        await voidPurchaseAction(toVoid.id, { reason: "Entered twice" }),
        voiding.ok && voiding.data.can.void,
        label("void the purchase"),
      );
    }
  }, 180_000);

  it("offers issue and return notes exactly to the store team", async () => {
    const env = await factory();
    for (const who of EVERYONE) {
      await as(env, who);
      const label = (what: string) => `${who}: ${what}`;
      const panel = await getProjectMaterialsPanelAction(env.project.id);
      const form = await getIssueFormAction({ kind: "ISSUE", projectId: env.project.id });
      if (panel.ok) expect(panel.data.can.issue, label("issue offered")).toBe(form.ok);
      expectOffered(
        await issueToProductionAction({
          projectId: env.project.id,
          lines: [{ materialId: env.fabric.id, quantity: 10 }],
        }),
        form.ok,
        label("issue"),
      );
      const back = await getIssueFormAction({ kind: "RETURN", projectId: env.project.id });
      if (back.ok) {
        expect(back.data.holdings[0]?.holding, label("what the project holds")).toMatch(/^\d+$/);
      }
      expectOffered(
        await returnFromProductionAction({
          projectId: env.project.id,
          lines: [{ materialId: env.fabric.id, quantity: 1 }],
        }),
        back.ok,
        label("take back"),
      );
    }
    // A project holding nothing has nothing to take back.
    const other = await projects.createProject(env.owner, {
      name: "Empty run",
      targetDate: addDays(env.today, 30),
      targetQuantity: 10,
    });
    await as(env, "store");
    const empty = data(await getProjectMaterialsPanelAction(other.id), "store");
    expect(empty.can.issue).toBe(true);
    expect(empty.can.takeBack).toBe(false);
    expect(empty.can.order).toBe(false);
  }, 120_000);

  it("links the books' entries to the materials pages for people who may open them", async () => {
    const env = await factory();
    const bill = await fabricBill(env);
    const item = (await purchases.getPurchase(env.owner, bill.id)).items[0]!;
    const sentBack = await returns.createSupplierReturn(env.owner, {
      billId: bill.id,
      reason: "Shade band on one roll",
      lines: [{ billItemId: item.id, quantity: 2 }],
    });
    const note = await issues.issueToProduction(env.owner, {
      projectId: env.project.id,
      lines: [{ materialId: env.fabric.id, quantity: 10 }],
    });
    const entry = async (sourceType: string, sourceId: string) =>
      (await prisma.journalEntry.findFirstOrThrow({
        where: { sourceType: sourceType as never, sourceId },
      }))!.id;

    await as(env, "accounts");
    const source = async (sourceType: string, sourceId: string) =>
      data(await getJournalEntryScreenAction(await entry(sourceType, sourceId)), sourceType).source;
    expect(await source("SUPPLIER_BILL", bill.id)).toEqual({
      title: expect.stringMatching(/^Bill BILL-/),
      href: `/materials/purchases/${bill.id}`,
    });
    expect(await source("PURCHASE_RETURN", sentBack.id)).toEqual({
      title: expect.stringMatching(/^Return DN-/),
      href: `/materials/returns/${sentBack.id}`,
    });
    expect(await source("MATERIAL_ISSUE", note.id)).toEqual({
      title: expect.stringMatching(/^Issue note MI-.*, PRD-/),
      href: `/materials/issues/${note.id}`,
    });
  });
});
