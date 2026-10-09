"use client";

import { ArchiveIcon, ArchiveRestoreIcon, PencilIcon, PlusIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { ActionErrorDialog } from "@/components/feedback/action-error-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { textOf } from "@/components/products/form-values";
import { StatusBadge } from "@/components/sales/badges";
import { Panel } from "@/components/sales/detail-bits";
import { FormDialog, problem } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import type { ExpenseHeadsScreen } from "@/modules/expenses/screens.service";
import {
  createExpenseHeadAction,
  updateExpenseHeadAction,
} from "@/server/actions/expenses.actions";

import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from "./labels";
import { useNotice } from "./money-actions";

type Head = ExpenseHeadsScreen["heads"][number];

/** The fields of a head: its name, kind, the account it posts to and whether it names the employee. */
function HeadFields({
  head,
  accounts,
  fieldError,
}: {
  head?: Head;
  accounts: ExpenseHeadsScreen["accounts"];
  fieldError: (name: string) => string | undefined;
}) {
  return (
    <>
      <div className="grid items-start gap-5 sm:grid-cols-2">
        <Field id="head-name" label="Name" error={fieldError("name")}>
          <Input
            id="head-name"
            name="name"
            defaultValue={head?.name}
            maxLength={80}
            autoComplete="off"
            placeholder="Like: Generator fuel"
            aria-invalid={Boolean(fieldError("name"))}
            aria-describedby={fieldError("name") ? "head-name-error" : undefined}
            autoFocus
          />
        </Field>
        <Field id="head-category" label="Kind" error={fieldError("category")}>
          <NativeSelect
            id="head-category"
            name="category"
            defaultValue={head?.category ?? "OFFICE"}
            containerClassName="sm:w-full"
          >
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {EXPENSE_CATEGORY_LABELS[c]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <Field
        id="head-account"
        label="Posts to"
        hint="The expense account in the books. The kind's own account unless you choose another."
        error={fieldError("ledgerAccountId")}
      >
        <NativeSelect
          id="head-account"
          name="ledgerAccountId"
          defaultValue={head?.accountId ?? ""}
          containerClassName="sm:w-full"
          aria-describedby="head-account-hint"
        >
          <option value="">The kind&apos;s own account</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} {a.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="requiresEmployee"
          defaultChecked={head?.requiresEmployee ?? false}
          className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary"
        />
        <span>
          Each expense names the employee and the purpose
          <span className="block text-[0.8125rem] text-muted-foreground">
            Like conveyance and food: paid from the employee&apos;s advance first.
          </span>
        </span>
      </label>
    </>
  );
}

function readHead(form: FormData) {
  const name = textOf(form, "name");
  if (name.length < 2) return problem({ name: "Give it a name." });
  return {
    name,
    category: textOf(form, "category") || "OTHER",
    ledgerAccountId: textOf(form, "ledgerAccountId") || null,
    requiresEmployee: form.get("requiresEmployee") === "on",
  };
}

/**
 * The heads expenses are filed under, each posting to an expense account.
 * Accounts and expense managers add, change, archive and restore them (as the
 * head actions check); an archived head stays on old expenses but is not
 * offered for new ones.
 */
export function ExpenseHeads({ screen }: { screen: ExpenseHeadsScreen }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Head | null>(null);
  const [notice, setNotice] = useNotice();
  const [error, setError] = useState<ActionError>();
  const [busy, setBusy] = useState<string>();
  const [, startTransition] = useTransition();
  const { heads, accounts, canManage } = screen;

  function setActive(head: Head, isActive: boolean) {
    setBusy(head.id);
    startTransition(async () => {
      const result = await updateExpenseHeadAction(head.id, { isActive });
      setBusy(undefined);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice(isActive ? `${head.name} is back in use.` : `${head.name} is archived.`);
    });
  }

  return (
    <div className="grid gap-6">
      {canManage && (
        <div>
          <Button type="button" className="w-full sm:w-auto" onClick={() => setAdding(true)}>
            <PlusIcon aria-hidden />
            Add an expense head
          </Button>
        </div>
      )}
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      <Panel title="Expense heads" id="heads-heading">
        <ul className="mt-4 grid divide-y">
          {heads.map((head) => (
            <li
              key={head.id}
              className={cn(
                "flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0",
                !head.isActive && "text-muted-foreground",
              )}
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <span className="break-words">{head.name}</span>
                  {!head.isActive && <StatusBadge tone="closed">Archived</StatusBadge>}
                </p>
                <p className="text-[0.8125rem] break-words text-muted-foreground">
                  {EXPENSE_CATEGORY_LABELS[head.category] ?? head.category}
                  {head.account ? ` · posts to ${head.account}` : ""}
                  {head.requiresEmployee ? " · names the employee" : ""}
                </p>
              </div>
              {canManage && (
                <span className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(head)}
                    aria-label={`Change ${head.name}`}
                  >
                    <PencilIcon aria-hidden />
                    Change
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy === head.id}
                    onClick={() => setActive(head, !head.isActive)}
                    aria-label={`${head.isActive ? "Archive" : "Restore"} ${head.name}`}
                  >
                    {head.isActive ? (
                      <ArchiveIcon aria-hidden />
                    ) : (
                      <ArchiveRestoreIcon aria-hidden />
                    )}
                    {head.isActive ? "Archive" : "Restore"}
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      </Panel>

      {adding && (
        <FormDialog
          title="Add an expense head"
          description="Expenses are filed under it, so the profit and loss shows where the money went."
          submitLabel="Add it"
          pendingLabel="Adding"
          errorTitle="We could not add the expense head"
          onClose={() => setAdding(false)}
          onSubmit={async (form) => {
            const input = readHead(form);
            if ("code" in input) return input;
            const result = await createExpenseHeadAction(input);
            if (!result.ok) return result.error;
            setNotice(`${result.data.name} was added.`);
            setAdding(false);
          }}
        >
          {(fieldError) => <HeadFields accounts={accounts} fieldError={fieldError} />}
        </FormDialog>
      )}

      {editing && (
        <FormDialog
          title={`Change ${editing.name}`}
          description="Expenses already filed under it keep their entries; new ones post to the account chosen here."
          submitLabel="Save"
          pendingLabel="Saving"
          errorTitle="We could not change the expense head"
          onClose={() => setEditing(null)}
          onSubmit={async (form) => {
            const input = readHead(form);
            if ("code" in input) return input;
            const result = await updateExpenseHeadAction(editing.id, input);
            if (!result.ok) return result.error;
            setNotice(`${result.data.name} was saved.`);
            setEditing(null);
          }}
        >
          {(fieldError) => (
            <HeadFields head={editing} accounts={accounts} fieldError={fieldError} />
          )}
        </FormDialog>
      )}

      <ActionErrorDialog
        error={error}
        title="We could not change the expense head"
        onClose={() => setError(undefined)}
      />
    </div>
  );
}
