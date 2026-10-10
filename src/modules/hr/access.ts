import type { Employee } from "@prisma/client";

import { AppError } from "@/lib/errors";
import type { CompanyContext } from "@/modules/auth/context";

/*
 * Who sees and changes what in HR:
 *   hr.view             profiles, attendance, leave and holidays (no salaries)
 *   hr.manage           employees and salaries, attendance, leave approval, rules
 *   hr.payroll          prepares payroll; sees salaries, payslips and advances
 *   hr.payroll.approve  approves or reopens payroll (posts it to the books)
 *   accounts.*          money: advances, salary payments (see money-guards)
 *   portal.self         an employee's own records only
 * Services re-check writes; routes check reads (the repo convention).
 */

/** Salaries, bank details, payslips and advances. */
export function canSeeSalaries(ctx: Pick<CompanyContext, "can">): boolean {
  return ctx.can("hr.manage") || ctx.can("hr.payroll") || ctx.can("accounts.view");
}

export function assertCanSeeSalaries(ctx: CompanyContext) {
  if (!canSeeSalaries(ctx)) {
    throw new AppError("FORBIDDEN", "You do not have permission to see salaries.");
  }
}

export function assertCanManageHr(ctx: CompanyContext, message?: string) {
  if (!ctx.can("hr.manage")) {
    throw new AppError("FORBIDDEN", message ?? "Only HR can do this.");
  }
}

export function assertCanRunPayroll(ctx: CompanyContext) {
  if (!ctx.can("hr.payroll")) {
    throw new AppError("FORBIDDEN", "You do not have permission to prepare payroll.");
  }
}

export function assertCanApprovePayroll(ctx: CompanyContext) {
  if (!ctx.can("hr.payroll.approve")) {
    throw new AppError("FORBIDDEN", "You do not have permission to approve payroll.");
  }
}

/** The company's Super Admin (or the platform owner). */
export function isCompanyOwner(ctx: CompanyContext): boolean {
  return ctx.user.isSuperAdmin || ctx.role?.systemRole === "SUPER_ADMIN";
}

/** The signed-in person, for the rules about one's own record (hr/rules.ts). */
export function actingAs(ctx: CompanyContext) {
  return { userId: ctx.user.id, isOwner: isCompanyOwner(ctx), manage: ctx.can("hr.manage") };
}

/** Nobody approves their own leave or changes their own salary, except a Super Admin. */
export function assertNotOwnRecord(
  ctx: CompanyContext,
  employee: Pick<Employee, "userId">,
  message: string,
) {
  if (employee.userId === ctx.user.id && !isCompanyOwner(ctx)) {
    throw new AppError("FORBIDDEN", message);
  }
}

/** The employee profile linked to the signed-in user in this company, if any. */
export async function linkedEmployee(ctx: CompanyContext): Promise<Employee | null> {
  return ctx.db.employee.findFirst({ where: { userId: ctx.user.id } });
}

export async function requireLinkedEmployee(ctx: CompanyContext): Promise<Employee> {
  const employee = await linkedEmployee(ctx);
  if (!employee) {
    throw new AppError(
      "NOT_FOUND",
      "Your login is not linked to an employee profile in this company yet. Ask HR to link it.",
    );
  }
  return employee;
}
