import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { BackLink } from "@/components/settings/back-link";
import { NoAccess } from "@/components/settings/no-access";
import { RolePermissionList } from "@/components/settings/roles/role-details";
import { RoleEditor } from "@/components/settings/roles/role-editor";
import { roleSummary } from "@/components/settings/roles/role-labels";
import { Badge } from "@/components/ui/badge";
import { getRolesAction } from "@/server/actions/rbac.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Role" };

/** Why a custom role cannot be deleted yet: deactivated people keep their role too. */
function deleteHint(holders: number, active: number): string {
  const deactivated = holders - active;
  const who = holders === 1 ? "the person" : `the ${holders} people`;
  const note =
    deactivated === 0
      ? ""
      : deactivated === holders
        ? ` ${holders === 1 ? "They are" : "They are all"} deactivated, and still count.`
        : ` ${deactivated} of them ${deactivated === 1 ? "is" : "are"} deactivated, and still count.`;
  return `To delete this role, first move ${who} in it to another role on the Team tab.${note}`;
}

/**
 * One role: an editor for people who may change it (role.can, from the same rules
 * updateRole and deleteRole use), otherwise what the role allows.
 */
export default async function RolePage({
  params,
  searchParams,
}: {
  params: Promise<{ roleId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCompanyPage();
  const [{ roleId }, { created }, result] = await Promise.all([
    params,
    searchParams,
    getRolesAction(),
  ]);
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <NoAccess title="Roles are not part of your role">
          Your administrator can give your role the permission to manage the team or the roles.
        </NoAccess>
      );
    }
    return <SectionError title="Roles" heading="The role could not load" error={result.error} />;
  }
  const { roles, canManage } = result.data;
  const role = roles.find((r) => r.id === roleId);
  if (!role) notFound();
  const summary = roleSummary(role);
  const people = `${role.memberCount} ${role.memberCount === 1 ? "person has" : "people have"} this role`;

  return (
    <div className="grid gap-6">
      <BackLink href="/settings/roles">All roles</BackLink>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={role.isSystem ? "secondary" : "outline"}>
            {role.isSystem ? "Built-in" : "Custom"}
          </Badge>
          <span className="text-sm text-muted-foreground">{people}</span>
        </div>
        <h2 className="mt-3 font-serif text-2xl text-primary">{role.name}</h2>
        {summary && !role.can.edit && (
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">{summary}</p>
        )}
      </div>

      {created === "1" && (
        <FormAlert tone="success">
          The role was created. Give it to people from the Team tab.
        </FormAlert>
      )}

      {role.can.edit ? (
        <>
          {canManage && !role.isSystem && role.membershipCount > 0 && (
            <FormAlert tone="note">{deleteHint(role.membershipCount, role.memberCount)}</FormAlert>
          )}
          <RoleEditor key={role.id} mode="edit" role={role} />
        </>
      ) : (
        <>
          {role.systemRole === "SUPER_ADMIN" ? (
            <FormAlert tone="note">
              The Super Admin role always has every permission, so it cannot be changed or deleted.
            </FormAlert>
          ) : (
            <FormAlert tone="note">
              You can see what this role allows. Changing it needs the permission to manage roles.
            </FormAlert>
          )}
          <RolePermissionList permissions={role.permissions} />
        </>
      )}
    </div>
  );
}
