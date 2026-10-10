"use client";

import { BellPlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Field } from "@/components/forms/field";
import { textOf } from "@/components/products/form-values";
import { FormDialog, problem } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ReminderView } from "@/modules/reminders/reminder.service";
import { createReminderAction, updateReminderAction } from "@/server/actions/reminders.actions";

import { plannerHref, REPEAT_LABELS, REPEAT_UNITS, type RepeatUnit, whenText } from "./labels";
import { type PersonChip, PeoplePicker } from "./pickers";

const UNIT_WORDS: Record<RepeatUnit, string> = {
  DAY: "days",
  WEEK: "weeks",
  MONTH: "months",
  YEAR: "years",
};

/**
 * Sets or changes a reminder: what, when (a day and time in company time),
 * whether it repeats, and, for people who may remind others
 * (reminders.manage), who hears about it. Without anyone chosen it is for the
 * person setting it. It goes out in the app; WhatsApp and email come later.
 */
export function ReminderDialog({
  reminder,
  me,
  others,
  today,
  onDone,
  onClose,
}: {
  /** The reminder being changed; a new one without it. */
  reminder?: ReminderView;
  me: { id: string; name: string };
  /** May remind other people (reminders.manage). */
  others: boolean;
  today: string;
  onDone: (message: string, id: string) => void;
  onClose: () => void;
}) {
  const [repeat, setRepeat] = useState<RepeatUnit | "">(reminder?.repeat?.every ?? "");
  const [people, setPeople] = useState<PersonChip[]>(() =>
    reminder
      ? reminder.recipients.flatMap((r) =>
          r.id
            ? [
                {
                  kind: r.kind,
                  id: r.id,
                  name:
                    r.id === me.id && r.kind === "user"
                      ? `${r.name ?? me.name} (you)`
                      : (r.name ?? ""),
                  ...(r.inApp ? {} : { note: "no login yet" }),
                },
              ]
            : [],
        )
      : [{ kind: "user", id: me.id, name: `${me.name} (you)` }],
  );
  const editing = Boolean(reminder);

  return (
    <FormDialog
      title={editing ? "Change the reminder" : "Add a reminder"}
      description={
        others
          ? "It goes out in the app to the people chosen, at the time set."
          : "It goes out to you in the app at the time set."
      }
      submitLabel={editing ? "Save the reminder" : "Add the reminder"}
      pendingLabel="Saving"
      errorTitle="We could not save the reminder"
      onClose={onClose}
      onSubmit={async (form) => {
        const title = textOf(form, "title");
        if (title.length < 2) return problem({ title: "Write what to remind about." });
        const day = textOf(form, "day");
        if (!day) return problem({ day: "Pick the day." });
        const time = textOf(form, "time") || "09:00";
        let repeatInput = null;
        if (repeat) {
          const interval = Number(textOf(form, "interval") || "1");
          if (!Number.isInteger(interval) || interval < 1 || interval > 365) {
            return problem({ "repeat.interval": "A whole number from 1 to 365." });
          }
          const until = textOf(form, "until");
          repeatInput = { every: repeat, interval, ...(until ? { until } : {}) };
        }
        const recipients = others
          ? {
              userIds: people.filter((p) => p.kind === "user").map((p) => p.id),
              employeeIds: people.filter((p) => p.kind === "employee").map((p) => p.id),
            }
          : {};
        if (others && people.length === 0) {
          return problem({ userIds: "Choose who hears about it." });
        }
        const input = {
          title,
          message: textOf(form, "message") || null,
          day,
          time,
          repeat: repeatInput,
          ...recipients,
        };
        const result = reminder
          ? await updateReminderAction(reminder.id, input)
          : await createReminderAction(input);
        if (!result.ok) return result.error;
        onDone(
          `${editing ? "Saved" : "Added"}: "${result.data.title}" goes out ${whenText(result.data.day, result.data.time)}.`,
          result.data.id,
        );
      }}
    >
      {(fieldError) => (
        <>
          <Field id="reminder-title" label="Remind about" error={fieldError("title")}>
            <Input
              id="reminder-title"
              name="title"
              defaultValue={reminder?.title}
              maxLength={200}
              placeholder="Call Rahim Traders about the advance"
              autoComplete="off"
              aria-invalid={Boolean(fieldError("title"))}
              aria-describedby={fieldError("title") ? "reminder-title-error" : undefined}
            />
          </Field>
          <Field id="reminder-message" label="Note (optional)" error={fieldError("message")}>
            <Textarea
              id="reminder-message"
              name="message"
              rows={2}
              maxLength={2000}
              defaultValue={reminder?.message ?? ""}
            />
          </Field>
          <div className="grid items-start gap-5 sm:grid-cols-2">
            <Field
              id="reminder-day"
              label="Day"
              error={fieldError("day") ?? fieldError("remindAt")}
            >
              <Input
                id="reminder-day"
                name="day"
                type="date"
                min={today}
                defaultValue={reminder?.day ?? today}
                aria-invalid={Boolean(fieldError("day") ?? fieldError("remindAt"))}
              />
            </Field>
            <Field id="reminder-time" label="Time" error={fieldError("time")}>
              <Input
                id="reminder-time"
                name="time"
                type="time"
                defaultValue={reminder?.time ?? "09:00"}
              />
            </Field>
          </div>
          <Field id="reminder-repeat" label="Repeats">
            <NativeSelect
              id="reminder-repeat"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value as RepeatUnit | "")}
              containerClassName="sm:w-full"
            >
              <option value="">Does not repeat</option>
              {REPEAT_UNITS.map((u) => (
                <option key={u} value={u}>
                  {REPEAT_LABELS[u]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {repeat && (
            <div className="grid items-start gap-5 sm:grid-cols-2">
              <Field
                id="reminder-interval"
                label={`Every how many ${UNIT_WORDS[repeat]}`}
                error={fieldError("repeat.interval")}
              >
                <Input
                  id="reminder-interval"
                  name="interval"
                  inputMode="numeric"
                  defaultValue={reminder?.repeat?.interval ?? 1}
                  aria-invalid={Boolean(fieldError("repeat.interval"))}
                />
              </Field>
              <Field
                id="reminder-until"
                label="Last day (optional)"
                hint="Leave empty to repeat until cancelled."
                error={fieldError("repeat.until")}
              >
                <Input
                  id="reminder-until"
                  name="until"
                  type="date"
                  min={today}
                  defaultValue={reminder?.repeat?.until ?? ""}
                  aria-describedby="reminder-until-hint"
                />
              </Field>
            </div>
          )}
          {others && (
            <Field
              id="reminder-people"
              label="Who hears about it"
              error={fieldError("userIds") ?? fieldError("employeeIds")}
            >
              <PeoplePicker
                id="reminder-people"
                label="Who hears about it"
                value={people}
                onChange={setPeople}
                emptyText="Nobody yet."
                invalid={Boolean(fieldError("userIds") ?? fieldError("employeeIds"))}
              />
            </Field>
          )}
        </>
      )}
    </FormDialog>
  );
}

/** "Add a reminder", opening the form; the new reminder's page opens once it is added. */
export function AddReminderButton({
  me,
  others,
  today,
  variant = "default",
  className,
}: {
  me: { id: string; name: string };
  others: boolean;
  today: string;
  variant?: "default" | "outline";
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant={variant} className={className} onClick={() => setOpen(true)}>
        <BellPlusIcon aria-hidden />
        Add a reminder
      </Button>
      {open && (
        <ReminderDialog
          me={me}
          others={others}
          today={today}
          onClose={() => setOpen(false)}
          onDone={(_message, id) => {
            setOpen(false);
            router.push(`${plannerHref.reminder(id)}?added=1`);
          }}
        />
      )}
    </>
  );
}
