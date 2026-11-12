"use client";

import { LoaderCircleIcon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { readAmount, textOf } from "@/components/products/form-values";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { ActionError } from "@/lib/result";
import type { getLeadSettingsPage } from "@/modules/leads/lead.service";
import { SOURCE_KIND_LABELS, SUPPRESSION_KIND_LABELS } from "@/modules/leads/labels";
import {
  addLeadSourceAction,
  addSuppressionAction,
  saveLeadSettingsAction,
  setLeadSourceActiveAction,
} from "@/server/actions/leads.actions";

type Page = Awaited<ReturnType<typeof getLeadSettingsPage>>;

const list = (text: string) =>
  text
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean);

/** The lead check card's rules, set once (Lead settings). */
export function LeadRulesForm({ page }: { page: Page }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError>();
  const [saved, setSaved] = useState(false);
  const s = page.settings;
  const fieldError = (name: string) => error?.fieldErrors?.[name]?.[0];

  return (
    <form
      noValidate
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const amount = (name: string) => {
          const v = readAmount(textOf(form, name));
          return v === "invalid" ? -1 : v;
        };
        const pieces = Number(textOf(form, "minPieces"));
        const days = Number(textOf(form, "followUpDays"));
        startTransition(async () => {
          const result = await saveLeadSettingsAction({
            productFocus: list(textOf(form, "productFocus")),
            targetCountries: list(textOf(form, "targetCountries")),
            riskyCountries: list(textOf(form, "riskyCountries")),
            minPieces: textOf(form, "minPieces") && Number.isInteger(pieces) ? pieces : null,
            priceMin: amount("priceMin"),
            priceMax: amount("priceMax"),
            followUpDays: Number.isInteger(days) && days > 0 ? days : 7,
          });
          setError(result.ok ? undefined : result.error);
          setSaved(result.ok);
          if (result.ok) router.refresh();
        });
      }}
    >
      <Field
        id="rules-products"
        label="Products you make"
        hint="Separate them with commas: Polo, T-shirt, Hoodie"
        error={fieldError("productFocus")}
        className="sm:col-span-2"
      >
        <Input id="rules-products" name="productFocus" defaultValue={s.productFocus.join(", ")} />
      </Field>
      <Field
        id="rules-target"
        label="Countries you want buyers from"
        hint="Separate them with commas"
        error={fieldError("targetCountries")}
      >
        <Input
          id="rules-target"
          name="targetCountries"
          defaultValue={s.targetCountries.join(", ")}
        />
      </Field>
      <Field
        id="rules-risky"
        label="Risky countries"
        hint="Payment or other risk: shown red"
        error={fieldError("riskyCountries")}
      >
        <Input id="rules-risky" name="riskyCountries" defaultValue={s.riskyCountries.join(", ")} />
      </Field>
      <Field id="rules-pieces" label="Fewest pieces per style" error={fieldError("minPieces")}>
        <Input
          id="rules-pieces"
          name="minPieces"
          inputMode="numeric"
          defaultValue={s.minPieces ?? ""}
        />
      </Field>
      <Field
        id="rules-days"
        label="Days to the first follow-up"
        hint="When a lead is added without a next step"
        error={fieldError("followUpDays")}
      >
        <Input
          id="rules-days"
          name="followUpDays"
          inputMode="numeric"
          defaultValue={s.followUpDays}
        />
      </Field>
      <Field
        id="rules-min"
        label={`Lowest price per piece (${page.currency})`}
        error={fieldError("priceMin")}
      >
        <Input id="rules-min" name="priceMin" inputMode="decimal" defaultValue={s.priceMin ?? ""} />
      </Field>
      <Field
        id="rules-max"
        label={`Highest price per piece (${page.currency})`}
        error={fieldError("priceMax")}
      >
        <Input id="rules-max" name="priceMax" inputMode="decimal" defaultValue={s.priceMax ?? ""} />
      </Field>
      <div className="grid gap-3 sm:col-span-2">
        {error && !error.fieldErrors && <FormAlert>{error.message}</FormAlert>}
        {saved && <FormAlert tone="success">The lead settings are saved.</FormAlert>}
        <Button type="submit" disabled={pending} className="w-full sm:w-auto sm:justify-self-start">
          {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
          Save the rules
        </Button>
      </div>
    </form>
  );
}

/** The company's lead sources: add one, or switch one off (never removed). */
export function LeadSourcesForm({ page }: { page: Page }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError>();

  return (
    <div className="grid gap-4">
      <ul className="grid gap-2">
        {page.sources.map((s) => (
          <li
            key={s.id}
            className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
          >
            <span className="min-w-0 break-words">
              <span className={s.isActive ? "font-medium" : "text-muted-foreground"}>{s.name}</span>{" "}
              <span className="text-muted-foreground">
                · {SOURCE_KIND_LABELS[s.kind]} · {s.leads === 1 ? "1 lead" : `${s.leads} leads`}
                {s.isActive ? "" : " · switched off"}
              </span>
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await setLeadSourceActiveAction(s.id, { isActive: !s.isActive });
                  setError(result.ok ? undefined : result.error);
                  if (result.ok) router.refresh();
                })
              }
            >
              {s.isActive ? "Switch off" : "Switch on"}
            </Button>
          </li>
        ))}
      </ul>
      <form
        noValidate
        className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          const el = e.currentTarget;
          const form = new FormData(el);
          startTransition(async () => {
            const result = await addLeadSourceAction({
              name: textOf(form, "name"),
              kind: textOf(form, "kind") || "OTHER",
            });
            setError(result.ok ? undefined : result.error);
            if (result.ok) {
              el.reset();
              router.refresh();
            }
          });
        }}
      >
        <Field
          id="source-name"
          label="New source"
          hint="A fair with its season, a list, a referrer"
          error={error?.fieldErrors?.name?.[0]}
        >
          <Input id="source-name" name="name" placeholder="Texworld Paris Feb 2027" />
        </Field>
        <Field id="source-kind" label="Kind of source">
          <NativeSelect id="source-kind" name="kind" defaultValue="TRADE_FAIR">
            {Object.entries(SOURCE_KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          <PlusIcon aria-hidden />
          Add source
        </Button>
      </form>
      {error && !error.fieldErrors && <FormAlert>{error.message}</FormAlert>}
    </div>
  );
}

/** Adds an email, a whole email domain or a phone to "Do not contact". */
export function AddSuppressionForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError>();
  const [done, setDone] = useState(false);
  return (
    <form
      noValidate
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[auto_1fr_1fr_auto] lg:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        const el = e.currentTarget;
        const form = new FormData(el);
        startTransition(async () => {
          const result = await addSuppressionAction({
            kind: textOf(form, "kind"),
            value: textOf(form, "value"),
            note: textOf(form, "note") || null,
          });
          setError(result.ok ? undefined : result.error);
          setDone(result.ok);
          if (result.ok) {
            el.reset();
            router.refresh();
          }
        });
      }}
    >
      <Field id="dnc-kind" label="What to block">
        <NativeSelect id="dnc-kind" name="kind" defaultValue="EMAIL" containerClassName="sm:w-full">
          {Object.entries(SUPPRESSION_KIND_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id="dnc-value" label="Email, domain or phone" error={error?.fieldErrors?.value?.[0]}>
        <Input id="dnc-value" name="value" autoComplete="off" />
      </Field>
      <Field id="dnc-note" label="Note">
        <Input id="dnc-note" name="note" placeholder="Asked by email on 12 Nov" />
      </Field>
      <Button type="submit" disabled={pending} className="w-full lg:w-auto">
        Add to the list
      </Button>
      {error && !error.fieldErrors && (
        <div className="sm:col-span-2 lg:col-span-4">
          <FormAlert>{error.message}</FormAlert>
        </div>
      )}
      {done && (
        <div className="sm:col-span-2 lg:col-span-4">
          <FormAlert tone="success">Added. Their contacts are marked “Do not contact”.</FormAlert>
        </div>
      )}
    </form>
  );
}
