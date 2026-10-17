"use client";

import type { BookingSource, GarmentCategory } from "@prisma/client";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, LoaderCircleIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { ErrorDialog } from "@/components/feedback/error-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { UNIT_LABELS } from "@/components/materials/labels";
import { SupplierPicker } from "@/components/materials/pickers";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDay } from "@/lib/display";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import { specsText } from "@/modules/production/booking-math";
import {
  BOOKING_SOURCES,
  CATEGORY_HINTS,
  CATEGORY_LABELS,
  CATEGORY_PRESETS,
  COLLAR_STYLE_LABELS,
  GARMENT_CATEGORIES,
  ROLE_LABELS,
  SOURCE_HINTS,
  SOURCE_LABELS,
} from "@/modules/production/booking-presets";
import type { BookingForm } from "@/modules/production/booking.service";
import { createBookingAction, updateBookingAction } from "@/server/actions/booking.actions";

import {
  buildInput,
  type Draft,
  itemsFor,
  lineQuantity,
  liveCollarTotals,
  quantityLabel,
  receivesNow,
  standardTermList,
  startDraft,
  type Step,
  STEP_LABELS,
  stepOf,
  stepsFor,
  untouchedItems,
} from "./booking-draft";
import { ChoiceCards, Figure, StepHeading } from "./booking-form-bits";
import { ItemsStep } from "./booking-items";
import { TermsEditor } from "./booking-terms-editor";
import { CollarStep } from "./collar-matrix";
import { productionHref } from "./labels";

const PAYMENT_TERMS = [
  "Cash on delivery",
  "30 days after delivery",
  "45 days after delivery",
  "50% advance, 50% on delivery",
  "LC at sight",
];

const sameTerms = (a: string[], b: string[]) =>
  a.length === b.length && a.every((t, i) => t.trim() === b[i]?.trim());

/** The draft with its standard terms brought up to date, unless someone changed them. */
function withTerms(prev: Draft, next: Draft): Draft {
  const was = standardTermList(prev.source, prev.category, prev.termsLanguage, prev.collar.on);
  if (!sameTerms(prev.terms, was)) return next;
  return {
    ...next,
    terms: standardTermList(next.source, next.category, next.termsLanguage, next.collar.on),
  };
}

/**
 * The booking wizard (buyers): 1 what kind of booking and from whom, 2 the
 * fabric with the fields of its garment family, 3 the trims (loaded for the
 * family, with "Add custom item"), 4 the collar and cuff matrix (knitwear), and
 * 5 the terms in English or বাংলা and a review. Each "Next" checks its step;
 * the server checks everything again on save and its answer lands on the same
 * fields. Used for a new booking and to change one nothing has arrived on.
 */
export function BookingWizard({ form: data, currency }: { form: BookingForm; currency: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => startDraft(data));
  const [step, setStep] = useState<Step>("setup");
  /** Steps whose "Next" (or save) found something to fix: their messages follow the fixes live. */
  const [checked, setChecked] = useState<Step[]>([]);
  const [error, setError] = useState<ActionError>();
  const [pending, startTransition] = useTransition();
  const [offerItems, setOfferItems] = useState<GarmentCategory | null>(null);
  const [dirty, setDirty] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);
  const editing = data.booking;
  /**
   * A market purchase on its own can go into stock as it is saved, by whoever may
   * also buy raw materials (the server checks again).
   */
  const canReceiveNow =
    data.can.receiveNow && !editing && !data.batch && draft.source === "MARKET_PURCHASE";
  const intoStock = receivesNow(draft) && canReceiveNow;
  const steps = stepsFor(draft);
  const at = Math.max(0, steps.indexOf(step));
  const last = at === steps.length - 1;
  const built = useMemo(() => buildInput(draft, data.today), [draft, data.today]);
  const problems = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(built.problems).filter(([key]) => checked.includes(stepOf(key, draft))),
      ),
    [built, checked, draft],
  );
  const problem = (name: string) => problems[name] ?? error?.fieldErrors?.[name]?.[0];
  const wrongSteps = () =>
    steps.filter((s) => Object.keys(built.problems).some((k) => stepOf(k, draft) === s));

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function update(next: Partial<Draft>) {
    setDraft((prev) => withTerms(prev, { ...prev, ...next }));
    setDirty(true);
  }

  function changeCategory(category: GarmentCategory) {
    if (category === draft.category) return;
    const preset = CATEGORY_PRESETS[category];
    const swap = !data.batch && !editing && untouchedItems(draft);
    const lines = swap
      ? itemsFor(category, draft.garmentPieces)
      : draft.lines.map((l) =>
          l.role === "FABRIC" && !l.material && !preset.fabricUnits.includes(l.unit)
            ? { ...l, unit: preset.fabricUnit }
            : l,
        );
    update({ category, lines, collar: { ...draft.collar, on: preset.collarMatrix } });
    setOfferItems(swap ? null : category);
  }

  function go(next: Step) {
    setStep(next);
    requestAnimationFrame(() => {
      topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      document.getElementById(`step-${next}-heading`)?.focus({ preventScroll: true });
    });
  }

  function next() {
    setError(undefined);
    if (wrongSteps().includes(step)) {
      setChecked((c) => (c.includes(step) ? c : [...c, step]));
      return;
    }
    setChecked((c) => c.filter((s) => s !== step));
    go(steps[at + 1]!);
  }

  function save() {
    setError(undefined);
    const wrong = wrongSteps();
    setChecked(wrong);
    if (wrong.length > 0) {
      if (wrong[0] !== step) go(wrong[0]!);
      return;
    }
    startTransition(async () => {
      const result = editing
        ? await updateBookingAction(editing.id, built.input)
        : await createBookingAction({ ...built.input, batchId: data.batch?.id ?? null });
      if (!result.ok) {
        setError(result.error);
        const keys = Object.keys(result.error.fieldErrors ?? {});
        const first = steps.find((s) => keys.some((k) => stepOf(k, draft) === s));
        if (first && first !== step) go(first);
        return;
      }
      setDirty(false);
      const stocked = "stocked" in result.data ? result.data.stocked : null;
      const stock = stocked === null ? "" : `&stock=${stocked ? "1" : "0"}`;
      router.push(
        `${productionHref.booking(result.data.id)}?${editing ? "saved" : "created"}=1${stock}`,
      );
    });
  }

  const general =
    error && error.code !== "INTERNAL" && !(error.code === "VALIDATION" && error.fieldErrors)
      ? error.message
      : undefined;
  const stepHasProblems = (s: Step) =>
    Object.keys(problems).some((k) => stepOf(k, draft) === s) ||
    Object.keys(error?.fieldErrors ?? {}).some((k) => stepOf(k, draft) === s);
  const cancelHref = editing
    ? productionHref.booking(editing.id)
    : data.batch
      ? productionHref.batch(data.batch.id)
      : productionHref.bookings();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (last) save();
        else next();
      }}
      className="grid min-w-0 gap-6"
      noValidate
    >
      <div ref={topRef} className="grid scroll-mt-24 gap-3">
        <p className="text-sm text-muted-foreground sm:hidden" aria-hidden>
          Step {at + 1} of {steps.length}:{" "}
          <strong className="text-foreground">{STEP_LABELS[step]}</strong>
        </p>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted sm:hidden" aria-hidden>
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${((at + 1) / steps.length) * 100}%` }}
          />
        </div>
        <nav aria-label="Booking steps">
          <ol className="flex flex-wrap gap-1.5 sm:gap-2">
            {steps.map((s, i) => {
              const current = s === step;
              const done = i < at;
              const flagged = stepHasProblems(s);
              return (
                <li key={s} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => go(s)}
                    aria-current={current ? "step" : undefined}
                    className={cn(
                      "flex items-center gap-2 rounded-full border px-2 py-1.5 text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 sm:px-3",
                      current
                        ? "border-primary bg-primary text-primary-foreground"
                        : flagged
                          ? "border-destructive/40 bg-destructive/5 text-destructive"
                          : "bg-card text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-5 items-center justify-center rounded-full text-[0.75rem] font-medium tabular-nums",
                        current ? "bg-primary-foreground/20" : "bg-muted",
                      )}
                    >
                      {done && !flagged ? <CheckIcon className="size-3.5" aria-hidden /> : i + 1}
                    </span>
                    <span className={cn(!current && "sr-only sm:not-sr-only")}>
                      {STEP_LABELS[s]}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      </div>

      {step === "setup" && (
        <section aria-labelledby="step-setup-heading" className="grid min-w-0 gap-6">
          <StepHeading id="step-setup-heading" title="Booking type">
            Choose where the goods come from and the garment family. The family loads its fabric
            fields, its trims and, for knitwear, the collar and cuff matrix.
          </StepHeading>
          {editing && editing.stage !== "DRAFT" && editing.canChangeItems && (
            <FormAlert tone="note">
              {editing.number} is {editing.stage === "SENT" ? "approved and sent" : "approved"}.
              Changing its items, its in-house date, delivery place, payment terms or terms makes
              revision R{editing.revision + 1}, a draft that is approved again; the changes are
              listed on it in red.
            </FormAlert>
          )}
          {data.batch && (
            <FormAlert tone="note">
              For master batch{" "}
              <Link
                href={productionHref.batch(data.batch.id)}
                className="font-medium underline underline-offset-4"
              >
                {data.batch.code} · {data.batch.name}
              </Link>
              : what it books counts as ordered for the batch&apos;s styles, and its goods are
              received in the batch&apos;s central receive.
            </FormAlert>
          )}
          <ChoiceCards<BookingSource>
            name="source"
            legend="Where the goods come from"
            value={draft.source}
            onChange={(source) => update({ source })}
            // Only the kinds this person may book (Production > Bookings > Add bookings).
            options={BOOKING_SOURCES.filter(
              (s) => data.can.sources.includes(s) || s === draft.source,
            ).map((s) => ({
              value: s,
              label: SOURCE_LABELS[s],
              hint: SOURCE_HINTS[s],
            }))}
          />
          {canReceiveNow && (
            <div className="flex items-start gap-3 rounded-lg border bg-card p-4">
              <Checkbox
                id="booking-receive-now"
                checked={draft.receiveNow}
                onCheckedChange={(value) => update({ receiveNow: value === true })}
                className="mt-0.5"
                aria-describedby="booking-receive-now-hint"
              />
              <div className="grid gap-0.5">
                <label htmlFor="booking-receive-now" className="cursor-pointer text-sm font-medium">
                  Bought and collected: add to stock now
                </label>
                <p
                  id="booking-receive-now-hint"
                  className="text-[0.8125rem] leading-snug text-muted-foreground"
                >
                  No waiting for a delivery: the goods go into the main store when you save. Every
                  item needs the price paid. The bill is saved as Due to the seller, and Accounts
                  pays it.
                </p>
              </div>
            </div>
          )}
          <ChoiceCards<GarmentCategory>
            name="category"
            legend="Garment family"
            value={draft.category}
            onChange={changeCategory}
            columns="grid-cols-2 lg:grid-cols-5"
            options={GARMENT_CATEGORIES.map((c) => ({
              value: c,
              label: CATEGORY_LABELS[c],
              hint: CATEGORY_HINTS[c],
            }))}
          />
          {offerItems && (
            <FormAlert tone="note">
              <span className="block">
                The items already on the booking were kept. Load the standard{" "}
                {CATEGORY_LABELS[offerItems].toLowerCase()} items instead?
              </span>
              <span className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    update({ lines: itemsFor(offerItems, draft.garmentPieces) });
                    setOfferItems(null);
                  }}
                >
                  Load the {CATEGORY_LABELS[offerItems].toLowerCase()} items
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setOfferItems(null)}
                >
                  Keep the items
                </Button>
              </span>
            </FormAlert>
          )}
          <Field
            id="booking-supplier"
            label={
              draft.source === "MARKET_PURCHASE"
                ? "Shop or seller"
                : "Supplier (mill or trims house)"
            }
            error={problem("supplierId")}
          >
            <SupplierPicker
              id="booking-supplier"
              value={draft.supplier}
              onChange={(s) =>
                update({ supplier: s ? { id: s.id, code: s.code ?? "", name: s.name } : null })
              }
              invalid={Boolean(problem("supplierId"))}
              describedBy={problem("supplierId") ? "booking-supplier-error" : undefined}
            />
          </Field>
          <div className="grid items-start gap-4 sm:grid-cols-2">
            {!intoStock && (
              <Field
                id="booking-expected"
                label="Deliver by (optional)"
                error={problem("expectedDate")}
              >
                <Input
                  id="booking-expected"
                  type="date"
                  min={editing ? undefined : data.today}
                  value={draft.expectedDate}
                  onChange={(e) => update({ expectedDate: e.target.value })}
                  aria-invalid={Boolean(problem("expectedDate"))}
                />
              </Field>
            )}
            <Field
              id="booking-ref"
              label="Supplier's reference (optional)"
              error={problem("supplierRef")}
            >
              <Input
                id="booking-ref"
                value={draft.supplierRef}
                onChange={(e) => update({ supplierRef: e.target.value })}
                maxLength={60}
                autoComplete="off"
              />
            </Field>
            <Field id="booking-title" label="Title (optional)" error={problem("title")}>
              <Input
                id="booking-title"
                value={draft.title}
                onChange={(e) => update({ title: e.target.value })}
                placeholder="Summer polo 2026"
                maxLength={160}
                autoComplete="off"
              />
            </Field>
            <Field
              id="booking-style"
              label="Style reference (optional)"
              error={problem("styleRef")}
            >
              <Input
                id="booking-style"
                value={draft.styleRef}
                onChange={(e) => update({ styleRef: e.target.value })}
                placeholder="PL-2601, PL-2602"
                maxLength={80}
                autoComplete="off"
              />
            </Field>
            <Field
              id="booking-pieces"
              label="Garment pieces (optional)"
              hint="Printed on the booking and used by the fabric calculator"
              error={problem("garmentPieces")}
            >
              <Input
                id="booking-pieces"
                inputMode="numeric"
                value={draft.garmentPieces}
                onChange={(e) => {
                  const pieces = e.target.value;
                  update({
                    garmentPieces: pieces,
                    // The calculator's pieces follow until someone types their own.
                    lines: draft.lines.map((l) =>
                      l.calc.pieces === draft.garmentPieces
                        ? { ...l, calc: { ...l.calc, pieces } }
                        : l,
                    ),
                  });
                }}
                autoComplete="off"
                aria-invalid={Boolean(problem("garmentPieces"))}
              />
            </Field>
          </div>
        </section>
      )}

      {(step === "fabric" || step === "trims") && (
        <ItemsStep
          key={step}
          step={step}
          category={draft.category}
          lines={draft.lines}
          collar={draft.collar}
          garmentPieces={draft.garmentPieces}
          batchPicks={data.batchMaterials}
          currency={currency}
          priceNeeded={intoStock}
          problem={problem}
          onLines={(lines) => update({ lines })}
        />
      )}

      {step === "collar" && (
        <CollarStep
          collar={draft.collar}
          lines={draft.lines}
          problem={problem}
          onChange={(collar) => update({ collar })}
        />
      )}

      {step === "terms" && (
        <section aria-labelledby="step-terms-heading" className="grid min-w-0 gap-6">
          <StepHeading id="step-terms-heading" title="Terms & review">
            The terms are filled in for the source and the garment family. Change any condition,
            switch to বাংলা, then check the booking and save it.
          </StepHeading>
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <Field
              id="booking-payment"
              label="Payment terms (optional)"
              error={problem("paymentTerms")}
            >
              <Input
                id="booking-payment"
                list="booking-payment-options"
                value={draft.paymentTerms}
                onChange={(e) => update({ paymentTerms: e.target.value })}
                placeholder="30 days after delivery"
                maxLength={300}
                autoComplete="off"
              />
              <datalist id="booking-payment-options">
                {PAYMENT_TERMS.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </Field>
            <Field
              id="booking-place"
              label="Deliver to (optional)"
              hint="Printed on the booking; empty prints the company's address"
              error={problem("deliveryPlace")}
            >
              <Textarea
                id="booking-place"
                value={draft.deliveryPlace}
                onChange={(e) => update({ deliveryPlace: e.target.value })}
                placeholder="Our store, with the address"
                maxLength={300}
                className="min-h-11"
              />
            </Field>
          </div>
          <TermsEditor
            source={draft.source}
            category={draft.category}
            collar={draft.collar.on}
            language={draft.termsLanguage}
            terms={draft.terms}
            onChange={({ language, terms }) => update({ termsLanguage: language, terms })}
            error={problem("terms")}
          />
          <Field id="booking-notes" label="Notes (optional)" error={problem("notes")}>
            <Textarea
              id="booking-notes"
              value={draft.notes}
              onChange={(e) => update({ notes: e.target.value })}
              placeholder="Anything else the supplier should know"
              maxLength={2000}
            />
          </Field>
          <Review draft={draft} currency={currency} intoStock={intoStock} />
        </section>
      )}

      {Object.keys(problems).length > 0 && !general && (
        <FormAlert>
          {Object.keys(problems).some((k) => stepOf(k, draft) === step)
            ? "Please check the highlighted fields."
            : "Some steps need a look: they are marked in red above."}
        </FormAlert>
      )}
      {general && <FormAlert>{general}</FormAlert>}
      {error?.code === "VALIDATION" && error.fieldErrors && Object.keys(problems).length === 0 && (
        <FormAlert>{error.message}</FormAlert>
      )}

      <div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button asChild variant="ghost" className="w-full sm:w-auto">
            <Link href={cancelHref}>Cancel</Link>
          </Button>
          {at > 0 && (
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => go(steps[at - 1]!)}
            >
              <ChevronLeftIcon aria-hidden />
              Back
            </Button>
          )}
        </div>
        <Button type="submit" className="w-full sm:w-auto" disabled={pending}>
          {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
          {last ? (
            pending ? (
              "Saving"
            ) : editing ? (
              "Save the changes"
            ) : intoStock ? (
              "Save and add to stock"
            ) : (
              "Save the booking"
            )
          ) : (
            <>
              Next: {STEP_LABELS[steps[at + 1]!]}
              <ChevronRightIcon aria-hidden />
            </>
          )}
        </Button>
      </div>
      {error?.code === "INTERNAL" && (
        <ErrorDialog
          code={error.errorId ?? "ERR-UNKNOWN"}
          title="We could not save the booking"
          onClose={() => setError(undefined)}
        />
      )}
    </form>
  );
}

/** The booking at a glance before it is saved: who, what, how much and the collar sets. */
function Review({
  draft,
  currency,
  intoStock,
}: {
  draft: Draft;
  currency: string;
  intoStock: boolean;
}) {
  const totals = liveCollarTotals(draft.collar);
  const rows = draft.lines.map((l) => {
    const worked = lineQuantity(l, draft.collar);
    const price = Number(l.unitPrice.replace(/,/g, ""));
    const amount =
      worked.value && l.unitPrice.trim() && Number.isFinite(price) ? worked.value * price : null;
    const specs = specsText(
      {
        role: l.role,
        ...Object.fromEntries(
          Object.entries(l.specs).map(([k, v]) => [
            k,
            ["weight", "dia", "width", "gauge"].includes(k) ? Number(v) || null : v || null,
          ]),
        ),
      },
      draft.category,
    );
    return { line: l, worked, specs, amount };
  });
  const total = rows.reduce((t, r) => t + (r.amount ?? 0), 0);
  const priceLater = rows.filter((r) => r.amount === null).length;
  return (
    <section
      aria-labelledby="booking-review-heading"
      className="grid min-w-0 gap-4 rounded-lg border bg-card p-4 sm:p-5"
    >
      <h4 id="booking-review-heading" className="font-serif text-lg text-primary">
        Check before saving
      </h4>
      <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Figure label="Source" value={SOURCE_LABELS[draft.source]} />
        <Figure label="Garment" value={CATEGORY_LABELS[draft.category]} />
        <Figure
          label={draft.source === "MARKET_PURCHASE" ? "Seller" : "Supplier"}
          value={draft.supplier?.name ?? "Not chosen"}
        />
        {intoStock ? (
          <Figure label="Into stock" value="When saved" />
        ) : (
          <Figure
            label="Deliver by"
            value={draft.expectedDate ? formatDay(draft.expectedDate) : "Not set"}
          />
        )}
      </dl>
      <ul className="grid divide-y rounded-md border" aria-label="Items to book">
        {rows.map(({ line, worked, specs }) => (
          <li key={line.key} className="flex min-w-0 items-start justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium break-words">
                {line.material
                  ? `${line.material.code} · ${line.material.name}`
                  : line.name || "Unnamed item"}
              </p>
              <p className="text-[0.8125rem] break-words text-muted-foreground">
                {[ROLE_LABELS[line.role], line.specs.colour.trim() || null, specs || null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <span className="shrink-0 text-right text-sm tabular-nums">
              {worked.value
                ? quantityLabel(worked.value, line.unit, currency)
                : `– ${UNIT_LABELS[line.unit]}`}
              <span className="block text-[0.75rem] text-muted-foreground">
                {worked.source === "matrix"
                  ? "from the matrix"
                  : worked.source === "calculator"
                    ? "worked out"
                    : line.unitPrice.trim()
                      ? `at ${line.unitPrice}`
                      : "price at receive"}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {draft.collar.on && (
          <>
            <Figure label="Collar style" value={COLLAR_STYLE_LABELS[draft.collar.style]} />
            <Figure label="Collar sets" value={totals.totalSets.toLocaleString("en")} />
          </>
        )}
        <Figure
          label="Booking total"
          value={total > 0 ? money(total.toFixed(2), currency) : "At receive"}
          strong
        />
        {priceLater > 0 && (
          <Figure
            label="Priced at receive"
            value={`${priceLater} ${priceLater === 1 ? "item" : "items"}`}
          />
        )}
      </dl>
      <p className="text-[0.8125rem] text-muted-foreground">
        {draft.terms.filter((t) => t.trim()).length} conditions in{" "}
        {draft.termsLanguage === "BN" ? "বাংলা" : "English"}. Print the PDF from the booking once it
        is saved.
      </p>
    </section>
  );
}
