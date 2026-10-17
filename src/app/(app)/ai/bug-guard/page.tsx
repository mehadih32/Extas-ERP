import type { Metadata } from "next";

import { BugGuardScreen } from "@/components/ai/bug-guard-screen";
import { AiNoAccess } from "@/components/ai/no-access";
import { SectionError } from "@/components/dashboard/section-error";
import { getBugGuardAction } from "@/server/actions/bug-guard.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Bug Guard" };

/**
 * Bug Guard (the platform owner only): the all-round auditor of screens, data
 * and accounts, security, use and the AI, with its fixes.
 */
export default async function BugGuardPage() {
  const ctx = await requireCompanyPage();
  if (!ctx.user.isSuperAdmin) {
    return (
      <AiNoAccess title="Only the platform owner uses Bug Guard">
        Bug Guard checks the whole ERP and proposes fixes to its code, data and security, so only
        the platform owner opens it.
      </AiNoAccess>
    );
  }
  const result = await getBugGuardAction();
  if (!result.ok) {
    return (
      <SectionError title="Bug Guard" heading="Bug Guard could not load" error={result.error} />
    );
  }
  return <BugGuardScreen guard={result.data} />;
}
