"use client";

import { LoaderCircleIcon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { ErrorDialog } from "@/components/feedback/error-dialog";
import { FormAlert } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import type { ActionError } from "@/lib/result";

/**
 * A full-page form's state: problems found before asking the server, the
 * server's own error (on its field, above the buttons, or in the error window
 * for an unexpected failure) and whether it is saving.
 */
export function usePageForm() {
  const [error, setError] = useState<ActionError>();
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  return {
    error,
    setError,
    problems,
    setProblems,
    pending,
    startTransition,
    fieldError: (name: string) => problems[name] ?? error?.fieldErrors?.[name]?.[0],
    general:
      error && error.code !== "INTERNAL" && !(error.code === "VALIDATION" && error.fieldErrors)
        ? error.message
        : undefined,
  };
}

/** The message above the buttons, Cancel and Save, and the error window. */
export function FormFooter({
  form,
  cancelHref,
  submitLabel,
  pendingLabel = "Saving",
  errorTitle,
}: {
  form: ReturnType<typeof usePageForm>;
  cancelHref: string;
  submitLabel: string;
  pendingLabel?: string;
  errorTitle: string;
}) {
  return (
    <>
      {form.general && <FormAlert>{form.general}</FormAlert>}
      {!form.general && Object.keys(form.problems).length > 0 && (
        <FormAlert>Please check the highlighted fields.</FormAlert>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Button asChild variant="outline" className="w-full sm:w-auto">
          <Link href={cancelHref}>Cancel</Link>
        </Button>
        <Button type="submit" className="w-full sm:w-auto" disabled={form.pending}>
          {form.pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
          {form.pending ? pendingLabel : submitLabel}
        </Button>
      </div>
      {form.error?.code === "INTERNAL" && (
        <ErrorDialog
          code={form.error.errorId ?? "ERR-UNKNOWN"}
          title={errorTitle}
          onClose={() => form.setError(undefined)}
        />
      )}
    </>
  );
}
