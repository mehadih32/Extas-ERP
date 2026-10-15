"use client";

import { LinkIcon, MessageCircleIcon, SendIcon, Trash2Icon, UnlinkIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { StatusBadge } from "@/components/sales/badges";
import { Panel } from "@/components/sales/detail-bits";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BotScreen as Bot } from "@/modules/ai/bot/bot.service";
import {
  removeBotAction,
  saveTelegramAction,
  saveWhatsAppAction,
  startLinkAction,
  testBotAction,
  unlinkBotAction,
} from "@/server/actions/bot.actions";

/*
 * AI Center > Bot (the owner's): the Telegram bot (now) and the WhatsApp
 * Business number (ready for later), each linked to the owner's own account
 * with a one-time code; the last messages in and out.
 */

type Channel = "TELEGRAM" | "WHATSAPP";
type Result = { ok: true } | { ok: false; error: { message: string } };

const when = (at: Date | string | null) =>
  at
    ? new Date(at).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

const STATUS_TEXT: Record<string, string> = {
  RECEIVED: "Received",
  DONE: "Answered",
  IGNORED: "Not answered",
  SENT: "Sent",
  FAILED: "Not sent",
};

export function BotScreen({ bot: b }: { bot: Bot }) {
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<Channel | null>(null);
  const [code, setCode] = useState<{ channel: Channel; code: string; open: string | null } | null>(
    null,
  );
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string }>();

  const run = (work: () => Promise<Result>, done: string) =>
    startTransition(async () => {
      const result = await work();
      setMessage(
        result.ok ? { tone: "success", text: done } : { tone: "error", text: result.error.message },
      );
    });

  const link = (channel: Channel) =>
    startTransition(async () => {
      const result = await startLinkAction(channel);
      if (!result.ok) return setMessage({ tone: "error", text: result.error.message });
      setMessage(undefined);
      setCode({ channel, code: result.data.code, open: result.data.open });
    });

  const linkPanel = (channel: Channel, l: NonNullable<Bot["telegram"]>) => (
    <div className="grid gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={l.linked ? "done" : "warn"}>
          {l.linked ? "Linked" : "Not linked yet"}
        </StatusBadge>
        <span className="text-muted-foreground">
          {l.linked
            ? `To ${l.chatName ?? "your account"} since ${when(l.linkedAt)}. Messages from anyone else get no answer.`
            : "Link your own account: only that account is heard."}
        </span>
      </div>
      {code?.channel === channel && !l.linked && (
        <div className="grid gap-2 rounded-md border border-primary/30 bg-secondary p-3">
          <p>
            Send this code to the bot from your own{" "}
            {channel === "TELEGRAM" ? "Telegram" : "WhatsApp"} within 10 minutes:
          </p>
          <p className="font-mono text-lg tracking-widest">{code.code}</p>
          {code.open && (
            <a
              href={code.open}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              Open the bot with the code
            </a>
          )}
          <p className="text-[0.8125rem] text-muted-foreground">Then refresh this page.</p>
        </div>
      )}
      {l.webhookError && <FormAlert tone="error">{l.webhookError}</FormAlert>}
      <div className="flex flex-wrap gap-2">
        {l.linked ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() => testBotAction(channel), "A test message is on its way to you.")
              }
            >
              <SendIcon aria-hidden />
              Send a test message
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() => unlinkBotAction(channel), "Unlinked: the bot hears nobody now.")
              }
            >
              <UnlinkIcon aria-hidden />
              Unlink
            </Button>
          </>
        ) : (
          <Button type="button" size="sm" disabled={pending} onClick={() => link(channel)}>
            <LinkIcon aria-hidden />
            Link my account
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(() => removeBotAction(channel), "The bot is removed.")}
        >
          <Trash2Icon aria-hidden />
          Remove the bot
        </Button>
      </div>
    </div>
  );

  return (
    <div className="grid gap-6">
      {message && <FormAlert tone={message.tone}>{message.text}</FormAlert>}
      {b.ai.text && (
        <FormAlert tone="note">
          {b.ai.text} Until then the bot answers only &quot;help&quot; and &quot;status&quot;.
        </FormAlert>
      )}
      {!b.pinSet && (
        <FormAlert tone="note">
          Set your PIN in AI Center &gt; Settings: the bot asks for it for money, prices and
          Deletion requests.
        </FormAlert>
      )}

      <Panel
        title="Telegram"
        id="bot-telegram-heading"
        action={
          <Button
            type="button"
            size="sm"
            variant={b.telegram ? "outline" : "default"}
            onClick={() => setDialog("TELEGRAM")}
          >
            <MessageCircleIcon aria-hidden />
            {b.telegram ? "Change the bot" : "Connect a bot"}
          </Button>
        }
      >
        <div className="mt-2 grid gap-3 text-sm">
          {b.telegram ? (
            <>
              <p>
                Bot <span className="font-medium">{b.telegram.botName}</span>. Write to it as you
                write in AI Center &gt; Chat: the same commands, the same Control.
              </p>
              {linkPanel("TELEGRAM", b.telegram)}
            </>
          ) : (
            <ol className="grid list-decimal gap-1 pl-5 text-muted-foreground">
              <li>In Telegram, open @BotFather and send /newbot.</li>
              <li>Give the bot a name, then a user name ending in &quot;bot&quot;.</li>
              <li>Copy the token @BotFather gives you and press Connect a bot here.</li>
            </ol>
          )}
        </div>
      </Panel>

      <Panel
        title="WhatsApp (for later)"
        id="bot-whatsapp-heading"
        action={
          <Button type="button" size="sm" variant="outline" onClick={() => setDialog("WHATSAPP")}>
            <MessageCircleIcon aria-hidden />
            {b.whatsapp ? "Change the number" : "Add the number"}
          </Button>
        }
      >
        <div className="mt-2 grid gap-3 text-sm">
          {b.whatsapp ? (
            <>
              <p>
                Business number <span className="font-medium">{b.whatsapp.botName}</span>. In your
                Meta app, set the webhook to{" "}
                <span className="font-mono break-all">{b.webhooks.whatsapp}</span> with the verify
                token <span className="font-mono break-all">{b.whatsapp.verifyToken}</span>, and
                subscribe to &quot;messages&quot;.
              </p>
              {linkPanel("WHATSAPP", b.whatsapp)}
            </>
          ) : (
            <p className="text-muted-foreground">
              Ready for when you have a WhatsApp Business number on the Meta WhatsApp Business
              Platform: add its phone number ID, access token and app secret here. Nothing else
              changes.
            </p>
          )}
        </div>
      </Panel>

      <Panel title="Last messages" id="bot-log-heading">
        {b.messages.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No messages yet.</p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {b.messages.map((m) => (
              <li key={m.id} className="grid gap-0.5 rounded-md border p-2 text-[0.8125rem]">
                <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                  <span>{when(m.at)}</span>
                  <span>{m.channel === "TELEGRAM" ? "Telegram" : "WhatsApp"}</span>
                  <span>{m.direction === "IN" ? "From the chat" : "To the chat"}</span>
                  <StatusBadge
                    tone={
                      m.status === "FAILED" ? "warn" : m.status === "IGNORED" ? "plain" : "done"
                    }
                  >
                    {STATUS_TEXT[m.status] ?? m.status}
                  </StatusBadge>
                </div>
                <p className="break-words whitespace-pre-wrap">{m.text}</p>
                {m.error && <p className="text-destructive">{m.error}</p>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {dialog === "TELEGRAM" && (
        <FormDialog
          title={b.telegram ? "Change the Telegram bot" : "Connect a Telegram bot"}
          description="The token from @BotFather. It is locked before it is saved and never shown again."
          submitLabel="Connect"
          pendingLabel="Connecting"
          errorTitle="We could not connect the bot"
          onClose={() => setDialog(null)}
          onSubmit={async (form) => {
            const result = await saveTelegramAction({ token: String(form.get("token") ?? "") });
            if (!result.ok) return result.error;
            setMessage({
              tone: result.data.webhookError ? "error" : "success",
              text:
                result.data.webhookError ??
                `Connected to ${result.data.botName}. Now link your account.`,
            });
            setDialog(null);
          }}
        >
          {(fieldError) => (
            <Field id="bot-token" label="Bot token" error={fieldError("token")}>
              <Input
                id="bot-token"
                name="token"
                autoComplete="off"
                placeholder="123456789:AA…"
                required
              />
            </Field>
          )}
        </FormDialog>
      )}

      {dialog === "WHATSAPP" && (
        <FormDialog
          title={b.whatsapp ? "Change the WhatsApp number" : "Add the WhatsApp number"}
          description="From your Meta app (WhatsApp > API Setup and App settings > Basic). The token and the app secret are locked and never shown again."
          submitLabel="Save"
          pendingLabel="Saving"
          errorTitle="We could not save the number"
          onClose={() => setDialog(null)}
          onSubmit={async (form) => {
            const result = await saveWhatsAppAction({
              phoneNumberId: String(form.get("phoneNumberId") ?? ""),
              token: String(form.get("token") ?? ""),
              appSecret: String(form.get("appSecret") ?? ""),
            });
            if (!result.ok) return result.error;
            setMessage({
              tone: "success",
              text: `Saved ${result.data.botName}. Add the webhook in Meta, then link your number.`,
            });
            setDialog(null);
          }}
        >
          {(fieldError) => (
            <div className="grid gap-4">
              <Field id="wa-number" label="Phone number ID" error={fieldError("phoneNumberId")}>
                <Input
                  id="wa-number"
                  name="phoneNumberId"
                  inputMode="numeric"
                  defaultValue={b.whatsapp?.botKey ?? ""}
                  required
                />
              </Field>
              <Field
                id="wa-token"
                label="Access token"
                hint={b.whatsapp ? "Empty keeps the saved token." : undefined}
                error={fieldError("token")}
              >
                <Input id="wa-token" name="token" type="password" autoComplete="off" />
              </Field>
              <Field
                id="wa-secret"
                label="App secret"
                hint={b.whatsapp ? "Empty keeps the saved secret." : undefined}
                error={fieldError("appSecret")}
              >
                <Input id="wa-secret" name="appSecret" type="password" autoComplete="off" />
              </Field>
            </div>
          )}
        </FormDialog>
      )}
    </div>
  );
}
