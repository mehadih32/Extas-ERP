import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

/*
 * The demo site's sample data (prisma/demo/load-demo.ts): it goes only into the
 * demo's own database, and loads the Five Style Polo batch once, on a company as
 * prisma/seed.ts leaves it, with the same figures as the GitHub run, the v6.2
 * sample order for Mehedi 2.0 once, waiting for the owner's Approve, the v6.3
 * sample skill for the fabric expert once, waiting for its test, and the v6.4
 * sample tech pack from a buyer's brief once, not linked to a project, and the
 * v6.4.1 samples once: a record for each page a Help guide pictures.
 */
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

import { prisma } from "@/lib/prisma";
import { getPartyBalance } from "@/modules/parties/ledger.service";
import { getBatchSummary } from "@/modules/production/batch-summary.service";
import { getRun } from "@/modules/ai/orders/order-run.service";
import { getSkill } from "@/modules/ai/skills.service";
import { getCosting } from "@/modules/costing/costing.service";
import { listTechPacks } from "@/modules/production/tech-pack-register.service";
import { getTechPackScreen } from "@/modules/production/tech-pack-screen.service";
import { getCompliance } from "@/modules/compliance/compliance.service";
import { getSystemAccess } from "@/modules/hr/login.service";
import { getOrderScreen } from "@/modules/sales/screens.service";
import { getTemplate } from "@/modules/templates/template.service";

import {
  assertDemoDatabase,
  loadFiveStylePoloDemo,
  loadV62SamplesDemo,
  loadV63SamplesDemo,
  loadV64TechPackDemo,
  loadV641SamplesDemo,
} from "../../prisma/demo/load-demo";
import { V63_SAMPLE_SKILL } from "../../prisma/demo/v63-samples";
import { V64_SAMPLE_TECH_PACK } from "../../prisma/demo/v64-tech-pack";
import {
  V641_SAMPLE_EMPLOYEES,
  V641_SAMPLE_LICENCE,
  V641_SAMPLE_LOGIN,
  V641_SAMPLE_ORDERS,
  V641_SAMPLE_TEMPLATE,
} from "../../prisma/demo/v641-samples";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

run("The demo site's sample data", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("goes only into the demo site's own database", async () => {
    await expect(assertDemoDatabase()).rejects.toThrow(/Nothing was loaded/);
    // DEMO_SITE on is not enough: this is the test database, not extras_demo.
    vi.stubEnv("DEMO_SITE", "on");
    await expect(assertDemoDatabase()).rejects.toThrow(/Nothing was loaded/);
  });

  it("loads the Five Style Polo batch once, with its factory, mill and bank account", async () => {
    const { company, roles } = await makeCompany("Extas");
    const owner = await makeUser("owner@extras.test", { isSuperAdmin: true });
    await addToCompany(owner.id, company.id, roles.SUPER_ADMIN);

    const loaded = await loadFiveStylePoloDemo(owner.id, company.id);
    expect(loaded?.batchCode).toMatch(/^MB-/);
    expect(loaded?.error).toBeNull();
    expect(loaded?.factory?.name).toBe("Gazipur Knit Composite");
    expect(loaded?.mill?.name).toBe("Noman Textile Mills");
    expect(loaded?.added.embo?.name).toBe("Demo Embo");
    // The run signed itself out again.
    expect(await prisma.session.count({ where: { userId: owner.id } })).toBe(0);

    const ctx = await contextFor(owner.id, company.id);
    const s = await getBatchSummary(ctx, loaded!.batchId!);
    expect(s.pieces).toMatchObject({ target: 6000, cut: 6119, good: 5945, missing: 12 });
    expect(s.penalties.cm.totals.payable).toBe("345765.93");
    // Last season's 30,000 still owed, plus this batch's CM bills, less the advance and deductions.
    const due = (await getPartyBalance(ctx, loaded!.factory!.id)).neg().toFixed(2);
    expect(due).toBe("375765.93");
    expect(await prisma.bankAccount.count({ where: { companyId: company.id } })).toBe(1);

    // Once: the second time it finds the batch and adds nothing.
    expect(await loadFiveStylePoloDemo(owner.id, company.id)).toBeNull();
    expect(await prisma.productionBatch.count({ where: { companyId: company.id } })).toBe(1);
    expect(await prisma.party.count({ where: { companyId: company.id } })).toBe(5);
  }, 120_000);

  it("loads the v6.2 sample order once, with its costing sheet and plan, the AI left off", async () => {
    const { company, roles } = await makeCompany("Extas");
    const owner = await makeUser("owner@extras.test", { isSuperAdmin: true });
    await addToCompany(owner.id, company.id, roles.SUPER_ADMIN);

    const loaded = await loadV62SamplesDemo(owner.id, company.id);
    expect(loaded?.order).toMatch(/^AO-\d{4}-00001$/);
    expect(loaded?.costing).toMatch(/^CST-\d{4}-00001$/);
    expect(await prisma.session.count({ where: { userId: owner.id } })).toBe(0);

    const ctx = await contextFor(owner.id, company.id);
    const run = await prisma.aiOrderRun.findFirstOrThrow({ where: { companyId: company.id } });
    const screen = await getRun(ctx, run.id);
    expect(screen).toMatchObject({ status: "WAITING_OWNER", mode: "DRY_RUN", planByAi: false });
    expect(screen.missing).toEqual([]);
    expect(screen.checks.find((c) => c.key === "totals")?.signal).toBe("green");
    expect(screen.plan).toContain("Dry run 1 of 5");
    expect(screen.card?.map((r) => r.key)).toEqual([
      "price",
      "time",
      "factory",
      "payment",
      "risks",
    ]);

    const sheet = await getCosting(ctx, run.costingId!);
    expect(Number(sheet.profitPercent)).toBe(10);
    expect(sheet.styles.map((s) => [s.styleRef, s.quantity, s.cmAmount, s.quote?.unit])).toEqual([
      ["NW-PL-01", 3000, 1.25, "KG"],
      ["NW-PL-02", 1500, 1.1, "KG"],
    ]);
    expect(sheet.styles.every((s) => s.fabricPrice === 3.6)).toBe(true);
    expect(sheet.card.find((r) => r.key === "factory")?.signal).toBe("green");
    expect(
      await prisma.aiSettings.findFirst({ where: { companyId: company.id, enabled: true } }),
    ).toBeNull();

    // Once: the second time it adds nothing.
    expect(await loadV62SamplesDemo(owner.id, company.id)).toBeNull();
    expect(await prisma.aiOrderRun.count({ where: { companyId: company.id } })).toBe(1);
    expect(await prisma.fabricQuote.count({ where: { companyId: company.id } })).toBe(1);
  }, 120_000);

  it("teaches the fabric expert the v6.3 sample skill once, waiting for its test", async () => {
    const { company, roles } = await makeCompany("Extas");
    const owner = await makeUser("owner@extras.test", { isSuperAdmin: true });
    await addToCompany(owner.id, company.id, roles.SUPER_ADMIN);

    const loaded = await loadV63SamplesDemo(owner.id, company.id);
    expect(loaded?.name).toBe(V63_SAMPLE_SKILL);
    expect(await prisma.session.count({ where: { userId: owner.id } })).toBe(0);

    const ctx = await contextFor(owner.id, company.id);
    const skill = await getSkill(ctx, loaded!.id);
    expect(skill).toMatchObject({
      agent: "X05",
      agentName: "X05 Textile Engineer: Fabric",
      on: true,
    });
    expect(skill.newest).toMatchObject({ version: 1, name: V63_SAMPLE_SKILL });
    expect(skill.newest.examples).toHaveLength(2);
    expect(skill.newest.test).toMatchObject({ standing: "UNTESTED", text: "Not tested" });

    // Once: the second time it adds nothing.
    expect(await loadV63SamplesDemo(owner.id, company.id)).toBeNull();
    expect(await prisma.aiSkill.count({ where: { companyId: company.id } })).toBe(1);
  });

  it("starts the v6.4 sample tech pack from a buyer's brief once, not linked to a project", async () => {
    const { company, roles } = await makeCompany("Extas");
    const owner = await makeUser("owner@extras.test", { isSuperAdmin: true });
    await addToCompany(owner.id, company.id, roles.SUPER_ADMIN);

    const loaded = await loadV64TechPackDemo(owner.id, company.id);
    expect(loaded?.number).toBe(`TP-${new Date().getFullYear()}-00001`);
    expect(await prisma.session.count({ where: { userId: owner.id } })).toBe(0);

    const ctx = await contextFor(owner.id, company.id);
    const list = await listTechPacks(ctx, {});
    expect(list.rows).toEqual([
      expect.objectContaining({
        id: loaded!.id,
        title: V64_SAMPLE_TECH_PACK,
        buyer: "Nordic Wear AB",
        season: "SS27",
        status: "DRAFT",
        project: null,
      }),
    ]);
    const screen = await getTechPackScreen(ctx, loaded!.id);
    expect(screen.techPack.brief).toMatch(/pique 220 GSM/);
    expect(screen.chart.sizes).toEqual(["S", "M", "L", "XL", "2XL"]);
    expect(screen.instructions.Packing).toMatch(/polybag/);
    expect(screen.approval.needsProject).toBe(true);

    // Once: the second time it adds nothing.
    expect(await loadV64TechPackDemo(owner.id, company.id)).toBeNull();
    expect(await prisma.techPack.count({ where: { companyId: company.id } })).toBe(1);
  });

  it("adds the v6.4.1 samples once: a record for each page a Help guide pictures", async () => {
    // The invoice pad's file goes into a folder of its own, removed at the end.
    const uploads = await mkdtemp(path.join(os.tmpdir(), "extras-demo-"));
    vi.stubEnv("UPLOAD_DIR", uploads);
    onTestFinished(() => rm(uploads, { recursive: true, force: true }));
    const { company, roles } = await makeCompany("Extas");
    const owner = await makeUser("owner@extras.test", { isSuperAdmin: true });
    await addToCompany(owner.id, company.id, roles.SUPER_ADMIN);

    const loaded = await loadV641SamplesDemo(owner.id, company.id);
    expect(loaded.orders).toHaveLength(3);
    expect(loaded.employees).toEqual([
      V641_SAMPLE_EMPLOYEES.withLogin,
      V641_SAMPLE_EMPLOYEES.withoutLogin,
    ]);
    expect(loaded).toMatchObject({
      template: V641_SAMPLE_TEMPLATE,
      licence: V641_SAMPLE_LICENCE,
    });
    expect(await prisma.session.count({ where: { userId: owner.id } })).toBe(0);
    const ctx = await contextFor(owner.id, company.id);

    // Sales: the money went through the books, and they balance.
    const order = async (notes: string) =>
      getOrderScreen(
        ctx,
        (await prisma.salesOrder.findFirstOrThrow({ where: { companyId: company.id, notes } })).id,
      );
    const paidPart = await order(V641_SAMPLE_ORDERS.previousDue);
    expect(paidPart.order).toMatchObject({ total: "105000.00", paid: "40000.00", due: "65000.00" });
    expect(paidPart.order.invoice?.status).toBe("PARTIALLY_PAID");
    const open = await order(V641_SAMPLE_ORDERS.open);
    expect(open.order.invoice).toBeNull();
    expect(open.order.total).toBe("90000.00");
    expect(open.can).toMatchObject({ edit: true, issueInvoice: true, cancel: true });
    // Its invoice can carry the buyer's previous due.
    expect(open.buyerMoney?.previousDue).toBe("65000.00");
    const revise = await order(V641_SAMPLE_ORDERS.revise);
    expect(revise.order).toMatchObject({ total: "126000.00", paid: "50000.00", due: "76000.00" });
    expect(revise.can).toMatchObject({ edit: true, voidInvoice: true });
    const balance = async (name: string) => {
      const party = await prisma.party.findFirstOrThrow({
        where: { companyId: company.id, kind: "BUYER", name },
      });
      return (await getPartyBalance(ctx, party.id)).toFixed(2);
    };
    expect(await balance("Dhaka Fashion House")).toBe("65000.00");
    expect(await balance("Chattogram Style Mart")).toBe("76000.00");
    const unbalanced = await prisma.$queryRaw<Array<{ number: string }>>`
      SELECT je.number FROM "JournalEntry" je JOIN "JournalLine" jl ON jl."entryId" = je.id
      WHERE je."companyId" = ${company.id}
      GROUP BY je.id HAVING SUM(jl.debit) <> SUM(jl.credit)`;
    expect(unbalanced).toEqual([]);

    // HR: one employee signs in as an Employee, the other has no login yet.
    const employee = async (name: string) => {
      const row = await prisma.employee.findFirstOrThrow({
        where: { companyId: company.id, name },
      });
      return { id: row.id, name: row.name, userId: row.userId, exitDate: null };
    };
    const merchandiser = await employee(V641_SAMPLE_EMPLOYEES.withLogin);
    const withLogin = await getSystemAccess(ctx, merchandiser);
    expect(withLogin?.login).toMatchObject({ email: V641_SAMPLE_LOGIN });
    const inspector = await employee(V641_SAMPLE_EMPLOYEES.withoutLogin);
    expect(inspector.userId).toBeNull();
    expect((await getSystemAccess(ctx, inspector))?.login).toBeNull();

    // The invoice pad with its tags placed, and the licence due for renewal.
    const template = await prisma.documentTemplate.findFirstOrThrow({
      where: { companyId: company.id, name: V641_SAMPLE_TEMPLATE },
    });
    const pad = await getTemplate(ctx, template.id);
    expect(pad).toMatchObject({ format: "PDF", documentType: "COMMERCIAL_INVOICE" });
    expect(pad.placeholders.map((p) => p.tag)).toContain("{InvoiceNo}");
    const licence = await prisma.complianceDocument.findFirstOrThrow({
      where: { companyId: company.id, title: V641_SAMPLE_LICENCE, supersededAt: null },
    });
    const screen = await getCompliance(ctx, licence.id);
    expect(screen).toMatchObject({ status: "EXPIRING", daysLeft: 40 });
    expect(screen.history).toHaveLength(1);

    // Once: the second time it adds nothing.
    expect(await loadV641SamplesDemo(owner.id, company.id)).toEqual({
      orders: [],
      employees: [],
      template: null,
      licence: null,
    });
    expect(await prisma.salesOrder.count({ where: { companyId: company.id } })).toBe(3);
    expect(await prisma.employee.count({ where: { companyId: company.id } })).toBe(2);
    expect(await prisma.documentTemplate.count({ where: { companyId: company.id } })).toBe(1);
    expect(await prisma.complianceDocument.count({ where: { companyId: company.id } })).toBe(2);
    expect(await prisma.stockMovement.count({ where: { companyId: company.id } })).toBe(6);
  }, 120_000);
});
