"use client";

import { FileDownIcon, ReceiptTextIcon, Undo2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { FormDialog, readReason, ReasonField } from "@/components/sales/dialogs";
import { Panel } from "@/components/sales/detail-bits";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ActionError } from "@/lib/result";
import { formatCount, formatDay } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { CmSettlementScreen } from "@/modules/production/batch-money.service";
import { settleCmAction, undoCmSettlementAction } from "@/server/actions/production.actions";

import { productionHref } from "./labels";

/*
 * The final CM settlement of a master batch with its factory:
 *   Total CM - Deductions - Advance taken = Final payable.
 * Rejects up to the batch's allowance (2% of the pieces cut unless changed) are
 * free; each one over it is taken off at the style's target price.
 * Before it is saved, the person settling is asked whether the CM of the
 * C-grade pieces is taken off, and sees the payable change as they choose.
 * Saved, it shows as it stood, with its PDF bill and a way to undo it.
 */

type Draft = NonNullable<CmSettlementScreen["draft"]>;
type Totals = Draft["keepC"];
type View = Pick<Draft, "styles" | "faults" | "payments" | "cGradePieces" | "batch"> & {
  /** null on settlements saved before the reject allowance. */
  rejectAllowancePercent: string | null;
};

const head =
  "px-2 py-2 text-left text-[0.75rem] font-medium tracking-wide whitespace-nowrap text-muted-foreground";
const num = "px-2 py-2.5 text-right tabular-nums";

/** Each style's pieces by grade, its CM a piece and its CM. */
function CmByStyle({ view, totals, currency }: { view: View; totals: Totals; currency: string }) {
  const count = (n: number) => formatCount(n, currency);
  const sum = (pick: (s: View["styles"][number]) => number) =>
    view.styles.reduce((t, s) => t + pick(s), 0);
  return (
    <Panel title="CM by style" id="cm-styles-heading">
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        The factory is paid its CM on every piece it handed over: A, B, C and rejects. Missing
        pieces are not paid for.
        {view.rejectAllowancePercent !== null &&
          ` Rejects up to ${view.rejectAllowancePercent}% of the pieces cut are free; the ones over it are taken off below.`}
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <caption className="sr-only">CM by style</caption>
          <thead>
            <tr className="border-b">
              <th scope="col" className={head}>
                Style
              </th>
              {["CM a piece", "A", "B", "C", "Rejects", "Pieces", "CM"].map((label) => (
                <th key={label} scope="col" className={cn(head, "text-right")}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.styles.map((s) => (
              <tr key={s.id} className="border-b">
                <th scope="row" className="px-2 py-2.5 text-left font-medium">
                  <Link
                    href={productionHref.finishing(s.id)}
                    className="underline-offset-4 hover:underline"
                  >
                    {s.code}
                  </Link>
                  <span className="block text-[0.75rem] font-normal text-muted-foreground">
                    {s.name}
                    {s.missing > 0 && `, ${count(s.missing)} missing`}
                  </span>
                </th>
                <td className={cn(num, !s.cmRate && "font-medium text-destructive")}>
                  {s.cmRate ? money(s.cmRate, currency) : "Not agreed"}
                </td>
                <td className={num}>{count(s.a)}</td>
                <td className={num}>{count(s.b)}</td>
                <td className={num}>{count(s.c)}</td>
                <td className={num}>
                  {count(s.reject)}
                  {s.overAllowance > 0 && (
                    <span className="block text-[0.75rem] text-destructive">
                      {count(s.overAllowance)} over
                    </span>
                  )}
                </td>
                <td className={num}>{count(s.pieces)}</td>
                <td className={cn(num, "font-medium")}>{s.cm ? money(s.cm, currency) : "–"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="px-2 py-2.5 text-left font-medium">
                Total CM
              </th>
              <td className={num} />
              <td className={num}>{count(sum((s) => s.a))}</td>
              <td className={num}>{count(sum((s) => s.b))}</td>
              <td className={num}>{count(sum((s) => s.c))}</td>
              <td className={num}>{count(sum((s) => s.reject))}</td>
              <td className={num}>{count(sum((s) => s.pieces))}</td>
              <td className={cn(num, "font-semibold")}>{money(totals.totalCm, currency)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Panel>
  );
}

/** The factory's faults taken off, and the C-grade CM (asked before saving). */
function Deductions({
  view,
  totals,
  currency,
  ask,
  deductedC = false,
}: {
  view: View;
  totals: Totals;
  currency: string;
  /** Before saving: the C-grade tick. */
  ask?: { checked: boolean; onChange: (checked: boolean) => void };
  /** Once saved: whether the C-grade CM was taken off. */
  deductedC?: boolean;
}) {
  return (
    <Panel title="Deductions" id="cm-deductions-heading">
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        The factory&apos;s open faults on this batch are taken off: missing pieces at the final unit
        cost, fabric faults and any other fault with a value.
        {view.rejectAllowancePercent !== null &&
          ` So are the rejects over the ${view.rejectAllowancePercent}% allowance (sewing faults, bodies ruined attaching accessories), each at the style's target price.`}
      </p>
      {view.styles.some((s) => s.overAllowance > 0) && (
        <ul className="mt-4 divide-y rounded-md border" aria-label="Rejects over the allowance">
          {view.styles
            .filter((s) => s.overAllowance > 0)
            .map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2.5"
              >
                <span className="min-w-0 text-sm">
                  <span className="font-medium">Rejects over the allowance</span>
                  <span className="text-muted-foreground"> · {s.code}</span>
                  <span className="block text-[0.75rem] break-words text-muted-foreground">
                    {formatCount(s.overAllowance, currency)} of {formatCount(s.reject, currency)}{" "}
                    rejects; allowance {formatCount(s.allowance ?? 0, currency)} (
                    {view.rejectAllowancePercent}% of {formatCount(s.cut ?? 0, currency)} cut)
                    {s.targetPrice && ` at ${money(s.targetPrice, currency)} a piece`}
                  </span>
                </span>
                <span
                  className={cn(
                    "text-sm tabular-nums",
                    s.targetPrice ? "font-medium" : "text-muted-foreground",
                  )}
                >
                  {s.targetPrice ? money(s.rejectPenalty, currency) : "No target price"}
                </span>
              </li>
            ))}
        </ul>
      )}
      {view.faults.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No open fault in the factory&apos;s log.
        </p>
      ) : (
        <ul className="mt-4 divide-y rounded-md border" aria-label="Faults taken off">
          {view.faults.map((f) => (
            <li
              key={f.id}
              className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2.5"
            >
              <span className="min-w-0 text-sm">
                <span className="font-medium">{f.number}</span> · {f.what}
                {f.style && <span className="text-muted-foreground"> · {f.style}</span>}
                {f.quantity && <span className="text-muted-foreground"> · {f.quantity}</span>}
                {f.note && (
                  <span className="block text-[0.75rem] break-words text-muted-foreground">
                    {f.note}
                  </span>
                )}
              </span>
              <span
                className={cn(
                  "text-sm tabular-nums",
                  f.amount ? "font-medium" : "text-muted-foreground",
                )}
              >
                {f.amount ? money(f.amount, currency) : "To agree (not taken off)"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4">
        {ask ? (
          view.cGradePieces > 0 ? (
            <label
              htmlFor="deduct-c"
              className="flex cursor-pointer items-start gap-3 rounded-md border bg-card px-3 py-2.5 has-[:checked]:border-primary/50 has-[:checked]:bg-secondary"
            >
              <input
                id="deduct-c"
                type="checkbox"
                checked={ask.checked}
                onChange={(e) => ask.onChange(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary"
              />
              <span className="grid gap-0.5">
                <span className="text-sm font-medium">
                  Deduct the CM of the {formatCount(view.cGradePieces, currency)} C-grade pieces (
                  {money(totals.cGradeCm, currency)})
                </span>
                <span className="text-[0.8125rem] leading-snug text-muted-foreground">
                  Your call: C-grade pieces went to mending and never reach stock. Leave it unticked
                  to pay the factory for them.
                </span>
              </span>
            </label>
          ) : (
            <p className="text-sm text-muted-foreground">No C-grade pieces: nothing to ask.</p>
          )
        ) : (
          view.cGradePieces > 0 && (
            <p className="text-sm">
              {deductedC
                ? `The CM of the ${formatCount(view.cGradePieces, currency)} C-grade pieces (${money(totals.cGradeCm, currency)}) is taken off.`
                : `The CM of the ${formatCount(view.cGradePieces, currency)} C-grade pieces is paid (not taken off).`}
            </p>
          )
        )}
      </div>
      <p className="mt-4 flex justify-between gap-2 border-t pt-3 text-sm font-medium tabular-nums">
        <span>Total deductions</span>
        <span>{money(totals.deductions, currency)}</span>
      </p>
    </Panel>
  );
}

/** The advances paid for the batch and the payments for its styles. */
function Paid({ view, totals, currency }: { view: View; totals: Totals; currency: string }) {
  return (
    <Panel title="Advance taken and paid" id="cm-paid-heading">
      {view.payments.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Nothing paid to the factory for this batch yet.
        </p>
      ) : (
        <ul className="mt-4 divide-y rounded-md border" aria-label="Paid to the factory">
          {view.payments.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2.5"
            >
              <span className="text-sm">
                <span className="font-medium">{p.number}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {formatDay(p.on)} ·{" "}
                  {p.style ? `for ${p.style.code}` : `advance (${view.batch.code})`}
                </span>
              </span>
              <span className="text-sm tabular-nums">{money(p.amount, currency)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 flex justify-between gap-2 border-t pt-3 text-sm font-medium tabular-nums">
        <span>Total paid</span>
        <span>{money(totals.paid, currency)}</span>
      </p>
    </Panel>
  );
}

/** Total CM - Deductions - Advance taken = Final payable. */
function FinalMath({ totals, currency }: { totals: Totals; currency: string }) {
  const owes = Number(totals.payable) < 0;
  return (
    <dl className="mt-4 grid gap-2 text-sm tabular-nums">
      <div className="flex justify-between gap-3">
        <dt>Total CM</dt>
        <dd>{money(totals.totalCm, currency)}</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt>Less deductions</dt>
        <dd>− {money(totals.deductions, currency)}</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt>Less advance taken and paid</dt>
        <dd>− {money(totals.paid, currency)}</dd>
      </div>
      <div className="mt-2 grid gap-1 border-t pt-3">
        <dt className="text-[0.75rem] font-medium tracking-wide text-muted-foreground uppercase">
          {owes ? "Final payable: the factory owes" : "Final payable"}
        </dt>
        <dd className={cn("font-serif text-3xl", owes ? "text-destructive" : "text-primary")}>
          {money(owes ? totals.payable.replace("-", "") : totals.payable, currency)}
        </dd>
      </div>
    </dl>
  );
}

/** The settlement screen below its heading. */
export function CmSettlementView({
  screen,
  currency,
  notice,
}: {
  screen: CmSettlementScreen;
  currency: string;
  notice?: string;
}) {
  const router = useRouter();
  const [deductC, setDeductC] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<ActionError>();
  const [pending, startTransition] = useTransition();
  const [undoing, setUndoing] = useState(false);
  const { draft, standing, can } = screen;

  const view: View | null = standing ? standing.snapshot : draft;
  const totals: Totals | null = standing
    ? standing.snapshot.totals
    : draft
      ? deductC
        ? draft.deductC
        : draft.keepC
      : null;
  if (!view || !totals) return null;

  function save() {
    setError(undefined);
    startTransition(async () => {
      const result = await settleCmAction(screen.batch.id, {
        deductCGrade: deductC,
        note: note.trim() || null,
      });
      if (!result.ok) return setError(result.error);
      router.push(
        `${productionHref.cmSettlement(screen.batch.id)}?settled=${encodeURIComponent(result.data.number)}`,
      );
    });
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
      <div className="grid min-w-0 content-start gap-6">
        {notice && <FormAlert tone="success">{notice}</FormAlert>}
        {draft && draft.warnings.noRate.length > 0 && (
          <FormAlert>
            Agree the CM a piece of {draft.warnings.noRate.join(", ")} on the factory agreement
            first; the settlement cannot be saved without it.
          </FormAlert>
        )}
        {draft && draft.warnings.noTarget.length > 0 && (
          <FormAlert tone="note">
            {draft.warnings.noTarget.join(", ")}{" "}
            {draft.warnings.noTarget.length === 1 ? "has" : "have"} rejects over the allowance but
            no target price, so they are not charged. Set the target price on the style first.
          </FormAlert>
        )}
        {draft && draft.warnings.notPacked.length > 0 && (
          <FormAlert tone="note">
            Not final yet: {draft.warnings.notPacked.join(", ")}{" "}
            {draft.warnings.notPacked.length === 1 ? "has" : "have"} no full packing list, so the
            pieces may still change.
          </FormAlert>
        )}
        <CmByStyle view={view} totals={totals} currency={currency} />
        <Deductions
          view={view}
          totals={totals}
          currency={currency}
          ask={draft && can.settle ? { checked: deductC, onChange: setDeductC } : undefined}
          deductedC={standing ? standing.deductCGrade : deductC}
        />
        <Paid view={view} totals={totals} currency={currency} />
      </div>

      <div className="grid min-w-0 content-start gap-6">
        <Panel title="Final payable" id="cm-payable-heading">
          <FinalMath totals={totals} currency={currency} />
          {standing ? (
            <div className="mt-5 grid gap-3">
              <p className="text-sm text-muted-foreground">
                {standing.number}, settled {formatDay(standing.settledOn)}
                {standing.by && ` by ${standing.by}`}.
              </p>
              {standing.posted && (
                <p className="text-sm">
                  {money(standing.deductions, currency)} taken off{" "}
                  {screen.factory?.name ?? "the factory"}&apos;s Supplier Due on{" "}
                  {can.seeJournal ? (
                    <Link
                      href={`/accounts/journal/${standing.posted.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {standing.posted.number}
                    </Link>
                  ) : (
                    <span className="font-medium">{standing.posted.number}</span>
                  )}
                  .
                </p>
              )}
              {standing.notPosted && (
                <FormAlert tone="note">
                  Saved before deductions came off the Supplier Due by themselves. Undo it and save
                  it again to take {money(standing.deductions, currency)} off{" "}
                  {screen.factory?.name ?? "the factory"}&apos;s Supplier Due.
                </FormAlert>
              )}
              {standing.note && <p className="text-sm break-words">{standing.note}</p>}
              <Button asChild className="w-full sm:w-auto">
                <a href={productionHref.cmSettlementPdf(standing.id)} download>
                  <FileDownIcon aria-hidden />
                  Download the PDF bill
                </a>
              </Button>
              {can.undo && (
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full text-destructive sm:w-auto"
                  onClick={() => setUndoing(true)}
                >
                  <Undo2Icon aria-hidden />
                  Undo the settlement
                </Button>
              )}
            </div>
          ) : can.settle ? (
            <div className="mt-5 grid gap-4">
              <Field id="cm-note" label="Notes (optional)" hint="Printed on the bill.">
                <Textarea
                  id="cm-note"
                  rows={2}
                  maxLength={1000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </Field>
              {error && <FormAlert>{error.message}</FormAlert>}
              <Button type="button" onClick={save} disabled={pending} className="w-full sm:w-auto">
                <ReceiptTextIcon aria-hidden />
                {pending ? "Saving" : "Save and make the PDF bill"}
              </Button>
              <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
                Saving marks the faults above deducted in the fault log,{" "}
                {Number(totals.deductions) > 0
                  ? `takes the ${money(totals.deductions, currency)} of deductions off ${
                      screen.factory?.name ?? "the factory"
                    }'s Supplier Due at once, `
                  : ""}
                and tells Accounts the final payable. It can be undone.
              </p>
            </div>
          ) : (
            <p className="mt-5 text-[0.8125rem] leading-relaxed text-muted-foreground">
              {draft?.factory
                ? "Production Managers and Accounts save the settlement."
                : "The batch has no factory. Set it on the batch first."}
            </p>
          )}
        </Panel>
        {screen.undone.length > 0 && (
          <Panel title="Undone" id="cm-undone-heading">
            <ul className="mt-3 grid gap-2 text-sm" aria-label="Settlements undone">
              {screen.undone.map((u) => (
                <li key={u.id}>
                  <span className="font-medium">{u.number}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · undone {u.undone ? formatDay(u.undone.on) : ""}
                    {u.undone?.by && ` by ${u.undone.by}`}
                    {u.undone?.reason && `: ${u.undone.reason}`}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>

      {undoing && standing && (
        <FormDialog
          title={`Undo ${standing.number}?`}
          description={
            standing.posted
              ? `The faults it took off go back to open in the fault log, its ${money(standing.deductions, currency)} of deductions go back on the Supplier Due, and the batch can be settled again.`
              : "The faults it took off go back to open in the fault log, and the batch can be settled again."
          }
          submitLabel="Undo the settlement"
          pendingLabel="Undoing"
          destructive
          errorTitle="We could not undo the settlement"
          onClose={() => setUndoing(false)}
          onSubmit={async (form) => {
            const reason = readReason(form, 3);
            if (typeof reason !== "string") return reason;
            const result = await undoCmSettlementAction(standing.id, { reason });
            if (!result.ok) return result.error;
            setUndoing(false);
            router.push(
              `${productionHref.cmSettlement(screen.batch.id)}?undone=${encodeURIComponent(standing.number)}`,
            );
          }}
        >
          {(fieldError) => <ReasonField id="undo-reason" min={3} error={fieldError("reason")} />}
        </FormDialog>
      )}
    </div>
  );
}
