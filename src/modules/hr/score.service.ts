import type { Employee } from "@prisma/client";

import { addDays, dateColumn, dateOnly, localDay, startOfDayInZone } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import type { CompanyContext } from "@/modules/auth/context";
import { assertCanManageHr, requireLinkedEmployee } from "@/modules/hr/access";
import { eachDay } from "@/modules/hr/calendar";
import { employedOn, loadEmploymentInputs, loadRules } from "@/modules/hr/month-data";
import { evaluateDay } from "@/modules/hr/payroll-calc";
import {
  performanceScore,
  SCORE_DAYS,
  type ScoreClaim,
  type ScoreDay,
  type ScoreTask,
} from "@/modules/hr/score";
import { nextAnniversary, tenureOn, tenureText } from "@/modules/hr/tenure";

/*
 * The employee dashboard's numbers from the records (score.ts has the rules):
 * the performance score over the last 30 days, from the attendance marks, the
 * tasks given to the person and the claims Accounts decided, and how long
 * they have been with the company. The employee sees their own (portal.self);
 * HR sees anyone's (hr.manage). Overtime and the checks on claims play no
 * part, as staff never see them.
 */

export type ScoreView = Awaited<ReturnType<typeof scoreOf>>;

async function scoreOf(ctx: CompanyContext, employee: Employee, now: Date) {
  const tz = ctx.company.timezone;
  const companyId = ctx.company.id;
  const today = localDay(now, tz);
  const from = addDays(today, -(SCORE_DAYS - 1));
  const start = startOfDayInZone(from, tz);
  const end = startOfDayInZone(addDays(today, 1), tz);
  const [{ rules }, inputs, tasks, claims] = await Promise.all([
    loadRules(companyId, from, today),
    loadEmploymentInputs(companyId, [employee], from, today),
    // Due in the window, or finished in it ahead of a later due day.
    ctx.db.task.findMany({
      where: {
        assigneeId: employee.id,
        status: { not: "CANCELLED" },
        dueAt: { not: null },
        OR: [
          { dueAt: { gte: start, lt: end } },
          { status: "DONE", completedAt: { gte: start, lt: end }, dueAt: { gte: end } },
        ],
      },
      select: { id: true, title: true, dueAt: true, status: true, completedAt: true },
    }),
    ctx.db.staffClaim.findMany({
      where: {
        employeeId: employee.id,
        status: { in: ["APPROVED", "REJECTED"] },
        date: { gte: dateColumn(from), lte: dateColumn(today) },
      },
      select: {
        id: true,
        number: true,
        date: true,
        status: true,
        amount: true,
        approvedAmount: true,
      },
    }),
  ]);
  const input = inputs.get(employee.id)!;

  const days: ScoreDay[] = eachDay(from, today).flatMap((day) => {
    if (!employedOn(employee, day)) return [];
    const e = evaluateDay(rules, input, day);
    if (e.dayType !== "WORKING" || !e.mark || (e.leave?.fraction ?? 0) >= 1) return [];
    return [{ date: day, status: e.mark.status, halfLeave: (e.leave?.fraction ?? 0) > 0 }];
  });

  const scoreTasks: ScoreTask[] = tasks.flatMap((t) => {
    const dueDay = localDay(t.dueAt!, tz);
    const doneDay = t.status === "DONE" && t.completedAt ? localDay(t.completedAt, tz) : null;
    // Still open and due today: there is time yet.
    if (doneDay === null && dueDay >= today) return [];
    return [{ id: t.id, title: t.title, dueDay, doneDay }];
  });

  const scoreClaims: ScoreClaim[] = claims.map((c) => ({
    id: c.id,
    number: c.number,
    date: dateOnly(c.date),
    approved: c.status === "APPROVED",
    cut: c.status === "APPROVED" && c.approvedAmount !== null && c.approvedAmount.lt(c.amount),
  }));

  const joined = dateOnly(employee.joinDate);
  const exit = dateOnly(employee.exitDate);
  const upTo = exit && exit < today ? exit : today;
  const tenure = tenureOn(joined, upTo);
  return {
    employee: { id: employee.id, code: employee.code, name: employee.name },
    ...performanceScore({ from, to: today, days, tasks: scoreTasks, claims: scoreClaims }),
    tenure: {
      /** When this was worked out: the live clock starts from here. */
      at: now.toISOString(),
      joined,
      /** The start of the join day, for the live clock. */
      since: startOfDayInZone(joined, tz).toISOString(),
      /** The clock stops on the last working day. */
      until: exit && exit < today ? startOfDayInZone(addDays(exit, 1), tz).toISOString() : null,
      ...tenure,
      text: tenureText(tenure),
      next: exit && exit <= today ? null : nextAnniversary(joined, today),
    },
  };
}

/** The signed-in employee's own score and tenure (portal.self). */
export async function myScore(ctx: CompanyContext, now: Date = new Date()) {
  return scoreOf(ctx, await requireLinkedEmployee(ctx), now);
}

/** One employee's score and tenure, for HR (hr.manage). */
export async function employeeScore(
  ctx: CompanyContext,
  employeeId: string,
  now: Date = new Date(),
) {
  assertCanManageHr(ctx, "Only HR can see an employee's performance score.");
  const employee = await ctx.db.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw new AppError("NOT_FOUND", "Employee not found.");
  return scoreOf(ctx, employee, now);
}
