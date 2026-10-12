import type { BackgroundJob, HrSettings, Prisma, StaffClaim } from "@prisma/client";

import { addDays, dateColumn, dateOnly, localDay, toInstant, weekday } from "@/lib/dates";
import type { Db } from "@/lib/db-types";
import { formatDay } from "@/lib/display";
import { AppError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { money, ZERO } from "@/modules/accounts/balances";
import { cashAccountFor } from "@/modules/accounts/cash-accounts";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { postJournalEntry } from "@/modules/accounts/journal.service";
import { assertCanPayMoney } from "@/modules/accounts/money-guards";
import { listMoneyAccounts } from "@/modules/accounts/screens.service";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { ensureGeneralExpenseHeads, headAccountId } from "@/modules/expenses/expense.service";
import { isCompanyOwner, requireLinkedEmployee } from "@/modules/hr/access";
import { monthKey, monthLabel, monthRange, weekdayName } from "@/modules/hr/calendar";
import {
  CLAIM_DECIDERS,
  type ClaimCheck,
  claimAccess,
  type ClaimDuty,
  checkClaim,
  claimWhat,
  routeKey,
} from "@/modules/hr/claims";
import type { Fix } from "@/modules/hr/geo";
import { activePlaces, LONGEST_SHIFT_HOURS, placeOf } from "@/modules/hr/location.service";
import {
  approveAllClaimsSchema,
  claimsLedgerSchema,
  decideClaimSchema,
  payBackClaimsSchema,
  submitClaimSchema,
} from "@/modules/hr/schemas";
import { loadHrSettings } from "@/modules/hr/setup";
import { mapsStatus, regionOf, roadRoute } from "@/modules/integrations/maps";
import { enqueueJob } from "@/modules/jobs/queue";
import { ensureProductionCostHeads } from "@/modules/production/cost.service";
import { lockOpenProjects, refreshProjectCosts } from "@/modules/production/project-costs";
import { activeMembers, membersWith } from "@/modules/reminders/audience";
import { sendInApp } from "@/modules/reminders/notification.service";

/*
 * Staff claims: money an employee spent for the company, claimed back from My
 * HR (portal.self).
 *   Conveyance       the day, where from and to, what for and the fare. It is
 *                    checked against the person's attendance and GPS trail
 *                    that day (were they on duty, did the trail reach the
 *                    places named, was there any travel), the usual fare for
 *                    the distance (the trail, or Google's road distance when
 *                    the Maps plug is on) and what the same route usually
 *                    costs. Claims filed during the shift are checked again at
 *                    check-out.
 *   Local material   yarn, buttons... bought for a production project, with
 *                    the shop and a receipt photo (flagged without one).
 * The checks only raise flags for Accounts; the employee never sees them.
 * Accounts (expenses.manage or accounts.payments.record) approves a claim, in
 * full or for less with a reason, or rejects it with a reason. Approving puts
 * it in the books through the existing modules, nothing else changes:
 *   Conveyance       an expense under the Conveyance head
 *                    Dr Conveyance           Cr Payable to Staff (employee)
 *   Local material   a cost on the project under a production cost head
 *                    Dr Work in Progress     Cr Payable to Staff (employee)
 * so the project's costs and cost per piece include it. What is approved is
 * owed to the employee until Accounts pays it back (accounts.payments.record):
 *                    Dr Payable to Staff     Cr Cash / Bank / Wallet
 * HR (hr.manage) sees the claims and their checks too. Nobody decides their
 * own claim, a Super Admin aside.
 */

type Tx = Prisma.TransactionClient;
const TX_OPTIONS = { timeout: 30_000 };

/** The production cost head local material goes under unless Accounts picks another. */
export const LOCAL_MATERIAL_HEAD = "Local Materials";

function assertCanSeeClaims(ctx: CompanyContext) {
  if (!claimAccess(ctx).see) {
    throw new AppError("FORBIDDEN", "Only HR and Accounts can see staff claims.");
  }
}

function assertCanDecideClaims(ctx: CompanyContext) {
  if (!claimAccess(ctx).decide) {
    throw new AppError("FORBIDDEN", "Only Accounts can approve or reject staff claims.");
  }
}

const amountText = (value: Prisma.Decimal | number) => money(value).toFixed(2);

const kindWord = (kind: StaffClaim["kind"]) =>
  kind === "CONVEYANCE" ? "conveyance" : "local material";

// =============================================================================
// The checks
// =============================================================================

/**
 * Where the person stood on the day of a claim, and their GPS trail for that
 * day's shift (check-in, the pings, check-out), oldest first.
 */
async function dutyAndTrail(
  db: Db,
  input: {
    companyId: string;
    employeeId: string;
    day: string;
    settings: HrSettings;
    now: Date;
  },
): Promise<{ duty: ClaimDuty; trail: Fix[]; shiftOpen: boolean }> {
  const { companyId, employeeId, day, settings, now } = input;
  const date = dateColumn(day);
  const mark = await db.attendance.findFirst({ where: { companyId, employeeId, date } });
  if (mark?.checkIn) {
    const latest = new Date(mark.checkIn.getTime() + LONGEST_SHIFT_HOURS * 3_600_000);
    const shiftOpen = !mark.checkOut && now < latest;
    const end = mark.checkOut ?? (now < latest ? now : latest);
    const pings = settings.gpsAttendance
      ? await db.locationPing.findMany({
          where: { companyId, employeeId, at: { gte: mark.checkIn, lte: end } },
          orderBy: { at: "asc" },
          take: 5000,
          select: { at: true, lat: true, lng: true, accuracy: true },
        })
      : [];
    const points: Array<Fix & { at: Date }> = [...pings];
    // Check-in and check-out also save a ping; their positions count once.
    const pinged = new Set(pings.map((p) => p.at.getTime()));
    if (
      mark.checkInLat !== null &&
      mark.checkInLng !== null &&
      !pinged.has(mark.checkIn.getTime())
    ) {
      points.push({
        at: mark.checkIn,
        lat: mark.checkInLat,
        lng: mark.checkInLng,
        accuracy: mark.checkInAccuracy,
      });
    }
    if (
      mark.checkOut &&
      mark.checkOutLat !== null &&
      mark.checkOutLng !== null &&
      !pinged.has(mark.checkOut.getTime())
    ) {
      points.push({
        at: mark.checkOut,
        lat: mark.checkOutLat,
        lng: mark.checkOutLng,
        accuracy: mark.checkOutAccuracy,
      });
    }
    points.sort((a, b) => a.at.getTime() - b.at.getTime());
    return { duty: "ON_DUTY", trail: points, shiftOpen };
  }
  if (mark?.status === "ABSENT") return { duty: "ABSENT", trail: [], shiftOpen: false };
  const leave = await db.leaveRequest.findFirst({
    where: {
      companyId,
      employeeId,
      status: "APPROVED",
      halfDay: false,
      startDate: { lte: date },
      endDate: { gte: date },
    },
    select: { id: true },
  });
  if (leave) return { duty: "ON_LEAVE", trail: [], shiftOpen: false };
  const holiday = await db.holiday.findFirst({ where: { companyId, date }, select: { id: true } });
  if (holiday || settings.weeklyOffDays.includes(weekday(day))) {
    return { duty: "DAY_OFF", trail: [], shiftOpen: false };
  }
  // A working day HR marked, or one nobody checks in on (present unless marked).
  if (mark || !settings.selfCheckIn) return { duty: "ON_DUTY", trail: [], shiftOpen: false };
  return { duty: "NO_CHECK_IN", trail: [], shiftOpen: false };
}

/** Works the checks out for a claim from what the database holds now, and saves them. */
async function runChecks(
  db: Db,
  claim: StaffClaim,
  settings: HrSettings,
  now: Date = new Date(),
): Promise<StaffClaim> {
  const { companyId, employeeId } = claim;
  const day = dateOnly(claim.date);
  const active = { in: ["PENDING", "APPROVED"] as Array<StaffClaim["status"]> };
  const { duty, trail, shiftOpen } = await dutyAndTrail(db, {
    companyId,
    employeeId,
    day,
    settings,
    now,
  });
  const duplicate = await db.staffClaim.findFirst({
    where: {
      companyId,
      employeeId,
      kind: claim.kind,
      date: claim.date,
      amount: claim.amount,
      status: active,
      id: { not: claim.id },
      createdAt: { lt: claim.createdAt },
      ...(claim.kind === "CONVEYANCE"
        ? { routeKey: claim.routeKey }
        : { projectId: claim.projectId }),
    },
    orderBy: { createdAt: "asc" },
    select: { number: true },
  });
  let sameDayOthers = 0;
  let routeHistory: number[] = [];
  let places: ReturnType<typeof placeOf>[] = [];
  if (claim.kind === "CONVEYANCE") {
    const others = await db.staffClaim.aggregate({
      where: {
        companyId,
        employeeId,
        kind: "CONVEYANCE",
        date: claim.date,
        status: active,
        id: { not: claim.id },
      },
      _sum: { amount: true },
    });
    sameDayOthers = Number(others._sum.amount ?? 0);
    if (claim.routeKey) {
      const history = await db.staffClaim.findMany({
        where: {
          companyId,
          routeKey: claim.routeKey,
          status: "APPROVED",
          id: { not: claim.id },
          date: { gte: dateColumn(addDays(day, -365)) },
        },
        orderBy: { date: "desc" },
        take: 20,
        select: { approvedAmount: true, amount: true },
      });
      routeHistory = history.map((h) => Number(h.approvedAmount ?? h.amount));
    }
    places = (await activePlaces(db, companyId)).map(placeOf);
  }
  const road =
    claim.roadCheckedAt !== null
      ? {
          metres: claim.roadMetres,
          from:
            claim.fromLat !== null && claim.fromLng !== null
              ? { lat: claim.fromLat, lng: claim.fromLng }
              : null,
          to:
            claim.toLat !== null && claim.toLng !== null
              ? { lat: claim.toLat, lng: claim.toLng }
              : null,
        }
      : null;
  const { flags, check } = checkClaim({
    kind: claim.kind,
    amount: Number(claim.amount),
    fromPlace: claim.fromPlace,
    toPlace: claim.toPlace,
    duty,
    gps: settings.gpsAttendance,
    shiftOpen,
    trail,
    places,
    ratePerKm: Number(settings.conveyanceRatePerKm),
    sameDayOthers,
    routeHistory,
    road,
    duplicateOf: duplicate?.number ?? null,
    hasReceipt: claim.receiptFileId !== null,
  });
  return db.staffClaim.update({
    where: { id: claim.id },
    data: { flags, check: check as unknown as Prisma.InputJsonValue, checkedAt: now },
  });
}

/**
 * At a self check-out (inside its transaction): checks the person's waiting
 * conveyance claims for that day again, now that the day's trail is complete.
 */
export async function recheckClaimsAtCheckOut(
  tx: Tx,
  input: { companyId: string; employeeId: string; date: Date; settings: HrSettings },
) {
  const claims = await tx.staffClaim.findMany({
    where: {
      companyId: input.companyId,
      employeeId: input.employeeId,
      date: input.date,
      kind: "CONVEYANCE",
      status: "PENDING",
    },
  });
  for (const claim of claims) await runChecks(tx, claim, input.settings);
  return claims.length;
}

/**
 * The background job that asks Google Maps for a conveyance claim's road route
 * (when the Maps plug is on), keeps the distance and the two ends, and runs
 * the checks again with them.
 */
export async function runClaimRouteJob(job: BackgroundJob) {
  const { claimId } = job.payload as { claimId?: string };
  if (!claimId) return;
  const claim = await prisma.staffClaim.findUnique({
    where: { id: claimId },
    include: { company: { select: { timezone: true } } },
  });
  if (!claim || claim.status !== "PENDING" || !claim.fromPlace || !claim.toPlace) return;
  const route = await roadRoute(claim.fromPlace, claim.toPlace, {
    region: regionOf(claim.company.timezone),
  });
  if (route === null) return;
  await prisma.$transaction(async (tx) => {
    await lockRow(tx, "StaffClaim", claim.id);
    const current = await tx.staffClaim.findUnique({ where: { id: claim.id } });
    if (!current || current.status !== "PENDING") return;
    const saved = await tx.staffClaim.update({
      where: { id: current.id },
      data: route.found
        ? {
            roadMetres: route.metres,
            fromLat: route.from.lat,
            fromLng: route.from.lng,
            toLat: route.to.lat,
            toLng: route.to.lng,
            roadCheckedAt: new Date(),
          }
        : {
            roadMetres: null,
            fromLat: null,
            fromLng: null,
            toLat: null,
            toLng: null,
            roadCheckedAt: new Date(),
          },
    });
    await runChecks(tx, saved, await loadHrSettings(saved.companyId, tx));
  }, TX_OPTIONS);
}

// =============================================================================
// My HR: the employee's own claims
// =============================================================================

/** The payroll a claim is paid back with (set once that payroll is approved). */
const salaryInclude = {
  select: { runId: true, run: { select: { year: true, month: true } } },
} satisfies Prisma.PayrollItemDefaultArgs;

const myClaimInclude = {
  project: { select: { id: true, code: true, name: true } },
  receiptFile: { select: { id: true, fileName: true } },
  expense: { select: { voidedAt: true } },
  payrollItem: salaryInclude,
} satisfies Prisma.StaffClaimInclude;

/** "October 2026": the salary a claim is paid back with. */
const salaryMonth = (c: { payrollItem: { run: { year: number; month: number } } | null }) =>
  c.payrollItem ? monthLabel(monthKey(c.payrollItem.run.year, c.payrollItem.run.month)) : null;

type MyClaimRow = Prisma.StaffClaimGetPayload<{ include: typeof myClaimInclude }>;

/** Approved, not paid back yet, not on an approved payroll, and still in the books. */
const isOwed = (
  c: Pick<StaffClaim, "status" | "paidAt" | "payrollItemId"> & {
    expense: { voidedAt: Date | null } | null;
  },
) =>
  c.status === "APPROVED" && c.paidAt === null && c.payrollItemId === null && !c.expense?.voidedAt;

/**
 * Where a claim stands for the person who made it:
 *   WAITING    with Accounts
 *   OWED       approved, to be paid back
 *   SALARY     approved, paid back with a salary (that payroll is approved)
 *   PAID       paid back
 *   CANCELLED  approved, then its expense was voided by Accounts
 *   REJECTED / WITHDRAWN
 */
export type MyClaimState =
  "WAITING" | "OWED" | "SALARY" | "PAID" | "CANCELLED" | "REJECTED" | "WITHDRAWN";

function myState(c: MyClaimRow): MyClaimState {
  if (c.status === "PENDING") return "WAITING";
  if (c.status === "REJECTED" || c.status === "WITHDRAWN") return c.status;
  if (c.paidAt) return "PAID";
  if (c.payrollItemId) return "SALARY";
  return c.expense?.voidedAt ? "CANCELLED" : "OWED";
}

/**
 * The employee's own claims, newest first, with what is owed to them and
 * what waits, and what the claim form needs (open production projects, the
 * work places and their recent routes). The checks are not shown.
 */
export async function getMyClaims(ctx: CompanyContext) {
  const employee = await requireLinkedEmployee(ctx);
  const tz = ctx.company.timezone;
  const today = localDay(new Date(), tz);
  const [claims, projects, places] = await Promise.all([
    ctx.db.staffClaim.findMany({
      where: { employeeId: employee.id },
      include: myClaimInclude,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 100,
    }),
    ctx.db.productionProject.findMany({
      where: { status: { in: ["PLANNED", "ACTIVE", "ON_HOLD"] } },
      select: { id: true, code: true, name: true },
      orderBy: { code: "desc" },
      take: 200,
    }),
    activePlaces(prisma, ctx.company.id),
  ]);
  const rows = claims.map((c) => {
    const state = myState(c);
    return {
      id: c.id,
      number: c.number,
      kind: c.kind,
      date: dateOnly(c.date),
      amount: c.amount.toFixed(2),
      approvedAmount: c.approvedAmount?.toFixed(2) ?? null,
      fromPlace: c.fromPlace,
      toPlace: c.toPlace,
      purpose: c.purpose,
      project: c.project,
      item: c.item,
      quantity: c.quantity,
      shop: c.shop,
      receipt: c.receiptFile,
      state,
      reason: c.reason,
      decidedAt: c.decidedAt ? localDay(c.decidedAt, tz) : null,
      paidAt: c.paidAt ? localDay(c.paidAt, tz) : null,
      /** The salary it is (or was) paid back with: "October 2026". */
      salary: salaryMonth(c),
      canWithdraw: c.status === "PENDING",
    };
  });
  const sum = (list: typeof rows, pick: (r: (typeof rows)[number]) => string) =>
    list.reduce((total, r) => total.plus(pick(r)), ZERO).toFixed(2);
  // Still to come, on their own or with a salary.
  const owed = rows.filter((r) => r.state === "OWED" || r.state === "SALARY");
  const waiting = rows.filter((r) => r.state === "WAITING");
  const seen = new Set<string>();
  const recentRoutes: Array<{ from: string; to: string }> = [];
  for (const c of claims) {
    if (c.kind !== "CONVEYANCE" || !c.routeKey || seen.has(c.routeKey)) continue;
    seen.add(c.routeKey);
    recentRoutes.push({ from: c.fromPlace!, to: c.toPlace! });
    if (recentRoutes.length === 5) break;
  }
  return {
    today,
    employee: { id: employee.id, code: employee.code, name: employee.name },
    owed: { count: owed.length, amount: sum(owed, (r) => r.approvedAmount ?? r.amount) },
    waiting: { count: waiting.length, amount: sum(waiting, (r) => r.amount) },
    claims: rows,
    projects,
    places: places.map((p) => p.name),
    recentRoutes,
  };
}

export type MyClaimsScreen = Awaited<ReturnType<typeof getMyClaims>>;

/**
 * A claim from My HR. It is checked straight away (and again at check-out
 * when the shift is still open, and with Google's road distance when the Maps
 * plug is on), and Accounts is told it waits.
 */
export async function submitClaim(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = submitClaimSchema.parse(raw);
  const employee = await requireLinkedEmployee(ctx);
  if (!["ACTIVE", "ON_LEAVE"].includes(employee.status)) {
    throw new AppError("FORBIDDEN", "Only current staff can make claims.");
  }
  const companyId = ctx.company.id;
  const tz = ctx.company.timezone;
  const today = localDay(new Date(), tz);
  if (input.date > today) {
    const message = "The day can't be after today.";
    throw new AppError("VALIDATION", message, { date: [message] });
  }
  if (input.receiptFileId) {
    const file = await ctx.db.fileAsset.findUnique({ where: { id: input.receiptFileId } });
    if (!file || file.uploadedById !== ctx.user.id) {
      throw new AppError("NOT_FOUND", "Receipt file not found.");
    }
  }
  const settings = await loadHrSettings(companyId);
  const maps = mapsStatus().state === "ON";

  const claim = await prisma.$transaction(async (tx) => {
    let project: { id: string; code: string } | null = null;
    if (input.kind === "LOCAL_MATERIAL") {
      const found = await tx.productionProject.findFirst({
        where: { id: input.projectId, companyId },
        select: { id: true, code: true, status: true },
      });
      if (!found) throw new AppError("NOT_FOUND", "Production project not found.");
      if (found.status === "COMPLETED" || found.status === "CANCELLED") {
        const message = `${found.code} is ${found.status.toLowerCase()}; choose a project still in production.`;
        throw new AppError("VALIDATION", message, { projectId: [message] });
      }
      project = found;
    }
    const created = await tx.staffClaim.create({
      data: {
        companyId,
        employeeId: employee.id,
        number: await nextDocumentNumber(tx, companyId, "STAFF_CLAIM"),
        kind: input.kind,
        date: dateColumn(input.date),
        amount: money(input.amount),
        purpose: input.purpose ?? null,
        receiptFileId: input.receiptFileId ?? null,
        createdById: ctx.user.id,
        ...(input.kind === "CONVEYANCE"
          ? {
              fromPlace: input.fromPlace,
              toPlace: input.toPlace,
              routeKey: routeKey(input.fromPlace, input.toPlace),
            }
          : {
              projectId: input.projectId,
              item: input.item,
              quantity: input.quantity ?? null,
              shop: input.shop ?? null,
            }),
      },
    });
    const checked = await runChecks(tx, created, settings);
    if (maps && checked.kind === "CONVEYANCE") {
      await enqueueJob(tx, {
        kind: "claim.route",
        companyId,
        payload: { claimId: checked.id },
        maxAttempts: 3,
      });
    }
    const what = claimWhat({ ...checked, project });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "StaffClaim",
        entityId: checked.id,
        summary: `${employee.code} ${employee.name} claimed ${amountText(checked.amount)} ${kindWord(
          checked.kind,
        )} for ${input.date}: ${what}${checked.flags.length ? ` (flags: ${checked.flags.join(", ")})` : ""}`,
      },
      tx,
    );
    const members = await activeMembers(companyId, tx);
    await sendInApp(
      tx,
      companyId,
      membersWith(members, CLAIM_DECIDERS)
        .filter((userId) => userId !== ctx.user.id)
        .map((userId) => ({ userId })),
      {
        subject: `Claim ${checked.number} to approve`,
        body: `${employee.name} claims ${amountText(checked.amount)} ${kindWord(checked.kind)} for ${formatDay(
          input.date,
        )}: ${what}.`,
        entityType: "StaffClaim",
        entityId: checked.id,
      },
    );
    return checked;
  }, TX_OPTIONS);
  return { id: claim.id, number: claim.number, status: claim.status };
}

/** Takes back one's own claim while it waits. */
export async function withdrawMyClaim(ctx: CompanyContext, claimId: string, meta?: RequestMeta) {
  const employee = await requireLinkedEmployee(ctx);
  const claim = await prisma.$transaction(async (tx) => {
    await lockRow(tx, "StaffClaim", claimId);
    const current = await tx.staffClaim.findFirst({
      where: { id: claimId, companyId: ctx.company.id, employeeId: employee.id },
    });
    if (!current) throw new AppError("NOT_FOUND", "Claim not found.");
    if (current.status !== "PENDING") {
      throw new AppError(
        "CONFLICT",
        `${current.number} is no longer waiting, so it can't be withdrawn.`,
      );
    }
    const saved = await tx.staffClaim.update({
      where: { id: current.id },
      data: { status: "WITHDRAWN", reason: "Withdrawn by the employee", decidedAt: new Date() },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "StaffClaim",
        entityId: saved.id,
        summary: `${employee.code} ${employee.name} withdrew claim ${saved.number} (${amountText(saved.amount)})`,
      },
      tx,
    );
    return saved;
  }, TX_OPTIONS);
  return { id: claim.id, number: claim.number, status: claim.status };
}

// =============================================================================
// HR and Accounts: the claims ledger
// =============================================================================

const ledgerInclude = {
  employee: { select: { id: true, code: true, name: true, designation: true, userId: true } },
  project: { select: { id: true, code: true, name: true, status: true } },
  receiptFile: { select: { id: true, fileName: true } },
  expense: { select: { id: true, number: true, voidedAt: true } },
  costHead: { select: { id: true, name: true } },
  decidedBy: { select: { name: true } },
  paidBy: { select: { name: true } },
  paymentEntry: { select: { id: true, number: true } },
  payrollItem: salaryInclude,
} satisfies Prisma.StaffClaimInclude;

type LedgerClaim = Prisma.StaffClaimGetPayload<{ include: typeof ledgerInclude }>;

/** A Google Maps route between the two places typed, which opens without any key. */
function routeSearchLink(from: string, to: string) {
  const params = new URLSearchParams({ api: "1", origin: from, destination: to });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function presentLedgerClaim(
  c: LedgerClaim,
  ctx: CompanyContext,
  options: { maps: boolean; decide: boolean },
) {
  const tz = ctx.company.timezone;
  const day = dateOnly(c.date);
  const own = c.employee.userId === ctx.user.id && !isCompanyOwner(ctx);
  const owed = isOwed(c);
  return {
    id: c.id,
    number: c.number,
    kind: c.kind,
    date: day,
    weekday: weekdayName(weekday(day)),
    employee: {
      id: c.employee.id,
      code: c.employee.code,
      name: c.employee.name,
      designation: c.employee.designation,
    },
    amount: c.amount.toFixed(2),
    approvedAmount: c.approvedAmount?.toFixed(2) ?? null,
    purpose: c.purpose,
    fromPlace: c.fromPlace,
    toPlace: c.toPlace,
    routeLink:
      c.kind === "CONVEYANCE" && c.fromPlace && c.toPlace
        ? routeSearchLink(c.fromPlace, c.toPlace)
        : null,
    project: c.project,
    item: c.item,
    quantity: c.quantity,
    shop: c.shop,
    receipt: c.receiptFile,
    flags: c.flags,
    check: (c.check ?? null) as ClaimCheck | null,
    checkedAt: c.checkedAt ? c.checkedAt.toISOString() : null,
    road: {
      metres: c.roadMetres,
      /** Google Maps is still being asked. */
      waiting:
        options.maps && c.kind === "CONVEYANCE" && c.status === "PENDING" && !c.roadCheckedAt,
      checked: c.roadCheckedAt !== null,
    },
    status: c.status,
    reason: c.reason,
    decidedBy: c.decidedBy?.name ?? null,
    decidedAt: c.decidedAt ? localDay(c.decidedAt, tz) : null,
    expense: c.expense
      ? { id: c.expense.id, number: c.expense.number, voided: c.expense.voidedAt !== null }
      : null,
    costHead: c.costHead,
    /** Paid back with this payroll's salaries (once it is approved). */
    salary: c.payrollItem ? { label: salaryMonth(c)!, runId: c.payrollItem.runId } : null,
    paid: c.paidAt
      ? {
          on: localDay(c.paidAt, tz),
          by: c.paidBy?.name ?? null,
          entry: c.paymentEntry,
        }
      : null,
    owed,
    can: {
      decide: options.decide && c.status === "PENDING" && !own,
      recheck: options.decide && c.status === "PENDING",
    },
    own,
  };
}

export type LedgerClaimRow = ReturnType<typeof presentLedgerClaim>;

/**
 * A month's claims for HR and Accounts (by the day of the trip or purchase),
 * each with its checks and decision; the month's totals; what is owed to
 * each person now (any month); and, for Accounts, the production cost heads
 * local material can go under. `claim` opens the month of that claim.
 */
export async function getClaimsLedger(ctx: CompanyContext, raw: unknown = {}) {
  assertCanSeeClaims(ctx);
  const q = claimsLedgerSchema.parse(raw);
  const access = claimAccess(ctx);
  const companyId = ctx.company.id;
  const tz = ctx.company.timezone;
  const today = localDay(new Date(), tz);
  const opened = q.claim
    ? await ctx.db.staffClaim.findUnique({ where: { id: q.claim }, select: { date: true } })
    : null;
  const month = q.month ?? (opened ? dateOnly(opened.date).slice(0, 7) : today.slice(0, 7));
  const { from, to } = monthRange(month);
  const maps = mapsStatus().state === "ON";
  const [settings, claims, owedRows] = await Promise.all([
    loadHrSettings(companyId),
    ctx.db.staffClaim.findMany({
      where: {
        date: { gte: dateColumn(from), lte: dateColumn(to) },
        ...(q.employeeId ? { employeeId: q.employeeId } : {}),
      },
      include: ledgerInclude,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    }),
    ctx.db.staffClaim.findMany({
      where: {
        status: "APPROVED",
        paidAt: null,
        payrollItemId: null,
        OR: [{ expenseId: null }, { expense: { voidedAt: null } }],
      },
      select: {
        approvedAmount: true,
        amount: true,
        employee: { select: { id: true, code: true, name: true, userId: true } },
      },
    }),
  ]);
  const rows = claims.map((c) => presentLedgerClaim(c, ctx, { maps, decide: access.decide }));
  const sum = (list: typeof rows, pick: (r: (typeof rows)[number]) => string) =>
    list.reduce((total, r) => total.plus(pick(r)), ZERO).toFixed(2);
  const waiting = rows.filter((r) => r.status === "PENDING");
  const approved = rows.filter((r) => r.status === "APPROVED");
  const paid = rows.filter((r) => r.paid !== null);
  const readyToApprove = waiting.filter((r) => r.flags.length === 0 && r.can.decide);

  const owedBy = new Map<
    string,
    {
      employee: { id: string; code: string; name: string };
      count: number;
      amount: Prisma.Decimal;
      own: boolean;
    }
  >();
  for (const o of owedRows) {
    const row = owedBy.get(o.employee.id) ?? {
      employee: { id: o.employee.id, code: o.employee.code, name: o.employee.name },
      count: 0,
      amount: ZERO,
      own: o.employee.userId === ctx.user.id && !isCompanyOwner(ctx),
    };
    row.count += 1;
    row.amount = row.amount.plus(o.approvedAmount ?? o.amount);
    owedBy.set(o.employee.id, row);
  }
  const owed = [...owedBy.values()]
    .sort((a, b) => b.amount.comparedTo(a.amount) || a.employee.name.localeCompare(b.employee.name))
    .map((o) => ({
      employee: o.employee,
      count: o.count,
      amount: o.amount.toFixed(2),
      can: { pay: access.pay && !o.own },
    }));

  let costHeads: Array<{ id: string; name: string }> = [];
  if (access.decide) {
    const heads = await ctx.db.expenseHead.findMany({
      where: { isProductionCost: true, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    costHeads = heads;
  }
  const defaultHead =
    costHeads.find((h) => h.name.toLowerCase() === LOCAL_MATERIAL_HEAD.toLowerCase()) ?? null;
  const moneyAccounts = access.pay && owed.length > 0 ? await listMoneyAccounts(ctx) : [];

  return {
    month,
    label: monthLabel(month),
    thisMonth: today.slice(0, 7),
    access,
    rules: {
      gpsAttendance: settings.gpsAttendance,
      ratePerKm: settings.conveyanceRatePerKm.toFixed(2),
      maps,
    },
    totals: {
      waiting: { count: waiting.length, amount: sum(waiting, (r) => r.amount) },
      needsLook: waiting.filter((r) => r.flags.length > 0).length,
      approved: {
        count: approved.length,
        amount: sum(approved, (r) => r.approvedAmount ?? r.amount),
      },
      paid: { count: paid.length, amount: sum(paid, (r) => r.approvedAmount ?? r.amount) },
      rejected: rows.filter((r) => r.status === "REJECTED").length,
      /** Waiting claims "Approve all with nothing to check" would approve. */
      readyToApprove: readyToApprove.length,
    },
    owed,
    owedTotal: owed.reduce((t, o) => t.plus(o.amount), ZERO).toFixed(2),
    costHeads,
    /** Local material goes under this head unless Accounts picks another (made on first use). */
    defaultHead: defaultHead ?? { id: null, name: LOCAL_MATERIAL_HEAD },
    /** Where Accounts pays claims back from. */
    moneyAccounts,
    today,
    rows: rows.filter(
      (r) => (!q.status || r.status === q.status) && (!q.kind || r.kind === q.kind),
    ),
    status: q.status ?? null,
    kind: q.kind ?? null,
  };
}

export type ClaimsLedger = Awaited<ReturnType<typeof getClaimsLedger>>;

/** Waiting claims, for the HR overview and the Expenses screen. */
export async function waitingClaims(ctx: CompanyContext) {
  const [count, earliest] = await Promise.all([
    ctx.db.staffClaim.count({ where: { status: "PENDING" } }),
    ctx.db.staffClaim.findFirst({
      where: { status: "PENDING" },
      orderBy: { date: "asc" },
      select: { date: true },
    }),
  ]);
  return { count, month: earliest ? dateOnly(earliest.date).slice(0, 7) : null };
}

/** Runs a waiting claim's checks again (after HR corrected the day's attendance, say). */
export async function recheckClaim(ctx: CompanyContext, claimId: string) {
  assertCanDecideClaims(ctx);
  const claim = await ctx.db.staffClaim.findUnique({ where: { id: claimId } });
  if (!claim) throw new AppError("NOT_FOUND", "Claim not found.");
  if (claim.status !== "PENDING") {
    throw new AppError("CONFLICT", `${claim.number} is already decided.`);
  }
  const saved = await prisma.$transaction(async (tx) => {
    await lockRow(tx, "StaffClaim", claim.id);
    const current = await tx.staffClaim.findUniqueOrThrow({ where: { id: claim.id } });
    return runChecks(tx, current, await loadHrSettings(ctx.company.id, tx));
  }, TX_OPTIONS);
  return { id: saved.id, number: saved.number, flags: saved.flags };
}

// =============================================================================
// Deciding: approve (into the books, owed to the employee) or reject
// =============================================================================

/** The company's Conveyance expense head (made with the default heads on first use). */
async function conveyanceHead(tx: Tx, companyId: string) {
  await ensureGeneralExpenseHeads(companyId, tx);
  const head = await tx.expenseHead.findFirst({
    where: { companyId, category: "CONVEYANCE", isProductionCost: false, isActive: true },
    orderBy: { name: "asc" },
  });
  if (!head) {
    throw new AppError(
      "CONFLICT",
      "There is no active Conveyance expense head. Add one in Accounts → Expenses → Heads first.",
    );
  }
  return head;
}

/** The production cost head for local material: the one chosen, or "Local Materials". */
async function materialHead(tx: Tx, companyId: string, costHeadId?: string) {
  if (costHeadId) {
    const head = await tx.expenseHead.findFirst({
      where: { id: costHeadId, companyId, isProductionCost: true, isActive: true },
    });
    if (!head) {
      const message = "Choose an active production cost head.";
      throw new AppError("VALIDATION", message, { costHeadId: [message] });
    }
    return head;
  }
  await ensureProductionCostHeads(companyId, tx);
  const named = await tx.expenseHead.findFirst({
    where: { companyId, name: { equals: LOCAL_MATERIAL_HEAD, mode: "insensitive" } },
  });
  if (named?.isProductionCost && named.isActive) return named;
  if (!named) {
    return tx.expenseHead.create({
      data: {
        companyId,
        name: LOCAL_MATERIAL_HEAD,
        category: "RAW_MATERIAL",
        isProductionCost: true,
      },
    });
  }
  const fallback = await tx.expenseHead.findFirst({
    where: { companyId, isProductionCost: true, isActive: true, category: "RAW_MATERIAL" },
    orderBy: { name: "asc" },
  });
  if (!fallback) {
    const message = "Choose the production cost head for this material.";
    throw new AppError("VALIDATION", message, { costHeadId: [message] });
  }
  return fallback;
}

type DecidableClaim = StaffClaim & {
  employee: { id: string; code: string; name: string; userId: string | null };
};

/**
 * Puts an approved claim into the books, owed to the employee: a conveyance
 * expense, or a cost on the production project. Returns the expense.
 */
async function approveTx(
  tx: Tx,
  ctx: CompanyContext,
  claim: DecidableClaim,
  input: { amount: Prisma.Decimal; reason: string | null; costHeadId?: string },
) {
  const companyId = ctx.company.id;
  const acc = await ensureControlAccounts(companyId, tx);
  const date = toInstant(dateOnly(claim.date), ctx.company.timezone);
  const number = await nextDocumentNumber(tx, companyId, "EXPENSE_VOUCHER");
  const employee = claim.employee;
  const owedLine = {
    accountId: acc.EMPLOYEE_PAYABLE,
    employeeId: employee.id,
    credit: input.amount,
    memo: `${claim.number} · ${employee.name}`,
  };
  let summary: string;
  let expenseId: string;
  let costHeadId: string | null = null;

  if (claim.kind === "CONVEYANCE") {
    const head = await conveyanceHead(tx, companyId);
    const expense = await tx.expense.create({
      data: {
        companyId,
        number,
        date,
        headId: head.id,
        amount: input.amount,
        paymentType: "DUE",
        employeeId: employee.id,
        purpose: claim.purpose,
        fromLocation: claim.fromPlace,
        toLocation: claim.toPlace,
        description: `Staff claim ${claim.number}, owed to ${employee.name}`,
        receiptFileId: claim.receiptFileId,
        createdById: employee.userId,
      },
    });
    const entry = await postJournalEntry(tx, {
      companyId,
      date,
      description: [
        `${expense.number} — ${head.name}`,
        claim.purpose,
        `claim ${claim.number} by ${employee.name}`,
      ]
        .filter(Boolean)
        .join(" · "),
      sourceType: "EXPENSE",
      sourceId: expense.id,
      postedById: ctx.user.id,
      lines: [
        {
          accountId: await headAccountId(tx, companyId, head),
          debit: input.amount,
          memo: head.name,
        },
        owedLine,
      ],
    });
    await tx.expense.update({ where: { id: expense.id }, data: { journalEntryId: entry.id } });
    expenseId = expense.id;
    summary = `${expense.number} ${head.name}, ${entry.number}`;
  } else {
    const project = (
      await lockOpenProjects(tx, companyId, [claim.projectId!], "no more costs can be added")
    ).get(claim.projectId!)!;
    const head = await materialHead(tx, companyId, input.costHeadId);
    costHeadId = head.id;
    const description = [
      `${claim.item}${claim.quantity ? ` (${claim.quantity})` : ""}`,
      claim.shop ? `from ${claim.shop}` : null,
      `bought by ${employee.name}, claim ${claim.number}`,
    ]
      .filter(Boolean)
      .join(" · ");
    const expense = await tx.expense.create({
      data: {
        companyId,
        number,
        date,
        headId: head.id,
        amount: input.amount,
        paymentType: "DUE",
        projectId: project.id,
        employeeId: employee.id,
        purpose: claim.purpose,
        description,
        receiptFileId: claim.receiptFileId,
        createdById: employee.userId,
      },
    });
    const entry = await postJournalEntry(tx, {
      companyId,
      date,
      description: `${expense.number} — ${head.name} for ${project.code} · ${description}`,
      sourceType: "EXPENSE",
      sourceId: expense.id,
      postedById: ctx.user.id,
      lines: [
        {
          accountId: acc.WORK_IN_PROGRESS,
          debit: input.amount,
          memo: `${project.code} · ${head.name}`,
        },
        owedLine,
      ],
    });
    await tx.expense.update({ where: { id: expense.id }, data: { journalEntryId: entry.id } });
    await refreshProjectCosts(tx, companyId, [project.id]);
    expenseId = expense.id;
    summary = `${expense.number} ${head.name} on ${project.code}, ${entry.number}`;
  }

  await tx.staffClaim.update({
    where: { id: claim.id },
    data: {
      status: "APPROVED",
      approvedAmount: input.amount,
      reason: input.reason,
      decidedById: ctx.user.id,
      decidedAt: new Date(),
      expenseId,
      costHeadId,
    },
  });
  return summary;
}

async function loadDecidable(tx: Tx, ctx: CompanyContext, claimId: string) {
  await lockRow(tx, "StaffClaim", claimId);
  const claim = await tx.staffClaim.findFirst({
    where: { id: claimId, companyId: ctx.company.id },
    include: { employee: { select: { id: true, code: true, name: true, userId: true } } },
  });
  if (!claim) throw new AppError("NOT_FOUND", "Claim not found.");
  if (claim.employee.userId === ctx.user.id && !isCompanyOwner(ctx)) {
    throw new AppError("FORBIDDEN", "Someone else in Accounts decides your own claim.");
  }
  if (claim.status !== "PENDING") {
    throw new AppError("CONFLICT", `${claim.number} is already ${claim.status.toLowerCase()}.`);
  }
  return claim;
}

/**
 * Approves a waiting claim (in full, or for less with a reason; local
 * material under a production cost head) or rejects it with a reason. The
 * employee is told either way.
 */
export async function decideClaim(
  ctx: CompanyContext,
  claimId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanDecideClaims(ctx);
  const input = decideClaimSchema.parse(raw);
  const saved = await prisma.$transaction(async (tx) => {
    const claim = await loadDecidable(tx, ctx, claimId);
    const reason = input.reason?.trim() || null;
    let summary: string;
    let notice: { subject: string; body: string };
    if (input.decision === "APPROVE") {
      const amount = money(input.amount ?? claim.amount);
      if (amount.gt(claim.amount)) {
        const message = `Approve at most the ${amountText(claim.amount)} claimed.`;
        throw new AppError("VALIDATION", message, { amount: [message] });
      }
      const cut = !amount.eq(claim.amount);
      if (cut && (reason?.length ?? 0) < 5) {
        const message = "Say why less than the amount claimed is approved.";
        throw new AppError("VALIDATION", message, { reason: [message] });
      }
      const booked = await approveTx(tx, ctx, claim, {
        amount,
        reason,
        costHeadId: input.costHeadId,
      });
      summary = `Approved claim ${claim.number} for ${claim.employee.name}: ${amountText(amount)}${
        cut ? ` of ${amountText(claim.amount)} claimed (${reason})` : ""
      }, owed to them; ${booked}`;
      notice = {
        subject: `Claim ${claim.number} approved`,
        body: `${amountText(amount)} for ${claimWhat(claim)} on ${formatDay(dateOnly(claim.date))} is approved${
          cut ? ` (you claimed ${amountText(claim.amount)}: ${reason})` : ""
        }. Accounts pays it back to you.`,
      };
    } else {
      await tx.staffClaim.update({
        where: { id: claim.id },
        data: {
          status: "REJECTED",
          reason: input.reason,
          decidedById: ctx.user.id,
          decidedAt: new Date(),
        },
      });
      summary = `Rejected claim ${claim.number} for ${claim.employee.name} (${amountText(claim.amount)}): ${input.reason}`;
      notice = {
        subject: `Claim ${claim.number} not approved`,
        body: `Your claim for ${claimWhat(claim)} on ${formatDay(dateOnly(claim.date))} (${amountText(
          claim.amount,
        )}) was not approved: ${input.reason}`,
      };
    }
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "StaffClaim",
        entityId: claim.id,
        summary,
        before: { status: claim.status },
        after: { status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED" },
      },
      tx,
    );
    if (claim.employee.userId) {
      await sendInApp(
        tx,
        ctx.company.id,
        [{ userId: claim.employee.userId, employeeId: claim.employee.id }],
        {
          ...notice,
          entityType: "MyClaim",
          entityId: claim.id,
        },
      );
    }
    return tx.staffClaim.findUniqueOrThrow({ where: { id: claim.id } });
  }, TX_OPTIONS);
  return {
    id: saved.id,
    number: saved.number,
    status: saved.status,
    approvedAmount: saved.approvedAmount?.toFixed(2) ?? null,
  };
}

/**
 * Approves a month's waiting claims that have no flag, as claimed (local
 * material under "Local Materials"), leaving out flagged ones and one's own.
 */
export async function approveAllClaims(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanDecideClaims(ctx);
  const { month } = approveAllClaimsSchema.parse(raw);
  const ledger = await getClaimsLedger(ctx, { month, status: "PENDING" });
  const ids = ledger.rows.filter((r) => r.flags.length === 0 && r.can.decide).map((r) => r.id);
  if (ids.length === 0) {
    throw new AppError("CONFLICT", "Nothing is waiting that can be approved as claimed.");
  }
  const result = await prisma.$transaction(
    async (tx) => {
      let approved = 0;
      let total = ZERO;
      const skipped: string[] = [];
      for (const id of ids) {
        const claim = await loadDecidable(tx, ctx, id);
        // Checked again under the lock: a flag may have come since the screen loaded.
        if (claim.flags.length > 0) continue;
        if (claim.kind === "LOCAL_MATERIAL") {
          const project = await tx.productionProject.findFirst({
            where: { id: claim.projectId ?? "", companyId: ctx.company.id },
            select: { code: true, status: true },
          });
          if (!project || project.status === "COMPLETED" || project.status === "CANCELLED") {
            skipped.push(claim.number);
            continue;
          }
        }
        await approveTx(tx, ctx, claim, { amount: claim.amount, reason: null });
        approved += 1;
        total = total.plus(claim.amount);
        if (claim.employee.userId) {
          await sendInApp(
            tx,
            ctx.company.id,
            [{ userId: claim.employee.userId, employeeId: claim.employee.id }],
            {
              subject: `Claim ${claim.number} approved`,
              body: `${amountText(claim.amount)} for ${claimWhat(claim)} on ${formatDay(
                dateOnly(claim.date),
              )} is approved. Accounts pays it back to you.`,
              entityType: "MyClaim",
              entityId: claim.id,
            },
          );
        }
      }
      await auditInCompany(
        ctx,
        meta,
        {
          action: "STATUS_CHANGE",
          entityType: "StaffClaim",
          entityId: null,
          summary: `Approved ${approved} staff claim${approved === 1 ? "" : "s"} for ${monthLabel(
            month,
          )} as claimed (${amountText(total)})${skipped.length ? `; left ${skipped.join(", ")} (project closed)` : ""}`,
        },
        tx,
      );
      return { approved, skipped };
    },
    { timeout: 120_000 },
  );
  return { ...result, needsLook: ledger.totals.needsLook };
}

// =============================================================================
// Paying back (Accounts)
// =============================================================================

/**
 * Pays an employee back everything approved and still owed to them, in one
 * payment: Dr Payable to Staff (employee), Cr Cash / Bank / Wallet.
 */
export async function payBackClaims(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanPayMoney(ctx, "Only Accounts can pay claims back.");
  const input = payBackClaimsSchema.parse(raw);
  const companyId = ctx.company.id;
  const date = input.date ? toInstant(input.date, ctx.company.timezone) : new Date();
  const result = await prisma.$transaction(async (tx) => {
    await lockRow(tx, "Employee", input.employeeId);
    const employee = await tx.employee.findFirst({
      where: { id: input.employeeId, companyId },
      select: { id: true, code: true, name: true, userId: true },
    });
    if (!employee) throw new AppError("NOT_FOUND", "Employee not found.");
    if (employee.userId === ctx.user.id && !isCompanyOwner(ctx)) {
      throw new AppError("FORBIDDEN", "Someone else in Accounts pays your own claims back.");
    }
    const claims = await tx.staffClaim.findMany({
      where: {
        companyId,
        employeeId: employee.id,
        status: "APPROVED",
        paidAt: null,
        payrollItemId: null,
        OR: [{ expenseId: null }, { expense: { voidedAt: null } }],
      },
      orderBy: [{ date: "asc" }, { number: "asc" }],
    });
    if (claims.length === 0) {
      throw new AppError("CONFLICT", `Nothing is owed to ${employee.name} for claims.`);
    }
    const total = claims.reduce((t, c) => t.plus(c.approvedAmount ?? c.amount), ZERO);
    const acc = await ensureControlAccounts(companyId, tx);
    const paidFrom = await cashAccountFor(tx, companyId, input.method, input.accountId);
    const numbers = claims.map((c) => c.number).join(", ");
    const entry = await postJournalEntry(tx, {
      companyId,
      date,
      description: `Claims paid back to ${employee.name} (${employee.code}): ${numbers}`,
      sourceType: "STAFF_CLAIM",
      sourceId: claims[0]!.id,
      postedById: ctx.user.id,
      lines: [
        {
          accountId: acc.EMPLOYEE_PAYABLE,
          employeeId: employee.id,
          debit: total,
          memo: numbers,
        },
        { accountId: paidFrom, credit: total, memo: input.reference ?? undefined },
      ],
    });
    const marked = await tx.staffClaim.updateMany({
      where: { id: { in: claims.map((c) => c.id) }, paidAt: null, payrollItemId: null },
      data: { paidAt: date, paidById: ctx.user.id, paymentEntryId: entry.id },
    });
    if (marked.count !== claims.length) {
      // A payroll took some of them to pay with the salary at the same moment.
      throw new AppError(
        "CONFLICT",
        `Some of ${employee.name}'s claims were just put on a salary. Look again before paying.`,
      );
    }
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "StaffClaim",
        entityId: claims[0]!.id,
        summary: `Paid ${employee.code} ${employee.name} back ${amountText(total)} for ${claims.length} claim${
          claims.length === 1 ? "" : "s"
        } (${numbers}), ${input.method}, ${entry.number}`,
      },
      tx,
    );
    if (employee.userId) {
      await sendInApp(tx, companyId, [{ userId: employee.userId, employeeId: employee.id }], {
        subject: "Your claims are paid",
        body: `Accounts paid you ${amountText(total)} for ${numbers}.`,
        entityType: "MyClaim",
        entityId: claims[0]!.id,
      });
    }
    return { count: claims.length, total, entry };
  }, TX_OPTIONS);
  return {
    employeeId: input.employeeId,
    count: result.count,
    amount: result.total.toFixed(2),
    entryId: result.entry.id,
    entryNumber: result.entry.number,
  };
}

/**
 * What a company owes an employee for approved claims not paid back yet and
 * not on an approved payroll (those are part of the salary owed).
 */
export async function owedForClaims(db: Db, companyId: string, employeeId: string) {
  const owed = await db.staffClaim.findMany({
    where: {
      companyId,
      employeeId,
      status: "APPROVED",
      paidAt: null,
      payrollItemId: null,
      OR: [{ expenseId: null }, { expense: { voidedAt: null } }],
    },
    select: { approvedAmount: true, amount: true },
  });
  return owed.reduce((t, c) => t.plus(c.approvedAmount ?? c.amount), ZERO);
}
