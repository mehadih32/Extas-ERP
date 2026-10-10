"use client";

import { ArchiveIcon, ChevronDownIcon, LightbulbIcon, LoaderCircleIcon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { ActionErrorDialog } from "@/components/feedback/action-error-dialog";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/display";
import type { ActionError } from "@/lib/result";
import type { StyleList } from "@/modules/inventory/screens.service";
import { archiveStylesAction } from "@/server/actions/inventory.actions";

/**
 * Suggests archiving the styles with no stock for six months (inventory.manage):
 * one tap archives one, or all of them (the action reloads the list without them).
 */
export function StaleStylesHint({ styles }: { styles: StyleList["stale"] }) {
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<ActionError>();
  const [, startTransition] = useTransition();
  const many = styles.length !== 1;

  function archive(ids: string[], key: string) {
    setBusy(key);
    startTransition(async () => {
      const result = await archiveStylesAction({ styleIds: ids });
      if (!result.ok) setError(result.error);
      setBusy(undefined);
    });
  }

  return (
    <details className="group rounded-lg border border-primary/20 bg-secondary/60 shadow-sm">
      <summary className="flex cursor-pointer list-none items-start gap-3 p-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 [&::-webkit-details-marker]:hidden">
        <LightbulbIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 text-sm leading-relaxed">
          <span className="font-medium text-primary">
            {styles.length} {many ? "styles have" : "style has"} had no stock for 6 months.
          </span>{" "}
          <span className="text-muted-foreground">
            Archive {many ? "them" : "it"} to keep this list short. Reports keep{" "}
            {many ? "their" : "its"} history.
          </span>
        </span>
        <ChevronDownIcon
          aria-hidden
          className="mt-0.5 size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="grid gap-3 border-t border-primary/15 px-4 pt-3 pb-4">
        <ul className="grid max-h-72 gap-2 overflow-y-auto" aria-label="Styles with no stock">
          {styles.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 text-sm">
              <Link href={`/products/${s.id}`} className="min-w-0 hover:underline">
                <span className="block break-words text-foreground">{s.name}</span>
                <span className="block text-[0.8125rem] text-muted-foreground">
                  {s.code} · no stock since {formatDay(s.since)}
                </span>
              </Link>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={busy !== undefined}
                aria-label={`Archive ${s.name}`}
                onClick={() => archive([s.id], s.id)}
              >
                {busy === s.id ? (
                  <LoaderCircleIcon className="animate-spin" aria-hidden />
                ) : (
                  <ArchiveIcon aria-hidden />
                )}
                Archive
              </Button>
            </li>
          ))}
        </ul>
        {many && (
          <Button
            type="button"
            className="w-full sm:w-auto sm:justify-self-start"
            disabled={busy !== undefined}
            onClick={() =>
              archive(
                styles.map((s) => s.id),
                "all",
              )
            }
          >
            {busy === "all" && <LoaderCircleIcon className="animate-spin" aria-hidden />}
            Archive all {styles.length}
          </Button>
        )}
      </div>
      <ActionErrorDialog
        error={error}
        title="We could not archive the styles"
        onClose={() => setError(undefined)}
      />
    </details>
  );
}
