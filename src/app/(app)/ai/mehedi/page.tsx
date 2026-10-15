import type { Metadata } from "next";

import { MehediProfile } from "@/components/ai/mehedi-profile";
import { AiNoAccess } from "@/components/ai/no-access";
import { SectionError } from "@/components/dashboard/section-error";
import { getMehediAction } from "@/server/actions/mehedi.actions";

export const metadata: Metadata = { title: "Mehedi 2.0" };

/**
 * Mehedi 2.0 (ai.view or ai.manage): who he is, his limits, how far Control
 * lets him go, his budget and tests, what he did last, and Teach.
 */
export default async function MehediPage() {
  const result = await getMehediAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <AiNoAccess />;
    return (
      <SectionError title="Mehedi 2.0" heading="His profile could not load" error={result.error} />
    );
  }
  return <MehediProfile profile={result.data} />;
}
