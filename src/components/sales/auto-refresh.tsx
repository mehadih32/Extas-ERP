"use client";

import { RefreshCwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const EVERY_MS = 60_000;

/**
 * Keeps a screen's figures live: it reloads them every minute while the tab is
 * on screen (and as soon as it comes back), with a button to do it now. Only
 * the figures are fetched again; nothing else on the page reloads.
 */
export function AutoRefresh({ updatedAt }: { updatedAt: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") startTransition(() => router.refresh());
    };
    const timer = setInterval(refresh, EVERY_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);

  return (
    <div className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
      <span aria-live="polite">{pending ? "Updating" : `Updated ${updatedAt}`}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => startTransition(() => router.refresh())}
        disabled={pending}
        aria-label="Update the figures now"
        title="Update now"
      >
        <RefreshCwIcon className={cn(pending && "animate-spin")} aria-hidden />
      </Button>
    </div>
  );
}
