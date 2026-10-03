import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { BackLink } from "@/components/settings/back-link";
import { NoAccess } from "@/components/settings/no-access";
import { RoleEditor } from "@/components/settings/roles/role-editor";
import { getRolesAction } from "@/server/actions/rbac.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "New role" };

/** A new custom role (company.roles.manage, like createRoleAction). */
export default async function NewRolePage() {
  await requireCompanyPage();
  const result = await getRolesAction();
  if (!result.ok && result.error.code !== "FORBIDDEN") {
    return <SectionError title="Roles" heading="The roles could not load" error={result.error} />;
  }
  if (!result.ok || !result.data.canManage) {
    return (
      <NoAccess title="Making roles is not part of your role">
        Your administrator can give your role the permission to manage roles.
      </NoAccess>
    );
  }

  return (
    <div className="grid gap-6">
      <BackLink href="/settings/roles">All roles</BackLink>
      <div>
        <h2 className="font-serif text-2xl text-primary">New role</h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Name the role and tick what it allows. You can give it to people from the Team tab.
        </p>
      </div>
      <RoleEditor mode="create" templates={result.data.roles} />
    </div>
  );
}
