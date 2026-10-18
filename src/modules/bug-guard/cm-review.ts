import { prisma } from "@/lib/prisma";
import { readOnly } from "@/lib/read-only";
import { formatAmount } from "@/lib/format";
import { OPEN_ORDER_STATUSES } from "@/modules/materials/rules";
import { readSpecs } from "@/modules/production/booking-schemas";
import {
  settlementsUnderNewRules,
  type SettlementUnderNewRules,
} from "@/modules/production/batch-money.service";
import { readFabricBasis } from "@/modules/production/tech-pack";
import { sendInApp } from "@/modules/reminders/notification.service";

import { ownersOf } from "./owner";
import { READ_ONLY_WHY } from "./runner";

/*
 * Once after the v6.4.2 update, for each company, Bug Guard looks at what the
 * new money rules would see differently in what is already saved, and lists it
 * in the owner's ERP inbox (never on Telegram, never to anyone else). It changes
 * nothing: the owner decides later.
 *   (a) Saved CM settlements whose final payable would differ under the new
 *       rules (faults about material the factory supplied left out, payments
 *       that paid its material bills not counted as CM paid, rejects over the
 *       allowance never at 0): factory, batch, the amount saved and the amount
 *       under the new rules.
 *   (b) Open bookings made for one style whose approval kept no fabric record of
 *       that style, so a change to the style's fabric will not mark them red.
 * Both lists are worked out inside readOnly() (a write would be refused) and with
 * no AI; the only writes are the inbox message and Bug Guard's own log line. When
 * both lists are empty the message says so plainly. It is sent once per company.
 */

/** Marks the log line: the review is sent once per company. */
export const CM_REVIEW_EVENT = "v6.4.2 review of saved CM settlements and bookings";

/** An open booking for one style that a fabric change will not mark red. */
export type UnwatchedBooking = {
  id: string;
  number: string;
  supplier: string;
  style: { code: string; name: string };
  stage: "APPROVED" | "SENT";
};

/** (b): approved or sent bookings, still open, on an order made for one style, with no fabric record of it. */
export async function bookingsWithoutFabricRecord(companyId: string): Promise<UnwatchedBooking[]> {
  const rows = await prisma.booking.findMany({
    where: {
      companyId,
      stage: { in: ["APPROVED", "SENT"] },
      order: { status: { in: [...OPEN_ORDER_STATUSES] }, projectId: { not: null } },
    },
    select: {
      id: true,
      stage: true,
      fabricBasis: true,
      order: {
        select: {
          number: true,
          supplier: { select: { name: true } },
          project: { select: { id: true, code: true, name: true } },
          lines: { select: { specs: true, rawMaterial: { select: { kind: true } } } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  return rows.flatMap((b) => {
    const project = b.order.project;
    if (!project || b.stage === "DRAFT") return [];
    // Only fabric is watched: a booking with no fabric line has nothing to turn red.
    const fabric = b.order.lines.some(
      (l) =>
        l.rawMaterial.kind === "FABRIC" && readSpecs(l.specs, l.rawMaterial.kind).role === "FABRIC",
    );
    if (!fabric || readFabricBasis(b.fabricBasis).has(project.id)) return [];
    return [
      {
        id: b.id,
        number: b.order.number,
        supplier: b.order.supplier.name,
        style: { code: project.code, name: project.name },
        stage: b.stage,
      },
    ];
  });
}

/** Both lists for one company, only reading. */
export async function cmRulesReview(companyId: string) {
  return readOnly(READ_ONLY_WHY, async () => ({
    settlements: await settlementsUnderNewRules(prisma, companyId),
    bookings: await bookingsWithoutFabricRecord(companyId),
  }));
}

/** Items listed one by one in the message, at most, per list. */
const LISTED = 10;

const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

function settlementLine(s: SettlementUnderNewRules, show: (v: string) => string) {
  const why = [
    s.leftOut.length > 0 &&
      `${s.leftOut.map((f) => `${f.number} (${f.what.toLowerCase()}, ${show(f.amount)})`).join(", ")} would not be taken off: material the factory supplied`,
    Number(s.paidOnBills) > 0 &&
      `${show(s.paidOnBills)} of the payments counted paid the factory's material bills`,
    s.needPrice.length > 0 &&
      `rejects over the allowance were charged at 0 for ${s.needPrice.map((n) => `${n.code} (${n.over})`).join(", ")}: a price per reject is needed`,
  ].filter(Boolean);
  return `- ${s.factory}, batch ${s.batch.code} (${s.number}): saved ${show(s.oldPayable)}, under the new rules ${show(s.newPayable)}${
    s.needPrice.length > 0 ? " before the rejects are priced" : ""
  }. ${why.join("; ")}.`;
}

/** The inbox message: both lists in plain words, or plainly that both are empty. */
export function reviewText(
  review: Awaited<ReturnType<typeof cmRulesReview>>,
  currency: string,
): { subject: string; body: string } {
  const show = (v: string) => formatAmount(v, 2, currency);
  const { settlements, bookings } = review;
  const more = (n: number) => (n > LISTED ? [`- and ${n - LISTED} more.`] : []);
  if (settlements.length === 0 && bookings.length === 0) {
    return {
      subject: "Bug Guard: nothing to review after the update",
      body: [
        "Bug Guard looked at what is already saved, after the update. Nothing was changed.",
        "No saved CM settlement would come out different under the new rules.",
        "No open booking for one style is missed when that style's fabric changes.",
        "There is nothing for you to do.",
      ].join("\n"),
    };
  }
  const body = [
    "Bug Guard looked at what is already saved, after the update. Nothing was changed: you decide what to do.",
    "",
    settlements.length === 0
      ? "CM settlements: none would come out different under the new rules."
      : `CM settlements that would come out different under the new rules (${settlements.length}). To use the new amount, undo the settlement on the batch's CM settlement screen and save it again:`,
    ...settlements.slice(0, LISTED).map((s) => settlementLine(s, show)),
    ...more(settlements.length),
    "",
    bookings.length === 0
      ? "Bookings: every open booking for one style turns red when that style's fabric changes."
      : `Open bookings for one style that will not turn red when that style's fabric changes (${bookings.length}). Check the style's fabric on them yourself before the supplier makes it:`,
    ...bookings
      .slice(0, LISTED)
      .map(
        (b) =>
          `- ${b.number} from ${b.supplier}, for ${b.style.code} ${b.style.name} (${b.stage === "SENT" ? "sent" : "approved"}).`,
      ),
    ...more(bookings.length),
    "",
    `${appUrl()}/production/batches`,
  ].join("\n");
  return {
    subject: `Bug Guard: ${settlements.length} CM settlement${settlements.length === 1 ? "" : "s"} and ${bookings.length} booking${bookings.length === 1 ? "" : "s"} to review after the update`,
    body,
  };
}

/**
 * Sends the review to the company's owners' inbox, once: "SENT", "ALREADY" (sent
 * after an earlier update) or "NO_OWNER" (no owner to tell; it is tried again
 * after the next update).
 */
export async function reportCmRulesReview(companyId: string) {
  const sent = await prisma.bugGuardEvent.findFirst({
    where: { companyId, kind: "REPORT", summary: { startsWith: CM_REVIEW_EVENT } },
    select: { id: true },
  });
  if (sent) return "ALREADY" as const;
  const owners = await ownersOf(companyId);
  if (owners.length === 0) return "NO_OWNER" as const;
  const review = await cmRulesReview(companyId);
  const company = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { currency: true },
  });
  const { subject, body } = reviewText(review, company.currency);
  await sendInApp(
    prisma,
    companyId,
    owners.map((o) => ({ userId: o.id })),
    { subject, body, entityType: "BugGuardRun", entityId: companyId },
  );
  await prisma.bugGuardEvent.create({
    data: {
      companyId,
      kind: "REPORT",
      summary: `${CM_REVIEW_EVENT}: ${review.settlements.length} settlement(s), ${review.bookings.length} booking(s) listed in the inbox; nothing changed`,
    },
  });
  return "SENT" as const;
}
