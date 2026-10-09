"use client";

import { BanIcon, PackageCheckIcon, PencilIcon, Undo2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { ChoiceList } from "@/components/parties/choice-list";
import { AMOUNT_HINT, readAmount, textOf } from "@/components/products/form-values";
import { FormDialog, problem, readReason, ReasonField } from "@/components/sales/dialogs";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCount } from "@/lib/display";
import type { ActionError } from "@/lib/result";
import type { IntakeScreen } from "@/modules/production/screens.service";
import {
  cancelIntakeAction,
  confirmIntakeAction,
  reverseIntakeAction,
} from "@/server/actions/production.actions";

import { productionHref } from "./labels";

type Open = "confirm" | "cancel" | "undo" | null;
type CostChoice = "SHARE" | "FINAL" | "TYPED";

/** A tick box with its label and what it means. */
function Tick({
  id,
  checked,
  onChange,
  label,
  hint,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-3 rounded-md border bg-card px-3 py-2.5 has-[:checked]:border-primary/50 has-[:checked]:bg-secondary"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary"
      />
      <span className="grid gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        {hint && (
          <span className="text-[0.8125rem] leading-snug text-muted-foreground">{hint}</span>
        )}
      </span>
    </label>
  );
}

/** "A-grade 120.50 · B-grade 60.25 a piece". */
function perPieceText(perPiece: { a: string | null; b: string | null }, currency: string) {
  return [
    perPiece.a ? `A-grade ${money(perPiece.a, currency)}` : null,
    perPiece.b ? `B-grade ${money(perPiece.b, currency)}` : null,
  ]
    .filter(Boolean)
    .join(" · ")
    .concat(" a piece");
}

/**
 * What can be done with a factory delivery, each offered from the flags the
 * screen came with (screen.can, from production/rules.ts): the store (stock
 * intake) corrects, confirms or cancels a draft; Production Managers also
 * complete the project with the last delivery and undo a confirmed one. People
 * who see costs choose the cost the pieces carry into stock.
 */
export function IntakeActions({
  screen,
  currency,
  notice: initialNotice,
}: {
  screen: IntakeScreen;
  currency: string;
  notice?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useState(initialNotice);
  const [choice, setChoice] = useState<CostChoice>("SHARE");
  const [final, setFinal] = useState(false);
  const [complete, setComplete] = useState(false);
  const [zero, setZero] = useState(false);
  const [needZero, setNeedZero] = useState(false);
  const [redraft, setRedraft] = useState(true);
  const { intake: d, costs, can } = screen;
  const project = d.project;
  const preview = costs?.preview?.error === null ? costs.preview : null;
  const close = () => {
    setOpen(null);
    setNeedZero(false);
    setZero(false);
  };
  const done = (message: string) => {
    setNotice(message);
    close();
  };

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 10_000);
    return () => clearTimeout(timer);
  }, [notice]);

  const chosenTotal =
    choice === "SHARE"
      ? preview?.share.totalCost
      : choice === "FINAL"
        ? preview?.final.totalCost
        : null;
  const zeroAhead = Boolean(preview && chosenTotal !== null && chosenTotal === "0.00");
  const showZero = needZero || zeroAhead;

  if (!can.edit && !can.confirm && !can.cancel && !can.undo && !notice) return null;

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {can.confirm && (
          <Button type="button" className="w-full sm:w-auto" onClick={() => setOpen("confirm")}>
            <PackageCheckIcon aria-hidden />
            Confirm into stock
          </Button>
        )}
        {can.edit && (
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link href={`${productionHref.delivery(d.id)}/edit`}>
              <PencilIcon aria-hidden />
              Correct the pieces
            </Link>
          </Button>
        )}
        {can.cancel && (
          <Button
            type="button"
            variant="outline"
            className="w-full text-destructive hover:text-destructive sm:w-auto"
            onClick={() => setOpen("cancel")}
          >
            <BanIcon aria-hidden />
            Cancel the draft
          </Button>
        )}
        {can.undo && (
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => setOpen("undo")}
          >
            <Undo2Icon aria-hidden />
            Undo this delivery
          </Button>
        )}
      </div>

      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      {open === "confirm" && project && (
        <FormDialog
          title={`Put ${d.number} into stock?`}
          description={`${formatCount(d.pieces.total, currency)} pieces (${formatCount(d.pieces.aGrade, currency)} A-grade, ${formatCount(d.pieces.bGrade, currency)} B-grade) go into ${d.warehouse ?? "the main warehouse"} and can be sold. A mistake afterwards is undone by a Production Manager.`}
          submitLabel="Confirm into stock"
          pendingLabel="Confirming"
          errorTitle="We could not confirm the delivery"
          onClose={close}
          onSubmit={async (form) => {
            let totalCost: number | undefined;
            if (choice === "TYPED") {
              const amount = readAmount(textOf(form, "totalCost"));
              if (amount === "invalid") return problem({ totalCost: AMOUNT_HINT });
              if (amount === null) return problem({ totalCost: "Enter the cost they carry." });
              totalCost = amount;
            }
            if (showZero && !zero) {
              return problem({ zero: "Tick the box to receive them at zero cost." });
            }
            const result = await confirmIntakeAction(d.id, {
              finalDelivery: costs ? choice === "FINAL" : final,
              completeProject: can.completeProject && complete ? true : undefined,
              totalCost,
              allowZeroCost: showZero && zero ? true : undefined,
            });
            if (!result.ok) {
              if (/allow zero cost/.test(result.error.message)) {
                setNeedZero(true);
                const error: ActionError = {
                  code: "VALIDATION",
                  message: `No cost is waiting in ${project.code} for these pieces, so they would go into stock at zero cost. Tick the box to receive them anyway, or record the project's costs first.`,
                };
                return error;
              }
              return result.error;
            }
            done(
              `${d.number} is in stock: ${formatCount(d.pieces.total, currency)} pieces${
                can.completeProject && complete ? `, and ${project.code} is completed` : ""
              }.`,
            );
          }}
        >
          {(fieldError) => (
            <>
              {costs?.preview?.error && <FormAlert tone="note">{costs.preview.error}</FormAlert>}
              {preview && (
                <ChoiceList<CostChoice>
                  key={complete ? "complete" : "part"}
                  name="cost"
                  legend="The cost these pieces carry into stock"
                  defaultValue={choice}
                  onChange={setChoice}
                  options={[
                    ...(complete
                      ? []
                      : [
                          {
                            value: "SHARE" as const,
                            label: `Their share: ${money(preview.share.totalCost, currency)}`,
                            hint: `${perPieceText(preview.share.perPiece, currency)}. ${money(preview.remaining, currency)} is waiting in ${project.code}.`,
                          },
                        ]),
                    {
                      value: "FINAL",
                      label: `All that is left: ${money(preview.final.totalCost, currency)}`,
                      hint: `For the factory's last delivery. ${perPieceText(preview.final.perPiece, currency)}.`,
                    },
                    ...(can.setTotal
                      ? [
                          {
                            value: "TYPED" as const,
                            label: "Type the cost",
                            hint: `Up to ${money(preview.remaining, currency)}, split over the pieces as chosen on the delivery.`,
                          },
                        ]
                      : []),
                  ]}
                />
              )}
              {choice === "TYPED" && (
                <Field
                  id="confirm-total"
                  label={`Cost of the delivery (${currency})`}
                  error={fieldError("totalCost")}
                >
                  <Input
                    id="confirm-total"
                    name="totalCost"
                    inputMode="decimal"
                    placeholder="0.00"
                    autoComplete="off"
                    className="sm:w-48"
                    aria-invalid={Boolean(fieldError("totalCost"))}
                    aria-describedby={fieldError("totalCost") ? "confirm-total-error" : undefined}
                  />
                </Field>
              )}
              {!costs && (
                <Tick
                  id="confirm-final"
                  checked={final}
                  onChange={setFinal}
                  label={`This is the factory's last delivery for ${project.code}`}
                  hint="The project's remaining cost then goes with these pieces."
                />
              )}
              {can.completeProject && (
                <Tick
                  id="confirm-complete"
                  checked={complete}
                  onChange={(value) => {
                    setComplete(value);
                    if (value && choice === "SHARE") setChoice("FINAL");
                  }}
                  label={`Also complete ${project.code}`}
                  hint={`${formatCount(project.received, currency)} of ${formatCount(project.target, currency)} pieces were received before this one. Completing takes all that is left of its cost.`}
                />
              )}
              {showZero && (
                <div className="grid gap-2">
                  <Tick
                    id="confirm-zero"
                    checked={zero}
                    onChange={setZero}
                    label="Receive them at zero cost"
                    hint="Costs recorded on the project later go with its next deliveries."
                  />
                  {fieldError("zero") && (
                    <p className="text-[0.8125rem] text-destructive">{fieldError("zero")}</p>
                  )}
                </div>
              )}
            </>
          )}
        </FormDialog>
      )}

      {open === "cancel" && (
        <ConfirmDialog
          title={`Cancel ${d.number}?`}
          description="Nothing went into stock from it. It stays on record as cancelled."
          confirmLabel="Cancel the draft"
          pendingLabel="Cancelling"
          destructive
          errorTitle="We could not cancel the delivery"
          onClose={close}
          onConfirm={async () => {
            const result = await cancelIntakeAction(d.id);
            if (!result.ok) return result.error;
            done(`${d.number} was cancelled.`);
          }}
        />
      )}

      {open === "undo" && (
        <FormDialog
          title={`Undo ${d.number}?`}
          description={`Its ${formatCount(d.pieces.total, currency)} pieces leave ${d.warehouse ?? "the warehouse"}${
            costs ? " and the cost they carried goes back to the project" : ""
          }.${project?.status === "COMPLETED" ? ` ${project.code} opens again until its goods are received.` : ""}`}
          submitLabel="Undo the delivery"
          pendingLabel="Undoing"
          destructive
          errorTitle="We could not undo the delivery"
          onClose={close}
          onSubmit={async (form) => {
            const reason = readReason(form, 5);
            if (typeof reason !== "string") return reason;
            const result = await reverseIntakeAction(d.id, { reason, redraft });
            if (!result.ok) return result.error;
            if (result.data.redraft) {
              router.push(`${productionHref.delivery(result.data.redraft.id)}?redrafted=1`);
              return;
            }
            done(`${d.number} was undone; its pieces left stock.`);
          }}
        >
          {(fieldError) => (
            <>
              <ReasonField
                id="undo-reason"
                hint="Like: counted 20 polos as M that were L. Kept in the activity log."
                min={5}
                error={fieldError("reason")}
              />
              <Tick
                id="undo-redraft"
                checked={redraft}
                onChange={setRedraft}
                label="Open a copy to correct"
                hint="A new draft with the same pieces, to fix and confirm again."
              />
            </>
          )}
        </FormDialog>
      )}
    </div>
  );
}
