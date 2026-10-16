import type { Metadata } from "next";
import Link from "next/link";

import { AiNoAccess } from "@/components/ai/no-access";
import { SkillForm } from "@/components/ai/skill-form";
import { SectionError } from "@/components/dashboard/section-error";
import { Panel } from "@/components/sales/detail-bits";
import { listSkillsAction } from "@/server/actions/ai.actions";

export const metadata: Metadata = { title: "Teach a new skill" };

/** Teach a new skill (ai.manage): the agent, and the skill in plain words. */
export default async function NewAiSkillPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { agent } = await searchParams;
  const result = await listSkillsAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <AiNoAccess />;
    return <SectionError title="Skills" heading="The skills could not load" error={result.error} />;
  }
  if (!result.data.can.manage) {
    return (
      <AiNoAccess title="Only the owner teaches the AI skills">
        You can read the skills on <Link href="/ai/skills">Skills</Link>.
      </AiNoAccess>
    );
  }
  const agents = result.data.agents;
  const chosen = typeof agent === "string" && agents.some((a) => a.key === agent) ? agent : null;
  return (
    <Panel title="Teach a new skill" id="ai-skill-new-heading">
      <p className="mt-1 mb-5 text-sm text-muted-foreground">
        Write it the way you would explain it to a new member of staff, in Bengali or English. After
        saving, add PDFs or photos as knowledge and run the test on the skill&apos;s page.
      </p>
      <SkillForm mode="new" agents={agents} agent={chosen} />
    </Panel>
  );
}
