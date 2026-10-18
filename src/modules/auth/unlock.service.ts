import { z } from "zod";

import { generateSessionToken, hashSessionToken } from "@/lib/auth/token";
import { visitorAddress } from "@/lib/cloudflare-ips";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import type { RequestMeta } from "@/lib/request-meta";
import { recordAudit } from "@/modules/audit/audit.service";
import { unlockSignIn } from "@/modules/auth/auth.service";
import { emailSchema } from "@/modules/auth/schemas";

/*
 * "Email me an unlock link" on the sign-in screen (v6.4.1 B5). Wrong passwords
 * from one place make that place wait 15 minutes for the account; the person
 * (the owner above all) can end the wait from their own mailbox. The link
 * carries a random token that works once, for 30 minutes; only its hash is
 * kept, on the person's account (a new link replaces the old one). Opening the
 * link only shows a button: pressing it unlocks, so a mail program that opens
 * links by itself cannot use it up. The answer to asking is the same whether
 * or not the email belongs to anyone, and asking is limited per place and per
 * account. The owner can also unlock through the bot with the PIN
 * (bot/incoming.ts).
 */

export const UNLOCK_LINK_MINUTES = 30;

export const UNLOCK_ASKED_TEXT =
  "If this email belongs to an account here, a link to unlock its sign-in is on its way. It works once, for 30 minutes.";

const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

export const unlockAskSchema = z.object({ email: emailSchema });

/** The store whose mailbox sends it: the person's last store, else their first active one. */
async function mailboxOf(user: { id: string; lastCompanyId: string | null }) {
  if (user.lastCompanyId) return user.lastCompanyId;
  const membership = await prisma.companyMembership.findFirst({
    where: { userId: user.id, isActive: true },
    orderBy: { joinedAt: "asc" },
    select: { companyId: true },
  });
  if (membership) return membership.companyId;
  const first = await prisma.company.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return first?.id ?? null;
}

/** Emails an unlock link to the account's own address; the same answer for any email. */
export async function askUnlockLink(input: unknown, meta: RequestMeta = {}) {
  const { email } = unlockAskSchema.parse(input);
  checkRateLimit(`unlock-ask:${visitorAddress(meta.ipAddress) ?? "unknown"}`, 5, 60 * 60_000);
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      status: true,
      passwordHash: true,
      lastCompanyId: true,
    },
  });
  if (!user || !user.passwordHash || user.status === "SUSPENDED") return UNLOCK_ASKED_TEXT;
  try {
    checkRateLimit(`unlock-ask-account:${user.id}`, 3, 60 * 60_000);
  } catch {
    return UNLOCK_ASKED_TEXT;
  }
  const companyId = await mailboxOf(user);
  if (!companyId) return UNLOCK_ASKED_TEXT;
  const token = generateSessionToken();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      unlockTokenHash: hashSessionToken(token),
      unlockTokenUntil: new Date(Date.now() + UNLOCK_LINK_MINUTES * 60_000),
    },
  });
  const link = `${appUrl()}/sign-in?unlock=${encodeURIComponent(token)}`;
  const { sendMail } = await import("@/modules/mail/mail.service");
  try {
    await sendMail(
      companyId,
      {
        to: user.email,
        subject: "Unlock your sign-in to Extas ERP",
        text: [
          `Hello ${user.name},`,
          "",
          "Someone (you, we hope) asked to unlock sign-in to your Extas ERP account after wrong passwords. Open this link and press “Unlock my sign-in”:",
          "",
          link,
          "",
          `It works once, for ${UNLOCK_LINK_MINUTES} minutes. It does not change your password. If you did not ask for it, do nothing, and think about changing your password.`,
        ].join("\n"),
      },
      { entityType: "User", entityId: user.id, userId: user.id },
    );
  } catch (error) {
    // Logged in the message log; the answer stays the same.
    console.error("[unlock] link not sent", error instanceof Error ? error.message : error);
  }
  await recordAudit({
    action: "UPDATE",
    entityType: "User",
    entityId: user.id,
    userId: user.id,
    summary: "Asked for a link to unlock sign-in (emailed to the account's own address)",
    meta,
  });
  return UNLOCK_ASKED_TEXT;
}

export const unlockLinkSchema = z.object({ token: z.string().trim().min(20).max(200) });

/** "Unlock my sign-in" on the link: once, while it has not run out. */
export async function unlockWithLink(input: unknown, meta: RequestMeta = {}) {
  const parsed = unlockLinkSchema.safeParse(input);
  const gone = new AppError(
    "VALIDATION",
    "This unlock link has run out or was used already. Ask for a new one below.",
  );
  if (!parsed.success) throw gone;
  checkRateLimit(`unlock-use:${visitorAddress(meta.ipAddress) ?? "unknown"}`, 10, 60 * 60_000);
  const hash = hashSessionToken(parsed.data.token);
  const user = await prisma.user.findUnique({
    where: { unlockTokenHash: hash },
    select: { id: true },
  });
  if (!user) throw gone;
  // Used once: only the press that clears it unlocks.
  const used = await prisma.user.updateMany({
    where: { id: user.id, unlockTokenHash: hash, unlockTokenUntil: { gt: new Date() } },
    data: { unlockTokenHash: null, unlockTokenUntil: null },
  });
  if (used.count !== 1) throw gone;
  await unlockSignIn(user.id, "with the emailed link", meta);
  return "Unlocked: sign in with your password.";
}
