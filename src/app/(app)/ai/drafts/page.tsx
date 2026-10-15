import type { Metadata } from "next";

import { DraftsScreen } from "@/components/ai/drafts-screen";
import { AiNoAccess } from "@/components/ai/no-access";
import { SectionError } from "@/components/dashboard/section-error";
import { getDraftsAction } from "@/server/actions/mehedi.actions";

export const metadata: Metadata = { title: "AI Drafts" };

/** Drafts (ai.view or ai.manage): messages waiting for the owner's Send, and follow-up dates. */
export default async function AiDraftsPage({
  searchParams,
}: {
  searchParams: Promise<{ list?: string }>;
}) {
  const { list } = await searchParams;
  const result = await getDraftsAction(list);
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <AiNoAccess />;
    return <SectionError title="Drafts" heading="The drafts could not load" error={result.error} />;
  }
  return <DraftsScreen drafts={result.data} />;
}
