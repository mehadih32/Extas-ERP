"use client";

import { FileDownIcon } from "lucide-react";
import { useState } from "react";

import { ChoiceList } from "@/components/parties/choice-list";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Orientation } from "@/modules/documents/model";

const ORIENTATION_CHOICES: ReadonlyArray<{ value: Orientation; label: string; hint: string }> = [
  {
    value: "landscape",
    label: "Landscape",
    hint: "The page lies on its side: wide tables, binding along the top edge.",
  },
  {
    value: "portrait",
    label: "Portrait",
    hint: "The page stands upright: binding along the top edge.",
  },
];

/** The download link of a PDF printed the chosen way round. */
export function orientedHref(href: string, orientation: Orientation): string {
  return `${href}${href.includes("?") ? "&" : "?"}orientation=${orientation}`;
}

/**
 * A button that downloads a book-frame PDF (a booking, a booking book) after
 * asking which way round to print it: Landscape or Portrait, with this person's
 * last pick chosen (the server keeps it with the download; the company's default
 * is Landscape until they pick).
 */
export function OrientationDownload({
  href,
  label,
  title,
  description,
  orientation: initial,
  variant = "default",
  size = "default",
  className = "w-full sm:w-auto",
}: {
  href: string;
  label: string;
  title: string;
  description: string;
  /** This person's last pick, or the company's default. */
  orientation: Orientation;
  variant?: "default" | "outline";
  size?: "default" | "sm";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [orientation, setOrientation] = useState<Orientation>(initial);

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        onClick={() => setOpen(true)}
      >
        <FileDownIcon aria-hidden />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <ChoiceList
            name="orientation"
            legend="Which way round?"
            options={ORIENTATION_CHOICES}
            defaultValue={orientation}
            onChange={setOrientation}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button asChild>
              <a href={orientedHref(href, orientation)} download onClick={() => setOpen(false)}>
                <FileDownIcon aria-hidden />
                Download the PDF
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
