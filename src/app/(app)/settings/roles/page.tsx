import { PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { NoAccess } from "@/components/settings/no-access";
import { RoleCards } from "@/components/settings/roles/role-cards";
import { Button } from "@/components/ui/button";
import { getRolesAction } from "@/server/actions/rbac.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Roles" };

/**
 * The company's roles. People who manage the team or the roles may see them (the
 * same check as GET /api/roles); only company.roles.manage may create or change them.
 */
export default async function RolesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const [result, { deleted }] = await Promise.all([getRolesAction(), searchParams]);
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <NoAccess title="Roles are not part of your role">
          Your administrator can give your role the permission to manage the team or the roles.
        </NoAccess>
      );
    }
    return <SectionError title="Roles" heading="The roles could not load" error={result.error} />;
  }
  const { roles, canManage } = result.data;

  return (
    <section aria-labelledby="roles-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="roles-heading" className="font-serif text-2xl text-primary">
            Roles
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            A role is a set of permissions. Everyone in {ctx.company.name} has one role, which
            decides what they can see and do.
          </p>
        </div>
        {canManage && (
          <Button asChild className="w-full sm:w-auto">
            <Link href="/settings/roles/new">
              <PlusIcon aria-hidden />
              New role
            </Link>
          </Button>
        )}
      </div>
      {deleted === "1" && <FormAlert tone="success">The role was deleted.</FormAlert>}
      {!canManage && (
        <FormAlert tone="note">
          You can see what each role allows. Changing roles needs the permission to manage them.
        </FormAlert>
      )}
      <RoleCards roles={roles} />
    </section>
  );
}
