"use client";

import { useRouter } from "next/navigation";

import { Field } from "@/components/forms/field";
import { FormDialog } from "@/components/sales/dialogs";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { createStoreAction, updateStoreAction } from "@/server/actions/retail.actions";

type Warehouse = { id: string; name: string; isDefault: boolean };
type OnlineShop = { id: string; name: string; storeId: string | null };

export type StoreFields = {
  id: string;
  name: string;
  kind: "ONLINE" | "SHOWROOM";
  address: string | null;
  phone: string | null;
  warehouseId: string | null;
  integrationId: string | null;
};

/**
 * "Add store" and "Edit store": the store's name, kind, warehouse, its online
 * shop (Settings > Integrations), address and phone. Adding one also adds it to
 * the buyer list as a buyer.
 */
export function StoreFormDialog({
  store,
  suggestedName,
  warehouses,
  onlineShops,
  onClose,
}: {
  store?: StoreFields;
  suggestedName?: string;
  warehouses: Warehouse[];
  onlineShops: OnlineShop[];
  onClose: () => void;
}) {
  const router = useRouter();
  const adding = !store;
  const shops = onlineShops.filter((s) => !s.storeId || s.storeId === store?.id);

  return (
    <FormDialog
      title={adding ? "Add store" : "Edit store"}
      description={
        adding
          ? "The store also joins the buyer list as a buyer, so its account, statement and Buyer 360 are in one place."
          : "The store's buyer in the buyer list takes the same name, address and phone."
      }
      submitLabel={adding ? "Add the store" : "Save changes"}
      pendingLabel={adding ? "Adding" : "Saving"}
      errorTitle={adding ? "The store could not be added" : "The store could not be saved"}
      onClose={onClose}
      onSubmit={async (form) => {
        const text = (name: string) => String(form.get(name) ?? "").trim();
        const input = {
          name: text("name"),
          kind: text("kind") || "ONLINE",
          address: text("address"),
          phone: text("phone"),
          warehouseId: text("warehouseId"),
          integrationId: text("integrationId"),
        };
        const result = adding
          ? await createStoreAction(input)
          : await updateStoreAction(store.id, input);
        if (!result.ok) return result.error;
        if (adding && result.data) router.push(`/business/stores/${result.data.id}`);
        else router.refresh();
        onClose();
        return undefined;
      }}
    >
      {(fieldError) => (
        <>
          <Field id="store-name" label="Store name" error={fieldError("name")}>
            <Input
              id="store-name"
              name="name"
              defaultValue={store?.name ?? suggestedName ?? ""}
              maxLength={80}
              autoComplete="off"
            />
          </Field>
          <Field id="store-kind" label="Kind" error={fieldError("kind")}>
            <NativeSelect
              id="store-kind"
              name="kind"
              defaultValue={store?.kind ?? "ONLINE"}
              containerClassName="sm:w-full"
            >
              <option value="ONLINE">Online</option>
              <option value="SHOWROOM">Showroom</option>
            </NativeSelect>
          </Field>
          <Field
            id="store-warehouse"
            label="Warehouse"
            hint="Its goods go out from here."
            error={fieldError("warehouseId")}
          >
            <NativeSelect
              id="store-warehouse"
              name="warehouseId"
              defaultValue={store?.warehouseId ?? warehouses.find((w) => w.isDefault)?.id ?? ""}
              containerClassName="sm:w-full"
            >
              <option value="">None yet</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            id="store-shop"
            label="Online shop"
            hint="Its connection and key, from Settings > Integrations. A showroom needs none."
            error={fieldError("integrationId")}
          >
            <NativeSelect
              id="store-shop"
              name="integrationId"
              defaultValue={store?.integrationId ?? ""}
              containerClassName="sm:w-full"
            >
              <option value="">None</option>
              {shops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="store-address" label="Address" error={fieldError("address")}>
            <Input
              id="store-address"
              name="address"
              defaultValue={store?.address ?? ""}
              maxLength={300}
            />
          </Field>
          <Field id="store-phone" label="Phone" error={fieldError("phone")}>
            <Input
              id="store-phone"
              name="phone"
              type="tel"
              defaultValue={store?.phone ?? ""}
              maxLength={40}
            />
          </Field>
        </>
      )}
    </FormDialog>
  );
}
