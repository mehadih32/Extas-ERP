"use client";

import type { ProductionKind } from "@prisma/client";
import { LoaderCircleIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ErrorDialog } from "@/components/feedback/error-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { ChoiceList } from "@/components/parties/choice-list";
import { textOf } from "@/components/products/form-values";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ActionError } from "@/lib/result";
import type { BatchForm as BatchFormData } from "@/modules/production/batch-screens.service";
import { createBatchAction, updateBatchAction } from "@/server/actions/production.actions";

import { BATCH_KIND_HINTS, BATCH_KIND_LABELS, productionHref } from "./labels";
import { PartyPicker } from "./pickers";

type Party = { id: string; code: string; name: string };

const FIELDS = [
  "name",
  "kind",
  "factoryId",
  "targetDate",
  "rejectTolerancePercent",
  "notes",
] as const;
type FieldName = (typeof FIELDS)[number];

const KINDS: ProductionKind[] = ["CM", "READYMADE", "DROPSHIP"];

/**
 * A master batch: its name, how its goods are made or bought, the factory and
 * the day it should all be done (each new style starts with both), and notes.
 * For production.manage, as the batch actions check.
 */
export function BatchForm({ form: data }: { form: BatchFormData }) {
  const router = useRouter();
  const batch = data.batch;
  const [error, setError] = useState<ActionError>();
  const [problems, setProblems] = useState<Partial<Record<FieldName, string>>>({});
  const [pending, startTransition] = useTransition();
  const [factory, setFactory] = useState<Party | null>(batch?.factory ?? null);
  const fieldError = (name: FieldName) => problems[name] ?? error?.fieldErrors?.[name]?.[0];
  const hasFieldErrors = FIELDS.some((f) => fieldError(f));
  const described = (name: FieldName, hint = false) =>
    fieldError(name) ? `${name}-error` : hint ? `${name}-hint` : undefined;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = textOf(form, "name");
    const allowanceText = textOf(form, "rejectTolerancePercent");
    const allowance = allowanceText === "" ? 2 : Number(allowanceText);
    const found: Partial<Record<FieldName, string>> = {};
    if (name.length < 2) found.name = "Give the batch a name.";
    if (!Number.isFinite(allowance) || allowance < 0 || allowance > 100) {
      found.rejectTolerancePercent = "Enter a share from 0 to 100.";
    } else if (Math.round(allowance * 100) !== allowance * 100) {
      found.rejectTolerancePercent = "Up to 2 decimal places.";
    }
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    const input = {
      name,
      kind: (textOf(form, "kind") || "CM") as ProductionKind,
      factoryId: factory?.id ?? null,
      targetDate: textOf(form, "targetDate") || null,
      rejectTolerancePercent: allowance,
      notes: textOf(form, "notes") || null,
    };
    startTransition(async () => {
      const result = batch
        ? await updateBatchAction(batch.id, input)
        : await createBatchAction(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`${productionHref.batch(result.data.id)}?${batch ? "saved" : "created"}=1`);
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-2xl gap-6" noValidate>
      <Field
        id="name"
        label="Batch name"
        hint="Like: Winter polo 5,000 pcs, three brands."
        error={fieldError("name")}
      >
        <Input
          id="name"
          name="name"
          defaultValue={batch?.name}
          maxLength={160}
          autoComplete="off"
          aria-invalid={Boolean(fieldError("name"))}
          aria-describedby={described("name", true)}
          required
          autoFocus={!batch}
        />
      </Field>

      <ChoiceList
        name="kind"
        legend="How the goods are made"
        defaultValue={batch?.kind ?? "CM"}
        options={KINDS.map((kind) => ({
          value: kind,
          label: BATCH_KIND_LABELS[kind],
          hint: BATCH_KIND_HINTS[kind],
        }))}
      />

      <div className="grid items-start gap-5 sm:grid-cols-2">
        <Field
          id="factoryId"
          label="Factory (optional)"
          hint="Each new style starts at this factory."
          error={fieldError("factoryId")}
        >
          <PartyPicker
            id="factoryId"
            kind="SUPPLIER"
            value={factory}
            onChange={setFactory}
            invalid={Boolean(fieldError("factoryId"))}
            describedBy={described("factoryId", true)}
          />
        </Field>
        <Field
          id="targetDate"
          label="All done by (optional)"
          hint={batch ? "Each new style starts with this day." : "45 days on, unless changed."}
          error={fieldError("targetDate")}
        >
          <Input
            id="targetDate"
            name="targetDate"
            type="date"
            defaultValue={batch ? (batch.targetOn ?? "") : data.defaultTargetOn}
            aria-invalid={Boolean(fieldError("targetDate"))}
            aria-describedby={described("targetDate", true)}
          />
        </Field>
      </div>

      <Field
        id="rejectTolerancePercent"
        label="Reject allowance (%)"
        hint="Rejects (sewing faults, bodies ruined attaching accessories) up to this share of the pieces cut cost the factory nothing. Each one over it is taken off their CM at the style's target price. Missing pieces are always taken off."
        error={fieldError("rejectTolerancePercent")}
      >
        <Input
          id="rejectTolerancePercent"
          name="rejectTolerancePercent"
          inputMode="decimal"
          defaultValue={batch ? batch.rejectTolerancePercent.replace(/\.?0+$/, "") : "2"}
          className="max-w-32"
          autoComplete="off"
          aria-invalid={Boolean(fieldError("rejectTolerancePercent"))}
          aria-describedby={described("rejectTolerancePercent", true)}
        />
      </Field>

      <Field id="notes" label="Notes (optional)" error={fieldError("notes")}>
        <Textarea
          id="notes"
          name="notes"
          defaultValue={batch?.notes ?? ""}
          rows={3}
          maxLength={4000}
          aria-invalid={Boolean(fieldError("notes"))}
          aria-describedby={described("notes")}
        />
      </Field>

      {error && error.code !== "INTERNAL" && !hasFieldErrors && (
        <FormAlert>{error.message}</FormAlert>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Button asChild variant="outline" className="w-full sm:w-auto">
          <Link href={batch ? productionHref.batch(batch.id) : "/production/batches"}>Cancel</Link>
        </Button>
        <Button type="submit" className="w-full sm:w-auto" disabled={pending}>
          {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
          {batch
            ? pending
              ? "Saving"
              : "Save changes"
            : pending
              ? "Creating"
              : "Create the batch"}
        </Button>
      </div>
      {error?.code === "INTERNAL" && (
        <ErrorDialog
          code={error.errorId ?? "ERR-UNKNOWN"}
          title={batch ? "We could not save the batch" : "We could not create the batch"}
          onClose={() => setError(undefined)}
        />
      )}
    </form>
  );
}
