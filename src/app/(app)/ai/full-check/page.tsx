import type { Metadata } from "next";

import { FullCheckScreen } from "@/components/ai/full-check-screen";
import { AiNoAccess } from "@/components/ai/no-access";
import { SectionError } from "@/components/dashboard/section-error";
import { getFullCheckAction } from "@/server/actions/full-check.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Full check" };

/**
 * The Full check (the platform owner only, next to Server Health): every
 * screen, PDF and link checked on GitHub's computers, the problems with
 * screenshots, and Claude Code's fixes to merge.
 */
export default async function FullCheckPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  if (!ctx.user.isSuperAdmin) {
    return (
      <AiNoAccess title="Only the platform owner runs the Full check">
        The Full check opens the whole ERP as every role and sends work to Claude Code, so only the
        platform owner opens it.
      </AiNoAccess>
    );
  }
  const { run } = await searchParams;
  const result = await getFullCheckAction(typeof run === "string" ? run : undefined);
  if (!result.ok) {
    return (
      <SectionError
        title="Full check"
        heading="The Full check could not load"
        error={result.error}
      />
    );
  }
  return <FullCheckScreen check={result.data} />;
}
