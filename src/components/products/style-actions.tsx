"use client";

import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  EllipsisVerticalIcon,
  Grid3x3Icon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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
import type { StyleScreen } from "@/modules/inventory/screens.service";
import { deleteStyleAction, updateStyleAction } from "@/server/actions/inventory.actions";

import { AddSkusDialog } from "./add-skus-dialog";
import { StockSheetButton } from "./stock-sheet-button";

type Open = "skus" | "archive" | "restore" | "delete" | null;

/**
 * What can be done with a style: everyone who sees it can print its stock sheet;
 * inventory.manage edits it, adds colours and sizes, and archives or restores it;
 * deleting is offered only while it has no history (inventory/rules.ts).
 */
export function StyleActions({
  screen,
  notice: initialNotice,
}: {
  screen: StyleScreen;
  /** A message to show first (the style was just added or saved). */
  notice?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useState(initialNotice);
  const { style, can } = screen;
  const close = () => setOpen(null);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 10_000);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {can.manage && (
          <Button type="button" className="w-full sm:w-auto" onClick={() => setOpen("skus")}>
            <Grid3x3Icon aria-hidden />
            Add colours or sizes
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
                {style.isActive ? (
                  <DropdownMenuItem onSelect={() => setOpen("archive")}>
                    <ArchiveIcon aria-hidden />
                    Archive
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => setOpen("restore")}>
                    <ArchiveRestoreIcon aria-hidden />
                    Restore
                  </DropdownMenuItem>
                )}
                {can.delete && (
                  <>
                    <DropdownMenuSeparator />
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

      {open === "skus" && (
        <AddSkusDialog
          screen={screen}
          onClose={close}
          onAdded={(created) => {
            setNotice(
              created === 0
                ? "Those SKUs were already there."
                : `${created} ${created === 1 ? "SKU was" : "SKUs were"} added to the matrix.`,
            );
            close();
          }}
        />
      )}
      {open === "archive" && (
        <ConfirmDialog
          title={`Archive ${style.name}?`}
          description="It drops out of the style list and cannot be sold or received from production, but keeps its SKUs, stock and history. You can restore it at any time."
          confirmLabel="Archive"
          pendingLabel="Archiving"
          errorTitle="We could not archive the style"
          onClose={close}
          onConfirm={async () => {
            const result = await updateStyleAction(style.id, { isActive: false });
            if (!result.ok) return result.error;
            setNotice(`${style.name} was archived.`);
            close();
          }}
        />
      )}
      {open === "restore" && (
        <ConfirmDialog
          title={`Restore ${style.name}?`}
          description="It comes back to the style list and can be sold again."
          confirmLabel="Restore"
          pendingLabel="Restoring"
          errorTitle="We could not restore the style"
          onClose={close}
          onConfirm={async () => {
            const result = await updateStyleAction(style.id, { isActive: true });
            if (!result.ok) return result.error;
            setNotice(`${style.name} was restored.`);
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
