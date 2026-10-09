"use client";

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
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import type { ProjectForm as ProjectFormData } from "@/modules/production/screens.service";
import { createProjectAction, updateProjectAction } from "@/server/actions/production.actions";

import { productionHref } from "./labels";
import { PartyPicker, ProductionStylePicker } from "./pickers";

type Party = { id: string; code: string; name: string };
type Style = { id: string; code: string; name: string };

const FIELDS = [
  "name",
  "categoryId",
  "styleId",
  "factoryId",
  "factoryName",
  "buyerId",
  "startDate",
  "targetDate",
  "targetQuantity",
  "notes",
] as const;
type FieldName = (typeof FIELDS)[number];

/** A segmented two-way switch (a factory profile or just its name; a buyer or In-House). */
function Switch<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-grid w-full grid-cols-2 rounded-md border bg-card p-1 sm:w-auto"
    >
      {options.map(([option, text]) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          disabled={disabled}
          onClick={() => onChange(option)}
          className={cn(
            "h-8 cursor-pointer rounded-sm px-3 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-60",
            value === option
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/**
 * A production project: its name, what is made (category and style), the
 * factory, who it is for (a buyer or In-House), its days and how many pieces.
 * New projects start now or are planned. A completed or cancelled project keeps
 * all but its name and notes, and one started by a proforma keeps its buyer.
 * Both need production.manage, as the project actions check.
 */
export function ProjectForm({ form: data }: { form: ProjectFormData }) {
  const router = useRouter();
  const project = data.project;
  const closed = Boolean(project && data.locked?.closed);
  const buyerLocked = closed || Boolean(data.locked?.buyer);
  const [error, setError] = useState<ActionError>();
  const [problems, setProblems] = useState<Partial<Record<FieldName, string>>>({});
  const [pending, startTransition] = useTransition();
  const [categoryId, setCategoryId] = useState(project?.categoryId ?? "");
  const [style, setStyle] = useState<Style | null>(project?.style ?? null);
  const [factoryMode, setFactoryMode] = useState<"PROFILE" | "NAME">(
    project && !project.factory && project.factoryName ? "NAME" : "PROFILE",
  );
  const [factory, setFactory] = useState<Party | null>(project?.factory ?? null);
  const [forWhom, setForWhom] = useState<"BUYER" | "IN_HOUSE">(
    project ? (project.buyer ? "BUYER" : "IN_HOUSE") : "BUYER",
  );
  const [buyer, setBuyer] = useState<Party | null>(project?.buyer ?? null);
  const fieldError = (name: FieldName) => problems[name] ?? error?.fieldErrors?.[name]?.[0];
  const hasFieldErrors = FIELDS.some((f) => fieldError(f));
  const described = (name: FieldName, hint = false) =>
    fieldError(name) ? `${name}-error` : hint ? `${name}-hint` : undefined;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = textOf(form, "name");
    const notes = textOf(form, "notes") || null;
    const found: Partial<Record<FieldName, string>> = {};
    if (name.length < 2) found.name = "Give the project a name.";

    let input: Record<string, unknown>;
    if (closed) {
      input = { name, notes };
    } else {
      const startDate = textOf(form, "startDate");
      const targetDate = textOf(form, "targetDate");
      const quantityText = textOf(form, "targetQuantity").replaceAll(",", "");
      const quantity = /^\d{1,7}$/.test(quantityText) ? Number(quantityText) : NaN;
      if (!startDate) found.startDate = "Choose the day it starts.";
      if (!targetDate) found.targetDate = "Choose the day it is due.";
      else if (startDate && targetDate < startDate) {
        found.targetDate = "It cannot be due before it starts.";
      }
      if (!(quantity >= 1 && quantity <= 1_000_000)) {
        found.targetQuantity = "Enter how many pieces, like 1200.";
      }
      if (forWhom === "BUYER" && !buyer && !buyerLocked) {
        found.buyerId = "Choose the buyer, or make it In-House.";
      }
      input = {
        name,
        categoryId: categoryId || null,
        styleId: style?.id ?? null,
        factoryId: factoryMode === "PROFILE" ? (factory?.id ?? null) : null,
        factoryName: factoryMode === "NAME" ? textOf(form, "factoryName") || null : null,
        ...(buyerLocked ? {} : { buyerId: forWhom === "BUYER" ? (buyer?.id ?? null) : null }),
        ...(!project || startDate !== project.startOn ? { startDate } : {}),
        ...(!project || targetDate !== project.targetOn ? { targetDate } : {}),
        targetQuantity: quantity,
        notes,
        ...(project ? {} : { status: textOf(form, "status") === "PLANNED" ? "PLANNED" : "ACTIVE" }),
      };
    }
    setProblems(found);
    if (Object.keys(found).length > 0) return;

    startTransition(async () => {
      const result = project
        ? await updateProjectAction(project.id, input)
        : await createProjectAction(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`${productionHref.project(result.data.id)}?${project ? "saved" : "created"}=1`);
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-2xl gap-6" noValidate>
      {closed && (
        <FormAlert tone="note">
          {project!.code} is {project!.status === "COMPLETED" ? "completed" : "cancelled"}; only its
          name and notes can change.
        </FormAlert>
      )}
      <Field
        id="name"
        label="Project name"
        hint="Like: Navy polo for Rahim Traders, winter batch."
        error={fieldError("name")}
      >
        <Input
          id="name"
          name="name"
          defaultValue={project?.name}
          maxLength={160}
          autoComplete="off"
          aria-invalid={Boolean(fieldError("name"))}
          aria-describedby={described("name", true)}
          required
          autoFocus={!project}
        />
      </Field>

      <div className="grid items-start gap-5 sm:grid-cols-2">
        <Field
          id="styleId"
          label="Style (optional)"
          hint="The style its pieces go into stock as."
          error={fieldError("styleId")}
        >
          {closed ? (
            <p className="text-sm">{style ? `${style.code} · ${style.name}` : "None"}</p>
          ) : (
            <ProductionStylePicker
              id="styleId"
              value={style}
              onChange={(picked) => {
                setStyle(picked);
                if (picked && !categoryId && picked.categoryId) setCategoryId(picked.categoryId);
              }}
              invalid={Boolean(fieldError("styleId"))}
              describedBy={described("styleId", true)}
            />
          )}
        </Field>
        <Field id="categoryId" label="Category" error={fieldError("categoryId")}>
          <NativeSelect
            id="categoryId"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            disabled={closed}
            containerClassName="sm:w-full"
            className="md:h-10"
            aria-invalid={Boolean(fieldError("categoryId"))}
            aria-describedby={described("categoryId")}
          >
            <option value="">No category</option>
            {data.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      <fieldset className="grid min-w-0 gap-3">
        <legend className="mb-2 text-sm font-medium">Factory</legend>
        <Switch
          label="How the factory is given"
          value={factoryMode}
          disabled={closed}
          onChange={setFactoryMode}
          options={[
            ["PROFILE", "A supplier"],
            ["NAME", "Just a name"],
          ]}
        />
        {factoryMode === "PROFILE" ? (
          <Field
            id="factoryId"
            label="Factory supplier"
            hint="Its bills then show on its account. Leave empty if not decided yet."
            error={fieldError("factoryId")}
          >
            {closed ? (
              <p className="text-sm">{factory?.name ?? "None"}</p>
            ) : (
              <PartyPicker
                id="factoryId"
                kind="SUPPLIER"
                value={factory}
                onChange={setFactory}
                invalid={Boolean(fieldError("factoryId"))}
                describedBy={described("factoryId", true)}
              />
            )}
          </Field>
        ) : (
          <Field id="factoryName" label="Factory name" error={fieldError("factoryName")}>
            <Input
              id="factoryName"
              name="factoryName"
              defaultValue={project?.factoryName ?? ""}
              maxLength={160}
              disabled={closed}
              autoComplete="off"
              aria-invalid={Boolean(fieldError("factoryName"))}
              aria-describedby={described("factoryName")}
            />
          </Field>
        )}
      </fieldset>

      <fieldset className="grid min-w-0 gap-3">
        <legend className="mb-2 text-sm font-medium">Made for</legend>
        <Switch
          label="Who it is made for"
          value={forWhom}
          disabled={buyerLocked}
          onChange={setForWhom}
          options={[
            ["BUYER", "A buyer"],
            ["IN_HOUSE", "In-House"],
          ]}
        />
        {forWhom === "BUYER" ? (
          <Field
            id="buyerId"
            label="Buyer"
            hint={
              data.locked?.buyer && project?.proforma
                ? `Started from proforma ${project.proforma.number}, so the buyer stays.`
                : undefined
            }
            error={fieldError("buyerId")}
          >
            <PartyPicker
              id="buyerId"
              kind="BUYER"
              value={buyer}
              onChange={setBuyer}
              locked={buyerLocked}
              invalid={Boolean(fieldError("buyerId"))}
              describedBy={described("buyerId", true)}
            />
          </Field>
        ) : (
          <p className="text-[0.8125rem] text-muted-foreground">
            Made for our own stock, to sell from the shelf.
          </p>
        )}
      </fieldset>

      <div className="grid items-start gap-5 sm:grid-cols-3">
        <Field id="startDate" label="Starts" error={fieldError("startDate")}>
          <Input
            id="startDate"
            name="startDate"
            type="date"
            defaultValue={project?.startOn ?? data.today}
            disabled={closed}
            aria-invalid={Boolean(fieldError("startDate"))}
            aria-describedby={described("startDate")}
          />
        </Field>
        <Field
          id="targetDate"
          label="Due"
          hint={project ? undefined : "45 days on, unless changed."}
          error={fieldError("targetDate")}
        >
          <Input
            id="targetDate"
            name="targetDate"
            type="date"
            defaultValue={project?.targetOn ?? data.defaultTargetOn}
            disabled={closed}
            aria-invalid={Boolean(fieldError("targetDate"))}
            aria-describedby={described("targetDate", !project)}
          />
        </Field>
        <Field id="targetQuantity" label="Pieces to make" error={fieldError("targetQuantity")}>
          <Input
            id="targetQuantity"
            name="targetQuantity"
            inputMode="numeric"
            defaultValue={project?.targetQuantity ?? ""}
            placeholder="1200"
            disabled={closed}
            autoComplete="off"
            aria-invalid={Boolean(fieldError("targetQuantity"))}
            aria-describedby={described("targetQuantity")}
          />
        </Field>
      </div>

      {!project && (
        <ChoiceList
          name="status"
          legend="When it starts"
          defaultValue="ACTIVE"
          options={[
            {
              value: "ACTIVE",
              label: "In production now",
              hint: "It starts at Fabric sourcing and its days count from the start day.",
            },
            {
              value: "PLANNED",
              label: "Planned for later",
              hint: "Start it when the factory begins. Costs can be added meanwhile.",
            },
          ]}
        />
      )}

      <Field id="notes" label="Notes (optional)" error={fieldError("notes")}>
        <Textarea
          id="notes"
          name="notes"
          defaultValue={project?.notes ?? ""}
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
          <Link href={project ? productionHref.project(project.id) : "/production/projects"}>
            Cancel
          </Link>
        </Button>
        <Button type="submit" className="w-full sm:w-auto" disabled={pending}>
          {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
          {project
            ? pending
              ? "Saving"
              : "Save changes"
            : pending
              ? "Creating"
              : "Create the project"}
        </Button>
      </div>
      {error?.code === "INTERNAL" && (
        <ErrorDialog
          code={error.errorId ?? "ERR-UNKNOWN"}
          title={project ? "We could not save the project" : "We could not create the project"}
          onClose={() => setError(undefined)}
        />
      )}
    </form>
  );
}
