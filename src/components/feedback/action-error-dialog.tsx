"use client";

import { ErrorDialog } from "@/components/feedback/error-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ActionError } from "@/lib/result";

/**
 * Tells the person why an action did not go through: the blueprint's error
 * modal with its code for unexpected failures, the plain reason otherwise
 * ("You do not have access to that company.").
 */
export function ActionErrorDialog({
  error,
  title,
  onClose,
}: {
  error: ActionError | undefined;
  title: string;
  onClose: () => void;
}) {
  if (error?.code === "INTERNAL") {
    return <ErrorDialog code={error.errorId ?? "ERR-UNKNOWN"} title={title} onClose={onClose} />;
  }
  return (
    <Dialog open={Boolean(error)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{error?.message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
