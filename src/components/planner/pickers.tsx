"use client";

import { XIcon } from "lucide-react";

import { SearchList } from "@/components/sales/pickers";
import { Button } from "@/components/ui/button";
import type {
  EmployeeOption,
  PersonOption,
  ProjectOption,
} from "@/modules/reminders/screens.service";
import {
  findPeopleAction,
  findTaskEmployeesAction,
  findTaskProjectsAction,
} from "@/server/actions/reminders.actions";

/** Someone a reminder goes to: a user of the company, or staff without a login yet. */
export type PersonChip = { kind: "user" | "employee"; id: string; name: string; note?: string };

const keyOf = (p: { kind: string; id: string }) => `${p.kind}:${p.id}`;

/**
 * The people a reminder (or an automatic reminder) goes to: chips that can be
 * taken off, and a search that adds more. Staff without a login are listed
 * too; they are told once WhatsApp is set up.
 */
export function PeoplePicker({
  id,
  label,
  value,
  onChange,
  invalid,
  describedBy,
  emptyText,
}: {
  id: string;
  label: string;
  value: PersonChip[];
  onChange: (people: PersonChip[]) => void;
  invalid?: boolean;
  describedBy?: string;
  /** Shown when nobody is chosen ("Just you"). */
  emptyText: string;
}) {
  const chosen = new Set(value.map(keyOf));
  return (
    <div className="grid gap-2">
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Chosen">
          {value.map((p) => (
            <li
              key={keyOf(p)}
              className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border bg-secondary py-1 pr-1 pl-3 text-sm text-primary"
            >
              <span className="truncate">{p.name}</span>
              {p.note && (
                <span className="shrink-0 text-[0.75rem] text-muted-foreground">({p.note})</span>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6 shrink-0 rounded-full"
                aria-label={`Take ${p.name} off`}
                onClick={() => onChange(value.filter((x) => keyOf(x) !== keyOf(p)))}
              >
                <XIcon aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      )}
      <SearchList<PersonOption>
        id={id}
        label={label}
        placeholder="Add someone by name"
        invalid={invalid}
        describedBy={describedBy}
        search={async (text) => {
          const result = await findPeopleAction(text);
          if (!result.ok) return result.error.message;
          return result.data.filter((o) => !chosen.has(`${o.kind}:${o.personId}`));
        }}
        renderOption={(o) => (
          <span className="grid gap-0.5">
            <span className="text-sm font-medium">{o.name}</span>
            <span className="text-[0.8125rem] text-muted-foreground">{o.detail}</span>
          </span>
        )}
        onPick={(o) =>
          onChange([
            ...value,
            {
              kind: o.kind,
              id: o.personId,
              name: o.name,
              ...(o.kind === "employee" ? { note: "no login yet" } : {}),
            },
          ])
        }
      />
    </div>
  );
}

/** One chosen record with a way to take it off, or the search to choose it. */
function Chosen({ text, detail, onClear }: { text: string; detail?: string; onClear: () => void }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-md border bg-card px-3 py-2">
      <span className="grid min-w-0 gap-0.5">
        <span className="truncate text-sm font-medium">{text}</span>
        {detail && <span className="text-[0.8125rem] text-muted-foreground">{detail}</span>}
      </span>
      <Button type="button" variant="ghost" size="sm" onClick={onClear}>
        Change
      </Button>
    </div>
  );
}

export type EmployeeChoice = { id: string; code: string; name: string; hasLogin: boolean };

/** The employee a task is given to. */
export function EmployeePicker({
  id,
  value,
  onChange,
  invalid,
  describedBy,
}: {
  id: string;
  value: EmployeeChoice | null;
  onChange: (employee: EmployeeChoice | null) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  if (value) {
    return (
      <Chosen
        text={value.name}
        detail={`${value.code}${value.hasLogin ? "" : " · no login yet, told once WhatsApp is set up"}`}
        onClear={() => onChange(null)}
      />
    );
  }
  return (
    <SearchList<EmployeeOption>
      id={id}
      label="Employee"
      placeholder="Name or employee code"
      invalid={invalid}
      describedBy={describedBy}
      search={async (text) => {
        const result = await findTaskEmployeesAction(text);
        return result.ok ? result.data : result.error.message;
      }}
      renderOption={(e) => (
        <span className="grid gap-0.5">
          <span className="text-sm font-medium">{e.name}</span>
          <span className="text-[0.8125rem] text-muted-foreground">
            {[e.code, e.designation, e.hasLogin ? null : "no login yet"]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
      )}
      onPick={(e) => onChange({ id: e.id, code: e.code, name: e.name, hasLogin: e.hasLogin })}
    />
  );
}

/** The production project a task belongs to. */
export function ProjectPicker({
  id,
  value,
  onChange,
}: {
  id: string;
  value: ProjectOption | null;
  onChange: (project: ProjectOption | null) => void;
}) {
  if (value) {
    return <Chosen text={`${value.code} ${value.name}`} onClear={() => onChange(null)} />;
  }
  return (
    <SearchList<ProjectOption>
      id={id}
      label="Production project"
      placeholder="Project code or name"
      search={async (text) => {
        const result = await findTaskProjectsAction(text);
        return result.ok ? result.data : result.error.message;
      }}
      renderOption={(p) => (
        <span className="grid gap-0.5">
          <span className="text-sm font-medium">{p.name}</span>
          <span className="text-[0.8125rem] text-muted-foreground">{p.code}</span>
        </span>
      )}
      onPick={onChange}
    />
  );
}
