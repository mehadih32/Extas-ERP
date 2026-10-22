import { prisma } from "@/lib/prisma";

/*
 * The online shops' logs, cleared by the nightly housekeeping (CN-005):
 *   - the call log (IntegrationApiCall): 90 days;
 *   - the kept answers of Idempotency-Keys (IntegrationIdempotency): 30 days
 *     after the answer (a shop repeats a request within minutes, never weeks);
 *     a request that never answered is cut off after 2 minutes (route.ts), so
 *     one 30 days old goes too;
 *   - webhooks sent to a shop (outgoing WebhookEvent) that were delivered or
 *     skipped: 90 days after. FAILED ones stay, to be looked into.
 * Nothing else: orders, payments and returns the shops made are business
 * records and are never cleared.
 */

const DAY = 24 * 60 * 60_000;

export async function purgeShopLogs(now: Date = new Date()): Promise<number> {
  const before = (days: number) => new Date(now.getTime() - days * DAY);
  const calls = await prisma.integrationApiCall.deleteMany({
    where: { createdAt: { lt: before(90) } },
  });
  const answers = await prisma.integrationIdempotency.deleteMany({
    where: {
      OR: [
        { completedAt: { lt: before(30) } },
        { completedAt: null, createdAt: { lt: before(30) } },
      ],
    },
  });
  const webhooks = await prisma.webhookEvent.deleteMany({
    where: {
      direction: "OUTGOING",
      status: { in: ["PROCESSED", "IGNORED"] },
      OR: [
        { processedAt: { lt: before(90) } },
        { processedAt: null, receivedAt: { lt: before(90) } },
      ],
    },
  });
  return calls.count + answers.count + webhooks.count;
}
