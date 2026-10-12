import type { Prisma } from "@prisma/client";

import { dateOnly, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { ZERO } from "@/modules/accounts/balances";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { assertCanManageHr, assertNotOwnRecord } from "@/modules/hr/access";
import { assetsOut, assetText } from "@/modules/hr/asset.service";
import { monthLabel } from "@/modules/hr/calendar";
import { owedForClaims } from "@/modules/hr/claims.service";
import { recordExitTx } from "@/modules/hr/employee.service";
import { balanceOf } from "@/modules/hr/payroll-calc";
import { deactivateEmployeeSchema } from "@/modules/hr/schemas";
import { enqueueJob } from "@/modules/jobs/queue";
import { kickJobWorker } from "@/modules/jobs/worker";
import { setMemberActive } from "@/modules/rbac/member.service";

/*
 * Leaving in one go ("Deactivate employee"): HR checks the clearance (company
 * items still out hold it up; money either way is shown), records the last
 * working day, switches the login off and has the experience and clearance
 * certificate made in the background ("exit.certificate" jobs, exit-pdf.ts),
 * kept in the employee's papers. "Record leaving" stays for a leaving day in
 * the future, or someone who left without returning items.
 */

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Where someone stands on leaving: the items they still hold, salary approved
 * but not paid, what they owe on advances, claims owed to them or waiting,
 * and whether the payroll for their last month is approved.
 */
export async function clearanceFigures(
  db: Db,
  companyId: string,
  employee: { id: string; exitDate: Date | null },
) {
  const exit = employee.exitDate ? dateOnly(employee.exitDate) : null;
  const [items, lines, advances, claimsOwed, claimsWaiting, lastRun] = await Promise.all([
    assetsOut(db, employee.id),
    db.payrollItem.findMany({
      where: { employeeId: employee.id, run: { companyId, status: "APPROVED" } },
      select: { netPay: true, paidAmount: true },
    }),
    db.salaryAdvance.aggregate({
      where: { companyId, employeeId: employee.id, status: "OPEN" },
      _sum: { outstanding: true },
    }),
    owedForClaims(db, companyId, employee.id),
    db.staffClaim.count({ where: { companyId, employeeId: employee.id, status: "PENDING" } }),
    exit
      ? db.payrollRun.findFirst({
          where: {
            companyId,
            year: Number(exit.slice(0, 4)),
            month: Number(exit.slice(5, 7)),
            status: { not: "DRAFT" },
          },
          select: { id: true },
        })
      : null,
  ]);
  const salaryOwed = lines.reduce((t, l) => t.plus(balanceOf(l)), ZERO);
  return {
    items,
    salaryOwed: salaryOwed.toFixed(2),
    advancesOwed: (advances._sum.outstanding ?? ZERO).toFixed(2),
    claimsOwed: claimsOwed.toFixed(2),
    claimsWaiting,
    /** "October 2026" when the payroll for the last month is not approved yet. */
    finalPayrollMissing: exit && !lastRun ? monthLabel(exit.slice(0, 7)) : null,
  };
}

export type ClearanceFigures = Awaited<ReturnType<typeof clearanceFigures>>;

/** The certificates made for someone, newest first, and whether one is being made. */
async function certificates(companyId: string, employeeId: string) {
  const [documents, making] = await Promise.all([
    prisma.employeeDocument.findMany({
      where: { companyId, employeeId, kind: "CLEARANCE" },
      select: { id: true, fileId: true, title: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.backgroundJob.count({
      where: {
        companyId,
        kind: "exit.certificate",
        status: { in: ["QUEUED", "RUNNING"] },
        payload: { path: ["employeeId"], equals: employeeId },
      },
    }),
  ]);
  return { documents, making: making > 0 };
}

/** The login that goes off, and whether this person may switch it off. */
async function loginOf(ctx: CompanyContext, userId: string | null) {
  if (!userId) return null;
  const membership = await ctx.db.companyMembership.findFirst({
    where: { userId },
    include: {
      user: { select: { email: true } },
      role: { select: { name: true, systemRole: true } },
    },
  });
  if (!membership) return null;
  const staffOnly = membership.role.systemRole === "EMPLOYEE";
  return {
    membershipId: membership.id,
    email: membership.user.email,
    role: membership.role.name,
    active: membership.isActive,
    /** HR switches off an employee login; any other role needs someone who manages users. */
    canSwitchOff: staffOnly || ctx.can("company.members.manage"),
  };
}

/** What the "Deactivate employee" dialog shows (hr.manage). */
export async function getClearance(ctx: CompanyContext, employeeId: string) {
  assertCanManageHr(ctx, "Only HR can deactivate employees.");
  const employee = await ctx.db.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw new AppError("NOT_FOUND", "Employee not found.");
  const today = localDay(new Date(), ctx.company.timezone);
  const [figures, login, made] = await Promise.all([
    clearanceFigures(prisma, ctx.company.id, employee),
    loginOf(ctx, employee.userId),
    certificates(ctx.company.id, employee.id),
  ]);
  const exit = employee.exitDate ? dateOnly(employee.exitDate) : null;
  return {
    today,
    employee: {
      id: employee.id,
      code: employee.code,
      name: employee.name,
      joinDate: dateOnly(employee.joinDate),
      exitDate: exit,
      exitReason: employee.exitReason,
      status: employee.status,
    },
    ...figures,
    login,
    certificates: made.documents.map((d) => ({
      id: d.id,
      fileId: d.fileId,
      title: d.title,
      madeOn: localDay(d.createdAt, ctx.company.timezone),
    })),
    making: made.making,
    can: {
      /** Nothing is out, and the leaving day (if set) is not still to come. */
      deactivate: figures.items.length === 0 && (!exit || exit <= today),
      /** Left already, with nothing out: the certificate can be made (again). */
      certificate: figures.items.length === 0 && exit !== null && exit <= today,
    },
  };
}

export type Clearance = Awaited<ReturnType<typeof getClearance>>;

function assertNothingOut(name: string, items: ClearanceFigures["items"]) {
  if (items.length === 0) return;
  throw new AppError(
    "CONFLICT",
    `${name} still has ${items.map(assetText).join(", ")}. Take ${
      items.length === 1 ? "it" : "them"
    } back, or mark ${items.length === 1 ? "it" : "them"} lost, first.`,
  );
}

/**
 * Deactivates someone in one go: checks they hold no company items, records
 * the last working day (today or earlier) if it is not recorded yet or
 * differs, switches their login off and has the experience and clearance
 * certificate made.
 */
export async function deactivateEmployee(
  ctx: CompanyContext,
  employeeId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageHr(ctx, "Only HR can deactivate employees.");
  const input = deactivateEmployeeSchema.parse(raw);
  const employee = await ctx.db.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw new AppError("NOT_FOUND", "Employee not found.");
  assertNotOwnRecord(ctx, employee, "Someone else in HR deactivates you.");
  const today = localDay(new Date(), ctx.company.timezone);
  if (input.exitDate > today) {
    throw new AppError("VALIDATION", "The last working day is still to come.", {
      exitDate: [
        "Pick today or an earlier day. For a later day, use “Record leaving” now and deactivate them on the day.",
      ],
    });
  }
  const login = await loginOf(ctx, employee.userId);
  const switchOff = Boolean(login?.active && login.canSwitchOff);
  const sameExit =
    employee.exitDate !== null &&
    dateOnly(employee.exitDate) === input.exitDate &&
    employee.status === input.status &&
    (input.reason ?? null) === (employee.exitReason ?? null);
  await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Employee" WHERE "id" = ${employee.id} FOR UPDATE`;
      assertNothingOut(employee.name, await assetsOut(tx, employee.id));
      const note = `; deactivated${switchOff ? ", login switched off" : ""}, clearance certificate requested`;
      if (!sameExit) {
        await recordExitTx(tx, ctx, employee, input, meta, note);
      } else {
        await auditInCompany(
          ctx,
          meta,
          {
            action: "STATUS_CHANGE",
            entityType: "Employee",
            entityId: employee.id,
            summary: `${employee.code} ${employee.name}${note.replace(/^; /, " ")}`,
          },
          tx,
        );
      }
      await enqueueJob(tx, {
        kind: "exit.certificate",
        companyId: ctx.company.id,
        payload: { employeeId: employee.id, requestedById: ctx.user.id },
      });
    },
    { timeout: 60_000 },
  );
  kickJobWorker();
  // The login goes off once the leaving day is in (as Settings > Users does it).
  let state: "NONE" | "OFF" | "KEPT" | "ALREADY_OFF" = !login
    ? "NONE"
    : !login.active
      ? "ALREADY_OFF"
      : switchOff
        ? "OFF"
        : "KEPT";
  let loginProblem: string | null = null;
  if (state === "OFF" && login) {
    try {
      await setMemberActive(ctx, login.membershipId, false, meta);
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      state = "KEPT";
      loginProblem = error.message;
    }
  }
  return { employeeId: employee.id, login: state, loginRole: login?.role ?? null, loginProblem };
}

/** Makes the certificate again (after the final salary was paid, say): left, with nothing out. */
export async function remakeCertificate(
  ctx: CompanyContext,
  employeeId: string,
  meta?: RequestMeta,
) {
  assertCanManageHr(ctx, "Only HR can make the clearance certificate.");
  const employee = await ctx.db.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw new AppError("NOT_FOUND", "Employee not found.");
  const today = localDay(new Date(), ctx.company.timezone);
  const exit = employee.exitDate ? dateOnly(employee.exitDate) : null;
  if (!exit || exit > today) {
    throw new AppError("CONFLICT", `${employee.name} has not left yet.`);
  }
  await prisma.$transaction(async (tx) => {
    assertNothingOut(employee.name, await assetsOut(tx, employee.id));
    await enqueueJob(tx, {
      kind: "exit.certificate",
      companyId: ctx.company.id,
      payload: { employeeId: employee.id, requestedById: ctx.user.id },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "Employee",
        entityId: employee.id,
        summary: `Asked for a new experience and clearance certificate for ${employee.code} ${employee.name}`,
      },
      tx,
    );
  });
  kickJobWorker();
  return { employeeId: employee.id, making: true };
}
