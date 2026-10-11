"use client";

import { EyeIcon, EyeOffIcon } from "lucide-react";
import { createContext, useContext, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/*
 * Hiding amounts from people looking over the shoulder. Inside a
 * PrivacyProvider every <Amount> shows *** when the page opens. The eye at the
 * top of the page shows them all (and hides them again); a card's own small eye
 * shows or hides only that card's amounts (its "scope"). Nothing is remembered:
 * the next page opens hidden again. Outside a provider amounts always show, so
 * shared pieces such as Stat behave as before on every other page.
 */

type Privacy = {
  /** Inside a page that hides amounts. */
  active: boolean;
  /** The master eye: every amount shown. */
  allShown: boolean;
  shown: (scope: string) => boolean;
  toggleAll: () => void;
  toggle: (scope: string) => void;
};

const ALWAYS_SHOWN: Privacy = {
  active: false,
  allShown: true,
  shown: () => true,
  toggleAll: () => {},
  toggle: () => {},
};

const PrivacyContext = createContext<Privacy>(ALWAYS_SHOWN);

export const usePrivacy = () => useContext(PrivacyContext);

export function PrivacyProvider({ children }: { children: React.ReactNode }) {
  const [all, setAll] = useState(false);
  // Cards switched the other way from the master eye.
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(() => new Set());
  const value = useMemo<Privacy>(
    () => ({
      active: true,
      allShown: all,
      shown: (scope) => all !== flipped.has(scope),
      toggleAll: () => {
        setAll((a) => !a);
        setFlipped(new Set());
      },
      toggle: (scope) =>
        setFlipped((before) => {
          const next = new Set(before);
          if (!next.delete(scope)) next.add(scope);
          return next;
        }),
    }),
    [all, flipped],
  );
  return <PrivacyContext value={value}>{children}</PrivacyContext>;
}

/** The scope of amounts that only the eye at the top of the page shows. */
const PAGE_SCOPE = "page";

/**
 * An amount, or *** while its card (or, with no scope, the page) is hidden. The
 * stars take the plain muted colour, so a red (negative) amount does not give
 * itself away.
 */
export function Amount({
  scope = PAGE_SCOPE,
  children,
}: {
  scope?: string;
  children: React.ReactNode;
}) {
  const privacy = usePrivacy();
  if (privacy.shown(scope)) return <>{children}</>;
  return (
    <span className="text-muted-foreground">
      <span aria-hidden="true">***</span>
      <span className="sr-only">Amount hidden</span>
    </span>
  );
}

/**
 * The eye at the top of the page: shows every amount, or hides them all again.
 * `compact` keeps only the eye on phones (the words stay for screen readers).
 */
export function PrivacyToggle({ className, compact }: { className?: string; compact?: boolean }) {
  const privacy = usePrivacy();
  if (!privacy.active) return null;
  const Icon = privacy.allShown ? EyeOffIcon : EyeIcon;
  const label = privacy.allShown ? "Hide amounts" : "Show amounts";
  return (
    <Button
      type="button"
      variant="outline"
      aria-pressed={privacy.allShown}
      onClick={privacy.toggleAll}
      title={compact ? label : undefined}
      className={cn(compact && "size-10 sm:w-auto", className)}
    >
      <Icon aria-hidden />
      {compact ? <span className="sr-only sm:not-sr-only">{label}</span> : label}
    </Button>
  );
}

/** A page's heading with the eye beside it (under it on phones, full width). */
export function HeaderWithEye({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">{children}</div>
      <PrivacyToggle className="w-full shrink-0 sm:w-auto" />
    </div>
  );
}

/** A card's own small eye: shows or hides only its amounts. */
export function ScopeEye({
  scope,
  label,
  className,
}: {
  scope: string;
  /** What it shows, for screen readers ("Cash & bank"). */
  label: string;
  className?: string;
}) {
  const privacy = usePrivacy();
  if (!privacy.active) return null;
  const shown = privacy.shown(scope);
  const Icon = shown ? EyeOffIcon : EyeIcon;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-pressed={shown}
      aria-label={`${shown ? "Hide" : "Show"} the amounts in ${label}`}
      title={shown ? "Hide these amounts" : "Show these amounts"}
      onClick={() => privacy.toggle(scope)}
      className={cn("size-9 shrink-0 text-muted-foreground sm:size-8", className)}
    >
      <Icon aria-hidden />
    </Button>
  );
}
