"use client";

import { CheckIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { FormAlert } from "@/components/forms/field";
import { FormDialog, readReason, ReasonField } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/display";
import { DOCUMENT_KINDS } from "@/modules/hr/vault";
import type { EmployeeVault } from "@/modules/hr/vault.service";
import {
  addEmployeeDocumentAction,
  approvePayRequestAction,
  rejectPayRequestAction,
  removeEmployeeDocumentAction,
} from "@/server/actions/hr.actions";

import { FlagBadge } from "./badges";
import { useNotice } from "./use-notice";
import { VaultChecklist, VaultPapers } from "./vault-bits";

const STATUS_WORDS = {
  APPROVED: "Approved",
  REJECTED: "Turned down",
  WITHDRAWN: "Withdrawn",
  PENDING: "Waiting",
} as const;

/**
 * An employee's data vault for HR (hr.manage): what the record still misses,
 * a pay details change waiting (approve or turn down, with a reason), the
 * last changes decided, and the papers kept.
 */
export function VaultPanel({
  employeeId,
  name,
  vault,
}: {
  employeeId: string;
  name: string;
  vault: EmployeeVault;
}) {
  const [notice, setNotice] = useNotice();
  const [open, setOpen] = useState<"approve" | "reject" | null>(null);
  const pending = vault.pendingRequest;
  const close = () => setOpen(null);

  return (
    <div className="mt-4 grid gap-6">
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      <VaultChecklist gaps={vault.gaps} />

      {pending && (
        <div className="grid gap-3 rounded-md border border-destructive/25 bg-destructive/5 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-medium">Pay details change waiting</h4>
            <FlagBadge tone="warn">To approve</FlagBadge>
          </div>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="eyebrow">Now</dt>
              <dd className="mt-1 break-words">{pending.previousText}</dd>
            </div>
            <div className="min-w-0">
              <dt className="eyebrow">Asked for</dt>
              <dd className="mt-1 font-medium break-words">{pending.changesText}</dd>
            </div>
          </dl>
          <p className="text-[0.8125rem] text-muted-foreground">
            Asked by {pending.requestedBy?.name ?? name} on {formatDay(pending.askedOn)}
            {pending.note ? `: “${pending.note}”` : "."}
          </p>
          {vault.can.decide ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="button" className="w-full sm:w-auto" onClick={() => setOpen("approve")}>
                <CheckIcon aria-hidden />
                Approve the change
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => setOpen("reject")}
              >
                <XIcon aria-hidden />
                Turn down
              </Button>
            </div>
          ) : (
            vault.notes.decide && (
              <p className="text-[0.8125rem] text-muted-foreground">{vault.notes.decide}</p>
            )
          )}
        </div>
      )}

      {vault.recentRequests.length > 0 && (
        <div className="grid gap-2">
          <h4 className="eyebrow">Earlier pay details changes</h4>
          <ul className="grid gap-1.5 text-[0.8125rem] text-muted-foreground">
            {vault.recentRequests.map((r) => (
              <li key={r.id} className="break-words">
                <span className="text-foreground">{r.changesText}</span> · {STATUS_WORDS[r.status]}
                {r.decidedBy && r.status !== "WITHDRAWN" ? ` by ${r.decidedBy.name}` : ""} on{" "}
                {formatDay(r.decidedOn ?? r.askedOn)}
                {r.status === "REJECTED" && r.decisionNote ? `: “${r.decisionNote}”` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-3">
        <h4 className="eyebrow">Papers</h4>
        <VaultPapers
          papers={vault.documents.map((d) => ({ ...d, canRemove: true }))}
          kinds={DOCUMENT_KINDS}
          canAdd={vault.can.addDocument}
          add={(form) => addEmployeeDocumentAction(employeeId, form)}
          remove={removeEmployeeDocumentAction}
          empty="No papers yet. Add their NID card, a photo or certificates."
          onDone={setNotice}
        />
      </div>

      {open === "approve" && pending && (
        <FormDialog
          title={`Approve ${name}'s new pay details?`}
          description={`From now on their salary goes to ${pending.changesText}. Payrolls already approved stay as they are.`}
          submitLabel="Approve"
          pendingLabel="Approving"
          errorTitle="We could not approve the change"
          onClose={close}
          onSubmit={async () => {
            const result = await approvePayRequestAction(pending.id);
            if (!result.ok) return result.error;
            setNotice(`${name} is now paid by ${result.data.changesText}.`);
            close();
          }}
        >
          {() => null}
        </FormDialog>
      )}

      {open === "reject" && pending && (
        <FormDialog
          title={`Turn down ${name}'s change?`}
          description="Their pay details stay as they are. They see your reason in My HR."
          submitLabel="Turn down"
          pendingLabel="Saving"
          destructive
          errorTitle="We could not turn the change down"
          onClose={close}
          onSubmit={async (form) => {
            const reason = readReason(form, 5);
            if (typeof reason !== "string") return reason;
            const result = await rejectPayRequestAction(pending.id, { reason });
            if (!result.ok) return result.error;
            setNotice(`${name}'s change was turned down.`);
            close();
          }}
        >
          {(fieldError) => (
            <ReasonField
              id="pay-reject-reason"
              label="Why"
              hint="Shown to the employee."
              min={5}
              error={fieldError("reason")}
            />
          )}
        </FormDialog>
      )}
    </div>
  );
}
