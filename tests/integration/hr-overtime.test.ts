import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Shadow overtime: a self check-out after the working day ends (or on a day
 * off) records overtime for HR, silently. Staff never see the hours, not on My
 * HR nor through the portal. HR approves it as found, changes the hours with a
 * reason or rejects it, and only approved minutes go on the day's attendance,
 * which payroll pays. The location trail flags someone who left the work place
 * before checking out.
 */
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import * as attendance from "@/modules/hr/attendance.service";
import * as employees from "@/modules/hr/employee.service";
import * as location from "@/modules/hr/location.service";
import * as overtime from "@/modules/hr/overtime.service";
import * as payroll from "@/modules/hr/payroll.service";
import { getMyHrScreen, getPayrollScreen } from "@/modules/hr/screens.service";
import * as settings from "@/modules/hr/settings.service";
import { createRole } from "@/modules/rbac/role.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/** A Dhaka wall-clock time; 5 Oct 2026 is a Monday, 9 Oct a Friday (the weekly day off). */
const at = (time: string, day = "2026-10-05") => new Date(`${day}T${time}:00+06:00`);
const HEAD_OFFICE = { lat: 23.7806, lng: 90.407 };
const north = (metres: number) => ({
  lat: HEAD_OFFICE.lat + metres / 111_195,
  lng: HEAD_OFFICE.lng,
});
const meta = { ipAddress: "203.0.113.7", userAgent: "Mozilla/5.0 (Linux; Android 14)" };

async function setup() {
  const { company, roles } = await makeCompany("Extras");
  const member = async (roleId: string, who: string) => {
    const user = await makeUser(`${who}@extras.test`);
    await addToCompany(user.id, company.id, roleId);
    return user;
  };
  const owner = await member(roles.SUPER_ADMIN, "owner");
  const admin = await contextFor(owner.id, company.id);
  const hrRole = await createRole(admin, {
    name: "HR Manager",
    permissions: ["hr.view", "hr.manage", "portal.self"],
  });
  const viewerRole = await createRole(admin, { name: "HR Viewer", permissions: ["hr.view"] });
  const hrUser = await member(hrRole.id, "hr");
  const viewerUser = await member(viewerRole.id, "viewer");
  const sumonUser = await member(roles.EMPLOYEE, "sumon");
  const rinaUser = await member(roles.EMPLOYEE, "rina");
  const hire = (name: string, userId: string) =>
    employees
      .createEmployee(admin, { name, joinDate: "2025-01-01", salary: 30000, overtimeRate: 200 })
      .then(async (e) => {
        await employees.grantPortalAccess(admin, e.id, { userId });
        return e;
      });
  const sumon = await hire("Sumon Mia", sumonUser.id);
  const rina = await hire("Rina Begum", rinaUser.id);
  const nasrin = await hire("Nasrin Akter", hrUser.id);
  return {
    admin,
    hr: await contextFor(hrUser.id, company.id),
    viewer: await contextFor(viewerUser.id, company.id),
    sumonCtx: await contextFor(sumonUser.id, company.id),
    rinaCtx: await contextFor(rinaUser.id, company.id),
    sumon,
    rina,
    nasrin,
  };
}
type Env = Awaited<ReturnType<typeof setup>>;

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

/** Checks someone in and out at these Dhaka times. */
async function shift(
  ctx: Env["sumonCtx"],
  inAt: Date,
  outAt: Date,
  positions: { in?: object; out?: object } = {},
) {
  vi.setSystemTime(inAt);
  await attendance.checkIn(ctx, positions.in ? { position: positions.in } : {}, meta);
  vi.setSystemTime(outAt);
  return attendance.checkOut(ctx, positions.out ? { position: positions.out } : {}, meta);
}

const entryOf = (employeeId: string) =>
  prisma.overtimeEntry.findFirstOrThrow({ where: { employeeId }, orderBy: { date: "desc" } });
const registerOf = (id: string) =>
  prisma.attendance.findUniqueOrThrow({ where: { id } }).then((a) => a.overtimeMinutes);

run("Shadow overtime", () => {
  let env: Env;
  beforeEach(async () => {
    await resetDb();
    env = await setup();
    vi.useFakeTimers({ now: at("08:00"), toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("finds overtime at check-out without the employee ever seeing it", async () => {
    const out = await shift(env.sumonCtx, at("08:55"), at("20:40"));
    expect(out.mark).not.toHaveProperty("overtimeMinutes");

    const entry = await entryOf(env.sumon.id);
    // 18:00 to 20:40 is 160 minutes: 150 in whole 15-minute steps.
    expect(entry).toMatchObject({
      status: "PENDING",
      basis: "AFTER_HOURS",
      detectedMinutes: 150,
      startsAt: at("18:00"),
      approvedMinutes: null,
    });
    // Nothing is paid until HR approves it.
    expect(await registerOf(entry.attendanceId)).toBe(0);

    // The employee's own month, My HR and the portal API carry no overtime at all.
    const mine = await attendance.myAttendance(env.sumonCtx, { month: "2026-10" });
    expect(mine.totals).not.toHaveProperty("overtimeHours");
    expect(mine.days.find((d) => d.date === "2026-10-05")!.mark).not.toHaveProperty(
      "overtimeMinutes",
    );
    const myHr = await getMyHrScreen(env.sumonCtx);
    expect(myHr.thisMonth.totals).not.toHaveProperty("overtimeHours");
    expect(JSON.stringify(myHr)).not.toMatch(/overtime(Minutes|Hours)/);

    // HR sees it, with the pay at the person's rate; nobody else does.
    const ledger = await overtime.getOvertimeLedger(env.hr, { month: "2026-10" });
    expect(ledger.totals.waiting).toEqual({ count: 1, minutes: 150 });
    expect(ledger.rows[0]).toMatchObject({
      employee: { name: "Sumon Mia" },
      checkIn: "08:55",
      checkOut: "20:40",
      startsAt: "18:00",
      detectedMinutes: 150,
      pay: "500.00",
      flags: [],
      can: { decide: true },
    });
    await expectAppError(overtime.getOvertimeLedger(env.viewer, {}), "FORBIDDEN");
    await expectAppError(overtime.getOvertimeLedger(env.sumonCtx, {}), "FORBIDDEN");
    await expectAppError(
      overtime.decideOvertime(env.sumonCtx, entry.id, { decision: "APPROVE" }),
      "FORBIDDEN",
    );
  });

  it("puts only approved minutes on attendance, so only they reach payroll", async () => {
    await shift(env.sumonCtx, at("09:00"), at("21:10"));
    const entry = await entryOf(env.sumon.id);
    expect(entry.detectedMinutes).toBe(180);

    await overtime.decideOvertime(env.hr, entry.id, { decision: "APPROVE" }, meta);
    expect(await registerOf(entry.attendanceId)).toBe(180);
    expect(await entryOf(env.sumon.id)).toMatchObject({ status: "APPROVED", approvedMinutes: 180 });

    // Changing the hours needs a reason.
    const why = await expectAppError(
      overtime.decideOvertime(env.hr, entry.id, { decision: "APPROVE", minutes: 60 }),
      "VALIDATION",
    );
    expect(why.details?.reason).toBeDefined();
    await overtime.decideOvertime(
      env.hr,
      entry.id,
      { decision: "APPROVE", minutes: 60, reason: "Stayed for a delivery that came at 7" },
      meta,
    );
    expect(await registerOf(entry.attendanceId)).toBe(60);

    const draft = await payroll.createPayrollRun(env.admin, { month: "2026-10" });
    const line = () =>
      payroll
        .getPayrollRun(env.admin, draft.id)
        .then((r) => r.items.find((i) => i.employee.id === env.sumon.id)!);
    expect(await line()).toMatchObject({ overtimeHours: "1.00", overtime: "200.00" });

    // Rejecting takes the hours off again; the draft follows once worked out again.
    await overtime.decideOvertime(
      env.hr,
      entry.id,
      { decision: "REJECT", reason: "Personal work after hours" },
      meta,
    );
    expect(await registerOf(entry.attendanceId)).toBe(0);
    await payroll.recalculatePayrollRun(env.admin, draft.id);
    expect(await line()).toMatchObject({ overtimeHours: "0.00", overtime: "0.00" });

    // Once the payroll is approved, the month's overtime is final.
    await overtime.decideOvertime(env.hr, entry.id, { decision: "APPROVE" }, meta);
    await payroll.recalculatePayrollRun(env.admin, draft.id);
    await payroll.approvePayrollRun(env.admin, draft.id);
    await expectAppError(
      overtime.decideOvertime(env.hr, entry.id, { decision: "REJECT", reason: "Too late now" }),
      "CONFLICT",
    );
    const ledger = await overtime.getOvertimeLedger(env.hr, { month: "2026-10" });
    expect(ledger.closed).toBe(true);
    expect(ledger.rows[0]!.can.decide).toBe(false);

    const log = await prisma.auditLog.findMany({
      where: { entityType: "OvertimeEntry", entityId: entry.id },
      orderBy: { createdAt: "asc" },
    });
    expect(log.map((l) => l.summary)).toEqual([
      "Approved 3 h overtime for Sumon Mia on 2026-10-05 as found",
      "Approved 1 h overtime for Sumon Mia on 2026-10-05 (found 3 h: Stayed for a delivery that came at 7)",
      "Rejected 3 h overtime for Sumon Mia on 2026-10-05: Personal work after hours",
      "Approved 3 h overtime for Sumon Mia on 2026-10-05 as found",
    ]);
  });

  it("counts all of a day off, ignores short stays and stops when HR turns it off", async () => {
    await shift(env.sumonCtx, at("10:00", "2026-10-09"), at("14:20", "2026-10-09"));
    expect(await entryOf(env.sumon.id)).toMatchObject({
      basis: "DAY_OFF",
      detectedMinutes: 255,
      startsAt: at("10:00", "2026-10-09"),
    });

    // 20 minutes past the end is under the 30-minute minimum.
    await shift(env.rinaCtx, at("09:00"), at("18:20"));
    expect(await prisma.overtimeEntry.count({ where: { employeeId: env.rina.id } })).toBe(0);

    await settings.updateHrSettings(env.hr, { shadowOvertime: false });
    await shift(env.rinaCtx, at("09:00", "2026-10-06"), at("22:00", "2026-10-06"));
    expect(await prisma.overtimeEntry.count({ where: { employeeId: env.rina.id } })).toBe(0);

    // The end of the day and the minimum are HR's rules.
    await settings.updateHrSettings(env.hr, {
      shadowOvertime: true,
      officeEndTime: "17:00",
      overtimeMinMinutes: 15,
    });
    await shift(env.rinaCtx, at("09:00", "2026-10-07"), at("17:20", "2026-10-07"));
    expect(await entryOf(env.rina.id)).toMatchObject({ detectedMinutes: 15 });
    await expectAppError(
      settings.updateHrSettings(env.hr, { officeEndTime: "09:00" }),
      "VALIDATION",
    );
  });

  it("flags someone who left before checking out, and approves the rest in one go", async () => {
    await location.createWorkPlace(env.hr, { name: "Head office", ...HEAD_OFFICE });
    await settings.updateHrSettings(env.hr, { gpsAttendance: true });

    // Rina checks in at the office, leaves at 19:20 and checks out from home at 21:50.
    vi.setSystemTime(at("09:00"));
    await attendance.checkIn(env.rinaCtx, { position: { ...north(10), accuracy: 12 } }, meta);
    await prisma.locationPing.createMany({
      data: [
        { at: at("18:30"), ...north(20) },
        { at: at("19:20"), ...north(60) },
        { at: at("19:40"), ...north(3000) },
        { at: at("21:30"), ...north(9000) },
      ].map((p) => ({ ...p, companyId: env.admin.company.id, employeeId: env.rina.id })),
    });
    vi.setSystemTime(at("21:50"));
    await attendance.checkOut(env.rinaCtx, { position: { ...north(9000), accuracy: 15 } }, meta);
    expect(await entryOf(env.rina.id)).toMatchObject({
      detectedMinutes: 225,
      suggestedMinutes: 75,
      lastAtPlace: at("19:20"),
    });

    // Sumon stays at the office until he checks out at 19:05: nothing to look at.
    await shift(env.sumonCtx, at("09:00"), at("19:05"), {
      in: { ...north(5), accuracy: 10 },
      out: { ...north(8), accuracy: 10 },
    });
    // Nasrin (HR herself) has overtime too: someone else decides it.
    const nasrinCtx = env.hr;
    await shift(nasrinCtx, at("09:00"), at("19:30"), {
      in: { ...north(5), accuracy: 10 },
      out: { ...north(5), accuracy: 10 },
    });

    const ledger = await overtime.getOvertimeLedger(env.hr, { month: "2026-10" });
    const row = (name: string) => ledger.rows.find((r) => r.employee.name === name)!;
    expect(row("Rina Begum")).toMatchObject({
      flags: ["LEFT_EARLY", "AWAY_AT_CHECK_OUT"],
      lastAtPlace: "19:20",
      suggestedMinutes: 75,
      placeName: "Head office",
    });
    expect(row("Sumon Mia").flags).toEqual([]);
    expect(row("Nasrin Akter")).toMatchObject({ own: true, can: { decide: false } });
    expect(ledger.totals).toMatchObject({ needsLook: 1, readyToApprove: 1 });

    const all = await overtime.approveAllOvertime(env.hr, { month: "2026-10" }, meta);
    expect(all).toEqual({ approved: 1, needsLook: 1 });
    expect(await entryOf(env.sumon.id)).toMatchObject({ status: "APPROVED", approvedMinutes: 60 });
    expect(await entryOf(env.rina.id)).toMatchObject({ status: "PENDING" });
    const own = await entryOf(env.nasrin.id);
    expect(own.status).toBe("PENDING");
    await expectAppError(
      overtime.decideOvertime(env.hr, own.id, { decision: "APPROVE" }),
      "FORBIDDEN",
    );
    await overtime.decideOvertime(env.admin, own.id, { decision: "APPROVE" }, meta);

    // The payroll draft reminds whoever prepares it of overtime still waiting.
    const draft = await payroll.createPayrollRun(env.admin, { month: "2026-10" });
    const screen = await getPayrollScreen(env.admin, draft.id);
    expect(screen.notes.overtime).toMatch(/^1 overtime entry found in October 2026 still waits/);
    expect(screen.overtimeHref).toBe("2026-10");

    // HR approves what the trail suggests, with the reason it gives.
    const rina = await entryOf(env.rina.id);
    await overtime.decideOvertime(
      env.hr,
      rina.id,
      {
        decision: "APPROVE",
        minutes: 75,
        reason: "Until 19:20, when the location trail shows Rina Begum left Head office.",
      },
      meta,
    );
    expect(await registerOf(rina.attendanceId)).toBe(75);
    expect((await getPayrollScreen(env.admin, draft.id)).notes.overtime).toBeNull();
  });

  it("leaves an HR decision alone and drops overtime when the day is cleared", async () => {
    await shift(env.sumonCtx, at("09:00"), at("20:00"));
    const entry = await entryOf(env.sumon.id);
    await overtime.decideOvertime(env.hr, entry.id, { decision: "APPROVE" }, meta);
    // Re-marking the day in the register keeps the approved overtime it shows.
    const day = await attendance.getAttendanceDay(env.hr, { date: "2026-10-05" });
    const mark = day.rows.find((r) => r.employee.id === env.sumon.id)!.mark!;
    expect(mark.overtimeMinutes).toBe(120);

    await attendance.clearAttendance(env.hr, entry.attendanceId, meta);
    expect(await prisma.overtimeEntry.count({ where: { id: entry.id } })).toBe(0);
  });
});
