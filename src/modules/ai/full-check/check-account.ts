import { prisma } from "@/lib/prisma";

/*
 * The Full check's own accounts (v6.4 A4): one per role it checks,
 * check-<roleId>@check.invalid, never a real person's login. ".invalid" can
 * never receive mail; such an account has no password (it can never sign in),
 * no membership (it is no one's colleague: no team list, inbox or role shows
 * it), and its sessions carry the role they check (Session.checkRoleId), only
 * read on the live site (src/lib/read-only.ts) and end with the check.
 */

export const CHECK_EMAIL_DOMAIN = "check.invalid";

export const checkEmail = (roleId: string) => `check-${roleId}@${CHECK_EMAIL_DOMAIN}`;

/** Whether an address is kept for the Full check's accounts. */
export const isCheckAddress = (email: string) =>
  email.trim().toLowerCase().endsWith(`@${CHECK_EMAIL_DOMAIN}`);

export const CHECK_ADDRESS_TEXT =
  "This address is kept for the Full check's own accounts: use a person's email.";

/** The check account for a role (made the first time), as it shows in the check's report. */
export async function checkAccountFor(role: { id: string; name: string }, label: string) {
  const name = `Full check (${label})`;
  return prisma.user.upsert({
    where: { email: checkEmail(role.id) },
    create: { email: checkEmail(role.id), name, passwordHash: null, status: "ACTIVE" },
    // Kept as it must be, whatever happened to it since.
    update: { name, passwordHash: null, status: "ACTIVE", isSuperAdmin: false },
    select: { id: true, name: true },
  });
}
