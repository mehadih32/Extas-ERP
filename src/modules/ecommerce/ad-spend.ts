import { localDay } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { auditInCompany } from "@/modules/audit/audit.service";

import { EcommerceApiError } from "./errors";
import { ShopResponse, type ShopCall } from "./route";
import { adSpendSchema } from "./schemas";

/*
 * POST /ad-spend (CN-005): what the shop spent on ads one day on one platform
 * (and campaign), kept as AdSpend. The shop sends running daily totals, so a
 * day's figure for the same platform and campaign is replaced by the newer
 * one (200, replaced: true); a new one is added (201). No campaign is a
 * figure of its own. Two at once for the same figure wait for each other (a
 * lock on the day, platform and campaign), so there is always one row.
 *
 * Ad spend is a report figure, not money moving: nothing is posted to the
 * books (the bills are paid and booked as expenses in Accounts).
 */

export async function recordAdSpend(call: ShopCall) {
  const input = adSpendSchema.parse(call.body);
  const { ctx } = call;
  const companyId = ctx.company.id;
  const campaign = input.campaign ? input.campaign : null;
  // An ad account a little ahead of the company's clock may already be on tomorrow.
  const tomorrow = localDay(new Date(Date.now() + 86_400_000), ctx.company.timezone);
  if (input.date > tomorrow) {
    const message = "Ad spend is sent for a day that has begun, not one still to come.";
    throw new EcommerceApiError(422, "VALIDATION", message, { date: [message] });
  }
  const date = new Date(`${input.date}T00:00:00Z`);

  const { row, replaced } = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ad-spend:${companyId}:${input.date}:${input.platform}:${campaign ?? ""}`}))`;
      const existing = await tx.adSpend.findFirst({
        where: { companyId, date, platform: input.platform, campaign },
        orderBy: { createdAt: "asc" },
      });
      const what = `${input.platform}${campaign ? ` (${campaign})` : ""} on ${input.date}`;
      if (existing) {
        const row = await tx.adSpend.update({
          where: { id: existing.id },
          data: { amount: input.amount },
        });
        await auditInCompany(
          ctx,
          call.meta,
          {
            action: "UPDATE",
            entityType: "AdSpend",
            entityId: row.id,
            summary: `Ad spend ${what} is now ${row.amount.toFixed(2)} (was ${existing.amount.toFixed(2)})`,
            before: { amount: existing.amount.toFixed(2) },
            after: { amount: row.amount.toFixed(2) },
          },
          tx,
        );
        return { row, replaced: true };
      }
      const row = await tx.adSpend.create({
        data: { companyId, date, platform: input.platform, campaign, amount: input.amount },
      });
      await auditInCompany(
        ctx,
        call.meta,
        {
          action: "CREATE",
          entityType: "AdSpend",
          entityId: row.id,
          summary: `Ad spend ${what}: ${row.amount.toFixed(2)}`,
          after: { amount: row.amount.toFixed(2) },
        },
        tx,
      );
      return { row, replaced: false };
    },
    { timeout: 30_000 },
  );
  const body = {
    erpAdSpendId: row.id,
    date: input.date,
    platform: row.platform,
    campaign: row.campaign,
    amount: Number(row.amount.toFixed(2)),
    replaced,
  };
  return new ShopResponse(replaced ? 200 : 201, body);
}
