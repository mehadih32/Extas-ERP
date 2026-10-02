import { localDay } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { ZERO } from "@/modules/accounts/balances";
import type { CompanyContext } from "@/modules/auth/context";
import { requireLinkedEmployee } from "@/modules/hr/access";
import { employeeMonth } from "@/modules/hr/attendance.service";
import { employeeInclude, presentEmployee, salaryNow } from "@/modules/hr/employee.service";
import { balancesFor } from "@/modules/hr/leave.service";
import { myPayslips } from "@/modules/hr/payroll.service";
import { loadHrSettings } from "@/modules/hr/setup";

/*
 * The employee portal's home page: the signed-in employee's own profile and
 * pay details, leave balances, this month's attendance (with today's check-in),
 * advances still owed and the latest payslips. Portal calls only ever read the
 * employee linked to the login (portal.self); HR's notes are not shown.
 */
export async function getMyOverview(ctx: CompanyContext) {
  const linked = await requireLinkedEmployee(ctx);
  const day = localDay(new Date(), ctx.company.timezone);
  const [employee, leave, month, advances, payslips, settings] = await Promise.all([
    ctx.db.employee.findUniqueOrThrow({ where: { id: linked.id }, include: employeeInclude }),
    balancesFor(prisma, linked, Number(day.slice(0, 4))),
    employeeMonth(ctx, linked, day.slice(0, 7)),
    ctx.db.salaryAdvance.aggregate({
      where: { employeeId: linked.id, status: "OPEN" },
      _sum: { outstanding: true },
      _count: { _all: true },
    }),
    myPayslips(ctx),
    loadHrSettings(ctx.company.id),
  ]);
  const salary = salaryNow(employee, day);
  return {
    profile: {
      ...presentEmployee(employee, { withSalary: false, day }),
      salary: salary.current.toFixed(2),
      upcomingSalary: salary.upcoming,
      salaryMethod: employee.salaryMethod,
      bankName: employee.bankName,
      bankAccountNumber: employee.bankAccountNumber,
      walletNumber: employee.walletNumber,
    },
    leaveBalances: leave,
    thisMonth: { month: month.month, totals: month.totals },
    today: {
      date: day,
      selfCheckIn: settings.selfCheckIn,
      officeStartTime: settings.officeStartTime,
      mark: month.days.find((d) => d.date === day)?.mark ?? null,
    },
    advances: {
      open: advances._count._all,
      outstanding: (advances._sum.outstanding ?? ZERO).toFixed(2),
    },
    latestPayslips: payslips.slice(0, 3),
  };
}
