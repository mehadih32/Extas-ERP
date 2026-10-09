"use client";

import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowLeftRightIcon,
  ClipboardCheckIcon,
  PackageOpenIcon,
  PencilIcon,
  PlusIcon,
  SendIcon,
  Trash2Icon,
  TruckIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { dayOrNow } from "@/components/production/cost-dialogs";
import { Field, FormAlert } from "@/components/forms/field";
import { textOf } from "@/components/products/form-values";
import { FormDialog, problem, readReason, ReasonField } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { MaterialScreen } from "@/modules/materials/screens.service";
import {
  addOpeningStockAction,
  countMaterialAction,
  recordWastageAction,
  transferMaterialAction,
  updateMaterialAction,
} from "@/server/actions/materials.actions";

import { materialsHref, quantity, readPrice, readQuantity, UNIT_LABELS, UNIT_ONE } from "./labels";

type Open = "opening" | "count" | "wastage" | "transfer" | "archive" | "reactivate" | null;

/** A store to choose in a window, with what it holds of this material. */
function StoreSelect({
  id,
  name,
  stores,
  held,
  defaultValue,
  onChange,
  unitText,
}: {
  id: string;
  name: string;
  stores: ReadonlyArray<{ id: string; name: string }>;
  held: ReadonlyMap<string, string>;
  defaultValue?: string;
  onChange?: (storeId: string) => void;
  unitText: (text: string) => string;
}) {
  return (
    <NativeSelect
      id={id}
      name={name}
      defaultValue={defaultValue}
      onChange={(e) => onChange?.(e.target.value)}
      containerClassName="sm:w-full"
    >
      {stores.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name} · {unitText(held.get(s.id) ?? "0")}
        </option>
      ))}
    </NativeSelect>
  );
}

/**
 * What can be done with a raw material, each offered from the flags its screen
 * came with (screen.can, from materials/rules.ts): the store counts it, writes
 * off wastage and moves it between stores; buyers and Accounts enter opening
 * stock; buyers order it; buyers and Accounts receive it; the store issues it
 * to production; the store and buyers change or archive it.
 */
export function MaterialActions({
  screen,
  currency,
  notice: initialNotice,
}: {
  screen: MaterialScreen;
  currency: string;
  notice?: string;
}) {
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useState(initialNotice);
  const { material: m, stores, can, today } = screen;
  const close = () => setOpen(null);
  const done = (message: string) => {
    setNotice(message);
    close();
  };
  const q = (text: string) => quantity(text, m.unit, currency);
  const held = new Map(m.stores.map((s) => [s.id, s.quantity]));
  const holding = stores.filter((s) => /[1-9]/.test(held.get(s.id) ?? "0"));
  const mainStore = stores.find((s) => s.isDefault)?.id ?? stores[0]?.id;
  const [pickedFrom, setTransferFrom] = useState("");
  // The stock may have arrived since this screen opened, so fall back to the
  // first store holding some rather than to the store chosen at first render.
  const transferFrom = holding.some((s) => s.id === pickedFrom)
    ? pickedFrom
    : (holding[0]?.id ?? "");
  const [countStore, setCountStore] = useState(mainStore ?? "");

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 10_000);
    return () => clearTimeout(timer);
  }, [notice]);

  const readQty = (form: FormData, name: string, allowZero = false) => {
    const value = readQuantity(textOf(form, name), m.unit, { allowZero });
    return typeof value === "number" ? value : problem({ [name]: value });
  };

  const main = [
    can.receive && (
      <Button key="receive" asChild className="w-full sm:w-auto">
        <Link href={materialsHref.newPurchase()}>
          <TruckIcon aria-hidden />
          Receive goods
        </Link>
      </Button>
    ),
    can.order && (
      <Button
        key="order"
        asChild
        variant={can.receive ? "outline" : "default"}
        className="w-full sm:w-auto"
      >
        <Link href={materialsHref.newOrder({ material: m.id })}>
          <PlusIcon aria-hidden />
          Order more
        </Link>
      </Button>
    ),
    can.issue && (
      <Button
        key="issue"
        asChild
        variant={can.receive || can.order ? "outline" : "default"}
        className="w-full sm:w-auto"
      >
        <Link href={materialsHref.newIssue("issue")}>
          <SendIcon aria-hidden />
          Issue to production
        </Link>
      </Button>
    ),
  ].filter(Boolean);
  const store = [
    can.count && (
      <Button
        key="count"
        type="button"
        variant="outline"
        className="w-full sm:w-auto"
        onClick={() => setOpen("count")}
      >
        <ClipboardCheckIcon aria-hidden />
        Count it
      </Button>
    ),
    can.transfer && (
      <Button
        key="transfer"
        type="button"
        variant="outline"
        className="w-full sm:w-auto"
        onClick={() => setOpen("transfer")}
      >
        <ArrowLeftRightIcon aria-hidden />
        Move between stores
      </Button>
    ),
    can.wastage && (
      <Button
        key="wastage"
        type="button"
        variant="outline"
        className="w-full sm:w-auto"
        onClick={() => setOpen("wastage")}
      >
        <Trash2Icon aria-hidden />
        Write off wastage
      </Button>
    ),
    can.openingStock && (
      <Button
        key="opening"
        type="button"
        variant="outline"
        className="w-full sm:w-auto"
        onClick={() => setOpen("opening")}
      >
        <PackageOpenIcon aria-hidden />
        Opening stock
      </Button>
    ),
    can.edit && (
      <Button key="edit" asChild variant="outline" className="w-full sm:w-auto">
        <Link href={materialsHref.editMaterial(m.id)}>
          <PencilIcon aria-hidden />
          Change details
        </Link>
      </Button>
    ),
    can.archive && (
      <Button
        key="archive"
        type="button"
        variant="ghost"
        className="w-full sm:w-auto"
        onClick={() => setOpen("archive")}
      >
        <ArchiveIcon aria-hidden />
        Archive
      </Button>
    ),
    can.reactivate && (
      <Button
        key="reactivate"
        type="button"
        variant="outline"
        className="w-full sm:w-auto"
        onClick={() => setOpen("reactivate")}
      >
        <ArchiveRestoreIcon aria-hidden />
        Bring back
      </Button>
    ),
  ].filter(Boolean);

  if (main.length === 0 && store.length === 0 && !notice) return null;

  return (
    <div className="grid gap-4">
      {main.length > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">{main}</div>
      )}
      {store.length > 0 && (
        <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2 sm:flex sm:flex-wrap sm:items-center">
          {store}
        </div>
      )}
      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      {open === "opening" && (
        <FormDialog
          title={`Opening stock of ${m.code}`}
          description="What the store already held before Extas ERP, at what it cost. Its value goes to the books against opening balances."
          submitLabel="Add the stock"
          pendingLabel="Adding"
          errorTitle="We could not add the opening stock"
          onClose={close}
          onSubmit={async (form) => {
            const amount = readQty(form, "quantity");
            if (typeof amount !== "number") return amount;
            const cost = readPrice(textOf(form, "unitCost"));
            if (typeof cost !== "number") return problem({ unitCost: cost });
            const result = await addOpeningStockAction(m.id, {
              warehouseId: textOf(form, "warehouseId") || undefined,
              quantity: amount,
              unitCost: cost,
              date: dayOrNow(form, "date", today),
              note: textOf(form, "note") || undefined,
            });
            if (!result.ok) return result.error;
            done(`${q(String(amount))} of ${m.code} was added as opening stock.`);
          }}
        >
          {(fieldError) => (
            <div className="grid items-start gap-5 sm:grid-cols-2">
              {stores.length > 1 && (
                <Field id="opening-store" label="Into the store" className="sm:col-span-2">
                  <StoreSelect
                    id="opening-store"
                    name="warehouseId"
                    stores={stores}
                    held={held}
                    defaultValue={mainStore}
                    unitText={q}
                  />
                </Field>
              )}
              <Field
                id="opening-quantity"
                label={`Quantity (${UNIT_LABELS[m.unit]})`}
                error={fieldError("quantity")}
              >
                <Input
                  id="opening-quantity"
                  name="quantity"
                  inputMode="decimal"
                  autoComplete="off"
                  aria-invalid={Boolean(fieldError("quantity"))}
                  aria-describedby={fieldError("quantity") ? "opening-quantity-error" : undefined}
                  autoFocus
                />
              </Field>
              <Field
                id="opening-cost"
                label={`Cost per ${UNIT_ONE[m.unit]} (${currency})`}
                error={fieldError("unitCost")}
              >
                <Input
                  id="opening-cost"
                  name="unitCost"
                  inputMode="decimal"
                  autoComplete="off"
                  aria-invalid={Boolean(fieldError("unitCost"))}
                  aria-describedby={fieldError("unitCost") ? "opening-cost-error" : undefined}
                />
              </Field>
              <Field id="opening-date" label="As of" error={fieldError("date")}>
                <Input id="opening-date" name="date" type="date" defaultValue={today} max={today} />
              </Field>
              <Field id="opening-note" label="Note (optional)">
                <Input id="opening-note" name="note" maxLength={500} autoComplete="off" />
              </Field>
            </div>
          )}
        </FormDialog>
      )}

      {open === "count" && (
        <FormDialog
          title={`Count ${m.code}`}
          description="Enter what is physically in the store. Any difference from the books is corrected and kept on the stock card."
          submitLabel="Save the count"
          pendingLabel="Saving"
          errorTitle="We could not save the count"
          onClose={close}
          onSubmit={async (form) => {
            const counted = readQty(form, "countedQuantity", true);
            if (typeof counted !== "number") return counted;
            const result = await countMaterialAction(m.id, {
              warehouseId: textOf(form, "warehouseId") || undefined,
              countedQuantity: counted,
              date: dayOrNow(form, "date", today),
              note: textOf(form, "note") || undefined,
            });
            if (!result.ok) return result.error;
            done(`The count of ${m.code} was saved.`);
          }}
        >
          {(fieldError) => (
            <div className="grid items-start gap-5 sm:grid-cols-2">
              {stores.length > 1 && (
                <Field id="count-store" label="Store" className="sm:col-span-2">
                  <StoreSelect
                    id="count-store"
                    name="warehouseId"
                    stores={stores}
                    held={held}
                    defaultValue={countStore}
                    onChange={setCountStore}
                    unitText={q}
                  />
                </Field>
              )}
              <Field
                id="count-quantity"
                label={`Counted (${UNIT_LABELS[m.unit]})`}
                hint={`The books say ${q(held.get(countStore) ?? "0")}.`}
                error={fieldError("countedQuantity")}
              >
                <Input
                  id="count-quantity"
                  name="countedQuantity"
                  inputMode="decimal"
                  autoComplete="off"
                  aria-invalid={Boolean(fieldError("countedQuantity"))}
                  aria-describedby={
                    fieldError("countedQuantity") ? "count-quantity-error" : "count-quantity-hint"
                  }
                  autoFocus
                />
              </Field>
              <Field id="count-date" label="Counted on" error={fieldError("date")}>
                <Input id="count-date" name="date" type="date" defaultValue={today} max={today} />
              </Field>
              <Field id="count-note" label="Note (optional)" className="sm:col-span-2">
                <Input id="count-note" name="note" maxLength={500} autoComplete="off" />
              </Field>
            </div>
          )}
        </FormDialog>
      )}

      {open === "wastage" && (
        <FormDialog
          title={`Write off ${m.code}`}
          description="Damaged, spoilt or lost material leaves the stock. Its value goes to the books as wastage."
          submitLabel="Write it off"
          pendingLabel="Writing off"
          destructive
          errorTitle="We could not write off the wastage"
          onClose={close}
          onSubmit={async (form) => {
            const amount = readQty(form, "quantity");
            if (typeof amount !== "number") return amount;
            const reason = readReason(form, 5);
            if (typeof reason !== "string") return reason;
            const result = await recordWastageAction(m.id, {
              warehouseId: textOf(form, "warehouseId") || undefined,
              quantity: amount,
              date: dayOrNow(form, "date", today),
              reason,
            });
            if (!result.ok) return result.error;
            done(`${q(String(amount))} of ${m.code} was written off.`);
          }}
        >
          {(fieldError) => (
            <>
              <div className="grid items-start gap-5 sm:grid-cols-2">
                {stores.length > 1 && (
                  <Field id="wastage-store" label="From the store" className="sm:col-span-2">
                    <StoreSelect
                      id="wastage-store"
                      name="warehouseId"
                      stores={holding}
                      held={held}
                      unitText={q}
                    />
                  </Field>
                )}
                <Field
                  id="wastage-quantity"
                  label={`Quantity (${UNIT_LABELS[m.unit]})`}
                  error={fieldError("quantity")}
                >
                  <Input
                    id="wastage-quantity"
                    name="quantity"
                    inputMode="decimal"
                    autoComplete="off"
                    aria-invalid={Boolean(fieldError("quantity"))}
                    aria-describedby={fieldError("quantity") ? "wastage-quantity-error" : undefined}
                    autoFocus
                  />
                </Field>
                <Field id="wastage-date" label="On" error={fieldError("date")}>
                  <Input
                    id="wastage-date"
                    name="date"
                    type="date"
                    defaultValue={today}
                    max={today}
                  />
                </Field>
              </div>
              <ReasonField
                id="wastage-reason"
                label="What happened"
                min={5}
                error={fieldError("reason")}
              />
            </>
          )}
        </FormDialog>
      )}

      {open === "transfer" && (
        <FormDialog
          title={`Move ${m.code} between stores`}
          description="The stock leaves one store and arrives in the other at the same cost."
          submitLabel="Move it"
          pendingLabel="Moving"
          errorTitle="We could not move the stock"
          onClose={close}
          onSubmit={async (form) => {
            const amount = readQty(form, "quantity");
            if (typeof amount !== "number") return amount;
            const to = textOf(form, "toWarehouseId");
            if (!to) return problem({ toWarehouseId: "Choose where it goes." });
            const result = await transferMaterialAction(m.id, {
              fromWarehouseId: textOf(form, "fromWarehouseId"),
              toWarehouseId: to,
              quantity: amount,
              date: dayOrNow(form, "date", today),
              note: textOf(form, "note") || undefined,
            });
            if (!result.ok) return result.error;
            done(`${q(String(amount))} of ${m.code} was moved.`);
          }}
        >
          {(fieldError) => (
            <div className="grid items-start gap-5 sm:grid-cols-2">
              <Field id="transfer-from" label="From" error={fieldError("fromWarehouseId")}>
                <StoreSelect
                  id="transfer-from"
                  name="fromWarehouseId"
                  stores={holding}
                  held={held}
                  defaultValue={transferFrom}
                  onChange={setTransferFrom}
                  unitText={q}
                />
              </Field>
              <Field id="transfer-to" label="To" error={fieldError("toWarehouseId")}>
                <StoreSelect
                  key={transferFrom}
                  id="transfer-to"
                  name="toWarehouseId"
                  stores={stores.filter((s) => s.id !== transferFrom)}
                  held={held}
                  unitText={q}
                />
              </Field>
              <Field
                id="transfer-quantity"
                label={`Quantity (${UNIT_LABELS[m.unit]})`}
                error={fieldError("quantity")}
              >
                <Input
                  id="transfer-quantity"
                  name="quantity"
                  inputMode="decimal"
                  autoComplete="off"
                  aria-invalid={Boolean(fieldError("quantity"))}
                  aria-describedby={fieldError("quantity") ? "transfer-quantity-error" : undefined}
                  autoFocus
                />
              </Field>
              <Field id="transfer-date" label="On" error={fieldError("date")}>
                <Input
                  id="transfer-date"
                  name="date"
                  type="date"
                  defaultValue={today}
                  max={today}
                />
              </Field>
              <Field id="transfer-note" label="Note (optional)" className="sm:col-span-2">
                <Input id="transfer-note" name="note" maxLength={500} autoComplete="off" />
              </Field>
            </div>
          )}
        </FormDialog>
      )}

      {open === "archive" && (
        <FormDialog
          title={`Archive ${m.code}?`}
          description="It leaves the stock list and the searches on orders, bills and issue notes. Its stock card stays, and it can be brought back."
          submitLabel="Archive it"
          pendingLabel="Archiving"
          errorTitle="We could not archive the material"
          onClose={close}
          onSubmit={async () => {
            const result = await updateMaterialAction(m.id, { isActive: false });
            if (!result.ok) return result.error;
            done(`${m.code} was archived.`);
          }}
        >
          {() => null}
        </FormDialog>
      )}

      {open === "reactivate" && (
        <FormDialog
          title={`Bring ${m.code} back?`}
          description="It shows in the stock list again and can be ordered, bought and issued."
          submitLabel="Bring it back"
          pendingLabel="Saving"
          errorTitle="We could not bring the material back"
          onClose={close}
          onSubmit={async () => {
            const result = await updateMaterialAction(m.id, { isActive: true });
            if (!result.ok) return result.error;
            done(`${m.code} is in use again.`);
          }}
        >
          {() => null}
        </FormDialog>
      )}
    </div>
  );
}
