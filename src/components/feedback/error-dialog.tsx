"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { errorMessageFor } from "@/lib/error-code";

type ErrorDialogProps = {
  /** "ERR-7F3K9Q2M": what the person reads out to support. */
  code: string;
  title?: string;
  open?: boolean;
  /** Re-runs what failed (the error boundary's retry). */
  onRetry?: () => void;
  /** Lets the person close the dialog; without it the dialog stays until they act. */
  onClose?: () => void;
  /** Offers the way back to the dashboard, when a whole screen failed. */
  showHomeLink?: boolean;
};

/**
 * The blueprint's error modal: never a blank screen or a stack trace, just
 * "An error occurred. Error Code: [Random ID]. Please share this with your
 * technical support." and a way to carry on.
 */
export function ErrorDialog({
  code,
  title = "Something went wrong",
  open = true,
  onRetry,
  onClose,
  showHomeLink = false,
}: ErrorDialogProps) {
  const [copied, setCopied] = useState(false);
  const dismissable = Boolean(onClose);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (http or an old browser): the code stays on screen to read out.
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose?.()}>
      <DialogContent
        showCloseButton={dismissable}
        onEscapeKeyDown={(event) => !dismissable && event.preventDefault()}
        onInteractOutside={(event) => !dismissable && event.preventDefault()}
      >
        <DialogHeader>
          <p className="eyebrow text-destructive">Error</p>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{errorMessageFor(code)}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/60 py-1.5 pr-1.5 pl-3">
          <span className="font-mono text-sm tracking-wider select-all" data-testid="error-code">
            {code}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={copy}>
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? "Copied" : "Copy code"}
          </Button>
        </div>
        <DialogFooter>
          {showHomeLink && (
            <Button variant="outline" asChild>
              <Link href="/">Go to the dashboard</Link>
            </Button>
          )}
          {dismissable && !onRetry && (
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
          )}
          {onRetry && (
            <Button type="button" onClick={onRetry}>
              Try again
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
