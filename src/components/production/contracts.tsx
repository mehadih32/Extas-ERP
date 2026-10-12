"use client";

import type { ContractKind } from "@prisma/client";
import {
  FileDownIcon,
  FileSignatureIcon,
  LoaderCircleIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { FormDialog } from "@/components/sales/dialogs";
import { Panel } from "@/components/sales/detail-bits";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDay } from "@/lib/display";
import type { BatchContracts } from "@/modules/production/contract.service";
import { createContractAction, deleteContractAction } from "@/server/actions/production.actions";

import { CONTRACT_KIND_LABELS, productionHref } from "./labels";
import { PartyPicker } from "./pickers";

const linkClass = "text-primary underline-offset-4 hover:underline";
const KINDS: ContractKind[] = ["FABRIC", "ACCESSORIES", "FACTORY_CM"];

/**
 * A batch's contracts (Production Managers and Accounts): each agreement with
 * its state and PDF, and, for a Production Manager, the ones ready to draft
 * from the batch's suppliers and factory, or one for another supplier.
 */
export function BatchContractsPanel({ data }: { data: BatchContracts }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [other, setOther] = useState(false);
  const [kind, setKind] = useState<ContractKind>("FABRIC");
  const [party, setParty] = useState<{ id: string; code: string; name: string } | null>(null);

  function draft(kindToDraft: ContractKind, partyId: string) {
    setBusy(`${kindToDraft}|${partyId}`);
    setError(undefined);
    startTransition(async () => {
      const result = await createContractAction(data.batch.id, {
        kind: kindToDraft,
        partyId,
      });
      if (!result.ok) {
        setBusy(null);
        return setError(result.error.message);
      }
      router.push(`${productionHref.contract(data.batch.id, result.data.id)}?drafted=1`);
    });
  }

  return (
    <Panel title="Contracts" id="contracts-heading">
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        Fabric, accessories and factory (CM) agreements, drafted from this batch to read, change and
        print for signing.
      </p>
      {error && (
        <div className="mt-4">
          <FormAlert>{error}</FormAlert>
        </div>
      )}
      {data.contracts.length > 0 && (
        <ul className="mt-4 grid divide-y" aria-label="Batch contracts">
          {data.contracts.map((c) => (
            <li key={c.id} className="flex min-w-0 items-start gap-3 py-3 first:pt-0 last:pb-0">
              <FileSignatureIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <div className="grid min-w-0 flex-1 gap-0.5">
                <Link
                  href={productionHref.contract(data.batch.id, c.id)}
                  className={`text-sm font-medium break-words ${linkClass}`}
                >
                  {CONTRACT_KIND_LABELS[c.kind]}: {c.party.name}
                </Link>
                <p className="text-[0.8125rem] text-muted-foreground">
                  {c.number} ·{" "}
                  {c.signedOn ? (
                    <span className="text-emerald-700 dark:text-emerald-400">
                      Signed {formatDay(c.signedOn)}
                    </span>
                  ) : (
                    `Draft, changed ${formatDay(c.changedOn)}`
                  )}
                </p>
              </div>
              <Button asChild variant="ghost" size="icon" className="shrink-0">
                <a
                  href={productionHref.contractPdf(c.id)}
                  download
                  aria-label={`${c.number} as a PDF`}
                >
                  <FileDownIcon aria-hidden />
                </a>
              </Button>
            </li>
          ))}
        </ul>
      )}
      {data.can.draft && data.toDraft.length > 0 && (
        <>
          <h4 className="eyebrow mt-6">Ready to draft</h4>
          <ul className="mt-2 grid gap-2" aria-label="Contracts to draft">
            {data.toDraft.map((t) => {
              const key = `${t.kind}|${t.party.id}`;
              return (
                <li
                  key={key}
                  className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
                >
                  <span className="min-w-0 text-sm break-words">
                    <span className="font-medium">{CONTRACT_KIND_LABELS[t.kind]}:</span>{" "}
                    {t.party.name}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => draft(t.kind, t.party.id)}
                    aria-label={`Draft the ${CONTRACT_KIND_LABELS[t.kind].toLowerCase()} contract with ${t.party.name}`}
                  >
                    {busy === key && <LoaderCircleIcon className="animate-spin" aria-hidden />}
                    {busy === key ? "Drafting" : "Draft"}
                  </Button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {data.contracts.length === 0 && data.toDraft.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">
          Order the batch&apos;s materials or choose its factory, and the contracts to draft show
          here.
        </p>
      )}
      {data.can.draft &&
        (other ? (
          <div className="mt-5 grid gap-3 rounded-md border p-3">
            <Field id="contract-kind" label="Contract">
              <NativeSelect
                id="contract-kind"
                containerClassName="sm:w-full"
                value={kind}
                onChange={(e) => setKind(e.target.value as ContractKind)}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {CONTRACT_KIND_LABELS[k]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="contract-party" label={kind === "FACTORY_CM" ? "Factory" : "Supplier"}>
              <PartyPicker id="contract-party" kind="SUPPLIER" value={party} onChange={setParty} />
            </Field>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={() => setOther(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={pending || !party}
                onClick={() => party && draft(kind, party.id)}
              >
                {busy === `${kind}|${party?.id}` && (
                  <LoaderCircleIcon className="animate-spin" aria-hidden />
                )}
                Draft it
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-4"
            onClick={() => setOther(true)}
          >
            <PlusIcon aria-hidden />
            Draft for another supplier
          </Button>
        ))}
    </Panel>
  );
}

/** "Print (PDF)" and, for a Production Manager, deleting a draft drafted by mistake. */
export function ContractActions({
  contract,
  batchId,
  canDelete,
  notice,
}: {
  contract: { id: string; number: string };
  batchId: string;
  canDelete: boolean;
  notice?: string;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  return (
    <div className="grid gap-4">
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button asChild className="w-full sm:w-auto">
          <a href={productionHref.contractPdf(contract.id)} download>
            <FileDownIcon aria-hidden />
            Print (PDF)
          </a>
        </Button>
        {canDelete && (
          <Button
            type="button"
            variant="ghost"
            className="w-full text-destructive sm:w-auto"
            onClick={() => setDeleting(true)}
          >
            <Trash2Icon aria-hidden />
            Delete the draft
          </Button>
        )}
      </div>
      {deleting && (
        <FormDialog
          title={`Delete ${contract.number}?`}
          description="The draft and its changes are deleted; the batch, its orders and its styles stay as they are. It can be drafted again."
          submitLabel="Delete the draft"
          pendingLabel="Deleting"
          destructive
          errorTitle="We could not delete the draft"
          onClose={() => setDeleting(false)}
          onSubmit={async () => {
            const result = await deleteContractAction(contract.id);
            if (!result.ok) return result.error;
            router.push(productionHref.batch(batchId));
          }}
        >
          {() => null}
        </FormDialog>
      )}
    </div>
  );
}
