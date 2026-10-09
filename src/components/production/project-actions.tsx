"use client";

import type { ProductionStage } from "@prisma/client";
import {
  ArrowRightIcon,
  BanIcon,
  CircleCheckBigIcon,
  EllipsisVerticalIcon,
  FileTextIcon,
  PackageCheckIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  Undo2Icon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { textOf } from "@/components/products/form-values";
import { FormDialog, problem, readReason, ReasonField } from "@/components/sales/dialogs";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatCount } from "@/lib/display";
import type { ProjectScreen } from "@/modules/production/screens.service";
import {
  cancelProjectAction,
  completeProjectAction,
  setProjectStageAction,
  setProjectStatusAction,
} from "@/server/actions/production.actions";

import { AddCostDialog } from "./cost-dialogs";
import { productionHref, STAGE_LABELS } from "./labels";

type Open = "next" | "stage" | "start" | "hold" | "resume" | "complete" | "cancel" | "cost" | null;

function NoteField({
  id,
  label = "Note (optional)",
  hint,
  required = false,
  error,
}: {
  id: string;
  label?: string;
  hint?: string;
  required?: boolean;
  error?: string;
}) {
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <Textarea
        id={id}
        name="note"
        rows={2}
        maxLength={1000}
        required={required}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
      />
    </Field>
  );
}

/**
 * What can be done with a production project, each offered from the flags the
 * screen came with (screen.can, from production/rules.ts): Production Managers
 * move its stage, hold, resume, edit, complete and cancel it; Production and
 * Accounts add costs (paying now is Accounts'); the store receives its goods.
 * Completing or cancelling with cost left in production writes it off, which
 * only Accounts may do.
 */
export function ProjectActions({
  screen,
  currency,
  notice: initialNotice,
}: {
  screen: ProjectScreen;
  currency: string;
  notice?: string;
}) {
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useState(initialNotice);
  const [stage, setStage] = useState<ProductionStage | "">("");
  const { project: p, can } = screen;
  const close = () => setOpen(null);
  const done = (message: string) => {
    setNotice(message);
    close();
  };

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 10_000);
    return () => clearTimeout(timer);
  }, [notice]);

  // The next stage forward, the usual move; going back or skipping is under "Change stage".
  // The stage names people read here, not the server's own spelling.
  const moves = can.stages.map((m) => ({ ...m, label: STAGE_LABELS[m.stage] }));
  const currentIndex = p.steps.findIndex((s) => s.stage === p.stage.key);
  const next = moves.find(
    (m) => p.steps.findIndex((s) => s.stage === m.stage) === currentIndex + 1,
  );
  const completeFirst = can.complete && !next;
  const chosen = moves.find((m) => m.stage === stage);
  const addCost = can.addDueCost || can.addPaidCost;
  const wipText = can.writeOff?.amount ? money(can.writeOff.amount, currency) : "Some cost";
  const menu =
    moves.length > 0 ||
    addCost ||
    can.newBill ||
    can.hold ||
    (can.complete && !completeFirst) ||
    can.cancel;

  const primary = can.start
    ? { label: "Start production", icon: PlayIcon, open: "start" as const }
    : can.resume
      ? { label: "Resume production", icon: PlayIcon, open: "resume" as const }
      : next
        ? { label: `Move to ${next.label}`, icon: ArrowRightIcon, open: "next" as const }
        : completeFirst
          ? { label: "Complete the project", icon: CircleCheckBigIcon, open: "complete" as const }
          : null;

  return (
    <div className="grid gap-4">
      {(primary || can.receive || can.edit || menu) && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {primary && (
            <Button
              type="button"
              className="w-full sm:w-auto"
              onClick={() => setOpen(primary.open)}
            >
              <primary.icon aria-hidden />
              {primary.label}
            </Button>
          )}
          {can.receive && (
            <Button asChild variant={primary ? "outline" : "default"} className="w-full sm:w-auto">
              <Link
                href={
                  can.openDelivery
                    ? productionHref.delivery(can.openDelivery.id)
                    : productionHref.newDelivery(p.id)
                }
              >
                <PackageCheckIcon aria-hidden />
                {can.openDelivery
                  ? `Continue delivery ${can.openDelivery.number}`
                  : "Receive goods"}
              </Link>
            </Button>
          )}
          {(can.edit || menu) && (
            <div className="flex gap-2">
              {can.edit && (
                <Button asChild variant="outline" className="flex-1 sm:flex-none">
                  <Link href={`${productionHref.project(p.id)}/edit`}>
                    <PencilIcon aria-hidden />
                    Edit
                  </Link>
                </Button>
              )}
              {menu && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size={can.edit ? "icon" : "default"}
                      className={can.edit ? undefined : "flex-1 sm:flex-none"}
                      aria-label={`More for ${p.code}`}
                    >
                      <EllipsisVerticalIcon aria-hidden />
                      {!can.edit && "More"}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    {moves.length > 0 && (
                      <DropdownMenuItem onSelect={() => setOpen("stage")}>
                        <Undo2Icon aria-hidden />
                        Change the stage
                      </DropdownMenuItem>
                    )}
                    {addCost && (
                      <DropdownMenuItem onSelect={() => setOpen("cost")}>
                        <PlusIcon aria-hidden />
                        Add a cost
                      </DropdownMenuItem>
                    )}
                    {can.newBill && (
                      <DropdownMenuItem asChild>
                        <Link href={productionHref.newBill(p.id)}>
                          <FileTextIcon aria-hidden />
                          Enter a supplier bill
                        </Link>
                      </DropdownMenuItem>
                    )}
                    {can.hold && (
                      <DropdownMenuItem onSelect={() => setOpen("hold")}>
                        <PauseIcon aria-hidden />
                        Put on hold
                      </DropdownMenuItem>
                    )}
                    {can.complete && !completeFirst && (
                      <DropdownMenuItem onSelect={() => setOpen("complete")}>
                        <CircleCheckBigIcon aria-hidden />
                        Complete the project
                      </DropdownMenuItem>
                    )}
                    {can.cancel && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => setOpen("cancel")}>
                          <BanIcon aria-hidden />
                          Cancel the project
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          )}
        </div>
      )}

      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      {open === "next" && next && (
        <FormDialog
          title={`Move ${p.code} to ${next.label}?`}
          description={`${STAGE_LABELS[p.stage.key]} is done and ${next.label.charAt(0).toLowerCase()}${next.label.slice(1)} starts today.`}
          submitLabel={`Move to ${next.label}`}
          pendingLabel="Moving"
          errorTitle="We could not move the stage"
          onClose={close}
          onSubmit={async (form) => {
            const result = await setProjectStageAction(p.id, {
              stage: next.stage,
              note: textOf(form, "note") || undefined,
            });
            if (!result.ok) return result.error;
            done(`${p.code} moved to ${next.label}.`);
          }}
        >
          {(fieldError) => (
            <NoteField
              id="next-note"
              hint="Anything to remember about this stage, like pieces cut."
              error={fieldError("note")}
            />
          )}
        </FormDialog>
      )}

      {open === "stage" && (
        <FormDialog
          title={`Change ${p.code}'s stage`}
          description={`It is at ${STAGE_LABELS[p.stage.key]}. Going back a stage is rework and needs a note saying why.`}
          submitLabel="Change the stage"
          pendingLabel="Changing"
          errorTitle="We could not change the stage"
          onClose={() => {
            setStage("");
            close();
          }}
          onSubmit={async (form) => {
            if (!chosen) return problem({ stage: "Choose the stage it moves to." });
            const note = textOf(form, "note");
            if (chosen.back && note.length < 3) {
              return problem({ note: "Say why it goes back a stage." });
            }
            const result = await setProjectStageAction(p.id, {
              stage: chosen.stage,
              note: note || undefined,
            });
            if (!result.ok) return result.error;
            setStage("");
            done(
              chosen.back
                ? `${p.code} went back to ${chosen.label} for rework.`
                : `${p.code} moved to ${chosen.label}.`,
            );
          }}
        >
          {(fieldError) => (
            <>
              <Field id="stage-to" label="Move to" error={fieldError("stage")}>
                <NativeSelect
                  id="stage-to"
                  value={stage}
                  onChange={(e) => setStage(e.target.value as ProductionStage | "")}
                  containerClassName="sm:w-full"
                  aria-invalid={Boolean(fieldError("stage"))}
                  aria-describedby={fieldError("stage") ? "stage-to-error" : undefined}
                >
                  <option value="" disabled>
                    Choose a stage
                  </option>
                  {moves.map((m) => (
                    <option key={m.stage} value={m.stage}>
                      {m.back ? `${m.label} (back, for rework)` : m.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <NoteField
                id="stage-note"
                label={chosen?.back ? "Why it goes back" : "Note (optional)"}
                hint={chosen?.back ? "Like: 40 pieces failed QC and need resewing." : undefined}
                required={Boolean(chosen?.back)}
                error={fieldError("note")}
              />
            </>
          )}
        </FormDialog>
      )}

      {(open === "start" || open === "resume" || open === "hold") && (
        <FormDialog
          title={
            open === "start"
              ? `Start ${p.code}?`
              : open === "resume"
                ? `Resume ${p.code}?`
                : `Put ${p.code} on hold?`
          }
          description={
            open === "start"
              ? `It starts at ${STAGE_LABELS[p.stage.key]} today, and its days start counting.`
              : open === "resume"
                ? `It carries on at ${STAGE_LABELS[p.stage.key]}.`
                : "Its stage stays where it is until it is resumed. The target day does not move."
          }
          submitLabel={
            open === "start" ? "Start production" : open === "resume" ? "Resume" : "Put on hold"
          }
          pendingLabel="Saving"
          errorTitle="We could not change the project"
          onClose={close}
          onSubmit={async (form) => {
            const result = await setProjectStatusAction(p.id, {
              status: open === "hold" ? "ON_HOLD" : "ACTIVE",
              note: textOf(form, "note") || undefined,
            });
            if (!result.ok) return result.error;
            done(
              open === "start"
                ? `${p.code} has started.`
                : open === "resume"
                  ? `${p.code} is back in production.`
                  : `${p.code} is on hold.`,
            );
          }}
        >
          {(fieldError) => (
            <NoteField
              id="status-note"
              hint={open === "hold" ? "Like: waiting for fabric." : undefined}
              error={fieldError("note")}
            />
          )}
        </FormDialog>
      )}

      {open === "complete" && (
        <FormDialog
          title={`Complete ${p.code}?`}
          description={
            <>
              {formatCount(p.quantities.produced, currency)} of{" "}
              {formatCount(p.quantities.target, currency)} pieces are in stock
              {p.quantities.remaining > 0
                ? `; the other ${formatCount(p.quantities.remaining, currency)} will not be received.`
                : "."}{" "}
              {can.writeOff
                ? `${wipText} has not moved into stock with its pieces; completing writes it off as a production loss.`
                : "No more costs or deliveries can be added after this."}
            </>
          }
          submitLabel="Complete the project"
          pendingLabel="Completing"
          errorTitle="We could not complete the project"
          onClose={close}
          onSubmit={async (form) => {
            let writeOffReason: string | undefined;
            if (can.writeOff) {
              const reason = readReason(form, 5);
              if (typeof reason !== "string") return reason;
              writeOffReason = reason;
            }
            const result = await completeProjectAction(p.id, {
              writeOffReason,
              note: textOf(form, "note") || undefined,
            });
            if (!result.ok) return result.error;
            done(`${p.code} is completed.`);
          }}
        >
          {(fieldError) => (
            <>
              {can.writeOff && (
                <ReasonField
                  id="complete-reason"
                  label="Why the rest is written off"
                  hint="Like: the factory delivered 60 pieces short. Kept with the loss."
                  min={5}
                  error={fieldError("reason") ?? fieldError("writeOffReason")}
                />
              )}
              <NoteField id="complete-note" error={fieldError("note")} />
            </>
          )}
        </FormDialog>
      )}

      {open === "cancel" && (
        <FormDialog
          title={`Cancel ${p.code}?`}
          description={
            <>
              It stops here and stays on record as cancelled.
              {can.openDelivery &&
                ` Its draft delivery ${can.openDelivery.number} is cancelled too.`}
              {can.writeOff &&
                ` ${wipText} spent on it has not reached stock and is written off as a production loss.`}
            </>
          }
          submitLabel="Cancel the project"
          pendingLabel="Cancelling"
          destructive
          errorTitle="We could not cancel the project"
          onClose={close}
          onSubmit={async (form) => {
            const reason = readReason(form, 5);
            if (typeof reason !== "string") return reason;
            const result = await cancelProjectAction(p.id, { reason });
            if (!result.ok) return result.error;
            done(`${p.code} was cancelled.`);
          }}
        >
          {(fieldError) => <ReasonField id="cancel-reason" min={5} error={fieldError("reason")} />}
        </FormDialog>
      )}

      {open === "cost" && (
        <AddCostDialog
          project={{ id: p.id, code: p.code }}
          canPayNow={can.addPaidCost}
          canManageHeads={can.edit}
          currency={currency}
          onDone={done}
          onClose={close}
        />
      )}
    </div>
  );
}
