import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The search box on every page (Release 2): each person finds only the kinds
 * of record they may open, never a price, a cost or a salary, and only their
 * own company's records. The API route reads the session from the cookie, so
 * Next.js' request helpers are replaced as in screens.test.ts.
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

import type { SystemRole } from "@prisma/client";

import { GET as searchRoute } from "@/app/api/search/route";
import { checkMayDo } from "@/lib/auth/check-token";
import { SESSION_COOKIE } from "@/lib/auth/session-cookie";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/modules/auth/session.service";
import {
  globalSearch,
  RESULTS_PER_KIND,
  searchableKinds,
  type SearchKind,
} from "@/modules/search/search.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/** The figures that must never reach a search result. */
const ORDER_TOTAL = "98765.43";
const UNIT_PRICE = "4321.09";
const SALARY = "55555";
const COST = "1234.5678";

/** One company's records, every one with "Nordic" somewhere in what names it. */
async function seed(companyId: string, tag: string) {
  const category = await prisma.category.create({
    data: { companyId, name: `Tops ${tag}`, slug: `tops-${tag.toLowerCase()}` },
  });
  const color = await prisma.color.create({
    data: { companyId, name: "Navy", hexCode: "#001f3f" },
  });
  const size = await prisma.size.create({ data: { companyId, name: "M" } });
  const style = await prisma.style.create({
    data: {
      companyId,
      categoryId: category.id,
      code: `NP-${tag}`,
      name: "Nordic polo",
      wholesalePrice: UNIT_PRICE,
      retailPrice: UNIT_PRICE,
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      companyId,
      styleId: style.id,
      colorId: color.id,
      sizeId: size.id,
      sku: `NP-${tag}-NAVY-M`,
      avgCost: COST,
    },
  });
  const buyer = await prisma.party.create({
    data: { companyId, code: `B-${tag}`, kind: "BUYER", name: `Nordic Apparel ${tag}` },
  });
  const supplier = await prisma.party.create({
    data: { companyId, code: `S-${tag}`, kind: "SUPPLIER", name: `Nordic Mills ${tag}` },
  });
  const order = await prisma.salesOrder.create({
    data: {
      companyId,
      number: `SO-${tag}-0001`,
      channel: "WHOLESALE",
      partyId: buyer.id,
      subtotal: ORDER_TOTAL,
      total: ORDER_TOTAL,
      dueAmount: ORDER_TOTAL,
      items: {
        create: [
          {
            variantId: variant.id,
            quantity: 10,
            unitPrice: UNIT_PRICE,
            lineTotal: ORDER_TOTAL,
            unitCost: COST,
          },
        ],
      },
    },
  });
  const invoice = await prisma.invoice.create({
    data: {
      companyId,
      number: `INV-${tag}-0001`,
      orderId: order.id,
      partyId: buyer.id,
      total: ORDER_TOTAL,
      dueAmount: ORDER_TOTAL,
    },
  });
  const quotation = await prisma.quotation.create({
    data: { companyId, number: `QT-${tag}-0001`, partyId: buyer.id, total: ORDER_TOTAL },
  });
  const proforma = await prisma.proformaInvoice.create({
    data: {
      companyId,
      number: `PI-${tag}-0001`,
      partyId: buyer.id,
      total: ORDER_TOTAL,
      advanceAmount: ORDER_TOTAL,
    },
  });
  const po = await prisma.purchaseOrder.create({
    data: {
      companyId,
      number: `PO-${tag}-0001`,
      supplierId: supplier.id,
      orderDate: new Date("2026-11-01"),
      totalAmount: ORDER_TOTAL,
    },
  });
  const bookedPo = await prisma.purchaseOrder.create({
    data: {
      companyId,
      number: `PO-${tag}-0002`,
      supplierId: supplier.id,
      orderDate: new Date("2026-11-02"),
      totalAmount: ORDER_TOTAL,
    },
  });
  const booking = await prisma.booking.create({
    data: {
      companyId,
      orderId: bookedPo.id,
      source: "SUPPLIER_PO",
      category: "KNITWEAR",
      title: "Nordic polo fabric",
      terms: "Delivery in 30 days",
    },
  });
  const project = await prisma.productionProject.create({
    data: {
      companyId,
      code: `PP-${tag}-0001`,
      name: "Nordic polo run",
      styleId: style.id,
      factoryId: supplier.id,
      salesOrderId: order.id,
      targetDate: new Date("2026-12-20"),
      targetQuantity: 10,
      totalCost: ORDER_TOTAL,
      cmRate: UNIT_PRICE,
    },
  });
  const batch = await prisma.productionBatch.create({
    data: { companyId, code: `MB-${tag}-0001`, name: "Nordic winter batch" },
  });
  const techPack = await prisma.techPack.create({
    data: { companyId, number: `TP-${tag}-0001`, title: "Nordic polo SS27", styleId: style.id },
  });
  const employee = await prisma.employee.create({
    data: {
      companyId,
      code: `E-${tag}-01`,
      name: "Nordic Rahman",
      designation: "Merchandiser",
      joinDate: new Date("2025-01-01"),
      baseSalary: SALARY,
    },
  });
  return {
    style,
    buyer,
    supplier,
    order,
    invoice,
    quotation,
    proforma,
    po,
    booking,
    project,
    batch,
    techPack,
    employee,
  };
}

type Seed = Awaited<ReturnType<typeof seed>>;

const ALL_KINDS: SearchKind[] = [
  "orders",
  "invoices",
  "quotations",
  "proformas",
  "parties",
  "styles",
  "bookings",
  "purchaseOrders",
  "projects",
  "batches",
  "techPacks",
  "employees",
];

run("The search box: by permission, without money, inside the company", () => {
  let a: Seed;
  let b: Seed;
  let companyA: string;
  let companyB: string;
  const users: Record<string, string> = {};

  beforeEach(async () => {
    await resetDb();
    browser.cookies.clear();
    const one = await makeCompany("Search One");
    const two = await makeCompany("Search Two");
    companyA = one.company.id;
    companyB = two.company.id;
    a = await seed(companyA, "A");
    b = await seed(companyB, "B");
    const roles: Array<[string, SystemRole, string, Record<SystemRole, string>]> = [
      ["owner", "SUPER_ADMIN", companyA, one.roles],
      ["sales", "SALES_EXECUTIVE", companyA, one.roles],
      ["warehouse", "WAREHOUSE_TEAM", companyA, one.roles],
      ["accounts", "ACCOUNTS", companyA, one.roles],
      ["employee", "EMPLOYEE", companyA, one.roles],
      ["ownerB", "SUPER_ADMIN", companyB, two.roles],
    ];
    for (const [name, role, companyId, roleIds] of roles) {
      const user = await makeUser(`${name}@search.test`);
      await addToCompany(user.id, companyId, roleIds[role]);
      users[name] = user.id;
    }
  });

  const as = (name: string) => contextFor(users[name]!, name === "ownerB" ? companyB : companyA);
  const kindsOf = (result: Awaited<ReturnType<typeof globalSearch>>) =>
    result.groups.map((g) => g.kind);
  const idsOf = (result: Awaited<ReturnType<typeof globalSearch>>) =>
    result.groups.flatMap((g) => g.hits.map((h) => h.id));

  it("finds every kind of record for the owner, each a link to its page", async () => {
    const result = await globalSearch(await as("owner"), { q: "nordic" });
    expect(kindsOf(result)).toEqual(ALL_KINDS);
    const hrefs = result.groups.flatMap((g) => g.hits.map((h) => h.href));
    expect(hrefs).toEqual(
      expect.arrayContaining([
        `/sales/orders/${a.order.id}`,
        `/sales/invoices/${a.invoice.id}`,
        `/sales/quotations/${a.quotation.id}`,
        `/sales/proformas/${a.proforma.id}`,
        `/parties/buyers/${a.buyer.id}`,
        `/parties/suppliers/${a.supplier.id}`,
        `/products/${a.style.id}`,
        `/production/bookings/${a.booking.id}`,
        `/materials/orders/${a.po.id}`,
        `/production/projects/${a.project.id}`,
        `/production/batches/${a.batch.id}`,
        `/tech-packs/${a.techPack.id}`,
        `/hr/employees/${a.employee.id}`,
      ]),
    );
    // A booking's order is found as the booking, not again as a purchase order.
    const pos = result.groups.find((g) => g.kind === "purchaseOrders")!.hits;
    expect(pos.map((h) => h.title)).toEqual(["PO-A-0001"]);
    // By number, code or phone too, in any case.
    const byNumber = await globalSearch(await as("owner"), { q: "so-a-0001" });
    expect(kindsOf(byNumber)).toEqual(["orders", "invoices"]);
    expect(byNumber.groups[0]!.hits[0]!.title).toBe("SO-A-0001");
  });

  it("shows each person only the kinds of record their role opens", async () => {
    const expected: Record<string, SearchKind[]> = {
      // Sales: sales, buyers and suppliers, and the product matrix.
      sales: ["orders", "invoices", "quotations", "proformas", "parties", "styles"],
      // The store: stock, raw material orders, production and bookings, and sales.
      warehouse: [
        "orders",
        "invoices",
        "quotations",
        "proformas",
        "styles",
        "bookings",
        "purchaseOrders",
        "projects",
        "batches",
        "techPacks",
      ],
      accounts: [
        "orders",
        "invoices",
        "quotations",
        "proformas",
        "parties",
        "bookings",
        "purchaseOrders",
        "projects",
        "batches",
        "techPacks",
        "employees",
      ],
      employee: [],
    };
    for (const [name, kinds] of Object.entries(expected)) {
      const ctx = await as(name);
      expect(searchableKinds(ctx.can), name).toEqual(kinds);
      const result = await globalSearch(ctx, { q: "Nordic" });
      expect(kindsOf(result), name).toEqual(kinds);
    }
  });

  it("never shows a price, a total, a cost or a salary", async () => {
    const result = await globalSearch(await as("owner"), { q: "nordic" });
    const text = JSON.stringify(result);
    for (const figure of [ORDER_TOTAL, UNIT_PRICE, SALARY, COST, "98,765", "55,555"]) {
      expect(text).not.toContain(figure);
    }
    for (const hit of result.groups.flatMap((g) => g.hits)) {
      expect(Object.keys(hit).sort()).toEqual(["detail", "href", "id", "title"]);
    }
  });

  it("finds only the company's own records", async () => {
    const mine = idsOf(await globalSearch(await as("owner"), { q: "nordic" }));
    const theirs = idsOf(await globalSearch(await as("ownerB"), { q: "nordic" }));
    const bIds = Object.values(b).map((r) => r.id);
    const aIds = Object.values(a).map((r) => r.id);
    expect(mine.some((id) => bIds.includes(id))).toBe(false);
    expect(theirs.some((id) => aIds.includes(id))).toBe(false);
    expect(theirs).toContain(b.order.id);
    // Company B's own numbers find nothing from company A.
    expect((await globalSearch(await as("owner"), { q: "SO-B-0001" })).groups).toEqual([]);
  });

  it("needs 2 letters, takes at most 80, and keeps to a few results a kind", async () => {
    const owner = await as("owner");
    expect((await globalSearch(owner, { q: " n " })).groups).toEqual([]);
    const tooLong = await globalSearch(owner, { q: "n".repeat(81) }).catch((e: unknown) => e);
    expect(tooLong).toBeInstanceOf(AppError);
    expect((tooLong as AppError).code).toBe("VALIDATION");
    await prisma.party.createMany({
      data: Array.from({ length: RESULTS_PER_KIND + 3 }, (_, i) => ({
        companyId: companyA,
        code: `X-${i}`,
        kind: "BUYER" as const,
        name: `Nordic extra ${i}`,
      })),
    });
    const parties = (await globalSearch(owner, { q: "nordic" })).groups.find(
      (g) => g.kind === "parties",
    )!;
    expect(parties.hits).toHaveLength(RESULTS_PER_KIND);
  });

  it("answers GET /api/search for the signed-in person, and the Full check may read it", async () => {
    const { token } = await createSession(users.sales!, companyA);
    browser.cookies.set(SESSION_COOKIE, token);
    const response = await searchRoute(new Request("http://localhost/api/search?q=nordic"), {
      params: Promise.resolve({}),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: true;
      data: { groups: Array<{ kind: SearchKind }> };
    };
    expect(body.data.groups.map((g) => g.kind)).not.toContain("employees");
    expect(body.data.groups.map((g) => g.kind)).toContain("orders");

    browser.cookies.clear();
    const anonymous = await searchRoute(new Request("http://localhost/api/search?q=nordic"), {
      params: Promise.resolve({}),
    });
    expect(anonymous.status).toBe(401);
    expect(checkMayDo("GET", "fullcheck.x", false, "/api/search")).toBe(true);
  });
});
