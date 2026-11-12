"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { Panel } from "@/components/sales/detail-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDay } from "@/lib/display";
import type { ActionError } from "@/lib/result";
import { setPromisedPaymentAction } from "@/server/actions/reminders.actions";

/**
 * "Promised payment" on an unpaid invoice: the day the buyer said they would
 * pay, with a short note. A reminder comes that day to whoever wrote it down
 * and the owner, until the invoice is paid in full. No money moves.
 */
export function PromisePanel({
  invoiceId,
  promise,
  today,
  canEdit,
}: {
  invoiceId: string;
  promise: { on: string | null; note: string | null };
  today: string;
  /** Who may write it down (orders, invoices or money received). */
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError>();

  const save = (promisedPayOn: string | null, note: string) =>
    startTransition(async () => {
      const result = await setPromisedPaymentAction(invoiceId, { promisedPayOn, note });
      if (!result.ok) setError(result.error);
      else {
        setError(undefined);
        router.refresh();
      }
    });

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    save(String(form.get("promisedPayOn") ?? ""), String(form.get("promiseNote") ?? ""));
  }

  const late = promise.on !== null && promise.on < today;
  return (
    <Panel title="Promised payment" id="promise-heading">
      <p className="mt-4 text-sm">
        {promise.on ? (
          <>
            The buyer promised to pay on{" "}
            <span className={late ? "font-medium text-destructive" : "font-medium"}>
              {formatDay(promise.on)}
            </span>
            {promise.note ? ` · ${promise.note}` : ""}
          </>
        ) : (
          <span className="text-muted-foreground">No date promised yet.</span>
        )}
      </p>
      {canEdit && (
        <form onSubmit={submit} className="mt-4 grid gap-3" noValidate>
          <Field
            id="promised-pay-on"
            label="Promised payment date"
            error={error?.fieldErrors?.promisedPayOn?.[0]}
          >
            <Input
              id="promised-pay-on"
              name="promisedPayOn"
              type="date"
              defaultValue={promise.on ?? ""}
              required
            />
          </Field>
          <Field id="promise-note" label="Note" error={error?.fieldErrors?.note?.[0]}>
            <Input
              id="promise-note"
              name="promiseNote"
              maxLength={300}
              defaultValue={promise.note ?? ""}
              placeholder="Said on the phone with Mr. Rahim"
            />
          </Field>
          {error && !error.fieldErrors && <FormAlert>{error.message}</FormAlert>}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" variant="outline" disabled={pending}>
              {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
              Save the promise
            </Button>
            {promise.on && (
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => save(null, "")}
              >
                Clear the promise
              </Button>
            )}
          </div>
        </form>
      )}
    </Panel>
  );
}
