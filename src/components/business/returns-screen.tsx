"use client";

import { TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { PinField } from "@/components/ai/pin-prompt";
import { Field } from "@/components/forms/field";
import { StatusBadge } from "@/components/sales/badges";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { ReturnParcel, ReturnsPage } from "@/modules/retail/returns.service";
import {
  checkParcelAction,
  resolveHoldAction,
  undoDecisionAction,
} from "@/server/actions/retail.actions";

/*
 * Business > Returns (plan v6 sec 8.8): one page, three tabs. "Hold" needs the
 * owner to tick which pieces came back; "Return stock" waits for the check;
 * "History" keeps every finished parcel. Every button says first what will
 * happen to money and stock.
 */

type Tab = "hold" | "waiting" | "history";
type Dialog =
  | { kind: "resolve" | "missing" | "check"; parcel: ReturnParcel }
  | { kind: "undo"; parcel: ReturnParcel; piece: ReturnParcel["pieces"][number] };

const MATCH: Record<string, string> = {
  GREEN: "Pieces known",
  YELLOW: "Count known, colour or size at opening",
  ORANGE: "Unclear",
};

export function ReturnsScreen({ page }: { page: ReturnsPage }) {
  const [tab, setTab] = useState<Tab>(page.hold.length > 0 ? "hold" : "waiting");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const close = () => setDialog(null);
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "hold", label: `Hold (${page.hold.length})` },
    { id: "waiting", label: `Return stock (${page.waitingPieces})` },
    { id: "history", label: "History" },
  ];
  const list = tab === "hold" ? page.hold : tab === "waiting" ? page.waiting : page.history;

  return (
    <section aria-labelledby="returns-heading" className="grid min-w-0 gap-6">
      <div className="min-w-0">
        <h2 id="returns-heading" className="font-serif text-2xl text-primary">
          Returns
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Parcels the stores&apos; couriers handed back. Money changes only when a piece is checked:
          approved pieces come off the store&apos;s account at the price it paid, declined pieces
          stay its loss. Waiting for the check: {page.waitingPieces} piece(s), {page.currency}{" "}
          {page.waitingValue}.
        </p>
      </div>

      <div role="tablist" aria-label="Returns" className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            variant={tab === t.id ? "default" : "outline"}
            size="sm"
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {list.length === 0 ? (
        <p className="rounded-md border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
          {tab === "hold"
            ? "Nothing on Hold."
            : tab === "waiting"
              ? "No piece is waiting for the check."
              : "No parcel is finished yet."}
        </p>
      ) : (
        <ul className="grid gap-4 xl:grid-cols-2" aria-label="Parcels">
          {list.map((p) => (
            <li key={p.id} className="min-w-0">
              <ParcelCard
                parcel={p}
                page={page}
                onResolve={() => setDialog({ kind: "resolve", parcel: p })}
                onMissing={() => setDialog({ kind: "missing", parcel: p })}
                onCheck={() => setDialog({ kind: "check", parcel: p })}
                onUndo={(piece) => setDialog({ kind: "undo", parcel: p, piece })}
              />
            </li>
          ))}
        </ul>
      )}

      {dialog?.kind === "resolve" && <ResolveDialog parcel={dialog.parcel} onClose={close} />}
      {dialog?.kind === "missing" && <MissingDialog parcel={dialog.parcel} onClose={close} />}
      {dialog?.kind === "check" && (
        <CheckDialog page={page} parcel={dialog.parcel} onClose={close} />
      )}
      {dialog?.kind === "undo" && (
        <UndoDialog parcel={dialog.parcel} piece={dialog.piece} onClose={close} />
      )}
    </section>
  );
}

function ParcelCard({
  parcel: p,
  page,
  onResolve,
  onMissing,
  onCheck,
  onUndo,
}: {
  parcel: ReturnParcel;
  page: ReturnsPage;
  onResolve: () => void;
  onMissing: () => void;
  onCheck: () => void;
  onUndo: (piece: ReturnParcel["pieces"][number]) => void;
}) {
  const waiting = p.pieces.filter((x) => x.status === "WAITING").length;
  return (
    <article className="grid h-full gap-3 rounded-lg border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge
          tone={
            p.state === "HOLD"
              ? "warn"
              : p.state === "IN_RETURN_STOCK"
                ? "open"
                : p.state === "MISSING"
                  ? "closed"
                  : "done"
          }
        >
          {p.state === "HOLD"
            ? "Hold"
            : p.state === "IN_RETURN_STOCK"
              ? "Return stock"
              : p.state === "MISSING"
                ? "Parcel missing"
                : "Checked"}
        </StatusBadge>
        <span className="text-xs text-muted-foreground">{MATCH[p.match]}</span>
      </div>
      <p className="font-serif text-lg break-words text-primary">{p.consignmentId}</p>
      <dl className="grid gap-1 text-sm">
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-muted-foreground">Order:</dt>
          <dd className="min-w-0 break-words">
            <Link href={`/sales/orders/${p.orderId}`} className="text-primary hover:underline">
              {p.order}
            </Link>{" "}
            ({p.externalOrderId}), {p.store}
          </dd>
        </div>
        {p.exchange && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-muted-foreground">Exchange:</dt>
            <dd className="min-w-0 break-words">
              {p.exchange}: the old pieces; money settles by the check
            </dd>
          </div>
        )}
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-muted-foreground">Customer:</dt>
          <dd className="min-w-0 break-words">{p.customer || "Not given"}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-muted-foreground">Return list:</dt>
          <dd className="min-w-0 break-words">
            {p.returnListId}, {p.courier}, handed back {p.handedBackAt} ({p.daysSinceHandedBack}{" "}
            day(s) ago)
          </dd>
        </div>
        {p.delivery && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-muted-foreground">Courier result:</dt>
            <dd className="min-w-0 break-words">
              {p.delivery.status.toLowerCase()}, collected {page.currency} {p.delivery.collected}
              {p.delivery.note ? `: ${p.delivery.note}` : ""}
            </dd>
          </div>
        )}
        {p.receivedCount !== null && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-muted-foreground">Site counted:</dt>
            <dd className={p.countDiffers ? "text-destructive" : undefined}>
              {p.receivedCount} piece(s){p.note ? `: ${p.note}` : ""}
            </dd>
          </div>
        )}
      </dl>
      {p.late && (
        <p className="flex items-start gap-1.5 text-sm text-destructive">
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          Not checked in time: the courier&apos;s claim window is short.
        </p>
      )}
      {p.pieces.length > 0 && (
        <ul className="grid gap-1 text-sm" aria-label="Pieces">
          {p.pieces.map((x) => (
            <li key={x.id} className="flex flex-wrap justify-between gap-x-3">
              <span className="min-w-0 break-all">
                {x.sku}
                {x.differentPiece ? " (different piece)" : ""}
                {x.reservedFor && x.status === "WAITING" && (
                  <span className="block text-xs font-medium text-orange-700 dark:text-orange-400">
                    Sent on {x.reservedFor}: check before packing
                  </span>
                )}
              </span>
              <span className="text-muted-foreground">
                {page.currency} {x.price},{" "}
                {x.status === "WAITING"
                  ? "waiting"
                  : x.status === "APPROVED"
                    ? x.atPacking
                      ? "approved at packing"
                      : "approved"
                    : `declined: ${x.reason}`}
                {page.canCheck && x.undoable && (
                  <Button
                    type="button"
                    size="sm"
                    variant="link"
                    className="h-auto px-1 py-0"
                    onClick={() => onUndo(x)}
                  >
                    Undo the check
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {page.canCheck && p.state === "HOLD" && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={onResolve}>
            Tick the pieces
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onMissing}>
            This parcel did not come
          </Button>
        </div>
      )}
      {page.canCheck && p.state === "IN_RETURN_STOCK" && waiting > 0 && (
        <div>
          <Button type="button" size="sm" onClick={onCheck}>
            Check the pieces
          </Button>
        </div>
      )}
    </article>
  );
}

function ResolveDialog({ parcel, onClose }: { parcel: ReturnParcel; onClose: () => void }) {
  const router = useRouter();
  const [came, setCame] = useState<Record<string, number>>({});
  const total = Object.values(came).reduce((a, b) => a + b, 0);
  return (
    <FormDialog
      title="Tick the pieces"
      description={`${parcel.consignmentId}, order ${parcel.order}. ${
        total > 0
          ? `${total} piece(s) go to Return stock. Money does not change until the check.`
          : "Enter how many of each came back."
      }`}
      submitLabel="Save"
      pendingLabel="Saving"
      errorTitle="The parcel was not saved"
      onClose={onClose}
      onSubmit={async () => {
        const result = await resolveHoldAction(parcel.id, {
          came: Object.entries(came).map(([lineId, quantity]) => ({ lineId, quantity })),
        });
        if (!result.ok) return result.error;
        router.refresh();
        onClose();
        return undefined;
      }}
    >
      {(fieldError) => (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCame(Object.fromEntries(parcel.lines.map((l) => [l.id, l.quantity])))}
          >
            The whole parcel came back
          </Button>
          {parcel.lines.map((l) => (
            <Field
              key={l.id}
              id={`came-${l.id}`}
              label={`${l.sku} (${l.color}, ${l.size}): came back`}
              hint={`Of ${l.quantity}, at ${l.shopPrice} each`}
              error={fieldError("came")}
            >
              <Input
                id={`came-${l.id}`}
                type="number"
                min={0}
                max={l.quantity}
                value={came[l.id] ?? 0}
                onChange={(e) =>
                  setCame({
                    ...came,
                    [l.id]: Math.min(Math.max(Number(e.target.value) || 0, 0), l.quantity),
                  })
                }
              />
            </Field>
          ))}
        </>
      )}
    </FormDialog>
  );
}

function MissingDialog({ parcel, onClose }: { parcel: ReturnParcel; onClose: () => void }) {
  const router = useRouter();
  return (
    <FormDialog
      title="This parcel did not come"
      description={`${parcel.consignmentId}: nothing goes to Return stock and the store keeps the loss. It shows on its claim list for the courier.`}
      submitLabel="Save"
      pendingLabel="Saving"
      destructive
      errorTitle="The parcel was not saved"
      onClose={onClose}
      onSubmit={async () => {
        const result = await resolveHoldAction(parcel.id, { missing: true });
        if (!result.ok) return result.error;
        router.refresh();
        onClose();
        return undefined;
      }}
    >
      {() => null}
    </FormDialog>
  );
}

type Choice = { decision: "" | "APPROVE" | "DECLINE"; reason: string; variantId: string };

function CheckDialog({
  page,
  parcel,
  onClose,
}: {
  page: ReturnsPage;
  parcel: ReturnParcel;
  onClose: () => void;
}) {
  const router = useRouter();
  const waiting = parcel.pieces.filter((x) => x.status === "WAITING");
  const variantOf = (sku: string) => parcel.lines.find((l) => l.sku === sku)?.variantId ?? "";
  const [choices, setChoices] = useState<Record<string, Choice>>(
    Object.fromEntries(
      waiting.map((x) => [x.id, { decision: "", reason: "", variantId: variantOf(x.sku) }]),
    ),
  );
  const set = (id: string, change: Partial<Choice>) =>
    setChoices({ ...choices, [id]: { ...choices[id]!, ...change } });
  const all = (decision: Choice["decision"]) =>
    setChoices(
      Object.fromEntries(Object.entries(choices).map(([id, c]) => [id, { ...c, decision }])),
    );
  const priceOf = (x: (typeof waiting)[number]) => {
    const line = parcel.lines.find((l) => l.variantId === choices[x.id]?.variantId);
    return Number(line?.shopPrice ?? x.price);
  };
  const approved = waiting.filter((x) => choices[x.id]?.decision === "APPROVE");
  const declined = waiting.filter((x) => choices[x.id]?.decision === "DECLINE");
  const credit = approved.reduce((sum, x) => sum + priceOf(x), 0);
  const summary =
    approved.length + declined.length === 0
      ? "Choose a decision for each piece you check."
      : [
          approved.length > 0
            ? `${approved.length} approve: the store's balance goes down by ${page.currency} ${credit.toFixed(2)}, the pieces go back into stock.`
            : "",
          declined.length > 0
            ? `${declined.length} decline: they stay on the store's account as its loss.`
            : "",
        ]
          .filter(Boolean)
          .join(" ");

  return (
    <FormDialog
      title="Check the pieces"
      description={`${parcel.consignmentId}, order ${parcel.order}. ${summary}`}
      submitLabel="Save the check"
      pendingLabel="Saving"
      errorTitle="The check was not saved"
      onClose={onClose}
      onSubmit={async () => {
        const decisions = waiting
          .filter((x) => choices[x.id]?.decision)
          .map((x) => {
            const c = choices[x.id]!;
            return {
              pieceId: x.id,
              decision: c.decision,
              ...(c.decision === "DECLINE" ? { reason: c.reason || undefined } : {}),
              ...(c.variantId && c.variantId !== variantOf(x.sku)
                ? { variantId: c.variantId }
                : {}),
            };
          });
        const result = await checkParcelAction(parcel.id, { decisions });
        if (!result.ok) return result.error;
        router.refresh();
        onClose();
        return undefined;
      }}
    >
      {(fieldError) => (
        <>
          <div className="flex flex-wrap gap-2">
            {page.canApprove && (
              <Button type="button" variant="outline" size="sm" onClick={() => all("APPROVE")}>
                Approve all
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" onClick={() => all("DECLINE")}>
              Decline all
            </Button>
          </div>
          {!page.canApprove && (
            <p className="text-sm text-muted-foreground">
              Approving credits the store&apos;s account, so it needs Accounts&apos; right too. You
              can decline pieces.
            </p>
          )}
          {waiting.map((x, index) => {
            const c = choices[x.id]!;
            return (
              <fieldset key={x.id} className="grid gap-3 rounded-md border p-3">
                <legend className="px-1 text-sm font-medium break-all">
                  Piece {index + 1}: {x.sku}, {page.currency} {x.price}
                  {x.reservedFor ? `, sent on ${x.reservedFor}: check before packing` : ""}
                </legend>
                <Field id={`decision-${x.id}`} label="Decision" error={fieldError("decisions")}>
                  <NativeSelect
                    id={`decision-${x.id}`}
                    value={c.decision}
                    onChange={(e) => set(x.id, { decision: e.target.value as Choice["decision"] })}
                    containerClassName="sm:w-full"
                  >
                    <option value="">Not yet</option>
                    {page.canApprove && <option value="APPROVE">Approve</option>}
                    <option value="DECLINE">Decline</option>
                  </NativeSelect>
                </Field>
                {c.decision === "DECLINE" && (
                  <Field id={`reason-${x.id}`} label="Why declined" error={fieldError("reason")}>
                    <NativeSelect
                      id={`reason-${x.id}`}
                      value={c.reason}
                      onChange={(e) => set(x.id, { reason: e.target.value })}
                      containerClassName="sm:w-full"
                    >
                      <option value="">Choose</option>
                      {page.reasons.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                )}
                <Field
                  id={`found-${x.id}`}
                  label="Piece found"
                  hint="Another of the order's SKUs when the parcel held a different piece."
                >
                  <NativeSelect
                    id={`found-${x.id}`}
                    value={c.variantId}
                    onChange={(e) => set(x.id, { variantId: e.target.value })}
                    containerClassName="sm:w-full"
                  >
                    {parcel.lines.map((l) => (
                      <option key={l.id} value={l.variantId}>
                        {l.sku}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </fieldset>
            );
          })}
        </>
      )}
    </FormDialog>
  );
}

function UndoDialog({
  parcel,
  piece,
  onClose,
}: {
  parcel: ReturnParcel;
  piece: ReturnParcel["pieces"][number];
  onClose: () => void;
}) {
  const router = useRouter();
  return (
    <FormDialog
      title="Undo the check"
      description={
        piece.status === "APPROVED"
          ? `${piece.sku} (${parcel.consignmentId}) waits for the check again. The store's credit for it is taken back by a reversing entry, with any other piece approved on the same credit, and it leaves main stock again. The store's site is told.`
          : `${piece.sku} (${parcel.consignmentId}) waits for the check again. No money or stock changes. The store's site is told.`
      }
      submitLabel="Undo it"
      pendingLabel="Saving"
      destructive
      errorTitle="The check was not undone"
      onClose={onClose}
      onSubmit={async (form) => {
        const result = await undoDecisionAction(piece.id, {
          reason: String(form.get("reason") ?? ""),
          pin: String(form.get("pin") ?? ""),
        });
        if (!result.ok) return result.error;
        router.refresh();
        onClose();
        return undefined;
      }}
    >
      {(fieldError) => (
        <>
          <Field id="undo-reason" label="Reason" error={fieldError("reason")}>
            <Input id="undo-reason" name="reason" maxLength={300} autoComplete="off" />
          </Field>
          <PinField id="undo-pin" error={fieldError("pin") ?? fieldError("pinNotSet")} />
        </>
      )}
    </FormDialog>
  );
}
