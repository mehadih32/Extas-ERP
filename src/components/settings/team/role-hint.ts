import { roleSummary } from "@/components/settings/roles/role-labels";
import type { TeamRole } from "@/modules/rbac/member.service";

/** A line under a role picker saying what the chosen role is for. */
export function roleHint(role: TeamRole | undefined): string | undefined {
  return role ? (roleSummary(role) ?? undefined) : undefined;
}
