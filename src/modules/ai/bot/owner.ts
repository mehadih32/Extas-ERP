import type { AiBotLink, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { type CompanyAccess, resolveCompanyAccess } from "@/modules/companies/access";

/*
 * Who the bot works for: the person who linked it, only while they may still
 * run the AI in the store (active, not waiting to change their password, with
 * access to the store and ai.manage). The same check decides whose messages
 * the bot answers (incoming.ts) and who gets its ordinary pushes (push.ts,
 * send-push.ts), so a person who was suspended, left the team or lost
 * ai.manage gets no more briefs, drafts or requests (v6.4.1). The owner's own
 * alarms (push.ts ownersLinks) go by their own rule.
 */

const ownerFields = {
  id: true,
  email: true,
  name: true,
  phone: true,
  avatarUrl: true,
  status: true,
  isSuperAdmin: true,
  mustChangePassword: true,
} as const;

export type BotOwner = {
  user: Prisma.UserGetPayload<{ select: typeof ownerFields }>;
  access: CompanyAccess;
};

/** The link's owner with their access in the store, or null when the bot may not work for them now. */
export async function botOwner(
  link: Pick<AiBotLink, "ownerId" | "companyId">,
): Promise<BotOwner | null> {
  if (!link.ownerId) return null;
  const user = await prisma.user.findUnique({ where: { id: link.ownerId }, select: ownerFields });
  if (!user || user.status !== "ACTIVE" || user.mustChangePassword) return null;
  const access = await resolveCompanyAccess(user, link.companyId);
  if (!access?.permissions.has("ai.manage")) return null;
  return { user, access };
}

/** Of these links, the ones whose owner the bot may still work for. */
export async function workingLinks<L extends Pick<AiBotLink, "ownerId" | "companyId">>(
  links: L[],
): Promise<L[]> {
  const out: L[] = [];
  for (const link of links) if (await botOwner(link)) out.push(link);
  return out;
}
