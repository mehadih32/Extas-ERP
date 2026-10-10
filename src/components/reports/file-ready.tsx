"use client";

import { DownloadIcon, ExternalLinkIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { reportsHref } from "./labels";

export type ReadyFile = { id: string; title: string; isPdf: boolean };

/**
 * A printed document is ready: a PDF opens in the browser or downloads; a Word
 * or HTML file filled from a template downloads. It is also kept with the
 * printed documents.
 */
export function FileReadyDialog({
  file,
  eyebrow,
  onClose,
}: {
  file: ReadyFile;
  eyebrow: string;
  onClose: () => void;
}) {
  const download = reportsHref.documentFile(file.id);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <p className="eyebrow text-primary">{eyebrow}</p>
          <DialogTitle>{file.title}</DialogTitle>
          <DialogDescription>
            {file.isPdf
              ? "Open it to print, or download it. A copy is kept with the printed documents."
              : "Download it to open in Word or a browser. A copy is kept with the printed documents."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button asChild variant={file.isPdf ? "outline" : "default"}>
            <a href={download} download>
              <DownloadIcon aria-hidden />
              Download
            </a>
          </Button>
          {file.isPdf && (
            <Button asChild>
              <a href={`${download}?inline=1`} target="_blank" rel="noopener">
                <ExternalLinkIcon aria-hidden />
                Open the PDF
              </a>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
