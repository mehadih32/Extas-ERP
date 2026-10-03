import type { UserStatus } from "@prisma/client";

/*
 * Words the Team screen uses for a member, kept apart from the components so
 * they can be tested.
 */

export type Standing = { label: string; tone: "active" | "invited" | "muted" | "alert" };

/** Where a member stands: deactivated here, suspended everywhere, still to sign in, or active. */
export function memberStanding(member: { isActive: boolean; status: UserStatus }): Standing {
  if (!member.isActive) return { label: "Deactivated", tone: "muted" };
  if (member.status === "SUSPENDED") return { label: "Suspended", tone: "alert" };
  if (member.status === "INVITED") return { label: "Invited", tone: "invited" };
  return { label: "Active", tone: "active" };
}

/** Every word typed must appear in the name, email, phone or role ("rafiq sales"). */
export function matchesSearch(
  member: { name: string; email: string; phone: string | null; role: { name: string } },
  query: string,
): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [member.name, member.email, member.phone ?? "", member.role.name]
    .join(" ")
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** "Rafiq Islam" → "Rafiq". */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/**
 * The sign-in details an admin hands over with a temporary password (by hand,
 * until sending them from the app is built with the messaging integrations).
 */
export function signInDetails(details: {
  name: string;
  email: string;
  temporaryPassword: string;
  signInAddress: string;
  companyName: string;
}): string {
  return [
    `${details.companyName}: sign-in details for ${details.name}`,
    `Address: ${details.signInAddress}`,
    `Email: ${details.email}`,
    `Temporary password: ${details.temporaryPassword}`,
    "You will be asked to choose your own password after signing in.",
  ].join("\n");
}
