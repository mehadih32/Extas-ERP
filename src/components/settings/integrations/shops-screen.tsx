"use client";

import { KeyRoundIcon, PlusIcon, StoreIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useWhen } from "@/components/ai/when";
import { StatusBadge } from "@/components/sales/badges";
import { Button } from "@/components/ui/button";
import type { ShopList } from "@/modules/ecommerce/screens.service";

import { ShopFormDialog } from "./shop-form-dialog";
import { platformLabel } from "./shop-labels";

/*
 * Settings > Integrations (CN-005). E-commerce: the company's online shops,
 * each a card that opens its page, and "Add online shop". Cards at every width
 * (390 to 1920 px): one column on a phone, up to three on a large screen.
 */

export function ShopsScreen({ list }: { list: ShopList }) {
  const [adding, setAdding] = useState(false);
  const when = useWhen({ year: true });

  return (
    <section aria-labelledby="ecommerce-heading" className="grid min-w-0 gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 id="ecommerce-heading" className="font-serif text-2xl text-primary">
            E-commerce
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Online shops that take orders for {list.companyName}: each has its own key, sells from
            one warehouse, and hears from the ERP when stock or products change.
          </p>
        </div>
        <Button type="button" className="w-full sm:w-auto" onClick={() => setAdding(true)}>
          <PlusIcon aria-hidden />
          Add online shop
        </Button>
      </div>

      {list.shops.length === 0 ? (
        <div className="rounded-md border border-dashed px-6 py-10 text-center">
          <StoreIcon className="mx-auto size-8 text-muted-foreground" aria-hidden />
          <p className="mt-3 font-serif text-lg text-primary">No online shop yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Add the company&apos;s website here, then give it a key. Until it has its key, the shop
            works with a practice copy of the ERP&apos;s answers.
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3" aria-label="Online shops">
          {list.shops.map((shop) => (
            <li key={shop.id} className="min-w-0">
              <Link
                href={`/settings/integrations/ecommerce/${shop.id}`}
                className="grid h-full gap-3 rounded-lg border bg-card p-5 transition-colors outline-none hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/25"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={shop.isActive ? "done" : "closed"}>
                    {shop.isActive ? "On" : "Off"}
                  </StatusBadge>
                  <StatusBadge tone={shop.hasKey ? "open" : "warn"}>
                    <KeyRoundIcon aria-hidden className="size-3" />
                    {shop.hasKey ? "Has a key" : "No key"}
                  </StatusBadge>
                  <span className="text-xs text-muted-foreground">
                    {platformLabel(shop.platform)}
                  </span>
                </div>
                <p className="font-serif text-xl break-words text-primary">{shop.name}</p>
                <dl className="grid gap-1 text-sm">
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="text-muted-foreground">Warehouse:</dt>
                    <dd className="min-w-0 break-words">{shop.warehouse?.name ?? "None"}</dd>
                  </div>
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="text-muted-foreground">Last sync:</dt>
                    <dd>{shop.lastSyncedAt ? when(shop.lastSyncedAt) : "Never"}</dd>
                  </div>
                </dl>
                {shop.failedThisWeek > 0 && (
                  <p className="flex items-start gap-1.5 text-sm text-destructive">
                    <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                    {shop.failedThisWeek} webhook(s) failed this week
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <ShopFormDialog
          companyName={list.companyName}
          warehouses={list.warehouses}
          onClose={() => setAdding(false)}
        />
      )}
    </section>
  );
}
