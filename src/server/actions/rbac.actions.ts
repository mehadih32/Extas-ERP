"use server";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requirePermission } from "@/modules/auth/context";
import {
  addMember,
  changeMemberRole,
  resetMemberPassword,
  setMemberActive,
} from "@/modules/rbac/member.service";
import { createRole, deleteRole, updateRole } from "@/modules/rbac/role.service";

// --- Roles -------------------------------------------------------------------

export async function createRoleAction(input: unknown) {
  return runAction(async () => {
    const ctx = await requirePermission("company.roles.manage");
    return createRole(ctx, input, await getRequestMeta());
  });
}

export async function updateRoleAction(roleId: string, input: unknown) {
  return runAction(async () => {
    const ctx = await requirePermission("company.roles.manage");
    await updateRole(ctx, roleId, input, await getRequestMeta());
    return null;
  });
}

export async function deleteRoleAction(roleId: string) {
  return runAction(async () => {
    const ctx = await requirePermission("company.roles.manage");
    await deleteRole(ctx, roleId, await getRequestMeta());
    return null;
  });
}

// --- Members -----------------------------------------------------------------

export async function addMemberAction(input: unknown) {
  return runAction(async () => {
    const ctx = await requirePermission("company.members.manage");
    return addMember(ctx, input, await getRequestMeta());
  });
}

export async function changeMemberRoleAction(membershipId: string, roleId: string) {
  return runAction(async () => {
    const ctx = await requirePermission("company.members.manage");
    return changeMemberRole(ctx, membershipId, roleId, await getRequestMeta());
  });
}

export async function setMemberActiveAction(membershipId: string, isActive: boolean) {
  return runAction(async () => {
    const ctx = await requirePermission("company.members.manage");
    return setMemberActive(ctx, membershipId, isActive, await getRequestMeta());
  });
}

export async function resetMemberPasswordAction(membershipId: string) {
  return runAction(async () => {
    const ctx = await requirePermission("company.members.manage");
    return resetMemberPassword(ctx, membershipId, await getRequestMeta());
  });
}
