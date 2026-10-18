import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/tenant-db";
import * as bank from "@/modules/accounts/bank.service";
import { paySupplier } from "@/modules/accounts/supplier-payment.service";
import type { CompanyContext } from "@/modules/auth/context";
import { createSession, revokeSession, validateSessionToken } from "@/modules/auth/session.service";
import { resolveCompanyAccess } from "@/modules/companies/access";
import * as parties from "@/modules/parties/party.service";
import * as costs from "@/modules/production/cost.service";
import * as projects from "@/modules/production/project.service";

import { POLO_BATCH, runFiveStylePolo, type SimulationManifest } from "./five-style-polo";
import { loadTestBookings } from "./test-bookings";
import { loadV62Samples } from "./v62-samples";
import { loadV63Samples } from "./v63-samples";
import { loadV64TechPack } from "./v64-tech-pack";
import { loadV641Samples } from "./v641-samples";

/*
 * The demo site's sample data (deploy/compose.yml, the demo services; deploy/README.md,
 * "The demo site"). On the demo's own database, the company gets a CM factory with
 * last season's part-paid CM bill, a fabric mill and a bank account, then the Five
 * Style Polo batch runs through every step, with the same figures as the GitHub run
 * and the screenshots. It never runs on any other database.
 */

/** The demo site's database (deploy/compose.yml, "demo-db"). */
export const DEMO_DATABASE = "extras_demo";

/** Stops unless DEMO_SITE is on and this is the demo site's own database. */
export async function assertDemoDatabase() {
  const [row] = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  if (process.env.DEMO_SITE !== "on" || row?.name !== DEMO_DATABASE) {
    throw new Error(
      `The demo data only goes into the demo site's own database (${DEMO_DATABASE}, with DEMO_SITE=on); this is ${row?.name ?? "an unknown database"}. Nothing was loaded.`,
    );
  }
}

/** Signs `userId` in to the company for the run; `done` signs out again. */
async function signIn(userId: string, companyId: string) {
  const { token } = await createSession(userId, companyId);
  const current = (await validateSessionToken(token))!;
  const access = await resolveCompanyAccess(current.user, companyId);
  if (!access) throw new Error("The owner is not a member of the demo company.");
  const ctx: CompanyContext = {
    ...current,
    ...access,
    db: tenantDb(companyId),
    can: (p) => access.permissions.has(p),
  };
  return { ctx, done: () => revokeSession(current.session.id) };
}

async function supplier(ctx: CompanyContext, name: string, category: "CM" | "FABRIC") {
  const found = await prisma.party.findFirst({
    where: { companyId: ctx.company.id, kind: "SUPPLIER", name },
    select: { id: true },
  });
  if (found) return { id: found.id, added: false };
  const { party } = await parties.createParty(ctx, {
    kind: "SUPPLIER",
    name,
    supplierCategories: [category],
  });
  return { id: party.id, added: true };
}

/** The factory (with last season's tee: a 50,000 CM bill, 20,000 paid), the mill and a bank account. */
async function prepareCompany(ctx: CompanyContext) {
  const companyId = ctx.company.id;
  if (!(await prisma.bankAccount.findFirst({ where: { companyId, isActive: true } }))) {
    await bank.createBankAccount(ctx, {
      bankName: "Dutch-Bangla Bank",
      accountName: ctx.company.name,
      accountNumber: "1101100045678",
    });
  }
  const factory = await supplier(ctx, "Gazipur Knit Composite", "CM");
  await supplier(ctx, "Noman Textile Mills", "FABRIC");
  if (!factory.added) return;
  const tee = await projects.createProject(ctx, {
    name: "Last season tee",
    factoryId: factory.id,
    startDate: "2026-07-01",
    targetDate: "2026-08-30",
    targetQuantity: 500,
  });
  await costs.ensureProductionCostHeads(companyId);
  const sewing = await prisma.expenseHead.findFirstOrThrow({
    where: { companyId, name: "Sewing (CM)" },
  });
  await costs.addProjectCost(ctx, tee.id, {
    expenseHeadId: sewing.id,
    amount: 50_000,
    paymentType: "DUE",
    supplierId: factory.id,
    date: "2026-08-01",
  });
  await paySupplier(ctx, { supplierId: factory.id, amount: 20_000, method: "CASH" });
}

/**
 * Loads the Five Style Polo batch into the company as `userId` (its Super Admin).
 * Once: when the batch is there already it does nothing and returns null.
 */
export async function loadFiveStylePoloDemo(
  userId: string,
  companyId: string,
): Promise<SimulationManifest | null> {
  if (await prisma.productionBatch.findFirst({ where: { companyId, name: POLO_BATCH } })) {
    return null;
  }
  const { ctx, done } = await signIn(userId, companyId);
  try {
    await prepareCompany(ctx);
    return await runFiveStylePolo(ctx, { seed: 2026 });
  } finally {
    await done();
  }
}

/** The four test bookings (./test-bookings.ts), made once as the owner, with their numbers. */
export async function loadTestBookingsDemo(userId: string, companyId: string) {
  const { ctx, done } = await signIn(userId, companyId);
  try {
    return await loadTestBookings(ctx);
  } finally {
    await done();
  }
}

/** The v6.2 sample order for Mehedi 2.0 (./v62-samples.ts), made once as the owner. */
export async function loadV62SamplesDemo(userId: string, companyId: string) {
  const { ctx, done } = await signIn(userId, companyId);
  try {
    return await loadV62Samples(ctx);
  } finally {
    await done();
  }
}

/** The v6.3 sample skill for the fabric expert (./v63-samples.ts), taught once as the owner. */
export async function loadV63SamplesDemo(userId: string, companyId: string) {
  const { ctx, done } = await signIn(userId, companyId);
  try {
    return await loadV63Samples(ctx);
  } finally {
    await done();
  }
}

/** The v6.4 sample tech pack from a buyer's brief (./v64-tech-pack.ts), made once as the owner. */
export async function loadV64TechPackDemo(userId: string, companyId: string) {
  const { ctx, done } = await signIn(userId, companyId);
  try {
    return await loadV64TechPack(ctx);
  } finally {
    await done();
  }
}

/**
 * The v6.4.1 samples (./v641-samples.ts): wholesale orders, employees, an invoice
 * pad template and a fire licence, each made once as the owner.
 */
export async function loadV641SamplesDemo(userId: string, companyId: string) {
  const { ctx, done } = await signIn(userId, companyId);
  try {
    return await loadV641Samples(ctx);
  } finally {
    await done();
  }
}
