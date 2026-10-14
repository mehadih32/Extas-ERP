import type { Metadata } from "next";

import { ModelsTable } from "@/components/ai/models-table";
import { AiNoAccess } from "@/components/ai/no-access";
import { SectionError } from "@/components/dashboard/section-error";
import { getModelsAction } from "@/server/actions/ai.actions";

export const metadata: Metadata = { title: "AI Models" };

/** Models (ai.view to see, ai.manage to change): which Claude model does each task. */
export default async function AiModelsPage() {
  const result = await getModelsAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <AiNoAccess />;
    return <SectionError title="Models" heading="The models could not load" error={result.error} />;
  }
  return <ModelsTable models={result.data} />;
}
