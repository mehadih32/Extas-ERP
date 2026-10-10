"use client";

import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  EllipsisVerticalIcon,
  Grid3x3Icon,
  LoaderCircleIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { ActionErrorDialog } from "@/components/feedback/action-error-dialog";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { FormAlert } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ActionError } from "@/lib/result";
import type { StyleScreen } from "@/modules/inventory/screens.service";
import { deleteStyleAction, updateStyleAction } from "@/server/actions/inventory.actions";

import { ColorsSizesDialog } from "./colors-sizes-dialog";
import { StockSheetButton } from "./stock-sheet-button";

type Open = "skus" | "archive" | "delete" | null;

const skus = (n: number) => `${n} ${n === 1 ? "SKU" : "SKUs"}`;

/** "4 SKUs were added and 2 taken off the matrix." */
function matrixNotice({
  created,
  restored,
  removed,
}: {
  created: number;
  restored: number;
  removed: number;
}) {
  const added = created + restored;
  if (added === 0 && removed === 0) return "Those SKUs were already there.";
  if (removed === 0) return `${skus(added)} ${added === 1 ? "was" : "were"} added to the matrix.`;
  if (added === 0)
    return `${skus(removed)} ${removed === 1 ? "was" : "were"} taken off the matrix.`;
  return `${skus(added)} added and ${skus(removed)} taken off the matrix.`;
}

/**
 * What can be done with a style: everyone who sees it can print its stock sheet;
 * inventory.manage edits it, ticks and unticks its colours and sizes, and
 * archives it (or unarchives it in one tap);
 * deleting is offered only while it has no history (inventory/rules.ts).
 */
export function StyleActions({
  screen,
  currency,
  notice: initialNotice,
}: {
  screen: StyleScreen;
  currency: string;
  /** A message to show first (the style was just added or saved). */
  notice?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useState(initialNotice);
  const [unarchiving, startUnarchive] = useTransition();
  const [error, setError] = useState<ActionError>();
  const { style, can } = screen;
  const close = () => setOpen(null);

  function unarchive() {
    startUnarchive(async () => {
      const result = await updateStyleAction(style.id, { isActive: true });
      if (!result.ok) return setError(result.error);
      setNotice(`${style.name} was unarchived. It is back on the Styles tab.`);
    });
  }

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 10_000);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {can.manage && !style.isActive && (
          <Button
            type="button"
            className="w-full sm:w-auto"
            disabled={unarchiving}
            onClick={unarchive}
          >
            {unarchiving ? (
              <LoaderCircleIcon className="animate-spin" aria-hidden />
            ) : (
              <ArchiveRestoreIcon aria-hidden />
            )}
            Unarchive
          </Button>
        )}
        {can.manage && (
          <Button type="button" className="w-full sm:w-auto" onClick={() => setOpen("skus")}>
            <Grid3x3Icon aria-hidden />
            Colours and sizes
          </Button>
        )}
        <StockSheetButton
          request={{
            type: "STOCK_AVAILABILITY",
            styleIds: [style.id],
            warehouseId: screen.warehouseId ?? undefined,
          }}
        />
        {can.manage && (
          <div className="flex gap-2">
            <Button asChild variant="outline" className="flex-1 sm:flex-none">
              <Link href={`/products/${style.id}/edit`}>
                <PencilIcon aria-hidden />
                Edit details
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={`More for ${style.name}`}
                  className="md:size-10"
                >
                  <EllipsisVerticalIcon aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {style.isActive && (
                  <DropdownMenuItem onSelect={() => setOpen("archive")}>
                    <ArchiveIcon aria-hidden />
                    Archive
                  </DropdownMenuItem>
                )}
                {can.delete && (
                  <>
                    {style.isActive && <DropdownMenuSeparator />}
                    <DropdownMenuItem variant="destructive" onSelect={() => setOpen("delete")}>
                      <Trash2Icon aria-hidden />
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      <ActionErrorDialog
        error={error}
        title="We could not unarchive the style"
        onClose={() => setError(undefined)}
      />

      {open === "skus" && (
        <ColorsSizesDialog
          screen={screen}
          currency={currency}
          onClose={close}
          onSaved={(change) => {
            setNotice(matrixNotice(change));
            close();
          }}
        />
      )}
      {open === "archive" && (
        <ConfirmDialog
          title={`Archive ${style.name}?`}
          description="It moves to the Archived styles tab and cannot be sold or received from production, but keeps its SKUs, stock and history, and stays in every report. You can unarchive it at any time."
          confirmLabel="Archive"
          pendingLabel="Archiving"
          errorTitle="We could not archive the style"
          onClose={close}
          onConfirm={async () => {
            const result = await updateStyleAction(style.id, { isActive: false });
            if (!result.ok) return result.error;
            setNotice(`${style.name} was archived. It is on the Archived styles tab.`);
            close();
          }}
        />
      )}
      {open === "delete" && (
        <ConfirmDialog
          title={`Delete ${style.name}?`}
          description="The style and its SKUs are removed for good. It has no stock movements, orders or quotations yet, so nothing else is affected."
          confirmLabel="Delete"
          pendingLabel="Deleting"
          destructive
          errorTitle="We could not delete the style"
          onClose={close}
          onConfirm={async () => {
            const result = await deleteStyleAction(style.id);
            if (!result.ok) return result.error;
            router.push("/products?deleted=1");
          }}
        />
      )}
    </div>
  );
}
