"use client";

import { BanIcon, CheckIcon, EllipsisVerticalIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ActionErrorDialog } from "@/components/feedback/action-error-dialog";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { FormAlert } from "@/components/forms/field";
import { useNotice } from "@/components/hr/use-notice";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ActionError } from "@/lib/result";
import type { ReminderScreen } from "@/modules/reminders/screens.service";
import {
  acknowledgeReminderAction,
  cancelReminderAction,
  deleteReminderAction,
} from "@/server/actions/reminders.actions";

import { plannerHref, whenText } from "./labels";
import { ReminderDialog } from "./reminder-form";

/**
 * What may be done with a reminder, from the flags its screen came with: mark
 * one that went out as dealt with, and, for whoever set it (or
 * reminders.manage), change, cancel or delete one set by hand.
 */
export function ReminderActions({
  screen,
  me,
  today,
  notice: initial,
}: {
  screen: ReminderScreen;
  me: { id: string; name: string };
  today: string;
  notice?: string;
}) {
  const router = useRouter();
  const { reminder: r, can } = screen;
  const [open, setOpen] = useState<"edit" | "cancel" | "delete" | null>(null);
  const [notice, setNotice] = useNotice(initial);
  const [error, setError] = useState<ActionError>();
  const [pending, startTransition] = useTransition();
  const close = () => setOpen(null);
  const menu = can.cancel || can.delete;

  function dealtWith() {
    startTransition(async () => {
      const result = await acknowledgeReminderAction(r.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice(
        r.repeat && result.data.status === "SCHEDULED"
          ? `Marked as dealt with. It next goes out on ${whenText(result.data.day, result.data.time)}.`
          : "Marked as dealt with.",
      );
    });
  }

  if (!can.acknowledge && !can.edit && !menu) {
    return notice ? <FormAlert tone="success">{notice}</FormAlert> : null;
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {can.acknowledge && (
          <Button type="button" className="w-full sm:w-auto" disabled={pending} onClick={dealtWith}>
            <CheckIcon aria-hidden />
            {pending ? "Saving" : "Dealt with"}
          </Button>
        )}
        {(can.edit || menu) && (
          <div className="flex gap-2">
            {can.edit && (
              <Button
                type="button"
                variant="outline"
                className="flex-1 sm:flex-none"
                onClick={() => setOpen("edit")}
              >
                <PencilIcon aria-hidden />
                Change
              </Button>
            )}
            {menu && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label={`More for ${r.title}`}>
                    <EllipsisVerticalIcon aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {can.cancel && (
                    <DropdownMenuItem onSelect={() => setOpen("cancel")}>
                      <BanIcon aria-hidden />
                      Cancel the reminder
                    </DropdownMenuItem>
                  )}
                  {can.delete && (
                    <DropdownMenuItem variant="destructive" onSelect={() => setOpen("delete")}>
                      <Trash2Icon aria-hidden />
                      Delete
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
      </div>

      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      {open === "edit" && (
        <ReminderDialog
          reminder={r}
          me={me}
          others={can.others}
          today={today}
          onClose={close}
          onDone={(message) => {
            setNotice(message);
            close();
          }}
        />
      )}
      {open === "cancel" && (
        <ConfirmDialog
          title="Cancel this reminder?"
          description={
            r.repeat
              ? "It stops repeating and does not go out again. It stays on the list as cancelled."
              : "It does not go out. It stays on the list as cancelled."
          }
          confirmLabel="Cancel the reminder"
          pendingLabel="Cancelling"
          destructive
          errorTitle="We could not cancel the reminder"
          onClose={close}
          onConfirm={async () => {
            const result = await cancelReminderAction(r.id);
            if (!result.ok) return result.error;
            setNotice("The reminder is cancelled.");
            close();
          }}
        />
      )}
      {open === "delete" && (
        <ConfirmDialog
          title="Delete this reminder?"
          description="It is removed for good; messages it already sent stay in people's inboxes. Cancel it instead to keep it on record."
          confirmLabel="Delete the reminder"
          pendingLabel="Deleting"
          destructive
          errorTitle="We could not delete the reminder"
          onClose={close}
          onConfirm={async () => {
            const result = await deleteReminderAction(r.id);
            if (!result.ok) return result.error;
            router.push(plannerHref.reminders);
          }}
        />
      )}
      <ActionErrorDialog
        error={error}
        title="We could not mark the reminder"
        onClose={() => setError(undefined)}
      />
    </div>
  );
}
