"use client";

import { BotIcon, CheckIcon, FileDownIcon, SendIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";

import { usePinPrompt } from "@/components/ai/pin-prompt";
import { useWhen } from "@/components/ai/when";
import { FormAlert } from "@/components/forms/field";
import { StatusBadge, type Tone } from "@/components/sales/badges";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ChatCard } from "@/modules/ai/chat/cards";
import { CARD_STATUS_TEXT } from "@/modules/ai/chat/cards";
import type { ChatMessage, ChatScreen as Chat } from "@/modules/ai/chat/chat.service";
import {
  applyCardAction,
  cancelCardAction,
  sendChatAction,
  sendDraftAction,
} from "@/server/actions/mehedi.actions";
import { countOf } from "@/lib/display";

/*
 * AI Center > Chat: the owner talks to Mehedi 2.0 in Bengali or English.
 * Commands are answered at once; a change waits on its card for Apply; a draft
 * for a buyer goes only when the owner presses Send under it ("পাঠাও" shows it
 * again to confirm). Prices, deletions and locked cells ask for the PIN.
 */

const SIGNAL_TONES: Record<string, Tone> = { green: "done", yellow: "open", red: "warn" };

function CardView({
  message,
  card,
  busy,
  onApply,
  onCancel,
  onSend,
}: {
  message: ChatMessage;
  card: ChatCard;
  busy: boolean;
  onApply: () => void;
  onCancel: () => void;
  onSend: (draftId: string) => void;
}) {
  const box = "mt-2 grid gap-2 rounded-md border bg-card p-3 text-sm";
  switch (card.type) {
    case "change":
      return (
        <div className={box}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{card.title}</p>
            <StatusBadge
              tone={
                message.cardStatus === "PROPOSED"
                  ? "open"
                  : message.cardStatus === "APPLIED"
                    ? "done"
                    : "closed"
              }
            >
              {message.cardStatus ? CARD_STATUS_TEXT[message.cardStatus] : ""}
            </StatusBadge>
          </div>
          <p className="text-[0.8125rem] text-muted-foreground">
            Page:{" "}
            {card.href ? (
              <Link href={card.href} className="underline underline-offset-4">
                {card.page}
              </Link>
            ) : (
              card.page
            )}
          </p>
          <dl className="grid gap-1">
            {card.lines.map((l) => (
              <div key={l.label} className="flex flex-wrap gap-x-2">
                <dt className="text-muted-foreground">{l.label}:</dt>
                <dd>
                  {l.before !== undefined && l.before !== null && (
                    <span className="text-muted-foreground line-through">{l.before}</span>
                  )}
                  {l.before !== undefined && l.before !== null && " → "}
                  <span className="font-medium">{l.after}</span>
                </dd>
              </div>
            ))}
          </dl>
          {message.cardStatus === "PROPOSED" && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" disabled={busy} onClick={onApply}>
                <CheckIcon aria-hidden />
                Apply
              </Button>
              {card.href && (
                <Button asChild type="button" size="sm" variant="outline">
                  <Link href={card.href}>Edit</Link>
                </Button>
              )}
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onCancel}>
                <XIcon aria-hidden />
                Cancel
              </Button>
            </div>
          )}
        </div>
      );
    case "draft":
      return (
        <div className={box}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{card.subject}</p>
            <StatusBadge
              tone={
                message.draftStatus === "SENT"
                  ? "done"
                  : message.draftStatus === "DISCARDED"
                    ? "closed"
                    : "open"
              }
            >
              {message.draftStatus === "SENT"
                ? "Sent"
                : message.draftStatus === "DISCARDED"
                  ? "Discarded"
                  : card.forBuyer
                    ? "Waits for your Send"
                    : "Draft"}
            </StatusBadge>
          </div>
          <p className="text-[0.8125rem] text-muted-foreground">
            To {card.party ?? "?"}
            {card.to ? ` (${card.to})` : " (no email address yet)"}
          </p>
          <pre className="max-h-64 overflow-auto font-sans text-[0.8125rem] whitespace-pre-wrap">
            {card.body}
          </pre>
          {(message.draftStatus === "DRAFT" || message.draftStatus === "FAILED") && (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={busy || !card.to}
                onClick={() => onSend(card.draftId)}
              >
                <SendIcon aria-hidden />
                Send
              </Button>
              <Button asChild type="button" size="sm" variant="outline">
                <Link href={`/ai/drafts#draft-${card.draftId}`}>Edit in Drafts</Link>
              </Button>
            </div>
          )}
        </div>
      );
    case "report":
      return (
        <div className={box}>
          <p className="font-medium">
            {card.title} · {card.range}
          </p>
          <div>
            <Button asChild size="sm" variant="outline">
              <a href={card.href}>
                <FileDownIcon aria-hidden />
                Download the PDF
              </a>
            </Button>
          </div>
        </div>
      );
    case "check":
      return (
        <div className={box}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">
              Order check card: {card.number} {card.title}
            </p>
            <Link href={card.href} className="text-[0.8125rem] underline underline-offset-4">
              Open the sheet
            </Link>
          </div>
          <ul className="grid gap-1.5">
            {card.rows.map((r) => (
              <li key={r.key} className="flex flex-wrap items-start gap-2">
                <StatusBadge tone={SIGNAL_TONES[r.signal] ?? "plain"}>{r.label}</StatusBadge>
                <span className="min-w-0 flex-1">{r.reason}</span>
              </li>
            ))}
          </ul>
          <p className="text-[0.8125rem] text-muted-foreground">
            You decide on the sheet; I never decline an order.
          </p>
        </div>
      );
    case "costs":
      return (
        <div className={box}>
          <p className="font-medium">
            {card.period}: {card.currency} {card.total} · {countOf(card.calls, "call")}
          </p>
          {card.byTask.length > 0 && (
            <ul className="grid gap-0.5 text-[0.8125rem]">
              {card.byTask.map((t) => (
                <li key={t.label} className="flex justify-between gap-3">
                  <span>{t.label}</span>
                  <span className="tabular-nums">
                    {card.currency} {t.cost} ({t.calls})
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/ai/costs" className="text-[0.8125rem] underline underline-offset-4">
            Budget &amp; Costs
          </Link>
        </div>
      );
    case "requests":
      return (
        <div className={box}>
          <p>
            {card.count} {card.what.toLowerCase()} waiting for you.{" "}
            <Link href={card.href} className="underline underline-offset-4">
              Answer in AI Home
            </Link>
          </p>
        </div>
      );
    case "rule":
      return (
        <div className={box}>
          <p className="font-medium">House Rule proposal</p>
          <p>{card.text}</p>
          <p className="text-[0.8125rem] text-muted-foreground">
            For {card.scope.toLowerCase()}.{" "}
            <Link href="/ai/mehedi#teach" className="underline underline-offset-4">
              Approve or reject it in Teach
            </Link>
          </p>
        </div>
      );
    case "facts":
      return (
        <div className={box}>
          <p className="font-medium">{card.title}</p>
          <dl className="grid gap-1">
            {card.rows.map((r) => (
              <div key={r.label} className="flex flex-wrap gap-x-2">
                <dt className="text-muted-foreground">{r.label}:</dt>
                <dd>
                  {r.href ? (
                    <Link href={r.href} className="underline underline-offset-4">
                      {r.value}
                    </Link>
                  ) : (
                    r.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      );
    case "help":
      return (
        <div className={box}>
          <ul className="grid gap-1.5">
            {card.rows.map((r) => (
              <li key={r.say}>
                <span className="font-medium">{r.say}</span>
                <span className="text-muted-foreground"> · {r.does}</span>
              </li>
            ))}
          </ul>
        </div>
      );
  }
}

export function ChatScreen({ chat }: { chat: Chat }) {
  const time = useWhen();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const { withPin, dialog: pinDialog } = usePinPrompt();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [chat.messages.length]);

  const run = (
    work: () => Promise<{ ok: true } | { ok: false; error: { message: string } }>,
    failed?: () => void,
  ) =>
    startTransition(async () => {
      const result = await work();
      if (result.ok) setError(undefined);
      else {
        setError(result.error.message);
        failed?.();
      }
    });

  const send = (said: string) => {
    if (!said.trim()) return;
    // The box empties at once, so what the owner types next is never wiped
    // when the answer comes back; a message that did not go comes back.
    setText("");
    run(
      () => sendChatAction({ text: said }),
      () => setText((now) => now || said),
    );
  };

  return (
    <div className="grid gap-4">
      {chat.stateText && <FormAlert tone="note">{chat.stateText}</FormAlert>}
      {pinDialog}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] text-muted-foreground">
        <span>
          AI cost today:{" "}
          <span className="font-medium text-foreground tabular-nums">
            {money(chat.cost.today.spent, chat.cost.currency)}
          </span>
        </span>
        <span>
          This month:{" "}
          <span className="font-medium text-foreground tabular-nums">
            {money(chat.cost.spent, chat.cost.currency)}
          </span>
          {chat.cost.budget ? ` of ${money(chat.cost.budget, chat.cost.currency)}` : ""}
        </span>
        <Link href="/ai/costs?period=today" className="underline underline-offset-4">
          Budget & Costs
        </Link>
      </p>
      <section
        aria-label={`Chat with ${chat.name}`}
        className="grid max-h-[65vh] min-h-64 gap-3 overflow-y-auto rounded-lg border bg-muted/30 p-3 sm:p-4"
      >
        {chat.messages.length === 0 ? (
          <div className="grid place-items-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <BotIcon aria-hidden className="size-6" />
            <p>
              Write to {chat.name} in Bengali or English. Say &ldquo;help&rdquo; for the commands.
            </p>
          </div>
        ) : (
          chat.messages.map((m) => (
            <div
              key={m.id}
              className={m.role === "OWNER" ? "flex justify-end" : "flex justify-start"}
            >
              <div
                className={
                  m.role === "OWNER"
                    ? "max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
                    : "max-w-[95%] min-w-0 rounded-lg border bg-card px-3 py-2 text-sm sm:max-w-[85%]"
                }
              >
                {m.role === "AI" && (
                  <p className="mb-1 text-[0.75rem] font-medium text-primary">
                    {chat.label}
                    {m.channel === "BOT" ? " · bot" : ""}
                  </p>
                )}
                {m.text && <p className="whitespace-pre-wrap">{m.text}</p>}
                {m.card && (
                  <CardView
                    message={m}
                    card={m.card}
                    busy={pending}
                    onApply={() => run(() => withPin((pin) => applyCardAction(m.id, pin)))}
                    onCancel={() => run(() => cancelCardAction(m.id))}
                    onSend={(draftId) => run(() => withPin((pin) => sendDraftAction(draftId, pin)))}
                  />
                )}
                <p
                  className={
                    m.role === "OWNER"
                      ? "mt-1 text-right text-xs opacity-75"
                      : "mt-1 text-xs text-muted-foreground"
                  }
                >
                  {time(m.at)}
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={end} />
      </section>
      {error && <FormAlert>{error}</FormAlert>}
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <label htmlFor="ai-chat-text" className="sr-only">
          Message
        </label>
        <Textarea
          id="ai-chat-text"
          value={text}
          maxLength={2000}
          rows={2}
          placeholder="অর্ডার 2611-002-এর অবস্থা · আজকের সেল রিপোর্ট PDF দাও · help"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(text);
            }
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {["help", "status", "সব থামাও"].map((quick) => (
              <Button
                key={quick}
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => send(quick)}
              >
                {quick}
              </Button>
            ))}
          </div>
          <Button type="submit" disabled={pending || !text.trim()}>
            <SendIcon aria-hidden />
            {pending ? "Sending" : "Send"}
          </Button>
        </div>
      </form>
    </div>
  );
}
