"use client";

import { DownloadIcon, LoaderCircleIcon, MessageCircleIcon, Share2Icon } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

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
import { documentImage } from "@/lib/document-image";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import { documentPictureAction } from "@/server/actions/documents.actions";

/** A phone number as WhatsApp links want it: digits with the country code (Bangladesh by default). */
export function whatsAppNumber(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (/^880\d{10}$/.test(digits)) return digits;
  if (/^0\d{10}$/.test(digits)) return `88${digits}`;
  if (/^1\d{9}$/.test(digits)) return `880${digits}`;
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

type Ready = { file: File; url: string; text: string };

/** A failure in this browser (not the server), told in plain words. */
const failure = (message: string): ActionError => ({ code: "CONFLICT", message });

/**
 * Shares page 1 of an invoice (the money side) on WhatsApp as a sharp JPG,
 * without a screenshot: the server sends what the page shows, the browser
 * draws it, and nothing is kept on the server. On a phone the share menu
 * opens with the picture (pick WhatsApp); elsewhere the picture is shown to
 * download, with a link that opens the buyer's chat.
 */
export function ShareInvoiceImageButton({
  invoice,
  phone,
  className,
}: {
  invoice: { id: string; number: string };
  /** The buyer's phone, to open their chat when the picture is downloaded. */
  phone?: string | null;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [ready, setReady] = useState<Ready>();
  const [error, setError] = useState<ActionError>();

  // The picture lives only in this tab, and only while it is shown.
  useEffect(() => {
    if (!ready) return;
    return () => URL.revokeObjectURL(ready.url);
  }, [ready]);

  async function share(item: Ready): Promise<boolean> {
    if (typeof navigator.share !== "function" || !navigator.canShare?.({ files: [item.file] })) {
      return false;
    }
    try {
      await navigator.share({ files: [item.file], title: item.file.name, text: item.text });
      return true;
    } catch (cause) {
      // Closing the share menu is not a failure; anything else falls back to downloading.
      return cause instanceof DOMException && cause.name === "AbortError";
    }
  }

  function make() {
    startTransition(async () => {
      try {
        const result = await documentPictureAction({ type: "COMMERCIAL_INVOICE", id: invoice.id });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        const blob = await documentImage(result.data.model, { logoUrl: result.data.logo });
        const item: Ready = {
          file: new File([blob], result.data.fileName, { type: "image/jpeg" }),
          url: URL.createObjectURL(blob),
          text: `Invoice ${invoice.number} from ${result.data.model.letterhead.name}`,
        };
        // Straight to the share menu where the browser allows it; else the picture is shown.
        if (await share(item)) URL.revokeObjectURL(item.url);
        else setReady(item);
      } catch {
        setError(
          failure("This browser could not draw the picture. Try again, or use the PDF instead."),
        );
      }
    });
  }

  const chat = whatsAppNumber(phone);
  const chatLink = ready
    ? `https://wa.me/${chat ?? ""}?text=${encodeURIComponent(ready.text)}`
    : "";

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={cn("w-full sm:w-auto", className)}
        disabled={pending}
        onClick={make}
      >
        {pending ? (
          <LoaderCircleIcon className="animate-spin" aria-hidden />
        ) : (
          <MessageCircleIcon aria-hidden />
        )}
        {pending ? "Making the picture" : "Share on WhatsApp"}
      </Button>
      {ready && (
        <Dialog open onOpenChange={(open) => !open && setReady(undefined)}>
          <DialogContent className="max-h-[92dvh] grid-rows-[auto_minmax(0,1fr)_auto]">
            <DialogHeader>
              <p className="eyebrow text-primary">Page 1 as a picture</p>
              <DialogTitle>Invoice {invoice.number}</DialogTitle>
              <DialogDescription>
                Download the picture, then attach it in the buyer&apos;s WhatsApp chat.
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 overflow-y-auto rounded-md border bg-muted/40">
              {/* eslint-disable-next-line @next/next/no-img-element -- a picture made in this tab */}
              <img src={ready.url} alt={`Page 1 of invoice ${invoice.number}`} className="w-full" />
            </div>
            <DialogFooter>
              {typeof navigator !== "undefined" &&
                navigator.canShare?.({ files: [ready.file] }) && (
                  <Button type="button" variant="outline" onClick={() => void share(ready)}>
                    <Share2Icon aria-hidden />
                    Share
                  </Button>
                )}
              <Button asChild variant="outline">
                <a href={ready.url} download={ready.file.name}>
                  <DownloadIcon aria-hidden />
                  Download the picture
                </a>
              </Button>
              <Button asChild>
                <a href={chatLink} target="_blank" rel="noopener">
                  <MessageCircleIcon aria-hidden />
                  {chat ? "Open the buyer's chat" : "Open WhatsApp"}
                </a>
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      <ActionErrorDialog
        error={error}
        title="We could not make the picture"
        onClose={() => setError(undefined)}
      />
    </>
  );
}
