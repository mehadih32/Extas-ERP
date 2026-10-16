"use client";

import { ArchiveRestoreIcon, ChevronRightIcon, LoaderCircleIcon, ShirtIcon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { ActionErrorDialog } from "@/components/feedback/action-error-dialog";
import { StatusBadge, type Tone } from "@/components/sales/badges";
import { Button } from "@/components/ui/button";
import { formatCount } from "@/lib/display";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import type { StyleCard } from "@/modules/inventory/screens.service";
import { listStyleCardsAction, updateStyleAction } from "@/server/actions/inventory.actions";

import { categoryPath, money } from "./labels";
import { type StyleListView, styleListQuery } from "./style-list-view";

/** The style's one status: archived, no SKUs yet, out of stock, or active. */
function stylePill(style: StyleCard): { tone: Tone; label: string } {
  if (!style.isActive) return { tone: "closed", label: "Archived" };
  if (style.variantCount === 0) return { tone: "plain", label: "No SKUs yet" };
  if (style.stock.available <= 0) return { tone: "warn", label: "Out of stock" };
  return { tone: "open", label: "Active" };
}

function StyleCardItem({
  style,
  path,
  currency,
  canManage,
  onUnarchived,
}: {
  style: StyleCard;
  path: string[];
  currency: string;
  canManage: boolean;
  onUnarchived: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError>();
  const count = (n: number) => formatCount(n, currency);
  const where = [categoryPath(path), style.brand?.name].filter(Boolean).join(" · ");
  const pill = stylePill(style);

  function unarchive() {
    startTransition(async () => {
      const result = await updateStyleAction(style.id, { isActive: true });
      if (result.ok) onUnarchived();
      else setError(result.error);
    });
  }

  return (
    <li className="group relative flex h-full flex-col rounded-xl border bg-card p-5 shadow-sm transition-shadow focus-within:shadow-md hover:shadow-md">
      <div className="flex items-start gap-3">
        <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
          {style.imageUrl ? (
            // A stored product photo, not a static asset, so next/image's optimiser cannot fetch it.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={style.imageUrl} alt="" className="size-full object-cover" />
          ) : (
            <ShirtIcon aria-hidden className="size-6" />
          )}
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="eyebrow min-w-0 break-words">{style.code}</p>
          <p className="mt-1 truncate text-sm text-muted-foreground">{where}</p>
        </div>
        <StatusBadge tone={pill.tone} className="rounded-full px-2">
          {pill.label}
        </StatusBadge>
      </div>
      <Link
        href={`/products/${style.id}`}
        className="mt-3 flex items-start justify-between gap-2 font-serif text-xl leading-snug text-primary outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-[3px] focus-visible:after:ring-ring/25"
      >
        <span className="line-clamp-2 min-w-0 break-words">{style.name}</span>
        <ChevronRightIcon
          aria-hidden
          className="mt-1.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        />
      </Link>

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
      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-4">
        <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
          <span className="whitespace-nowrap">
            Wholesale {money(style.wholesalePrice, currency)}
          </span>{" "}
          · <span className="whitespace-nowrap">Retail {money(style.retailPrice, currency)}</span>
        </p>
        {!style.isActive && canManage && (
          <Button
            type="button"
            size="sm"
            className="relative z-10 w-full sm:w-auto"
            disabled={pending}
            aria-label={`Unarchive ${style.name}`}
            onClick={unarchive}
          >
            {pending ? (
              <LoaderCircleIcon className="animate-spin" aria-hidden />
            ) : (
              <ArchiveRestoreIcon aria-hidden />
            )}
            Unarchive
          </Button>
        )}
      </div>
      <ActionErrorDialog
        error={error}
        title="We could not unarchive the style"
        onClose={() => setError(undefined)}
      />
    </li>
  );
}

/**
 * The styles found, as cards that open each style's matrix, with "Show more"
 * for the next page. On the Archived styles tab, inventory.manage can unarchive
 * a style from its card; it then leaves the list. The page gives it a new key
 * when the filters change.
 */
export function StyleCards({
  initial,
  view,
  categoryPaths,
  currency,
  canManage,
}: {
  initial: { items: StyleCard[]; nextCursor?: string };
  view: StyleListView;
  /** Each category's path ("Tops › Polos"), by id. */
  categoryPaths: Record<string, string[]>;
  currency: string;
  canManage: boolean;
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
    <div className="@container grid gap-5">
      <ul className="grid grid-cols-1 gap-4 @xl:grid-cols-2 @4xl:grid-cols-3" aria-label="Styles">
        {items.map((style) => (
          <StyleCardItem
            key={style.id}
            style={style}
            path={categoryPaths[style.category.id] ?? [style.category.name]}
            currency={currency}
            canManage={canManage}
            onUnarchived={() => setItems((shown) => shown.filter((s) => s.id !== style.id))}
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
