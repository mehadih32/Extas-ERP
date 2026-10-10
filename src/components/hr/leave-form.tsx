"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { FormFooter, usePageForm } from "@/components/accounts/form-bits";
import { Field } from "@/components/forms/field";
import { NativeSelect } from "@/components/ui/native-select";
import type { LeaveForm as LeaveFormData } from "@/modules/hr/screens.service";
import { createLeaveAction, uploadLeaveFileAction } from "@/server/actions/hr.actions";

import { hrHref } from "./labels";
import { LeaveFields, readLeave } from "./leave-fields";

/**
 * HR records leave for an employee (hr.manage): asked in person, on paper or
 * by phone. It is approved as it is recorded unless HR leaves it waiting; their
 * own leave is approved by someone else.
 */
export function LeaveForm({ form: data }: { form: LeaveFormData }) {
  const router = useRouter();
  const form = usePageForm();
  const { fieldError } = form;
  const [employeeId, setEmployeeId] = useState(data.employeeId ?? "");
  const [file, setFile] = useState<File | null>(null);
  const own = employeeId !== "" && employeeId === data.ownEmployeeId;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    form.setError(undefined);
    if (!employeeId) {
      form.setProblems({ employeeId: "Choose the employee." });
      return;
    }
    form.setProblems({});
    form.startTransition(async () => {
      const read = await readLeave(values, file, uploadLeaveFileAction);
      if ("problems" in read) return form.setProblems(read.problems);
      const result = await createLeaveAction({
        ...read.input,
        employeeId,
        approve: !own && values.get("approve") === "on",
      });
      if (!result.ok) return form.setError(result.error);
      router.push(`${hrHref.leaveRequest(result.data.id)}?created=1`);
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-2xl gap-5" noValidate>
      <Field id="employeeId" label="Employee" error={fieldError("employeeId")}>
        <NativeSelect
          id="employeeId"
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          containerClassName="sm:w-full"
          aria-invalid={Boolean(fieldError("employeeId"))}
        >
          <option value="">Choose…</option>
          {data.people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.code})
            </option>
          ))}
        </NativeSelect>
      </Field>
      <LeaveFields
        idPrefix="leave"
        leaveTypes={data.leaveTypes}
        today={data.today}
        fieldError={fieldError}
        onFile={setFile}
      />
      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="approve"
          defaultChecked
          disabled={own}
          className="mt-0.5 size-4 cursor-pointer accent-primary"
        />
        <span>
          Approve it now
          <span className="block text-[0.8125rem] text-muted-foreground">
            {own
              ? "This is your own leave: it waits for someone else to approve it."
              : "Untick to leave it waiting for a decision."}
          </span>
        </span>
      </label>
      <FormFooter
        form={form}
        cancelHref={hrHref.leave}
        submitLabel="Record the leave"
        pendingLabel="Recording"
        errorTitle="We could not record the leave"
      />
    </form>
  );
}
