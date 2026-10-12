import type { Attendance, PingSource, Prisma, WorkLocation } from "@prisma/client";

import { addDays, dateColumn, localDay, localTime } from "@/lib/dates";
import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { assertCanManageHr, linkedEmployee, requireLinkedEmployee } from "@/modules/hr/access";
import {
  checkAgainstPlaces,
  type Fix,
  isLatLng,
  KEEP_AFTER_SECONDS,
  PING_DAYS_KEPT,
  PING_EVERY_SECONDS,
  type Place,
  type PlaceCheck,
  pointLink,
  routeLink,
  SEND_EVERY_SECONDS,
  SIGNAL_LOST_MINUTES,
  thinPings,
  trailMetres,
  WORST_ACCURACY_METRES,
} from "@/modules/hr/geo";
import {
  locationPingsSchema,
  staffMapQuery,
  updateWorkPlaceSchema,
  workPlaceSchema,
} from "@/modules/hr/schemas";
import { loadHrSettings } from "@/modules/hr/setup";

/*
 * GPS attendance (HrSettings.gpsAttendance, off until HR turns it on):
 *   - Work places: where staff check in, each with a radius. A check-in or
 *     check-out records where the phone was, its IP address, the place it was
 *     compared with (the person's own place, or the nearest) and whether it was
 *     outside the radius ("Location mismatch").
 *   - While someone is checked in, their phone sends its position: My HR in a
 *     browser while it is open, or the Android app's background service with
 *     the screen off. The server keeps a ping only every KEEP_AFTER_SECONDS or
 *     KEEP_AFTER_METRES, keeps each person's latest position in one row
 *     (StaffPosition) for the live map, and deletes pings after PING_DAYS_KEPT.
 *   - HR (hr.manage) sees the live staff map: who is on duty, where they were
 *     last seen, who has had no signal for SIGNAL_LOST_MINUTES, and one
 *     person's trail for the day.
 * Off duty, no position is asked for or kept.
 */

const TX_OPTIONS = { timeout: 30_000 };
/** A shift still open after this long is treated as forgotten, not on duty. */
export const LONGEST_SHIFT_HOURS = 16;
/** One person's trail on the map: at most this many points. */
const TRAIL_LIMIT = 3000;
export const PINGS_PATH = "/api/portal/location/pings";

function assertHrRead(ctx: CompanyContext) {
  if (!ctx.can("hr.view") && !ctx.can("hr.manage") && !ctx.can("hr.payroll")) {
    throw new AppError("FORBIDDEN", "You do not have permission to see HR.");
  }
}

export function placeOf(p: WorkLocation): Place {
  return { id: p.id, name: p.name, lat: p.lat, lng: p.lng, radiusMeters: p.radiusMeters };
}

/** The company's work places in use, by name. */
export async function activePlaces(db: Db, companyId: string): Promise<WorkLocation[]> {
  return db.workLocation.findMany({
    where: { companyId, isActive: true },
    orderBy: { name: "asc" },
  });
}

/** Where a position is compared with for someone (their own place, or the nearest). */
export async function placeCheck(
  db: Db,
  companyId: string,
  ownPlaceId: string | null,
  fix: Fix,
): Promise<PlaceCheck | null> {
  const places = await activePlaces(db, companyId);
  return checkAgainstPlaces(fix, places.map(placeOf), ownPlaceId);
}

// =============================================================================
// Work places (HR & payroll > Holidays & rules)
// =============================================================================

function presentPlace(p: WorkLocation & { _count?: { employees: number } }) {
  return {
    id: p.id,
    name: p.name,
    address: p.address,
    lat: p.lat,
    lng: p.lng,
    radiusMeters: p.radiusMeters,
    link: pointLink(p),
    staff: p._count?.employees ?? 0,
  };
}

export type PresentedPlace = ReturnType<typeof presentPlace>;

export async function listWorkPlaces(ctx: CompanyContext) {
  assertHrRead(ctx);
  const places = await ctx.db.workLocation.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    include: {
      _count: { select: { employees: { where: { status: { in: ["ACTIVE", "ON_LEAVE"] } } } } },
    },
  });
  return places.map(presentPlace);
}

/** Checks a work place given for an employee belongs to this company and is in use. */
export async function assertWorkPlace(ctx: CompanyContext, id: string | null | undefined) {
  if (!id) return;
  const place = await ctx.db.workLocation.findFirst({ where: { id, isActive: true } });
  if (!place) {
    throw new AppError("VALIDATION", "Choose one of the company's work places.", {
      workLocationId: ["Choose one of the company's work places."],
    });
  }
}

export async function createWorkPlace(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanManageHr(ctx, "Only HR can add work places.");
  const input = workPlaceSchema.parse(raw);
  const companyId = ctx.company.id;
  const saved = await prisma.$transaction(async (tx) => {
    const same = await tx.workLocation.findUnique({
      where: { companyId_name: { companyId, name: input.name } },
    });
    if (same?.isActive) {
      throw new AppError("CONFLICT", `There is already a work place called ${input.name}.`, {
        name: [`There is already a work place called ${input.name}.`],
      });
    }
    // A removed place with the same name comes back with the new details.
    const place = same
      ? await tx.workLocation.update({
          where: { id: same.id },
          data: { ...input, address: input.address ?? null, isActive: true },
        })
      : await tx.workLocation.create({
          data: { ...input, address: input.address ?? null, companyId },
        });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "WorkLocation",
        entityId: place.id,
        summary: `Added work place ${place.name} (${place.radiusMeters} m around ${place.lat.toFixed(5)}, ${place.lng.toFixed(5)})`,
      },
      tx,
    );
    return place;
  }, TX_OPTIONS);
  return presentPlace(saved);
}

export async function updateWorkPlace(
  ctx: CompanyContext,
  placeId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageHr(ctx, "Only HR can change work places.");
  const input = updateWorkPlaceSchema.parse(raw);
  const place = await ctx.db.workLocation.findFirst({ where: { id: placeId, isActive: true } });
  if (!place) throw new AppError("NOT_FOUND", "Work place not found.");
  if (input.name && input.name !== place.name) {
    const same = await ctx.db.workLocation.findFirst({
      where: { name: input.name, id: { not: place.id } },
    });
    if (same) {
      const message = same.isActive
        ? `There is already a work place called ${input.name}.`
        : `A removed work place is called ${input.name}. Add it again instead.`;
      throw new AppError("CONFLICT", message, { name: [message] });
    }
  }
  const saved = await prisma.$transaction(async (tx) => {
    const updated = await tx.workLocation.update({ where: { id: place.id }, data: input });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "WorkLocation",
        entityId: place.id,
        summary: `Changed work place ${updated.name}: ${Object.keys(input).join(", ")}`,
        before: { lat: place.lat, lng: place.lng, radiusMeters: place.radiusMeters },
        after: { lat: updated.lat, lng: updated.lng, radiusMeters: updated.radiusMeters },
      },
      tx,
    );
    return updated;
  }, TX_OPTIONS);
  return presentPlace(saved);
}

/**
 * Removes a work place from use. Past check-ins keep its name; staff who had
 * it are compared with the nearest place from now on.
 */
export async function removeWorkPlace(ctx: CompanyContext, placeId: string, meta?: RequestMeta) {
  assertCanManageHr(ctx, "Only HR can remove work places.");
  const place = await ctx.db.workLocation.findFirst({ where: { id: placeId, isActive: true } });
  if (!place) throw new AppError("NOT_FOUND", "Work place not found.");
  const moved = await prisma.$transaction(async (tx) => {
    await tx.workLocation.update({ where: { id: place.id }, data: { isActive: false } });
    const staff = await tx.employee.updateMany({
      where: { companyId: ctx.company.id, workLocationId: place.id },
      data: { workLocationId: null },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "DELETE",
        entityType: "WorkLocation",
        entityId: place.id,
        summary: `Removed work place ${place.name}${staff.count ? ` (${staff.count} people no longer assigned)` : ""}`,
      },
      tx,
    );
    return staff.count;
  }, TX_OPTIONS);
  return { id: place.id, unassigned: moved };
}

// =============================================================================
// On duty: the open shift and the pings
// =============================================================================

/**
 * Check-ins the person made themselves (a time HR typed in for them does not
 * start a shift on the map or on their phone).
 */
const SELF_CHECK_IN = {
  OR: [{ source: "SELF" }, { checkInLat: { not: null } }],
} satisfies Prisma.AttendanceWhereInput;

/** The shift someone is on now: checked in (today or since yesterday), not yet out. */
export async function openShift(
  db: Db,
  companyId: string,
  employeeId: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<Attendance | null> {
  const day = localDay(now, timeZone);
  return db.attendance.findFirst({
    where: {
      companyId,
      employeeId,
      date: { in: [dateColumn(day), dateColumn(addDays(day, -1))] },
      checkIn: { not: null, gte: new Date(now.getTime() - LONGEST_SHIFT_HOURS * 3_600_000) },
      checkOut: null,
      ...SELF_CHECK_IN,
    },
    orderBy: { checkIn: "desc" },
  });
}

export type DutyState = {
  /** Checked in and not yet out: the phone sends its position. */
  onDuty: boolean;
  /** When this shift's check-in was. */
  since: string | null;
  pingEverySeconds: number;
  sendEverySeconds: number;
  /** Where the Android app's background service sends positions. */
  endpoint: string;
};

/**
 * For the app frame: whether this person's phone should be sending its
 * position. Null when GPS attendance is off or the login is not linked to an
 * employee (nothing is tracked then).
 */
export async function getDutyState(ctx: CompanyContext): Promise<DutyState | null> {
  if (!ctx.can("portal.self")) return null;
  const settings = await loadHrSettings(ctx.company.id);
  if (!settings.gpsAttendance || !settings.selfCheckIn) return null;
  const employee = await linkedEmployee(ctx);
  if (!employee || !["ACTIVE", "ON_LEAVE"].includes(employee.status)) return null;
  const shift = await openShift(prisma, ctx.company.id, employee.id, ctx.company.timezone);
  return {
    onDuty: shift !== null,
    since: shift?.checkIn?.toISOString() ?? null,
    pingEverySeconds: PING_EVERY_SECONDS,
    sendEverySeconds: SEND_EVERY_SECONDS,
    endpoint: PINGS_PATH,
  };
}

type PingRow = { at: Date; lat: number; lng: number; accuracy: number | null };

/** Saves positions and moves the person's latest position on (inside a transaction). */
export async function savePings(
  tx: Prisma.TransactionClient,
  companyId: string,
  employeeId: string,
  pings: ReadonlyArray<PingRow & { speed?: number | null; battery?: number | null }>,
  source: PingSource,
) {
  if (pings.length === 0) return;
  await tx.locationPing.createMany({
    data: pings.map((p) => ({
      companyId,
      employeeId,
      at: p.at,
      lat: p.lat,
      lng: p.lng,
      accuracy: p.accuracy,
      speed: p.speed ?? null,
      battery: p.battery ?? null,
      source,
    })),
  });
  const latest = pings.reduce((a, b) => (b.at > a.at ? b : a));
  const position = {
    at: latest.at,
    lat: latest.lat,
    lng: latest.lng,
    accuracy: latest.accuracy,
    battery: latest.battery ?? null,
    source,
  };
  const current = await tx.staffPosition.findUnique({ where: { employeeId } });
  if (current && current.at >= latest.at) return;
  await tx.staffPosition.upsert({
    where: { employeeId },
    create: { employeeId, companyId, ...position },
    update: position,
  });
}

/**
 * Positions from the signed-in employee's phone while they are checked in.
 * Positions from before the check-in, from the future, too vague to use or
 * too close to the last kept one are dropped. Answers whether they are still
 * on duty, so the Android app stops its background service after check-out.
 */
export async function recordPings(ctx: CompanyContext, raw: unknown) {
  const input = locationPingsSchema.parse(raw);
  const employee = await requireLinkedEmployee(ctx);
  const companyId = ctx.company.id;
  const settings = await loadHrSettings(companyId);
  const now = new Date();
  const off = { kept: 0, onDuty: false, sendEverySeconds: SEND_EVERY_SECONDS };
  if (!settings.gpsAttendance || !settings.selfCheckIn) return off;
  const shift = await openShift(prisma, companyId, employee.id, ctx.company.timezone, now);
  if (!shift?.checkIn) return off;
  const from = shift.checkIn.getTime() - 60_000;
  const usable = input.points
    .filter(
      (p) =>
        p.at.getTime() >= from &&
        p.at.getTime() <= now.getTime() + 120_000 &&
        isLatLng(p) &&
        (p.accuracy ?? 0) <= WORST_ACCURACY_METRES,
    )
    .map((p) => ({ ...p, at: p.at.getTime() > now.getTime() ? now : p.at }));
  const kept = await prisma.$transaction(async (tx) => {
    // One batch at a time per person, so two phones (or two tabs) cannot both
    // keep the same moment.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pings:${employee.id}`}))`;
    const last = await tx.locationPing.findFirst({
      where: { companyId, employeeId: employee.id, at: { gte: new Date(from) } },
      orderBy: { at: "desc" },
      select: { at: true, lat: true, lng: true },
    });
    const fresh = thinPings(
      usable.map((p) => ({ ...p, accuracy: p.accuracy ?? null })),
      last,
    );
    await savePings(tx, companyId, employee.id, fresh, input.source);
    return fresh.length;
  }, TX_OPTIONS);
  return { kept, onDuty: true, sendEverySeconds: SEND_EVERY_SECONDS };
}

/** Deletes pings older than PING_DAYS_KEPT, company by company (nightly housekeeping). */
export async function purgeOldPings(now: Date = new Date()): Promise<number> {
  const before = new Date(now.getTime() - PING_DAYS_KEPT * 24 * 3_600_000);
  const companies = await prisma.company.findMany({ select: { id: true } });
  let removed = 0;
  for (const { id } of companies) {
    const { count } = await prisma.locationPing.deleteMany({
      where: { companyId: id, at: { lt: before } },
    });
    removed += count;
  }
  return removed;
}

// =============================================================================
// The live staff map (HR & payroll > Staff map)
// =============================================================================

export type StaffMapState = "NO_SIGNAL" | "ON_DUTY" | "CHECKED_OUT";

type MarkWithPlaces = Attendance & {
  checkInPlace: { name: string } | null;
  checkOutPlace: { name: string } | null;
};

/** Where a check-in or check-out was, as HR sees it. */
export function whereOf(m: MarkWithPlaces, which: "in" | "out") {
  const lat = which === "in" ? m.checkInLat : m.checkOutLat;
  const lng = which === "in" ? m.checkInLng : m.checkOutLng;
  const at = which === "in" ? m.checkIn : m.checkOut;
  if (!at) return null;
  const place = which === "in" ? m.checkInPlace : m.checkOutPlace;
  return {
    located: lat !== null && lng !== null,
    lat,
    lng,
    accuracy: which === "in" ? m.checkInAccuracy : m.checkOutAccuracy,
    ip: which === "in" ? m.checkInIp : m.checkOutIp,
    placeName: place?.name ?? null,
    distance: which === "in" ? m.checkInDistance : m.checkOutDistance,
    away: which === "in" ? m.checkInAway : m.checkOutAway,
    link: lat !== null && lng !== null ? pointLink({ lat, lng }) : null,
  };
}

export type CheckPlace = NonNullable<ReturnType<typeof whereOf>>;

/**
 * Today's shifts (and any still open from yesterday): who is on duty, their
 * check-in, where they were last seen, and who has gone quiet. With `person`,
 * also that person's trail for the shift.
 */
export async function getStaffMap(ctx: CompanyContext, raw: unknown = {}) {
  assertCanManageHr(ctx, "Only HR can see where staff are.");
  const q = staffMapQuery.parse(raw);
  const companyId = ctx.company.id;
  const tz = ctx.company.timezone;
  const now = new Date();
  const day = localDay(now, tz);
  const [settings, places, marks] = await Promise.all([
    loadHrSettings(companyId),
    activePlaces(prisma, companyId),
    ctx.db.attendance.findMany({
      where: {
        date: { in: [dateColumn(day), dateColumn(addDays(day, -1))] },
        checkIn: { not: null },
        ...SELF_CHECK_IN,
      },
      include: {
        checkInPlace: { select: { name: true } },
        checkOutPlace: { select: { name: true } },
        employee: {
          select: {
            id: true,
            code: true,
            name: true,
            designation: true,
            position: true,
            workLocation: { select: { name: true } },
          },
        },
      },
      orderBy: { checkIn: "asc" },
    }),
  ]);
  const oldest = now.getTime() - LONGEST_SHIFT_HOURS * 3_600_000;
  // Today's shifts, and yesterday's only while still open.
  const shifts = new Map<string, (typeof marks)[number]>();
  for (const m of marks) {
    const today = m.date.getTime() === dateColumn(day).getTime();
    const stillOpen = !m.checkOut && m.checkIn!.getTime() >= oldest;
    if (!today && !stillOpen) continue;
    shifts.set(m.employeeId, m);
  }
  const lostAfter = SIGNAL_LOST_MINUTES * 60_000;
  const rows = [...shifts.values()].map((m) => {
    const checkIn = m.checkIn!;
    const p = m.employee.position;
    const last = p && p.at >= new Date(checkIn.getTime() - 60_000) ? p : null;
    const heardAt = last && last.at > checkIn ? last.at : checkIn;
    const open = !m.checkOut && checkIn.getTime() >= oldest;
    const state: StaffMapState = !open
      ? "CHECKED_OUT"
      : settings.gpsAttendance && now.getTime() - heardAt.getTime() > lostAfter
        ? "NO_SIGNAL"
        : "ON_DUTY";
    return {
      employeeId: m.employeeId,
      code: m.employee.code,
      name: m.employee.name,
      designation: m.employee.designation,
      workPlace: m.employee.workLocation?.name ?? null,
      state,
      checkIn: { time: localTime(checkIn, tz), ...whereOf(m, "in")! },
      checkOut: m.checkOut ? { time: localTime(m.checkOut, tz), ...whereOf(m, "out")! } : null,
      last: last
        ? {
            at: last.at.toISOString(),
            time: localTime(last.at, tz),
            lat: last.lat,
            lng: last.lng,
            accuracy: last.accuracy,
            battery: last.battery,
            source: last.source,
            link: pointLink(last),
          }
        : null,
      /** Since when nothing came, for "No signal since 15:10". */
      quietSince: state === "NO_SIGNAL" ? localTime(heardAt, tz) : null,
    };
  });
  const order: Record<StaffMapState, number> = { NO_SIGNAL: 0, ON_DUTY: 1, CHECKED_OUT: 2 };
  rows.sort((a, b) => order[a.state] - order[b.state] || a.name.localeCompare(b.name));

  let trail = null;
  const chosen = q.person ? shifts.get(q.person) : undefined;
  if (chosen) {
    const end = chosen.checkOut ?? now;
    const points = await ctx.db.locationPing.findMany({
      where: { employeeId: chosen.employeeId, at: { gte: chosen.checkIn!, lte: end } },
      orderBy: { at: "asc" },
      take: TRAIL_LIMIT,
      select: { at: true, lat: true, lng: true, accuracy: true, source: true },
    });
    trail = {
      employeeId: chosen.employeeId,
      name: chosen.employee.name,
      points: points.map((p) => ({
        time: localTime(p.at, tz),
        lat: p.lat,
        lng: p.lng,
        accuracy: p.accuracy,
      })),
      metres: trailMetres(points),
      route: routeLink(points),
      cut: points.length === TRAIL_LIMIT,
    };
  }

  return {
    date: day,
    generatedAt: now.toISOString(),
    gpsAttendance: settings.gpsAttendance,
    places: places.map((p) => presentPlace(p)),
    counts: {
      onDuty: rows.filter((r) => r.state !== "CHECKED_OUT").length,
      noSignal: rows.filter((r) => r.state === "NO_SIGNAL").length,
      checkedOut: rows.filter((r) => r.state === "CHECKED_OUT").length,
      away: rows.filter((r) => r.checkIn.away).length,
    },
    rows,
    trail,
    rules: {
      signalLostMinutes: SIGNAL_LOST_MINUTES,
      keepAfterSeconds: KEEP_AFTER_SECONDS,
      refreshSeconds: 20,
    },
  };
}

export type StaffMapScreen = Awaited<ReturnType<typeof getStaffMap>>;
