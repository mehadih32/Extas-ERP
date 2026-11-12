"use client";

import { CalendarClockIcon, CheckIcon, Undo2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDay } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { orderTa } from "@/modules/ta/ta.service";
import { COLOUR_WORDS, type TaColour } from "@/modules/ta/ta-rules";
import { changeTaDateAction, markTaDoneAction } from "@/server/actions/ta.actions";

type OrderTa = Awaited<ReturnType<typeof orderTa>>;
type Step = OrderTa["steps"][number];

export const COLOUR_CLASS: Record<TaColour, string> = {
  done: "border-emerald-600/40 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300",
  green: "border-emerald-600/40 text-emerald-800 dark:text-emerald-300",
  yellow: "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  red: "border-destructive/50 bg-destructive/10 text-destructive",
};

export function ColourChip({ colour }: { colour: TaColour }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[0.75rem] font-medium",
        COLOUR_CLASS[colour],
      )}
    >
      {COLOUR_WORDS[colour]}
    </span>
  );
}

/** The order's T&A: each step, its day and colour, with Change day and Mark done. */
export function OrderTaPanel({ ta, orderNumber }: { ta: OrderTa; orderNumber: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Step | null>(null);
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();

  function tick(step: Step, done: boolean) {
    startTransition(async () => {
      const result = await markTaDoneAction({ stepId: step.id, done });
      if (!result.ok) setMessage(result.error.message);
      else {
        setMessage(undefined);
        router.refresh();
      }
    });
  }

  return (
    <section aria-labelledby="ta-heading" className="min-w-0 rounded-lg border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="ta-heading" className="font-serif text-xl text-primary">
          T&amp;A
        </h3>
        <Link
          href="/production/ta-calendar"
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Open the T&amp;A calendar
        </Link>
      </div>
      {!ta.shipOn ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No ship date yet. Give the order a ship date and its T&amp;A is made from the company
          template.
        </p>
      ) : (
        <>
          {ta.atRisk && (
            <div className="mt-4">
              <FormAlert>Ship date at risk: a step on the critical path is late.</FormAlert>
            </div>
          )}
          {message && (
            <div className="mt-4">
              <FormAlert>{message}</FormAlert>
            </div>
          )}
          <ol className="mt-4 grid grid-cols-1 divide-y">
            {ta.steps.map((step) => (
              <li key={step.id} className="grid gap-2 py-3 first:pt-0 last:pb-0">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 text-sm font-medium break-words">{step.name}</span>
                  <ColourChip colour={step.colour} />
                </div>
                <p className="text-[0.8125rem] text-muted-foreground">
                  {step.done
                    ? `Done ${formatDay(step.doneOn!)}${
                        step.doneHow === "AUTO"
                          ? ` · ${step.factLabel ?? "from the ERP"}`
                          : step.doneBy
                            ? ` · ticked by ${step.doneBy}`
                            : ""
                      }`
                    : `Due ${formatDay(step.dueOn)}`}
                  {step.dueChanged && !step.done
                    ? ` · changed from ${formatDay(step.plannedOn)}`
                    : ""}
                  {!step.done && step.factLabel ? ` · ticks itself: ${step.factLabel}` : ""}
                </p>
                {ta.can.manage && (
                  <div className="flex flex-wrap gap-2">
                    {!step.done && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => setEditing(step)}
                      >
                        <CalendarClockIcon aria-hidden />
                        Change day
                      </Button>
                    )}
                    {!step.done && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => tick(step, true)}
                      >
                        <CheckIcon aria-hidden />
                        Mark done
                      </Button>
                    )}
                    {step.done && step.doneHow === "MANUAL" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => tick(step, false)}
                      >
                        <Undo2Icon aria-hidden />
                        Not done
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
      {editing && (
        <FormDialog
          title="Change day"
          description={`"${editing.name}" of order ${orderNumber}. The change is kept in the activity log; a later ship date change leaves this day as you set it.`}
          submitLabel="Save the day"
          pendingLabel="Saving"
          errorTitle="We could not change the day"
          onClose={() => setEditing(null)}
          onSubmit={async (form) => {
            const result = await changeTaDateAction({
              stepId: editing.id,
              dueOn: String(form.get("dueOn") ?? ""),
              reason: String(form.get("reason") ?? "").trim() || undefined,
            });
            if (!result.ok) return result.error;
            setEditing(null);
            router.refresh();
            return undefined;
          }}
        >
          {(fieldError) => (
            <>
              <Field id="ta-due" label="Due on" error={fieldError("dueOn")}>
                <Input id="ta-due" name="dueOn" type="date" defaultValue={editing.dueOn} required />
              </Field>
              <Field id="ta-reason" label="Why" error={fieldError("reason")}>
                <Input id="ta-reason" name="reason" maxLength={300} />
              </Field>
            </>
          )}
        </FormDialog>
      )}
    </section>
  );
}
