"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { FormFooter, usePageForm } from "@/components/accounts/form-bits";
import { Field, FormAlert } from "@/components/forms/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatCount } from "@/lib/display";
import type { FinishingScreen } from "@/modules/production/finishing.service";
import {
  createFinishingCountAction,
  uploadProductionFileAction,
} from "@/server/actions/production.actions";

import { readPieces } from "./cutting";
import { cellName } from "./cutting-summary";
import { GradeHead, remapGradeLines } from "./finishing";
import { productionHref } from "./labels";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

const GRADES = [
  { key: "a", label: "A-grade" },
  { key: "b", label: "B-grade" },
  { key: "c", label: "C (mending)" },
  { key: "reject", label: "Reject" },
] as const;
type Grade = (typeof GRADES)[number]["key"];
type Counts = Record<Grade, string>;
const EMPTY: Counts = { a: "", b: "", c: "", reject: "" };

/**
 * A finishing count: pieces graded A, B or C (to mending) with rejects (sewing
 * faults) apart, by colour and size, never more than was cut and is back from
 * embroidery, with a photo of the QC sheet.
 */
export function FinishingCountForm({
  screen,
  currency,
}: {
  screen: FinishingScreen;
  currency: string;
}) {
  const router = useRouter();
  const form = usePageForm();
  const { fieldError } = form;
  const { cells, project: p } = screen;
  const [countedOn, setCountedOn] = useState(screen.today);
  const [values, setValues] = useState<Counts[]>(() => cells.map(() => ({ ...EMPTY })));
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");

  const typed = (grade: Grade) => values.reduce((t, v) => t + (readPieces(v[grade]) ?? 0), 0);
  const all = GRADES.reduce((t, g) => t + typed(g.key), 0);
  const colours = [...new Set(cells.map((c) => c.colorName))];
  const set = (i: number, grade: Grade, text: string) =>
    setValues((rows) => rows.map((row, j) => (j === i ? { ...row, [grade]: text } : row)));

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found: Record<string, string> = {};
    const lines: Array<{
      colorName: string | null;
      sizeName: string | null;
      a: number;
      b: number;
      c: number;
      reject: number;
    }> = [];
    const sent: number[] = [];
    cells.forEach((c, i) => {
      const n = Object.fromEntries(
        GRADES.map((g) => [g.key, readPieces(values[i]![g.key])]),
      ) as Record<Grade, number | null>;
      if (GRADES.some((g) => n[g.key] === null)) {
        found[`cell.${i}`] = "Whole pieces only.";
        return;
      }
      const total = GRADES.reduce((t, g) => t + n[g.key]!, 0);
      if (c.free !== null && total > c.free) {
        found[`cell.${i}`] = `No more than ${Math.max(c.free, 0)} in all.`;
      } else if (total > 0) {
        lines.push({
          colorName: c.colorName,
          sizeName: c.sizeName,
          a: n.a!,
          b: n.b!,
          c: n.c!,
          reject: n.reject!,
        });
        sent.push(i);
      }
    });
    if (lines.length === 0 && Object.keys(found).length === 0) {
      found.lines = "Enter the pieces of at least one colour and size.";
    }
    if (countedOn > screen.today) found.countedOn = "Choose today or an earlier day.";
    if (file && file.size > MAX_FILE_BYTES) found.file = "Files can be up to 10 MB.";
    form.setProblems(found);
    form.setError(undefined);
    if (Object.keys(found).length > 0) return;
    form.startTransition(async () => {
      let fileId: string | null = null;
      if (file) {
        const upload = new FormData();
        upload.set("file", file);
        const stored = await uploadProductionFileAction(upload);
        if (!stored.ok) return form.setProblems({ file: stored.error.message });
        fileId = stored.data.id;
      }
      const result = await createFinishingCountAction(p.id, {
        countedOn,
        lines,
        fileId,
        note: note.trim() || null,
      });
      if (!result.ok) return form.setError(remapGradeLines(result.error, sent, "cell"));
      const r = result.data;
      router.push(
        `${productionHref.finishing(p.id)}?counted=${encodeURIComponent(r.number)}&a=${r.a}&b=${r.b}&c=${r.c}&reject=${r.reject}`,
      );
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-6" noValidate>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field id="countedOn" label="Counted on" error={fieldError("countedOn")}>
          <Input
            id="countedOn"
            type="date"
            max={screen.today}
            value={countedOn}
            onChange={(e) => setCountedOn(e.target.value)}
          />
        </Field>
        <Field
          id="file"
          label="Photo of the QC sheet (optional)"
          hint="Kept with the count. Up to 10 MB."
          error={fieldError("file")}
        >
          <Input
            id="file"
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="h-auto py-1.5 file:mr-3"
          />
        </Field>
      </div>

      <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
        A-grade and B-grade pieces go to stock with the full packing list. C-grade pieces go to
        mending first. A reject is a sewing fault that cannot be fixed; missing pieces (lost or
        stolen) are given on the packing list, not here.
      </p>

      {colours.map((colour) => (
        <fieldset key={colour ?? "all"} className="grid gap-3 rounded-lg border bg-card p-4 sm:p-5">
          <legend className="px-1 text-sm font-medium">{colour ?? "Pieces counted"}</legend>
          <GradeHead grades={GRADES} />
          {cells.map((c, i) => {
            if (c.colorName !== colour) return null;
            const error = fieldError(`cell.${i}`);
            return (
              <div key={i} className="grid gap-1.5">
                <div className="grid grid-cols-[minmax(3.5rem,1fr)_repeat(4,minmax(0,1.2fr))] items-end gap-2">
                  <p className="pb-2 text-sm font-medium">{c.sizeName ?? cellName(c)}</p>
                  {GRADES.map((g) => (
                    <Input
                      key={g.key}
                      id={`cell-${i}-${g.key}`}
                      inputMode="numeric"
                      autoComplete="off"
                      aria-label={`${cellName(c)} ${g.label}`}
                      aria-invalid={Boolean(error)}
                      value={values[i]![g.key]}
                      onChange={(e) => set(i, g.key, e.target.value)}
                      className="h-9"
                    />
                  ))}
                </div>
                <p
                  className={
                    error
                      ? "text-[0.75rem] text-destructive"
                      : "text-[0.75rem] text-muted-foreground"
                  }
                >
                  {error ??
                    (c.free === null
                      ? `${formatCount(c.a + c.b + c.c + c.reject, currency)} counted so far`
                      : `${formatCount(Math.max(c.free, 0), currency)} still to count (${formatCount(c.cut ?? 0, currency)} cut)`)}
                </p>
              </div>
            );
          })}
        </fieldset>
      ))}
      {fieldError("lines") && <FormAlert>{fieldError("lines")}</FormAlert>}
      <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
        Counting {formatCount(all, currency)} pieces now: A {formatCount(typed("a"), currency)} · B{" "}
        {formatCount(typed("b"), currency)} · C {formatCount(typed("c"), currency)} · reject{" "}
        {formatCount(typed("reject"), currency)}.
      </p>

      <Field id="note" label="Notes (optional)">
        <Textarea
          id="note"
          rows={3}
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>

      <FormFooter
        form={form}
        cancelHref={productionHref.finishing(p.id)}
        submitLabel="Save the finishing count"
        pendingLabel="Saving"
        errorTitle="We could not save the finishing count"
      />
    </form>
  );
}
