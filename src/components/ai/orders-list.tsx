"use client";

import { PlusIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { type Tone, StatusBadge } from "@/components/sales/badges";
import { Panel } from "@/components/sales/detail-bits";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { createOrderRunAction } from "@/server/actions/orders.actions";

/*
 * AI Center > Orders: the new orders given to Mehedi 2.0. The owner names the
 * order and attaches the buyer's papers; Mehedi reads them, asks for what is
 * missing, checks it and writes the plan for the owner's Approve. People do
 * the ERP steps; he follows them against the T&A. The first five are dry runs.
 */

export type OrderRow = {
  id: string;
  number: string;
  title: string;
  buyer: string | null;
  po: string | null;
  shipDate: string | null;
  pieces: number;
  status: string;
  statusText: string;
  mode: string;
  missing: number;
  late: number;
};

export const RUN_TONES: Record<string, Tone> = {
  INTAKE: "plain",
  WAITING_OWNER: "open",
  APPROVED: "done",
  RETURNED: "warn",
  CANCELLED: "closed",
  DONE: "closed",
};

export function OrdersList({
  rows,
  dryRunsLeft,
  canManage,
  buyers,
}: {
  rows: OrderRow[];
  dryRunsLeft: number;
  canManage: boolean;
  buyers: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  return (
    <div className="grid gap-6">
      <Panel
        title="Orders"
        id="orders-heading"
        action={
          canManage && (
            <Button type="button" size="sm" onClick={() => setCreating(true)}>
              <PlusIcon aria-hidden />
              New order
            </Button>
          )
        }
      >
        <p className="mt-2 text-sm text-muted-foreground">
          Give Mehedi 2.0 a new order: attach the buyer&apos;s PO, order sheet or photos, and he
          reads them, asks for what is missing, checks it and writes the plan for your Approve.
          People do each step in the ERP; he follows them against the T&amp;A and tells you of any
          slip. Nothing goes to the buyer without your OK.
        </p>
        {dryRunsLeft > 0 && (
          <div className="mt-3">
            <FormAlert tone="note">
              {`Dry runs left: ${dryRunsLeft} of 5. Until then he only shows what he would do.`}
            </FormAlert>
          </div>
        )}
        {rows.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No orders yet.</p>
        ) : (
          <ul className="mt-4 grid gap-2">
            {rows.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/ai/orders/${r.id}`}
                  className="grid gap-1 rounded-md border p-3 text-sm transition-colors hover:bg-muted/50 sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[0.8125rem] text-muted-foreground">
                        {r.number}
                      </span>
                      <span className="font-medium break-words">{r.title}</span>
                    </p>
                    <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">
                      {[
                        r.buyer ?? "Buyer not set",
                        r.po ? `PO ${r.po}` : null,
                        r.pieces ? `${r.pieces.toLocaleString("en-US")} pcs` : null,
                        r.shipDate ? `ship ${r.shipDate}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {r.mode === "DRY_RUN" && r.status !== "INTAKE" && (
                      <StatusBadge tone="plain">Dry run</StatusBadge>
                    )}
                    {r.missing > 0 && r.status === "INTAKE" && (
                      <StatusBadge tone="plain">{`${r.missing} to fill in`}</StatusBadge>
                    )}
                    {r.late > 0 && <StatusBadge tone="warn">{`${r.late} late`}</StatusBadge>}
                    <StatusBadge tone={RUN_TONES[r.status] ?? "plain"}>{r.statusText}</StatusBadge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {creating && (
        <FormDialog
          title="New order"
          description="Name it and, if you know them, the buyer and the PO. Attach the papers on the next page."
          submitLabel="Start"
          pendingLabel="Starting"
          errorTitle="We could not start the order"
          onClose={() => setCreating(false)}
          onSubmit={async (form) => {
            const result = await createOrderRunAction({
              title: String(form.get("title") ?? ""),
              buyerId: String(form.get("buyerId") ?? ""),
              po: String(form.get("po") ?? ""),
              notes: String(form.get("notes") ?? ""),
            });
            if (!result.ok) return result.error;
            setCreating(false);
            router.push(`/ai/orders/${result.data.id}`);
          }}
        >
          {(fieldError) => (
            <div className="grid gap-4">
              <Field id="run-title" label="Order name" error={fieldError("title")}>
                <Input
                  id="run-title"
                  name="title"
                  placeholder="Polo shirts for spring"
                  maxLength={160}
                  required
                />
              </Field>
              <Field id="run-buyer" label="Buyer" error={fieldError("buyerId")}>
                <NativeSelect
                  id="run-buyer"
                  name="buyerId"
                  defaultValue=""
                  containerClassName="sm:w-full"
                >
                  <option value="">Read it from the papers</option>
                  {buyers.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="run-po" label="PO number" error={fieldError("po")}>
                <Input id="run-po" name="po" maxLength={80} />
              </Field>
              <Field id="run-notes" label="Notes" error={fieldError("notes")}>
                <Textarea id="run-notes" name="notes" rows={2} maxLength={2000} />
              </Field>
            </div>
          )}
        </FormDialog>
      )}
    </div>
  );
}
