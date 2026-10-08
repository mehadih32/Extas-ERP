import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The Products screens decide what to show and offer from flags the server sends
 * with the data (canManage, can.delete, showsCosts). These tests open the screens'
 * data as each built-in role and then try every change through the same Server
 * Actions the buttons call: each must work exactly when the screen offers it, and
 * costs must reach only the people who see the financials. Next.js' request
 * helpers are replaced as in screens.test.ts.
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
  usePathname: () => "/products",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

import NewStylePage from "@/app/(app)/products/new/page";
import StylesPage from "@/app/(app)/products/page";
import StockCountPage from "@/app/(app)/products/stock-count/page";
import { visibleProductsTabs } from "@/components/products/tabs";
import { NoAccess } from "@/components/settings/no-access";
import { visibleNavItems } from "@/components/shell/nav-items";
import { SESSION_COOKIE } from "@/lib/auth/session-cookie";
import { prisma } from "@/lib/prisma";
import type { ActionResult } from "@/lib/result";
import type { CompanyContext } from "@/modules/auth/context";
import { createSession } from "@/modules/auth/session.service";
import { canSeeFinancials } from "@/modules/dashboard/access";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as stock from "@/modules/inventory/stock.service";
import * as styles from "@/modules/inventory/style.service";
import {
  createBrandAction,
  createColorAction,
  createSizeAction,
  createStyleAction,
  createWarehouseAction,
  deleteBrandAction,
  deleteCategoryAction,
  deleteColorAction,
  deleteSizeAction,
  deleteStyleAction,
  generateMatrixAction,
  getCatalogSetupAction,
  getStockCountSheetAction,
  getStyleListAction,
  getStyleScreenAction,
  getVariantDetailsAction,
  listBadStockAction,
  listStockMovementsAction,
  lookupVariantAction,
  moveToBadStockAction,
  recordStockCountAction,
  updateBrandAction,
  updateColorAction,
  updateStyleAction,
  updateVariantAction,
} from "@/server/actions/inventory.actions";
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

/** Opens the company as this person, as the browser does after they sign in. */
async function signInAs(userId: string, companyId: string) {
  const { token } = await createSession(userId, companyId);
  browser.cookies.set(SESSION_COOKIE, token);
}

/** A refusal must come from the access rules, not from some other failure. */
function expectRuleRefusal(result: ActionResult<unknown>, label: string) {
  if (result.ok) return;
  expect(["FORBIDDEN", "CONFLICT"], `${label}: ${result.error.message}`).toContain(
    result.error.code,
  );
}

function data<T>(result: ActionResult<T>, label: string): T {
  if (!result.ok) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

/**
 * Extras with one person in each built-in role, a Classic Polo (Navy and White in
 * S to XL) with 10 Navy S brought in at 400 each and 2 of them moved to bad stock,
 * a Plain Tee with no history, and a colour, size, category and brand nobody uses.
 */
async function shop() {
  const { company, roles } = await makeCompany("Extras");
  const people = {} as Record<Who, { id: string }>;
  for (const [who, role] of Object.entries(ROLES) as Array<[Who, keyof typeof roles]>) {
    const user = await makeUser(`${who}@extras.test`);
    await addToCompany(user.id, company.id, roles[role]);
    people[who] = user;
  }
  const ctx = await contextFor(people.owner.id, company.id);
  const sizes = [];
  for (const name of ["S", "M", "L", "XL", "3XL"]) {
    sizes.push(await catalog.createSize(ctx, { name }));
  }
  const navy = await catalog.createColor(ctx, { name: "Navy", hexCode: "#1F2A44" });
  const white = await catalog.createColor(ctx, { name: "White", hexCode: "#FFFFFF" });
  await catalog.createColor(ctx, { name: "Black", hexCode: "#111111" });
  const tops = await catalog.createCategory(ctx, { name: "Tops" });
  const polos = await catalog.createCategory(ctx, { name: "Polos", parentId: tops.id });
  await catalog.createCategory(ctx, { name: "Bottoms" });
  const signature = await catalog.createBrand(ctx, { name: "Extras Signature" });
  await catalog.createBrand(ctx, { name: "Spare" });

  const polo = await styles.createStyle(ctx, {
    code: "EX-PL-001",
    name: "Classic Polo",
    categoryId: polos.id,
    brandId: signature.id,
    wholesalePrice: 900,
    retailPrice: 1450,
  });
  await matrix.generateMatrix(ctx, polo.id, {
    colorIds: [navy.id, white.id],
    sizeIds: sizes.slice(0, 4).map((s) => s.id),
  });
  const tee = await styles.createStyle(ctx, {
    code: "EX-TS-001",
    name: "Plain Tee",
    categoryId: tops.id,
    wholesalePrice: 400,
    retailPrice: 650,
  });
  await matrix.generateMatrix(ctx, tee.id, { colorIds: [white.id], sizeIds: [sizes[0]!.id] });

  const navyS = await prisma.productVariant.findFirstOrThrow({
    where: { sku: "EX-PL-001-NAVY-S" },
  });
  await stock.recordStockCount(ctx, {
    mode: "OPENING",
    unitCost: 400,
    lines: [{ variantId: navyS.id, quantity: 10 }],
  });
  await stock.moveToBadStock(ctx, {
    variantId: navyS.id,
    quantity: 2,
    source: "WAREHOUSE_DAMAGE",
    reason: "Stained",
  });
  return { company, people, owner: ctx, polo, tee, navyS, polos };
}

type Shop = Awaited<ReturnType<typeof shop>>;

async function as(env: Shop, who: Who): Promise<CompanyContext> {
  await signInAs(env.people[who].id, env.company.id);
  return requireCompanyPage();
}

run("Products screens", () => {
  beforeEach(resetDb);

  it("shows Products to the people who may see the stock, and nothing to the others", async () => {
    const env = await shop();
    const seen: Record<string, unknown> = {};

    for (const who of Object.keys(ROLES) as Who[]) {
      const ctx = await as(env, who);
      const view = ctx.can("inventory.view");
      const manage = ctx.can("inventory.manage");
      seen[who] = { view, manage };

      const inMenu = visibleNavItems([...ctx.permissions]).some((i) => i.href === "/products");
      expect(inMenu, who).toBe(view);
      expect(
        visibleProductsTabs(ctx.permissions).map((t) => t.href),
        who,
      ).toEqual([
        ...(view ? ["/products"] : []),
        ...(manage ? ["/products/stock-count"] : []),
        ...(view ? ["/products/bad-stock", "/products/setup"] : []),
      ]);

      // Each tab's data comes exactly to the people its tab is shown to.
      expect((await getStyleListAction({})).ok, `${who}: styles`).toBe(view);
      expect((await getCatalogSetupAction()).ok, `${who}: setup`).toBe(view);
      expect((await listBadStockAction({})).ok, `${who}: bad stock`).toBe(view);
      expect((await getStockCountSheetAction({})).ok, `${who}: count sheet`).toBe(manage);
      if (!view) {
        for (const read of [
          getStyleScreenAction(env.polo.id),
          getVariantDetailsAction(env.navyS.id),
          listStockMovementsAction({ styleId: env.polo.id }),
          lookupVariantAction("EX-PL-001-NAVY-S"),
        ]) {
          const result = await read;
          expect(result.ok ? "allowed" : result.error.code, who).toBe("FORBIDDEN");
        }
      }

      // The pages show "not part of your role" in the same cases.
      const list = await StylesPage({ searchParams: Promise.resolve({}) });
      expect(list.type === NoAccess, `${who}: styles page`).toBe(!view);
      const adding = await NewStylePage();
      expect(adding.type === NoAccess, `${who}: new style page`).toBe(!manage);
      const counting = await StockCountPage({ searchParams: Promise.resolve({}) });
      expect(counting.type === NoAccess, `${who}: stock count page`).toBe(!manage);
    }

    expect(seen).toEqual({
      owner: { view: true, manage: true },
      production: { view: true, manage: true },
      sales: { view: true, manage: false },
      store: { view: true, manage: true },
      accounts: { view: false, manage: false },
      employee: { view: false, manage: false },
    });
  }, 60_000);

  it("offers each change exactly to the people the actions let make it", async () => {
    const env = await shop();

    for (const who of ["owner", "production", "sales", "store"] as const) {
      const ctx = await as(env, who);
      const manage = ctx.can("inventory.manage");
      const setup = data(await getCatalogSetupAction(), who);
      expect(setup.canManage, who).toBe(manage);

      const added = await createColorAction({ name: `Teal ${who}`, hexCode: "#008080" });
      expect(added.ok, `${who}: add a colour`).toBe(manage);
      expectRuleRefusal(added, who);
      if (added.ok) await prisma.color.delete({ where: { id: added.data.id } });

      // Every delete works exactly where the screen offers it; what it removed is put back.
      for (const color of setup.colors) {
        const before = await prisma.color.findUniqueOrThrow({ where: { id: color.id } });
        const result = await deleteColorAction(color.id);
        expect(result.ok, `${who}: delete ${color.name}`).toBe(color.can.delete);
        expectRuleRefusal(result, who);
        if (result.ok) await prisma.color.create({ data: before });
      }
      for (const size of setup.sizes) {
        const before = await prisma.size.findUniqueOrThrow({ where: { id: size.id } });
        const result = await deleteSizeAction(size.id);
        expect(result.ok, `${who}: delete ${size.name}`).toBe(size.can.delete);
        expectRuleRefusal(result, who);
        if (result.ok) await prisma.size.create({ data: before });
      }
      for (const category of setup.categories) {
        const before = await prisma.category.findUniqueOrThrow({ where: { id: category.id } });
        const result = await deleteCategoryAction(category.id);
        expect(result.ok, `${who}: delete ${category.name}`).toBe(category.can.delete);
        expectRuleRefusal(result, who);
        if (result.ok) await prisma.category.create({ data: before });
      }
      for (const brand of setup.brands) {
        const before = await prisma.brand.findUniqueOrThrow({ where: { id: brand.id } });
        const result = await deleteBrandAction(brand.id);
        expect(result.ok, `${who}: delete ${brand.name}`).toBe(brand.can.delete);
        expectRuleRefusal(result, who);
        if (result.ok) await prisma.brand.create({ data: before });
      }
      if (manage) {
        expect(setup.colors.filter((c) => c.can.delete).map((c) => c.name)).toEqual(["Black"]);
        expect(setup.sizes.filter((s) => s.can.delete).map((s) => s.name)).toEqual(["3XL"]);
        expect(setup.categories.filter((c) => c.can.delete).map((c) => c.name)).toEqual([
          "Bottoms",
        ]);
        expect(setup.brands.filter((b) => b.can.delete).map((b) => b.name)).toEqual(["Spare"]);
      }

      // A style with history is never offered for deletion; one without is, to managers.
      const polo = data(await getStyleScreenAction(env.polo.id), who);
      expect(polo.can, who).toEqual({ manage, delete: false });
      expectRuleRefusal(await deleteStyleAction(env.polo.id), who);
      const temp = await styles.createStyle(env.owner, {
        code: `TMP-${who}`,
        name: "Sample",
        categoryId: env.polos.id,
      });
      const fresh = data(await getStyleScreenAction(temp.id), who);
      expect(fresh.can.delete, `${who}: may delete a new style`).toBe(manage);
      const deleted = await deleteStyleAction(temp.id);
      expect(deleted.ok, `${who}: delete a new style`).toBe(fresh.can.delete);
      expectRuleRefusal(deleted, who);
      if (!deleted.ok) await styles.deleteStyle(env.owner, temp.id);

      const archived = await updateStyleAction(env.polo.id, { isActive: false });
      expect(archived.ok, `${who}: archive`).toBe(polo.can.manage);
      if (archived.ok)
        await prisma.style.update({ where: { id: env.polo.id }, data: { isActive: true } });
      const grown = await generateMatrixAction(env.polo.id, {
        colorIds: [polo.matrix.rows[0]!.color.id],
        sizeIds: [polo.matrix.sizes[0]!.id],
      });
      expect(grown.ok, `${who}: add colours or sizes`).toBe(polo.can.manage);

      // The SKU window, its edit, its count and its bad stock.
      const sku = data(await getVariantDetailsAction(env.navyS.id), who);
      expect(sku.canManage, who).toBe(manage);
      const edited = await updateVariantAction(env.navyS.id, { barcode: `88${who.length}` });
      expect(edited.ok, `${who}: edit the SKU`).toBe(sku.canManage);
      if (edited.ok) {
        await prisma.productVariant.update({
          where: { id: env.navyS.id },
          data: { barcode: null },
        });
      }
      const counted = await recordStockCountAction({
        mode: "COUNT",
        lines: [{ variantId: env.navyS.id, counted: 8, expected: 8 }],
      });
      expect(counted.ok, `${who}: count`).toBe(sku.canManage);
      if (counted.ok) expect(counted.data).toEqual({ changed: 0, added: 0, removed: 0 });
      // Asking for more pieces than there are: refused by the stock for managers, by
      // the permission for everyone else.
      const moved = await moveToBadStockAction({ variantId: env.navyS.id, quantity: 999 });
      expect(moved.ok ? "allowed" : moved.error.code, who).toBe(
        sku.canManage ? "CONFLICT" : "FORBIDDEN",
      );

      const warehouse = await createWarehouseAction({ name: `Store of ${who}` });
      expect(warehouse.ok, `${who}: add a warehouse`).toBe(manage);
    }
  }, 90_000);

  it("shows what stock cost only to the people who see the financials", async () => {
    const env = await shop();
    const seen: Record<string, boolean> = {};

    for (const who of ["owner", "production", "sales", "store"] as const) {
      const ctx = await as(env, who);
      const financial = canSeeFinancials(ctx);
      seen[who] = financial;

      const screen = data(await getStyleScreenAction(env.polo.id), who);
      expect(screen.showsCosts, who).toBe(financial);
      const sku = data(await getVariantDetailsAction(env.navyS.id), who);
      expect(sku.showsCosts, who).toBe(financial);
      expect(sku.averageCost, who).toEqual(
        financial ? { aGrade: "400.00", bGrade: "0.00" } : { aGrade: null, bGrade: null },
      );
      const bad = data(await listBadStockAction({}), who);
      expect(bad.showsCosts, who).toBe(financial);
      expect(bad.totals, who).toEqual({
        entries: 1,
        pieces: 2,
        lossValue: financial ? "800.00" : null,
      });
      expect(bad.items[0]!.lossValue, who).toBe(financial ? "800.00" : null);
      const history = data(await listStockMovementsAction({ styleId: env.polo.id }), who);
      expect(
        history.items.map((m) => [m.type, m.quantity, m.value]),
        who,
      ).toEqual([
        ["BAD_STOCK_OUT", -2, financial ? "800.00" : null],
        ["OPENING", 10, financial ? "4000.00" : null],
      ]);
      // A SKU lookup (scanners, the bad stock form) never carries its cost.
      const found = data(await lookupVariantAction("ex-pl-001-navy-s"), who);
      expect(found, who).not.toHaveProperty("avgCost");
      expect(found, who).not.toHaveProperty("bGradeAvgCost");
      expect(found.wholesalePrice, who).toBe("900.00");
    }

    expect(seen).toEqual({ owner: true, production: false, sales: false, store: false });
  }, 60_000);

  it("refuses a name already taken in any letter case, on the name field", async () => {
    const env = await shop();
    await as(env, "owner");
    const refusal = (result: ActionResult<unknown>) =>
      result.ok ? "saved" : [result.error.code, result.error.fieldErrors];
    const navy = await prisma.color.findFirstOrThrow({ where: { name: "Navy" } });
    const white = await prisma.color.findFirstOrThrow({ where: { name: "White" } });
    const spare = await prisma.brand.findFirstOrThrow({ where: { name: "Spare" } });

    expect(refusal(await createColorAction({ name: "navy", hexCode: "#000080" }))).toEqual([
      "CONFLICT",
      { name: ["There is already a colour called navy."] },
    ]);
    expect(refusal(await updateColorAction(white.id, { name: "NAVY" }))).toEqual([
      "CONFLICT",
      { name: ["There is already a colour called NAVY."] },
    ]);
    // A colour may change the case of its own name.
    expect(refusal(await updateColorAction(navy.id, { name: "NAVY" }))).toBe("saved");
    expect(refusal(await createBrandAction({ name: "SPARE" }))).toEqual([
      "CONFLICT",
      { name: ["There is already a brand called SPARE."] },
    ]);
    expect(refusal(await updateBrandAction(spare.id, { name: "extras signature" }))).toEqual([
      "CONFLICT",
      { name: ["There is already a brand called extras signature."] },
    ]);
    expect(refusal(await createWarehouseAction({ name: "main warehouse" }))).toEqual([
      "CONFLICT",
      { name: ["There is already a warehouse called main warehouse."] },
    ]);
    expect(refusal(await createSizeAction({ name: "xl" }))).toEqual([
      "CONFLICT",
      { name: ["There is already a size called XL."] },
    ]);
    expect(
      refusal(
        await createStyleAction({
          code: "ex-pl-001",
          name: "Polo again",
          categoryId: env.polos.id,
        }),
      ),
    ).toEqual(["CONFLICT", { code: ["Style code EX-PL-001 already exists."] }]);
  }, 30_000);

  it("counts from the shelf numbers the sheet shows, and refuses once they moved", async () => {
    const env = await shop();
    await as(env, "store");
    const sheet = data(await getStockCountSheetAction({ styleId: env.polo.id }), "sheet");
    expect(sheet.warehouse.name).toBe("Main Warehouse");
    expect(sheet.sheet!.sizes.map((s) => s.name)).toEqual(["S", "M", "L", "XL"]);
    const navyS = sheet.sheet!.rows[0]!.cells[0]!;
    expect([navyS.sku, navyS.onShelf]).toEqual(["EX-PL-001-NAVY-S", 8]);
    const bGrade = data(
      await getStockCountSheetAction({ styleId: env.polo.id, grade: "B_GRADE" }),
      "B sheet",
    );
    expect(bGrade.sheet!.rows[0]!.cells[0]!.onShelf).toBe(0);

    const counted = await recordStockCountAction({
      mode: "COUNT",
      warehouseId: sheet.warehouse.id ?? undefined,
      lines: [{ variantId: navyS.variantId, counted: 7, expected: navyS.onShelf }],
    });
    expect(data(counted, "count")).toEqual({ changed: 1, added: 0, removed: 1 });

    // The same sheet saved again is stale: the shelf now holds 7, not 8.
    const stale = await recordStockCountAction({
      mode: "COUNT",
      lines: [{ variantId: navyS.variantId, counted: 6, expected: navyS.onShelf }],
    });
    expect(stale.ok ? "saved" : stale.error.message).toMatch(
      /Stock changed while you were counting/,
    );
  }, 30_000);
});
