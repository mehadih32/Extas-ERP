"use client";

import { KeyRoundIcon, PlugZapIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { useDay } from "@/components/ai/when";
import { Field, FormAlert } from "@/components/forms/field";
import { StatusBadge } from "@/components/sales/badges";
import { Panel } from "@/components/sales/detail-bits";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AiStatus } from "@/modules/ai/settings.service";
import {
  removeApiKeyAction,
  removeProviderKeyAction,
  setApiKeyAction,
  setProviderKeyAction,
  testProviderKeyAction,
} from "@/server/actions/ai.actions";

/*
 * AI Center > Settings: a key for each AI provider (Claude, OpenAI, Gemini).
 * Each key is locked before it is saved and only its last four characters are
 * shown again. "Test" reads the models the provider offers the key: it costs
 * nothing and works while AI is off; the models it finds are the ones Models
 * offers for each task and agent.
 */

type Provider = AiStatus["providers"][number];

export function ProviderKeys({ status: s }: { status: AiStatus }) {
  const day = useDay();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Provider | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string }>();

  const test = (p: Provider) =>
    startTransition(async () => {
      const result = await testProviderKeyAction(p.id);
      setMessage(
        result.ok
          ? result.data.ok
            ? { tone: "success", text: `${p.label}: ${result.data.note}.` }
            : { tone: "error", text: result.data.note }
          : { tone: "error", text: result.error.message },
      );
    });

  const remove = (p: Provider) =>
    startTransition(async () => {
      const result =
        p.id === "anthropic" ? await removeApiKeyAction() : await removeProviderKeyAction(p.id);
      setMessage(
        result.ok
          ? { tone: "success", text: `The ${p.label} key is removed.` }
          : { tone: "error", text: result.error.message },
      );
    });

  return (
    <div className="grid gap-6">
      {message && <FormAlert tone={message.tone}>{message.text}</FormAlert>}
      {s.providers.map((p) => (
        <Panel
          key={p.id}
          title={`${p.label} key`}
          id={`ai-key-${p.id}-heading`}
          action={
            <Button type="button" size="sm" onClick={() => setEditing(p)}>
              <KeyRoundIcon aria-hidden />
              {p.key?.own ? "Change the key" : "Add the key"}
            </Button>
          }
        >
          <div className="mt-2 grid gap-2 text-sm">
            {p.key?.own ? (
              <p>
                The company&apos;s own key, ending <span className="font-mono">{p.key.hint}</span>,
                saved on {day(p.key.setAt)}. It is kept locked and never shown again.
              </p>
            ) : p.key ? (
              <p>The server&apos;s key is used until you add the company&apos;s own key.</p>
            ) : (
              <p className="text-muted-foreground">
                {p.id === "anthropic"
                  ? "No key yet. The ERP's own models are Claude's: without a Claude key, add an OpenAI or Gemini key and pick its models on Models."
                  : `No key yet. Add one to use ${p.label} models for any task or agent.`}
              </p>
            )}
            {p.test && (
              <p className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={p.test.ok ? "done" : "warn"}>
                  {p.test.ok ? "Works" : "Not working"}
                </StatusBadge>
                <span className="text-muted-foreground">
                  {p.test.note} (tested {day(p.test.at)})
                </span>
              </p>
            )}
            <p className="text-[0.8125rem] text-muted-foreground">
              Get a key at {p.keyPage} (it starts with {p.keyStarts}). Set a monthly spend limit
              there too.
            </p>
            {p.key && (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => test(p)}
                >
                  <PlugZapIcon aria-hidden />
                  Test
                </Button>
                {p.key.own && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => remove(p)}
                  >
                    Remove the key
                  </Button>
                )}
              </div>
            )}
          </div>
        </Panel>
      ))}

      {editing && (
        <FormDialog
          title={`${editing.key?.own ? "Change" : "Add"} the ${editing.label} key`}
          description={`Paste the key from ${editing.keyPage}. It is locked before it is saved; afterwards only its last four characters are shown.`}
          submitLabel="Save the key"
          pendingLabel="Saving"
          errorTitle="We could not save the key"
          onClose={() => setEditing(null)}
          onSubmit={async (form) => {
            const key = String(form.get("key") ?? "");
            const result =
              editing.id === "anthropic"
                ? await setApiKeyAction({ key })
                : await setProviderKeyAction({ provider: editing.id, key });
            if (!result.ok) return result.error;
            setMessage({
              tone: "success",
              text: `The ${editing.label} key is saved. Press Test to check it and read its models.`,
            });
            setEditing(null);
          }}
        >
          {(fieldError) => (
            <Field id="ai-key" label={`${editing.label} key`} error={fieldError("key")}>
              <Input
                id="ai-key"
                name="key"
                type="password"
                autoComplete="off"
                placeholder={`${editing.keyStarts}...`}
                required
              />
            </Field>
          )}
        </FormDialog>
      )}
    </div>
  );
}
