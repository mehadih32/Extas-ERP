"use client";

import type { AttendanceStatus } from "@prisma/client";
import { LoaderCircleIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ErrorDialog } from "@/components/feedback/error-dialog";
import { FormAlert } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import type { AttendanceScreen } from "@/modules/hr/screens.service";
import { clearAttendanceAction, markAttendanceAction } from "@/server/actions/hr.actions";

import { FlagBadge, MarkBadge } from "./badges";
import { hrHref, MARK_LABELS, minutesText } from "./labels";
import { useNotice } from "./use-notice";

type Row = AttendanceScreen["rows"][number];

type Draft = {
  status: AttendanceStatus | "";
  checkIn: string;
  checkOut: string;
  overtime: string;
  note: string;
};

const STATUSES: readonly AttendanceStatus[] = ["PRESENT", "LATE", "HALF_DAY", "ABSENT"];

const draftOf = (r: Row): Draft => ({
  status: r.mark?.status ?? "",
  checkIn: r.mark?.checkIn ?? "",
  checkOut: r.mark?.checkOut ?? "",
  overtime: r.mark && r.mark.overtimeMinutes > 0 ? String(r.mark.overtimeMinutes) : "",
  note: r.mark?.note ?? "",
});

const same = (a: Draft, b: Draft) =>
  a.status === b.status &&
  a.checkIn === b.checkIn &&
  a.checkOut === b.checkOut &&
  a.overtime === b.overtime &&
  a.note.trim() === b.note.trim();

/** Away all day on approved leave: no mark is taken. */
const awayAllDay = (r: Row) => r.leave?.status === "APPROVED" && !r.leave.halfDay;

/** "‹ Previous day", the date and "Next day ›", with a box to pick any day. */
export function DayPicker({
  date,
  today,
  previous,
  next,
}: {
  date: string;
  today: string;
  previous: string;
  next: string | null;
}) {
  const router = useRouter();
  const link = "text-sm text-primary underline-offset-4 hover:underline";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Link href={hrHref.attendance(previous)} className={link}>
        ‹ Day before
      </Link>
      <label className="sr-only" htmlFor="register-day">
        Day
      </label>
      <Input
        id="register-day"
        type="date"
        value={date}
        max={today}
        onChange={(e) => e.target.value && router.push(hrHref.attendance(e.target.value))}
        className="w-auto"
      />
      {next && (
        <Link href={hrHref.attendance(next)} className={link}>
          Day after ›
        </Link>
      )}
      {date !== today && (
        <Link href={hrHref.attendance()} className={link}>
          Today
        </Link>
      )}
    </div>
  );
}

/**
 * The day's register: everyone employed that day with their mark and any
 * leave. Attendance is by exception: a working day nobody marked counts as
 * present, so HR marks lates, half days, absences and overtime, and saves them
 * together. Setting a row back to "No mark" removes its mark.
 */
export function AttendanceRegister({
  screen,
  version,
}: {
  screen: AttendanceScreen;
  /** Changes when the saved marks do (labels.ts marksVersion). */
  version: string;
}) {
  const { rows, can } = screen;
  const initial = () => Object.fromEntries(rows.map((r) => [r.employee.id, draftOf(r)]));
  const [drafts, setDrafts] = useState<Record<string, Draft>>(initial);
  const [seen, setSeen] = useState(version);
  const [error, setError] = useState<ActionError>();
  const [notice, setNotice] = useNotice();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState<Record<string, boolean>>({});

  if (seen !== version) {
    setSeen(version);
    setDrafts(initial());
  }

  const changed = rows.filter((r) => !awayAllDay(r) && !same(drafts[r.employee.id]!, draftOf(r)));

  function set(id: string, patch: Partial<Draft>) {
    setDrafts((all) => ({ ...all, [id]: { ...all[id]!, ...patch } }));
  }

  function save() {
    const marks = changed.filter((r) => drafts[r.employee.id]!.status !== "");
    const clears = changed.filter((r) => drafts[r.employee.id]!.status === "" && r.mark);
    for (const r of marks) {
      const d = drafts[r.employee.id]!;
      if (d.overtime && !/^\d{1,4}$/.test(d.overtime)) {
        setError({
          code: "VALIDATION",
          message: `Overtime for ${r.employee.name} is in whole minutes, like 90.`,
        });
        return;
      }
    }
    setError(undefined);
    startTransition(async () => {
      if (marks.length > 0) {
        const result = await markAttendanceAction({
          date: screen.date,
          entries: marks.map((r) => {
            const d = drafts[r.employee.id]!;
            return {
              employeeId: r.employee.id,
              status: d.status,
              checkIn: d.checkIn || null,
              checkOut: d.checkOut || null,
              overtimeMinutes: d.overtime ? Number(d.overtime) : 0,
              note: d.note.trim() || null,
            };
          }),
        });
        if (!result.ok) return setError(result.error);
      }
      for (const r of clears) {
        const result = await clearAttendanceAction(r.mark!.id);
        if (!result.ok) return setError(result.error);
      }
      const n = marks.length + clears.length;
      setNotice(`Saved ${n} ${n === 1 ? "change" : "changes"} for ${screen.weekday}.`);
    });
  }

  return (
    <div className="grid gap-4">
      <ul className="grid divide-y rounded-lg border bg-card" aria-label="Register">
        {rows.map((r) => {
          const id = r.employee.id;
          const d = drafts[id]!;
          const away = awayAllDay(r);
          const editable = can.mark && !away;
          const details = editable && d.status !== "" && (open[id] || d.status !== "ABSENT");
          const dirty = changed.some((c) => c.employee.id === id);
          return (
            <li key={id} className={cn("grid gap-3 px-4 py-3", dirty && "bg-secondary/60")}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium break-words">
                    <Link href={hrHref.employee(id)} className="hover:underline">
                      {r.employee.name}
                    </Link>
                  </p>
                  <p className="text-[0.8125rem] text-muted-foreground">
                    {[r.employee.code, r.employee.designation].filter(Boolean).join(" · ")}
                  </p>
                  {r.leave && (
                    <div className="mt-1">
                      <FlagBadge tone={r.leave.status === "APPROVED" ? "open" : "warn"}>
                        {r.leave.leaveType.name}
                        {r.leave.halfDay ? ", half day" : ""}
                        {r.leave.status === "APPROVED" ? "" : " (waiting)"}
                      </FlagBadge>
                    </div>
                  )}
                </div>
                {editable ? (
                  <div className="w-full sm:w-48">
                    <label className="sr-only" htmlFor={`status-${id}`}>
                      {r.employee.name}
                    </label>
                    <NativeSelect
                      id={`status-${id}`}
                      value={d.status}
                      onChange={(e) => set(id, { status: e.target.value as Draft["status"] })}
                      containerClassName="w-full"
                    >
                      <option value="">No mark (present)</option>
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {MARK_LABELS[s]}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                ) : away ? (
                  <span className="text-sm text-muted-foreground">On leave</span>
                ) : r.mark ? (
                  <MarkBadge status={r.mark.status} />
                ) : (
                  <span className="text-sm text-muted-foreground">Present</span>
                )}
              </div>
              {!editable &&
                r.mark &&
                (r.mark.checkIn || r.mark.overtimeMinutes > 0 || r.mark.note) && (
                  <p className="text-[0.8125rem] text-muted-foreground">
                    {[
                      r.mark.checkIn && `In ${r.mark.checkIn}`,
                      r.mark.checkOut && `out ${r.mark.checkOut}`,
                      r.mark.overtimeMinutes > 0 &&
                        `overtime ${minutesText(r.mark.overtimeMinutes)}`,
                      r.mark.note,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              {editable && d.status === "ABSENT" && !open[id] && (
                <button
                  type="button"
                  className="justify-self-start text-[0.8125rem] text-primary underline-offset-4 hover:underline"
                  onClick={() => setOpen((o) => ({ ...o, [id]: true }))}
                >
                  Add a note
                </button>
              )}
              {details && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {d.status !== "ABSENT" && (
                    <>
                      <label className="grid gap-1 text-[0.8125rem] text-muted-foreground">
                        In
                        <Input
                          type="time"
                          value={d.checkIn}
                          onChange={(e) => set(id, { checkIn: e.target.value })}
                        />
                      </label>
                      <label className="grid gap-1 text-[0.8125rem] text-muted-foreground">
                        Out
                        <Input
                          type="time"
                          value={d.checkOut}
                          onChange={(e) => set(id, { checkOut: e.target.value })}
                        />
                      </label>
                      <label className="grid gap-1 text-[0.8125rem] text-muted-foreground">
                        Overtime (minutes)
                        <Input
                          inputMode="numeric"
                          value={d.overtime}
                          placeholder="0"
                          onChange={(e) => set(id, { overtime: e.target.value.trim() })}
                        />
                      </label>
                    </>
                  )}
                  <label
                    className={cn(
                      "grid gap-1 text-[0.8125rem] text-muted-foreground",
                      d.status === "ABSENT"
                        ? "col-span-2 sm:col-span-4"
                        : "col-span-2 sm:col-span-1",
                    )}
                  >
                    Note
                    <Input
                      value={d.note}
                      maxLength={300}
                      onChange={(e) => set(id, { note: e.target.value })}
                    />
                  </label>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {error && error.code !== "INTERNAL" && <FormAlert>{error.message}</FormAlert>}
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      {can.mark && (
        <div className="sticky bottom-20 z-10 flex flex-col gap-2 rounded-lg border bg-card/95 p-3 shadow-sm backdrop-blur sm:flex-row sm:items-center sm:justify-between md:bottom-4">
          <p className="text-sm text-muted-foreground">
            {changed.length === 0
              ? "Mark only lates, half days, absences and overtime."
              : `${changed.length} ${changed.length === 1 ? "change" : "changes"} not saved yet.`}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            {changed.length > 0 && (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setDrafts(initial())}
              >
                Undo
              </Button>
            )}
            <Button type="button" disabled={pending || changed.length === 0} onClick={save}>
              {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
              {pending ? "Saving" : "Save the register"}
            </Button>
          </div>
        </div>
      )}
      {error?.code === "INTERNAL" && (
        <ErrorDialog
          code={error.errorId ?? "ERR-UNKNOWN"}
          title="We could not save the register"
          onClose={() => setError(undefined)}
        />
      )}
    </div>
  );
}
