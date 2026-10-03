"use client";

import { RotateCwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { errorMessageFor } from "@/lib/error-code";
import type { ActionError } from "@/lib/result";

/** One section of a screen failed: the rest of the screen carries on. */
export function SectionError({
  title,
  error,
  heading = "This part of the dashboard could not load",
}: {
  title: string;
  error: ActionError;
  heading?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const message =
    error.code === "INTERNAL" && error.errorId ? errorMessageFor(error.errorId) : error.message;

  return (
    <section className="rounded-lg border border-destructive/25 bg-card p-6" role="alert">
      <p className="eyebrow text-destructive">{title}</p>
      <p className="mt-2 font-serif text-lg">{heading}</p>
      <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-4"
        disabled={pending}
        onClick={() => startTransition(() => router.refresh())}
      >
        <RotateCwIcon className={pending ? "animate-spin" : undefined} aria-hidden />
        Try again
      </Button>
    </section>
  );
}
