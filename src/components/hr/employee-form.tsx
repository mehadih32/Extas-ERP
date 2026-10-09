"use client";

import type { PaymentMethod } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { FormFooter, usePageForm } from "@/components/accounts/form-bits";
import { Field } from "@/components/forms/field";
import { AMOUNT_HINT, readAmount, textOf } from "@/components/products/form-values";
import { METHOD_LABELS } from "@/components/sales/labels";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { EmployeeForm as EmployeeFormData } from "@/modules/hr/screens.service";
import { createEmployeeAction, updateEmployeeAction } from "@/server/actions/hr.actions";

import { BLOOD_GROUPS, hrHref, SALARY_METHODS } from "./labels";

const CODE_PATTERN = /^[A-Za-z0-9/_-]+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="grid min-w-0 gap-5 rounded-lg border bg-card p-5 sm:p-6">
      <legend className="sr-only">{title}</legend>
      <div>
        <h3 className="font-serif text-xl text-primary">{title}</h3>
        {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </fieldset>
  );
}

/**
 * An employee's details (hr.manage): who they are, their job, and how their
 * salary is paid. A new employee gets the next EMP-0001 code unless one is
 * typed, and their monthly salary from the joining day; later changes to the
 * salary go through "Change salary" on their page, with the day it starts.
 */
export function EmployeeForm({ form: data }: { form: EmployeeFormData }) {
  const router = useRouter();
  const form = usePageForm();
  const { fieldError } = form;
  const e = data.employee;
  const [method, setMethod] = useState<PaymentMethod>(e?.salaryMethod ?? "CASH");
  const bank = method === "BANK_TRANSFER" || method === "CHEQUE";
  const wallet = method === "BKASH" || method === "NAGAD" || method === "ROCKET";

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const found: Record<string, string> = {};
    const name = textOf(values, "name");
    if (name.length < 2) found.name = "Enter the employee's name.";
    const code = textOf(values, "code");
    if (e && !code) found.code = "Enter the code.";
    else if (code && !CODE_PATTERN.test(code))
      found.code = "Use letters, numbers, dashes or slashes.";
    const email = textOf(values, "email");
    if (email && !EMAIL_PATTERN.test(email)) found.email = "Enter an email like name@example.com.";
    const joinDate = textOf(values, "joinDate");
    if (!joinDate) found.joinDate = "Enter the day they joined.";
    const salary = e ? null : readAmount(textOf(values, "salary"));
    if (!e && (salary === null || salary === "invalid")) {
      found.salary = salary === null ? "Enter the monthly salary." : AMOUNT_HINT;
    }
    const overtime = readAmount(textOf(values, "overtimeRate"));
    if (overtime === "invalid") found.overtimeRate = AMOUNT_HINT;
    form.setProblems(found);
    form.setError(undefined);
    if (Object.keys(found).length > 0) return;

    const optional = (field: string) => textOf(values, field) || null;
    const fields = {
      name,
      designation: optional("designation"),
      department: optional("department"),
      phone: optional("phone"),
      whatsapp: optional("whatsapp"),
      email: email || null,
      nid: optional("nid"),
      address: optional("address"),
      dateOfBirth: optional("dateOfBirth"),
      bloodGroup: (optional("bloodGroup") as (typeof BLOOD_GROUPS)[number] | null) ?? null,
      emergencyContact: optional("emergencyContact"),
      notes: optional("notes"),
      joinDate,
      overtimeRate: overtime as number | null,
      salaryMethod: method,
      bankName: bank ? optional("bankName") : null,
      bankAccountNumber: bank ? optional("bankAccountNumber") : null,
      walletNumber: wallet ? optional("walletNumber") : null,
    };
    form.startTransition(async () => {
      const result = e
        ? await updateEmployeeAction(e.id, {
            ...fields,
            code,
            ...(data.can.setStatus ? { status: textOf(values, "status") || "ACTIVE" } : {}),
          })
        : await createEmployeeAction({
            ...fields,
            code: code || undefined,
            salary: salary as number,
          });
      if (!result.ok) return form.setError(result.error);
      router.push(`${hrHref.employee(result.data.id)}?${e ? "saved" : "created"}=1`);
    });
  }

  const text = (
    id: string,
    label: string,
    options: {
      defaultValue?: string | null;
      max?: number;
      hint?: string;
      type?: string;
      inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
      autoFocus?: boolean;
      list?: string;
      placeholder?: string;
    } = {},
  ) => (
    <Field id={id} label={label} hint={options.hint} error={fieldError(id)}>
      <Input
        id={id}
        name={id}
        type={options.type}
        inputMode={options.inputMode}
        defaultValue={options.defaultValue ?? undefined}
        maxLength={options.max}
        autoComplete="off"
        list={options.list}
        placeholder={options.placeholder}
        aria-invalid={Boolean(fieldError(id))}
        aria-describedby={fieldError(id) ? `${id}-error` : options.hint ? `${id}-hint` : undefined}
        autoFocus={options.autoFocus}
      />
    </Field>
  );

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-6" noValidate>
      <Section title="The person">
        <div className="grid items-start gap-5 sm:grid-cols-2">
          {text("name", "Full name", { defaultValue: e?.name, max: 120, autoFocus: !e })}
          {text("code", e ? "Employee code" : "Employee code (optional)", {
            defaultValue: e?.code,
            max: 20,
            hint: e ? undefined : "Left empty, it gets the next code, like EMP-0012.",
          })}
          {text("phone", "Phone (optional)", { defaultValue: e?.phone, max: 30, type: "tel" })}
          {text("whatsapp", "WhatsApp (optional)", {
            defaultValue: e?.whatsapp,
            max: 30,
            type: "tel",
          })}
          {text("email", "Email (optional)", {
            defaultValue: e?.email,
            max: 160,
            type: "email",
            inputMode: "email",
          })}
          {text("nid", "National ID (optional)", { defaultValue: e?.nid, max: 30 })}
          {text("dateOfBirth", "Date of birth (optional)", {
            defaultValue: e?.dateOfBirth,
            type: "date",
          })}
          <Field id="bloodGroup" label="Blood group (optional)" error={fieldError("bloodGroup")}>
            <NativeSelect
              id="bloodGroup"
              name="bloodGroup"
              defaultValue={e?.bloodGroup ?? ""}
              containerClassName="sm:w-full"
            >
              <option value="">Not known</option>
              {BLOOD_GROUPS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <Field id="address" label="Address (optional)" error={fieldError("address")}>
          <Textarea
            id="address"
            name="address"
            rows={2}
            maxLength={300}
            defaultValue={e?.address ?? undefined}
          />
        </Field>
        {text("emergencyContact", "Emergency contact (optional)", {
          defaultValue: e?.emergencyContact,
          max: 160,
          placeholder: "Name, relation and phone",
        })}
      </Section>

      <Section title="The job">
        <div className="grid items-start gap-5 sm:grid-cols-2">
          {text("designation", "Post (optional)", {
            defaultValue: e?.designation,
            max: 80,
            placeholder: "Like: Sewing operator",
          })}
          {text("department", "Department (optional)", {
            defaultValue: e?.department,
            max: 80,
            list: "departments",
            placeholder: "Like: Sewing",
          })}
          {text("joinDate", "Joined on", {
            defaultValue: e?.joinDate ?? data.today,
            type: "date",
            hint: e ? "Salary and leave count from this day." : undefined,
          })}
          {e && data.can.setStatus && (
            <Field
              id="status"
              label="Status"
              hint="Long leave is a note: they stay on the payroll."
              error={fieldError("status")}
            >
              <NativeSelect
                id="status"
                name="status"
                defaultValue={e.status === "ON_LEAVE" ? "ON_LEAVE" : "ACTIVE"}
                containerClassName="sm:w-full"
                aria-describedby="status-hint"
              >
                <option value="ACTIVE">Working</option>
                <option value="ON_LEAVE">On long leave</option>
              </NativeSelect>
            </Field>
          )}
        </div>
        <datalist id="departments">
          {data.departments.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>
      </Section>

      <Section
        title="Pay"
        hint={
          e
            ? "The salary itself changes from their page (Change salary), with the day it starts."
            : undefined
        }
      >
        <div className="grid items-start gap-5 sm:grid-cols-2">
          {!e &&
            text("salary", "Monthly salary", {
              inputMode: "decimal",
              hint: "Gross, from the day they join.",
              placeholder: "0.00",
            })}
          {text("overtimeRate", "Overtime pay per hour (optional)", {
            defaultValue: e?.overtimeRate,
            inputMode: "decimal",
            hint: "Left empty, overtime is not paid.",
          })}
          <Field id="salaryMethod" label="Salary paid by" error={fieldError("salaryMethod")}>
            <NativeSelect
              id="salaryMethod"
              value={method}
              onChange={(event) => setMethod(event.target.value as PaymentMethod)}
              containerClassName="sm:w-full"
            >
              {SALARY_METHODS.map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABELS[m]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {bank && (
            <>
              {text("bankName", "Bank (optional)", { defaultValue: e?.bankName, max: 120 })}
              {text("bankAccountNumber", "Account number (optional)", {
                defaultValue: e?.bankAccountNumber,
                max: 40,
              })}
            </>
          )}
          {wallet &&
            text("walletNumber", `${METHOD_LABELS[method]} number (optional)`, {
              defaultValue: e?.walletNumber,
              max: 30,
              type: "tel",
            })}
        </div>
        <Field id="notes" label="Notes for HR (optional)" error={fieldError("notes")}>
          <Textarea
            id="notes"
            name="notes"
            rows={2}
            maxLength={1000}
            defaultValue={e?.notes ?? undefined}
          />
        </Field>
      </Section>

      <FormFooter
        form={form}
        cancelHref={e ? hrHref.employee(e.id) : hrHref.employees}
        submitLabel={e ? "Save the changes" : "Add the employee"}
        pendingLabel={e ? "Saving" : "Adding"}
        errorTitle={e ? "We could not save the changes" : "We could not add the employee"}
      />
    </form>
  );
}
