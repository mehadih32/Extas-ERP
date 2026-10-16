"use client";

import { PauseIcon, PlayIcon, PowerIcon, PowerOffIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useWhen } from "@/components/ai/when";
import { FormAlert } from "@/components/forms/field";
import { StatusBadge } from "@/components/sales/badges";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import type { AiStatus } from "@/modules/ai/settings.service";
import { setAiPausedAction, setAiSwitchAction } from "@/server/actions/ai.actions";

/*
 * The AI's main switch: off (the start), on, or paused. Off means no AI call
 * at all and no AI cost; every feature works its own way. Only the owner
 * (ai.manage) turns it on or off.
 */

export function AiSwitch({ status: s }: { status: AiStatus }) {
  const when = useWhen({ year: true });
  const [asking, setAsking] = useState<"on" | "off" | null>(null);
  const [notice, setNotice] = useState<string>();
  const state = !s.enabled ? "off" : s.paused ? "paused" : "on";

  return (
    <section
      aria-labelledby="ai-switch-heading"
      className="grid gap-4 rounded-lg border bg-card p-5 sm:p-6"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="grid min-w-0 gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="ai-switch-heading" className="font-serif text-xl text-primary">
              {state === "on" ? "AI is on" : state === "paused" ? "AI is paused" : "AI is off"}
            </h2>
            <StatusBadge tone={state === "on" ? "done" : state === "paused" ? "warn" : "closed"}>
              {state === "on" ? "On" : state === "paused" ? "Paused" : "Off"}
            </StatusBadge>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {state === "off"
              ? "No AI call is made and AI costs nothing. Every screen works its own way: you type, the rules check."
              : state === "paused"
                ? `Paused on ${when(s.pausedAt)}: the AI does no work until it is resumed.`
                : `${s.assistantName} works within what Control allows.`}
            {s.changedAt &&
              ` Turned ${s.enabled ? "on" : "off"}${s.changedBy ? ` by ${s.changedBy}` : ""} on ${when(s.changedAt)}.`}
          </p>
        </div>
        {s.can.manage && (
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            {s.enabled && (
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  const result = await setAiPausedAction(!s.paused);
                  setNotice(
                    result.ok
                      ? s.paused
                        ? "The AI is working again."
                        : "The AI is paused."
                      : result.error.message,
                  );
                }}
              >
                {s.paused ? <PlayIcon aria-hidden /> : <PauseIcon aria-hidden />}
                {s.paused ? "Resume" : "Pause"}
              </Button>
            )}
            <Button
              type="button"
              variant={s.enabled ? "outline" : "default"}
              onClick={() => setAsking(s.enabled ? "off" : "on")}
            >
              {s.enabled ? <PowerOffIcon aria-hidden /> : <PowerIcon aria-hidden />}
              {s.enabled ? "Turn AI off" : "Turn AI on"}
            </Button>
          </div>
        )}
      </div>

      {s.enabled && !s.providers.some((p) => p.key) && (
        <FormAlert tone="note">
          AI has no key yet, so it cannot work.{" "}
          {s.can.manage ? (
            <Link href="/ai/settings" className="underline underline-offset-4">
              Add a Claude, OpenAI or Gemini key in Settings
            </Link>
          ) : (
            "The owner adds it in Settings."
          )}
        </FormAlert>
      )}
      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      {asking && (
        <FormDialog
          title={asking === "on" ? "Turn AI on?" : "Turn AI off?"}
          description={
            asking === "on"
              ? "The AI then works within Control: every cell starts at Ask, so it asks you before it does anything. It never deletes data, never changes permissions and never sends anything to a buyer without your OK."
              : "No AI call is made from then on and AI costs nothing. Every screen keeps working its own way."
          }
          submitLabel={asking === "on" ? "Turn AI on" : "Turn AI off"}
          pendingLabel="Saving"
          errorTitle="We could not change the switch"
          onClose={() => setAsking(null)}
          onSubmit={async () => {
            const result = await setAiSwitchAction(asking === "on");
            if (!result.ok) return result.error;
            setNotice(asking === "on" ? "AI is on." : "AI is off.");
            setAsking(null);
          }}
        >
          {() => null}
        </FormDialog>
      )}
    </section>
  );
}
