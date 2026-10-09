"use client";

import { FileDownIcon, LoaderCircleIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { ActionErrorDialog } from "@/components/feedback/action-error-dialog";
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
import { cn } from "@/lib/utils";
import type { PrintRequest } from "@/modules/documents/schemas";
import { printDocumentAction } from "@/server/actions/documents.actions";

/**
 * Makes a document as a PDF on the company letterhead and offers it to open or
 * save. The documents API decides who may print what (documents/print.service.ts);
 * screens show this button to the same people.
 */
export function PrintDocumentButton({
  request,
  label,
  ready: readyText,
  className,
}: {
  request: PrintRequest;
  label: string;
  /** What the window says once the PDF is made, and the heading of a failure. */
  ready: { eyebrow: string; description: string; errorTitle: string };
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [ready, setReady] = useState<{ id: string; title: string }>();
  const [error, setError] = useState<ActionError>();

  function print() {
    startTransition(async () => {
      const result = await printDocumentAction(request);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setReady({ id: result.data.id, title: result.data.title });
    });
  }

  const download = ready ? `/api/documents/${encodeURIComponent(ready.id)}/download` : "";

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={cn("w-full sm:w-auto", className)}
        disabled={pending}
        onClick={print}
      >
        {pending ? (
          <LoaderCircleIcon className="animate-spin" aria-hidden />
        ) : (
          <FileDownIcon aria-hidden />
        )}
        {pending ? "Making the PDF" : label}
      </Button>
      {ready && (
        <Dialog open onOpenChange={(open) => !open && setReady(undefined)}>
          <DialogContent>
            <DialogHeader>
              <p className="eyebrow text-primary">{readyText.eyebrow}</p>
              <DialogTitle>{ready.title}</DialogTitle>
              <DialogDescription>{readyText.description}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button asChild variant="outline">
                <a href={download} download>
                  Download
                </a>
              </Button>
              <Button asChild>
                <a href={`${download}?inline=1`} target="_blank" rel="noopener">
                  Open the PDF
                </a>
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      <ActionErrorDialog
        error={error}
        title={readyText.errorTitle}
        onClose={() => setError(undefined)}
      />
    </>
  );
}
