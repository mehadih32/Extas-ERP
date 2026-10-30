"use client";

import { PlusIcon, StoreIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { StatusBadge } from "@/components/sales/badges";
import { Button } from "@/components/ui/button";
import type { StoreList } from "@/modules/retail/stores.service";

import { StoreFormDialog } from "./store-form-dialog";

/*
 * Business > Retail stores (plan v6 sec 4): each store as a card that opens its
 * page, and "Add store". One column on a phone, up to three on a large screen.
 */

export function StoresScreen({ list }: { list: StoreList }) {
  const [adding, setAdding] = useState(false);

  return (
    <section aria-labelledby="stores-heading" className="grid min-w-0 gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 id="stores-heading" className="font-serif text-2xl text-primary">
            Retail stores
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Each store buys from the ERP like a wholesale buyer, at its own prices: a rule on the
            cost, with hand prices on top. A product with no price is never shown to the store.
          </p>
        </div>
        {list.canManage && (
          <Button type="button" className="w-full sm:w-auto" onClick={() => setAdding(true)}>
            <PlusIcon aria-hidden />
            Add store
          </Button>
        )}
      </div>

      {list.stores.length === 0 ? (
        <div className="rounded-md border border-dashed px-6 py-10 text-center">
          <StoreIcon className="mx-auto size-8 text-muted-foreground" aria-hidden />
          <p className="mt-3 font-serif text-lg text-primary">No store yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Add the first store, {list.firstStoreName}. It joins the buyer list as a buyer too.
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3" aria-label="Retail stores">
          {list.stores.map((store) => (
            <li key={store.id} className="min-w-0">
              <Link
                href={`/business/stores/${store.id}`}
                className="grid h-full gap-3 rounded-lg border bg-card p-5 transition-colors outline-none hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/25"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={store.closedAt ? "closed" : "done"}>
                    {store.closedAt ? "Closed" : "Open"}
                  </StatusBadge>
                  <span className="text-xs text-muted-foreground">
                    {store.kind === "ONLINE" ? "Online" : "Showroom"} · Buyer {store.buyer.code}
                  </span>
                </div>
                <p className="font-serif text-xl break-words text-primary">{store.name}</p>
                <dl className="grid gap-1 text-sm">
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="text-muted-foreground">A-grade price:</dt>
                    <dd className="min-w-0 break-words">{store.aRule}</dd>
                  </div>
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="text-muted-foreground">B-grade price:</dt>
                    <dd className="min-w-0 break-words">{store.bRule}</dd>
                  </div>
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="text-muted-foreground">Hand prices:</dt>
                    <dd>{store.handPrices}</dd>
                  </div>
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="text-muted-foreground">Warehouse:</dt>
                    <dd className="min-w-0 break-words">{store.warehouse?.name ?? "None yet"}</dd>
                  </div>
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="text-muted-foreground">Online shop:</dt>
                    <dd className="min-w-0 break-words">{store.onlineShop?.name ?? "None"}</dd>
                  </div>
                </dl>
                {store.costChanged > 0 && (
                  <p className="flex items-start gap-1.5 text-sm text-destructive">
                    <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                    {store.costChanged} hand price(s) to look at: the cost changed
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <StoreFormDialog
          suggestedName={list.stores.length === 0 ? list.firstStoreName : undefined}
          warehouses={list.warehouses}
          onlineShops={list.onlineShops}
          onClose={() => setAdding(false)}
        />
      )}
    </section>
  );
}
