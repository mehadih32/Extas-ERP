"use client";

import { BotIcon, ExternalLinkIcon, LockIcon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { FormAlert } from "@/components/forms/field";
import { StatusBadge } from "@/components/sales/badges";
import { Panel } from "@/components/sales/detail-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AiRequests } from "@/modules/ai/requests.service";
import { answerDeletionAction, answerPermissionAction } from "@/server/actions/ai.actions";

/*
 * What the AI waits for: permission requests (a cell it needs is Off) and
 * Deletion requests (it never deletes; the owner decides and deletes the
 * record on its own page). Money, prices, deletions and anything that leaves
 * the company ask for the PIN once it is set.
 */

const when = (at: Date | string) =>
  new Date(at).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const ANSWER_BUTTONS = [
  { answer: "ONCE", label: "Only this task" },
  { answer: "TODAY", label: "For today" },
  { answer: "ALWAYS", label: "Always" },
] as const;

function PinInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium">
        <LockIcon aria-hidden className="size-3.5" />
        PIN
      </label>
      <Input
        id={id}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={8}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
        className="h-9 w-28"
      />
    </div>
  );
}

export function AiRequestsList({ requests: r, pinSet }: { requests: AiRequests; pinSet: boolean }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string }>();
  const [pins, setPins] = useState<Record<string, string>>({});
  const canAnswer = r.can.answer;
  const empty = r.permissions.length === 0 && r.deletions.length === 0;

  const run = (
    work: () => Promise<{ ok: true } | { ok: false; error: { message: string } }>,
    done: string,
  ) =>
    startTransition(async () => {
      const result = await work();
      setMessage(
        result.ok ? { tone: "success", text: done } : { tone: "error", text: result.error.message },
      );
    });

  return (
    <Panel title="Waiting for your answer" id="ai-requests-heading">
      {message && (
        <div className="mt-3">
          <FormAlert tone={message.tone}>{message.text}</FormAlert>
        </div>
      )}
      {empty ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Nothing waits for you. When the AI needs a cell that is Off, or thinks something should be
          deleted, it asks here.
        </p>
      ) : (
        <ul className="mt-4 grid gap-3">
          {r.permissions.map((p) => (
            <li key={p.id} className="grid gap-3 rounded-md border p-4">
              <div className="grid gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium break-words">
                    {p.askedBy} asks for {p.path}
                  </span>
                  {p.channel === "BOT" && (
                    <StatusBadge tone="plain">
                      <BotIcon aria-hidden className="size-3" />
                      From the bot
                    </StatusBadge>
                  )}
                </div>
                <p className="text-sm break-words">{p.task}</p>
                {p.why && <p className="text-[0.8125rem] text-muted-foreground">{p.why}</p>}
                <p className="text-[0.8125rem] text-muted-foreground">
                  {p.record ? `${p.record} · ` : ""}
                  Asked {when(p.createdAt)}
                </p>
              </div>
              {canAnswer ? (
                <div className="grid gap-2">
                  {p.needsPin && pinSet && (
                    <PinInput
                      id={`pin-${p.id}`}
                      value={pins[p.id] ?? ""}
                      onChange={(v) => setPins({ ...pins, [p.id]: v })}
                    />
                  )}
                  <div className="flex flex-wrap gap-2">
                    {ANSWER_BUTTONS.map((b) => (
                      <Button
                        key={b.answer}
                        type="button"
                        size="sm"
                        variant={b.answer === "ONCE" ? "default" : "outline"}
                        disabled={pending}
                        onClick={() =>
                          run(
                            () =>
                              answerPermissionAction(p.id, { answer: b.answer, pin: pins[p.id] }),
                            `${p.action}: ${b.label.toLowerCase()}.`,
                          )
                        }
                      >
                        {b.label}
                      </Button>
                    ))}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() =>
                        run(
                          () => answerPermissionAction(p.id, { answer: "REFUSED" }),
                          `${p.action}: no. The AI leaves it to people.`,
                        )
                      }
                    >
                      No
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-[0.8125rem] text-muted-foreground">The owner answers this.</p>
              )}
            </li>
          ))}

          {r.deletions.map((d) => (
            <li key={d.id} className="grid gap-3 rounded-md border border-destructive/25 p-4">
              <div className="grid gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium break-words">
                    {d.askedBy} asks to delete {d.what}
                  </span>
                  <StatusBadge tone="warn">Deletion request</StatusBadge>
                </div>
                <p className="text-sm break-words">
                  <span className="font-medium">Why: </span>
                  {d.why}
                </p>
                <p className="text-sm break-words">
                  <span className="font-medium">If it stays: </span>
                  {d.ifKept}
                </p>
                <p className="text-[0.8125rem] text-muted-foreground">Asked {when(d.createdAt)}</p>
                {d.href && (
                  <Link
                    href={d.href}
                    className="inline-flex w-fit items-center gap-1 text-[0.8125rem] underline underline-offset-4"
                  >
                    Open it
                    <ExternalLinkIcon aria-hidden className="size-3" />
                  </Link>
                )}
              </div>
              {canAnswer ? (
                <div className="grid gap-2">
                  {pinSet && (
                    <PinInput
                      id={`pin-${d.id}`}
                      value={pins[d.id] ?? ""}
                      onChange={(v) => setPins({ ...pins, [d.id]: v })}
                    />
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        run(
                          () => answerDeletionAction(d.id, { approve: true, pin: pins[d.id] }),
                          "Approved. The AI does not delete it: delete it on its own page, in your name.",
                        )
                      }
                    >
                      Approve
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() =>
                        run(
                          () => answerDeletionAction(d.id, { approve: false }),
                          "Refused. It stays.",
                        )
                      }
                    >
                      Refuse
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-[0.8125rem] text-muted-foreground">The owner answers this.</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
