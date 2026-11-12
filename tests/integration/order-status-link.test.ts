import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Share order status (Release 2): a read-only link to one order's progress for
 * its buyer. Only the token's hash is kept; a stopped, ended, unknown or
 * malformed link is "not found"; the buyer's page never carries a price, a
 * cost, a factory or supplier, the buyer's own name or another order; and the
 * link reads only its own company's order. Making and stopping need
 * sales.order.share and are in the activity log.
 */
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw Object.assign(new Error("Not found"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  },
}));

import OrderStatusPage from "@/app/(public)/order-status/[token]/page";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { CompanyContext } from "@/modules/auth/context";
import { DEFAULT_ROLE_PERMISSIONS } from "@/modules/rbac/permissions";
import * as links from "@/modules/sales/order-status.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const UNIT_PRICE = "4321.09";
const ORDER_TOTAL = "432109.00";
const CM_RATE = "87.65";
const COST = "1234.5678";
const FACTORY = "Dhaka Knit Factory";
const BUYER = "Nordic Apparel";

async function appError(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

const tokenOf = (path: string) => path.split("/").at(-1)!;

/** A wholesale order of 100 polos, in production at a factory: cut 60, graded 40, 35 in stock, 10 shipped. */
async function seed(companyId: string, tag: string) {
  const category = await prisma.category.create({
    data: { companyId, name: "Tops", slug: `tops-${tag}` },
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
    data: { companyId, code: `B-${tag}`, kind: "BUYER", name: `${BUYER} ${tag}` },
  });
  const factory = await prisma.party.create({
    data: { companyId, code: `F-${tag}`, kind: "SUPPLIER", name: `${FACTORY} ${tag}` },
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
      shipmentDate: new Date("2026-12-20"),
      items: {
        create: [
          {
            variantId: variant.id,
            quantity: 100,
            unitPrice: UNIT_PRICE,
            lineTotal: ORDER_TOTAL,
            unitCost: COST,
          },
        ],
      },
    },
  });
  // Another order of the same buyer: never on this order's page.
  await prisma.salesOrder.create({
    data: { companyId, number: `SO-${tag}-0002`, channel: "WHOLESALE", partyId: buyer.id },
  });
  const project = await prisma.productionProject.create({
    data: {
      companyId,
      code: `PP-${tag}-0001`,
      name: `Polo at ${FACTORY}`,
      styleId: style.id,
      factoryId: factory.id,
      factoryName: FACTORY,
      buyerId: buyer.id,
      salesOrderId: order.id,
      stage: "SEWING",
      targetDate: new Date("2026-12-15"),
      targetQuantity: 100,
      totalCost: ORDER_TOTAL,
      cmRate: CM_RATE,
      targetUnitCost: COST.slice(0, 7),
    },
  });
  await prisma.cuttingReport.create({
    data: {
      companyId,
      projectId: project.id,
      number: `CUT-${tag}-1`,
      cutOn: new Date("2026-11-05"),
      lines: [{ colorName: "Navy", sizeName: "M", quantity: 60 }],
    },
  });
  await prisma.finishingReport.create({
    data: {
      companyId,
      projectId: project.id,
      number: `FIN-${tag}-1`,
      countedOn: new Date("2026-11-08"),
      lines: [{ colorName: "Navy", sizeName: "M", a: 30, b: 5, c: 3, reject: 2, missing: 0 }],
    },
  });
  await prisma.stockIntake.create({
    data: {
      companyId,
      number: `SI-${tag}-1`,
      projectId: project.id,
      status: "CONFIRMED",
      totalCost: ORDER_TOTAL,
      lines: {
        create: [{ variantId: variant.id, grade: "A_GRADE", quantity: 35, unitCost: COST }],
      },
    },
  });
  await prisma.deliveryChallan.create({
    data: {
      companyId,
      number: `DC-${tag}-1`,
      orderId: order.id,
      deliveryDate: new Date("2026-11-10T06:00:00Z"),
      receivedBy: `${BUYER} store`,
      items: { create: [{ variantId: variant.id, quantity: 10 }] },
    },
  });
  return { order, project, style };
}

run("Share order status: a read-only link for the buyer", () => {
  let owner: CompanyContext;
  let sales: CompanyContext;
  let ownerB: CompanyContext;
  let a: Awaited<ReturnType<typeof seed>>;
  let b: Awaited<ReturnType<typeof seed>>;
  let companyB: string;

  beforeEach(async () => {
    await resetDb();
    const one = await makeCompany("Extas Status");
    const two = await makeCompany("Other House");
    companyB = two.company.id;
    a = await seed(one.company.id, "A");
    b = await seed(two.company.id, "B");
    const ownerUser = await makeUser("owner@status.test");
    const salesUser = await makeUser("sales@status.test");
    const ownerBUser = await makeUser("ownerb@status.test");
    await addToCompany(ownerUser.id, one.company.id, one.roles.SUPER_ADMIN);
    await addToCompany(salesUser.id, one.company.id, one.roles.SALES_EXECUTIVE);
    await addToCompany(ownerBUser.id, two.company.id, two.roles.SUPER_ADMIN);
    owner = await contextFor(ownerUser.id, one.company.id);
    sales = await contextFor(salesUser.id, one.company.id);
    ownerB = await contextFor(ownerBUser.id, two.company.id);
  });

  it("keeps only the link's hash, shows the address once and logs who made it", async () => {
    const made = await links.makeStatusLink(owner, a.order.id, { days: 30 });
    expect(made.path).toMatch(/^\/order-status\/[A-Za-z0-9_-]{43}$/);
    const token = tokenOf(made.path);
    const row = await prisma.orderStatusLink.findUniqueOrThrow({ where: { id: made.id } });
    expect(row.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.expiresAt!.getTime() - Date.now()).toBeGreaterThan(29 * 86_400_000);
    const audit = await prisma.auditLog.findMany({ where: { entityType: "OrderStatusLink" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe("CREATE");
    expect(audit[0]!.userId).toBe(owner.user.id);
    expect(audit[0]!.summary).toContain("SO-A-0001");
    expect(JSON.stringify(audit)).not.toContain(token);

    const listed = await links.listStatusLinks(owner, a.order.id);
    expect(listed).toEqual([
      expect.objectContaining({
        id: made.id,
        state: "ACTIVE",
        madeBy: "owner",
        endsOn: made.endsOn,
      }),
    ]);
    expect(JSON.stringify(listed)).not.toContain(token);
    // Until stopped, when no days are chosen.
    const forever = await links.makeStatusLink(owner, a.order.id, {});
    expect(forever.endsOn).toBeNull();
    expect((await appError(links.makeStatusLink(owner, a.order.id, { days: 5 }))).code).toBe(
      "VALIDATION",
    );
  });

  it("shows the buyer the order's progress, and nothing about money, factories or other orders", async () => {
    const { path } = await links.makeStatusLink(owner, a.order.id, { days: 7 });
    const view = (await links.readOrderStatus(tokenOf(path)))!;
    expect(view).not.toBeNull();
    expect(view.company).toEqual({ name: "Extas Status", logo: null });
    expect(view.order).toEqual({
      number: "SO-A-0001",
      status: "Confirmed",
      orderedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      pieces: 100,
      plannedShipOn: "2026-12-20",
      shippedOn: "2026-11-10",
      shipped: 10,
    });
    expect(view.styles).toEqual([
      {
        code: "NP-A",
        name: "Nordic polo",
        pieces: 100,
        production: {
          target: 100,
          stage: "Sewing",
          cutting: { state: "IN_PROGRESS", pieces: 60, percent: 60 },
          sewing: { state: "IN_PROGRESS", pieces: null, percent: null },
          finishing: { state: "IN_PROGRESS", pieces: 40, percent: 40 },
          packing: { state: "IN_PROGRESS", pieces: 35, percent: 35 },
        },
      },
    ]);
    const text = JSON.stringify(view);
    for (const secret of [
      UNIT_PRICE,
      ORDER_TOTAL,
      "432109",
      CM_RATE,
      COST,
      FACTORY,
      BUYER,
      "SO-A-0002",
      "PP-A-0001",
      "SO-B-0001",
      "Other House",
    ]) {
      expect(text, secret).not.toContain(secret);
    }
    for (const key of [
      "price",
      "total",
      "cost",
      "amount",
      "factory",
      "supplier",
      "buyer",
      "profit",
    ]) {
      expect(text.toLowerCase(), key).not.toContain(`"${key}`);
    }
  });

  it("answers not found for a stopped, ended, wrong or malformed link", async () => {
    const live = await links.makeStatusLink(owner, a.order.id, { days: 7 });
    const ended = await links.makeStatusLink(owner, a.order.id, { days: 7 });
    await prisma.orderStatusLink.update({
      where: { id: ended.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await links.readOrderStatus(tokenOf(live.path))).not.toBeNull();
    expect(await links.readOrderStatus(tokenOf(ended.path))).toBeNull();
    expect(await links.readOrderStatus("A".repeat(43))).toBeNull();
    expect(await links.readOrderStatus("../../etc")).toBeNull();
    expect(await links.readOrderStatus("")).toBeNull();

    const stopped = await links.stopStatusLink(owner, live.id);
    expect(stopped.stopped).toBe(true);
    expect(await links.readOrderStatus(tokenOf(live.path))).toBeNull();
    // Stopping twice changes nothing and logs once.
    expect((await links.stopStatusLink(owner, live.id)).stopped).toBe(false);
    const audit = await prisma.auditLog.findMany({
      where: { entityType: "OrderStatusLink", action: "STATUS_CHANGE" },
    });
    expect(audit).toHaveLength(1);
    const listed = await links.listStatusLinks(owner, a.order.id);
    expect(listed.map((l) => [l.id, l.state])).toEqual(
      expect.arrayContaining([
        [live.id, "STOPPED"],
        [ended.id, "ENDED"],
      ]),
    );

    // The page itself: 404 for each, the progress for a working link.
    for (const token of [tokenOf(live.path), tokenOf(ended.path), "nope"]) {
      await expect(OrderStatusPage({ params: Promise.resolve({ token }) })).rejects.toMatchObject({
        digest: "NEXT_HTTP_ERROR_FALLBACK;404",
      });
    }
    const working = await links.makeStatusLink(owner, a.order.id, {});
    const page = await OrderStatusPage({
      params: Promise.resolve({ token: tokenOf(working.path) }),
    });
    expect(page).toBeTruthy();
  });

  it("reads only its own company's order, and only the owner's company may manage its links", async () => {
    const { path, id } = await links.makeStatusLink(owner, a.order.id, {});
    // A link row naming another company never opens this company's order.
    const forged = "F".repeat(43);
    await prisma.orderStatusLink.create({
      data: {
        companyId: companyB,
        orderId: a.order.id,
        tokenHash: createHash("sha256").update(forged).digest("hex"),
      },
    });
    expect(await links.readOrderStatus(forged)).toBeNull();
    expect((await links.readOrderStatus(tokenOf(path)))!.order.number).toBe("SO-A-0001");

    // The other company cannot see, make or stop this company's links.
    expect((await appError(links.listStatusLinks(ownerB, a.order.id))).code).toBe("NOT_FOUND");
    expect((await appError(links.makeStatusLink(ownerB, a.order.id, {}))).code).toBe("NOT_FOUND");
    expect((await appError(links.stopStatusLink(ownerB, id))).code).toBe("NOT_FOUND");
    expect(await links.readOrderStatus(tokenOf(path))).not.toBeNull();
    // ...and its own order's link shows its own order only.
    const theirs = await links.makeStatusLink(ownerB, b.order.id, {});
    expect((await links.readOrderStatus(tokenOf(theirs.path)))!.order.number).toBe("SO-B-0001");
  });

  it("needs sales.order.share (the owner's by default), and refuses a cancelled order", async () => {
    expect(DEFAULT_ROLE_PERMISSIONS.SALES_EXECUTIVE).not.toContain("sales.order.share");
    expect(links.canShareOrderStatus(owner)).toBe(true);
    expect(links.canShareOrderStatus(sales)).toBe(false);
    const { id } = await links.makeStatusLink(owner, a.order.id, {});
    for (const attempt of [
      links.makeStatusLink(sales, a.order.id, {}),
      links.listStatusLinks(sales, a.order.id),
      links.stopStatusLink(sales, id),
    ]) {
      expect((await appError(attempt)).code).toBe("FORBIDDEN");
    }
    // Given the right (with sales.view), a sales person may share.
    const allowed = {
      ...sales,
      can: (k: string) => k === "sales.order.share" || sales.can(k as never),
    };
    expect(
      (await links.makeStatusLink(allowed as CompanyContext, a.order.id, {})).path,
    ).toBeTruthy();

    await prisma.salesOrder.update({ where: { id: a.order.id }, data: { status: "CANCELLED" } });
    expect((await appError(links.makeStatusLink(owner, a.order.id, {}))).code).toBe("CONFLICT");
  });
});
