"use client";

import {
  BookOpenCheckIcon,
  CalculatorIcon,
  CheckIcon,
  FileTextIcon,
  PaperclipIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { askFirstOf } from "@/components/ai/ask-first";
import { RUN_TONES } from "@/components/ai/orders-list";
import { useWhen } from "@/components/ai/when";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { CheckRows, OrderCheckCard } from "@/components/production/costing/order-check-card";
import { StatusBadge } from "@/components/sales/badges";
import { Fact, Panel, RecordHeader } from "@/components/sales/detail-bits";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { type OrderLine, RUN_STATUS_TEXT, type StepState } from "@/modules/ai/orders/order-run";
import type { OrderRunScreen as Run } from "@/modules/ai/orders/order-run.service";
import {
  attachOrderFileAction,
  closeOrderRunAction,
  decideOrderRunAction,
  linkOrderSalesAction,
  makeOrderCostingAction,
  makeOrderPlanAction,
  readOrderFilesAction,
  removeOrderFileAction,
  updateOrderRunAction,
} from "@/server/actions/orders.actions";

/*
 * One order given to Mehedi 2.0: the buyer's papers, the form he reads them
 * into (and the one question he asks next), his checks, the costing sheet and
 * its Order check card, the plan for the owner's Approve or Return, and after
 * Approve each step with its T&A day, what staff told him, and closing it.
 */

type Result = { ok: true } | { ok: false; error: { message: string } };

const OPEN = ["INTAKE", "RETURNED", "WAITING_OWNER"];

const STEP_STATE: Record<StepState, { text: string; dot: string }> = {
  done: { text: "Done", dot: "bg-success" },
  late: { text: "Late", dot: "bg-destructive" },
  waiting: { text: "Not yet", dot: "bg-muted-foreground/40" },
};

type Form = {
  title: string;
  buyerId: string;
  buyer: string;
  po: string;
  quantity: string;
  shipDate: string;
  price: string;
  currency: string;
  fabric: string;
  logo: string;
  packing: string;
  notes: string;
  lines: Array<{ style: string; colour: string; size: string; quantity: string }>;
};

const formOf = (r: Run): Form => ({
  title: r.title,
  buyerId: r.buyerId ?? "",
  buyer: r.fields.buyer ?? "",
  po: r.fields.po ?? "",
  quantity: r.fields.quantity?.toString() ?? "",
  shipDate: r.fields.shipDate ?? "",
  price: r.fields.price?.toString() ?? "",
  currency: r.fields.currency ?? "",
  fabric: r.fields.fabric ?? "",
  logo: r.fields.logo ?? "",
  packing: r.fields.packing ?? "",
  notes: r.fields.notes ?? "",
  lines: r.fields.lines.map((l: OrderLine) => ({
    style: l.style,
    colour: l.colour ?? "",
    size: l.size ?? "",
    quantity: String(l.quantity),
  })),
});

export function OrderRunScreen({ run: r }: { run: Run }) {
  const when = useWhen();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "error" | "note"; text: string }>();
  const [form, setForm] = useState<Form>(() => formOf(r));
  // When the saved form changes (the papers were read, or saved), show it.
  const saved = JSON.stringify(formOf(r));
  const [shown, setShown] = useState(saved);
  if (shown !== saved) {
    setShown(saved);
    setForm(formOf(r));
  }
  const [dialog, setDialog] = useState<
    "attach" | "costing" | "return" | "cancel" | "done" | "link" | null
  >(null);
  const [asked, setAsked] = useState<string | null>(null);
  const editable = r.canManage && OPEN.includes(r.status);
  const approved = r.status === "APPROVED" || r.status === "DONE";

  const run = (work: () => Promise<Result>, done: string) =>
    startTransition(async () => {
      const result = await work();
      setMessage(
        result.ok ? { tone: "success", text: done } : { tone: "error", text: result.error.message },
      );
    });

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((now) => ({ ...now, [key]: value }));
  const setLine = (i: number, key: keyof Form["lines"][number], value: string) =>
    setForm((now) => ({
      ...now,
      lines: now.lines.map((l, n) => (n === i ? { ...l, [key]: value } : l)),
    }));

  const save = () =>
    run(
      () =>
        updateOrderRunAction(r.id, {
          title: form.title,
          buyerId: form.buyerId,
          fields: {
            buyer: form.buyer,
            po: form.po,
            quantity: form.quantity,
            shipDate: form.shipDate,
            price: form.price,
            currency: form.currency,
            fabric: form.fabric,
            logo: form.logo,
            packing: form.packing,
            notes: form.notes,
            lines: form.lines
              .filter((l) => l.style.trim() || l.quantity.trim())
              .map((l) => ({ ...l, quantity: l.quantity || "0" })),
          },
        }),
      "The form is saved.",
    );

  const read = () =>
    startTransition(async () => {
      const result = await readOrderFilesAction(r.id);
      if (!result.ok) return setMessage({ tone: "error", text: result.error.message });
      setMessage({
        tone: "success",
        text: result.data.filled.length
          ? `Read from the papers: ${result.data.filled.join(", ")}.`
          : "Nothing new on the papers: the form already had it.",
      });
    });

  const plan = (costOk: boolean) =>
    startTransition(async () => {
      const result = await makeOrderPlanAction(r.id, { byAi: true, costOk });
      if (result.ok) {
        setAsked(null);
        setMessage({
          tone: "success",
          text: result.data.planByAi
            ? "Mehedi 2.0 wrote the plan. Read it, then Approve or Return."
            : "The plan is ready. Read it, then Approve or Return.",
        });
        return;
      }
      const first = askFirstOf(result.error);
      if (first) {
        setAsked(first);
        setMessage(undefined);
      } else setMessage({ tone: "error", text: result.error.message });
    });

  const pieces = form.lines.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);

  return (
    <div className="grid gap-6">
      <RecordHeader
        eyebrow={
          <Link href="/ai/orders" className="underline-offset-4 hover:underline">
            {`Orders / ${r.number}`}
          </Link>
        }
        title={r.title}
        badges={
          <>
            <StatusBadge tone={RUN_TONES[r.status] ?? "plain"}>
              {RUN_STATUS_TEXT[r.status]}
            </StatusBadge>
            {r.mode === "DRY_RUN" && r.status !== "INTAKE" && (
              <StatusBadge tone="plain">Dry run</StatusBadge>
            )}
          </>
        }
      >
        <p className="mt-2 text-[0.8125rem] text-muted-foreground">
          {`Started by ${r.createdBy ?? "someone"} on ${when(r.createdAt)}. AI cost so far: ${r.currency} ${r.aiCostSoFar}.`}
        </p>
      </RecordHeader>

      {message && <FormAlert tone={message.tone}>{message.text}</FormAlert>}
      {r.status === "RETURNED" && r.decisionNote && (
        <FormAlert tone="note">
          {`You returned the plan: ${r.decisionNote}. Change the form, then make the plan again.`}
        </FormAlert>
      )}
      {editable && r.question && (
        <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-secondary p-4 text-sm">
          <SparklesIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
          <div>
            <p className="font-medium">Mehedi 2.0 asks</p>
            <p className="mt-0.5">{r.question}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Panel
            title="The order"
            id="run-form-heading"
            action={
              editable && (
                <Button type="button" size="sm" disabled={pending} onClick={save}>
                  <CheckIcon aria-hidden />
                  Save the form
                </Button>
              )
            }
          >
            {editable ? (
              <div className="mt-4 grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id="run-name" label="Order name">
                    <Input
                      id="run-name"
                      value={form.title}
                      maxLength={160}
                      onChange={(e) => set("title", e.target.value)}
                    />
                  </Field>
                  <Field id="run-po" label="PO number">
                    <Input
                      id="run-po"
                      value={form.po}
                      maxLength={80}
                      onChange={(e) => set("po", e.target.value)}
                    />
                  </Field>
                  <Field
                    id="run-buyer"
                    label="Buyer"
                    hint={
                      form.buyerId ? undefined : "Not in the list? Write the name as on the PO."
                    }
                  >
                    <NativeSelect
                      id="run-buyer"
                      value={form.buyerId}
                      containerClassName="sm:w-full"
                      onChange={(e) => set("buyerId", e.target.value)}
                    >
                      <option value="">Not picked</option>
                      {r.buyers.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  {!form.buyerId && (
                    <Field id="run-buyer-name" label="Buyer on the PO">
                      <Input
                        id="run-buyer-name"
                        value={form.buyer}
                        maxLength={160}
                        onChange={(e) => set("buyer", e.target.value)}
                      />
                    </Field>
                  )}
                  <Field id="run-ship" label="Ship date">
                    <Input
                      id="run-ship"
                      type="date"
                      value={form.shipDate}
                      onChange={(e) => set("shipDate", e.target.value)}
                    />
                  </Field>
                  <Field id="run-qty" label="Total quantity" hint="As the PO states it.">
                    <Input
                      id="run-qty"
                      inputMode="numeric"
                      value={form.quantity}
                      onChange={(e) => set("quantity", e.target.value)}
                    />
                  </Field>
                  <Field id="run-price" label="Price per piece">
                    <Input
                      id="run-price"
                      inputMode="decimal"
                      value={form.price}
                      onChange={(e) => set("price", e.target.value)}
                    />
                  </Field>
                  <Field id="run-currency" label="Currency" hint={`Empty means ${r.currency}.`}>
                    <Input
                      id="run-currency"
                      value={form.currency}
                      maxLength={3}
                      placeholder={r.currency}
                      onChange={(e) => set("currency", e.target.value.toUpperCase())}
                    />
                  </Field>
                  <Field id="run-fabric" label="Fabric">
                    <Input
                      id="run-fabric"
                      value={form.fabric}
                      maxLength={300}
                      onChange={(e) => set("fabric", e.target.value)}
                    />
                  </Field>
                  <Field id="run-logo" label="Logo">
                    <Input
                      id="run-logo"
                      value={form.logo}
                      maxLength={300}
                      onChange={(e) => set("logo", e.target.value)}
                    />
                  </Field>
                  <Field id="run-packing" label="Packing">
                    <Input
                      id="run-packing"
                      value={form.packing}
                      maxLength={300}
                      onChange={(e) => set("packing", e.target.value)}
                    />
                  </Field>
                </div>

                <fieldset className="grid gap-2">
                  <legend className="text-sm font-medium">Styles, colours and sizes</legend>
                  {form.lines.length === 0 && (
                    <p className="text-[0.8125rem] text-muted-foreground">
                      No lines yet: read the papers or add them here.
                    </p>
                  )}
                  {form.lines.map((l, i) => (
                    <div
                      key={i}
                      className="grid grid-cols-2 items-end gap-2 rounded-md border p-2 sm:grid-cols-[1fr_1fr_5rem_6rem_auto] sm:border-0 sm:p-0"
                    >
                      <Input
                        aria-label={`Style, line ${i + 1}`}
                        placeholder="Style"
                        value={l.style}
                        maxLength={60}
                        onChange={(e) => setLine(i, "style", e.target.value)}
                      />
                      <Input
                        aria-label={`Colour, line ${i + 1}`}
                        placeholder="Colour"
                        value={l.colour}
                        maxLength={60}
                        onChange={(e) => setLine(i, "colour", e.target.value)}
                      />
                      <Input
                        aria-label={`Size, line ${i + 1}`}
                        placeholder="Size"
                        value={l.size}
                        maxLength={20}
                        onChange={(e) => setLine(i, "size", e.target.value)}
                      />
                      <Input
                        aria-label={`Pieces, line ${i + 1}`}
                        placeholder="Pieces"
                        inputMode="numeric"
                        value={l.quantity}
                        onChange={(e) => setLine(i, "quantity", e.target.value)}
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`Remove line ${i + 1}`}
                        onClick={() =>
                          setForm((now) => ({
                            ...now,
                            lines: now.lines.filter((_, n) => n !== i),
                          }))
                        }
                      >
                        <XIcon aria-hidden />
                      </Button>
                    </div>
                  ))}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setForm((now) => ({
                          ...now,
                          lines: [
                            ...now.lines,
                            {
                              style: now.lines.at(-1)?.style ?? "",
                              colour: now.lines.at(-1)?.colour ?? "",
                              size: "",
                              quantity: "",
                            },
                          ],
                        }))
                      }
                    >
                      <PlusIcon aria-hidden />
                      Add a line
                    </Button>
                    <span className="text-[0.8125rem] text-muted-foreground">
                      {`Lines add up to ${pieces.toLocaleString("en-US")} pieces.`}
                    </span>
                  </div>
                </fieldset>

                <Field id="run-notes" label="Notes">
                  <Textarea
                    id="run-notes"
                    rows={3}
                    value={form.notes}
                    maxLength={2000}
                    onChange={(e) => set("notes", e.target.value)}
                  />
                </Field>
              </div>
            ) : (
              <ReadOnlyForm run={r} />
            )}
          </Panel>

          <Panel title="Checks" id="run-checks-heading">
            <p className="mt-1 text-sm text-muted-foreground">
              What Mehedi 2.0 checked on the form. It never declines anything: you decide.
            </p>
            <CheckRows rows={r.checks} />
          </Panel>

          {r.card && <OrderCheckCard rows={r.card} />}

          {(r.plan || (editable && r.missing.length === 0)) && (
            <Panel
              title="The plan"
              id="run-plan-heading"
              action={
                editable &&
                r.missing.length === 0 && (
                  <Button
                    type="button"
                    size="sm"
                    variant={r.plan ? "outline" : "default"}
                    disabled={pending}
                    onClick={() => plan(false)}
                  >
                    <SparklesIcon aria-hidden />
                    {r.plan ? "Make the plan again" : "Make the plan"}
                  </Button>
                )
              }
            >
              {asked && (
                <div className="mt-4 grid gap-2 rounded-md border border-primary/30 bg-secondary p-3 text-sm">
                  <p>{asked}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" disabled={pending} onClick={() => plan(true)}>
                      Go on
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setAsked(null)}
                    >
                      Not now
                    </Button>
                  </div>
                </div>
              )}
              {r.plan ? (
                <div className="mt-4 grid gap-3">
                  <p className="text-[0.8125rem] text-muted-foreground">
                    {`${r.planByAi ? "Written by Mehedi 2.0 (AI)" : "Written by the ERP from its own data"} on ${when(r.plannedAt)}.${r.estimatedAiCost ? ` AI cost for this order: about ${r.currency} ${r.estimatedAiCost} (an estimate).` : ""}`}
                  </p>
                  <div className="rounded-md border bg-background p-4 text-sm break-words whitespace-pre-wrap">
                    {r.plan}
                  </div>
                  {r.status === "WAITING_OWNER" && r.canManage && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          run(
                            () => decideOrderRunAction(r.id, { decision: "APPROVE" }),
                            "Approved. Mehedi 2.0 now follows each step against the T&A.",
                          )
                        }
                      >
                        <CheckIcon aria-hidden />
                        Approve
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={pending}
                        onClick={() => setDialog("return")}
                      >
                        <Undo2Icon aria-hidden />
                        Return
                      </Button>
                    </div>
                  )}
                  {r.decidedAt && (
                    <p className="text-[0.8125rem] text-muted-foreground">
                      {`${r.status === "RETURNED" ? "Returned" : "Approved"} by ${r.decidedBy ?? "the owner"} on ${when(r.decidedAt)}.`}
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  The form is complete. Make the plan: Mehedi 2.0 writes what he will do, the
                  T&amp;A, the factory, the costing and the risks, for your Approve.
                </p>
              )}
            </Panel>
          )}

          {r.steps && (
            <Panel title="Steps" id="run-steps-heading">
              <p className="mt-1 text-sm text-muted-foreground">
                {r.mode === "DRY_RUN"
                  ? "A dry run: people do each step in the ERP; this shows what Mehedi 2.0 would do and what is done."
                  : "People do each step in the ERP; Mehedi 2.0 follows them and tells you of any slip."}
              </p>
              <ol className="mt-4 grid gap-2">
                {r.steps.map((s) => {
                  const st = STEP_STATE[s.state];
                  return (
                    <li
                      key={s.key}
                      className={cn(
                        "grid gap-1 rounded-md border bg-background p-3 text-sm",
                        s.state === "late" && "border-destructive/30",
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          role="img"
                          aria-label={st.text}
                          title={st.text}
                          className={cn("size-2.5 shrink-0 rounded-full", st.dot)}
                        />
                        {s.href ? (
                          <Link
                            href={s.href}
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            {s.label}
                          </Link>
                        ) : (
                          <span className="font-medium">{s.label}</span>
                        )}
                        <span className="text-muted-foreground">{st.text}</span>
                        {s.by && (
                          <span
                            className={cn(
                              "ml-auto text-[0.8125rem]",
                              s.state === "late" ? "text-destructive" : "text-muted-foreground",
                            )}
                          >
                            {`by ${s.by}`}
                          </span>
                        )}
                      </div>
                      <p className="text-[0.8125rem] text-muted-foreground">{s.would}</p>
                    </li>
                  );
                })}
              </ol>
            </Panel>
          )}
        </div>

        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Panel
            title="Papers"
            id="run-files-heading"
            action={
              editable && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={r.files.length >= 8}
                  onClick={() => setDialog("attach")}
                >
                  <PaperclipIcon aria-hidden />
                  Attach
                </Button>
              )
            }
          >
            {r.files.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                The buyer&apos;s PO, order sheet or photos (up to 8).
              </p>
            ) : (
              <ul className="mt-3 grid gap-2">
                {r.files.map((file) => (
                  <li key={file.id} className="flex items-center gap-2 text-sm">
                    <FileTextIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    <a
                      href={file.href}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 flex-1 wrap-anywhere underline-offset-4 hover:underline"
                    >
                      {file.fileName}
                    </a>
                    {editable && (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`Remove ${file.fileName}`}
                        disabled={pending}
                        onClick={() =>
                          run(() => removeOrderFileAction(r.id, file.id), "The file is removed.")
                        }
                      >
                        <Trash2Icon aria-hidden />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {editable && r.files.length > 0 && (
              <div className="mt-3">
                <Button type="button" size="sm" disabled={pending} onClick={read}>
                  <BookOpenCheckIcon aria-hidden />
                  Read the files
                </Button>
                <p className="mt-2 text-[0.8125rem] text-muted-foreground">
                  He fills only the empty fields: nothing you typed is changed.
                </p>
              </div>
            )}
          </Panel>

          <Panel title="Costing" id="run-costing-heading">
            {r.costing ? (
              <dl className="mt-3 grid gap-3">
                <Fact label="Costing sheet">
                  <Link href={r.costing.href} className="underline underline-offset-4">
                    {r.costing.number}
                  </Link>
                </Fact>
                <Fact label="Profit">
                  {r.costing.profitPercent
                    ? `${r.costing.profitPercent}%`
                    : "Not set yet (yours to set)"}
                </Fact>
              </dl>
            ) : (
              <div className="mt-2 grid gap-3 text-sm">
                <p className="text-muted-foreground">
                  One line per style with its pieces and the buyer&apos;s price. You then pick the
                  supplier&apos;s fabric quote (price per kg), the CM fixed per style, and set the
                  profit %.
                </p>
                {r.canManage && r.canCost && r.status !== "CANCELLED" && (
                  <div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending || form.lines.length === 0}
                      onClick={() =>
                        r.foreignCurrency
                          ? setDialog("costing")
                          : run(
                              () => makeOrderCostingAction(r.id, {}),
                              "The costing sheet is made. Open it to pick the fabric quote, the CM and the profit %.",
                            )
                      }
                    >
                      <CalculatorIcon aria-hidden />
                      Make the costing sheet
                    </Button>
                  </div>
                )}
              </div>
            )}
          </Panel>

          {approved && (
            <Panel
              title="Order in Sales"
              id="run-sales-heading"
              action={
                r.canManage &&
                r.status === "APPROVED" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setDialog("link")}
                  >
                    {r.salesOrder ? "Change" : "Link"}
                  </Button>
                )
              }
            >
              <p className="mt-2 text-sm">
                {r.salesOrder ? (
                  <Link
                    href={`/sales/orders/${r.salesOrder.id}`}
                    className="underline underline-offset-4"
                  >
                    {r.salesOrder.number}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">
                    Linked by itself once the costing sheet becomes an order; or link it here.
                  </span>
                )}
              </p>
            </Panel>
          )}

          <Panel title="What staff told the AI" id="run-updates-heading">
            {r.updates.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Nothing yet. Staff use Tell AI on My HR or the Production overview.
              </p>
            ) : (
              <ul className="mt-3 grid gap-2">
                {r.updates.map((u) => (
                  <li
                    key={u.id}
                    className={cn(
                      "grid gap-0.5 rounded-md border p-2 text-[0.8125rem]",
                      u.problem && "border-destructive/30",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                      <span>{when(u.at)}</span>
                      <span>{u.by}</span>
                      {u.problem && <StatusBadge tone="warn">Problem</StatusBadge>}
                    </div>
                    <p className="break-words whitespace-pre-wrap">{u.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {r.canManage && r.status !== "DONE" && r.status !== "CANCELLED" && (
            <div className="flex flex-wrap gap-2">
              {r.status === "APPROVED" && (
                <Button type="button" variant="outline" onClick={() => setDialog("done")}>
                  Mark done
                </Button>
              )}
              <Button type="button" variant="outline" onClick={() => setDialog("cancel")}>
                Cancel the order
              </Button>
            </div>
          )}
        </div>
      </div>

      {dialog === "attach" && (
        <FormDialog
          title="Attach a paper"
          description="The buyer's PO, order sheet or a photo of it."
          submitLabel="Attach"
          pendingLabel="Attaching"
          errorTitle="We could not attach the file"
          onClose={() => setDialog(null)}
          onSubmit={async (data) => {
            const result = await attachOrderFileAction(r.id, data);
            if (!result.ok) return result.error;
            setMessage({ tone: "success", text: `${result.data.fileName} is attached.` });
            setDialog(null);
          }}
        >
          {(fieldError) => (
            <Field
              id="run-file"
              label="File"
              hint="JPG, PNG, WebP or PDF, up to 10 MB."
              error={fieldError("file")}
            >
              <Input
                id="run-file"
                name="file"
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                required
              />
            </Field>
          )}
        </FormDialog>
      )}

      {dialog === "costing" && (
        <FormDialog
          title="Make the costing sheet"
          description={`The buyer pays in ${form.currency || r.currency}. Give today's rate to ${r.currency}.`}
          submitLabel="Make"
          pendingLabel="Making"
          errorTitle="We could not make the costing sheet"
          onClose={() => setDialog(null)}
          onSubmit={async (data) => {
            const result = await makeOrderCostingAction(r.id, {
              exchangeRate: String(data.get("exchangeRate") ?? ""),
            });
            if (!result.ok) return result.error;
            setMessage({
              tone: "success",
              text: "The costing sheet is made. Open it to pick the fabric quote, the CM and the profit %.",
            });
            setDialog(null);
          }}
        >
          {(fieldError) => (
            <Field
              id="run-rate"
              label="Exchange rate"
              hint={`${r.currency} for 1 ${form.currency || r.currency}.`}
              error={fieldError("exchangeRate")}
            >
              <Input id="run-rate" name="exchangeRate" inputMode="decimal" required />
            </Field>
          )}
        </FormDialog>
      )}

      {dialog === "return" && (
        <FormDialog
          title="Return the plan"
          description="Say what to change. The form opens again for you and Mehedi 2.0."
          submitLabel="Return"
          pendingLabel="Returning"
          errorTitle="We could not return the plan"
          onClose={() => setDialog(null)}
          onSubmit={async (data) => {
            const result = await decideOrderRunAction(r.id, {
              decision: "RETURN",
              note: String(data.get("note") ?? ""),
            });
            if (!result.ok) return result.error;
            setMessage({
              tone: "success",
              text: "Returned. Change the form, then make the plan again.",
            });
            setDialog(null);
          }}
        >
          {(fieldError) => (
            <Field id="run-note" label="What to change" error={fieldError("note")}>
              <Textarea id="run-note" name="note" rows={3} maxLength={1000} required />
            </Field>
          )}
        </FormDialog>
      )}

      {dialog === "link" && (
        <FormDialog
          title="Link the order in Sales"
          description="The buyer's order this became, so its steps are followed."
          submitLabel="Save"
          pendingLabel="Saving"
          errorTitle="We could not link the order"
          onClose={() => setDialog(null)}
          onSubmit={async (data) => {
            const result = await linkOrderSalesAction(r.id, {
              salesOrderId: String(data.get("salesOrderId") ?? ""),
            });
            if (!result.ok) return result.error;
            setMessage({ tone: "success", text: "Saved." });
            setDialog(null);
          }}
        >
          {(fieldError) => (
            <Field id="run-sales" label="Sales order" error={fieldError("salesOrderId")}>
              <NativeSelect
                id="run-sales"
                name="salesOrderId"
                defaultValue={r.salesOrder?.id ?? ""}
                containerClassName="sm:w-full"
              >
                <option value="">Not linked</option>
                {r.salesOrders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.number}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
        </FormDialog>
      )}

      {dialog === "done" && (
        <ConfirmDialog
          title="Mark the order done?"
          description="Shipped and settled: Mehedi 2.0 stops following it."
          confirmLabel="Mark done"
          pendingLabel="Saving"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            const result = await closeOrderRunAction(r.id, { as: "DONE" });
            if (!result.ok) return result.error;
            setDialog(null);
          }}
        />
      )}

      {dialog === "cancel" && (
        <ConfirmDialog
          title="Cancel the order?"
          description="Mehedi 2.0 stops following it. Nothing made in the ERP is deleted."
          confirmLabel="Cancel the order"
          pendingLabel="Cancelling"
          destructive
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            const result = await closeOrderRunAction(r.id, { as: "CANCELLED" });
            if (!result.ok) return result.error;
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}

function ReadOnlyForm({ run: r }: { run: Run }) {
  const f = r.fields;
  return (
    <div className="mt-4 grid gap-4">
      <dl className="grid gap-4 sm:grid-cols-2">
        <Fact label="Buyer">{r.buyer?.name ?? f.buyer ?? "Not set"}</Fact>
        <Fact label="PO number">{f.po ?? "Not set"}</Fact>
        <Fact label="Ship date">{f.shipDate ?? "Not set"}</Fact>
        <Fact label="Total quantity">{f.quantity?.toLocaleString("en-US") ?? "Not set"}</Fact>
        <Fact label="Price per piece">
          {f.price !== null ? `${f.currency ?? r.currency} ${f.price}` : "Not set"}
        </Fact>
        <Fact label="Fabric">{f.fabric ?? "Not set"}</Fact>
        <Fact label="Logo">{f.logo ?? "Not set"}</Fact>
        <Fact label="Packing">{f.packing ?? "Not set"}</Fact>
      </dl>
      {f.lines.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[0.8125rem] text-muted-foreground">
                <th className="py-1.5 pr-3 font-normal">Style</th>
                <th className="py-1.5 pr-3 font-normal">Colour</th>
                <th className="py-1.5 pr-3 font-normal">Size</th>
                <th className="py-1.5 text-right font-normal">Pieces</th>
              </tr>
            </thead>
            <tbody>
              {f.lines.map((l, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-1.5 pr-3">{l.style}</td>
                  <td className="py-1.5 pr-3">{l.colour ?? ""}</td>
                  <td className="py-1.5 pr-3">{l.size ?? ""}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {l.quantity.toLocaleString("en-US")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {f.notes && <p className="text-sm break-words whitespace-pre-wrap">{f.notes}</p>}
    </div>
  );
}
