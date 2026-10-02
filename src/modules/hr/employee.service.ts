import type { Prisma } from "@prisma/client";

import { dateColumn, dateOnly, dayRange, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { money, ZERO } from "@/modules/accounts/balances";
import { CONTROL_ACCOUNTS } from "@/modules/accounts/control-accounts";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import {
  assertCanManageHr,
  assertCanSeeSalaries,
  assertNotOwnRecord,
  canSeeSalaries,
} from "@/modules/hr/access";
import { employeeMonth } from "@/modules/hr/attendance.service";
import { monthKey, monthLabel } from "@/modules/hr/calendar";
import { balancesFor, syncLeaveBalanceTx } from "@/modules/hr/leave.service";
import { salaryOn } from "@/modules/hr/payroll-calc";
import { assertOpenFrom } from "@/modules/hr/period-lock";
import {
  createEmployeeSchema,
  directorySchema,
  exitEmployeeSchema,
  listEmployeesSchema,
  portalAccessSchema,
  salaryRevisionSchema,
  statementSchema,
  updateEmployeeSchema,
} from "@/modules/hr/schemas";
import { ensureHrSetup } from "@/modules/hr/setup";
import { addMember, setMemberActive } from "@/modules/rbac/member.service";

/*
 * Employee profiles (the "360" view), salary history, joining and leaving,
 * and portal logins. Salaries, bank details, advances and payslips are only
 * shown to HR managers, payroll and Accounts (see access.ts); hr.view sees the
 * rest. A salary change is a revision from a day onwards, so past months keep
 * the salary they were paid at.
 */

type Tx = Prisma.TransactionClient;
const TX_OPTIONS = { timeout: 30_000 };

export const employeeInclude = {
  user: { select: { id: true, email: true, name: true, status: true } },
  salaryHistory: {
    orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }],
  },
} satisfies Prisma.EmployeeInclude;

export type EmployeeRow = Prisma.EmployeeGetPayload<{ include: typeof employeeInclude }>;

const today = (ctx: CompanyContext) => localDay(new Date(), ctx.company.timezone);

/** Salary in force today and any raise already entered for later. */
export function salaryNow(e: EmployeeRow, day: string) {
  const points = e.salaryHistory.map((r) => ({
    effectiveFrom: dateOnly(r.effectiveFrom),
    amount: r.amount,
  }));
  const upcoming = points.filter((p) => p.effectiveFrom > day).at(-1);
  return {
    current: salaryOn(points, day, e.baseSalary),
    upcoming: upcoming
      ? { amount: upcoming.amount.toFixed(2), from: upcoming.effectiveFrom }
      : null,
  };
}

/** What anyone who may see the employee list sees. */
function profileOf(e: EmployeeRow, day: string) {
  return {
    id: e.id,
    code: e.code,
    name: e.name,
    designation: e.designation,
    department: e.department,
    phone: e.phone,
    whatsapp: e.whatsapp,
    email: e.email,
    nid: e.nid,
    address: e.address,
    photoUrl: e.photoUrl,
    dateOfBirth: dateOnly(e.dateOfBirth),
    bloodGroup: e.bloodGroup,
    emergencyContact: e.emergencyContact,
    joinDate: dateOnly(e.joinDate),
    exitDate: dateOnly(e.exitDate),
    exitReason: e.exitReason,
    status: e.status,
    /** Still working here (no leaving date, or it is today or later). */
    isCurrent: !e.exitDate || dateOnly(e.exitDate) >= day,
    portalLogin: e.user,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

/** Pay details, only for those who may see salaries. */
function payOf(e: EmployeeRow, day: string) {
  const salary = salaryNow(e, day);
  return {
    /** Monthly gross salary in force today. */
    salary: salary.current.toFixed(2),
    upcomingSalary: salary.upcoming,
    overtimeRate: e.overtimeRate?.toFixed(2) ?? null,
    salaryMethod: e.salaryMethod,
    bankName: e.bankName,
    bankAccountNumber: e.bankAccountNumber,
    walletNumber: e.walletNumber,
    notes: e.notes,
  };
}

export function presentEmployee(e: EmployeeRow, options: { withSalary: boolean; day: string }) {
  const profile = profileOf(e, options.day);
  return options.withSalary ? { ...profile, ...payOf(e, options.day) } : profile;
}

async function loadEmployee(
  ctx: CompanyContext,
  employeeId: string,
  db: Tx | typeof prisma = prisma,
) {
  const employee = await db.employee.findFirst({
    where: { id: employeeId, companyId: ctx.company.id },
    include: employeeInclude,
  });
  if (!employee) throw new AppError("NOT_FOUND", "Employee not found.");
  return employee;
}

/** The next free "EMP-0001" style code (held under a per-company lock). */
async function nextEmployeeCode(tx: Tx, companyId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`employee-code:${companyId}`}))`;
  const [row] = await tx.$queryRaw<Array<{ n: number | null }>>`
    SELECT MAX(CAST(substring(code from 5) AS INTEGER)) AS n
    FROM "Employee"
    WHERE "companyId" = ${companyId} AND code ~ '^EMP-[0-9]{1,9}$'`;
  return `EMP-${String((row?.n ?? 0) + 1).padStart(4, "0")}`;
}

async function assertCodeFree(ctx: CompanyContext, code: string, exceptId?: string) {
  const clash = await ctx.db.employee.findFirst({
    where: {
      code: { equals: code, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
  });
  if (clash) throw new AppError("CONFLICT", `Code ${clash.code} belongs to ${clash.name}.`);
}

/** Keeps `baseSalary` on the latest revision (the salary going forward). */
async function syncBaseSalary(tx: Tx, employeeId: string) {
  const latest = await tx.salaryRevision.findFirst({
    where: { employeeId },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
  });
  if (latest) {
    await tx.employee.update({ where: { id: employeeId }, data: { baseSalary: latest.amount } });
  }
}

// =============================================================================
// Reading
// =============================================================================

export async function listEmployees(ctx: CompanyContext, raw: unknown = {}) {
  const q = listEmployeesSchema.parse(raw);
  const take = q.take ?? 50;
  const day = today(ctx);
  const current = q.current ?? true;
  const rows = await ctx.db.employee.findMany({
    where: {
      AND: [
        q.status ? { status: q.status } : {},
        current ? { OR: [{ exitDate: null }, { exitDate: { gte: dateColumn(day) } }] } : {},
        q.department ? { department: { equals: q.department, mode: "insensitive" } } : {},
        q.search
          ? {
              OR: [
                { name: { contains: q.search, mode: "insensitive" } },
                { code: { contains: q.search, mode: "insensitive" } },
                { phone: { contains: q.search } },
                { designation: { contains: q.search, mode: "insensitive" } },
              ],
            }
          : {},
      ],
    },
    include: employeeInclude,
    orderBy: [{ code: "asc" }, { id: "asc" }],
    take: take + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  const withSalary = canSeeSalaries(ctx);
  return {
    items: items.map((e) => presentEmployee(e, { withSalary, day })),
    nextCursor: hasMore ? items.at(-1)?.id : undefined,
  };
}

/** Names and codes for pickers (e.g. the employee on a conveyance expense). */
export async function employeeDirectory(ctx: CompanyContext, raw: unknown = {}) {
  const q = directorySchema.parse(raw);
  const day = today(ctx);
  return ctx.db.employee.findMany({
    where: {
      ...(q.includeFormer
        ? {}
        : { OR: [{ exitDate: null }, { exitDate: { gte: dateColumn(day) } }] }),
      ...(q.search
        ? {
            AND: {
              OR: [
                { name: { contains: q.search, mode: "insensitive" } },
                { code: { contains: q.search, mode: "insensitive" } },
              ],
            },
          }
        : {}),
    },
    select: { id: true, code: true, name: true, designation: true, department: true },
    orderBy: { name: "asc" },
    take: 500,
  });
}

/** The 360° profile: details, salary history, leave, this month's attendance, advances, payslips. */
export async function getEmployee(ctx: CompanyContext, employeeId: string) {
  const employee = await loadEmployee(ctx, employeeId);
  const day = today(ctx);
  const withSalary = canSeeSalaries(ctx);
  const [leave, month] = await Promise.all([
    balancesFor(prisma, employee, Number(day.slice(0, 4))),
    employeeMonth(ctx, employee, day.slice(0, 7)),
  ]);
  const extra = {
    leaveBalances: leave,
    thisMonth: { month: month.month, totals: month.totals },
  };
  if (!withSalary) return { ...profileOf(employee, day), ...extra };
  const [advances, payslips] = await Promise.all([
    ctx.db.salaryAdvance.findMany({
      where: { employeeId: employee.id, status: "OPEN" },
      orderBy: { givenAt: "asc" },
      select: { id: true, number: true, givenAt: true, amount: true, outstanding: true },
    }),
    prisma.payrollItem.findMany({
      where: { employeeId: employee.id, run: { companyId: ctx.company.id } },
      include: { run: { select: { id: true, year: true, month: true, status: true } } },
      orderBy: [{ run: { year: "desc" } }, { run: { month: "desc" } }],
      take: 12,
    }),
  ]);
  return {
    ...profileOf(employee, day),
    ...payOf(employee, day),
    ...extra,
    salaryHistory: employee.salaryHistory.map((r) => ({
      id: r.id,
      effectiveFrom: dateOnly(r.effectiveFrom),
      amount: r.amount.toFixed(2),
      reason: r.reason,
      createdAt: r.createdAt,
    })),
    advances: {
      outstanding: advances.reduce((t, a) => t.plus(a.outstanding), ZERO).toFixed(2),
      open: advances.map((a) => ({
        ...a,
        amount: a.amount.toFixed(2),
        outstanding: a.outstanding.toFixed(2),
      })),
    },
    payslips: payslips.map((p) => ({
      itemId: p.id,
      runId: p.run.id,
      month: monthKey(p.run.year, p.run.month),
      label: monthLabel(monthKey(p.run.year, p.run.month)),
      runStatus: p.run.status,
      netPay: p.netPay.toFixed(2),
      paid: p.paymentId !== null,
    })),
  };
}

// =============================================================================
// Writing
// =============================================================================

export async function createEmployee(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanManageHr(ctx, "Only HR can add employees.");
  const input = createEmployeeSchema.parse(raw);
  const companyId = ctx.company.id;
  if (input.code) await assertCodeFree(ctx, input.code);
  const { salary, joinDate, dateOfBirth, ...details } = input;
  const id = await prisma.$transaction(async (tx) => {
    await ensureHrSetup(companyId, tx);
    const employee = await tx.employee.create({
      data: {
        ...details,
        companyId,
        code: input.code ?? (await nextEmployeeCode(tx, companyId)),
        joinDate: dateColumn(joinDate),
        dateOfBirth: dateOfBirth ? dateColumn(dateOfBirth) : null,
        baseSalary: money(salary),
        overtimeRate: input.overtimeRate != null ? money(input.overtimeRate) : null,
        salaryHistory: {
          create: {
            effectiveFrom: dateColumn(joinDate),
            amount: money(salary),
            reason: "Joining salary",
          },
        },
      },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "Employee",
        entityId: employee.id,
        summary: `Added employee ${employee.code} ${employee.name}, joining ${joinDate}`,
      },
      tx,
    );
    return employee.id;
  }, TX_OPTIONS);
  return getEmployee(ctx, id);
}

export async function updateEmployee(
  ctx: CompanyContext,
  employeeId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageHr(ctx, "Only HR can edit employees.");
  const input = updateEmployeeSchema.parse(raw);
  const employee = await loadEmployee(ctx, employeeId);
  if (input.code && input.code !== employee.code)
    await assertCodeFree(ctx, input.code, employee.id);
  if (input.status && employee.exitDate) {
    throw new AppError("CONFLICT", `${employee.name} has left; reinstate them first.`);
  }
  const oldJoin = dateOnly(employee.joinDate);
  const { joinDate: newJoin, dateOfBirth, ...details } = input;
  const exit = dateOnly(employee.exitDate);
  if (newJoin && exit && newJoin > exit) {
    throw new AppError("VALIDATION", "The joining day must be on or before the leaving day.");
  }
  await prisma.$transaction(async (tx) => {
    if (newJoin && newJoin !== oldJoin) {
      const from = newJoin < oldJoin ? newJoin : oldJoin;
      await assertOpenFrom(tx, ctx.company.id, from.slice(0, 7), "the joining day");
      // The joining salary starts on the joining day.
      const first = employee.salaryHistory[0];
      if (first && dateOnly(first.effectiveFrom) === oldJoin) {
        await tx.salaryRevision.update({
          where: { id: first.id },
          data: { effectiveFrom: dateColumn(newJoin) },
        });
      }
    }
    await tx.employee.update({
      where: { id: employee.id },
      data: {
        ...details,
        ...(newJoin ? { joinDate: dateColumn(newJoin) } : {}),
        ...(dateOfBirth !== undefined
          ? { dateOfBirth: dateOfBirth ? dateColumn(dateOfBirth) : null }
          : {}),
        ...(input.overtimeRate !== undefined
          ? { overtimeRate: input.overtimeRate === null ? null : money(input.overtimeRate) }
          : {}),
      },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "Employee",
        entityId: employee.id,
        summary: `Updated ${employee.code} ${employee.name}: ${Object.keys(input).join(", ")}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getEmployee(ctx, employee.id);
}

/** A new monthly salary from a day onwards (a raise, a cut or a correction). */
export async function reviseSalary(
  ctx: CompanyContext,
  employeeId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageHr(ctx, "Only HR can change salaries.");
  const input = salaryRevisionSchema.parse(raw);
  const employee = await loadEmployee(ctx, employeeId);
  assertNotOwnRecord(ctx, employee, "Someone else must change your own salary.");
  const join = dateOnly(employee.joinDate);
  const exit = dateOnly(employee.exitDate);
  if (input.effectiveFrom < join) {
    throw new AppError("VALIDATION", `The new salary cannot start before joining (${join}).`);
  }
  if (exit && input.effectiveFrom > exit) {
    throw new AppError("VALIDATION", `${employee.name} left on ${exit}.`);
  }
  const before = salaryOn(
    employee.salaryHistory.map((r) => ({
      effectiveFrom: dateOnly(r.effectiveFrom),
      amount: r.amount,
    })),
    input.effectiveFrom,
    employee.baseSalary,
  );
  await prisma.$transaction(async (tx) => {
    await assertOpenFrom(tx, ctx.company.id, input.effectiveFrom.slice(0, 7), "salaries");
    await tx.salaryRevision.create({
      data: {
        employeeId: employee.id,
        effectiveFrom: dateColumn(input.effectiveFrom),
        amount: money(input.amount),
        reason: input.reason ?? null,
      },
    });
    await syncBaseSalary(tx, employee.id);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "Employee",
        entityId: employee.id,
        summary: `Salary of ${employee.code} ${employee.name} from ${input.effectiveFrom}: ${before.toFixed(
          2,
        )} -> ${money(input.amount).toFixed(2)}${input.reason ? ` (${input.reason})` : ""}`,
        before: { salary: before.toFixed(2) },
        after: { salary: money(input.amount).toFixed(2), effectiveFrom: input.effectiveFrom },
      },
      tx,
    );
  }, TX_OPTIONS);
  return getEmployee(ctx, employee.id);
}

/** Removes a salary revision entered by mistake (not the joining salary). */
export async function deleteSalaryRevision(
  ctx: CompanyContext,
  employeeId: string,
  revisionId: string,
  meta?: RequestMeta,
) {
  assertCanManageHr(ctx, "Only HR can change salaries.");
  const employee = await loadEmployee(ctx, employeeId);
  assertNotOwnRecord(ctx, employee, "Someone else must change your own salary.");
  const revision = employee.salaryHistory.find((r) => r.id === revisionId);
  if (!revision) throw new AppError("NOT_FOUND", "Salary revision not found.");
  if (employee.salaryHistory[0]?.id === revision.id) {
    throw new AppError("CONFLICT", "The joining salary stays; add a new revision instead.");
  }
  const from = dateOnly(revision.effectiveFrom);
  await prisma.$transaction(async (tx) => {
    await assertOpenFrom(tx, ctx.company.id, from.slice(0, 7), "salaries");
    await tx.salaryRevision.delete({ where: { id: revision.id } });
    await syncBaseSalary(tx, employee.id);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "DELETE",
        entityType: "Employee",
        entityId: employee.id,
        summary: `Removed ${employee.name}'s salary revision of ${revision.amount.toFixed(2)} from ${from}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getEmployee(ctx, employee.id);
}

/**
 * Records that someone left (or corrects the day). They are paid up to and
 * including their last working day, and their final payroll recovers what is
 * still owed on their advances. Leave booked after that day is cancelled.
 */
export async function exitEmployee(
  ctx: CompanyContext,
  employeeId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageHr(ctx, "Only HR can record that someone left.");
  const input = exitEmployeeSchema.parse(raw);
  const employee = await loadEmployee(ctx, employeeId);
  const join = dateOnly(employee.joinDate);
  if (input.exitDate < join) {
    throw new AppError("VALIDATION", `The last working day cannot be before joining (${join}).`);
  }
  const oldExit = dateOnly(employee.exitDate);
  const from = oldExit && oldExit < input.exitDate ? oldExit : input.exitDate;
  await prisma.$transaction(async (tx) => {
    await assertOpenFrom(tx, ctx.company.id, from.slice(0, 7), "the leaving day");
    const later = await tx.leaveRequest.findMany({
      where: {
        employeeId: employee.id,
        status: { in: ["PENDING", "APPROVED"] },
        startDate: { gt: dateColumn(input.exitDate) },
      },
    });
    await tx.leaveRequest.updateMany({
      where: { id: { in: later.map((l) => l.id) } },
      data: { status: "CANCELLED", decisionNote: `Left on ${input.exitDate}` },
    });
    await tx.employee.update({
      where: { id: employee.id },
      data: {
        exitDate: dateColumn(input.exitDate),
        exitReason: input.reason ?? null,
        status: input.status,
      },
    });
    // Allowances shared out by months worked change with the leaving day.
    const types = await tx.leaveBalance.findMany({
      where: { employeeId: employee.id, year: { gte: Number(from.slice(0, 4)) } },
      select: { leaveTypeId: true, year: true },
    });
    for (const t of types) await syncLeaveBalanceTx(tx, employee.id, t.leaveTypeId, t.year);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "Employee",
        entityId: employee.id,
        summary: `${employee.code} ${employee.name} ${input.status.toLowerCase()}, last working day ${
          input.exitDate
        }${later.length ? `; cancelled ${later.length} later leave request(s)` : ""}${
          input.reason ? ` — ${input.reason}` : ""
        }`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getEmployee(ctx, employee.id);
}

/** Undoes a leaving record (e.g. the resignation was withdrawn). */
export async function reinstateEmployee(
  ctx: CompanyContext,
  employeeId: string,
  meta?: RequestMeta,
) {
  assertCanManageHr(ctx, "Only HR can reinstate employees.");
  const employee = await loadEmployee(ctx, employeeId);
  const exit = dateOnly(employee.exitDate);
  if (!exit) throw new AppError("CONFLICT", `${employee.name} has not left.`);
  await prisma.$transaction(async (tx) => {
    await assertOpenFrom(tx, ctx.company.id, exit.slice(0, 7), "the leaving day");
    await tx.employee.update({
      where: { id: employee.id },
      data: { exitDate: null, exitReason: null, status: "ACTIVE" },
    });
    const types = await tx.leaveBalance.findMany({
      where: { employeeId: employee.id, year: { gte: Number(exit.slice(0, 4)) } },
      select: { leaveTypeId: true, year: true },
    });
    for (const t of types) await syncLeaveBalanceTx(tx, employee.id, t.leaveTypeId, t.year);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "Employee",
        entityId: employee.id,
        summary: `Reinstated ${employee.code} ${employee.name} (had left on ${exit})`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getEmployee(ctx, employee.id);
}

/** Deletes an employee added by mistake; anyone with records is marked as left instead. */
export async function deleteEmployee(ctx: CompanyContext, employeeId: string, meta?: RequestMeta) {
  assertCanManageHr(ctx, "Only HR can delete employees.");
  const employee = await loadEmployee(ctx, employeeId);
  const [items, advances, lines, marks, leave, expenses] = await Promise.all([
    prisma.payrollItem.count({ where: { employeeId: employee.id } }),
    ctx.db.salaryAdvance.count({ where: { employeeId: employee.id } }),
    prisma.journalLine.count({ where: { employeeId: employee.id } }),
    ctx.db.attendance.count({ where: { employeeId: employee.id } }),
    ctx.db.leaveRequest.count({ where: { employeeId: employee.id } }),
    ctx.db.expense.count({ where: { employeeId: employee.id } }),
  ]);
  if (items + advances + lines + marks + leave + expenses > 0) {
    throw new AppError(
      "CONFLICT",
      `${employee.name} has payroll, advance, attendance, leave or expense records. Record their leaving day instead.`,
    );
  }
  await prisma.$transaction(async (tx) => {
    await tx.employee.delete({ where: { id: employee.id } });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "DELETE",
        entityType: "Employee",
        entityId: employee.id,
        summary: `Deleted employee ${employee.code} ${employee.name}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return { deleted: true };
}

// =============================================================================
// Portal logins
// =============================================================================

/**
 * Gives an employee a portal login: links a user who is already in the
 * company, or creates one with the Employee role (the temporary password is
 * returned once, as when adding a member).
 */
export async function grantPortalAccess(
  ctx: CompanyContext,
  employeeId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageHr(ctx, "Only HR can give portal access.");
  const input = portalAccessSchema.parse(raw);
  const employee = await loadEmployee(ctx, employeeId);
  if (employee.userId) {
    throw new AppError(
      "CONFLICT",
      `${employee.name} already signs in as ${employee.user?.email}; remove that first.`,
    );
  }
  let userId = input.userId;
  let temporaryPassword: string | undefined;
  if (!userId && input.email) {
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    const member = existing
      ? await ctx.db.companyMembership.findFirst({ where: { userId: existing.id, isActive: true } })
      : null;
    if (member) {
      userId = member.userId;
    } else {
      const role = await ctx.db.role.findFirst({ where: { systemRole: "EMPLOYEE" } });
      if (!role) throw new AppError("NOT_FOUND", "The Employee role is missing.");
      const added = await addMember(
        ctx,
        {
          email: input.email,
          name: employee.name,
          phone: input.phone ?? employee.phone ?? undefined,
          roleId: role.id,
        },
        meta,
      );
      userId = added.membership.userId;
      temporaryPassword = added.temporaryPassword;
    }
  }
  const membership = await ctx.db.companyMembership.findFirst({
    where: { userId, isActive: true },
    include: { user: { select: { email: true } } },
  });
  if (!membership) throw new AppError("NOT_FOUND", "That user is not active in this company.");
  const other = await ctx.db.employee.findFirst({ where: { userId: membership.userId } });
  if (other) {
    throw new AppError("CONFLICT", `${membership.user.email} is already linked to ${other.name}.`);
  }
  await ctx.db.employee.update({ where: { id: employee.id }, data: { userId: membership.userId } });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "Employee",
    entityId: employee.id,
    summary: `Linked ${employee.name} to the login ${membership.user.email} (employee portal)`,
  });
  return { employee: await getEmployee(ctx, employee.id), temporaryPassword };
}

/**
 * Unlinks the portal login. A login that only had the Employee role is also
 * switched off for this company; anyone else keeps their role.
 */
export async function revokePortalAccess(
  ctx: CompanyContext,
  employeeId: string,
  meta?: RequestMeta,
) {
  assertCanManageHr(ctx, "Only HR can remove portal access.");
  const employee = await loadEmployee(ctx, employeeId);
  if (!employee.userId) throw new AppError("CONFLICT", `${employee.name} has no portal login.`);
  const membership = await ctx.db.companyMembership.findFirst({
    where: { userId: employee.userId },
    include: { role: { select: { systemRole: true } } },
  });
  await ctx.db.employee.update({ where: { id: employee.id }, data: { userId: null } });
  let deactivated = false;
  if (membership?.isActive && membership.role.systemRole === "EMPLOYEE") {
    await setMemberActive(ctx, membership.id, false, meta);
    deactivated = true;
  }
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "Employee",
    entityId: employee.id,
    summary: `Removed ${employee.name}'s portal login ${employee.user?.email ?? ""}${
      deactivated ? " and switched it off" : ""
    }`,
  });
  return getEmployee(ctx, employee.id);
}

// =============================================================================
// Statement
// =============================================================================

/**
 * Every journal line naming the employee: advances given and recovered,
 * salaries posted and paid, conveyance settled from advances, with what they
 * owe the company and what the company owes them.
 */
export async function getEmployeeStatement(
  ctx: CompanyContext,
  employeeId: string,
  raw: unknown = {},
) {
  assertCanSeeSalaries(ctx);
  const q = statementSchema.parse(raw);
  const employee = await loadEmployee(ctx, employeeId);
  const { start, end } = dayRange(q.from, q.to, ctx.company.timezone);
  const lines = await prisma.journalLine.findMany({
    where: {
      employeeId: employee.id,
      entry: {
        companyId: ctx.company.id,
        ...(start || end
          ? { date: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } }
          : {}),
      },
    },
    include: {
      entry: {
        select: {
          id: true,
          number: true,
          date: true,
          description: true,
          sourceType: true,
          isReversed: true,
          reversalOfId: true,
          createdAt: true,
        },
      },
      account: { select: { id: true, code: true, name: true } },
    },
    orderBy: [{ entry: { date: "asc" } }, { entry: { createdAt: "asc" } }, { id: "asc" }],
    take: 5000,
  });
  const balanceOn = async (code: string) => {
    const sums = await prisma.journalLine.aggregate({
      where: {
        employeeId: employee.id,
        account: { code, companyId: ctx.company.id },
        entry: { companyId: ctx.company.id, ...(end ? { date: { lt: end } } : {}) },
      },
      _sum: { debit: true, credit: true },
    });
    return (sums._sum.debit ?? ZERO).minus(sums._sum.credit ?? ZERO);
  };
  const [advances, payable] = await Promise.all([
    balanceOn(CONTROL_ACCOUNTS.EMPLOYEE_ADVANCES.code),
    balanceOn(CONTROL_ACCOUNTS.SALARIES_PAYABLE.code),
  ]);
  return {
    employee: { id: employee.id, code: employee.code, name: employee.name },
    from: q.from ?? null,
    to: q.to ?? null,
    /** Advances the employee still owes the company. */
    advanceBalance: advances.toFixed(2),
    /** Approved salary not yet paid. */
    salaryPayable: payable.neg().toFixed(2),
    lines: lines.map((l) => ({
      entryId: l.entry.id,
      number: l.entry.number,
      date: l.entry.date,
      description: l.entry.description,
      sourceType: l.entry.sourceType,
      account: l.account,
      memo: l.memo,
      debit: l.debit.toFixed(2),
      credit: l.credit.toFixed(2),
      isReversal: l.entry.reversalOfId !== null,
      isReversed: l.entry.isReversed,
    })),
  };
}
