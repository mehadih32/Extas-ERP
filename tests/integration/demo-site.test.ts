import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The demo site's sample data (prisma/demo/load-demo.ts): it goes only into the
 * demo's own database, and loads the Five Style Polo batch once, on a company as
 * prisma/seed.ts leaves it, with the same figures as the GitHub run, the v6.2
 * sample order for Mehedi 2.0 once, waiting for the owner's Approve, the v6.3
 * sample skill for the fabric expert once, waiting for its test, and the v6.4
 * sample tech pack from a buyer's brief once, not linked to a project.
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

import {
  assertDemoDatabase,
  loadFiveStylePoloDemo,
  loadV62SamplesDemo,
  loadV63SamplesDemo,
  loadV64TechPackDemo,
} from "../../prisma/demo/load-demo";
import { V63_SAMPLE_SKILL } from "../../prisma/demo/v63-samples";
import { V64_SAMPLE_TECH_PACK } from "../../prisma/demo/v64-tech-pack";

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
});
