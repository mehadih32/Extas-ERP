import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The demo site's sample data (prisma/demo/load-demo.ts): it goes only into the
 * demo's own database, and loads the Five Style Polo batch once, on a company as
 * prisma/seed.ts leaves it, with the same figures as the GitHub run.
 */
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

import { prisma } from "@/lib/prisma";
import { getPartyBalance } from "@/modules/parties/ledger.service";
import { getBatchSummary } from "@/modules/production/batch-summary.service";
import { assertDemoDatabase, loadFiveStylePoloDemo } from "../../prisma/demo/load-demo";

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
});
