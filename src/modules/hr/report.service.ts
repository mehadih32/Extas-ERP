import { Prisma } from "@prisma/client";

import { dateColumn, dateOnly, localDay, startOfDayInZone } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { formatAmount, formatDay } from "@/lib/format";
import { checkRateLimit } from "@/lib/rate-limit";
import type { RequestMeta } from "@/lib/request-meta";
import { ZERO } from "@/modules/accounts/balances";
import { addDays, addMonths } from "@/modules/accounts/periods";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { registrationNumbers } from "@/modules/companies/letterhead";
import { loadPrintLogo } from "@/modules/companies/logo.service";
import { letterheadOf, registrationLines } from "@/modules/documents/builders";
import { documentFileName, type PrintDocument } from "@/modules/documents/model";
import { renderDocumentPdf } from "@/modules/documents/render";
import { canSeeSalaries } from "@/modules/hr/access";
import { eachDay, monthKey, monthLabel } from "@/modules/hr/calendar";
import { claimAccess } from "@/modules/hr/claims";
import { employedOn, loadEmploymentInputs, loadRules } from "@/modules/hr/month-data";
import { evaluateDay } from "@/modules/hr/payroll-calc";
import {
  attendanceRate,
  type ReportFacts,
  type ReportSummary,
  summarise,
} from "@/modules/hr/report-summary";
import { hrKeys } from "@/modules/hr/rules";
import { tenureOn, tenureText } from "@/modules/hr/tenure";

/*
 * The employee 360° report: one PDF with the last twelve months (whole
 * months, from the first of the month eleven months back, or the joining day)
 * of attendance, approved overtime, tasks, and for the people who may see
 * them the salary paid on approved payrolls and the conveyance claimed, with
 * a short summary on top (report-summary.ts). Made when asked for and sent
 * straight back: nothing is kept on the server. Anyone who opens employee
 * profiles may make it; the money parts follow who sees salaries and claims.
 */

/** Months the report covers, this one included. */
export const REPORT_MONTHS = 12;
/** Tasks listed by title (the newest due first); the counts cover all of them. */
export const REPORT_TASKS = 15;
/** Reports one person may make in a minute. */
export const REPORTS_PER_MINUTE = 20;

type MonthRow = {
  month: string;
  workingDays: number;
  present: number;
  absent: number;
  leave: number;
  late: number;
  overtimeMinutes: number;
  salary: Prisma.Decimal | null;
  conveyance: Prisma.Decimal;
  trips: number;
};

type TaskLine = { title: string; due: string | null; state: string };

const hours = (minutes: number) => Math.round((minutes / 60) * 10) / 10;
const dayCount = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** What the reader may see beyond attendance and tasks. */
function readerSees(ctx: CompanyContext) {
  const salaries = canSeeSalaries(ctx);
  return {
    salaries,
    conveyance: salaries || claimAccess(ctx).see,
    taskTitles: ctx.can("hr.manage") || ctx.can("reminders.manage"),
  };
}

/** Everything in the report, worked out from the records. */
export async function employeeReportData(
  ctx: CompanyContext,
  employeeId: string,
  now: Date = new Date(),
) {
  if (!hrKeys(ctx).view) {
    throw new AppError("FORBIDDEN", "You do not have permission to see employees.");
  }
  const employee = await ctx.db.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw new AppError("NOT_FOUND", "Employee not found.");
  const tz = ctx.company.timezone;
  const companyId = ctx.company.id;
  const today = localDay(now, tz);
  const joined = dateOnly(employee.joinDate);
  if (joined > today) {
    throw new AppError(
      "VALIDATION",
      `${employee.name} joins on ${formatDay(joined)}: there is nothing to report yet.`,
    );
  }
  const exit = dateOnly(employee.exitDate);
  const to = exit && exit < today ? exit : today;
  const monthStart = `${addMonths(to, -(REPORT_MONTHS - 1)).slice(0, 7)}-01`;
  const from = joined > monthStart ? joined : monthStart;
  const sees = readerSees(ctx);
  // Payroll lines from the years the period touches; months outside it are dropped below.
  const [fy, ty] = [Number(from.slice(0, 4)), Number(to.slice(0, 4))];
  const start = startOfDayInZone(from, tz);
  const end = startOfDayInZone(addDays(to, 1), tz);

  const [{ rules }, inputs, items, trips, tasks] = await Promise.all([
    loadRules(companyId, from, to),
    loadEmploymentInputs(companyId, [employee], from, to),
    sees.salaries
      ? ctx.db.payrollItem.findMany({
          where: {
            employeeId: employee.id,
            run: { status: { in: ["APPROVED", "PAID"] }, year: { gte: fy, lte: ty } },
          },
          select: {
            basic: true,
            allowances: true,
            unpaidLeaveDeduction: true,
            bonus: true,
            overtime: true,
            run: { select: { year: true, month: true } },
          },
        })
      : [],
    sees.conveyance
      ? ctx.db.$queryRaw<Array<{ month: string; amount: Prisma.Decimal; trips: bigint }>>`
          SELECT to_char("date", 'YYYY-MM') AS "month",
                 SUM(COALESCE("approvedAmount", "amount")) AS "amount",
                 COUNT(*) AS "trips"
          FROM "StaffClaim"
          WHERE "companyId" = ${companyId} AND "employeeId" = ${employee.id}
            AND "kind" = 'CONVEYANCE' AND "status" = 'APPROVED'
            AND "date" >= ${dateColumn(from)} AND "date" <= ${dateColumn(to)}
          GROUP BY 1`
      : [],
    // Due in the period, still open and due later (on their plate now), or
    // given in the period without a due day.
    ctx.db.task.findMany({
      where: {
        assigneeId: employee.id,
        status: { not: "CANCELLED" },
        OR: [
          { dueAt: { gte: start, lt: end } },
          { dueAt: { gte: end }, status: { not: "DONE" } },
          { dueAt: null, createdAt: { gte: start, lt: end } },
        ],
      },
      select: { title: true, dueAt: true, status: true, completedAt: true, createdAt: true },
      orderBy: [{ dueAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: 500,
    }),
  ]);

  // Attendance and approved overtime, month by month.
  const months = new Map<string, MonthRow>();
  const rowOf = (month: string) => {
    let row = months.get(month);
    if (!row) {
      row = {
        month,
        workingDays: 0,
        present: 0,
        absent: 0,
        leave: 0,
        late: 0,
        overtimeMinutes: 0,
        salary: sees.salaries ? ZERO : null,
        conveyance: ZERO,
        trips: 0,
      };
      months.set(month, row);
    }
    return row;
  };
  const input = inputs.get(employee.id)!;
  for (const day of eachDay(from, to)) {
    const row = rowOf(day.slice(0, 7));
    if (!employedOn(employee, day)) continue;
    const e = evaluateDay(rules, input, day);
    row.overtimeMinutes += e.mark?.overtimeMinutes ?? 0;
    if (e.dayType !== "WORKING") continue;
    row.workingDays += 1;
    row.present += e.present;
    row.absent += e.absent;
    row.leave += e.paidLeave + e.unpaidLeave;
    if (e.late) row.late += 1;
  }

  // Pay on approved payrolls, in the month it is for: salary is basic and
  // allowances less absence (as HR > Money counts it).
  let bonus = ZERO;
  let overtimePay = ZERO;
  for (const i of items) {
    const month = monthKey(i.run.year, i.run.month);
    const row = months.get(month);
    if (!row) continue;
    row.salary = (row.salary ?? ZERO)
      .plus(i.basic)
      .plus(i.allowances)
      .minus(i.unpaidLeaveDeduction);
    bonus = bonus.plus(i.bonus);
    overtimePay = overtimePay.plus(i.overtime);
  }
  for (const t of trips) {
    const row = months.get(t.month);
    if (!row) continue;
    row.conveyance = row.conveyance.plus(t.amount);
    row.trips += Number(t.trips);
  }
  const rows = [...months.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
  const sum = (pick: (r: MonthRow) => number) => rows.reduce((t, r) => t + pick(r), 0);
  const attendance = {
    workingDays: sum((r) => r.workingDays),
    present: sum((r) => r.present),
    absent: sum((r) => r.absent),
    leave: sum((r) => r.leave),
    late: sum((r) => r.late),
  };
  const salary = rows.reduce((t, r) => t.plus(r.salary ?? ZERO), ZERO);
  const conveyance = rows.reduce((t, r) => t.plus(r.conveyance), ZERO);
  const tripCount = sum((r) => r.trips);

  // Tasks that fell due by today (before it, or today and done): done on
  // time (by the end of the due day), done late or overdue. Open counts every
  // task not done yet.
  const counts = { due: 0, onTime: 0, late: 0, overdue: 0, open: 0 };
  const taskLines: TaskLine[] = tasks.map((t) => {
    const due = t.dueAt ? localDay(t.dueAt, tz) : null;
    const done = t.status === "DONE";
    const doneOn = done && t.completedAt ? localDay(t.completedAt, tz) : null;
    const fellDue = due !== null && (due < today || (due === today && done));
    if (fellDue) counts.due += 1;
    let state: string;
    if (done) {
      const late = due !== null && doneOn !== null && doneOn > due;
      if (late) counts.late += 1;
      else if (fellDue) counts.onTime += 1;
      state = late ? `Done late, ${formatDay(doneOn!)}` : due ? "Done on time" : "Done";
    } else {
      counts.open += 1;
      if (due && due < today) {
        counts.overdue += 1;
        state = "Overdue";
      } else {
        state = t.status === "IN_PROGRESS" ? "In progress" : "To do";
      }
    }
    return { title: t.title, due, state };
  });

  const currency = ctx.company.currency;
  const facts: ReportFacts = {
    from,
    to,
    post: [employee.designation, employee.department].filter(Boolean).join(", ") || null,
    tenure: tenureText(tenureOn(joined, addDays(to, 1))),
    attendance,
    overtimeHours: hours(sum((r) => r.overtimeMinutes)),
    tasks: counts,
    money: {
      currency,
      ...(sees.salaries
        ? {
            salary: salary.toFixed(2),
            bonus: bonus.toFixed(2),
            overtimePay: overtimePay.toFixed(2),
          }
        : {}),
      ...(sees.conveyance
        ? { conveyance: { amount: conveyance.toFixed(2), trips: tripCount } }
        : {}),
    },
  };
  return {
    employee,
    today,
    from,
    to,
    sees,
    facts,
    months: rows,
    totals: { salary, bonus, overtimePay, conveyance, trips: tripCount },
    tasks: taskLines,
  };
}

export type EmployeeReportData = Awaited<ReturnType<typeof employeeReportData>>;

/** The report as a printed document, with its summary. */
export function employeeReportDocument(
  ctx: CompanyContext,
  data: EmployeeReportData,
  summary: ReportSummary,
): PrintDocument {
  const { employee: e, facts, sees } = data;
  const currency = ctx.company.currency;
  const money = (v: Prisma.Decimal.Value) => formatAmount(v, 2, currency);
  const a = facts.attendance;
  const t = facts.tasks;
  const period = `${formatDay(data.from)} – ${formatDay(data.to)}`;
  const post = [e.designation, e.department].filter(Boolean).join(" · ");
  const contact = [e.phone, e.email].filter(Boolean).join(" · ");

  const columns = [
    { label: "Month", weight: 1.8 },
    { label: "Present", align: "right" as const },
    { label: "Absent", align: "right" as const },
    { label: "Leave", align: "right" as const },
    { label: "Late", align: "right" as const },
    { label: "Overtime (h)", align: "right" as const, weight: 1.2 },
    ...(sees.salaries
      ? [{ label: `Salary (${currency})`, align: "right" as const, weight: 1.7 }]
      : []),
    ...(sees.conveyance
      ? [{ label: `Conveyance (${currency})`, align: "right" as const, weight: 1.7 }]
      : []),
  ];
  const cells = (r: {
    label: string;
    present: number;
    workingDays: number;
    absent: number;
    leave: number;
    late: number;
    overtimeMinutes: number;
    salary: Prisma.Decimal | null;
    conveyance: Prisma.Decimal;
  }) => [
    r.label,
    r.workingDays > 0 ? `${dayCount(r.present)}/${r.workingDays}` : "–",
    dayCount(r.absent),
    dayCount(r.leave),
    String(r.late),
    String(hours(r.overtimeMinutes)),
    ...(sees.salaries ? [r.salary && !r.salary.isZero() ? money(r.salary) : "–"] : []),
    ...(sees.conveyance ? [r.conveyance.isZero() ? "–" : money(r.conveyance)] : []),
  ];

  return {
    type: "EMPLOYEE_360",
    title: "Employee 360° Report",
    subtitle: e.name,
    reference: `${e.code} · ${data.to}`,
    letterhead: letterheadOf(ctx.company),
    meta: [
      { label: "Period", value: period },
      { label: "Employee code", value: e.code },
      { label: "Made on", value: formatDay(data.today) },
    ],
    parties: [
      {
        heading: "Employee",
        lines: [e.name, ...(post ? [post] : []), ...(contact ? [contact] : [])],
      },
      {
        heading: "Employment",
        lines: [
          `Joined ${formatDay(dateOnly(e.joinDate))}`,
          `With us ${facts.tenure}`,
          ...(e.exitDate ? [`Last working day ${formatDay(dateOnly(e.exitDate))}`] : []),
        ],
      },
    ],
    blocks: [
      {
        kind: "text",
        title: summary.by === "ai" ? "Summary (worded by AI from the figures below)" : "Summary",
        paragraphs: [summary.text],
      },
      {
        kind: "figures",
        figures: [
          {
            label: "Attendance",
            value: attendanceRate(a) ?? "–",
            hint: `${dayCount(a.present)} of ${a.workingDays} working days`,
          },
          { label: "Absent", value: dayCount(a.absent), hint: "days" },
          { label: "Leave", value: dayCount(a.leave), hint: "days" },
          { label: "Late", value: String(a.late), hint: "days" },
          { label: "Overtime", value: `${facts.overtimeHours} h`, hint: "approved" },
          {
            label: "Tasks done on time",
            value: `${t.onTime} of ${t.due}`,
            hint: t.overdue > 0 ? `${t.overdue} overdue` : "none overdue",
          },
          ...(sees.salaries
            ? [
                { label: `Salary (${currency})`, value: money(data.totals.salary) },
                { label: `Bonus (${currency})`, value: money(data.totals.bonus) },
                { label: `Overtime pay (${currency})`, value: money(data.totals.overtimePay) },
              ]
            : []),
          ...(sees.conveyance
            ? [
                {
                  label: `Conveyance (${currency})`,
                  value: money(data.totals.conveyance),
                  hint: `${data.totals.trips} ${data.totals.trips === 1 ? "trip" : "trips"}`,
                },
              ]
            : []),
        ],
      },
      {
        kind: "table",
        title: "Month by month",
        columns,
        rows: [
          ...data.months.map((r) => ({ cells: cells({ ...r, label: monthLabel(r.month) }) })),
          {
            cells: cells({
              label: "Total",
              ...a,
              overtimeMinutes: data.months.reduce((s, r) => s + r.overtimeMinutes, 0),
              salary: sees.salaries ? data.totals.salary : null,
              conveyance: data.totals.conveyance,
            }),
            style: "total" as const,
          },
        ],
      },
      ...(sees.taskTitles
        ? [
            {
              kind: "table" as const,
              title: `Tasks (${data.tasks.length})`,
              columns: [
                { label: "Task", weight: 4 },
                { label: "Due", weight: 1.4 },
                { label: "Where it stands", weight: 2 },
              ],
              rows: data.tasks.slice(0, REPORT_TASKS).map((x) => ({
                cells: [x.title, x.due ? formatDay(x.due) : "No due day", x.state],
              })),
              empty: "No tasks were given in this period.",
            },
          ]
        : []),
      {
        kind: "note",
        text: [
          "Attendance counts working days; a day with no mark counts as present.",
          "Overtime is the hours HR approved.",
          ...(sees.salaries
            ? [
                "Salary is basic and allowances less absence, from approved payrolls, in the month they are for.",
              ]
            : []),
          ...(sees.conveyance ? ["Conveyance is approved trips, on the day of the trip."] : []),
          ...(sees.taskTitles && data.tasks.length > REPORT_TASKS
            ? [`The ${REPORT_TASKS} tasks due last are listed.`]
            : []),
        ].join(" "),
      },
    ],
    signatures: [],
  };
}

/** Makes the report's PDF for download or sharing (logged; nothing is kept). */
export async function employeeReportPdf(
  ctx: CompanyContext,
  employeeId: string,
  meta?: RequestMeta,
  now: Date = new Date(),
) {
  checkRateLimit(`hr-report:${ctx.user.id}`, REPORTS_PER_MINUTE, 60_000);
  const data = await employeeReportData(ctx, employeeId, now);
  const [summary, logo, numbers] = await Promise.all([
    summarise(data.facts),
    loadPrintLogo(ctx.company.id),
    registrationNumbers(ctx.company.id),
  ]);
  const model = employeeReportDocument(ctx, data, summary);
  const registrations = registrationLines(numbers);
  if (registrations.length > 0) model.letterhead = { ...model.letterhead, registrations };
  const bytes = await renderDocumentPdf(model, { logo: logo?.bytes ?? null });
  const e = data.employee;
  await auditInCompany(ctx, meta, {
    action: "EXPORT",
    entityType: "Employee",
    entityId: e.id,
    summary: `Made the 360° report for ${e.code} ${e.name} (${formatDay(data.from)} to ${formatDay(data.to)})`,
  });
  return {
    fileName: documentFileName(ctx.company.name, `360 report ${e.code} ${e.name}`),
    bytes,
    summary,
  };
}
