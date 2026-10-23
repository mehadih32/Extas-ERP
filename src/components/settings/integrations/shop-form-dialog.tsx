"use client";

import { useRouter } from "next/navigation";

import { Field } from "@/components/forms/field";
import { FormDialog } from "@/components/sales/dialogs";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionError } from "@/lib/result";
import type { ShopView } from "@/modules/ecommerce/screens.service";
import { createShopAction, updateShopAction } from "@/server/actions/ecommerce.actions";

import { PLATFORM_OPTIONS } from "./shop-labels";

type Warehouse = { id: string; name: string; isDefault: boolean };

/** The form's fields as the service takes them: the allow-list one address per line. */
function readForm(form: FormData) {
  const text = (name: string) => String(form.get(name) ?? "").trim();
  return {
    platform: text("platform") || "CUSTOM_WEBSITE",
    name: text("name"),
    warehouseId: text("warehouseId"),
    webhookUrl: text("webhookUrl"),
    ipAllowList: text("ipAllowList")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
    rateLimitPerMinute: text("rateLimitPerMinute") || "120",
  };
}

/** A line's own error ("ipAllowList.1") shown on the allow-list's box. */
function withListErrors(error: ActionError | undefined): ActionError | undefined {
  if (!error?.fieldErrors) return error;
  const lines = Object.entries(error.fieldErrors).filter(([key]) => key.startsWith("ipAllowList."));
  if (lines.length === 0) return error;
  return {
    ...error,
    fieldErrors: { ...error.fieldErrors, ipAllowList: lines.flatMap(([, messages]) => messages) },
  };
}

/**
 * "Add online shop" and "Edit": the platform, the shop's name, the company (the
 * one you are working in, not changeable), the warehouse it sells from, its
 * webhook address, an optional IP allow-list and its requests a minute.
 */
export function ShopFormDialog({
  shop,
  companyName,
  warehouses,
  onClose,
}: {
  /** The shop to change; none to add one. */
  shop?: ShopView;
  companyName: string;
  warehouses: Warehouse[];
  onClose: () => void;
}) {
  const router = useRouter();
  const adding = !shop;
  const defaultWarehouse = shop?.warehouseId ?? warehouses.find((w) => w.isDefault)?.id ?? "";

  return (
    <FormDialog
      title={adding ? "Add online shop" : "Edit the online shop"}
      description={
        adding
          ? "Connect the company's own website (or another shop) to the ERP. It gets its key after this, with “Generate key”."
          : "Changes take effect at once. A new webhook URL hears about changes from now on."
      }
      submitLabel={adding ? "Add the shop" : "Save changes"}
      pendingLabel={adding ? "Adding" : "Saving"}
      errorTitle={adding ? "The shop could not be added" : "The shop could not be saved"}
      className="sm:max-w-xl"
      onClose={onClose}
      onSubmit={async (form) => {
        const input = readForm(form);
        if (adding) {
          const result = await createShopAction(input);
          if (!result.ok) return withListErrors(result.error);
          router.push(`/settings/integrations/ecommerce/${result.data.id}`);
          onClose();
          return undefined;
        }
        const result = await updateShopAction(shop.id, input);
        if (!result.ok) return withListErrors(result.error);
        router.refresh();
        onClose();
        return undefined;
      }}
    >
      {(fieldError) => (
        <>
          <Field id="shop-platform" label="Platform" error={fieldError("platform")}>
            <NativeSelect
              id="shop-platform"
              name="platform"
              defaultValue={shop?.platform ?? "CUSTOM_WEBSITE"}
              containerClassName="sm:w-full"
            >
              {PLATFORM_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="shop-name" label="Shop name" error={fieldError("name")}>
            <Input
              id="shop-name"
              name="name"
              defaultValue={shop?.name ?? ""}
              placeholder="Extas web shop"
              maxLength={80}
              autoComplete="off"
            />
          </Field>
          <Field
            id="shop-company"
            label="Company"
            hint="The company you are working in. A shop belongs to one company; its key never names another."
          >
            <Input id="shop-company" value={companyName} readOnly disabled />
          </Field>
          <Field
            id="shop-warehouse"
            label="Warehouse"
            hint="The shop's orders reserve stock here, and its stock changes are sent from here."
            error={fieldError("warehouseId")}
          >
            <NativeSelect
              id="shop-warehouse"
              name="warehouseId"
              defaultValue={defaultWarehouse}
              containerClassName="sm:w-full"
            >
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            id="shop-webhook"
            label="Shop webhook URL"
            hint="Optional: the shop's https:// address for stock and product changes. Leave it empty until the shop is ready."
            error={fieldError("webhookUrl")}
          >
            <Input
              id="shop-webhook"
              name="webhookUrl"
              type="url"
              inputMode="url"
              defaultValue={shop?.webhookUrl ?? ""}
              placeholder="https://shop.example.com/erp/webhooks"
              maxLength={500}
              autoComplete="off"
            />
          </Field>
          <Field
            id="shop-ips"
            label="IP allow-list"
            hint="Optional: one IP address per line. Only these may call the API; empty lets any address call."
            error={fieldError("ipAllowList")}
          >
            <Textarea
              id="shop-ips"
              name="ipAllowList"
              rows={3}
              defaultValue={shop?.ipAllowList.join("\n") ?? ""}
              placeholder="203.0.113.7"
              className="font-mono"
            />
          </Field>
          <Field
            id="shop-rate"
            label="Requests a minute"
            hint="10 to 1000. Above it the shop is asked to wait a minute; 120 suits most shops."
            error={fieldError("rateLimitPerMinute")}
          >
            <Input
              id="shop-rate"
              name="rateLimitPerMinute"
              type="number"
              inputMode="numeric"
              min={10}
              max={1000}
              defaultValue={shop?.rateLimitPerMinute ?? 120}
            />
          </Field>
        </>
      )}
    </FormDialog>
  );
}
