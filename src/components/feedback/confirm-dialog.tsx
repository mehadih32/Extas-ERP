"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { ErrorDialog } from "@/components/feedback/error-dialog";
import { FormAlert } from "@/components/forms/field";
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
 * Asks before an action that is hard to take back (deactivating someone,
 * resetting a password). `onConfirm` runs the Server Action and returns its
 * error, if any, which is shown here; on success the caller moves on.
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  pendingLabel,
  destructive = false,
  errorTitle = "That did not go through",
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  destructive?: boolean;
  /** The heading of the error window for an unexpected failure. */
  errorTitle?: string;
  onConfirm: () => Promise<ActionError | undefined>;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError>();

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        {error && error.code !== "INTERNAL" && <FormAlert>{error.message}</FormAlert>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setError(await onConfirm());
              })
            }
          >
            {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
        {error?.code === "INTERNAL" && (
          <ErrorDialog
            code={error.errorId ?? "ERR-UNKNOWN"}
            title={errorTitle}
            onClose={() => setError(undefined)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
