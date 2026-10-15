import type { Metadata } from "next";

import { ChatScreen } from "@/components/ai/chat-screen";
import { AiNoAccess } from "@/components/ai/no-access";
import { SectionError } from "@/components/dashboard/section-error";
import { getChatAction } from "@/server/actions/mehedi.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Chat with Mehedi 2.0" };

/** Chat (ai.manage only): the owner's conversation with Mehedi 2.0, the same as on the bot. */
export default async function AiChatPage() {
  const ctx = await requireCompanyPage();
  if (!ctx.permissions.has("ai.manage")) {
    return (
      <AiNoAccess title="Only the owner chats with Mehedi 2.0">
        He acts in the owner&apos;s name, so only the owner gives him commands.
      </AiNoAccess>
    );
  }
  const result = await getChatAction();
  if (!result.ok) {
    return <SectionError title="Chat" heading="The chat could not load" error={result.error} />;
  }
  return <ChatScreen chat={result.data} />;
}
