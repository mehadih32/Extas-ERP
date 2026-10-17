"use client";

import { PlusIcon, XIcon } from "lucide-react";

import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Schedule, ScheduleMode } from "@/lib/schedule";

/*
 * The fields of a schedule (lib/schedule.ts): every N hours, every N days,
 * weekly on chosen days, or chosen dates and times. Used where the owner sets
 * when something runs by itself (Bug Guard).
 */

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export type ScheduleDraft = Pick<Schedule, "mode" | "every" | "times" | "weekdays" | "dates">;

/** What the server is sent for a draft (only the fields its mode uses). */
export function scheduleInput(d: ScheduleDraft) {
  if (d.mode === "HOURS") return { mode: d.mode, every: d.every, times: d.times.slice(0, 1) };
  if (d.mode === "DAYS") return { mode: d.mode, every: d.every, times: d.times };
  if (d.mode === "WEEKLY") return { mode: d.mode, times: d.times, weekdays: d.weekdays };
  return { mode: d.mode, dates: d.dates.filter(Boolean).map((x) => x.replace("T", " ")) };
}

export function ScheduleFields({
  id,
  value,
  onChange,
  error,
}: {
  id: string;
  value: ScheduleDraft;
  onChange: (next: ScheduleDraft) => void;
  error?: string;
}) {
  const set = (patch: Partial<ScheduleDraft>) => onChange({ ...value, ...patch });
  const times = value.times.length ? value.times : ["02:00"];
  const single = value.mode === "HOURS";
  return (
    <div className="grid gap-4 text-sm">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${id}-mode`} label="How often" error={error}>
          <select
            id={`${id}-mode`}
            className="h-9 w-full rounded-md border bg-background px-3"
            value={value.mode}
            onChange={(e) => set({ mode: e.target.value as ScheduleMode })}
          >
            <option value="HOURS">Every few hours</option>
            <option value="DAYS">Every day, or every few days</option>
            <option value="WEEKLY">On chosen weekdays</option>
            <option value="DATES">On chosen dates</option>
          </select>
        </Field>
        {(value.mode === "HOURS" || value.mode === "DAYS") && (
          <Field
            id={`${id}-every`}
            label={value.mode === "HOURS" ? "Every how many hours" : "Every how many days"}
            hint={value.mode === "HOURS" ? "1 to 12" : "1 is every day"}
          >
            <Input
              id={`${id}-every`}
              type="number"
              min={1}
              max={value.mode === "HOURS" ? 12 : 30}
              value={String(value.every)}
              onChange={(e) => set({ every: Number(e.target.value) || 1 })}
            />
          </Field>
        )}
      </div>
      {value.mode !== "DATES" && (
        <fieldset className="grid gap-2">
          <legend className="mb-2 font-medium">{single ? "Starting at" : "At these times"}</legend>
          <div className="flex flex-wrap items-center gap-2">
            {(single ? times.slice(0, 1) : times).map((t, i) => (
              <div key={i} className="flex items-center gap-1">
                <Input
                  aria-label={`Time ${i + 1}`}
                  type="time"
                  className="w-32"
                  value={t}
                  onChange={(e) =>
                    set({ times: times.map((x, j) => (j === i ? e.target.value : x)) })
                  }
                />
                {!single && times.length > 1 && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove time ${i + 1}`}
                    onClick={() => set({ times: times.filter((_, j) => j !== i) })}
                  >
                    <XIcon aria-hidden />
                  </Button>
                )}
              </div>
            ))}
            {!single && times.length < 12 && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => set({ times: [...times, "14:00"] })}
              >
                <PlusIcon aria-hidden />
                Add a time
              </Button>
            )}
          </div>
        </fieldset>
      )}
      {value.mode === "WEEKLY" && (
        <fieldset className="grid gap-2">
          <legend className="mb-2 font-medium">On these days</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {WEEKDAY_NAMES.map((day, i) => (
              <label key={day} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={value.weekdays.includes(i)}
                  onChange={(e) =>
                    set({
                      weekdays: e.target.checked
                        ? [...value.weekdays, i].sort()
                        : value.weekdays.filter((d) => d !== i),
                    })
                  }
                />
                {day}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {value.mode === "DATES" && (
        <fieldset className="grid gap-2">
          <legend className="mb-2 font-medium">On these dates</legend>
          <div className="flex flex-wrap items-center gap-2">
            {(value.dates.length ? value.dates : [""]).map((d, i, all) => (
              <Input
                key={i}
                aria-label={`Date ${i + 1}`}
                type="datetime-local"
                className="w-full sm:w-56"
                value={d.replace(" ", "T")}
                onChange={(e) => set({ dates: all.map((x, j) => (j === i ? e.target.value : x)) })}
              />
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => set({ dates: [...(value.dates.length ? value.dates : [""]), ""] })}
            >
              <PlusIcon aria-hidden />
              Add a date
            </Button>
          </div>
        </fieldset>
      )}
    </div>
  );
}
