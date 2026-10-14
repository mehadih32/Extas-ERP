"use client";

import type { CollarStyle } from "@prisma/client";
import { PlusIcon, XIcon } from "lucide-react";

import { Field, FormAlert } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { cuffsFor } from "@/modules/production/booking-math";
import {
  COLLAR_EXTRA_BY_STYLE,
  COLLAR_STYLE_LABELS,
  COLLAR_STYLES,
} from "@/modules/production/booking-presets";

import {
  blankColour,
  type DraftCollar,
  type DraftLine,
  liveCollarTotals,
  newKey,
  piecesOf,
} from "./booking-draft";
import { Figure, StepHeading } from "./booking-form-bits";

type Problem = (name: string) => string | undefined;

const count = (n: number) => n.toLocaleString("en");

/** "42 × 9" from what was typed, or "–". */
const dims = (length: string, width: string) =>
  length.trim() && width.trim() ? `${length.trim()} × ${width.trim()}` : "–";

/**
 * The collar and cuff matrix for polos and the like: the collar style, the
 * size groups with their collar and cuff measurements (cm), and the garment
 * pieces of each colour in each size group. The sets to knit are worked out
 * as they are typed (the pieces plus the extra, rounded up), and the Collar and
 * Cuff items take their quantity from them.
 */
export function CollarStep({
  collar,
  lines,
  problem,
  onChange,
}: {
  collar: DraftCollar;
  lines: DraftLine[];
  problem: Problem;
  onChange: (next: DraftCollar) => void;
}) {
  const totals = liveCollarTotals(collar);
  const pieces = piecesOf(collar);
  const set = (next: Partial<DraftCollar>) => onChange({ ...collar, ...next });
  const cuffLine = lines.find((l) => l.role === "CUFF");
  const hasCuffSizes = collar.sizes.some((s) => s.cuffLength.trim() && s.cuffWidth.trim());
  const tipping = collar.style === "TIPPING";

  function setSize(i: number, next: Partial<DraftCollar["sizes"][number]>) {
    set({ sizes: collar.sizes.map((s, j) => (j === i ? { ...s, ...next } : s)) });
  }
  function setColour(i: number, next: Partial<DraftCollar["colours"][number]>) {
    set({ colours: collar.colours.map((c, j) => (j === i ? { ...c, ...next } : c)) });
  }
  function addSize() {
    const last = collar.sizes[collar.sizes.length - 1];
    set({
      sizes: [
        ...collar.sizes,
        {
          key: newKey("size"),
          label: "",
          // Each size group's collar is usually 2 cm longer than the one before.
          collarLength:
            last && Number(last.collarLength) > 0 ? String(Number(last.collarLength) + 2) : "",
          collarWidth: last?.collarWidth ?? "",
          cuffLength: last?.cuffLength ?? "",
          cuffWidth: last?.cuffWidth ?? "",
        },
      ],
      colours: collar.colours.map((c) => ({ ...c, pieces: [...c.pieces, ""] })),
    });
  }
  function removeSize(i: number) {
    set({
      sizes: collar.sizes.filter((_, j) => j !== i),
      colours: collar.colours.map((c) => ({ ...c, pieces: c.pieces.filter((_, j) => j !== i) })),
    });
  }

  return (
    <section aria-labelledby="step-collar-heading" className="grid min-w-0 gap-5">
      <StepHeading id="step-collar-heading" title="Collar & cuff">
        Flat-knit collars and cuffs are booked by size group and garment colour. Type the garment
        pieces; the sets to knit are worked out with the extra on top.
      </StepHeading>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border bg-card px-4 py-3">
        <Checkbox
          checked={collar.on}
          onCheckedChange={(v) => set({ on: v === true })}
          className="mt-0.5"
          aria-describedby="collar-on-hint"
        />
        <span className="grid gap-0.5">
          <span className="text-sm font-medium">Book collars and cuffs by size and colour</span>
          <span id="collar-on-hint" className="text-[0.8125rem] text-muted-foreground">
            {collar.on
              ? "The Collar and Cuff items take their quantity from this matrix."
              : "Off: collars and cuffs are booked by the quantity typed on the trims step."}
          </span>
        </span>
      </label>

      {collar.on && (
        <>
          {problem("collar") && <FormAlert>{problem("collar")}</FormAlert>}
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <Field id="collar-style" label="Collar style">
              <NativeSelect
                id="collar-style"
                containerClassName="sm:w-full"
                value={collar.style}
                onChange={(e) => {
                  const style = e.target.value as CollarStyle;
                  // The extra follows the style while it is still the old style's usual one.
                  const usual = Number(collar.extraPercent) === COLLAR_EXTRA_BY_STYLE[collar.style];
                  set(
                    usual
                      ? { style, extraPercent: String(COLLAR_EXTRA_BY_STYLE[style]) }
                      : { style },
                  );
                }}
              >
                {COLLAR_STYLES.map((s) => (
                  <option key={s} value={s}>
                    {COLLAR_STYLE_LABELS[s]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field
              id="collar-extra"
              label="Extra over the pieces (%)"
              hint="Usually 5 for solid and honeycomb, 7 for tipping, jacquard and stripes; never fewer than 5 collars and 10 cuffs over each colour and size"
              error={problem("collar.extraPercent")}
            >
              <Input
                id="collar-extra"
                inputMode="decimal"
                value={collar.extraPercent}
                onChange={(e) => set({ extraPercent: e.target.value })}
                autoComplete="off"
                aria-invalid={Boolean(problem("collar.extraPercent"))}
              />
            </Field>
          </div>

          <fieldset className="grid min-w-0 gap-3">
            <legend className="mb-1 text-sm font-medium">Size groups and measurements (cm)</legend>
            {problem("collar.sizes") && <FormAlert>{problem("collar.sizes")}</FormAlert>}
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Size groups">
              {collar.sizes.map((s, i) => {
                const at = (f: string) => problem(`collar.sizes.${i}.${f}`);
                const id = (f: string) => `size-${s.key}-${f}`;
                const pair = (
                  label: string,
                  lengthField: "collarLength" | "cuffLength",
                  widthField: "collarWidth" | "cuffWidth",
                ) => (
                  <div className="grid gap-1.5">
                    <span className="text-[0.8125rem] font-medium">{label}</span>
                    <div className="flex items-center gap-1.5">
                      <label htmlFor={id(lengthField)} className="sr-only">
                        {label} length (cm)
                      </label>
                      <Input
                        id={id(lengthField)}
                        inputMode="decimal"
                        value={s[lengthField]}
                        onChange={(e) => setSize(i, { [lengthField]: e.target.value })}
                        placeholder="L"
                        autoComplete="off"
                        aria-invalid={Boolean(at(lengthField))}
                        className="text-center"
                      />
                      <span className="text-muted-foreground" aria-hidden>
                        ×
                      </span>
                      <label htmlFor={id(widthField)} className="sr-only">
                        {label} width (cm)
                      </label>
                      <Input
                        id={id(widthField)}
                        inputMode="decimal"
                        value={s[widthField]}
                        onChange={(e) => setSize(i, { [widthField]: e.target.value })}
                        placeholder="W"
                        autoComplete="off"
                        aria-invalid={Boolean(at(widthField))}
                        className="text-center"
                      />
                    </div>
                    {(at(lengthField) || at(widthField)) && (
                      <p className="text-[0.8125rem] text-destructive">
                        {at(lengthField) ?? at(widthField)}
                      </p>
                    )}
                  </div>
                );
                return (
                  <li key={s.key} className="grid gap-3 rounded-lg border bg-card p-3">
                    <div className="flex items-start gap-2">
                      <Field
                        id={id("label")}
                        label="Size group"
                        error={at("label")}
                        className="flex-1"
                      >
                        <Input
                          id={id("label")}
                          value={s.label}
                          onChange={(e) => setSize(i, { label: e.target.value })}
                          placeholder="S-M"
                          autoComplete="off"
                          maxLength={20}
                          aria-invalid={Boolean(at("label"))}
                        />
                      </Field>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="mt-[1.625rem] shrink-0 text-muted-foreground"
                        onClick={() => removeSize(i)}
                        disabled={collar.sizes.length === 1}
                        aria-label={`Remove size group ${s.label || i + 1}`}
                      >
                        <XIcon aria-hidden />
                      </Button>
                    </div>
                    {pair("Collar", "collarLength", "collarWidth")}
                    {pair("Cuff (optional)", "cuffLength", "cuffWidth")}
                  </li>
                );
              })}
            </ul>
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto sm:justify-self-start"
              onClick={addSize}
              disabled={collar.sizes.length >= 12}
            >
              <PlusIcon aria-hidden />
              Add size group
            </Button>
          </fieldset>

          <fieldset className="grid min-w-0 gap-3">
            <legend className="mb-1 text-sm font-medium">Garment pieces by colour</legend>
            {problem("collar.colours") && <FormAlert>{problem("collar.colours")}</FormAlert>}
            <ul className="grid gap-3" aria-label="Garment colours">
              {collar.colours.map((c, i) => {
                const at = (f: string) => problem(`collar.colours.${i}.${f}`);
                const id = (f: string) => `colour-${c.key}-${f}`;
                const rowSets = totals.byColour[i] ?? 0;
                const rowPieces = (pieces[i] ?? []).reduce((t, n) => t + n, 0);
                return (
                  <li
                    key={c.key}
                    className="grid min-w-0 gap-3 rounded-lg border bg-card p-3 sm:p-4"
                  >
                    <div
                      className={cn(
                        "grid items-start gap-3",
                        tipping ? "sm:grid-cols-[1fr_1fr_1fr_auto]" : "sm:grid-cols-[1fr_1fr_auto]",
                      )}
                    >
                      <Field id={id("garment")} label="Garment colour" error={at("garmentColour")}>
                        <Input
                          id={id("garment")}
                          value={c.garmentColour}
                          onChange={(e) => setColour(i, { garmentColour: e.target.value })}
                          placeholder="Navy"
                          autoComplete="off"
                          maxLength={60}
                          aria-invalid={Boolean(at("garmentColour"))}
                        />
                      </Field>
                      <Field id={id("collar")} label="Collar colour">
                        <Input
                          id={id("collar")}
                          value={c.collarColour}
                          onChange={(e) => setColour(i, { collarColour: e.target.value })}
                          placeholder={c.garmentColour.trim() || "Same as the garment"}
                          autoComplete="off"
                          maxLength={60}
                        />
                      </Field>
                      {tipping && (
                        <Field id={id("tipping")} label="Tipping colour">
                          <Input
                            id={id("tipping")}
                            value={c.tippingColour}
                            onChange={(e) => setColour(i, { tippingColour: e.target.value })}
                            placeholder="White"
                            autoComplete="off"
                            maxLength={60}
                          />
                        </Field>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="justify-self-start text-muted-foreground sm:mt-[1.625rem]"
                        onClick={() => set({ colours: collar.colours.filter((_, j) => j !== i) })}
                        disabled={collar.colours.length === 1}
                        aria-label={`Remove colour ${c.garmentColour || i + 1}`}
                      >
                        <XIcon aria-hidden />
                        Remove
                      </Button>
                    </div>
                    <div
                      className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6"
                      role="group"
                      aria-label={`Pieces of ${c.garmentColour || `colour ${i + 1}`} by size group`}
                    >
                      {collar.sizes.map((s, j) => {
                        const err = at(`pieces.${j}`);
                        return (
                          <div key={s.key} className="grid min-w-0 gap-1">
                            <label
                              htmlFor={id(`p${j}`)}
                              className="truncate text-[0.8125rem] font-medium"
                            >
                              {s.label || `Group ${j + 1}`}
                            </label>
                            <Input
                              id={id(`p${j}`)}
                              inputMode="numeric"
                              value={c.pieces[j] ?? ""}
                              onChange={(e) =>
                                setColour(i, {
                                  pieces: collar.sizes.map((_, k) =>
                                    k === j ? e.target.value : (c.pieces[k] ?? ""),
                                  ),
                                })
                              }
                              placeholder="0"
                              autoComplete="off"
                              aria-invalid={Boolean(err)}
                              className="text-right tabular-nums"
                            />
                            <span className="text-[0.75rem] text-muted-foreground tabular-nums">
                              {count(totals.sets[i]?.[j] ?? 0)} sets
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
                      {count(rowPieces)} pieces →{" "}
                      <strong className="text-foreground">{count(rowSets)} sets</strong>
                    </p>
                  </li>
                );
              })}
            </ul>
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto sm:justify-self-start"
              onClick={() =>
                set({ colours: [...collar.colours, blankColour(collar.sizes.length)] })
              }
              disabled={collar.colours.length >= 40}
            >
              <PlusIcon aria-hidden />
              Add colour
            </Button>
          </fieldset>

          <div className="grid gap-3" aria-live="polite">
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Figure label="Garment pieces" value={count(totals.totalPieces)} />
              <Figure label="Collar sets to knit" value={count(totals.totalSets)} strong />
              <Figure
                label={cuffLine?.unit === "SET" ? "Cuff pairs" : "Cuffs (2 a set)"}
                value={count(cuffsFor(totals.totalSets, cuffLine?.unit ?? "PCS"))}
              />
              <Figure label="Extra" value={`${collar.extraPercent || 0}%`} />
            </dl>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <caption className="sr-only">Sets by size group</caption>
                <thead className="bg-muted/50 text-[0.8125rem] text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-2 py-2 text-left font-medium sm:px-3">
                      Size group
                    </th>
                    <th scope="col" className="px-2 py-2 text-left font-medium sm:px-3">
                      {hasCuffSizes ? "Collar · cuff (cm)" : "Collar (cm)"}
                    </th>
                    <th scope="col" className="px-2 py-2 text-right font-medium sm:px-3">
                      Pieces
                    </th>
                    <th scope="col" className="px-2 py-2 text-right font-medium sm:px-3">
                      Sets
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y tabular-nums">
                  {collar.sizes.map((s, j) => (
                    <tr key={s.key}>
                      <th scope="row" className="px-2 py-2 text-left font-medium sm:px-3">
                        {s.label || `Group ${j + 1}`}
                      </th>
                      <td className="px-2 py-2 sm:px-3">
                        {dims(s.collarLength, s.collarWidth)}
                        {hasCuffSizes && (
                          <span className="block text-[0.8125rem] text-muted-foreground">
                            cuff {dims(s.cuffLength, s.cuffWidth)}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right sm:px-3">
                        {count(totals.piecesBySize[j] ?? 0)}
                      </td>
                      <td className="px-2 py-2 text-right font-medium sm:px-3">
                        {count(totals.bySize[j] ?? 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t bg-muted/30 tabular-nums">
                  <tr>
                    <th scope="row" colSpan={2} className="px-2 py-2 text-left sm:px-3">
                      Total
                    </th>
                    <td className="px-2 py-2 text-right sm:px-3">{count(totals.totalPieces)}</td>
                    <td className="px-2 py-2 text-right font-semibold text-primary sm:px-3">
                      {count(totals.totalSets)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <Field id="collar-notes" label="Collar & cuff notes (optional)">
            <Textarea
              id="collar-notes"
              value={collar.notes}
              onChange={(e) => set({ notes: e.target.value })}
              placeholder={
                tipping ? "2 tipping lines of 0.5 cm, 1 cm from the edge" : "Match the body shade"
              }
              maxLength={1000}
              className="min-h-20"
            />
          </Field>
        </>
      )}
    </section>
  );
}
