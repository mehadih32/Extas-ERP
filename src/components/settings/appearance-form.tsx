"use client";

import { CheckIcon, LoaderCircleIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { ActionErrorDialog } from "@/components/feedback/action-error-dialog";
import { Button } from "@/components/ui/button";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import type { InterfaceStyle } from "@/modules/appearance/appearance.service";
import { updateAppearanceAction } from "@/server/actions/appearance.actions";

const CHOICES: Array<{ value: InterfaceStyle; title: string; text: string }> = [
  {
    value: "LEGACY",
    title: "Legacy",
    text: "The original look: the menu across the top, serif headings and square edges.",
  },
  {
    value: "MODERN",
    title: "Modern",
    text: "A side menu you can narrow to icons, clean Inter type, figures lined up in columns, soft shadows and calmer tables.",
  },
];

/** A small sketch of each look, drawn with boxes. */
function Preview({ style }: { style: InterfaceStyle }) {
  if (style === "LEGACY") {
    return (
      <div aria-hidden className="h-28 overflow-hidden rounded-sm border bg-[#f8f8f8]">
        <div className="flex h-5 items-center gap-1.5 bg-[#0b3d2e] px-2">
          <span className="h-1.5 w-6 rounded-[1px] bg-white/80" />
          <span className="ml-2 h-1 w-4 bg-white/40" />
          <span className="h-1 w-4 bg-white/40" />
          <span className="h-1 w-4 bg-white/40" />
        </div>
        <div className="grid gap-1.5 p-2">
          <span className="h-2 w-16 bg-[#0b3d2e]/70" />
          <div className="grid grid-cols-3 gap-1.5">
            <span className="h-8 border border-[#e4e1da] bg-white" />
            <span className="h-8 border border-[#e4e1da] bg-white" />
            <span className="h-8 border border-[#e4e1da] bg-white" />
          </div>
          <span className="h-6 border border-[#e4e1da] bg-white" />
        </div>
      </div>
    );
  }
  return (
    <div aria-hidden className="flex h-28 overflow-hidden rounded-md border bg-[#f3f5f4]">
      <div className="grid w-9 content-start gap-1.5 bg-[#0b3d2e] p-1.5">
        <span className="h-2 w-4 rounded-sm bg-white/80" />
        <span className="mt-1 h-1.5 rounded-sm bg-white/30" />
        <span className="h-1.5 rounded-sm bg-white/50" />
        <span className="h-1.5 rounded-sm bg-white/30" />
        <span className="h-1.5 rounded-sm bg-white/30" />
      </div>
      <div className="grid flex-1 content-start gap-1.5 p-2">
        <span className="h-2 w-14 rounded-sm bg-[#0b3d2e]/70" />
        <div className="grid grid-cols-3 gap-1.5">
          <span className="h-8 rounded-md bg-white shadow-[0_1px_3px_rgb(16_40_30/0.12)]" />
          <span className="h-8 rounded-md bg-white shadow-[0_1px_3px_rgb(16_40_30/0.12)]" />
          <span className="h-8 rounded-md bg-white shadow-[0_1px_3px_rgb(16_40_30/0.12)]" />
        </div>
        <span className="h-6 rounded-md bg-white shadow-[0_1px_3px_rgb(16_40_30/0.12)]" />
      </div>
    </div>
  );
}

/**
 * The person's choice of look. Saving reloads the app so the new frame and
 * styles apply everywhere at once.
 */
export function AppearanceForm({ current }: { current: InterfaceStyle }) {
  const [choice, setChoice] = useState<InterfaceStyle>(current);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError>();

  function save() {
    startTransition(async () => {
      const result = await updateAppearanceAction({ interfaceStyle: choice });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // A full reload, not a client navigation: the frame, fonts and styles all change.
      const next = new URL(window.location.href);
      next.search = "?saved=1";
      window.location.assign(next);
    });
  }

  return (
    <>
      <fieldset className="grid gap-4">
        <legend className="sr-only">Look of the app</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {CHOICES.map((option) => {
            const selected = choice === option.value;
            return (
              <label
                key={option.value}
                className={cn(
                  "grid cursor-pointer gap-3 rounded-lg border bg-card p-4 transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/25",
                  selected ? "border-primary ring-1 ring-primary" : "hover:border-input",
                )}
              >
                <Preview style={option.value} />
                <span className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="interfaceStyle"
                    value={option.value}
                    checked={selected}
                    onChange={() => setChoice(option.value)}
                    className="mt-1 size-4 shrink-0 accent-primary"
                  />
                  <span className="grid gap-1">
                    <span className="flex items-center gap-2 font-medium">
                      {option.title}
                      {current === option.value && (
                        <span className="text-xs font-normal text-muted-foreground">(in use)</span>
                      )}
                    </span>
                    <span className="text-sm leading-relaxed text-muted-foreground">
                      {option.text}
                    </span>
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button
          type="button"
          onClick={save}
          disabled={pending || choice === current}
          className="h-11 sm:h-9"
        >
          {pending ? (
            <LoaderCircleIcon className="animate-spin" aria-hidden />
          ) : (
            <CheckIcon aria-hidden />
          )}
          {pending ? "Saving" : "Use this look"}
        </Button>
        <p className="text-sm text-muted-foreground">
          Only your own screens change; everyone else keeps their look.
        </p>
      </div>
      <ActionErrorDialog
        error={error}
        title="The look did not change"
        onClose={() => setError(undefined)}
      />
    </>
  );
}
