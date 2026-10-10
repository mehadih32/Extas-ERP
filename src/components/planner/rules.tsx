"use client";

import { PencilIcon } from "lucide-react";
import { useState } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { useNotice } from "@/components/hr/use-notice";
import { textOf } from "@/components/products/form-values";
import { StatusBadge } from "@/components/sales/badges";
import { FormDialog, problem } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RuleRow } from "@/modules/reminders/screens.service";
import { updateReminderRuleAction } from "@/server/actions/reminders.actions";

import { daysBeforeText, overdueText, readDays, RULE_MANAGER_WORDS } from "./labels";
import { type PersonChip, PeoplePicker } from "./pickers";

const hasOwner = (rule: RuleRow) => rule.owner !== "(none)";

/** Who hears about one kind of automatic reminder, in words. */
export function ruleAudience(rule: RuleRow): string[] {
  const managers = RULE_MANAGER_WORDS[rule.type];
  return [
    ...(rule.notifyManagers && managers ? [managers] : []),
    ...(rule.notifyOwner && hasOwner(rule)
      ? [rule.owner.charAt(0).toUpperCase() + rule.owner.slice(1)]
      : []),
    ...rule.people.map((p) => ("note" in p && p.note ? `${p.name} (${p.note})` : p.name)),
  ];
}

function Check({
  name,
  defaultChecked,
  children,
  hint,
}: {
  name: string;
  defaultChecked: boolean;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1 text-sm md:min-h-9">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary"
      />
      <span>
        {children}
        {hint && <span className="block text-[0.8125rem] text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

/**
 * Changes one kind of automatic reminder (company.settings): on or off, the
 * days before the date, how often while overdue, the time it goes out, and
 * who hears about it.
 */
function RuleDialog({
  rule,
  onDone,
  onClose,
}: {
  rule: RuleRow;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const [people, setPeople] = useState<PersonChip[]>(
    rule.people.map((p) => ({
      kind: p.kind,
      id: p.id,
      name: p.name,
      ...("note" in p && p.note ? { note: p.note } : {}),
    })),
  );
  const managers = RULE_MANAGER_WORDS[rule.type];

  return (
    <FormDialog
      title={rule.label}
      description={`Watches ${rule.date}.`}
      submitLabel="Save"
      pendingLabel="Saving"
      errorTitle="We could not save the settings"
      onClose={onClose}
      onSubmit={async (form) => {
        const daysBefore = readDays(textOf(form, "daysBefore"));
        if (!daysBefore) {
          return problem({ daysBefore: "Whole numbers from 0 to 365, such as 7, 3, 1, 0." });
        }
        if (daysBefore.length > 10) return problem({ daysBefore: "Ten days at most." });
        const overdue = Number(textOf(form, "overdueEveryDays") || "0");
        if (!Number.isInteger(overdue) || overdue < 0 || overdue > 90) {
          return problem({ overdueEveryDays: "A whole number from 0 to 90." });
        }
        const result = await updateReminderRuleAction(rule.type, {
          isActive: form.get("isActive") === "on",
          daysBefore,
          overdueEveryDays: overdue,
          sendTime: textOf(form, "sendTime") || "09:00",
          notifyManagers: form.get("notifyManagers") === "on",
          notifyOwner: form.get("notifyOwner") === "on",
          userIds: people.filter((p) => p.kind === "user").map((p) => p.id),
          employeeIds: people.filter((p) => p.kind === "employee").map((p) => p.id),
        });
        if (!result.ok) return result.error;
        onDone(
          `${result.data.label}: saved${result.data.isActive ? "" : ". They are turned off"}.`,
        );
      }}
    >
      {(fieldError) => (
        <>
          <Check name="isActive" defaultChecked={rule.isActive}>
            Send these reminders
          </Check>
          <Field
            id="rule-days"
            label="Days before the date"
            hint="Such as 7, 3, 1, 0. 0 is the day itself; leave empty to remind only once it has passed."
            error={fieldError("daysBefore")}
          >
            <Input
              id="rule-days"
              name="daysBefore"
              inputMode="numeric"
              defaultValue={rule.daysBefore.join(", ")}
              autoComplete="off"
              aria-describedby="rule-days-hint"
              aria-invalid={Boolean(fieldError("daysBefore"))}
            />
          </Field>
          {rule.type === "COMPLIANCE_EXPIRY" && (
            <p className="-mt-2 text-[0.8125rem] text-muted-foreground">
              Each licence also has its own first alert, set on its record.
            </p>
          )}
          <div className="grid items-start gap-5 sm:grid-cols-2">
            <Field
              id="rule-overdue"
              label="Once passed, again every (days)"
              hint="0 to stop once the date has passed."
              error={fieldError("overdueEveryDays")}
            >
              <Input
                id="rule-overdue"
                name="overdueEveryDays"
                inputMode="numeric"
                defaultValue={rule.overdueEveryDays}
                aria-describedby="rule-overdue-hint"
                aria-invalid={Boolean(fieldError("overdueEveryDays"))}
              />
            </Field>
            <Field id="rule-time" label="Time they go out" error={fieldError("sendTime")}>
              <Input id="rule-time" name="sendTime" type="time" defaultValue={rule.sendTime} />
            </Field>
          </div>
          <fieldset className="grid gap-1">
            <legend className="mb-1 text-sm font-medium">Who hears about it</legend>
            {managers && (
              <Check name="notifyManagers" defaultChecked={rule.notifyManagers}>
                {managers}
              </Check>
            )}
            {hasOwner(rule) && (
              <Check name="notifyOwner" defaultChecked={rule.notifyOwner}>
                {rule.owner.charAt(0).toUpperCase() + rule.owner.slice(1)}
              </Check>
            )}
          </fieldset>
          <Field
            id="rule-people"
            label="Also tell (optional)"
            error={fieldError("userIds") ?? fieldError("employeeIds")}
          >
            <PeoplePicker
              id="rule-people"
              label="Also tell"
              value={people}
              onChange={setPeople}
              emptyText="Nobody else."
              invalid={Boolean(fieldError("userIds") ?? fieldError("employeeIds"))}
            />
          </Field>
        </>
      )}
    </FormDialog>
  );
}

/**
 * The automatic reminders, one card per kind of date: what it watches, when it
 * reminds, who hears about it, and, for company.settings, a way to change it.
 */
export function RuleCards({ rules, canEdit }: { rules: RuleRow[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<RuleRow | null>(null);
  const [notice, setNotice] = useNotice();

  return (
    <div className="grid gap-4">
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-label="Automatic reminders">
        {rules.map((rule) => {
          const audience = ruleAudience(rule);
          return (
            <li key={rule.type} className="grid content-start gap-4 rounded-lg border bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-medium text-primary">{rule.label}</h3>
                  <p className="mt-1 text-[0.8125rem] text-muted-foreground">
                    Watches {rule.date}.
                  </p>
                </div>
                <StatusBadge tone={rule.isActive ? "done" : "closed"}>
                  {rule.isActive ? "On" : "Off"}
                </StatusBadge>
              </div>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="eyebrow">When</dt>
                  <dd className="mt-1">
                    {daysBeforeText(rule.daysBefore)}, at {rule.sendTime}
                    <span className="block text-[0.8125rem] text-muted-foreground">
                      {overdueText(rule.overdueEveryDays)}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="eyebrow">Who hears</dt>
                  <dd className="mt-1 break-words">
                    {audience.length === 0 ? "Nobody" : audience.join("; ")}
                  </dd>
                </div>
              </dl>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                <span className="text-[0.8125rem] text-muted-foreground">
                  {rule.customised ? "Changed for this company" : "The standard settings"}
                </span>
                {canEdit && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEditing(rule)}
                    aria-label={`Change ${rule.label}`}
                  >
                    <PencilIcon aria-hidden />
                    Change
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {editing && (
        <RuleDialog
          rule={editing}
          onClose={() => setEditing(null)}
          onDone={(message) => {
            setNotice(message);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
