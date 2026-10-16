/**
 * The check after an update (deploy/deploy.sh): opens every screen of the new
 * version the way the owner would, and the newest records' screens and PDFs,
 * and says for each whether it worked. deploy.sh goes back to the version
 * before the update when anything fails.
 *
 * It signs in with a session of its own that lasts ten minutes and deletes it at
 * the end; it only reads (it opens screens and downloads PDFs, nothing is sent).
 *   CHECK_URL    the new app inside the server (http://app:3000)
 *   CHECK_EMAIL  whose screens to open: the owner (SEED_ADMIN_EMAIL)
 * Each result is a "==> " line, which reaches the Deploy run's log on GitHub.
 * Exit code 0: everything opened; 1: something did not.
 */
import { join } from "node:path";

import { SESSION_COOKIE } from "@/lib/auth/session-cookie";
import { generateSessionToken, hashSessionToken } from "@/lib/auth/token";
import { prisma } from "@/lib/prisma";
import { pinScrubReport } from "@/modules/ai/bot/pin-scrub";

import { fillRoute, isFixedRoute, pdfProblem, screenProblem, screenRoutes } from "./update-checks";

const say = (text: string) => console.log(`==> ${text}`);

/** The newest records' ids, by the name each takes in a screen's address. */
async function newestRecords(companyId: string): Promise<Record<string, string>> {
  const newest = {
    where: { companyId },
    orderBy: { createdAt: "desc" as const },
    select: { id: true },
  };
  const [booking, batch, project, buyer, style, employee, order, booked] = await Promise.all([
    prisma.booking.findFirst(newest),
    prisma.productionBatch.findFirst(newest),
    prisma.productionProject.findFirst(newest),
    prisma.party.findFirst({ ...newest, where: { companyId, kind: { in: ["BUYER", "BOTH"] } } }),
    prisma.style.findFirst(newest),
    prisma.employee.findFirst(newest),
    prisma.purchaseOrder.findFirst(newest),
    // The newest batch with a booking, for its booking book.
    prisma.purchaseOrder.findFirst({
      where: { companyId, batchId: { not: null }, booking: { isNot: null } },
      orderBy: { createdAt: "desc" },
      select: { batchId: true },
    }),
  ]);
  const ids: Record<string, string> = { list: "buyers", section: "getting-started" };
  if (booking) ids.bookingId = booking.id;
  if (batch) ids.batchId = batch.id;
  if (project) ids.projectId = project.id;
  if (buyer) ids.partyId = buyer.id;
  if (style) ids.styleId = style.id;
  if (employee) ids.employeeId = employee.id;
  if (order) ids.orderId = order.id;
  if (booked?.batchId) ids.bookedBatchId = booked.batchId;
  return ids;
}

/** Record screens worth opening after every update (their ids come from newestRecords). */
const RECORD_SCREENS = [
  "/production/bookings/[bookingId]",
  "/production/bookings/[bookingId]/edit",
  "/production/batches/[batchId]",
  "/production/batches/[batchId]/summary",
  "/production/batches/[batchId]/cm-settlement",
  "/production/projects/[projectId]",
  "/production/projects/[projectId]/materials",
  "/parties/[list]/[partyId]",
  "/products/[styleId]",
  "/hr/employees/[employeeId]",
  "/materials/orders/[orderId]",
  "/help/[section]",
];

/** PDFs worth printing after every update. */
const RECORD_PDFS = [
  { name: "Booking PDF", route: "/api/production/bookings/[bookingId]/pdf" },
  { name: "Booking book PDF", route: "/api/production/batches/[bookedBatchId]/booking-book" },
];

async function main() {
  const base = (process.env.CHECK_URL ?? "http://app:3000").replace(/\/+$/, "");
  const email = process.env.CHECK_EMAIL?.trim().toLowerCase();
  const owner = email
    ? await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          status: true,
          mustChangePassword: true,
          memberships: { select: { companyId: true }, take: 1 },
        },
      })
    : null;
  if (!owner || owner.status !== "ACTIVE") {
    say("Screens not checked: there is no owner account yet (deploy/create-owner.sh)");
    return;
  }
  if (owner.mustChangePassword) {
    say("Screens not checked: the owner has not chosen a password yet (first sign-in)");
    return;
  }
  const companyId = owner.memberships[0]?.companyId ?? null;

  const token = generateSessionToken();
  const session = await prisma.session.create({
    data: {
      userId: owner.id,
      token: hashSessionToken(token),
      activeCompanyId: companyId,
      userAgent: "Extas ERP update check",
      expiresAt: new Date(Date.now() + 10 * 60_000),
    },
  });
  const headers = { cookie: `${SESSION_COOKIE}=${token}`, "user-agent": "Extas ERP update check" };
  // Printing a PDF either way round keeps that pick for the owner; theirs is put back after.
  const preference = await prisma.userPreference.findUnique({
    where: { userId: owner.id },
    select: { pdfOrientation: true },
  });
  const failed: string[] = [];
  let opened = 0;

  try {
    const ids = companyId ? await newestRecords(companyId) : {};
    const all = screenRoutes(join(process.cwd(), "src", "app", "(app)"));
    const screens = [
      ...all.filter(isFixedRoute),
      ...RECORD_SCREENS.filter((r) => all.includes(r))
        .map((r) => fillRoute(r, ids))
        .filter((r): r is string => r !== null),
    ];

    for (const path of screens) {
      try {
        const response = await fetch(`${base}${path}`, {
          headers,
          redirect: "follow",
          signal: AbortSignal.timeout(60_000),
        });
        const problem = screenProblem({
          status: response.status,
          url: response.url,
          body: await response.text(),
        });
        if (problem) {
          failed.push(path);
          say(`Screen ${path} ${problem}`);
        } else {
          opened += 1;
        }
      } catch (error) {
        failed.push(path);
        say(`Screen ${path} did not answer (${error instanceof Error ? error.message : error})`);
      }
    }
    say(`Opened ${opened} of ${screens.length} screens without an error`);

    for (const pdf of RECORD_PDFS) {
      const route = fillRoute(pdf.route, ids);
      if (!route) {
        say(`${pdf.name}: nothing to print yet`);
        continue;
      }
      for (const query of pdfQueries(pdf.route)) {
        const label = query ? `${pdf.name} (${query.split("=")[1]})` : pdf.name;
        try {
          const response = await fetch(`${base}${route}${query ? `?${query}` : ""}`, {
            headers,
            signal: AbortSignal.timeout(120_000),
          });
          const problem = pdfProblem({
            status: response.status,
            type: response.headers.get("content-type") ?? "",
            bytes: new Uint8Array(await response.arrayBuffer()),
          });
          if (problem) {
            failed.push(label);
            say(`${label} ${problem}`);
          } else {
            say(`${label} printed`);
          }
        } catch (error) {
          failed.push(label);
          say(`${label} did not answer (${error instanceof Error ? error.message : error})`);
        }
      }
    }
  } finally {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    await prisma.userPreference
      .updateMany({
        where: { userId: owner.id },
        data: { pdfOrientation: preference?.pdfOrientation ?? null },
      })
      .catch(() => undefined);
  }

  await pinReport();

  if (failed.length > 0) {
    say(`The check found ${failed.length} problem(s): ${failed.slice(0, 10).join(", ")}`);
    process.exitCode = 1;
  } else {
    say("Every screen checked opened without an error");
  }
}

/**
 * Bot messages hidden as a PIN that did not follow a PIN request (the v6.3
 * update hid every 4 to 8 digit message): counts and days only, never words.
 */
async function pinReport() {
  try {
    const r = await pinScrubReport();
    if (r.notAfterRequest === 0) {
      say(`Bot PINs: ${r.hidden} hidden, every one typed after the bot asked for the PIN`);
      return;
    }
    const days = [...new Set(r.notAfterRequestDates.map((d) => d.toISOString().slice(0, 10)))];
    say(
      `Bot PINs: ${r.hidden} hidden; ${r.notAfterRequest} did not follow a PIN request (${days.slice(0, 10).join(", ")}): they may have been order numbers, and the backup made before the v6.3 update still has their words`,
    );
  } catch (error) {
    say(`Bot PINs: not counted (${error instanceof Error ? error.message : error})`);
  }
}

/** The ways a PDF is printed: each orientation for those that offer the choice. */
function pdfQueries(route: string): string[] {
  return ORIENTED_PDFS.has(route) ? ["orientation=landscape", "orientation=portrait"] : [""];
}

/** PDFs printed either way round, checked both ways. */
const ORIENTED_PDFS = new Set<string>([
  "/api/production/bookings/[bookingId]/pdf",
  "/api/production/batches/[bookedBatchId]/booking-book",
]);

main()
  .catch((error) => {
    say(`The check could not run: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
