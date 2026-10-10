"use client";

import { useState } from "react";

import { Field } from "@/components/forms/field";
import { textOf } from "@/components/products/form-values";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/result";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

type LeaveType = { id: string; name: string; isPaid: boolean };

/**
 * The leave asked for or recorded: its type, the first and last day (or half
 * of one day), why, and a paper such as a doctor's note. Named leaveTypeId,
 * startDate, endDate, halfDay and reason; the file comes back through onFile.
 */
export function LeaveFields({
  idPrefix,
  leaveTypes,
  today,
  fieldError,
  onFile,
}: {
  idPrefix: string;
  leaveTypes: readonly LeaveType[];
  today: string;
  fieldError: (name: string) => string | undefined;
  onFile: (file: File | null) => void;
}) {
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [type, setType] = useState(leaveTypes[0]?.id ?? "");
  const oneDay = !end || end === start;
  const chosen = leaveTypes.find((t) => t.id === type);
  const id = (name: string) => `${idPrefix}-${name}`;

  return (
    <>
      <Field
        id={id("type")}
        label="Leave type"
        hint={chosen && !chosen.isPaid ? "Unpaid: the days are taken off the salary." : undefined}
        error={fieldError("leaveTypeId")}
      >
        <NativeSelect
          id={id("type")}
          name="leaveTypeId"
          value={type}
          onChange={(e) => setType(e.target.value)}
          containerClassName="sm:w-full"
          aria-describedby={chosen && !chosen.isPaid ? `${id("type")}-hint` : undefined}
        >
          {leaveTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.isPaid ? "" : " (unpaid)"}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <div className="grid items-start gap-5 sm:grid-cols-2">
        <Field id={id("start")} label="First day" error={fieldError("startDate")}>
          <Input
            id={id("start")}
            name="startDate"
            type="date"
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              if (e.target.value > end) setEnd(e.target.value);
            }}
            aria-invalid={Boolean(fieldError("startDate"))}
          />
        </Field>
        <Field id={id("end")} label="Last day" error={fieldError("endDate")}>
          <Input
            id={id("end")}
            name="endDate"
            type="date"
            value={end}
            min={start}
            onChange={(e) => setEnd(e.target.value)}
            aria-invalid={Boolean(fieldError("endDate"))}
          />
        </Field>
      </div>
      {oneDay && (
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" name="halfDay" className="size-4 cursor-pointer accent-primary" />
          Half a day only
        </label>
      )}
      {fieldError("halfDay") && (
        <p className="text-[0.8125rem] text-destructive">{fieldError("halfDay")}</p>
      )}
      <Field id={id("reason")} label="Reason (optional)" error={fieldError("reason")}>
        <Textarea id={id("reason")} name="reason" rows={2} maxLength={500} />
      </Field>
      <Field
        id={id("file")}
        label="Doctor's note or other paper (optional)"
        hint="A photo or PDF, up to 10 MB."
        error={fieldError("file")}
      >
        <Input
          id={id("file")}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          className="h-auto py-1.5 file:mr-3"
          aria-invalid={Boolean(fieldError("file"))}
          aria-describedby={fieldError("file") ? `${id("file")}-error` : `${id("file")}-hint`}
        />
      </Field>
    </>
  );
}

/**
 * The leave typed into LeaveFields, as the actions take it, after storing the
 * paper; or the problems to show on the fields.
 */
export async function readLeave(
  values: FormData,
  file: File | null,
  upload: (form: FormData) => Promise<ActionResult<{ id: string }>>,
): Promise<
  | {
      input: {
        leaveTypeId: string;
        startDate: string;
        endDate: string;
        halfDay: boolean;
        reason: string | null;
        attachmentId: string | null;
      };
    }
  | { problems: Record<string, string> }
> {
  const problems: Record<string, string> = {};
  const leaveTypeId = textOf(values, "leaveTypeId");
  const startDate = textOf(values, "startDate");
  const endDate = textOf(values, "endDate") || startDate;
  if (!leaveTypeId) problems.leaveTypeId = "Choose the leave type.";
  if (!startDate) problems.startDate = "Choose the first day.";
  else if (endDate < startDate) problems.endDate = "The last day is before the first.";
  else if (endDate.slice(0, 4) !== startDate.slice(0, 4)) {
    problems.endDate = "Split leave that crosses into a new year into two requests.";
  }
  if (file && file.size > MAX_FILE_BYTES) problems.file = "Files can be up to 10 MB.";
  if (Object.keys(problems).length > 0) return { problems };
  let attachmentId: string | null = null;
  if (file) {
    const form = new FormData();
    form.set("file", file);
    const stored = await upload(form);
    if (!stored.ok) return { problems: { file: stored.error.message } };
    attachmentId = stored.data.id;
  }
  return {
    input: {
      leaveTypeId,
      startDate,
      endDate,
      halfDay: endDate === startDate && values.get("halfDay") === "on",
      reason: textOf(values, "reason") || null,
      attachmentId,
    },
  };
}
