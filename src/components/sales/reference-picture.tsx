"use client";

import { ImagePlusIcon, LoaderCircleIcon, XIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { compressImage, fileSize, PICTURE_OPTIONS } from "@/lib/compress-image";
import { cn } from "@/lib/utils";
import { uploadReferenceImageAction } from "@/server/actions/sales.actions";

import { proofUrl } from "./proof";

/*
 * A quotation item's reference picture (a sketch, a sample photo, the buyer's
 * tech pack image). The picture is made a JPG of about 150 KB in the browser
 * (lib/compress-image.ts) and sent at once, so the form only keeps its file id;
 * a picture never saved with a quotation is deleted the next night.
 */

/** A picture on an item: its stored file, and a local copy to show while the page is open. */
export type ItemPicture = {
  id: string;
  preview?: string;
  sizeBytes?: number;
  originalBytes?: number;
};

/**
 * Drop a picture here, or tap to choose one (on a phone: the camera or gallery).
 * Shows the picture with how much smaller it got, and "Remove".
 */
export function PictureField({
  label,
  value,
  onChange,
  onBusy,
}: {
  label: string;
  value: ItemPicture | null;
  onChange: (picture: ItemPicture | null) => void;
  /** Tells the form a picture is on its way (saving waits for it). */
  onBusy?: (busy: boolean) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [over, setOver] = useState(false);
  const preview = value?.preview;
  // The local copy is let go when the picture changes or the form closes.
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
      setProblem("Choose a picture (JPG, PNG or WebP).");
      return;
    }
    setBusy(true);
    onBusy?.(true);
    try {
      let small: File;
      try {
        small = await compressImage(file, PICTURE_OPTIONS.target, PICTURE_OPTIONS);
      } catch {
        setProblem("This picture could not be read. Try a JPG or PNG.");
        return;
      }
      const form = new FormData();
      form.set("file", small);
      const result = await uploadReferenceImageAction(form);
      if (!result.ok) {
        setProblem(result.error.message);
        return;
      }
      onChange({
        id: result.data.id,
        preview: URL.createObjectURL(small),
        sizeBytes: small.size,
        originalBytes: file.size,
      });
    } catch {
      setProblem("The picture could not be sent. Try again.");
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  }

  return (
    <div className="grid gap-2">
      <span id={`${id}-label`} className="text-sm font-medium">
        {label}
      </span>
      {value ? (
        <div className="flex items-center gap-3 rounded-lg border bg-card p-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local copy or /api/files with its own checks */}
          <img
            src={value.preview ?? proofUrl(value.id)}
            alt="The reference picture"
            className="size-16 shrink-0 rounded-md border bg-white object-contain"
          />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium">Reference picture</p>
            <p className="text-[0.8125rem] text-muted-foreground">
              {value.originalBytes && value.sizeBytes
                ? `Made smaller: ${fileSize(value.originalBytes)} → ${fileSize(value.sizeBytes)}`
                : "Printed beside the item on the PDFs."}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onChange(null)}
            aria-label="Remove the picture"
          >
            <XIcon aria-hidden />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          aria-labelledby={`${id}-label`}
          aria-describedby={problem ? `${id}-error` : `${id}-hint`}
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
            problem && "border-destructive/50",
          )}
        >
          {busy ? (
            <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" aria-hidden />
          ) : (
            <ImagePlusIcon className="size-5 text-muted-foreground" aria-hidden />
          )}
          <span className="font-medium">
            {busy ? "Making the picture smaller" : "Drop a picture here, or tap to choose"}
          </span>
          <span id={`${id}-hint`} className="text-[0.8125rem] text-muted-foreground">
            A sketch or a sample photo. It is made about 150 KB and printed on the PDFs.
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
      {problem && (
        <p id={`${id}-error`} className="text-[0.8125rem] text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}
