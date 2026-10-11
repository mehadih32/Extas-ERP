"use client";

import type { PaymentMethod } from "@prisma/client";
import { LoaderCircleIcon, RepeatIcon, UndoIcon } from "lucide-react";
import { useState } from "react";

import { usePageForm } from "@/components/accounts/form-bits";
import { ErrorDialog } from "@/components/feedback/error-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { textOf } from "@/components/products/form-values";
import { FormDialog, problem } from "@/components/sales/dialogs";
import { METHOD_LABELS } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatDay } from "@/lib/display";
import { payDetailsKind, SELF_DOCUMENT_KINDS } from "@/modules/hr/vault";
import type { MyProfileScreen } from "@/modules/hr/screens.service";
import {
  addMyDocumentAction,
  removeMyDocumentAction,
  requestPayDetailsChangeAction,
  updateMyDetailsAction,
  withdrawMyPayRequestAction,
} from "@/server/actions/portal.actions";

import { FlagBadge } from "./badges";
import { BLOOD_GROUPS, SALARY_METHODS } from "./labels";
import { useNotice } from "./use-notice";
import { VaultPapers } from "./vault-bits";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NID_PATTERN = /^(\d{10}|\d{13}|\d{17})$/;
const WALLET_PATTERN = /^01[3-9]\d{8}$/;

const walletDigits = (value: string) => {
  const digits = value.replace(/[\s()-]/g, "").replace(/^\+/, "");
  return digits.startsWith("880") ? `0${digits.slice(3)}` : digits;
};

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid min-w-0 gap-4">
      <legend className="eyebrow mb-1">{title}</legend>
      {children}
    </fieldset>
  );
}

/** A detail already on file that only HR changes now. */
function Locked({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 gap-1">
      <p className="text-sm font-medium">{label}</p>
      <p className="text-sm break-words">{value}</p>
      <p className="text-[0.8125rem] text-muted-foreground">On file. Ask HR to change it.</p>
    </div>
  );
}

/**
 * The employee's own details (My HR > My details): who they are, filled once
 * (HR changes them after that), their contacts and their reference person.
 */
export function MyDetailsForm({ screen }: { screen: MyProfileScreen }) {
  const form = usePageForm();
  const { fieldError } = form;
  const [notice, setNotice] = useNotice();
  const d = screen.details;
  const locked = screen.locked;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const found: Record<string, string> = {};
    const input: Record<string, string | null> = {};
    const read = (field: string) => {
      input[field] = textOf(values, field) || null;
      return input[field];
    };
    if (!locked.nid) {
      const nid = read("nid")?.replace(/[\s-]/g, "") ?? null;
      input.nid = nid;
      if (nid && !NID_PATTERN.test(nid)) found.nid = "A national ID has 10, 13 or 17 digits.";
    }
    if (!locked.dateOfBirth) read("dateOfBirth");
    if (!locked.bloodGroup) read("bloodGroup");
    for (const field of [
      "whatsapp",
      "email",
      "address",
      "emergencyContact",
      "referenceName",
      "referencePhone",
      "referenceRelation",
    ]) {
      read(field);
    }
    if (input.email && !EMAIL_PATTERN.test(input.email)) {
      found.email = "Enter an email like name@example.com.";
    }
    if (input.referencePhone && !input.referenceName) {
      found.referenceName = "Enter the reference person's name.";
    }
    if (input.referenceName && !input.referencePhone) {
      found.referencePhone = "Enter a phone number for them.";
    }
    form.setProblems(found);
    form.setError(undefined);
    if (Object.keys(found).length > 0) return;
    form.startTransition(async () => {
      const result = await updateMyDetailsAction(input);
      if (!result.ok) return form.setError(result.error);
      setNotice(result.data.changed.length === 0 ? "Nothing changed." : "Your details were saved.");
    });
  }

  const text = (
    id: string,
    label: string,
    options: {
      defaultValue?: string | null;
      max?: number;
      type?: string;
      hint?: string;
      placeholder?: string;
      inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
    } = {},
  ) => (
    <Field id={`my-${id}`} label={label} hint={options.hint} error={fieldError(id)}>
      <Input
        id={`my-${id}`}
        name={id}
        type={options.type}
        inputMode={options.inputMode}
        defaultValue={options.defaultValue ?? undefined}
        maxLength={options.max}
        placeholder={options.placeholder}
        autoComplete="off"
        aria-invalid={Boolean(fieldError(id))}
        aria-describedby={
          fieldError(id) ? `my-${id}-error` : options.hint ? `my-${id}-hint` : undefined
        }
      />
    </Field>
  );

  return (
    <form onSubmit={submit} className="mt-4 grid gap-7" noValidate>
      <Group title="Who I am">
        <div className="grid items-start gap-5 sm:grid-cols-2">
          {locked.nid ? (
            <Locked label="National ID" value={d.nid ?? ""} />
          ) : (
            text("nid", "National ID number", {
              max: 25,
              inputMode: "numeric",
              hint: "10, 13 or 17 digits, as on your card.",
            })
          )}
          {locked.dateOfBirth ? (
            <Locked label="Date of birth" value={formatDay(d.dateOfBirth!)} />
          ) : (
            text("dateOfBirth", "Date of birth", { type: "date" })
          )}
          {locked.bloodGroup ? (
            <Locked label="Blood group" value={d.bloodGroup ?? ""} />
          ) : (
            <Field id="my-bloodGroup" label="Blood group" error={fieldError("bloodGroup")}>
              <NativeSelect
                id="my-bloodGroup"
                name="bloodGroup"
                defaultValue=""
                containerClassName="sm:w-full"
              >
                <option value="">Choose</option>
                {BLOOD_GROUPS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          <div className="grid min-w-0 gap-1">
            <p className="text-sm font-medium">Phone</p>
            <p className="text-sm">{d.phone ?? "–"}</p>
            <p className="text-[0.8125rem] text-muted-foreground">HR changes your phone number.</p>
          </div>
        </div>
      </Group>

      <Group title="How to reach me">
        <div className="grid items-start gap-5 sm:grid-cols-2">
          {text("whatsapp", "WhatsApp (optional)", {
            defaultValue: d.whatsapp,
            max: 30,
            type: "tel",
          })}
          {text("email", "Email (optional)", {
            defaultValue: d.email,
            max: 160,
            type: "email",
            inputMode: "email",
          })}
        </div>
        <Field id="my-address" label="Address (optional)" error={fieldError("address")}>
          <Textarea
            id="my-address"
            name="address"
            rows={2}
            maxLength={300}
            defaultValue={d.address ?? undefined}
          />
        </Field>
        {text("emergencyContact", "Emergency contact (optional)", {
          defaultValue: d.emergencyContact,
          max: 160,
          placeholder: "Name, relation and phone",
        })}
      </Group>

      <Group title="Reference person">
        <p className="-mt-2 text-[0.8125rem] text-muted-foreground">
          Someone who knows you and can speak for you, other than family at home: a former employer,
          a teacher or a local leader.
        </p>
        <div className="grid items-start gap-5 sm:grid-cols-3">
          {text("referenceName", "Name", { defaultValue: d.referenceName, max: 120 })}
          {text("referencePhone", "Phone", {
            defaultValue: d.referencePhone,
            max: 30,
            type: "tel",
          })}
          {text("referenceRelation", "How they know you (optional)", {
            defaultValue: d.referenceRelation,
            max: 60,
            placeholder: "Like: former employer",
          })}
        </div>
      </Group>

      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      {form.general && <FormAlert>{form.general}</FormAlert>}
      {!form.general && Object.keys(form.problems).length > 0 && (
        <FormAlert>Please check the highlighted fields.</FormAlert>
      )}
      <div>
        <Button type="submit" className="w-full sm:w-auto" disabled={form.pending}>
          {form.pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
          {form.pending ? "Saving" : "Save my details"}
        </Button>
      </div>
      {form.error?.code === "INTERNAL" && (
        <ErrorDialog
          code={form.error.errorId ?? "ERR-UNKNOWN"}
          title="We could not save your details"
          onClose={() => form.setError(undefined)}
        />
      )}
    </form>
  );
}

const REQUEST_WORDS = {
  PENDING: "Waiting for HR",
  APPROVED: "Approved",
  REJECTED: "Not approved",
  WITHDRAWN: "Withdrawn",
} as const;

/**
 * How the employee is paid, and asking for a change: a new bank account or
 * wallet waits for HR's approval (shown with Withdraw), and the last decision
 * stays in view with HR's reason.
 */
export function MyPayDetails({ screen }: { screen: MyProfileScreen }) {
  const [notice, setNotice] = useNotice();
  const [open, setOpen] = useState<"ask" | "withdraw" | null>(null);
  const [method, setMethod] = useState<PaymentMethod>(screen.pay.salaryMethod);
  const request = screen.payRequest;
  const pending = request?.status === "PENDING" ? request : null;
  const kind = payDetailsKind(method);
  const close = () => {
    setOpen(null);
    setMethod(screen.pay.salaryMethod);
  };

  return (
    <div className="mt-4 grid gap-4">
      <p className="text-sm">
        <span className="block font-medium">{screen.pay.text}</span>
      </p>
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      {request && (
        <div
          className={
            pending
              ? "grid gap-2 rounded-md border border-primary/30 bg-secondary p-4 text-sm"
              : "grid gap-2 rounded-md border p-4 text-sm"
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Change to {request.changesText}</span>
            <FlagBadge
              tone={
                request.status === "APPROVED"
                  ? "done"
                  : request.status === "REJECTED"
                    ? "warn"
                    : "open"
              }
            >
              {REQUEST_WORDS[request.status]}
            </FlagBadge>
          </div>
          <p className="text-[0.8125rem] text-muted-foreground">
            Asked on {formatDay(request.askedOn)}
            {request.decidedOn && request.status !== "PENDING"
              ? ` · ${REQUEST_WORDS[request.status].toLowerCase()} on ${formatDay(request.decidedOn)}`
              : ""}
          </p>
          {request.status === "REJECTED" && request.decisionNote && (
            <p className="text-[0.8125rem]">HR&apos;s reason: {request.decisionNote}</p>
          )}
          {pending && (
            <p className="text-[0.8125rem] text-muted-foreground">
              Your salary keeps going to {screen.pay.text} until HR approves.
            </p>
          )}
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          variant="outline"
          className="w-full sm:w-auto"
          onClick={() => setOpen("ask")}
        >
          <RepeatIcon aria-hidden />
          {pending ? "Ask for a different change" : "Ask for a change"}
        </Button>
        {pending && (
          <Button
            type="button"
            variant="ghost"
            className="w-full sm:w-auto"
            onClick={() => setOpen("withdraw")}
          >
            <UndoIcon aria-hidden />
            Withdraw the change
          </Button>
        )}
      </div>

      {open === "ask" && (
        <FormDialog
          title="Change how I am paid"
          description="HR checks and approves the change before any salary goes to the new account. Until then, nothing changes."
          submitLabel="Send to HR"
          pendingLabel="Sending"
          errorTitle="We could not send the change"
          onClose={close}
          onSubmit={async (values) => {
            const found: Record<string, string> = {};
            const input = {
              salaryMethod: method,
              bankName: textOf(values, "bankName") || null,
              bankBranch: textOf(values, "bankBranch") || null,
              bankAccountNumber: textOf(values, "bankAccountNumber") || null,
              walletNumber: textOf(values, "walletNumber") || null,
              note: textOf(values, "note") || null,
            };
            if (kind === "BANK") {
              if (!input.bankName) found.bankName = "Enter the bank's name.";
              if (!input.bankAccountNumber) found.bankAccountNumber = "Enter the account number.";
            }
            if (kind === "WALLET") {
              if (!input.walletNumber) found.walletNumber = "Enter the wallet number.";
              else if (!WALLET_PATTERN.test(walletDigits(input.walletNumber))) {
                found.walletNumber = "Enter an 11-digit mobile number, like 01711-000000.";
              }
            }
            if (Object.keys(found).length > 0) return problem(found);
            const result = await requestPayDetailsChangeAction(input);
            if (!result.ok) return result.error;
            setNotice(`Sent to HR: ${result.data.changesText}.`);
            close();
          }}
        >
          {(fieldError) => (
            <>
              <Field id="ask-method" label="Pay me by" error={fieldError("salaryMethod")}>
                <NativeSelect
                  id="ask-method"
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
              {kind === "BANK" && (
                <div className="grid items-start gap-5 sm:grid-cols-2">
                  <Field id="ask-bank" label="Bank" error={fieldError("bankName")}>
                    <Input
                      id="ask-bank"
                      name="bankName"
                      maxLength={120}
                      autoComplete="off"
                      aria-invalid={Boolean(fieldError("bankName"))}
                    />
                  </Field>
                  <Field id="ask-branch" label="Branch (optional)" error={fieldError("bankBranch")}>
                    <Input id="ask-branch" name="bankBranch" maxLength={120} autoComplete="off" />
                  </Field>
                  <Field
                    id="ask-account"
                    label="Account number"
                    error={fieldError("bankAccountNumber")}
                    className="sm:col-span-2"
                  >
                    <Input
                      id="ask-account"
                      name="bankAccountNumber"
                      maxLength={40}
                      inputMode="numeric"
                      autoComplete="off"
                      aria-invalid={Boolean(fieldError("bankAccountNumber"))}
                    />
                  </Field>
                </div>
              )}
              {kind === "WALLET" && (
                <Field
                  id="ask-wallet"
                  label={`${METHOD_LABELS[method]} number`}
                  error={fieldError("walletNumber")}
                >
                  <Input
                    id="ask-wallet"
                    name="walletNumber"
                    type="tel"
                    maxLength={30}
                    autoComplete="off"
                    placeholder="01711-000000"
                    aria-invalid={Boolean(fieldError("walletNumber"))}
                  />
                </Field>
              )}
              <Field id="ask-note" label="Note for HR (optional)" error={fieldError("note")}>
                <Textarea id="ask-note" name="note" rows={2} maxLength={300} />
              </Field>
            </>
          )}
        </FormDialog>
      )}

      {open === "withdraw" && pending && (
        <FormDialog
          title="Withdraw the change?"
          description={`HR will not see the change to ${pending.changesText} any more. You keep being paid by ${screen.pay.text}.`}
          submitLabel="Withdraw"
          pendingLabel="Withdrawing"
          errorTitle="We could not withdraw the change"
          onClose={close}
          onSubmit={async () => {
            const result = await withdrawMyPayRequestAction(pending.id);
            if (!result.ok) return result.error;
            setNotice("The change was withdrawn.");
            close();
          }}
        >
          {() => null}
        </FormDialog>
      )}
    </div>
  );
}

/** The papers the employee keeps in their vault, with "Add a paper". */
export function MyPapers({ screen }: { screen: MyProfileScreen }) {
  const [notice, setNotice] = useNotice();
  return (
    <div className="mt-4 grid gap-4">
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      <VaultPapers
        papers={screen.documents}
        kinds={SELF_DOCUMENT_KINDS}
        canAdd={screen.can.addDocument}
        add={addMyDocumentAction}
        remove={removeMyDocumentAction}
        empty="No papers yet. Add a photo of your NID card (both sides) and a photo of yourself."
        onDone={(message) => {
          setNotice(message);
        }}
      />
    </div>
  );
}
