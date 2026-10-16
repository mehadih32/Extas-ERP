import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AiNoAccess } from "@/components/ai/no-access";
import { SkillScreen } from "@/components/ai/skill-screen";
import { SectionError } from "@/components/dashboard/section-error";
import { getSkillAction } from "@/server/actions/ai.actions";

export const metadata: Metadata = { title: "AI Skill" };

/** One skill (ai.view to see, ai.manage to change, test or undo it). */
export default async function AiSkillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getSkillAction(id);
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <AiNoAccess />;
    if (result.error.code === "NOT_FOUND") notFound();
    return <SectionError title="Skill" heading="The skill could not load" error={result.error} />;
  }
  return <SkillScreen skill={result.data} />;
}
