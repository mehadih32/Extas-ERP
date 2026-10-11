"use client";

import { CircleAlertIcon, CircleCheckIcon, XIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

/*
 * Short notes that slide in at the bottom of the screen and go by themselves:
 * `toast.error("…")` from any screen. One store for the whole app, no library.
 */

type Tone = "error" | "success";
type Toast = { id: number; tone: Tone; message: string };

const SHOW_FOR_MS = 6_000;
let toasts: Toast[] = [];
let lastId = 0;
const listeners = new Set<() => void>();

function emit(next: Toast[]) {
  toasts = next;
  for (const listener of listeners) listener();
}

function dismiss(id: number) {
  emit(toasts.filter((t) => t.id !== id));
}

function show(tone: Tone, message: string) {
  const id = ++lastId;
  // The same note twice in a row shows once.
  emit([...toasts.filter((t) => t.message !== message), { id, tone, message }].slice(-3));
  setTimeout(() => dismiss(id), SHOW_FOR_MS);
}

export const toast = {
  error: (message: string) => show("error", message),
  success: (message: string) => show("success", message),
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const NONE: Toast[] = [];

/** Where the notes appear; mounted once in the root layout. */
export function Toaster() {
  const list = useSyncExternalStore(
    subscribe,
    () => toasts,
    () => NONE,
  );
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6"
    >
      {list.map((t) => {
        const Icon = t.tone === "error" ? CircleAlertIcon : CircleCheckIcon;
        return (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex w-full max-w-sm animate-in items-start gap-3 rounded-lg border bg-card px-4 py-3 text-sm shadow-[0_16px_40px_-16px_rgb(11_61_46/0.45)] duration-200 fade-in-0 slide-in-from-bottom-2",
              t.tone === "error" ? "border-destructive/40" : "border-success/40",
            )}
          >
            <Icon
              className={cn(
                "mt-0.5 size-4 shrink-0",
                t.tone === "error" ? "text-destructive" : "text-success",
              )}
              aria-hidden
            />
            <p className="min-w-0 flex-1 break-words">{t.message}</p>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="-mr-1 cursor-pointer rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
            >
              <XIcon className="size-4" aria-hidden />
              <span className="sr-only">Dismiss</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
