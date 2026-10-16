"use client";

import { LockIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Field } from "@/components/forms/field";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ActionError, ActionResult } from "@/lib/result";

/*
 * The PIN on the ERP's screens. Money, prices, deletions and locked cells going
 * to Do ask for it on every path: the server answers "pin" (give it) or
 * "pinNotSet" (set one first in AI Center > Settings), and this asks for it and
 * runs the same work again with it. Cancelling changes nothing.
 */

type Asking = {
  message: string;
  notSet: boolean;
  retry: (pin: string) => Promise<ActionResult<unknown>>;
  resolve: (result: ActionResult<unknown>) => void;
  first: ActionError;
};

const STOPPED: ActionError = { code: "VALIDATION", message: "Stopped: nothing changed." };

/** Whether an answer from the server asks for the PIN. */
export const asksForPin = (error: ActionError) =>
  Boolean(error.fieldErrors?.pin || error.fieldErrors?.pinNotSet);

/** A small PIN field (4 to 8 digits, never shown). */
export function PinField({
  id,
  name = "pin",
  error,
  hint,
}: {
  id: string;
  name?: string;
  error?: string;
  hint?: string;
}) {
  return (
    <Field id={id} label="PIN" error={error} hint={hint}>
      <Input
        id={id}
        name={name}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={8}
      />
    </Field>
  );
}

export function usePinPrompt() {
  const [asking, setAsking] = useState<Asking | null>(null);

  /** Runs the work; when the server asks for the PIN, asks for it and runs the work again. */
  function withPin<T>(work: (pin?: string) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
    return work().then(
      (first) =>
        new Promise<ActionResult<T>>((resolve) => {
          if (first.ok || !asksForPin(first.error)) return resolve(first);
          setAsking({
            message: first.error.message,
            notSet: Boolean(first.error.fieldErrors?.pinNotSet),
            retry: work as (pin: string) => Promise<ActionResult<unknown>>,
            resolve: resolve as (result: ActionResult<unknown>) => void,
            first: first.error,
          });
        }),
    );
  }

  const close = (result: ActionResult<unknown>) => {
    asking?.resolve(result);
    setAsking(null);
  };

  const dialog = asking ? (
    asking.notSet ? (
      <Dialog open onOpenChange={(open) => !open && close({ ok: false, error: asking.first })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set your PIN first</DialogTitle>
            <DialogDescription>{asking.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => close({ ok: false, error: asking.first })}
            >
              Close
            </Button>
            <Button asChild>
              <Link href="/ai/settings">
                <LockIcon aria-hidden />
                Set a PIN
              </Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    ) : (
      <FormDialog
        title="Your PIN"
        description={asking.message}
        submitLabel="Go on"
        pendingLabel="Checking"
        errorTitle="We could not finish it"
        onClose={() => close({ ok: false, error: STOPPED })}
        onSubmit={async (form) => {
          const result = await asking.retry(String(form.get("pin") ?? ""));
          if (!result.ok && asksForPin(result.error)) return result.error;
          close(result);
        }}
      >
        {(fieldError) => <PinField id="pin-prompt" error={fieldError("pin")} />}
      </FormDialog>
    )
  ) : null;

  return { withPin, dialog };
}
