import { ImageIcon } from "lucide-react";

import type { HelpImage } from "@/modules/help/types";

/**
 * A step's screenshot, or until it is added a placeholder that says what it
 * will show and its code (the file goes in public/help/<code>.png).
 */
export function HelpImageSlot({ image }: { image: HelpImage }) {
  if (image.src) {
    return (
      <figure className="grid gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- screenshots of any size, served as they are */}
        <img
          src={image.src}
          alt={image.caption}
          loading="lazy"
          className="h-auto max-w-full rounded-md border bg-card"
        />
        <figcaption lang="bn" className="text-xs text-muted-foreground">
          {image.caption}
        </figcaption>
      </figure>
    );
  }
  return (
    <figure
      aria-label={`Screenshot to come: ${image.id}`}
      className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-input bg-muted/50 p-4 text-center"
    >
      <ImageIcon className="size-6 text-muted-foreground" aria-hidden />
      <figcaption className="grid gap-1">
        <span lang="bn" className="text-sm text-foreground/80">
          {image.caption}
        </span>
        <span className="text-xs text-muted-foreground">
          <span lang="bn">স্ক্রিনশট শীঘ্রই যোগ হবে</span> ·{" "}
          <code className="font-mono">{image.id}</code>
        </span>
      </figcaption>
    </figure>
  );
}
