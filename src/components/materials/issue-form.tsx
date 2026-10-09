"use client";

import type { MeasurementUnit } from "@prisma/client";
import { LoaderCircleIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { FormFooter } from "@/components/accounts/form-bits";
import { Field, FormAlert } from "@/components/forms/field";
import { textOf } from "@/components/products/form-values";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type {
  IssueForm as IssueFormData,
  ProjectHolding,
} from "@/modules/materials/screens.service";
import {
  getProjectHoldingsAction,
  issueToProductionAction,
  returnFromProductionAction,
} from "@/server/actions/materials.actions";

import { materialsHref, quantity, readQuantity, UNIT_LABELS } from "./labels";
import { MaterialPicker, MaterialsProjectPicker } from "./pickers";
import { useMaterialsForm } from "./use-form";

type Project = { id: string; code: string; name: string };
type Line = {
  key: string;
  material: { id: string; code: string; name: string; unit: MeasurementUnit };
  /** What each store holds (issue), or what the project holds (return). */
  stores: ReadonlyArray<{ id: string; quantity: string }>;
  quantity: string;
};

let nextKey = 0;
const newKey = () => `line-${++nextKey}`;

/**
 * An issue note (materials handed from the store to a production project) or
 * a return note (unused materials the project brings back), for the store team
 * (materials.manage). Materials leave or come back at their average cost,
 * which goes into the project's cost.
 */
export function IssueForm({
  form: data,
  currency,
  cancelHref,
}: {
  form: IssueFormData;
  currency: string;
  cancelHref: string;
}) {
  const router = useRouter();
  const form = useMaterialsForm();
  const { fieldError } = form;
  const issuing = data.kind === "ISSUE";
  const [project, setProject] = useState<Project | null>(data.project);
  const [store, setStore] = useState(data.defaultStoreId);
  const [lines, setLines] = useState<Line[]>([]);
  // What the chosen project holds (return notes), keyed by project so a change loads afresh.
  const [held, setHeld] = useState<{ id: string; items?: ProjectHolding[]; error?: string } | null>(
    data.project ? { id: data.project.id, items: data.holdings } : null,
  );
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const projectId = project?.id;

  useEffect(() => {
    if (issuing || !projectId || held?.id === projectId) return;
    let live = true;
    void getProjectHoldingsAction(projectId).then((result) => {
      if (!live) return;
      setHeld(
        result.ok
          ? { id: projectId, items: result.data }
          : { id: projectId, error: result.error.message },
      );
    });
    return () => {
      live = false;
    };
  }, [issuing, projectId, held?.id]);
  const holdings = held && held.id === projectId ? held : null;

  const inStore = (line: Line) => line.stores.find((s) => s.id === store)?.quantity ?? "0";

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const found: Record<string, string> = {};
    if (!project) found.projectId = "Choose the project.";
    const out: Array<{ materialId: string; quantity: number }> = [];
    if (issuing) {
      lines.forEach((l, i) => {
        const q = readQuantity(l.quantity, l.material.unit);
        if (typeof q === "string") found[`lines.${i}.quantity`] = q;
        else out.push({ materialId: l.material.id, quantity: q });
      });
      if (lines.length === 0) found.lines = "Add the materials handed over.";
    } else {
      (holdings?.items ?? []).forEach((h) => {
        const text = (amounts[h.material.id] ?? "").trim();
        if (!text) return;
        const q = readQuantity(text, h.material.unit);
        if (typeof q === "string") found[h.material.id] = q;
        else if (q > Number(h.holding)) {
          found[h.material.id] =
            `The project holds ${quantity(h.holding, h.material.unit, currency)}.`;
        } else out.push({ materialId: h.material.id, quantity: q });
      });
      if (project && out.length === 0 && Object.keys(found).length === 0) {
        found.lines = "Enter how much of at least one material comes back.";
      }
    }
    form.setProblems(found);
    form.setError(undefined);
    if (Object.keys(found).length > 0) return;

    const day = textOf(values, "date");
    const input = {
      projectId: project!.id,
      warehouseId: textOf(values, "warehouseId") || undefined,
      date: day && day !== data.today ? day : undefined,
      receivedBy: textOf(values, "receivedBy") || undefined,
      note: textOf(values, "note") || undefined,
      lines: out,
    };
    form.startTransition(async () => {
      const result = issuing
        ? await issueToProductionAction(input)
        : await returnFromProductionAction(input);
      if (!result.ok) return form.setError(result.error);
      router.push(`${materialsHref.issue(result.data.id)}?created=1`);
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-6" noValidate>
      <Field id="projectId" label="Production project" error={fieldError("projectId")}>
        <MaterialsProjectPicker
          id="projectId"
          value={project}
          onChange={(p) => {
            setProject(p);
            setAmounts({});
          }}
          invalid={Boolean(fieldError("projectId"))}
          describedBy={fieldError("projectId") ? "projectId-error" : undefined}
          autoFocus={!project}
        />
      </Field>
      <div className="grid items-start gap-5 sm:grid-cols-3">
        {data.stores.length > 1 && (
          <Field
            id="warehouseId"
            label={issuing ? "From the store" : "Back into the store"}
            error={fieldError("warehouseId")}
          >
            <NativeSelect
              id="warehouseId"
              name="warehouseId"
              value={store}
              onChange={(e) => setStore(e.target.value)}
              containerClassName="sm:w-full"
            >
              {data.stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        <Field
          id="date"
          label={issuing ? "Handed over on" : "Came back on"}
          error={fieldError("date")}
        >
          <Input id="date" name="date" type="date" defaultValue={data.today} max={data.today} />
        </Field>
        <Field
          id="receivedBy"
          label={issuing ? "Taken by (optional)" : "Brought back by (optional)"}
          error={fieldError("receivedBy")}
        >
          <Input
            id="receivedBy"
            name="receivedBy"
            maxLength={120}
            autoComplete="off"
            placeholder="Line supervisor"
          />
        </Field>
      </div>

      <fieldset className="grid min-w-0 gap-4">
        <legend className="mb-1 font-serif text-lg text-primary">
          {issuing ? "Materials handed over" : "Materials coming back"}
        </legend>
        {fieldError("lines") && <FormAlert>{fieldError("lines")}</FormAlert>}
        {issuing ? (
          <>
            {lines.length > 0 && (
              <ul className="grid grid-cols-1 gap-4">
                {lines.map((line, index) => {
                  const err = fieldError(`lines.${index}.quantity`);
                  const unit = UNIT_LABELS[line.material.unit];
                  return (
                    <li
                      key={line.key}
                      className="grid min-w-0 gap-4 rounded-lg border bg-card p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)] sm:items-start sm:p-5"
                    >
                      <div className="flex min-w-0 items-start justify-between gap-3 sm:col-span-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium break-words">
                            {line.material.code} · {line.material.name}
                          </p>
                          <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
                            {quantity(inStore(line), line.material.unit, currency)} in this store
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setLines((all) => all.filter((l) => l.key !== line.key))}
                          aria-label={`Remove ${line.material.code}`}
                        >
                          <Trash2Icon aria-hidden />
                          Remove
                        </Button>
                      </div>
                      <Field
                        id={`${line.key}-quantity`}
                        label={`Handed over (${unit})`}
                        error={err}
                      >
                        <Input
                          id={`${line.key}-quantity`}
                          inputMode="decimal"
                          value={line.quantity}
                          onChange={(e) =>
                            setLines((all) =>
                              all.map((l) =>
                                l.key === line.key ? { ...l, quantity: e.target.value } : l,
                              ),
                            )
                          }
                          autoComplete="off"
                          aria-invalid={Boolean(err)}
                          aria-describedby={err ? `${line.key}-quantity-error` : undefined}
                        />
                      </Field>
                    </li>
                  );
                })}
              </ul>
            )}
            <MaterialPicker
              id="add-material"
              label={lines.length === 0 ? "Find a material to hand over" : "Add another material"}
              currency={currency}
              exclude={lines.map((l) => l.material.id)}
              invalid={Boolean(fieldError("lines"))}
              onPick={(m) =>
                setLines((all) => [
                  ...all,
                  {
                    key: newKey(),
                    material: { id: m.id, code: m.code, name: m.name, unit: m.unit },
                    stores: m.stores,
                    quantity: "",
                  },
                ])
              }
            />
          </>
        ) : !project ? (
          <p className="text-sm text-muted-foreground">
            Choose the project to see what it still holds.
          </p>
        ) : holdings?.error ? (
          <FormAlert>{holdings.error}</FormAlert>
        ) : !holdings ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
            Loading what the project holds
          </p>
        ) : holdings.items!.length === 0 ? (
          <FormAlert tone="note">
            {project.code} holds no materials from the store, so nothing can come back.
          </FormAlert>
        ) : (
          <>
            <p className="-mt-2 text-sm text-muted-foreground">
              Leave a line empty when nothing of it comes back.
            </p>
            <ul className="grid grid-cols-1 gap-4">
              {holdings.items!.map((h) => {
                const id = `back-${h.material.id}`;
                const err = fieldError(h.material.id);
                return (
                  <li
                    key={h.material.id}
                    className="grid min-w-0 gap-4 rounded-lg border bg-card p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)] sm:items-end sm:p-5"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium break-words">
                        {h.material.code} · {h.material.name}
                      </p>
                      <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
                        The project holds {quantity(h.holding, h.material.unit, currency)}
                      </p>
                    </div>
                    <Field
                      id={id}
                      label={`Coming back (${UNIT_LABELS[h.material.unit]})`}
                      error={err}
                    >
                      <Input
                        id={id}
                        inputMode="decimal"
                        value={amounts[h.material.id] ?? ""}
                        onChange={(e) =>
                          setAmounts((all) => ({ ...all, [h.material.id]: e.target.value }))
                        }
                        placeholder="0"
                        autoComplete="off"
                        aria-invalid={Boolean(err)}
                        aria-describedby={err ? `${id}-error` : undefined}
                      />
                    </Field>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </fieldset>

      <Field id="note" label="Note (optional)" error={fieldError("note")}>
        <Input id="note" name="note" maxLength={1000} autoComplete="off" />
      </Field>

      <FormFooter
        form={form}
        cancelHref={cancelHref}
        submitLabel={issuing ? "Issue the materials" : "Take them back"}
        errorTitle={
          issuing ? "We could not save the issue note" : "We could not save the return note"
        }
      />
    </form>
  );
}
