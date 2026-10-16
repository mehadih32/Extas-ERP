"use client";

import { useState, useTransition } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { Panel } from "@/components/sales/detail-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { ActionError } from "@/lib/result";
import type { AiCosts } from "@/modules/ai/costs.service";
import { setBudgetAction } from "@/server/actions/ai.actions";

/*
 * The AI's budget and limits (ai.manage). Every limit is optional and empty
 * means none: without a monthly budget the AI shows an estimate before a big
 * task and asks. At the alert percentage the owner is told; at a limit new
 * work stops, or small work goes on with the small model. Each provider
 * (Claude, OpenAI, Gemini) can have its own monthly limit too.
 */

const LIMITS = [
  {
    name: "monthly",
    label: "Monthly budget",
    hint: "Empty: no budget; the AI asks before big tasks.",
  },
  { name: "daily", label: "Daily limit", hint: "Empty: no daily limit." },
  { name: "perOrder", label: "Limit per order or tech pack", hint: "All AI work on one record." },
  {
    name: "perStaffMonthly",
    label: "Limit per person, per month",
    hint: "What one person's questions may cost.",
  },
  {
    name: "perAgentMonthly",
    label: "Limit per agent, per month",
    hint: "Mehedi 2.0 and each expert alike.",
  },
  {
    name: "askAbove",
    label: "Ask before a task above",
    hint: "Asks you first when a task is estimated above this.",
  },
] as const;

const PROVIDER_LIMITS = [
  { id: "anthropic", label: "Claude" },
  { id: "openai", label: "OpenAI" },
  { id: "google", label: "Gemini" },
] as const;

export function BudgetForm({
  budget: b,
  currency,
}: {
  budget: AiCosts["budget"];
  currency: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError>();
  const [saved, setSaved] = useState(false);
  const fieldError = (name: string) => error?.fieldErrors?.[name]?.[0];

  return (
    <Panel title="Budget and limits" id="ai-budget-heading">
      <form
        className="mt-3 grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setSaved(false);
          startTransition(async () => {
            const result = await setBudgetAction(Object.fromEntries(form));
            if (result.ok) {
              setError(undefined);
              setSaved(true);
            } else setError(result.error);
          });
        }}
      >
        <p className="text-sm text-muted-foreground">
          All optional: leave a box empty for no limit. Amounts are in {currency}. Set a spend limit
          on each provider&apos;s own site too (Claude Console, OpenAI, Google AI Studio), so the
          bill can never go past it.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {LIMITS.map((l) => (
            <Field
              key={l.name}
              id={`budget-${l.name}`}
              label={l.label}
              hint={l.hint}
              error={fieldError(l.name)}
            >
              <Input
                id={`budget-${l.name}`}
                name={l.name}
                inputMode="decimal"
                defaultValue={b[l.name] ?? ""}
                placeholder="No limit"
              />
            </Field>
          ))}
          <Field
            id="budget-alert"
            label="Tell me at (% of the monthly budget)"
            error={fieldError("alertPercent")}
          >
            <Input
              id="budget-alert"
              name="alertPercent"
              type="number"
              min={10}
              max={100}
              defaultValue={b.alertPercent}
              required
            />
          </Field>
          <Field id="budget-at-limit" label="At the limit" error={fieldError("atLimit")}>
            <NativeSelect
              id="budget-at-limit"
              name="atLimit"
              defaultValue={b.atLimit}
              containerClassName="sm:w-full"
            >
              <option value="STOP">Stop new AI work</option>
              <option value="CHEAPER">Go on with the small model</option>
            </NativeSelect>
          </Field>
          <Field
            id="budget-rate"
            label={`${currency} for one US dollar`}
            hint="The providers charge in dollars; costs show in your money at this rate."
            error={fieldError("usdRate")}
          >
            <Input
              id="budget-rate"
              name="usdRate"
              inputMode="decimal"
              defaultValue={b.usdRate}
              required
            />
          </Field>
        </div>
        <div className="grid gap-2">
          <p className="text-sm font-medium">Limit per provider, per month</p>
          <p className="text-[0.8125rem] text-muted-foreground">
            What each provider&apos;s models may cost in a month. Empty: no limit.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            {PROVIDER_LIMITS.map((p) => (
              <Field
                key={p.id}
                id={`budget-limit-${p.id}`}
                label={p.label}
                error={fieldError(`limit_${p.id}`)}
              >
                <Input
                  id={`budget-limit-${p.id}`}
                  name={`limit_${p.id}`}
                  inputMode="decimal"
                  defaultValue={b.providerLimits[p.id] ?? ""}
                  placeholder="No limit"
                />
              </Field>
            ))}
          </div>
        </div>
        {error && !error.fieldErrors && <FormAlert>{error.message}</FormAlert>}
        {saved && <FormAlert tone="success">The budget is saved.</FormAlert>}
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving" : "Save the budget"}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
