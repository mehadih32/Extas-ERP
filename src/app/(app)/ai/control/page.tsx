import type { Metadata } from "next";

import { ControlPanel } from "@/components/ai/control-panel";
import { AiNoAccess } from "@/components/ai/no-access";
import { SectionError } from "@/components/dashboard/section-error";
import { getControlAction } from "@/server/actions/ai.actions";

export const metadata: Metadata = { title: "AI Control" };

/**
 * Control (ai.view to see, ai.manage to change): Do / Ask / Off on every cell
 * of the access tree, presets, and cells opened for a while.
 */
export default async function AiControlPage() {
  const result = await getControlAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <AiNoAccess />;
    return <SectionError title="Control" heading="Control could not load" error={result.error} />;
  }
  return <ControlPanel control={result.data} />;
}
