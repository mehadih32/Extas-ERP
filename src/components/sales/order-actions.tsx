"use client";

import {
  BanIcon,
  BanknoteIcon,
  CalendarIcon,
  EllipsisVerticalIcon,
  FileTextIcon,
  FileXIcon,
  PackageIcon,
  PencilIcon,
  TruckIcon,
  Undo2Icon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { FormAlert, Field } from "@/components/forms/field";
import { textOf } from "@/components/products/form-values";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { OrderScreen } from "@/modules/sales/screens.service";
import {
  cancelOrderAction,
  createDeliveryChallanAction,
  createPackingListAction,
  issueInvoiceAction,
  setOrderShipmentDateAction,
  voidInvoiceAction,
} from "@/server/actions/sales.actions";

import {
  FormDialog,
  problem,
  readReason,
  ReasonField,
  ReceivePaymentDialog,
  RefundDialog,
  readSettle,
  SettleFields,
} from "./dialogs";
import { isZero, money, salesHref } from "./labels";

type Open =
  | "receive"
  | "invoice"
  | "challan"
  | "packing"
  | "shipment"
  | "voidInvoice"
  | "refund"
  | "cancel"
  | null;

const wholeNumber = (text: string) => (/^\d{1,7}$/.test(text.trim()) ? Number(text) : null);

/**
 * What can be done with an order, each offered from the flags the screen came
 * with (screen.can, from sales/rules.ts): sales.order.create edits it, issues
 * the invoice, makes the packing list and delivery challans, sets the ship-by
 * day and cancels it; Accounts receives and refunds money; sales.invoice.edit
 * voids the invoice. The PDFs are with the documents on the page.
 */
export function OrderActions({
  screen,
  currency,
  today,
  notice: initialNotice,
}: {
  screen: OrderScreen;
  currency: string;
  today: string;
  notice?: string;
}) {
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useState(initialNotice);
  const { order: o, can } = screen;
  const close = () => setOpen(null);
  const done = (message: string) => {
    setNotice(message);
    close();
  };
  const refund = can.refundKinds.length > 0;
  type MenuItem = { key: Exclude<Open, null>; label: string; icon: typeof BanIcon };
  const menu: MenuItem[] = [];
  if (can.packingList)
    menu.push({ key: "packing", label: "Make the packing list", icon: PackageIcon });
  if (can.shipmentDate) {
    menu.push({
      key: "shipment",
      label: o.shipmentOn ? "Change the ship-by day" : "Set a ship-by day",
      icon: CalendarIcon,
    });
  }
  if (can.voidInvoice)
    menu.push({ key: "voidInvoice", label: "Void the invoice", icon: FileXIcon });
  if (refund) menu.push({ key: "refund", label: "Refund money paid", icon: Undo2Icon });
  const hasMenu = menu.length > 0 || can.cancel;
  const lines = o.styles.flatMap((s) =>
    s.lines.filter((l) => l.remaining > 0).map((l) => ({ ...l, style: s.style.code })),
  );

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 10_000);
    return () => clearTimeout(timer);
  }, [notice]);

  const primary = [
    can.receive && (
      <Button
        key="receive"
        type="button"
        onClick={() => setOpen("receive")}
        className="w-full sm:w-auto"
      >
        <BanknoteIcon aria-hidden />
        Receive a payment
      </Button>
    ),
    can.issueInvoice && (
      <Button
        key="invoice"
        type="button"
        variant={can.receive ? "outline" : "default"}
        onClick={() => setOpen("invoice")}
        className="w-full sm:w-auto"
      >
        <FileTextIcon aria-hidden />
        Issue the invoice
      </Button>
    ),
    can.challan && (
      <Button
        key="challan"
        type="button"
        variant={can.receive || can.issueInvoice ? "outline" : "default"}
        onClick={() => setOpen("challan")}
        className="w-full sm:w-auto"
      >
        <TruckIcon aria-hidden />
        Deliver goods
      </Button>
    ),
  ].filter(Boolean);

  return (
    <div className="grid gap-4">
      {(primary.length > 0 || can.edit || hasMenu) && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {primary}
          {(can.edit || hasMenu) && (
            <div className="flex gap-2">
              {can.edit && (
                <Button asChild variant="outline" className="flex-1 sm:flex-none">
                  <Link href={`${salesHref.order(o.id)}/edit`}>
                    <PencilIcon aria-hidden />
                    Edit
                  </Link>
                </Button>
              )}
              {hasMenu && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size={can.edit ? "icon" : "default"}
                      className={cn(!can.edit && "flex-1 sm:flex-none")}
                      aria-label={`More for ${o.number}`}
                    >
                      <EllipsisVerticalIcon aria-hidden />
                      {!can.edit && "More"}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-60">
                    {menu.map(({ key, label, icon: Icon }) => (
                      <DropdownMenuItem key={key} onSelect={() => setOpen(key)}>
                        <Icon aria-hidden />
                        {label}
                      </DropdownMenuItem>
                    ))}
                    {can.cancel && (
                      <>
                        {menu.length > 0 && <DropdownMenuSeparator />}
                        <DropdownMenuItem variant="destructive" onSelect={() => setOpen("cancel")}>
                          <BanIcon aria-hidden />
                          Cancel the order
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          )}
        </div>
      )}

      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      {open === "receive" && (
        <ReceivePaymentDialog
          target={{ orderId: o.id, label: o.number }}
          due={o.due}
          currency={currency}
          today={today}
          onDone={done}
          onClose={close}
        />
      )}
      {open === "refund" && (
        <RefundDialog
          target={{ orderId: o.id, label: o.number }}
          kinds={can.refundKinds}
          held={o.paid}
          currency={currency}
          today={today}
          onDone={done}
          onClose={close}
        />
      )}
      {open === "invoice" && (
        <FormDialog
          title={`Issue the invoice for ${o.number}?`}
          description={`The buyer owes ${money(o.total, currency)} from the invoice date. Payments already made count towards it.`}
          submitLabel="Issue the invoice"
          pendingLabel="Issuing"
          errorTitle="We could not issue the invoice"
          onClose={close}
          onSubmit={async (form) => {
            const issueDate = textOf(form, "issueDate");
            const dueDate = textOf(form, "dueDate");
            if (dueDate && dueDate < (issueDate || today)) {
              return problem({ dueDate: "Choose a day on or after the invoice date." });
            }
            const result = await issueInvoiceAction(o.id, {
              ...(issueDate && issueDate !== today ? { issueDate } : {}),
              ...(dueDate ? { dueDate } : {}),
            });
            if (!result.ok) return result.error;
            done(`Invoice ${result.data.number} was issued.`);
          }}
        >
          {(fieldError) => (
            <div className="grid items-start gap-5 sm:grid-cols-2">
              <Field id="invoice-date" label="Invoice date">
                <Input
                  id="invoice-date"
                  name="issueDate"
                  type="date"
                  defaultValue={today}
                  max={today}
                />
              </Field>
              <Field
                id="invoice-due"
                label="Due by (optional)"
                hint="Empty uses the buyer's payment terms."
                error={fieldError("dueDate")}
              >
                <Input
                  id="invoice-due"
                  name="dueDate"
                  type="date"
                  min={today}
                  aria-describedby={
                    fieldError("dueDate") ? "invoice-due-error" : "invoice-due-hint"
                  }
                />
              </Field>
            </div>
          )}
        </FormDialog>
      )}
      {open === "challan" && (
        <ChallanDialog screen={screen} lines={lines} today={today} onDone={done} onClose={close} />
      )}
      {open === "packing" && (
        <FormDialog
          title={`Make the packing list for ${o.number}?`}
          description={`It lists all ${o.pieces} pieces for the warehouse to pack.`}
          submitLabel="Make the packing list"
          pendingLabel="Making it"
          errorTitle="We could not make the packing list"
          onClose={close}
          onSubmit={async (form) => {
            const cartonsText = textOf(form, "cartons");
            const weightText = textOf(form, "grossWeightKg");
            const cartons = cartonsText ? wholeNumber(cartonsText) : null;
            const weight = weightText ? Number(weightText) : null;
            if (cartonsText && cartons === null)
              return problem({ cartons: "Enter a whole number." });
            if (weightText && (weight === null || !Number.isFinite(weight) || weight < 0)) {
              return problem({ grossWeightKg: "Enter a weight like 12.5." });
            }
            const result = await createPackingListAction(o.id, {
              cartons,
              grossWeightKg: weight,
              notes: textOf(form, "notes") || undefined,
            });
            if (!result.ok) return result.error;
            done(`Packing list ${result.data.number} was made.`);
          }}
        >
          {(fieldError) => (
            <>
              <div className="grid items-start gap-5 sm:grid-cols-2">
                <Field
                  id="packing-cartons"
                  label="Cartons (optional)"
                  error={fieldError("cartons")}
                >
                  <Input
                    id="packing-cartons"
                    name="cartons"
                    inputMode="numeric"
                    autoComplete="off"
                  />
                </Field>
                <Field
                  id="packing-weight"
                  label="Gross weight, kg (optional)"
                  error={fieldError("grossWeightKg")}
                >
                  <Input
                    id="packing-weight"
                    name="grossWeightKg"
                    inputMode="decimal"
                    autoComplete="off"
                  />
                </Field>
              </div>
              <Field id="packing-notes" label="Notes (optional)">
                <Textarea id="packing-notes" name="notes" rows={2} maxLength={2000} />
              </Field>
            </>
          )}
        </FormDialog>
      )}
      {open === "shipment" && (
        <FormDialog
          title={o.shipmentOn ? "Change the ship-by day" : "Set a ship-by day"}
          description="The day the order is due to leave the warehouse. Leave it empty to clear it."
          submitLabel="Save"
          pendingLabel="Saving"
          errorTitle="We could not change the ship-by day"
          onClose={close}
          onSubmit={async (form) => {
            const day = textOf(form, "shipmentDate");
            if (day && day < o.orderedOn) {
              return problem({ shipmentDate: "Choose a day on or after the order date." });
            }
            const result = await setOrderShipmentDateAction(o.id, { shipmentDate: day || null });
            if (!result.ok) return result.error;
            done(day ? "The ship-by day was saved." : "The ship-by day was cleared.");
          }}
        >
          {(fieldError) => (
            <Field id="shipment-day" label="Ship by" error={fieldError("shipmentDate")}>
              <Input
                id="shipment-day"
                name="shipmentDate"
                type="date"
                min={o.orderedOn}
                defaultValue={o.shipmentOn ?? ""}
                className="sm:w-48"
              />
            </Field>
          )}
        </FormDialog>
      )}
      {open === "voidInvoice" && o.invoice && (
        <FormDialog
          title={`Void invoice ${o.invoice.number}?`}
          description="The buyer no longer owes it. The order stays open, so it can be edited and invoiced again. The voided invoice stays on record."
          submitLabel="Void the invoice"
          pendingLabel="Voiding"
          destructive
          errorTitle="We could not void the invoice"
          onClose={close}
          onSubmit={async (form) => {
            const reason = readReason(form, 5);
            if (typeof reason !== "string") return reason;
            const result = await voidInvoiceAction(o.invoice!.id, { reason });
            if (!result.ok) return result.error;
            done(`Invoice ${o.invoice!.number} was voided.`);
          }}
        >
          {(fieldError) => (
            <ReasonField id="void-invoice-reason" min={5} error={fieldError("reason")} />
          )}
        </FormDialog>
      )}
      {open === "cancel" && (
        <FormDialog
          title={`Cancel ${o.number}?`}
          description={
            <>
              The pieces held for it go back to stock
              {o.invoice && o.invoice.status !== "VOID"
                ? ` and invoice ${o.invoice.number} is voided`
                : ""}
              .
              {isZero(o.paid)
                ? ""
                : ` ${money(o.paid, currency)} was paid on it: say what happens to that money.`}
            </>
          }
          submitLabel="Cancel the order"
          pendingLabel="Cancelling"
          destructive
          errorTitle="We could not cancel the order"
          onClose={close}
          onSubmit={async (form) => {
            const reason = readReason(form, 3);
            if (typeof reason !== "string") return reason;
            const result = await cancelOrderAction(o.id, {
              reason,
              ...(isZero(o.paid) ? {} : { settle: readSettle(form) }),
            });
            if (!result.ok) return result.error;
            done(`${o.number} was cancelled.`);
          }}
        >
          {(fieldError) => (
            <>
              {!isZero(o.paid) && (
                <SettleFields idPrefix="cancel" kinds={can.settleKinds} fieldError={fieldError} />
              )}
              <ReasonField id="cancel-reason" min={3} error={fieldError("reason")} />
            </>
          )}
        </FormDialog>
      )}
    </div>
  );
}

type ChallanLine = OrderScreen["order"]["styles"][number]["lines"][number] & { style: string };

/** Hands goods over: everything left, or part of it line by line. */
function ChallanDialog({
  screen,
  lines,
  today,
  onDone,
  onClose,
}: {
  screen: OrderScreen;
  lines: ChallanLine[];
  today: string;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const { order: o } = screen;
  const [part, setPart] = useState(false);
  return (
    <FormDialog
      title={`Deliver goods on ${o.number}`}
      description={`${o.remaining} pieces are left to deliver. A delivery challan is made and the pieces leave stock.`}
      submitLabel="Make the challan"
      pendingLabel="Making it"
      errorTitle="We could not make the delivery challan"
      onClose={onClose}
      onSubmit={async (form) => {
        let items: Array<{ variantId: string; quantity: number }> | undefined;
        if (part) {
          const found: Record<string, string> = {};
          items = [];
          for (const line of lines) {
            const text = textOf(form, `qty-${line.variantId}`);
            if (!text) continue;
            const q = wholeNumber(text);
            if (q === null) found[`qty-${line.variantId}`] = "Whole pieces";
            else if (q > line.remaining)
              found[`qty-${line.variantId}`] = `At most ${line.remaining}`;
            else if (q > 0) items.push({ variantId: line.variantId, quantity: q });
          }
          if (Object.keys(found).length > 0) return problem(found);
          if (items.length === 0) return problem({ items: "Enter the pieces going out." });
        }
        const deliveryDate = textOf(form, "deliveryDate");
        const result = await createDeliveryChallanAction(o.id, {
          ...(deliveryDate && deliveryDate !== today ? { deliveryDate } : {}),
          vehicleNo: textOf(form, "vehicleNo") || undefined,
          driverName: textOf(form, "driverName") || undefined,
          driverPhone: textOf(form, "driverPhone") || undefined,
          receivedBy: textOf(form, "receivedBy") || undefined,
          notes: textOf(form, "notes") || undefined,
          ...(items ? { items } : {}),
        });
        if (!result.ok) return result.error;
        onDone(`Delivery challan ${result.data.number} was made.`);
      }}
    >
      {(fieldError) => (
        <>
          <div role="group" aria-label="What goes out" className="grid grid-cols-2 gap-2">
            {(
              [
                [false, `Everything left (${o.remaining})`],
                [true, "Part of it"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={label}
                type="button"
                aria-pressed={part === value}
                onClick={() => setPart(value)}
                className={cn(
                  "h-9 cursor-pointer rounded-md border px-3 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25",
                  part === value
                    ? "border-primary bg-secondary text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {part && (
            <div className="grid gap-2">
              {fieldError("items") && (
                <p className="text-sm text-destructive">{fieldError("items")}</p>
              )}
              <ul className="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto">
                {lines.map((line) => {
                  const name = `qty-${line.variantId}`;
                  return (
                    <li key={line.variantId} className="flex items-center justify-between gap-3">
                      <label htmlFor={name} className="min-w-0 text-sm">
                        <span className="block truncate">
                          {line.style} · {line.color.name} · {line.size}
                        </span>
                        <span className="text-[0.8125rem] text-muted-foreground">
                          {line.remaining} left
                          {fieldError(name) ? ` · ${fieldError(name)}` : ""}
                        </span>
                      </label>
                      <Input
                        id={name}
                        name={name}
                        inputMode="numeric"
                        placeholder="0"
                        autoComplete="off"
                        aria-invalid={Boolean(fieldError(name))}
                        className="w-20 shrink-0 text-right tabular-nums"
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <div className="grid items-start gap-5 sm:grid-cols-2">
            <Field id="challan-date" label="Delivered on">
              <Input
                id="challan-date"
                name="deliveryDate"
                type="date"
                defaultValue={today}
                max={today}
              />
            </Field>
            <Field id="challan-received" label="Received by (optional)">
              <Input id="challan-received" name="receivedBy" maxLength={120} autoComplete="off" />
            </Field>
            <Field id="challan-vehicle" label="Vehicle number (optional)">
              <Input id="challan-vehicle" name="vehicleNo" maxLength={40} autoComplete="off" />
            </Field>
            <Field id="challan-driver" label="Driver (optional)">
              <Input id="challan-driver" name="driverName" maxLength={80} autoComplete="off" />
            </Field>
            <Field id="challan-driver-phone" label="Driver's phone (optional)">
              <Input
                id="challan-driver-phone"
                name="driverPhone"
                type="tel"
                maxLength={30}
                autoComplete="off"
              />
            </Field>
          </div>
          <Field id="challan-notes" label="Notes (optional)">
            <Textarea id="challan-notes" name="notes" rows={2} maxLength={2000} />
          </Field>
        </>
      )}
    </FormDialog>
  );
}
