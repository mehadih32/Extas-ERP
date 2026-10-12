"use client";

import type { MaterialSplit, MeasurementUnit } from "@prisma/client";
import { ArrowUpIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { FormFooter, usePageForm } from "@/components/accounts/form-bits";
import { Field, FormAlert } from "@/components/forms/field";
import { KIND_LABELS, UNIT_LABELS, UNIT_ONE, WHOLE_UNITS } from "@/components/materials/labels";
import { MaterialPicker } from "@/components/materials/pickers";
import { type ItemPicture, PictureField } from "@/components/sales/reference-picture";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { NeedsForm } from "@/modules/production/material-screens.service";
import {
  draftTechPackNotesAction,
  setMaterialNeedsAction,
  setTechPackNotesAction,
  uploadMaterialImageAction,
} from "@/server/actions/production.actions";

import { PLACEMENT_SUGGESTIONS, productionHref, SPLIT_HINTS, SPLIT_LABELS } from "./labels";

type Row = {
  key: string;
  material: { id: string; code: string; name: string; kind: string; unit: MeasurementUnit };
  perPiece: string;
  wastagePercent: string;
  split: MaterialSplit;
  placement: string;
  picture: ItemPicture | null;
  notes: string;
};

// Rows added in the browser get keys from this counter; the first ones are keyed
// by position, so the server and the browser agree.
let nextKey = 0;
const newKey = () => `need-${++nextKey}`;

const SPLITS: MaterialSplit[] = ["TOTAL", "COLOUR", "COLOUR_SIZE"];

/** A number with at most `places` decimals, or what is wrong with the text. */
function readNumber(text: string, places: number, max: number, what: string): number | string {
  const value = text.trim().replace(/,/g, "");
  if (!value) return `Enter ${what}.`;
  if (!new RegExp(`^\\d+(\\.\\d{1,${places}})?$`).test(value)) {
    return `Enter a number like 0.25 (up to ${places} decimals).`;
  }
  const n = Number(value);
  if (n > max) return "That is too much.";
  return n;
}

/** What the pieces need with the wastage, rounded up as it would be ordered. */
function neededFor(row: Row, pieces: number): string | null {
  const per = readNumber(row.perPiece, 4, 100_000, "");
  const waste = row.wastagePercent.trim() ? readNumber(row.wastagePercent, 2, 100, "") : 0;
  if (typeof per !== "number" || typeof waste !== "number" || pieces <= 0) return null;
  const raw = (per * pieces * (100 + waste)) / 100;
  const whole = WHOLE_UNITS.includes(row.material.unit);
  const rounded = whole ? Math.ceil(raw - 1e-9) : Math.ceil(raw * 1000 - 1e-6) / 1000;
  return `${rounded.toLocaleString("en-US", { maximumFractionDigits: 3 })} ${UNIT_LABELS[row.material.unit]}`;
}

/**
 * A style's "Materials per piece" (Production Managers): what one piece takes of
 * each fabric, trim and accessory, the wastage on top, how it is ordered (one
 * total, by colour, or by colour and size for collars and cuffs), where it goes
 * and a picture for the supplier and the factory; and the tech pack's making
 * notes, which "Write with AI" drafts from the saved materials.
 */
export function MaterialNeedsForm({ form: data, currency }: { form: NeedsForm; currency: string }) {
  const router = useRouter();
  const form = usePageForm();
  const { fieldError } = form;
  const p = data.project;
  const [rows, setRows] = useState<Row[]>(
    data.needs.map((n, i) => ({
      key: `need-start-${i}`,
      material: n.material,
      perPiece: n.perPiece,
      wastagePercent: n.wastagePercent,
      split: n.split,
      placement: n.placement,
      picture: n.imageId ? { id: n.imageId } : null,
      notes: n.notes,
    })),
  );
  const [notes, setNotes] = useState(data.techPackNotes);
  const [drafted, setDrafted] = useState<string>();
  const [drafting, startDraft] = useTransition();
  const [uploads, setUploads] = useState(0);
  const hasGrid = data.colours.length > 0;

  function change(key: string, next: Partial<Row>) {
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...next } : r)));
  }

  function moveUp(index: number) {
    if (index === 0) return;
    setRows((all) => {
      const next = [...all];
      [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
      return next;
    });
  }

  function draft() {
    setDrafted(undefined);
    startDraft(async () => {
      const result = await draftTechPackNotesAction(p.id);
      if (!result.ok) {
        setDrafted(result.error.message);
        return;
      }
      setNotes(result.data.text);
      setDrafted(
        result.data.byAi
          ? "Drafted by AI from the saved materials. Read it and change what is not right."
          : "Drafted from the saved materials. Change it as you like.",
      );
    });
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found: Record<string, string> = {};
    const needs = rows.map((r, i) => {
      const per = readNumber(r.perPiece, 4, 100_000, "how much one piece takes");
      const waste = r.wastagePercent.trim()
        ? readNumber(r.wastagePercent, 2, 100, "the wastage")
        : 0;
      if (typeof per === "string") found[`needs.${i}.perPiece`] = per;
      else if (per <= 0) found[`needs.${i}.perPiece`] = "Must be more than zero.";
      if (typeof waste === "string") found[`needs.${i}.wastagePercent`] = waste;
      return {
        materialId: r.material.id,
        perPiece: typeof per === "number" ? per : 0,
        wastagePercent: typeof waste === "number" ? waste : 0,
        split: r.split,
        placement: r.placement.trim() || null,
        imageId: r.picture?.id ?? null,
        notes: r.notes.trim() || null,
      };
    });
    if (uploads > 0) found.needs = "Wait for the pictures to finish sending.";
    form.setProblems(found);
    form.setError(undefined);
    if (Object.keys(found).length > 0) return;
    form.startTransition(async () => {
      const saved = await setMaterialNeedsAction(p.id, { needs });
      if (!saved.ok) return form.setError(saved.error);
      if (notes.trim() !== data.techPackNotes.trim()) {
        const kept = await setTechPackNotesAction(p.id, { notes: notes.trim() || null });
        if (!kept.ok) return form.setError(kept.error);
      }
      router.push(`${productionHref.project(p.id)}?saved=1`);
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-6" noValidate>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {p.targetQuantity.toLocaleString("en-US")} pieces
        {hasGrid
          ? ` in ${data.colours.join(", ")}; sizes ${data.sizes.join(", ")}.`
          : ". Without colours and sizes on the project, every material is worked out as one total."}{" "}
        What to order is worked out from these pieces, with the wastage on top and rounded up.
      </p>

      <datalist id="placements">
        {PLACEMENT_SUGGESTIONS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      <fieldset className="grid min-w-0 gap-4">
        <legend className="mb-1 font-serif text-lg text-primary">Materials per piece</legend>
        {fieldError("needs") && <FormAlert>{fieldError("needs")}</FormAlert>}
        {rows.length > 0 && (
          <ul className="grid grid-cols-1 gap-4" aria-label="Materials per piece">
            {rows.map((row, index) => {
              const err = (name: string) => fieldError(`needs.${index}.${name}`);
              const unit = UNIT_LABELS[row.material.unit];
              const needed = neededFor(row, p.targetQuantity);
              return (
                <li
                  key={row.key}
                  className="grid min-w-0 gap-4 rounded-lg border bg-card p-4 sm:p-5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium break-words">
                        {row.material.code} · {row.material.name}
                      </p>
                      <p className="text-[0.8125rem] text-muted-foreground">
                        {KIND_LABELS[row.material.kind as keyof typeof KIND_LABELS]} · in {unit}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {index > 0 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => moveUp(index)}
                          aria-label={`Move ${row.material.code} up`}
                        >
                          <ArrowUpIcon aria-hidden />
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setRows((all) => all.filter((r) => r.key !== row.key))}
                        aria-label={`Remove ${row.material.code}`}
                      >
                        <Trash2Icon aria-hidden />
                        Remove
                      </Button>
                    </div>
                  </div>
                  <div className="grid items-start gap-4 sm:grid-cols-3">
                    <Field
                      id={`${row.key}-per`}
                      label={`Per piece (${unit})`}
                      error={err("perPiece")}
                    >
                      <Input
                        id={`${row.key}-per`}
                        inputMode="decimal"
                        value={row.perPiece}
                        onChange={(e) => change(row.key, { perPiece: e.target.value })}
                        autoComplete="off"
                        placeholder={WHOLE_UNITS.includes(row.material.unit) ? "1" : "0.25"}
                        aria-invalid={Boolean(err("perPiece"))}
                        aria-describedby={err("perPiece") ? `${row.key}-per-error` : undefined}
                      />
                    </Field>
                    <Field
                      id={`${row.key}-waste`}
                      label="Wastage (%)"
                      error={err("wastagePercent")}
                    >
                      <Input
                        id={`${row.key}-waste`}
                        inputMode="decimal"
                        value={row.wastagePercent}
                        onChange={(e) => change(row.key, { wastagePercent: e.target.value })}
                        autoComplete="off"
                        placeholder="0"
                        aria-invalid={Boolean(err("wastagePercent"))}
                        aria-describedby={
                          err("wastagePercent") ? `${row.key}-waste-error` : undefined
                        }
                      />
                    </Field>
                    <div className="grid gap-2">
                      <span className="text-sm font-medium">For all pieces</span>
                      <span className="flex h-9 items-center text-sm font-medium tabular-nums">
                        {needed ?? "–"}
                      </span>
                    </div>
                  </div>
                  <div className="grid items-start gap-4 sm:grid-cols-2">
                    <Field
                      id={`${row.key}-split`}
                      label="How it is ordered"
                      hint={SPLIT_HINTS[row.split]}
                    >
                      <NativeSelect
                        id={`${row.key}-split`}
                        containerClassName="sm:w-full"
                        value={row.split}
                        onChange={(e) =>
                          change(row.key, { split: e.target.value as MaterialSplit })
                        }
                        aria-describedby={`${row.key}-split-hint`}
                      >
                        {SPLITS.map((s) => (
                          <option key={s} value={s}>
                            {SPLIT_LABELS[s]}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field id={`${row.key}-placement`} label="Where it goes (optional)">
                      <Input
                        id={`${row.key}-placement`}
                        list="placements"
                        value={row.placement}
                        onChange={(e) => change(row.key, { placement: e.target.value })}
                        maxLength={80}
                        autoComplete="off"
                        placeholder="Main body, Collar, Main label"
                      />
                    </Field>
                  </div>
                  <PictureField
                    label="Picture (optional)"
                    value={row.picture}
                    onChange={(picture) => change(row.key, { picture })}
                    onBusy={(busy) => setUploads((n) => n + (busy ? 1 : -1))}
                    upload={uploadMaterialImageAction}
                  />
                  <Field id={`${row.key}-notes`} label="Notes for the factory (optional)">
                    <Input
                      id={`${row.key}-notes`}
                      value={row.notes}
                      onChange={(e) => change(row.key, { notes: e.target.value })}
                      maxLength={500}
                      autoComplete="off"
                      placeholder={`Like: 2 per ${UNIT_ONE.PCS}, 1 spare in the poly bag`}
                    />
                  </Field>
                </li>
              );
            })}
          </ul>
        )}
        <MaterialPicker
          id="add-need"
          label={rows.length === 0 ? "Find the first material" : "Add another material"}
          currency={currency}
          onPick={(m) =>
            setRows((all) => [
              ...all,
              {
                key: newKey(),
                material: { id: m.id, code: m.code, name: m.name, kind: m.kind, unit: m.unit },
                perPiece: "",
                wastagePercent: m.kind === "FABRIC" ? "5" : "",
                split: m.kind === "FABRIC" && hasGrid ? "COLOUR" : "TOTAL",
                placement: m.kind === "FABRIC" ? "Main body" : "",
                picture: null,
                notes: "",
              },
            ])
          }
        />
      </fieldset>

      <fieldset className="grid min-w-0 gap-3">
        <legend className="mb-1 font-serif text-lg text-primary">Tech pack notes</legend>
        <p className="text-sm text-muted-foreground">
          Printed on the tech pack for the factory: stitching, matching, checks and packing.
        </p>
        <Field id="techPackNotes" label="Making notes (optional)">
          <Textarea
            id="techPackNotes"
            rows={8}
            maxLength={4000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={draft}
            disabled={drafting || data.needs.length === 0}
          >
            <SparklesIcon aria-hidden />
            {drafting ? "Writing" : data.aiOn ? "Write with AI" : "Draft from the materials"}
          </Button>
          {data.needs.length === 0 && (
            <span className="text-[0.8125rem] text-muted-foreground">
              Save the materials first, then draft the notes from them.
            </span>
          )}
        </div>
        {drafted && <p className="text-[0.8125rem] text-muted-foreground">{drafted}</p>}
      </fieldset>

      <FormFooter
        form={form}
        cancelHref={productionHref.project(p.id)}
        submitLabel="Save the materials"
        errorTitle="We could not save the materials"
      />
    </form>
  );
}
