"use client";

import { EraserIcon, WandSparklesIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { FormFooter, usePageForm } from "@/components/accounts/form-bits";
import { Field, FormAlert } from "@/components/forms/field";
import { quantity as quantityText, readQuantity, UNIT_LABELS } from "@/components/materials/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import type { BatchIssue } from "@/modules/production/batch-issue.service";
import { issueToStylesAction } from "@/server/actions/production.actions";

import { productionHref } from "./labels";

type Material = BatchIssue["materials"][number];

const keyOf = (projectId: string, materialId: string, colour: string | null) =>
  `${projectId}|${materialId}|${colour ?? ""}`;
const isZero = (text: string) => !/[1-9]/.test(text);
/** A number typed in a box (0 when empty or not a number), for the running totals. */
const typed = (text: string) => {
  const value = Number(text.trim().replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? value : 0;
};
const round3 = (n: number) => String(Math.round(n * 1000) / 1000);

/**
 * Issuing the batch's materials to its styles in one go (the store): for each
 * material, what is in the store and, for each style, its need by garment
 * colour, what it already has and what is still to issue. Each box is what goes
 * to one style for one colour; "Fill what is still to issue" fills them all.
 * Saving writes one issue note per style, and each style is charged only for
 * what it took.
 */
export function BatchIssueForm({ data, currency }: { data: BatchIssue; currency: string }) {
  const router = useRouter();
  const form = usePageForm();
  const { fieldError } = form;
  const [date, setDate] = useState(data.today);
  const [receivedBy, setReceivedBy] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});

  const set = (key: string, value: string) => setValues((all) => ({ ...all, [key]: value }));
  const issuingOf = (m: Material) =>
    m.styles.reduce(
      (t, s) =>
        t +
        s.colours.reduce(
          (u, c) => u + typed(values[keyOf(s.projectId, m.material.id, c.colorName)] ?? ""),
          0,
        ),
      0,
    );

  function fillAll() {
    const next: Record<string, string> = {};
    for (const m of data.materials) {
      for (const s of m.styles) {
        for (const c of s.colours) {
          if (!isZero(c.toIssue)) next[keyOf(s.projectId, m.material.id, c.colorName)] = c.toIssue;
        }
      }
    }
    setValues(next);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found: Record<string, string> = {};
    const lines: Array<{
      projectId: string;
      materialId: string;
      colorName: string | null;
      quantity: number;
    }> = [];
    for (const m of data.materials) {
      for (const s of m.styles) {
        for (const c of s.colours) {
          const key = keyOf(s.projectId, m.material.id, c.colorName);
          const text = values[key] ?? "";
          if (!text.trim()) continue;
          const q = readQuantity(text, m.material.unit, { allowZero: true });
          if (typeof q === "string") found[key] = q;
          else if (q > 0) {
            lines.push({
              projectId: s.projectId,
              materialId: m.material.id,
              colorName: c.colorName,
              quantity: q,
            });
          }
        }
      }
      const issuing = issuingOf(m);
      if (issuing > Number(m.inStore) + 1e-9) {
        found[`material.${m.material.id}`] =
          `The store has ${quantityText(m.inStore, m.material.unit, currency)}; ` +
          `${quantityText(round3(issuing), m.material.unit, currency)} is more than that.`;
      }
    }
    if (lines.length === 0 && Object.keys(found).length === 0) {
      found.lines = "Enter what goes to at least one style.";
    }
    if (date > data.today) found.date = "Choose today or an earlier day.";
    form.setProblems(found);
    form.setError(undefined);
    if (Object.keys(found).length > 0) return;
    form.startTransition(async () => {
      const result = await issueToStylesAction(data.batch.id, {
        warehouseId: data.storeId || undefined,
        date,
        receivedBy: receivedBy.trim() || null,
        lines,
      });
      if (!result.ok) return form.setError(result.error);
      const numbers = result.data.issues.map((i) => `${i.number} to ${i.project}`).join(", ");
      router.push(`${productionHref.batch(data.batch.id)}?issued=${encodeURIComponent(numbers)}`);
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-6" noValidate>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        {data.stores.length > 1 && (
          <Field id="store" label="From the store" hint="Changing the store shows what it holds.">
            <NativeSelect
              id="store"
              value={data.storeId}
              onChange={(e) =>
                router.replace(
                  `${productionHref.issue(data.batch.id)}?store=${encodeURIComponent(e.target.value)}`,
                )
              }
            >
              {data.stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        <Field id="date" label="Issued on" error={fieldError("date")}>
          <Input
            id="date"
            type="date"
            max={data.today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-invalid={Boolean(fieldError("date"))}
          />
        </Field>
        <Field
          id="receivedBy"
          label="Taken by (optional)"
          hint="The cutting master or the factory's man."
        >
          <Input
            id="receivedBy"
            value={receivedBy}
            onChange={(e) => setReceivedBy(e.target.value)}
            maxLength={120}
            autoComplete="off"
          />
        </Field>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={fillAll}>
          <WandSparklesIcon aria-hidden />
          Fill what is still to issue
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setValues({})}>
          <EraserIcon aria-hidden />
          Clear
        </Button>
      </div>
      {fieldError("lines") && <FormAlert>{fieldError("lines")}</FormAlert>}

      {data.materials.map((m) => {
        const unit = m.material.unit;
        const q = (text: string) => quantityText(text, unit, currency);
        const issuing = issuingOf(m);
        const over = issuing > Number(m.inStore) + 1e-9;
        const err = fieldError(`material.${m.material.id}`);
        return (
          <fieldset
            key={m.material.id}
            className="grid min-w-0 gap-4 rounded-lg border bg-card p-4 sm:p-5"
            aria-label={`${m.material.code} ${m.material.name}`}
          >
            <legend className="sr-only">
              {m.material.code} {m.material.name}
            </legend>
            <div className="grid gap-1">
              <h3 className="font-serif text-lg break-words text-primary">
                {m.material.code} · {m.material.name}
              </h3>
              <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
                {q(m.inStore)} in the store · {q(m.needed)} needed · {q(m.held)} issued ·{" "}
                {isZero(m.toIssue) ? "all issued" : `${q(m.toIssue)} still to issue`}
              </p>
              {m.short && !isZero(m.toIssue) && (
                <p className="text-[0.8125rem] font-medium text-amber-700 dark:text-amber-300">
                  The store has less than what is still to issue.
                </p>
              )}
            </div>
            <ul className="grid divide-y rounded-md border" aria-label="Styles">
              {m.styles.map((s) => (
                <li key={s.projectId} className="grid min-w-0 gap-3 p-3 sm:p-4">
                  <div className="grid min-w-0 gap-0.5">
                    <p className="text-sm font-medium break-words">
                      {s.code} · {s.name}
                    </p>
                    <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
                      {q(s.needed)} needed · {q(s.held)} issued
                      {isZero(s.toIssue) ? " · all issued" : ` · ${q(s.toIssue)} to issue`}
                    </p>
                  </div>
                  <div className="grid items-start gap-3 min-[420px]:grid-cols-2 sm:grid-cols-3">
                    {s.colours.map((c) => {
                      const key = keyOf(s.projectId, m.material.id, c.colorName);
                      const id = `issue-${key.replace(/[^a-zA-Z0-9]/g, "-")}`;
                      return (
                        <Field
                          key={key}
                          id={id}
                          label={`${c.colorName ?? "All colours"} (${UNIT_LABELS[unit]})`}
                          error={fieldError(key)}
                          hint={`Needs ${q(c.needed)}`}
                        >
                          <Input
                            id={id}
                            inputMode="decimal"
                            value={values[key] ?? ""}
                            placeholder={isZero(c.toIssue) ? "0" : c.toIssue}
                            onChange={(e) => set(key, e.target.value)}
                            autoComplete="off"
                            aria-invalid={Boolean(fieldError(key))}
                          />
                        </Field>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
            <p
              className={cn(
                "text-sm tabular-nums",
                over ? "font-medium text-destructive" : "text-muted-foreground",
              )}
              aria-live="polite"
            >
              Issuing {q(round3(issuing))} of {q(m.inStore)} in the store.
            </p>
            {err && <FormAlert>{err}</FormAlert>}
          </fieldset>
        );
      })}

      <FormFooter
        form={form}
        cancelHref={productionHref.batch(data.batch.id)}
        submitLabel="Issue to the styles"
        pendingLabel="Issuing"
        errorTitle="We could not issue the materials"
      />
    </form>
  );
}
