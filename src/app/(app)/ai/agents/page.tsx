import type { Metadata } from "next";

import { AgentsScreen } from "@/components/ai/agents-screen";
import { AiNoAccess } from "@/components/ai/no-access";
import { SectionError } from "@/components/dashboard/section-error";
import { getAgentsAction } from "@/server/actions/ai.actions";

export const metadata: Metadata = { title: "AI Agents" };

/**
 * Agents (ai.view to see, ai.manage to switch one on or off): Mehedi 2.0 and
 * every agent under him, with its model, Control cells, skills, books, cost
 * and last runs.
 */
export default async function AiAgentsPage() {
  const result = await getAgentsAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <AiNoAccess />;
    return <SectionError title="Agents" heading="The agents could not load" error={result.error} />;
  }
  return <AgentsScreen screen={result.data} />;
}
