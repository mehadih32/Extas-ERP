import { addDays, dateColumn, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import type { CompanyContext } from "@/modules/auth/context";
import { readStoredFile } from "@/modules/files/file.service";
import { getAttendanceDay } from "@/modules/hr/attendance.service";
import { shortTenureText, tenureOn } from "@/modules/hr/tenure";

/*
 * The employee directory's extras: each person's photo (their newest "Photo"
 * paper that is a picture), whether they are on approved leave today and how
 * long they have been here; and the four counts over the list (everyone
 * working here, in today, on leave and joined in the last 30 days). Each is
 * one indexed query over the page's people, never one per person.
 */

/** Photo papers shown as pictures (a PDF photo stays a paper only). */
const PICTURE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Days counted as "new": today and the 29 before it. */
export const NEW_JOINER_DAYS = 30;

const today = (ctx: CompanyContext) => localDay(new Date(), ctx.company.timezone);

/** Who may see employees' photos: anyone who sees the employee list. */
const seesEmployees = (ctx: CompanyContext) =>
  ctx.can("hr.view") || ctx.can("hr.manage") || ctx.can("hr.payroll");

/** The newest picture "Photo" paper of each of these people, by employee. */
export async function latestPhotos(ctx: CompanyContext, employeeIds: string[]) {
  if (employeeIds.length === 0) return new Map<string, string>();
  const docs = await ctx.db.employeeDocument.findMany({
    where: {
      employeeId: { in: employeeIds },
      kind: "PHOTO",
      file: { mimeType: { in: PICTURE_TYPES } },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, employeeId: true },
  });
  const photos = new Map<string, string>();
  for (const d of docs) if (!photos.has(d.employeeId)) photos.set(d.employeeId, d.id);
  return photos;
}

/** Approved leave covering `day` for these people: the leave type and whether it is half a day. */
async function leaveToday(ctx: CompanyContext, employeeIds: string[], day: string) {
  if (employeeIds.length === 0) return new Map<string, { leaveType: string; halfDay: boolean }>();
  const rows = await ctx.db.leaveRequest.findMany({
    where: {
      employeeId: { in: employeeIds },
      status: "APPROVED",
      startDate: { lte: dateColumn(day) },
      endDate: { gte: dateColumn(day) },
    },
    select: { employeeId: true, halfDay: true, leaveType: { select: { name: true } } },
  });
  return new Map(
    rows.map((r) => [r.employeeId, { leaveType: r.leaveType.name, halfDay: r.halfDay }]),
  );
}

type Person = {
  id: string;
  joinDate: string;
  exitDate: string | null;
  isCurrent: boolean;
};

/**
 * Per person on a page of the directory: their photo, approved leave today and
 * time here ("2 yrs 3 mos"; for people who left, up to their last day; for
 * people joining later, "Joins on" their day).
 */
export async function directoryExtras(ctx: CompanyContext, people: Person[]) {
  const day = today(ctx);
  const ids = people.map((p) => p.id);
  const [photos, leave] = await Promise.all([latestPhotos(ctx, ids), leaveToday(ctx, ids, day)]);
  return new Map(
    people.map((p) => {
      const until = p.isCurrent ? day : p.exitDate!;
      return [
        p.id,
        {
          photoId: photos.get(p.id) ?? null,
          onLeaveToday: p.isCurrent ? (leave.get(p.id) ?? null) : null,
          /** Null before their first day (the list says when they join). */
          tenure: p.joinDate > day ? null : shortTenureText(tenureOn(p.joinDate, until)),
        },
      ];
    }),
  );
}

/**
 * The counts over the directory, matching the HR Overview: everyone working
 * here (people joining later included), in today (on a working day: everyone
 * employed today who is not marked absent or away on full-day leave), on
 * leave (approved leave today or on long leave) and joined in the last 30 days.
 */
export async function directoryStats(ctx: CompanyContext) {
  const day = today(ctx);
  const current = { OR: [{ exitDate: null }, { exitDate: { gte: dateColumn(day) } }] };
  const [total, register, longLeave, newJoiners] = await Promise.all([
    ctx.db.employee.count({ where: current }),
    getAttendanceDay(ctx, { date: day }),
    ctx.db.employee.findMany({
      where: { AND: [current, { status: "ON_LEAVE" }] },
      select: { id: true },
    }),
    ctx.db.employee.count({
      where: {
        AND: [
          current,
          {
            joinDate: {
              gte: dateColumn(addDays(day, -(NEW_JOINER_DAYS - 1))),
              lte: dateColumn(day),
            },
          },
        ],
      },
    }),
  ]);
  const onApprovedLeave = register.rows.filter((r) => r.leave?.status === "APPROVED");
  const awayAllDay = onApprovedLeave.filter((r) => !r.leave!.halfDay).length;
  const onLeave = new Set([
    ...onApprovedLeave.map((r) => r.employee.id),
    ...longLeave.map((e) => e.id),
  ]);
  const { totals } = register;
  const working = register.dayType === "WORKING";
  return {
    total,
    present: working ? Math.max(0, totals.employees - totals.absent - awayAllDay) : null,
    /** Late and absent today (working days), or the holiday or weekday. */
    late: totals.late,
    absent: totals.absent,
    dayType: register.dayType,
    holiday: register.holiday ?? register.weekday,
    onLeave: onLeave.size,
    onApprovedLeave: onApprovedLeave.length,
    onLongLeave: longLeave.length,
    newJoiners,
  };
}

export type DirectoryStats = Awaited<ReturnType<typeof directoryStats>>;

/**
 * An employee's photo for the directory and profile: their newest picture
 * "Photo" paper, or the one asked for (`photoId`, so a browser can keep it).
 * For anyone who sees employees, and for the employee themselves.
 */
export async function getEmployeePhoto(
  ctx: CompanyContext,
  employeeId: string,
  photoId?: string | null,
) {
  const employee = await ctx.db.employee.findFirst({
    where: { id: employeeId },
    select: { userId: true },
  });
  if (!employee) throw new AppError("NOT_FOUND", "Employee not found.");
  if (!seesEmployees(ctx) && employee.userId !== ctx.user.id) {
    throw new AppError("FORBIDDEN", "You do not have permission to see this photo.");
  }
  const doc = await ctx.db.employeeDocument.findFirst({
    where: {
      employeeId,
      kind: "PHOTO",
      file: { mimeType: { in: PICTURE_TYPES } },
      ...(photoId ? { id: photoId } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, file: true },
  });
  if (!doc) throw new AppError("NOT_FOUND", "No photo yet.");
  return {
    photoId: doc.id,
    file: {
      fileName: doc.file.fileName,
      mimeType: doc.file.mimeType,
      bytes: await readStoredFile(doc.file),
    },
  };
}
