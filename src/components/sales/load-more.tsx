"use client";

import { LoaderCircleIcon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { ActionErrorDialog } from "@/components/feedback/action-error-dialog";
import { Button } from "@/components/ui/button";
import type { ActionError, ActionResult } from "@/lib/result";
import { cn } from "@/lib/utils";

type Page<T> = { items: T[]; nextCursor?: string };

/**
 * A list's rows with "Show more": the first page comes with the screen, each
 * further page from `load(cursor)`. The page gives the list a new key when its
 * filters change, so this starts again.
 */
export function useLoadMore<T>(
  initial: Page<T>,
  load: (cursor: string) => Promise<ActionResult<Page<T>>>,
) {
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [error, setError] = useState<ActionError>();
  const [pending, startTransition] = useTransition();

  function more() {
    if (!cursor) return;
    startTransition(async () => {
      const result = await load(cursor);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setItems((shown) => [...shown, ...result.data.items]);
      setCursor(result.data.nextCursor);
    });
  }

  return {
    items,
    /** Changes the rows shown (one updated from a panel opened over the list). */
    update: setItems,
    hasMore: Boolean(cursor),
    more,
    pending,
    error,
    clearError: () => setError(undefined),
  };
}

/** "Show more orders", with the error window when the next page does not come. */
export function ShowMore({
  list,
  noun,
}: {
  list: Omit<ReturnType<typeof useLoadMore<unknown>>, "items" | "update">;
  /** What the rows are, plural and in lower case ("orders"). */
  noun: string;
}) {
  return (
    <>
      {list.hasMore && (
        <Button
          type="button"
          variant="outline"
          className="w-full justify-self-center sm:w-auto"
          disabled={list.pending}
          onClick={list.more}
        >
          {list.pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
          {list.pending ? "Loading" : `Show more ${noun}`}
        </Button>
      )}
      <ActionErrorDialog
        error={list.error}
        title={`We could not load more ${noun}`}
        onClose={list.clearError}
      />
    </>
  );
}

/**
 * A click handler that runs `open` for a plain click and leaves a click with a
 * modifier key or another button (a new tab or window) to the link.
 */
function openInstead(open: () => void) {
  return (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    open();
  };
}

/** A phone card that opens a record: the top line, the main line, details and a footer. */
export function RowCard({
  href,
  eyebrow,
  badges,
  title,
  details,
  footer,
  onOpen,
}: {
  href: string;
  eyebrow: React.ReactNode;
  badges?: React.ReactNode;
  title: React.ReactNode;
  details?: React.ReactNode;
  footer?: React.ReactNode;
  /** Opens the record over the list instead (a plain click; a new tab still opens `href`). */
  onOpen?: () => void;
}) {
  return (
    <li className="min-w-0">
      <Link
        href={href}
        onClick={onOpen ? openInstead(onOpen) : undefined}
        className="group block rounded-lg border bg-card p-4 transition-colors outline-none hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/25"
      >
        {/* Many badges (a booking's status, revision, lateness and fabric at risk) go under the eyebrow on a phone. */}
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <p className="eyebrow min-w-0 break-words">{eyebrow}</p>
          {badges && (
            <div className="-my-1 flex min-w-0 flex-wrap justify-end gap-1.5">{badges}</div>
          )}
        </div>
        <p className="mt-2 font-serif text-lg leading-snug break-words text-primary">{title}</p>
        {details && <p className="mt-1 text-sm break-words text-muted-foreground">{details}</p>}
        {footer && (
          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t pt-3 text-sm tabular-nums">
            {footer}
          </div>
        )}
      </Link>
    </li>
  );
}

/** The record's number as a link in a table's first cell. */
export function RowLink({
  href,
  children,
  className,
  onOpen,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  /** Opens the record over the list instead (a plain click; a new tab still opens `href`). */
  onOpen?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onOpen ? openInstead(onOpen) : undefined}
      className={cn(
        "rounded-sm font-medium whitespace-nowrap text-primary outline-none hover:underline hover:underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/25",
        className,
      )}
    >
      {children}
    </Link>
  );
}
