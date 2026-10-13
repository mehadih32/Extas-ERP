"use client";

import { WandSparklesIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { FormFooter, usePageForm } from "@/components/accounts/form-bits";
import { Field, FormAlert } from "@/components/forms/field";
import { readQuantity, UNIT_LABELS } from "@/components/materials/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatCount } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { CuttingScreen } from "@/modules/production/cutting.service";
import {
  createCuttingReportAction,
  readCuttingPhotoAction,
  uploadProductionFileAction,
} from "@/server/actions/production.actions";

import { readPieces, remapLines } from "./cutting";
import { cellName } from "./cutting-summary";
import { productionHref } from "./labels";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

type AiRead = {
  filled: number;
  confidence: number;
  notes: string | null;
  unmatched: Array<{ color: string | null; size: string | null; quantity: number }>;
};

/**
 * A day's cutting report: pieces cut by colour and size, typed in or read by AI
 * from a photo of the cutting sheet (then checked), with the fabric used, which
 * gives pieces a kg against the tech pack. Saving checks it at once and alerts
 * Production and the store when something runs short.
 */
export function CuttingReportForm({
  screen,
  currency,
}: {
  screen: CuttingScreen;
  currency: string;
}) {
  const router = useRouter();
  const form = usePageForm();
  const { fieldError } = form;
  const { cells, project: p } = screen;
  const [cutOn, setCutOn] = useState(screen.today);
  const [values, setValues] = useState<string[]>(() => cells.map(() => ""));
  const [fabric, setFabric] = useState<string[]>(() => screen.fabrics.map(() => ""));
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [photo, setPhoto] = useState<{ id: string } | null>(null);
  const [ai, setAi] = useState<AiRead | null>(null);
  const [aiProblem, setAiProblem] = useState<string>();
  const [reading, startReading] = useTransition();

  const typed = values.reduce((t, v) => t + (readPieces(v) ?? 0), 0);
  const cutBefore = cells.reduce((t, c) => t + c.cut - c.spoiled, 0);
  const colours = [...new Set(cells.map((c) => c.colorName))];

  /** The photo uploaded once, however often it is read or saved. */
  async function uploaded(): Promise<{ id: string } | string> {
    if (photo) return photo;
    if (!file) return "Choose the photo first.";
    if (file.size > MAX_FILE_BYTES) return "Files can be up to 10 MB.";
    const upload = new FormData();
    upload.set("file", file);
    const stored = await uploadProductionFileAction(upload);
    if (!stored.ok) return stored.error.message;
    setPhoto(stored.data);
    return stored.data;
  }

  function readWithAi() {
    setAiProblem(undefined);
    startReading(async () => {
      const stored = await uploaded();
      if (typeof stored === "string") return setAiProblem(stored);
      const result = await readCuttingPhotoAction(p.id, stored.id);
      if (!result.ok) return setAiProblem(result.error.message);
      const next = cells.map(() => "");
      for (const line of result.data.lines) {
        const i = cells.findIndex(
          (c) => c.colorName === line.colorName && c.sizeName === line.sizeName,
        );
        if (i >= 0) next[i] = String(line.quantity);
      }
      setValues(next);
      setAi({
        filled: result.data.lines.length,
        confidence: result.data.confidence,
        notes: result.data.notes,
        unmatched: result.data.unmatched,
      });
    });
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found: Record<string, string> = {};
    const lines: Array<{ colorName: string | null; sizeName: string | null; quantity: number }> =
      [];
    const sent: number[] = [];
    cells.forEach((c, i) => {
      const n = readPieces(values[i]!);
      if (n === null) found[`cell.${i}`] = "Whole pieces only.";
      else if (n > 0) {
        lines.push({ colorName: c.colorName, sizeName: c.sizeName, quantity: n });
        sent.push(i);
      }
    });
    if (lines.length === 0 && Object.keys(found).length === 0) {
      found.lines = "Enter the pieces cut in at least one colour and size.";
    }
    const fabricUsed: Array<{ materialId: string; quantity: number }> = [];
    screen.fabrics.forEach((f, i) => {
      if (!fabric[i]!.trim()) return;
      const q = readQuantity(fabric[i]!, f.unit);
      if (typeof q === "string") found[`fabric.${i}`] = q;
      else fabricUsed.push({ materialId: f.id, quantity: q });
    });
    if (cutOn > screen.today) found.cutOn = "Choose today or an earlier day.";
    if (file && file.size > MAX_FILE_BYTES) found.file = "Files can be up to 10 MB.";
    form.setProblems(found);
    form.setError(undefined);
    if (Object.keys(found).length > 0) return;
    form.startTransition(async () => {
      let photoId: string | null = null;
      if (file || photo) {
        const stored = await uploaded();
        if (typeof stored === "string") return form.setProblems({ file: stored });
        photoId = stored.id;
      }
      const result = await createCuttingReportAction(p.id, {
        cutOn,
        lines,
        fabricUsed,
        photoId,
        readByAi: ai !== null,
        note: note.trim() || null,
      });
      if (!result.ok) return form.setError(remapLines(result.error, sent, "cell"));
      const r = result.data;
      router.push(
        `${productionHref.cutting(p.id)}?saved=${encodeURIComponent(r.number)}&pieces=${r.pieces}&short=${r.shortages}`,
      );
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-6" noValidate>
      <section
        aria-labelledby="photo-heading"
        className="grid gap-3 rounded-lg border bg-card p-4 sm:p-5"
      >
        <h3 id="photo-heading" className="font-serif text-lg text-primary">
          Photo of the cutting sheet
        </h3>
        <Field
          id="file"
          label="Photo or PDF (optional)"
          hint="Kept with the report. Up to 10 MB."
          error={fieldError("file")}
        >
          <Input
            id="file"
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPhoto(null);
              setAi(null);
            }}
            className="h-auto py-1.5 file:mr-3"
            aria-invalid={Boolean(fieldError("file"))}
          />
        </Field>
        {screen.can.readAi ? (
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={readWithAi}
              disabled={reading || !file}
            >
              <WandSparklesIcon aria-hidden />
              {reading ? "Reading" : "Read with AI"}
            </Button>
          </div>
        ) : (
          <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
            AI reading is not set up yet, so type the pieces in below. The photo is still kept with
            the report.
          </p>
        )}
        {aiProblem && <FormAlert tone="note">{aiProblem}</FormAlert>}
        {ai && (
          <FormAlert tone="success">
            Read {ai.filled} {ai.filled === 1 ? "colour and size" : "colours and sizes"},{" "}
            {ai.confidence}% sure. Check each box against the sheet before saving.
            {ai.notes && ` ${ai.notes}`}
            {ai.unmatched.length > 0 &&
              ` Not on this style: ${ai.unmatched
                .map((u) => `${[u.color, u.size].filter(Boolean).join(" ")} ${u.quantity}`)
                .join(", ")}.`}
          </FormAlert>
        )}
      </section>

      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field id="cutOn" label="Cut on" error={fieldError("cutOn")}>
          <Input
            id="cutOn"
            type="date"
            max={screen.today}
            value={cutOn}
            onChange={(e) => setCutOn(e.target.value)}
          />
        </Field>
      </div>

      {colours.map((colour) => (
        <fieldset key={colour ?? "all"} className="grid gap-3 rounded-lg border bg-card p-4 sm:p-5">
          <legend className="px-1 text-sm font-medium">{colour ?? "Pieces cut"}</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {cells.map((c, i) =>
              c.colorName !== colour ? null : (
                <Field
                  key={i}
                  id={`cell-${i}`}
                  label={c.sizeName ?? cellName(c)}
                  hint={`${formatCount(c.cut - c.spoiled, currency)} of ${formatCount(c.target, currency)} cut`}
                  error={fieldError(`cell.${i}`)}
                >
                  <Input
                    id={`cell-${i}`}
                    inputMode="numeric"
                    autoComplete="off"
                    aria-label={`${cellName(c)} pieces cut`}
                    value={values[i]}
                    onChange={(e) =>
                      setValues((all) => all.map((v, j) => (j === i ? e.target.value : v)))
                    }
                    aria-invalid={Boolean(fieldError(`cell.${i}`))}
                    className={cn(ai && values[i] && "border-primary/40 bg-secondary/40")}
                  />
                </Field>
              ),
            )}
          </div>
        </fieldset>
      ))}
      {fieldError("lines") && <FormAlert>{fieldError("lines")}</FormAlert>}
      <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
        Cutting {formatCount(typed, currency)} pieces now:{" "}
        {formatCount(cutBefore + typed, currency)} of {formatCount(p.target, currency)} cut with
        this report.
      </p>

      {screen.fabrics.length > 0 && (
        <fieldset className="grid gap-3">
          <legend className="mb-1 text-sm font-medium">Fabric used (optional)</legend>
          <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
            The fabric these pieces took. It shows pieces a kg against the tech pack and whether
            what is left covers the rest.
          </p>
          <div className="grid items-start gap-3 sm:grid-cols-2">
            {screen.fabrics.map((f, i) => (
              <Field
                key={f.id}
                id={`fabric-${i}`}
                label={`${f.code} · ${f.name} (${UNIT_LABELS[f.unit]})`}
                error={
                  fieldError(`fabric.${i}`) ?? (i === 0 ? fieldError("fabricUsed") : undefined)
                }
              >
                <Input
                  id={`fabric-${i}`}
                  inputMode="decimal"
                  autoComplete="off"
                  value={fabric[i]}
                  onChange={(e) =>
                    setFabric((all) => all.map((v, j) => (j === i ? e.target.value : v)))
                  }
                />
              </Field>
            ))}
          </div>
        </fieldset>
      )}

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
        cancelHref={productionHref.cutting(p.id)}
        submitLabel="Save the cutting report"
        pendingLabel="Saving"
        errorTitle="We could not save the cutting report"
      />
    </form>
  );
}
