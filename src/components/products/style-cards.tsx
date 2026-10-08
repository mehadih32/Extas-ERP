"use client";

import { ChevronRightIcon, LoaderCircleIcon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { ActionErrorDialog } from "@/components/feedback/action-error-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCount } from "@/lib/display";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import type { StyleCard } from "@/modules/inventory/screens.service";
import { listStyleCardsAction } from "@/server/actions/inventory.actions";

import { categoryPath, money } from "./labels";
import { type StyleListView, styleListQuery } from "./style-list-view";

function StyleCardItem({
  style,
  path,
  currency,
}: {
  style: StyleCard;
  path: string[];
  currency: string;
}) {
  const count = (n: number) => formatCount(n, currency);
  const where = [categoryPath(path), style.brand?.name].filter(Boolean).join(" · ");
  return (
    <li>
      <Link
        href={`/products/${style.id}`}
        className="group flex h-full flex-col rounded-lg border bg-card p-5 transition-colors outline-none hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/25"
      >
        <div className="flex items-start justify-between gap-3">
          <p className="eyebrow truncate">{style.code}</p>
          {!style.isActive && (
            <Badge variant="outline" className="-my-1 text-muted-foreground">
              Archived
            </Badge>
          )}
        </div>
        <p className="mt-2 flex items-center gap-1 font-serif text-xl leading-snug text-primary">
          <span className="min-w-0 truncate">{style.name}</span>
          <ChevronRightIcon
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          />
        </p>
        <p className="mt-1 truncate text-sm text-muted-foreground">{where}</p>

        {style.variantCount === 0 ? (
          <p className="mt-5 text-sm text-muted-foreground">No colours or sizes yet.</p>
        ) : (
          <dl className="mt-5 grid grid-cols-3 gap-3 border-t pt-4">
            <div>
              <dt className="eyebrow">Available</dt>
              <dd
                className={cn(
                  "mt-1 font-serif text-lg lining-nums tabular-nums",
                  style.stock.available <= 0 && "text-destructive",
                )}
              >
                {count(style.stock.available)}
              </dd>
            </div>
            <div>
              <dt className="eyebrow">B-grade</dt>
              <dd className="mt-1 font-serif text-lg lining-nums tabular-nums">
                {count(style.stock.bGrade)}
              </dd>
            </div>
            <div>
              <dt className="eyebrow">SKUs</dt>
              <dd className="mt-1 font-serif text-lg lining-nums tabular-nums">
                {count(style.variantCount)}
              </dd>
            </div>
          </dl>
        )}
        <p className="mt-auto pt-4 text-[0.8125rem] text-muted-foreground tabular-nums">
          <span className="whitespace-nowrap">
            Wholesale {money(style.wholesalePrice, currency)}
          </span>{" "}
          · <span className="whitespace-nowrap">Retail {money(style.retailPrice, currency)}</span>
        </p>
      </Link>
    </li>
  );
}

/**
 * The styles found, as cards that open each style's matrix, with "Show more"
 * for the next page. The page gives it a new key when the filters change.
 */
export function StyleCards({
  initial,
  view,
  categoryPaths,
  currency,
}: {
  initial: { items: StyleCard[]; nextCursor?: string };
  view: StyleListView;
  /** Each category's path ("Tops › Polos"), by id. */
  categoryPaths: Record<string, string[]>;
  currency: string;
}) {
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [error, setError] = useState<ActionError>();
  const [pending, startTransition] = useTransition();

  function more() {
    startTransition(async () => {
      const result = await listStyleCardsAction(styleListQuery(view, cursor));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setItems((shown) => [...shown, ...result.data.items]);
      setCursor(result.data.nextCursor);
    });
  }

  return (
    <div className="grid gap-5">
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Styles">
        {items.map((style) => (
          <StyleCardItem
            key={style.id}
            style={style}
            path={categoryPaths[style.category.id] ?? [style.category.name]}
            currency={currency}
          />
        ))}
      </ul>
      {cursor && (
        <Button
          type="button"
          variant="outline"
          className="w-full justify-self-center sm:w-auto"
          disabled={pending}
          onClick={more}
        >
          {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
          {pending ? "Loading" : "Show more styles"}
        </Button>
      )}
      <ActionErrorDialog
        error={error}
        title="We could not load more styles"
        onClose={() => setError(undefined)}
      />
    </div>
  );
}
