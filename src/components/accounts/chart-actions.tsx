"use client";

import { PlusIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { Field } from "@/components/forms/field";
import { textOf } from "@/components/products/form-values";
import { FormDialog, problem } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { ChartScreen } from "@/modules/accounts/screens.service";
import { createAccountAction } from "@/server/actions/accounts.actions";

import { accountsHref, SUBTYPE_HINTS, SUBTYPE_LABELS } from "./labels";

type Creatable = ChartScreen["creatable"][number];

/**
 * Adding an account to the chart (accounts.manage): its name, its kind (only
 * the kinds added by hand; banks, loans and assets add their own) and, if
 * wanted, its code. "?add=1" opens it.
 */
export function AddAccount({
  creatable,
  open: startOpen,
}: {
  creatable: ChartScreen["creatable"];
  open?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(Boolean(startOpen));
  const [subType, setSubType] = useState<Creatable>("OPERATING_EXPENSE");

  function close() {
    setOpen(false);
    if (startOpen) router.replace(pathname, { scroll: false });
  }

  return (
    <>
      <Button type="button" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
        <PlusIcon aria-hidden />
        Add an account
      </Button>
      {open && (
        <FormDialog
          title="Add an account"
          description="Bank accounts, loans and fixed assets add their own account when you record them."
          submitLabel="Add it"
          pendingLabel="Adding"
          errorTitle="We could not add the account"
          onClose={close}
          onSubmit={async (form) => {
            const name = textOf(form, "name");
            if (name.length < 2) return problem({ name: "Give it a name." });
            const result = await createAccountAction({
              name,
              subType,
              code: textOf(form, "code") || undefined,
            });
            if (!result.ok) return result.error;
            router.push(`${accountsHref.account(result.data.id)}?created=1`);
          }}
        >
          {(fieldError) => (
            <>
              <Field id="account-name" label="Name" error={fieldError("name")}>
                <Input
                  id="account-name"
                  name="name"
                  maxLength={120}
                  autoComplete="off"
                  placeholder="Like: Factory rent"
                  aria-invalid={Boolean(fieldError("name"))}
                  aria-describedby={fieldError("name") ? "account-name-error" : undefined}
                  autoFocus
                />
              </Field>
              <Field
                id="account-kind"
                label="Kind"
                hint={SUBTYPE_HINTS[subType]}
                error={fieldError("subType")}
              >
                <NativeSelect
                  id="account-kind"
                  value={subType}
                  onChange={(event) => setSubType(event.target.value as Creatable)}
                  containerClassName="sm:w-full"
                  aria-describedby="account-kind-hint"
                >
                  {creatable.map((s) => (
                    <option key={s} value={s}>
                      {SUBTYPE_LABELS[s]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field
                id="account-code"
                label="Code (optional)"
                hint="Four digits. Left empty, the next free code of its kind is used."
                error={fieldError("code")}
              >
                <Input
                  id="account-code"
                  name="code"
                  inputMode="numeric"
                  maxLength={4}
                  autoComplete="off"
                  className="sm:w-32"
                  aria-invalid={Boolean(fieldError("code"))}
                  aria-describedby={fieldError("code") ? "account-code-error" : "account-code-hint"}
                />
              </Field>
            </>
          )}
        </FormDialog>
      )}
    </>
  );
}
