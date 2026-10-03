"use server";

import { revalidatePath } from "next/cache";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import {
  addMember,
  changeMemberRole,
  listTeam,
  resetMemberPassword,
  setMemberActive,
} from "@/modules/rbac/member.service";
import { createRole, deleteRole, getRolesScreen, updateRole } from "@/modules/rbac/role.service";

/*
 * Team and roles. Reading the team and changing members needs
 * company.members.manage; changing roles needs company.roles.manage, and people
 * with either may read the roles. Each change refreshes the screens, whose
 * menus and buttons may depend on it (someone can change their own role).
 */

const refreshScreens = () => revalidatePath("/", "layout");

// --- Roles -------------------------------------------------------------------

export async function getRolesAction() {
  return runAction(async () =>
    getRolesScreen(await requireAnyPermission("company.members.manage", "company.roles.manage")),
  );
}

export async function createRoleAction(input: unknown) {
  return runAction(async () => {
    const ctx = await requirePermission("company.roles.manage");
    const role = await createRole(ctx, input, await getRequestMeta());
    refreshScreens();
    return role;
  });
}

export async function updateRoleAction(roleId: string, input: unknown) {
  return runAction(async () => {
    const ctx = await requirePermission("company.roles.manage");
    await updateRole(ctx, roleId, input, await getRequestMeta());
    refreshScreens();
    return null;
  });
}

export async function deleteRoleAction(roleId: string) {
  return runAction(async () => {
    const ctx = await requirePermission("company.roles.manage");
    await deleteRole(ctx, roleId, await getRequestMeta());
    refreshScreens();
    return null;
  });
}

// --- Members -----------------------------------------------------------------

export async function getTeamAction() {
  return runAction(async () => listTeam(await requirePermission("company.members.manage")));
}

export async function addMemberAction(input: unknown) {
  return runAction(async () => {
    const ctx = await requirePermission("company.members.manage");
    const added = await addMember(ctx, input, await getRequestMeta());
    refreshScreens();
    return added;
  });
}

export async function changeMemberRoleAction(membershipId: string, roleId: string) {
  return runAction(async () => {
    const ctx = await requirePermission("company.members.manage");
    const updated = await changeMemberRole(ctx, membershipId, roleId, await getRequestMeta());
    refreshScreens();
    return updated;
  });
}

export async function setMemberActiveAction(membershipId: string, isActive: boolean) {
  return runAction(async () => {
    const ctx = await requirePermission("company.members.manage");
    const updated = await setMemberActive(ctx, membershipId, isActive, await getRequestMeta());
    refreshScreens();
    return updated;
  });
}

export async function resetMemberPasswordAction(membershipId: string) {
  return runAction(async () => {
    const ctx = await requirePermission("company.members.manage");
    const reset = await resetMemberPassword(ctx, membershipId, await getRequestMeta());
    refreshScreens();
    return reset;
  });
}
