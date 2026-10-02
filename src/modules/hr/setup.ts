import type { HrSettings } from "@prisma/client";

import { dateColumn, dateOnly } from "@/lib/dates";
import type { Db } from "@/lib/db-types";
import { prisma } from "@/lib/prisma";
import type { HrCalendar } from "@/modules/hr/calendar";

/** Starting leave types; companies change the days or add their own. */
export const DEFAULT_LEAVE_TYPES: ReadonlyArray<{
  name: string;
  daysPerYear: number;
  isPaid: boolean;
  prorate: boolean;
}> = [
  { name: "Casual Leave", daysPerYear: 10, isPaid: true, prorate: true },
  { name: "Sick Leave", daysPerYear: 14, isPaid: true, prorate: true },
  { name: "Earned Leave", daysPerYear: 16, isPaid: true, prorate: true },
  { name: "Maternity Leave", daysPerYear: 112, isPaid: true, prorate: false },
  { name: "Unpaid Leave", daysPerYear: 0, isPaid: false, prorate: false },
];

/** Gives a company its HR rules row and the default leave types. Safe to repeat. */
export async function ensureHrSetup(companyId: string, db: Db = prisma) {
  await loadHrSettings(companyId, db);
  if ((await db.leaveType.count({ where: { companyId } })) === 0) {
    await db.leaveType.createMany({
      data: DEFAULT_LEAVE_TYPES.map((t) => ({ companyId, ...t })),
      skipDuplicates: true,
    });
  }
}

/** The company's HR rules (created with the defaults on first use). */
export async function loadHrSettings(companyId: string, db: Db = prisma): Promise<HrSettings> {
  const existing = await db.hrSettings.findUnique({ where: { companyId } });
  return (
    existing ?? db.hrSettings.upsert({ where: { companyId }, create: { companyId }, update: {} })
  );
}

/** Weekly days off and the holidays between two days (inclusive). */
export async function loadCalendar(
  companyId: string,
  from: string,
  to: string,
  db: Db = prisma,
  settings?: HrSettings,
): Promise<HrCalendar> {
  const rules = settings ?? (await loadHrSettings(companyId, db));
  const holidays = await db.holiday.findMany({
    where: { companyId, date: { gte: dateColumn(from), lte: dateColumn(to) } },
    select: { date: true },
  });
  return {
    weeklyOffDays: rules.weeklyOffDays,
    holidays: new Set(holidays.map((h) => dateOnly(h.date))),
  };
}
