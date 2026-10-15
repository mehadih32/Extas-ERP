"use client";

import { KeyRoundIcon, LockIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { useDay } from "@/components/ai/when";
import { Field, FormAlert } from "@/components/forms/field";
import { StatusBadge } from "@/components/sales/badges";
import { Panel } from "@/components/sales/detail-bits";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { AiStatus } from "@/modules/ai/settings.service";
import {
  removeApiKeyAction,
  setApiKeyAction,
  setAssistantNameAction,
  setPinAction,
} from "@/server/actions/ai.actions";
import { setDailyNotesAction } from "@/server/actions/orders.actions";

/*
 * AI Center > Settings (ai.manage): the Claude key (kept sealed, only its last
 * four characters shown), the PIN asked for money, prices and deletions, the
 * AI's name on everything it writes, and the daily notes to the owner.
 */

const NOTES = [
  {
    key: "morningBrief",
    label: "Morning brief at 08:00",
    hint: "Order steps due this week, what is late, what waits for you, yesterday's AI cost.",
  },
  {
    key: "eveningReport",
    label: "Evening report at 19:00",
    hint: "What was done today, plans waiting for Approve, T&A slips, what staff told the AI, today's AI cost.",
  },
] as const;

export function AiSettingsForms({ status: s }: { status: AiStatus }) {
  const day = useDay();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<"key" | "pin" | "name" | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string }>();

  return (
    <div className="grid gap-6">
      {message && <FormAlert tone={message.tone}>{message.text}</FormAlert>}

      <Panel
        title="Claude key"
        id="ai-key-heading"
        action={
          <Button type="button" size="sm" onClick={() => setDialog("key")}>
            <KeyRoundIcon aria-hidden />
            {s.key?.own ? "Change the key" : "Add the key"}
          </Button>
        }
      >
        <div className="mt-2 grid gap-2 text-sm">
          {s.key?.own ? (
            <p>
              The company&apos;s own key, ending <span className="font-mono">{s.key.hint}</span>,
              saved on {day(s.key.setAt)}. It is kept locked and never shown again.
            </p>
          ) : s.key ? (
            <p>The server&apos;s key is used until you add the company&apos;s own key.</p>
          ) : (
            <p className="text-muted-foreground">
              No key yet. Without it the AI cannot work, even when it is switched on.
            </p>
          )}
          <p className="text-[0.8125rem] text-muted-foreground">
            Get a key at console.anthropic.com: sign in, open API Keys, press Create Key and copy it
            (it starts with sk-ant-). Set a monthly spend limit there too.
          </p>
          {s.key?.own && (
            <div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await removeApiKeyAction();
                    setMessage(
                      result.ok
                        ? { tone: "success", text: "The key is removed." }
                        : { tone: "error", text: result.error.message },
                    );
                  })
                }
              >
                Remove the key
              </Button>
            </div>
          )}
        </div>
      </Panel>

      <Panel
        title="PIN"
        id="ai-pin-heading"
        action={
          <Button type="button" size="sm" variant="outline" onClick={() => setDialog("pin")}>
            <LockIcon aria-hidden />
            {s.pinSet ? "Change the PIN" : "Set a PIN"}
          </Button>
        }
      >
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge tone={s.pinSet ? "done" : "warn"}>
            {s.pinSet ? "Set" : "Not set"}
          </StatusBadge>
          <span className="text-muted-foreground">
            Asked before the AI may touch money, prices or anything that leaves the company, and
            before you approve a Deletion request. Also asked on the bot.
          </span>
        </div>
      </Panel>

      <Panel
        title="The AI's name"
        id="ai-name-heading"
        action={
          <Button type="button" size="sm" variant="outline" onClick={() => setDialog("name")}>
            Rename
          </Button>
        }
      >
        <p className="mt-2 text-sm">
          <span className="font-medium">{s.assistantName}</span>
          <span className="text-muted-foreground">
            {" "}
            signs everything it writes as &ldquo;{s.assistantName} (AI)&rdquo;, so nobody takes it
            for a person.
          </span>
        </p>
      </Panel>

      <Panel title="Daily notes" id="ai-notes-heading">
        <p className="mt-2 text-sm text-muted-foreground">
          Written by the ERP from its own data, at no AI cost, to your inbox and the bot while the
          AI is on (Bangladesh time).
        </p>
        <div className="mt-3 grid gap-3">
          {NOTES.map((n) => (
            <label key={n.key} className="flex items-start gap-3 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={s[n.key]}
                disabled={pending}
                onCheckedChange={(on) =>
                  startTransition(async () => {
                    const result = await setDailyNotesAction({
                      morningBrief: s.morningBrief,
                      eveningReport: s.eveningReport,
                      [n.key]: on === true,
                    });
                    setMessage(
                      result.ok
                        ? {
                            tone: "success",
                            text: `${n.label.split(" at ")[0]} ${on === true ? "on" : "off"}.`,
                          }
                        : { tone: "error", text: result.error.message },
                    );
                  })
                }
              />
              <span>
                <span className="font-medium">{n.label}</span>
                <span className="block text-[0.8125rem] text-muted-foreground">{n.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </Panel>

      {dialog === "key" && (
        <FormDialog
          title={s.key?.own ? "Change the Claude key" : "Add the Claude key"}
          description="Paste the key from console.anthropic.com. It is locked before it is saved; afterwards only its last four characters are shown."
          submitLabel="Save the key"
          pendingLabel="Saving"
          errorTitle="We could not save the key"
          onClose={() => setDialog(null)}
          onSubmit={async (form) => {
            const result = await setApiKeyAction({ key: String(form.get("key") ?? "") });
            if (!result.ok) return result.error;
            setMessage({ tone: "success", text: "The key is saved." });
            setDialog(null);
          }}
        >
          {(fieldError) => (
            <Field id="ai-key" label="Claude key" error={fieldError("key")}>
              <Input
                id="ai-key"
                name="key"
                type="password"
                autoComplete="off"
                placeholder="sk-ant-..."
                required
              />
            </Field>
          )}
        </FormDialog>
      )}

      {dialog === "pin" && (
        <FormDialog
          title={s.pinSet ? "Change the PIN" : "Set a PIN"}
          description="4 to 8 digits. Keep it to yourself: it is what lets the AI touch money and lets you approve deletions."
          submitLabel="Save the PIN"
          pendingLabel="Saving"
          errorTitle="We could not save the PIN"
          onClose={() => setDialog(null)}
          onSubmit={async (form) => {
            const result = await setPinAction({
              pin: String(form.get("pin") ?? ""),
              ...(s.pinSet ? { current: String(form.get("current") ?? "") } : {}),
            });
            if (!result.ok) return result.error;
            setMessage({ tone: "success", text: "The PIN is saved." });
            setDialog(null);
          }}
        >
          {(fieldError) => (
            <div className="grid gap-4">
              {s.pinSet && (
                <Field id="ai-pin-current" label="Current PIN" error={fieldError("current")}>
                  <Input
                    id="ai-pin-current"
                    name="current"
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={8}
                    required
                  />
                </Field>
              )}
              <Field id="ai-pin" label="New PIN" error={fieldError("pin")}>
                <Input
                  id="ai-pin"
                  name="pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={8}
                  required
                />
              </Field>
            </div>
          )}
        </FormDialog>
      )}

      {dialog === "name" && (
        <FormDialog
          title="Rename the AI"
          description="The name it signs with, on the ERP and on the bot."
          submitLabel="Save"
          pendingLabel="Saving"
          errorTitle="We could not rename the AI"
          onClose={() => setDialog(null)}
          onSubmit={async (form) => {
            const result = await setAssistantNameAction({ name: String(form.get("name") ?? "") });
            if (!result.ok) return result.error;
            setMessage({ tone: "success", text: "The name is saved." });
            setDialog(null);
          }}
        >
          {(fieldError) => (
            <Field id="ai-name" label="Name" error={fieldError("name")}>
              <Input
                id="ai-name"
                name="name"
                defaultValue={s.assistantName}
                maxLength={40}
                required
              />
            </Field>
          )}
        </FormDialog>
      )}
    </div>
  );
}
