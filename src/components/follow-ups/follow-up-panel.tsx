"use client";

import { LoaderCircleIcon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { FollowUpActions } from "@/components/follow-ups/follow-up-actions";
import { Field, FormAlert } from "@/components/forms/field";
import { Panel } from "@/components/sales/detail-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addDays } from "@/lib/dates";
import { formatDay } from "@/lib/display";
import type { ActionError } from "@/lib/result";
import type { FollowUpItem } from "@/modules/reminders/follow-up.service";
import { createFollowUpAction } from "@/server/actions/reminders.actions";

/**
 * "Follow-ups" on a buyer, a quotation or an order: the open "Follow up on"
 * dates with their notes ("Done" and "Snooze" on each), and a short form to
 * add one. On that day a reminder comes to the person who set it and the owner
 * (inbox, and the owner's bot). Nothing goes to the buyer.
 */
export function FollowUpPanel({
  on,
  items,
  today,
  what,
}: {
  on: { partyId: string } | { quotationId: string } | { orderId: string };
  items: FollowUpItem[];
  /** Today in company time. */
  today: string;
  /** What it is about, for the buttons' spoken names ("Rahim Traders"). */
  what: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError>();
  const [formKey, setFormKey] = useState(0);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await createFollowUpAction({
        ...on,
        dueOn: String(form.get("dueOn") ?? ""),
        note: String(form.get("note") ?? ""),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(undefined);
      setFormKey((k) => k + 1);
      router.refresh();
    });
  }

  const fieldError = (name: string) => error?.fieldErrors?.[name]?.[0];

  return (
    <Panel title="Follow-ups" id="follow-ups-heading">
      {items.length > 0 && (
        <ul className="mt-4 grid grid-cols-1 divide-y">
          {items.map((item) => (
            <li key={item.id} className="grid min-w-0 gap-2 py-3 text-sm first:pt-0">
              <p>
                <span className="font-medium">{formatDay(item.dueOn)}</span>
                {item.daysLeft < 0 && <span className="ml-2 text-destructive">Overdue</span>}
                {item.note && <span className="text-muted-foreground"> · {item.note}</span>}
              </p>
              <FollowUpActions
                mark={{ target: "followUp", id: item.id }}
                today={today}
                what={`${what}, ${formatDay(item.dueOn)}`}
              />
            </li>
          ))}
        </ul>
      )}
      <form
        key={formKey}
        onSubmit={submit}
        className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)] sm:items-start"
        noValidate
      >
        <Field id="follow-up-on" label="Follow up on" error={fieldError("dueOn")}>
          <Input
            id="follow-up-on"
            name="dueOn"
            type="date"
            min={today}
            defaultValue={addDays(today, 3)}
            required
          />
        </Field>
        <Field id="follow-up-note" label="Note" error={fieldError("note")}>
          <Input
            id="follow-up-note"
            name="note"
            maxLength={300}
            placeholder="Ask about the sample approval"
          />
        </Field>
        {error && !error.fieldErrors && (
          <div className="sm:col-span-2">
            <FormAlert>{error.message}</FormAlert>
          </div>
        )}
        <div className="sm:col-span-2">
          <Button type="submit" variant="outline" disabled={pending} className="w-full sm:w-auto">
            {pending ? (
              <LoaderCircleIcon className="animate-spin" aria-hidden />
            ) : (
              <PlusIcon aria-hidden />
            )}
            Add the follow-up
          </Button>
        </div>
      </form>
      <p className="mt-3 text-[0.8125rem] text-muted-foreground">
        A reminder comes to you and the owner on that day. Nothing goes to the buyer.
      </p>
    </Panel>
  );
}
