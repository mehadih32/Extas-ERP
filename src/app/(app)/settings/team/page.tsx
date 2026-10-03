import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { NoAccess } from "@/components/settings/no-access";
import { TeamScreen } from "@/components/settings/team/team-screen";
import { getTeamAction } from "@/server/actions/rbac.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Team" };

/**
 * The people in the company (company.members.manage, the same check as the
 * member actions). Each row offers only what the server would allow.
 */
export default async function TeamPage() {
  const ctx = await requireCompanyPage();
  const result = await getTeamAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <NoAccess title="The team is not part of your role">
          Your administrator can give your role the permission to add and manage people.
        </NoAccess>
      );
    }
    return <SectionError title="Team" heading="The team could not load" error={result.error} />;
  }
  return <TeamScreen team={result.data} companyName={ctx.company.name} />;
}
