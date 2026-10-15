import type { Metadata } from "next";

import { MailSettings } from "@/components/ai/mail-settings";
import { AiNoAccess } from "@/components/ai/no-access";
import { AiSettingsForms } from "@/components/ai/settings-forms";
import { SectionError } from "@/components/dashboard/section-error";
import { getAiStatusAction } from "@/server/actions/ai.actions";
import { getMailSettingsAction } from "@/server/actions/mehedi.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "AI Settings" };

/**
 * Settings (ai.manage only): the Claude key, the PIN and the AI's name, the
 * email drafts are sent from, and the reminder for unsent buyer drafts.
 */
export default async function AiSettingsPage() {
  const ctx = await requireCompanyPage();
  if (!ctx.permissions.has("ai.manage")) {
    return (
      <AiNoAccess title="Only the owner opens AI settings">
        The Claude key and the PIN are the owner&apos;s.
      </AiNoAccess>
    );
  }
  const [result, mail] = await Promise.all([getAiStatusAction(), getMailSettingsAction()]);
  if (!result.ok) {
    return (
      <SectionError title="Settings" heading="AI settings could not load" error={result.error} />
    );
  }
  return (
    <div className="grid gap-6">
      <AiSettingsForms status={result.data} />
      {mail.ok ? (
        <MailSettings mail={mail.data} replyRemindHours={result.data.replyRemindHours} />
      ) : (
        <SectionError
          title="Email for sending"
          heading="The email settings could not load"
          error={mail.error}
        />
      )}
    </div>
  );
}
