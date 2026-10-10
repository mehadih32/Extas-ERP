"use client";

import { Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { Button } from "@/components/ui/button";
import { deleteReportExportAction } from "@/server/actions/reports.actions";

import { reportsHref } from "./labels";

/** Deleting a saved report and its file (its maker, or a Super Admin). */
export function DeleteReport({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="w-full text-destructive hover:text-destructive sm:w-auto"
        onClick={() => setOpen(true)}
      >
        <Trash2Icon aria-hidden />
        Delete
      </Button>
      {open && (
        <ConfirmDialog
          title="Delete this report?"
          description={`"${title}" and its file are deleted. The figures stay in the books; you can make the report again at any time.`}
          confirmLabel="Delete the report"
          pendingLabel="Deleting"
          destructive
          errorTitle="We could not delete the report"
          onClose={() => setOpen(false)}
          onConfirm={async () => {
            const result = await deleteReportExportAction(id);
            if (!result.ok) return result.error;
            router.push(reportsHref.reports);
            return undefined;
          }}
        />
      )}
    </>
  );
}
