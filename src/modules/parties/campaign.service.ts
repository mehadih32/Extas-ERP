import type { MessageChannel, Party } from "@prisma/client";

import { AppError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { fillTemplate, whatsappDigits, whatsappLink } from "@/modules/parties/contact";
import { listDormantBuyers } from "@/modules/parties/dormant.service";
import { createCampaignSchema, recipientStatusSchema } from "@/modules/parties/schemas";

/*
 * Dormant buyer re-engagement campaigns
 * -------------------------------------
 * A campaign is a message (optionally with a catalog / stock-availability link)
 * sent to a list of buyers. This module builds each buyer's personalised
 * message and a one-click link (WhatsApp wa.me, mailto: or sms:) and tracks
 * delivery and responses. Automatic sending through a WhatsApp Business / email
 * provider plugs in later with the Notifications module.
 */

type Contact = Pick<Party, "phone" | "whatsapp" | "email">;

function canReach(channel: MessageChannel, p: Contact): boolean {
  if (channel === "EMAIL") return Boolean(p.email);
  return Boolean(whatsappDigits(p.whatsapp ?? p.phone));
}

function personalise(
  template: string,
  party: Pick<Party, "name" | "contactPerson">,
  companyName: string,
  catalogFileUrl: string | null,
): string {
  const text = fillTemplate(template, {
    BuyerName: party.name,
    ContactPerson: party.contactPerson ?? party.name,
    CompanyName: companyName,
    CatalogLink: catalogFileUrl ?? "",
  });
  // Without a {CatalogLink} placeholder the catalog goes on its own line at the end.
  return catalogFileUrl && !template.includes("{CatalogLink}")
    ? `${text}\n\n${catalogFileUrl}`
    : text;
}

function shareLink(
  channel: MessageChannel,
  p: Contact,
  subject: string,
  message: string,
): string | null {
  if (channel === "WHATSAPP") return whatsappLink(p.whatsapp ?? p.phone, message);
  if (channel === "EMAIL") {
    return p.email
      ? `mailto:${p.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`
      : null;
  }
  if (channel === "SMS") {
    const digits = whatsappDigits(p.phone ?? p.whatsapp);
    return digits ? `sms:+${digits}?body=${encodeURIComponent(message)}` : null;
  }
  return null;
}

async function getCampaignOrThrow(ctx: CompanyContext, campaignId: string) {
  const campaign = await ctx.db.reEngagementCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new AppError("NOT_FOUND", "Campaign not found.");
  return campaign;
}

/**
 * Creates a draft campaign. Recipients are the given buyers, or by default every
 * dormant wholesale / B2B buyer inactive for `inactivityMonths`. Buyers that
 * cannot be reached on the chosen channel are skipped and listed.
 */
export async function createCampaign(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = createCampaignSchema.parse(raw);

  let candidates: Array<Pick<Party, "id" | "code" | "name" | "phone" | "whatsapp" | "email">>;
  if (input.partyIds) {
    const ids = [...new Set(input.partyIds)];
    candidates = await ctx.db.party.findMany({
      where: {
        id: { in: ids },
        kind: { in: ["BUYER", "BOTH"] },
        status: { in: ["ACTIVE", "DORMANT"] },
        systemRole: null,
      },
      select: { id: true, code: true, name: true, phone: true, whatsapp: true, email: true },
    });
    if (candidates.length !== ids.length) {
      throw new AppError(
        "VALIDATION",
        "Some recipients are not open buyer accounts of this company.",
      );
    }
  } else {
    candidates = (await listDormantBuyers(ctx, { months: input.inactivityMonths })).items;
  }

  const reachable = candidates.filter((p) => canReach(input.channel, p));
  const skipped = candidates
    .filter((p) => !canReach(input.channel, p))
    .map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      reason: input.channel === "EMAIL" ? "No email address" : "No valid phone / WhatsApp number",
    }));
  if (reachable.length === 0) {
    throw new AppError(
      "VALIDATION",
      candidates.length === 0
        ? "No buyers match this campaign."
        : `None of the ${candidates.length} buyer(s) can be reached by ${input.channel.toLowerCase()}.`,
      { skipped: skipped.map((p) => `${p.code} ${p.name}: ${p.reason}`) },
    );
  }

  const campaign = await ctx.db.reEngagementCampaign.create({
    data: {
      companyId: ctx.company.id,
      name: input.name,
      inactivityMonths: input.inactivityMonths,
      channel: input.channel,
      message: input.message,
      catalogFileUrl: input.catalogFileUrl ?? null,
      recipients: { create: reachable.map((p) => ({ partyId: p.id })) },
    },
  });
  await auditInCompany(ctx, meta, {
    action: "CREATE",
    entityType: "ReEngagementCampaign",
    entityId: campaign.id,
    summary: `Created ${input.channel.toLowerCase()} campaign "${campaign.name}" for ${reachable.length} buyer(s)`,
  });
  return { campaign, recipientCount: reachable.length, skipped };
}

export async function listCampaigns(ctx: CompanyContext) {
  const campaigns = await ctx.db.reEngagementCampaign.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const ids = campaigns.map((c) => c.id);
  const [byStatus, responded] = await Promise.all([
    ctx.db.campaignRecipient.groupBy({
      by: ["campaignId", "status"],
      where: { campaignId: { in: ids } },
      _count: { _all: true },
    }),
    ctx.db.campaignRecipient.groupBy({
      by: ["campaignId"],
      where: { campaignId: { in: ids }, respondedAt: { not: null } },
      _count: { _all: true },
    }),
  ]);
  return campaigns.map((c) => {
    const counts = { PENDING: 0, SENT: 0, DELIVERED: 0, READ: 0, FAILED: 0 };
    for (const row of byStatus) if (row.campaignId === c.id) counts[row.status] = row._count._all;
    return {
      ...c,
      recipients: Object.values(counts).reduce((a, b) => a + b, 0),
      delivery: counts,
      responded: responded.find((r) => r.campaignId === c.id)?._count._all ?? 0,
    };
  });
}

/**
 * Campaign with every recipient's personalised message and one-click link
 * (open the link, press send, then mark the recipient as sent).
 */
export async function getCampaign(ctx: CompanyContext, campaignId: string) {
  const campaign = await getCampaignOrThrow(ctx, campaignId);
  const recipients = await ctx.db.campaignRecipient.findMany({
    where: { campaignId: campaign.id },
    include: {
      party: {
        select: {
          id: true,
          code: true,
          name: true,
          contactPerson: true,
          phone: true,
          whatsapp: true,
          email: true,
          grade: true,
          isVerified: true,
          lastTransactionAt: true,
        },
      },
    },
    orderBy: { party: { name: "asc" } },
  });
  return {
    ...campaign,
    recipients: recipients.map((r) => {
      const message = personalise(
        campaign.message,
        r.party,
        ctx.company.name,
        campaign.catalogFileUrl,
      );
      return {
        id: r.id,
        status: r.status,
        sentAt: r.sentAt,
        respondedAt: r.respondedAt,
        error: r.error,
        party: r.party,
        message,
        link: shareLink(campaign.channel, r.party, campaign.name, message),
      };
    }),
  };
}

/** Logs what happened to one recipient: sent, delivered, read, failed, responded. */
export async function updateRecipientStatus(
  ctx: CompanyContext,
  campaignId: string,
  recipientId: string,
  raw: unknown,
) {
  const input = recipientStatusSchema.parse(raw);
  const campaign = await getCampaignOrThrow(ctx, campaignId);
  if (campaign.status === "CANCELLED") {
    throw new AppError("CONFLICT", "This campaign was cancelled.");
  }
  const recipient = await ctx.db.campaignRecipient.findFirst({
    where: { id: recipientId, campaignId: campaign.id },
  });
  if (!recipient) throw new AppError("NOT_FOUND", "Recipient not found in this campaign.");

  const now = new Date();
  const updated = await ctx.db.campaignRecipient.update({
    where: { id: recipient.id },
    data: {
      status: input.status,
      sentAt: input.status === "FAILED" ? recipient.sentAt : (recipient.sentAt ?? now),
      error: input.status === "FAILED" ? (input.error ?? "Not delivered") : null,
      ...(input.responded !== undefined
        ? { respondedAt: input.responded ? (recipient.respondedAt ?? now) : null }
        : {}),
    },
  });
  if (campaign.status === "DRAFT" || campaign.status === "SCHEDULED") {
    await ctx.db.reEngagementCampaign.update({
      where: { id: campaign.id },
      data: { status: "SENDING" },
    });
  }
  return updated;
}

/** Marks the campaign as sent once the messages have gone out. */
export async function completeCampaign(
  ctx: CompanyContext,
  campaignId: string,
  meta?: RequestMeta,
) {
  const campaign = await getCampaignOrThrow(ctx, campaignId);
  if (campaign.status === "CANCELLED" || campaign.status === "SENT") {
    throw new AppError("CONFLICT", `This campaign is already ${campaign.status.toLowerCase()}.`);
  }
  const updated = await ctx.db.reEngagementCampaign.update({
    where: { id: campaign.id },
    data: { status: "SENT", sentAt: new Date() },
  });
  await auditInCompany(ctx, meta, {
    action: "STATUS_CHANGE",
    entityType: "ReEngagementCampaign",
    entityId: campaign.id,
    summary: `Campaign "${campaign.name}" marked as sent`,
  });
  return updated;
}

export async function cancelCampaign(ctx: CompanyContext, campaignId: string, meta?: RequestMeta) {
  const campaign = await getCampaignOrThrow(ctx, campaignId);
  if (campaign.status === "SENT" || campaign.status === "CANCELLED") {
    throw new AppError("CONFLICT", `This campaign is already ${campaign.status.toLowerCase()}.`);
  }
  const updated = await ctx.db.reEngagementCampaign.update({
    where: { id: campaign.id },
    data: { status: "CANCELLED" },
  });
  await auditInCompany(ctx, meta, {
    action: "STATUS_CHANGE",
    entityType: "ReEngagementCampaign",
    entityId: campaign.id,
    summary: `Campaign "${campaign.name}" cancelled`,
  });
  return updated;
}
