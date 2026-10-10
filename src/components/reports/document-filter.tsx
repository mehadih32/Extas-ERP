"use client";

import { useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";

import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

import { reportsHref } from "./labels";

/**
 * Which kind of printed document to list. A change reloads the list from the
 * server; the old list stays, dimmed, until the new one arrives.
 */
export function DocumentTypeFilter({
  type,
  types,
  children,
}: {
  type: string | null;
  types: ReadonlyArray<{ key: string; label: string }>;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(type ?? "");

  function show(next: string) {
    startTransition(() => {
      setShown(next);
      router.replace(reportsHref.documents(next || undefined), { scroll: false });
    });
  }

  return (
    <div className="grid min-w-0 grid-cols-1 content-start gap-5">
      {types.length > 1 && (
        <div className="grid grid-cols-1 sm:w-72">
          <label className="sr-only" htmlFor="document-type">
            Kind of document
          </label>
          <NativeSelect
            id="document-type"
            value={shown}
            onChange={(e) => show(e.target.value)}
            containerClassName="sm:w-full"
          >
            <option value="">Every kind of document</option>
            {types.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
      <div
        aria-busy={pending}
        className={cn(
          "grid grid-cols-1 gap-5 transition-opacity",
          pending && "pointer-events-none opacity-50",
        )}
      >
        {children}
      </div>
    </div>
  );
}
