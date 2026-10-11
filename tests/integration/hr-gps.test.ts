import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

/*
 * GPS attendance: work places with a radius, where the phone was at check-in
 * and check-out (with the IP address and a location mismatch flag), on-duty
 * pings thinned to one every 30 s or 50 m, and HR's live staff map with
 * "No signal" flags. Nothing changes for a company until HR turns it on.
 */
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

import { dateColumn } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { addDays } from "@/modules/accounts/periods";
import * as attendance from "@/modules/hr/attendance.service";
import * as employees from "@/modules/hr/employee.service";
import * as location from "@/modules/hr/location.service";
import { getMyHrScreen } from "@/modules/hr/screens.service";
import * as settings from "@/modules/hr/settings.service";
import { runHousekeeping } from "@/modules/housekeeping/scheduler";
import { createRole } from "@/modules/rbac/role.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

// Two places in Dhaka about 10.9 km apart.
const HEAD_OFFICE = { lat: 23.7806, lng: 90.407 };
const FACTORY = { lat: 23.8759, lng: 90.3795 };
/** A point `metres` north of a place. */
const north = (p: { lat: number; lng: number }, metres: number) => ({
  lat: p.lat + metres / 111_195,
  lng: p.lng,
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
  const hire = (name: string) =>
    employees.createEmployee(admin, { name, joinDate: "2025-01-01", salary: 20000 });
  const sumon = await hire("Sumon Mia");
  await employees.grantPortalAccess(admin, sumon.id, { userId: sumonUser.id });
  const rina = await hire("Rina Begum");
  await employees.grantPortalAccess(admin, rina.id, { userId: rinaUser.id });
  return {
    company,
    admin,
    hr: await contextFor(hrUser.id, company.id),
    viewer: await contextFor(viewerUser.id, company.id),
    sumonCtx: await contextFor(sumonUser.id, company.id),
    rinaCtx: await contextFor(rinaUser.id, company.id),
    sumon,
    rina,
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

async function placesAndGps(env: Env) {
  const head = await location.createWorkPlace(env.hr, { name: "Head office", ...HEAD_OFFICE });
  const factory = await location.createWorkPlace(env.hr, {
    name: "Factory",
    ...FACTORY,
    radiusMeters: 300,
  });
  await settings.updateHrSettings(env.hr, { gpsAttendance: true });
  return { head, factory };
}

/** Moves today's check-in (and its first ping) back, so pings can follow it. */
async function checkedInMinutesAgo(env: Env, employeeId: string, minutes: number) {
  const at = new Date(Date.now() - minutes * 60_000);
  await prisma.attendance.updateMany({ where: { employeeId }, data: { checkIn: at } });
  await prisma.locationPing.updateMany({ where: { employeeId }, data: { at } });
  await prisma.staffPosition.updateMany({ where: { employeeId }, data: { at } });
  return at;
}

const later = (from: Date, seconds: number) => from.getTime() + seconds * 1000;

run("GPS attendance", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("changes nothing until HR turns it on, apart from keeping the IP address", async () => {
    const env = await setup();
    expect(await location.getDutyState(env.sumonCtx)).toBeNull();
    const { mark } = await attendance.checkIn(env.sumonCtx, {}, meta);
    const row = await prisma.attendance.findUniqueOrThrow({ where: { id: mark!.id } });
    expect(row).toMatchObject({ checkInLat: null, checkInIp: "203.0.113.7", checkInAway: false });
    // Pings are not kept while it is off.
    expect(
      await location.recordPings(env.sumonCtx, {
        points: [{ at: Date.now(), ...HEAD_OFFICE }],
      }),
    ).toMatchObject({ kept: 0, onDuty: false });
    expect(await prisma.locationPing.count()).toBe(0);
  });

  it("lets HR keep the work places, and only HR", async () => {
    const env = await setup();
    const { head, factory } = await placesAndGps(env);
    expect(head).toMatchObject({ radiusMeters: 150, staff: 0 });
    expect(head.link).toBe("https://www.google.com/maps/search/?api=1&query=23.780600,90.407000");
    await expectAppError(
      location.createWorkPlace(env.viewer, { name: "Shop", ...HEAD_OFFICE }),
      "FORBIDDEN",
    );
    await expectAppError(
      location.createWorkPlace(env.hr, { name: "Head office", ...FACTORY }),
      "CONFLICT",
    );
    await expect(
      location.createWorkPlace(env.hr, { name: "Shop", lat: 0, lng: 0, radiusMeters: 10 }),
    ).rejects.toBeInstanceOf(ZodError);
    expect((await location.listWorkPlaces(env.viewer)).map((p) => p.name)).toEqual([
      "Factory",
      "Head office",
    ]);

    // Staff are given a place on their record; another company's place is refused.
    await employees.updateEmployee(env.hr, env.rina.id, { workLocationId: factory.id });
    const other = await makeCompany("Other");
    const theirs = await prisma.workLocation.create({
      data: { companyId: other.company.id, name: "Theirs", ...FACTORY },
    });
    await expectAppError(
      employees.updateEmployee(env.hr, env.sumon.id, { workLocationId: theirs.id }),
      "VALIDATION",
    );
    expect((await employees.getEmployee(env.hr, env.rina.id)).workPlace).toEqual({
      id: factory.id,
      name: "Factory",
    });

    await location.updateWorkPlace(env.hr, factory.id, { radiusMeters: 500 });
    // Removing a place takes it off its staff; adding the name again brings it back.
    expect(await location.removeWorkPlace(env.hr, factory.id)).toMatchObject({ unassigned: 1 });
    expect((await employees.getEmployee(env.hr, env.rina.id)).workPlace).toBeNull();
    expect((await location.listWorkPlaces(env.hr)).map((p) => p.name)).toEqual(["Head office"]);
    const back = await location.createWorkPlace(env.hr, { name: "Factory", ...FACTORY });
    expect(back.id).toBe(factory.id);
    expect(back.radiusMeters).toBe(150);
  });

  it("records where each check-in was and flags one away from the person's place", async () => {
    const env = await setup();
    const { head, factory } = await placesAndGps(env);
    await employees.updateEmployee(env.hr, env.rina.id, { workLocationId: factory.id });

    // Location is needed to check in once HR turns it on.
    const refused = await expectAppError(attendance.checkIn(env.sumonCtx, {}, meta), "VALIDATION");
    expect(refused.details).toEqual({ position: ["Turn on location on your phone to check in."] });
    expect(await location.getDutyState(env.sumonCtx)).toMatchObject({
      onDuty: false,
      endpoint: "/api/portal/location/pings",
    });

    // Sumon has no place of his own: he is compared with the nearest, and 60 m is inside.
    await attendance.checkIn(
      env.sumonCtx,
      { position: { ...north(HEAD_OFFICE, 60), accuracy: 12 } },
      meta,
    );
    const sumonMark = await prisma.attendance.findFirstOrThrow({
      where: { employeeId: env.sumon.id },
    });
    expect(sumonMark).toMatchObject({
      checkInPlaceId: head.id,
      checkInDistance: 60,
      checkInAway: false,
      checkInAccuracy: 12,
      checkInIp: "203.0.113.7",
    });
    expect(await location.getDutyState(env.sumonCtx)).toMatchObject({ onDuty: true });
    // The check-in is the shift's first ping and the latest position.
    expect(await prisma.locationPing.count({ where: { employeeId: env.sumon.id } })).toBe(1);
    expect(
      await prisma.staffPosition.findUnique({ where: { employeeId: env.sumon.id } }),
    ).toMatchObject({ source: "WEB" });

    // Rina's place is the factory, so checking in at the head office is a mismatch.
    await attendance.checkIn(
      env.rinaCtx,
      { position: { ...HEAD_OFFICE, accuracy: 20 }, source: "ANDROID" },
      meta,
    );
    const rinaMark = await prisma.attendance.findFirstOrThrow({
      where: { employeeId: env.rina.id },
    });
    expect(rinaMark).toMatchObject({ checkInPlaceId: factory.id, checkInAway: true });
    expect(rinaMark.checkInDistance).toBeGreaterThan(10_000);
    const audit = await prisma.auditLog.findMany({
      where: { entityType: "Attendance" },
      orderBy: { createdAt: "asc" },
    });
    expect(audit.map((a) => a.summary)).toEqual([
      expect.stringMatching(/^Sumon Mia checked in at \d\d:\d\d( \(late\))?, at Head office$/),
      expect.stringMatching(
        /^Rina Begum checked in at \d\d:\d\d( \(late\))?, 11 km from Factory \(location mismatch\)$/,
      ),
    ]);

    // HR's day register shows it; the exact spot and IP only to HR managers.
    const day = await attendance.getAttendanceDay(env.hr);
    const rinaRow = day.rows.find((r) => r.employee.id === env.rina.id)!;
    expect(rinaRow.where?.in).toMatchObject({
      located: true,
      placeName: "Factory",
      away: true,
      ip: "203.0.113.7",
    });
    expect(rinaRow.where?.in?.link).toMatch(/^https:\/\/www\.google\.com\/maps/);
    const seen = await attendance.getAttendanceDay(env.viewer);
    expect(seen.rows.find((r) => r.employee.id === env.rina.id)!.where?.in).toMatchObject({
      placeName: "Factory",
      away: true,
      lat: null,
      ip: null,
      link: null,
    });
  });

  it("keeps on-duty pings every 30 s or 50 m, and only while checked in", async () => {
    const env = await setup();
    await placesAndGps(env);
    const before = await location.recordPings(env.sumonCtx, {
      points: [{ at: Date.now(), ...HEAD_OFFICE }],
    });
    expect(before).toMatchObject({ kept: 0, onDuty: false });

    await attendance.checkIn(env.sumonCtx, { position: { ...HEAD_OFFICE, accuracy: 10 } }, meta);
    const start = await checkedInMinutesAgo(env, env.sumon.id, 30);
    const result = await location.recordPings(env.sumonCtx, {
      source: "ANDROID",
      points: [
        // Before the check-in: not this shift's.
        { at: later(start, -600), ...HEAD_OFFICE },
        // 10 s on and a few metres away: nothing new.
        { at: later(start, 10), ...north(HEAD_OFFICE, 5), accuracy: 8 },
        // 40 s on: kept.
        { at: later(start, 40), ...north(HEAD_OFFICE, 10), accuracy: 8 },
        // 10 s later but 120 m on: kept.
        { at: later(start, 50), ...north(HEAD_OFFICE, 130), accuracy: 8 },
        // Too vague to use.
        { at: later(start, 120), ...north(HEAD_OFFICE, 900), accuracy: 5000 },
        // Out of order, and given as ISO time: kept in its place.
        { at: new Date(later(start, 600)).toISOString(), ...north(HEAD_OFFICE, 2000) },
        // Ten minutes in the future: not a real position.
        { at: Date.now() + 600_000, ...FACTORY },
      ],
    });
    expect(result).toEqual({ kept: 3, onDuty: true, sendEverySeconds: 60 });
    // Sending the same batch again keeps nothing more.
    const again = await location.recordPings(env.sumonCtx, {
      points: [{ at: later(start, 40), ...north(HEAD_OFFICE, 10) }],
    });
    expect(again.kept).toBe(0);
    const pings = await prisma.locationPing.findMany({
      where: { employeeId: env.sumon.id },
      orderBy: { at: "asc" },
    });
    expect(pings.map((p) => (p.at.getTime() - start.getTime()) / 1000)).toEqual([0, 40, 50, 600]);
    expect(pings.slice(1).every((p) => p.source === "ANDROID")).toBe(true);
    expect(
      await prisma.staffPosition.findUniqueOrThrow({ where: { employeeId: env.sumon.id } }),
    ).toMatchObject({ at: new Date(later(start, 600)), source: "ANDROID" });

    // Bad input is refused outright.
    await expect(location.recordPings(env.sumonCtx, { points: [] })).rejects.toBeInstanceOf(
      ZodError,
    );
    await expect(
      location.recordPings(env.sumonCtx, { points: [{ at: Date.now(), lat: 95, lng: 0 }] }),
    ).rejects.toBeInstanceOf(ZodError);

    // Checking out ends the shift (allowed without a position) and the pings stop.
    await attendance.checkOut(env.sumonCtx, {}, meta);
    expect(
      await prisma.attendance.findFirstOrThrow({ where: { employeeId: env.sumon.id } }),
    ).toMatchObject({ checkOutLat: null, checkOutIp: "203.0.113.7", checkOutAway: false });
    expect(
      await location.recordPings(env.sumonCtx, { points: [{ at: Date.now(), ...FACTORY }] }),
    ).toMatchObject({ kept: 0, onDuty: false });
    expect(await location.getDutyState(env.sumonCtx)).toMatchObject({ onDuty: false });
  });

  it("shows HR who is on duty, where they were last seen, and who has gone quiet", async () => {
    const env = await setup();
    const { factory } = await placesAndGps(env);
    await employees.updateEmployee(env.hr, env.rina.id, { workLocationId: factory.id });
    await attendance.checkIn(env.sumonCtx, { position: { ...HEAD_OFFICE, accuracy: 10 } }, meta);
    await attendance.checkIn(env.rinaCtx, { position: { ...HEAD_OFFICE, accuracy: 10 } }, meta);
    const start = await checkedInMinutesAgo(env, env.sumon.id, 30);
    await checkedInMinutesAgo(env, env.rina.id, 30);
    await location.recordPings(env.sumonCtx, {
      points: [
        { at: later(start, 60), ...north(HEAD_OFFICE, 400), accuracy: 10 },
        { at: Date.now() - 60_000, ...north(HEAD_OFFICE, 1400), accuracy: 10 },
      ],
    });

    await expectAppError(location.getStaffMap(env.viewer), "FORBIDDEN");
    await expectAppError(location.getStaffMap(env.sumonCtx), "FORBIDDEN");
    const map = await location.getStaffMap(env.hr);
    expect(map).toMatchObject({
      gpsAttendance: true,
      counts: { onDuty: 2, noSignal: 1, checkedOut: 0, away: 1 },
    });
    expect(map.places.map((p) => p.name)).toEqual(["Factory", "Head office"]);
    // Rina has sent nothing for 30 minutes: first on the list, flagged.
    expect(map.rows.map((r) => [r.name, r.state])).toEqual([
      ["Rina Begum", "NO_SIGNAL"],
      ["Sumon Mia", "ON_DUTY"],
    ]);
    expect(map.rows[0]!.quietSince).toMatch(/^\d\d:\d\d$/);
    expect(map.rows[0]!.checkIn).toMatchObject({ placeName: "Factory", away: true });
    expect(map.rows[1]!.last?.lat).toBeCloseTo(north(HEAD_OFFICE, 1400).lat, 6);
    expect(map.trail).toBeNull();

    const traced = await location.getStaffMap(env.hr, { person: env.sumon.id });
    expect(traced.trail).toMatchObject({ name: "Sumon Mia", cut: false });
    expect(traced.trail!.points).toHaveLength(3);
    expect(traced.trail!.metres).toBeGreaterThan(1300);
    expect(traced.trail!.route).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&origin=/);

    // Checked out: grey on the map, no flag.
    await attendance.checkOut(env.rinaCtx, { position: FACTORY }, meta);
    const after = await location.getStaffMap(env.hr);
    expect(after.rows.find((r) => r.name === "Rina Begum")).toMatchObject({
      state: "CHECKED_OUT",
      quietSince: null,
      checkOut: { placeName: "Factory", away: false },
    });
  });

  it("tells the person where they checked in, and closes last night's shift on check-out", async () => {
    const env = await setup();
    const { head } = await placesAndGps(env);
    const checkedIn = await attendance.checkIn(
      env.sumonCtx,
      { position: { ...north(HEAD_OFFICE, 900), accuracy: 15 } },
      meta,
    );
    expect(checkedIn.place).toEqual({ name: "Head office", distance: 900, away: true });

    // Rina checked in yesterday evening and is still on her night shift.
    const today = (await attendance.getAttendanceDay(env.hr)).date;
    const yesterday = addDays(today, -1);
    const since = new Date(Date.now() - 20 * 60_000);
    await prisma.attendance.create({
      data: {
        companyId: env.company.id,
        employeeId: env.rina.id,
        date: dateColumn(yesterday),
        status: "PRESENT",
        checkIn: since,
        source: "SELF",
        checkInLat: HEAD_OFFICE.lat,
        checkInLng: HEAD_OFFICE.lng,
        checkInPlaceId: head.id,
      },
    });
    expect(await location.getDutyState(env.rinaCtx)).toMatchObject({ onDuty: true });
    const screen = await getMyHrScreen(env.rinaCtx);
    expect(screen.openSince).toMatch(/^\d\d:\d\d$/);
    expect(screen.can).toMatchObject({ checkOut: true });

    const out = await attendance.checkOut(env.rinaCtx, { position: HEAD_OFFICE }, meta);
    expect(out.date).toBe(yesterday);
    expect(out.place).toMatchObject({ name: "Head office", away: false });
    const closed = await prisma.attendance.findFirstOrThrow({ where: { employeeId: env.rina.id } });
    expect(closed.checkOut).not.toBeNull();
    expect(await location.getDutyState(env.rinaCtx)).toMatchObject({ onDuty: false });
    expect((await getMyHrScreen(env.rinaCtx)).openSince).toBeNull();
    // Nothing else is open, so a second check-out is refused as before.
    await expectAppError(attendance.checkOut(env.rinaCtx, {}, meta), "CONFLICT");
  });

  it("does not start a shift from times HR types in, and clears pings after 90 days", async () => {
    const env = await setup();
    await placesAndGps(env);
    const today = (await attendance.getAttendanceDay(env.hr)).date;
    await attendance.markAttendance(env.hr, {
      date: today,
      entries: [{ employeeId: env.sumon.id, status: "LATE", checkIn: "00:01" }],
    });
    expect(await location.getDutyState(env.sumonCtx)).toMatchObject({ onDuty: false });
    expect((await location.getStaffMap(env.hr)).rows).toEqual([]);

    await prisma.locationPing.createMany({
      data: [91, 89].map((days) => ({
        companyId: env.company.id,
        employeeId: env.sumon.id,
        at: new Date(Date.now() - days * 24 * 3_600_000),
        lat: HEAD_OFFICE.lat,
        lng: HEAD_OFFICE.lng,
      })),
    });
    expect((await runHousekeeping()).pingsRemoved).toBe(1);
    expect(await prisma.locationPing.count()).toBe(1);
  });
});
