import { hashPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/prisma";
import { resetRateLimits } from "@/lib/rate-limit";
import { tenantDb } from "@/lib/tenant-db";
import type { CompanyContext } from "@/modules/auth/context";
import { createSession, validateSessionToken } from "@/modules/auth/session.service";
import { resolveCompanyAccess } from "@/modules/companies/access";
import { ensureSystemRoles, syncPermissionCatalog } from "@/modules/rbac/role.service";

export const PASSWORD = "Extras2026";

/** Clears every table touched by these tests (child tables first). */
export async function resetDb() {
  resetRateLimits();
  await prisma.auditLog.deleteMany();
  await prisma.refund.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.rawMaterialMovement.deleteMany();
  await prisma.purchaseReturn.deleteMany();
  await prisma.materialIssue.deleteMany();
  await prisma.salesOrder.deleteMany();
  await prisma.stockIntake.deleteMany();
  await prisma.supplierBill.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.rawMaterialStock.deleteMany();
  await prisma.rawMaterial.deleteMany();
  await prisma.advanceSettlement.deleteMany();
  await prisma.payrollItem.deleteMany();
  await prisma.payrollPayment.deleteMany();
  await prisma.payrollRun.deleteMany();
  await prisma.salaryAdvance.deleteMany();
  await prisma.attendance.deleteMany();
  await prisma.leaveRequest.deleteMany();
  await prisma.leaveBalance.deleteMany();
  await prisma.leaveType.deleteMany();
  await prisma.holiday.deleteMany();
  await prisma.hrSettings.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.salaryRevision.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.expenseHead.deleteMany();
  await prisma.productionProject.deleteMany();
  await prisma.proformaInvoice.deleteMany();
  await prisma.quotation.deleteMany();
  await prisma.customFieldDefinition.deleteMany();
  await prisma.campaignRecipient.deleteMany();
  await prisma.reEngagementCampaign.deleteMany();
  await prisma.capitalInstallment.deleteMany();
  await prisma.capitalSource.deleteMany();
  await prisma.fixedAsset.deleteMany();
  await prisma.bankAccount.deleteMany();
  await prisma.journalLine.deleteMany();
  await prisma.journalEntry.deleteMany();
  await prisma.ledgerAccount.deleteMany();
  await prisma.party.deleteMany();
  await prisma.documentSequence.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.badStockEntry.deleteMany();
  await prisma.stockBalance.deleteMany();
  await prisma.sizeRatioPreset.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.style.deleteMany();
  await prisma.category.deleteMany();
  await prisma.color.deleteMany();
  await prisma.size.deleteMany();
  await prisma.warehouse.deleteMany();
  await prisma.backupRun.deleteMany();
  await prisma.backupConfig.deleteMany();
  await prisma.session.deleteMany();
  await prisma.companyMembership.deleteMany();
  await prisma.rolePermission.deleteMany();
  await prisma.role.deleteMany();
  await prisma.brand.deleteMany();
  await prisma.fileAsset.deleteMany();
  await prisma.company.deleteMany();
  await prisma.user.deleteMany();
  await syncPermissionCatalog();
}

export async function makeCompany(name: string) {
  const company = await prisma.company.create({
    data: { name, slug: name.toLowerCase().replace(/\s+/g, "-") },
  });
  const roles = await ensureSystemRoles(company.id);
  return { company, roles };
}

export async function makeUser(email: string, opts: { isSuperAdmin?: boolean } = {}) {
  return prisma.user.create({
    data: {
      email,
      name: email.split("@")[0]!,
      passwordHash: await hashPassword(PASSWORD),
      isSuperAdmin: opts.isSuperAdmin ?? false,
    },
  });
}

export async function addToCompany(userId: string, companyId: string, roleId: string) {
  return prisma.companyMembership.create({ data: { userId, companyId, roleId } });
}

/** Builds the same CompanyContext that `requireCompany()` builds from a cookie. */
export async function contextFor(userId: string, companyId: string): Promise<CompanyContext> {
  const { token } = await createSession(userId, companyId);
  const current = (await validateSessionToken(token))!;
  const access = (await resolveCompanyAccess(current.user, companyId))!;
  return {
    ...current,
    ...access,
    db: tenantDb(companyId),
    can: (p) => access.permissions.has(p),
  };
}
