"use client";

import { FlaskConicalIcon, RefreshCwIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { useDay } from "@/components/ai/when";
import { Field, FormAlert } from "@/components/forms/field";
import { StatusBadge, type Tone } from "@/components/sales/badges";
import { Panel } from "@/components/sales/detail-bits";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { ModelTestState } from "@/modules/ai/model-test-standing";
import type { ModelTestResult } from "@/modules/ai/model-tests.service";
import { AI_MODELS } from "@/modules/ai/models";
import type { AiModelsScreen } from "@/modules/ai/settings.service";
import {
  readProviderModelsAction,
  runModelTestAction,
  setAgentModelAction,
  setFableAllowedAction,
  setModelPriceAction,
  setTaskModelAction,
} from "@/server/actions/ai.actions";

/*
 * Models: which model does each task and each agent, from any provider
 * (Claude, OpenAI, Gemini). The system's choice is the big Claude model for
 * thinking work and smaller ones for the rest; the owner can change any task
 * or agent to any model the providers offer the keys. A model that is not one
 * of the ERP's own Claude models does a task on Do only after it passes that
 * task's test ("Run the test"); until then the AI asks first. Prices are the
 * owner's to keep up to date: a model without one shows "Price unknown".
 */

type Message = { tone: "success" | "error"; text: string };

const TEST_TONES: Record<ModelTestState, Tone> = {
  BUILT_IN: "plain",
  PASSED: "done",
  FAILED: "warn",
  CHANGED: "warn",
  NONE: "warn",
};

const PRICE_FROM = {
  erp: "Claude price list",
  owner: "Set by you",
  unknown: "Price unknown",
} as const;

const dollars = (v: string | null) => (v === null ? "Price unknown" : `$${Number(v)}`);

function ModelOptions({ m, exclude }: { m: AiModelsScreen; exclude?: string }) {
  return (
    <>
      <optgroup label="Claude (built in)">
        {AI_MODELS.filter((x) => x.id !== exclude).map((x) => (
          <option key={x.id} value={x.id}>
            {x.label}
            {x.id === "claude-fable-5-1" && !m.allowFable ? " (allow it below)" : ""}
          </option>
        ))}
      </optgroup>
      {m.providers
        .filter((p) => p.models.length > 0)
        .map((p) => (
          <optgroup
            key={p.id}
            label={p.id === "anthropic" ? "Claude (read from Anthropic)" : p.label}
          >
            {p.models
              .filter((x) => x.ref !== exclude)
              .map((x) => (
                <option key={x.ref} value={x.ref}>
                  {x.label}
                  {p.hasKey ? "" : " (no key now)"}
                </option>
              ))}
          </optgroup>
        ))}
    </>
  );
}

export function ModelsTable({ models: m }: { models: AiModelsScreen }) {
  const day = useDay();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<Message>();
  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ModelTestResult>>({});
  const [pricing, setPricing] = useState<{ model: string | null; label: string } | null>(null);
  const canManage = m.can.manage;
  const anyRead = m.providers.some((p) => p.models.length > 0);
  const nameOf = (ref: string) =>
    AI_MODELS.find((x) => x.id === ref)?.label ??
    m.providers.flatMap((p) => p.models).find((x) => x.ref === ref)?.label ??
    ref;

  const say = (ok: boolean, text: string, error?: { message: string }) =>
    setMessage(ok ? { tone: "success", text } : { tone: "error", text: error?.message ?? text });

  const chooseTask = (task: AiModelsScreen["tasks"][number], value: string) =>
    startTransition(async () => {
      const result = await setTaskModelAction({ task: task.key, model: value || null });
      say(
        result.ok,
        `${task.label}: ${value ? nameOf(value) : `back to ${nameOf(task.system)}`}.`,
        result.ok ? undefined : result.error,
      );
    });

  const chooseAgent = (agent: AiModelsScreen["agents"][number], value: string) =>
    startTransition(async () => {
      const result = await setAgentModelAction({ agent: agent.key, model: value || null });
      say(
        result.ok,
        `${agent.name}: ${value ? `works on ${nameOf(value)}` : "back to each task's model"}.`,
        result.ok ? undefined : result.error,
      );
    });

  const runTest = (task: AiModelsScreen["tasks"][number]) => {
    setTesting(task.key);
    startTransition(async () => {
      const result = await runModelTestAction({ task: task.key, model: task.runsOn });
      setTesting(null);
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error.message });
        return;
      }
      setResults((r) => ({ ...r, [task.key]: result.data }));
      setMessage({
        tone: result.data.passed ? "success" : "error",
        text: `${task.runsOnLabel} on ${task.label}: ${result.data.passed ? "passed" : "not passed"} (${result.data.right} of ${result.data.total}).`,
      });
    });
  };

  return (
    <div className="grid gap-6">
      {message && <FormAlert tone={message.tone}>{message.text}</FormAlert>}

      <Panel
        title="Providers"
        id="ai-providers-heading"
        action={
          canManage ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await readProviderModelsAction();
                  say(
                    result.ok,
                    result.ok ? result.data.map((r) => r.test.note).join(" · ") : "",
                    result.ok ? undefined : result.error,
                  );
                })
              }
            >
              <RefreshCwIcon aria-hidden />
              Read models from providers
            </Button>
          ) : undefined
        }
      >
        <p className="mt-1 text-sm text-muted-foreground">
          The models each provider offers your key, read from the provider (keys are added on AI
          Center &gt; Settings). Read them again when a provider brings out a new model.
        </p>
        <ul className="mt-3 divide-y text-sm">
          {m.providers.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="font-medium">{p.label}</span>
              <span className="text-muted-foreground">
                {!p.hasKey
                  ? "No key"
                  : p.readAt
                    ? `${p.models.length + (p.id === "anthropic" ? AI_MODELS.length : 0)} models, read ${day(p.readAt)}`
                    : "Key saved: models not read yet"}
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Which model does which task" id="ai-task-models-heading">
        <p className="mt-1 text-sm text-muted-foreground">
          The big model thinks (plans, costing, tech packs, checks); the medium one writes; the
          small one reads forms and gathers data. Any task can run on any provider&apos;s model. A
          model that is not built in must pass the task&apos;s test before the AI does that work by
          itself (Do); until then it asks you first.
        </p>
        <ul className="mt-4 divide-y">
          {m.tasks.map((t) => {
            const result = results[t.key];
            return (
              <li key={t.key} className="grid gap-2 py-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="grid min-w-0 gap-1">
                    <span className="text-sm font-medium break-words">{t.label}</span>
                    <span className="text-[0.8125rem] text-muted-foreground">
                      {t.module} · Runs on {t.runsOnLabel}
                      {t.chosen && t.chosen !== t.runsOn
                        ? ` (${nameOf(t.chosen)} is not allowed now)`
                        : ""}
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
                      <StatusBadge tone={TEST_TONES[t.test.state]}>{t.test.text}</StatusBadge>
                      {t.test.state !== "BUILT_IN" && t.test.last && (
                        <span className="text-muted-foreground">
                          {t.test.last.right} of {t.test.last.total} right, {day(t.test.last.at)}
                        </span>
                      )}
                      {canManage && t.test.state !== "BUILT_IN" && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => runTest(t)}
                        >
                          <FlaskConicalIcon aria-hidden />
                          {testing === t.key ? "Testing" : "Run the test"}
                        </Button>
                      )}
                    </span>
                  </div>
                  {canManage ? (
                    <NativeSelect
                      aria-label={`Model for ${t.label}`}
                      containerClassName="sm:w-72 sm:shrink-0"
                      value={t.chosen ?? ""}
                      disabled={pending}
                      onChange={(e) => chooseTask(t, e.target.value)}
                    >
                      <option value="">System&apos;s choice ({nameOf(t.system)})</option>
                      {t.chosen && !anyRead && !AI_MODELS.some((x) => x.id === t.chosen) && (
                        <option value={t.chosen}>{nameOf(t.chosen)}</option>
                      )}
                      <ModelOptions m={m} exclude={t.system} />
                    </NativeSelect>
                  ) : (
                    <StatusBadge tone={t.chosen ? "warn" : "plain"}>
                      {t.chosen ? "Set by the owner" : "System's choice"}
                    </StatusBadge>
                  )}
                </div>
                {result && (
                  <ul className="grid gap-1 rounded-md border p-2 text-[0.8125rem]">
                    {result.details.map((d) => (
                      <li key={d.case} className={d.ok ? "" : "text-destructive"}>
                        {d.ok ? "Right" : "Wrong"}: {d.title}. {d.ok ? "" : d.why}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel title="Agents" id="ai-agent-models-heading">
        <p className="mt-1 text-sm text-muted-foreground">
          An agent given its own model does all its work on it, whatever the task. Its work on Do
          still waits for that model to pass each task&apos;s test.
        </p>
        <ul className="mt-4 divide-y">
          {m.agents.map((a) => (
            <li
              key={a.key}
              className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="grid min-w-0 gap-0.5">
                <span className="text-sm font-medium break-words">{a.name}</span>
                <span className="text-[0.8125rem] break-words text-muted-foreground">{a.what}</span>
              </div>
              {canManage ? (
                <NativeSelect
                  aria-label={`Model for ${a.name}`}
                  containerClassName="sm:w-72 sm:shrink-0"
                  value={a.model ?? ""}
                  disabled={pending}
                  onChange={(e) => chooseAgent(a, e.target.value)}
                >
                  <option value="">Each task&apos;s model</option>
                  {a.model && !AI_MODELS.some((x) => x.id === a.model) && !anyRead && (
                    <option value={a.model}>{a.modelLabel}</option>
                  )}
                  <ModelOptions m={m} />
                </NativeSelect>
              ) : (
                <StatusBadge tone={a.model ? "warn" : "plain"}>
                  {a.modelLabel ?? "Each task's model"}
                </StatusBadge>
              )}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel
        title="Fable 5.1"
        id="ai-fable-heading"
        action={
          canManage ? (
            <Button
              type="button"
              size="sm"
              variant={m.allowFable ? "outline" : "default"}
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await setFableAllowedAction(!m.allowFable);
                  say(
                    result.ok,
                    m.allowFable ? "Fable 5.1 is stopped." : "Fable 5.1 is allowed.",
                    result.ok ? undefined : result.error,
                  );
                })
              }
            >
              {m.allowFable ? "Stop Fable 5.1" : "Allow Fable 5.1"}
            </Button>
          ) : undefined
        }
      >
        <p className="mt-1 text-sm text-muted-foreground">
          {m.allowFable
            ? "Allowed: tasks set to Fable 5.1 run on it. It costs the most, so stop it when the hard problem is solved."
            : "Not allowed: Fable 5.1 costs the most. Allow it only for a very hard problem; until then, tasks set to it run on their own model."}
        </p>
      </Panel>

      <Panel
        title="Prices"
        id="ai-prices-heading"
        action={
          canManage && anyRead ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setPricing({ model: null, label: "" })}
            >
              Add a price
            </Button>
          ) : undefined
        }
      >
        <p className="mt-1 text-sm text-muted-foreground">
          US dollars per million tokens (about 750,000 words). Providers change their prices: check
          them on the provider&apos;s price page and set them here. A model without a price shows
          &ldquo;Price unknown&rdquo; and its calls are not counted in the costs or the budget until
          you set it.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="border-b text-left text-[0.8125rem] text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Model</th>
                <th className="py-2 pr-3 text-right font-medium">Reading</th>
                <th className="py-2 pr-3 text-right font-medium">Writing</th>
                <th className="py-2 pr-3 text-right font-medium">Cache reading</th>
                <th className="py-2 pr-3 font-medium">From</th>
                {canManage && <th className="py-2" />}
              </tr>
            </thead>
            <tbody>
              {m.prices.map((x) => (
                <tr key={x.model} className="border-b last:border-0">
                  <td className="py-2 pr-3 font-medium">
                    {x.label}
                    {x.size && (
                      <span className="block text-[0.75rem] font-normal text-muted-foreground">
                        {x.size}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{dollars(x.input)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{dollars(x.output)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {x.cacheRead === null
                      ? x.input === null
                        ? ""
                        : "As reading"
                      : `$${Number(x.cacheRead)}`}
                  </td>
                  <td className="py-2 pr-3">
                    <StatusBadge tone={x.from === "unknown" ? "warn" : "plain"}>
                      {PRICE_FROM[x.from]}
                    </StatusBadge>
                  </td>
                  {canManage && (
                    <td className="py-2 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setPricing({ model: x.model, label: x.label })}
                      >
                        Set the price
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {pricing && (
        <FormDialog
          title={pricing.model ? `Price of ${pricing.label}` : "Add a price"}
          description="US dollars per million tokens, as on the provider's price page. Leave the prices empty to go back to the Claude price list (built-in models) or to Price unknown."
          submitLabel="Save the price"
          pendingLabel="Saving"
          errorTitle="We could not save the price"
          onClose={() => setPricing(null)}
          onSubmit={async (form) => {
            const result = await setModelPriceAction({
              model: pricing.model ?? String(form.get("model") ?? ""),
              input: String(form.get("input") ?? ""),
              output: String(form.get("output") ?? ""),
              cacheRead: String(form.get("cacheRead") ?? ""),
            });
            if (!result.ok) return result.error;
            setMessage({ tone: "success", text: "The price is saved." });
            setPricing(null);
          }}
        >
          {(fieldError) => {
            const now = pricing.model ? m.prices.find((x) => x.model === pricing.model) : null;
            return (
              <div className="grid gap-4">
                {!pricing.model && (
                  <Field id="price-model" label="Model" error={fieldError("model")}>
                    <NativeSelect
                      id="price-model"
                      name="model"
                      containerClassName="w-full"
                      required
                    >
                      <ModelOptions m={m} />
                    </NativeSelect>
                  </Field>
                )}
                <Field
                  id="price-input"
                  label="Reading (input), $ per million"
                  error={fieldError("input")}
                >
                  <Input
                    id="price-input"
                    name="input"
                    inputMode="decimal"
                    defaultValue={now?.from === "owner" ? (now.input ?? "") : ""}
                    placeholder={now?.input ?? "Price unknown"}
                  />
                </Field>
                <Field
                  id="price-output"
                  label="Writing (output), $ per million"
                  error={fieldError("output")}
                >
                  <Input
                    id="price-output"
                    name="output"
                    inputMode="decimal"
                    defaultValue={now?.from === "owner" ? (now.output ?? "") : ""}
                    placeholder={now?.output ?? "Price unknown"}
                  />
                </Field>
                <Field
                  id="price-cache"
                  label="Cache reading, $ per million"
                  hint="Empty: charged as reading."
                  error={fieldError("cacheRead")}
                >
                  <Input
                    id="price-cache"
                    name="cacheRead"
                    inputMode="decimal"
                    defaultValue={now?.from === "owner" ? (now.cacheRead ?? "") : ""}
                  />
                </Field>
              </div>
            );
          }}
        </FormDialog>
      )}
    </div>
  );
}
