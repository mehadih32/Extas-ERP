"use client";

import { FlaskConicalIcon, RefreshCwIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { BlockedModels } from "@/components/ai/blocked-models";
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
import { dayText, PRICE_FIELDS, usdText } from "@/modules/ai/price-list";
import type { AiModelsScreen, PriceRow } from "@/modules/ai/settings.service";
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
 * task's test ("Run the test"); until then the AI asks first. Prices: a
 * section each for Claude, OpenAI and Gemini, from the providers' price pages
 * (where from, and when checked), which the owner can change. A model with no
 * price is blocked (v6.4 A7): it cannot be picked, and the AI never uses it.
 */

type Message = { tone: "success" | "error"; text: string };

const TEST_TONES: Record<ModelTestState, Tone> = {
  BUILT_IN: "plain",
  PASSED: "done",
  FAILED: "warn",
  CHANGED: "warn",
  NONE: "warn",
};

/** The price columns, in the price pages' words. */
const PRICE_COLUMNS = [
  ["input", "Input"],
  ["output", "Output"],
  ["cacheRead", "Cache read"],
  ["cacheWrite", "Cache write"],
  ["batchInput", "Batch input"],
  ["batchOutput", "Batch output"],
] as const satisfies ReadonlyArray<readonly [(typeof PRICE_FIELDS)[number], string]>;

const COMPANY = { anthropic: "Anthropic", openai: "OpenAI", google: "Google" } as const;

const price = (v: string | null) => (v === null ? "—" : usdText(Number(v)));

const BLOCKED = "No price: blocked";

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
                <option key={x.ref} value={x.ref} disabled={!x.priced}>
                  {x.label}
                  {p.hasKey ? "" : " (no key now)"}
                  {x.priced ? "" : ` (${BLOCKED})`}
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
  const priceRows = m.priceSections.flatMap((x) => [...x.rows, ...x.older]);
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
      <BlockedModels blocked={m.blocked} />

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
                      {t.blocked && <StatusBadge tone="warn">{BLOCKED}</StatusBadge>}
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
                {a.blocked && (
                  <span>
                    <StatusBadge tone="warn">{BLOCKED}</StatusBadge>
                  </span>
                )}
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
          US dollars per million tokens (about 750,000 words), from each provider&apos;s official
          price page, with the day they were checked. Providers change their prices: when one
          changes, put in the new price with &ldquo;Edit&rdquo;. A model with no price is blocked:
          the AI never uses it and no work can be given to it until you add its price.
        </p>
      </Panel>

      {m.priceSections.map((section) => (
        <Panel
          key={section.provider}
          title={section.label}
          id={`ai-prices-${section.provider}-heading`}
        >
          <p className="mt-1 text-sm text-muted-foreground">
            From{" "}
            <a
              href={section.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              {COMPANY[section.provider]}&apos;s price page
            </a>
            , checked on {dayText(section.checkedOn)}.
          </p>
          <PriceTable
            rows={section.rows}
            canManage={canManage}
            day={day}
            onEdit={(r) => setPricing({ model: r.model, label: r.label })}
          />
          {section.older.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium">
                Older models ({section.older.length})
              </summary>
              <PriceTable
                rows={section.older}
                canManage={canManage}
                day={day}
                onEdit={(r) => setPricing({ model: r.model, label: r.label })}
              />
            </details>
          )}
        </Panel>
      ))}

      {pricing && (
        <FormDialog
          title={pricing.model ? `Price of ${pricing.label}` : "Add a price"}
          description="US dollars per million tokens, as on the provider's price page. Leave Input and Output empty to go back to the price page's price (a model on no price page then has no price, and is blocked)."
          submitLabel="Save the price"
          pendingLabel="Saving"
          errorTitle="We could not save the price"
          onClose={() => setPricing(null)}
          onSubmit={async (form) => {
            const result = await setModelPriceAction({
              model: pricing.model ?? String(form.get("model") ?? ""),
              ...Object.fromEntries(PRICE_FIELDS.map((f) => [f, String(form.get(f) ?? "")])),
            });
            if (!result.ok) return result.error;
            setMessage({ tone: "success", text: "The price is saved." });
            setPricing(null);
          }}
        >
          {(fieldError) => {
            const now = pricing.model ? priceRows.find((x) => x.model === pricing.model) : null;
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
                      <PricedOptions m={m} />
                    </NativeSelect>
                  </Field>
                )}
                {now?.state === "owner" && now.setBy && (
                  <p className="text-[0.8125rem] text-muted-foreground">
                    Your price, set by {now.setBy}
                    {now.setAt ? ` on ${day(now.setAt)}` : ""}.
                  </p>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  {PRICE_COLUMNS.map(([f, title]) => (
                    <Field
                      key={f}
                      id={`price-${f}`}
                      label={`${title}, $ per million`}
                      hint={PRICE_HINTS[f]}
                      error={fieldError(f)}
                    >
                      <Input
                        id={`price-${f}`}
                        name={f}
                        inputMode="decimal"
                        defaultValue={now?.state === "owner" ? (now[f] ?? "") : ""}
                        placeholder={
                          now?.list?.[f] ?? (f === "input" || f === "output" ? "No price" : "")
                        }
                      />
                    </Field>
                  ))}
                </div>
              </div>
            );
          }}
        </FormDialog>
      )}
    </div>
  );
}

const PRICE_HINTS: Partial<Record<(typeof PRICE_FIELDS)[number], string>> = {
  cacheRead: "Empty: charged as input.",
  cacheWrite: "Empty: charged as input (Claude: a quarter more).",
  batchInput: "Empty: charged as plain work.",
  batchOutput: "Empty: charged as plain work.",
};

/** Every model the owner can price: the built-in ones and those the providers offer. */
function PricedOptions({ m }: { m: AiModelsScreen }) {
  return (
    <>
      <optgroup label="Claude (built in)">
        {AI_MODELS.map((x) => (
          <option key={x.id} value={x.id}>
            {x.label}
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
            {p.models.map((x) => (
              <option key={x.ref} value={x.ref}>
                {x.label}
                {x.priced ? "" : ` (${BLOCKED})`}
              </option>
            ))}
          </optgroup>
        ))}
    </>
  );
}

/** One provider's prices: a row per model, with where each price came from. */
function PriceTable({
  rows,
  canManage,
  day,
  onEdit,
}: {
  rows: readonly PriceRow[];
  canManage: boolean;
  day: (at: Date | string | null) => string;
  onEdit: (row: PriceRow) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[60rem] text-sm">
        <thead>
          <tr className="border-b text-left text-[0.8125rem] text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Model</th>
            {PRICE_COLUMNS.map(([f, title]) => (
              <th key={f} className="py-2 pr-3 text-right font-medium">
                {title}
              </th>
            ))}
            <th className="py-2 pr-3 font-medium">Where from</th>
            <th className="py-2 pr-3 font-medium">Checked on</th>
            {canManage && <th className="py-2" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.model} className="border-b align-top last:border-0">
              <td className="max-w-[16rem] py-2 pr-3">
                <span className="font-medium break-words">{x.label}</span>
                <span className="block text-[0.75rem] break-words text-muted-foreground">
                  {x.id}
                  {x.builtIn ? " · Built in" : ""}
                  {x.size ? ` · ${x.size}` : ""}
                  {x.inUse ? " · In use" : ""}
                </span>
                {x.notes.map((n) => (
                  <span key={n} className="block text-[0.75rem] break-words text-muted-foreground">
                    {n}
                  </span>
                ))}
              </td>
              {PRICE_COLUMNS.map(([f]) => (
                <td key={f} className="py-2 pr-3 text-right tabular-nums">
                  {price(x[f])}
                </td>
              ))}
              <td className="py-2 pr-3">
                {x.state === "erp" && x.sourceUrl ? (
                  <a
                    href={x.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-4"
                  >
                    Price page
                  </a>
                ) : x.state === "owner" ? (
                  <StatusBadge tone="plain">
                    {x.setBy ? `Your price (${x.setBy})` : "Your price"}
                  </StatusBadge>
                ) : (
                  <StatusBadge tone="warn">{BLOCKED}</StatusBadge>
                )}
              </td>
              <td className="py-2 pr-3 whitespace-nowrap">
                {x.state === "erp" && x.checkedOn
                  ? dayText(x.checkedOn)
                  : x.state === "owner"
                    ? day(x.setAt)
                    : "—"}
              </td>
              {canManage && (
                <td className="py-2 text-right">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Edit the price of ${x.label}`}
                    onClick={() => onEdit(x)}
                  >
                    Edit
                  </Button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
