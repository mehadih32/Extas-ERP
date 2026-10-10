"use client";

import { CheckIcon, LoaderCircleIcon, PencilIcon, XIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionError } from "@/lib/result";

/**
 * A name that is renamed where it stands: tap it, type, then Enter (or the tick)
 * saves and Escape (or the cross) puts it back. A failed save keeps the box open
 * with the reason under it.
 */
export function InlineName({
  name,
  label,
  maxLength,
  onSave,
  children,
}: {
  name: string;
  /** What it is, for screen readers: "category", "brand". */
  label: string;
  maxLength: number;
  onSave: (name: string) => Promise<{ ok: true } | { ok: false; error: ActionError }>;
  /** What shows before the name when not editing (a tree mark). */
  children?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [problem, setProblem] = useState<string>();
  const [pending, startTransition] = useTransition();

  function cancel() {
    setValue(name);
    setProblem(undefined);
    setEditing(false);
  }

  function save() {
    const next = value.trim();
    if (next === name) return cancel();
    if (!next) return setProblem("Type a name.");
    startTransition(async () => {
      const result = await onSave(next);
      if (result.ok) {
        setProblem(undefined);
        setEditing(false);
      } else {
        setProblem(result.error.fieldErrors?.name?.[0] ?? result.error.message);
      }
    });
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`Rename ${label} ${name}`}
        className="group/name -mx-1 flex max-w-full items-center gap-1.5 rounded-sm px-1 text-left font-medium outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/25"
      >
        {children}
        <span className="min-w-0 break-words">{name}</span>
        <PencilIcon
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground opacity-60 group-hover/name:opacity-100"
        />
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="grid gap-1"
    >
      <div className="flex items-center gap-1">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          maxLength={maxLength}
          autoComplete="off"
          aria-label={`New name for ${name}`}
          aria-invalid={Boolean(problem)}
          disabled={pending}
          autoFocus
          className="h-10 min-w-0 flex-1 md:h-8"
        />
        <Button
          type="submit"
          size="icon-sm"
          aria-label="Save the name"
          disabled={pending}
          className="size-10 shrink-0 md:size-8"
        >
          {pending ? (
            <LoaderCircleIcon className="animate-spin" aria-hidden />
          ) : (
            <CheckIcon aria-hidden />
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Keep the old name"
          disabled={pending}
          onClick={cancel}
          className="size-10 shrink-0 md:size-8"
        >
          <XIcon aria-hidden />
        </Button>
      </div>
      {problem && (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}
    </form>
  );
}
