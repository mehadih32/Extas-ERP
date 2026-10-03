"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

/** Copies `text` to the clipboard and says so for two seconds. */
export function CopyButton({
  text,
  label,
  copiedLabel = "Copied",
  variant = "outline",
  className,
}: {
  text: string;
  label: string;
  copiedLabel?: string;
  variant?: "outline" | "ghost" | "default";
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard blocked (plain http or an old browser): the text stays on screen to copy by hand.
    }
  }

  return (
    <Button type="button" variant={variant} size="sm" onClick={copy} className={className}>
      {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
      <span aria-live="polite">{copied ? copiedLabel : label}</span>
    </Button>
  );
}
