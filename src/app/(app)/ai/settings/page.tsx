import type { Metadata } from "next";

import { AiNoAccess } from "@/components/ai/no-access";
import { AiSettingsForms } from "@/components/ai/settings-forms";
import { SectionError } from "@/components/dashboard/section-error";
import { getAiStatusAction } from "@/server/actions/ai.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "AI Settings" };

/** Settings (ai.manage only): the Claude key, the PIN and the AI's name. */
export default async function AiSettingsPage() {
  const ctx = await requireCompanyPage();
  if (!ctx.permissions.has("ai.manage")) {
    return (
      <AiNoAccess title="Only the owner opens AI settings">
        The Claude key and the PIN are the owner&apos;s.
      </AiNoAccess>
    );
  }
  const result = await getAiStatusAction();
  if (!result.ok) {
    return (
      <SectionError title="Settings" heading="AI settings could not load" error={result.error} />
    );
  }
  return <AiSettingsForms status={result.data} />;
}
