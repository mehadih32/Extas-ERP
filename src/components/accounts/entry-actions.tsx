"use client";

import { Undo2Icon } from "lucide-react";
import { useState } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { dayOrNow } from "@/components/production/cost-dialogs";
import { FormDialog, readReason, ReasonField } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { JournalEntryScreen } from "@/modules/accounts/screens.service";
import { reverseJournalVoucherAction } from "@/server/actions/accounts.actions";

import { useNotice } from "./money-actions";

/**
 * Reversing a journal voucher or a transfer, offered from the screen's flag
 * (accounts/rules.ts canReverseEntry): a mirror entry is posted and both stay
 * in the books. Entries other screens made are undone on those screens.
 */
export function EntryActions({
  screen,
  notice: initialNotice,
}: {
  screen: JournalEntryScreen;
  notice?: string;
}) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useNotice(initialNotice);
  const { entry, can, notes, today } = screen;

  if (!can.reverse && !notes.reverse && !notice) return null;

  return (
    <div className="grid gap-4">
      {can.reverse && (
        <div>
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => setOpen(true)}
          >
            <Undo2Icon aria-hidden />
            Reverse
          </Button>
        </div>
      )}
      {notes.reverse && <FormAlert tone="note">{notes.reverse}</FormAlert>}
      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      {open && (
        <FormDialog
          title={`Reverse ${entry.number}?`}
          description="A mirror entry is posted that cancels every line. Both stay in the books."
          submitLabel="Reverse it"
          pendingLabel="Reversing"
          destructive
          errorTitle="We could not reverse the entry"
          onClose={() => setOpen(false)}
          onSubmit={async (form) => {
            const reason = readReason(form, 5);
            if (typeof reason !== "string") return reason;
            const result = await reverseJournalVoucherAction(entry.id, {
              reason,
              date: dayOrNow(form, "date", today),
            });
            if (!result.ok) return result.error;
            setNotice(`${entry.number} was reversed with ${result.data.number}.`);
            setOpen(false);
          }}
        >
          {(fieldError) => (
            <>
              <ReasonField id="reverse-reason" min={5} error={fieldError("reason")} />
              <Field id="reverse-date" label="Date of the reversal" error={fieldError("date")}>
                <Input
                  id="reverse-date"
                  name="date"
                  type="date"
                  defaultValue={today}
                  min={entry.day}
                  max={today}
                />
              </Field>
            </>
          )}
        </FormDialog>
      )}
    </div>
  );
}
