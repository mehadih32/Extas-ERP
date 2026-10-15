import type { Metadata } from "next";

import { KnowledgeScreen } from "@/components/ai/knowledge-screen";
import { AiNoAccess } from "@/components/ai/no-access";
import { SectionError } from "@/components/dashboard/section-error";
import { getKnowledgeAction } from "@/server/actions/mehedi.actions";

export const metadata: Metadata = { title: "Books & tests" };

/** Books & tests (ai.view or ai.manage): Mehedi 2.0's books and where each test stands. */
export default async function AiKnowledgePage() {
  const result = await getKnowledgeAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <AiNoAccess />;
    return (
      <SectionError title="Books & tests" heading="The books could not load" error={result.error} />
    );
  }
  return <KnowledgeScreen knowledge={result.data} />;
}
