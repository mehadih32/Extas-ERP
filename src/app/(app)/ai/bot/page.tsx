import type { Metadata } from "next";

import { BotScreen } from "@/components/ai/bot-screen";
import { AiNoAccess } from "@/components/ai/no-access";
import { SectionError } from "@/components/dashboard/section-error";
import { getBotAction } from "@/server/actions/bot.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "AI Bot" };

/** Bot (ai.manage only): Telegram now, WhatsApp later, linked to the owner's own account. */
export default async function AiBotPage() {
  const ctx = await requireCompanyPage();
  if (!ctx.permissions.has("ai.manage")) {
    return (
      <AiNoAccess title="Only the owner sets up the bot">
        The bot works in the owner&apos;s name, so only the owner connects and links it.
      </AiNoAccess>
    );
  }
  const result = await getBotAction();
  if (!result.ok) {
    return (
      <SectionError title="Bot" heading="The bot settings could not load" error={result.error} />
    );
  }
  return <BotScreen bot={result.data} />;
}
