import type { Metadata } from "next";

import { AiNoAccess } from "@/components/ai/no-access";
import { SkillsList } from "@/components/ai/skills-list";
import { SectionError } from "@/components/dashboard/section-error";
import { listSkillsAction } from "@/server/actions/ai.actions";

export const metadata: Metadata = { title: "AI Skills" };

/** Skills (ai.view to see, ai.manage to teach): what the owner taught each agent. */
export default async function AiSkillsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { agent } = await searchParams;
  const result = await listSkillsAction(typeof agent === "string" && agent ? agent : undefined);
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <AiNoAccess />;
    return <SectionError title="Skills" heading="The skills could not load" error={result.error} />;
  }
  return <SkillsList list={result.data} />;
}
