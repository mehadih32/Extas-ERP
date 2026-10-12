"use client";

import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { FormAlert } from "@/components/forms/field";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import type { BatchScreen } from "@/modules/production/batch-screens.service";
import { deleteBatchAction } from "@/server/actions/production.actions";

import { productionHref } from "./labels";

/**
 * What a Production Manager does with a batch: add a style (a new project in
 * it), edit it, and delete it while it has no styles.
 */
export function BatchActions({ screen, notice }: { screen: BatchScreen; notice?: string }) {
  const router = useRouter();
  const { batch, can } = screen;
  const [deleting, setDeleting] = useState(false);
  if (!can.edit && !can.addStyle && !notice) return null;
  return (
    <div className="grid gap-4">
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      {(can.addStyle || can.edit) && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {can.addStyle && (
            <Button asChild className="w-full sm:w-auto">
              <Link href={productionHref.addStyle(batch.id)}>
                <PlusIcon aria-hidden />
                Add a style
              </Link>
            </Button>
          )}
          {can.edit && (
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link href={productionHref.editBatch(batch.id)}>
                <PencilIcon aria-hidden />
                Edit the batch
              </Link>
            </Button>
          )}
          {can.delete && (
            <Button
              type="button"
              variant="ghost"
              className="w-full text-destructive sm:w-auto"
              onClick={() => setDeleting(true)}
            >
              <Trash2Icon aria-hidden />
              Delete the batch
            </Button>
          )}
        </div>
      )}
      {deleting && (
        <FormDialog
          title={`Delete ${batch.code}?`}
          description="It has no styles yet, so nothing else changes. This cannot be undone."
          submitLabel="Delete the batch"
          pendingLabel="Deleting"
          destructive
          errorTitle="We could not delete the batch"
          onClose={() => setDeleting(false)}
          onSubmit={async () => {
            const result = await deleteBatchAction(batch.id);
            if (!result.ok) return result.error;
            router.push("/production/batches?deleted=1");
          }}
        >
          {() => null}
        </FormDialog>
      )}
    </div>
  );
}
