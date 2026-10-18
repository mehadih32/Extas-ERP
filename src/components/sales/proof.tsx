"use client";

import { ImageIcon, ImagePlusIcon, LoaderCircleIcon, XIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { compressImage, fileSize } from "@/lib/compress-image";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import {
  attachChequeProofAction,
  attachPaymentProofAction,
  uploadPaymentProofAction,
} from "@/server/actions/sales.actions";

/*
 * Proof photos of payments and cheques. A photo dropped or chosen here is made
 * small in the browser first (about 100 KB, lib/compress-image.ts), so the
 * server never receives the full photo; it is uploaded when the payment is saved.
 */

export const proofUrl = (fileId: string) => `/api/files/${encodeURIComponent(fileId)}`;

/** A photo made ready to upload, with what it weighed before. */
export type ReadyProof = { file: File; originalBytes: number };

/** Uploads a ready proof; returns its file id, or the error to show. */
export async function uploadProof(proof: ReadyProof): Promise<{ id: string } | ActionError> {
  const form = new FormData();
  form.set("file", proof.file);
  try {
    const result = await uploadPaymentProofAction(form);
    return result.ok ? { id: result.data.id } : result.error;
  } catch {
    return { code: "VALIDATION", message: "The proof photo could not be sent. Try again." };
  }
}

/**
 * Drag a photo here, or tap to choose one (on a phone: the camera or gallery).
 * Shows the small copy that will be uploaded and how much smaller it got.
 */
export function ProofDrop({
  value,
  onChange,
  error,
  label = "Proof photo (optional)",
}: {
  value: ReadyProof | null;
  onChange: (proof: ReadyProof | null) => void;
  error?: string;
  label?: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [over, setOver] = useState(false);
  // A local address for the small copy, let go when the photo changes.
  const preview = useMemo(() => (value ? URL.createObjectURL(value.file) : undefined), [value]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  async function take(file: File | undefined) {
    if (!file) return;
    setProblem(undefined);
    if (!file.type.startsWith("image/")) {
      setProblem("Choose a photo (JPG, PNG or WebP) or a screenshot.");
      return;
    }
    setBusy(true);
    try {
      onChange({ file: await compressImage(file), originalBytes: file.size });
    } catch {
      setProblem("This photo could not be read. Try a JPG or PNG, or take a screenshot of it.");
    } finally {
      setBusy(false);
    }
  }

  const shown = problem ?? error;
  return (
    <div className="grid gap-2">
      <span id={`${id}-label`} className="text-sm font-medium">
        {label}
      </span>
      {value ? (
        <div className="flex items-center gap-3 rounded-lg border bg-card p-2.5">
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element -- a local preview (blob: URL)
            <img
              src={preview}
              alt="The proof photo"
              className="size-14 shrink-0 rounded-md border object-cover"
            />
          )}
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium wrap-anywhere">{value.file.name}</p>
            <p className="text-[0.8125rem] text-muted-foreground">
              Made smaller: {fileSize(value.originalBytes)} → {fileSize(value.file.size)}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onChange(null)}
            aria-label="Remove the photo"
          >
            <XIcon aria-hidden />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          aria-labelledby={`${id}-label`}
          aria-describedby={shown ? `${id}-error` : `${id}-hint`}
          onClick={() => input.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setOver(false);
            void take(event.dataTransfer.files[0]);
          }}
          disabled={busy}
          className={cn(
            "flex min-h-20 w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-4 py-3 text-center text-sm transition-colors",
            "hover:border-primary/40 hover:bg-secondary/40 focus-visible:ring-[3px] focus-visible:ring-ring/25 focus-visible:outline-hidden",
            over && "border-primary bg-secondary/60",
            shown && "border-destructive/50",
          )}
        >
          {busy ? (
            <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" aria-hidden />
          ) : (
            <ImagePlusIcon className="size-5 text-muted-foreground" aria-hidden />
          )}
          <span className="font-medium">
            {busy ? "Making the photo smaller" : "Drop a photo here, or tap to choose"}
          </span>
          <span id={`${id}-hint`} className="text-[0.8125rem] text-muted-foreground">
            A transfer screenshot or a photo of the cheque. It is made about 100 KB first.
          </span>
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          void take(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {shown && (
        <p id={`${id}-error`} className="text-[0.8125rem] text-destructive">
          {shown}
        </p>
      )}
    </div>
  );
}

/**
 * A proof photo (or another stored picture, such as a quotation item's reference
 * picture) as a small picture; tapping it opens it full size (lightbox).
 */
export function ProofView({
  fileId,
  label,
  description = "The proof photo, full size.",
  className,
}: {
  fileId: string;
  label: string;
  description?: string;
  /** The thumbnail's size (size-20 unless given). */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "group relative size-20 shrink-0 overflow-hidden rounded-md border bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/25 focus-visible:outline-hidden",
          className,
        )}
        aria-label={`Open ${label}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- served by /api/files with its own checks */}
        <img
          src={proofUrl(fileId)}
          alt=""
          loading="lazy"
          className="size-full object-cover transition-transform group-hover:scale-105"
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl p-3 sm:p-4">
          <DialogHeader className="pr-8">
            <DialogTitle className="flex items-center gap-2 text-base">
              <ImageIcon className="size-4" aria-hidden />
              {label}
            </DialogTitle>
            <DialogDescription className="sr-only">{description}</DialogDescription>
          </DialogHeader>
          {/* eslint-disable-next-line @next/next/no-img-element -- served by /api/files with its own checks */}
          <img
            src={proofUrl(fileId)}
            alt={label}
            className="max-h-[calc(100dvh-9rem)] w-full rounded-md object-contain"
          />
          <a
            href={proofUrl(fileId)}
            target="_blank"
            rel="noreferrer"
            className="justify-self-start text-sm text-primary underline-offset-4 hover:underline"
          >
            Open in a new tab
          </a>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * "Add proof" / "Replace proof" on a money receipt or a cheque (Accounts): a
 * photo made small here, uploaded, then attached. The page reloads with it.
 */
export function ProofAttach({
  target,
  hasProof,
}: {
  target: { paymentId: string } | { chequeId: string };
  hasProof: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [proof, setProof] = useState<ReadyProof | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!proof) {
      setError("Add the photo first.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const stored = await uploadProof(proof);
      if (!("id" in stored)) {
        setError(stored.message);
        return;
      }
      const result =
        "paymentId" in target
          ? await attachPaymentProofAction(target.paymentId, { fileId: stored.id })
          : await attachChequeProofAction(target.chequeId, { fileId: stored.id });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setOpen(false);
      setProof(null);
    } catch {
      setError("The photo could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <ImagePlusIcon aria-hidden />
        {hasProof ? "Replace the proof" : "Add a proof photo"}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{hasProof ? "Replace the proof photo" : "Add a proof photo"}</DialogTitle>
            <DialogDescription>
              A transfer screenshot or a photo of the cheque. It is made about 100 KB before it is
              sent.
            </DialogDescription>
          </DialogHeader>
          <ProofDrop value={proof} onChange={setProof} error={error} label="Photo" />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void save()} disabled={busy}>
              {busy && <LoaderCircleIcon className="animate-spin" aria-hidden />}
              {busy ? "Saving" : "Save the photo"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
