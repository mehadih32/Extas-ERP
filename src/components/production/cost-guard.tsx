import { ShieldAlertIcon, ShieldCheckIcon } from "lucide-react";

import { money } from "@/components/sales/labels";
import { cn } from "@/lib/utils";
import type { CostGuardData } from "@/modules/production/screens.service";

type Level = CostGuardData["level"];

/** Green while fine, yellow from 85% of the target price, red once over it. */
export const GUARD_TONES: Record<Level, { bar: string; text: string; panel: string }> = {
  OK: { bar: "bg-emerald-600", text: "text-emerald-700", panel: "" },
  NEAR: {
    bar: "bg-amber-500",
    text: "text-amber-700",
    panel: "border-amber-300 bg-amber-50/60",
  },
  OVER: {
    bar: "bg-destructive",
    text: "text-destructive",
    panel: "border-destructive/40 bg-destructive/5",
  },
};

export const GUARD_WORDS: Record<Level, string> = {
  OK: "Within the target price",
  NEAR: "Near the target price",
  OVER: "Over the target price",
};

/** The bar itself: how much of the target is used, capped at the end. */
function GuardBar({ level, percent, label }: { level: Level; percent: number; label: string }) {
  const width = Math.min(Math.max(percent, 0), 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={width}
      aria-valuetext={`${percent}% of the target price, ${GUARD_WORDS[level].toLowerCase()}`}
      className="relative h-2 overflow-hidden rounded-full bg-muted"
    >
      <div
        className={cn("h-full rounded-full transition-[width]", GUARD_TONES[level].bar)}
        style={{ width: `${width}%` }}
      />
      {/* Where yellow starts. */}
      <span aria-hidden className="absolute inset-y-0 left-[85%] w-px bg-foreground/25" />
    </div>
  );
}

/**
 * A style's cost guard on its card: "BDT 412.50 of BDT 500.00 a piece" and the
 * bar, green, yellow from 85% of the target price and red once over.
 */
export function CostGuardLine({ guard, currency }: { guard: CostGuardData; currency: string }) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-[0.8125rem] tabular-nums">
        <span className="text-muted-foreground">
          {money(guard.perPiece, currency)} of {money(guard.target, currency)} a piece
        </span>
        <span className={cn("font-medium whitespace-nowrap", GUARD_TONES[guard.level].text)}>
          {guard.percent}%
        </span>
      </div>
      <GuardBar level={guard.level} percent={guard.percent} label="Cost guard" />
    </div>
  );
}

/**
 * The cost guard panel on a style's page: the live cost per piece (cost so far ÷
 * pieces to make) against its target price, what is left per piece, and the
 * warning once it is near or over.
 */
export function CostGuardPanel({
  guard,
  currency,
  className,
}: {
  guard: CostGuardData;
  currency: string;
  className?: string;
}) {
  const tone = GUARD_TONES[guard.level];
  const Icon = guard.level === "OK" ? ShieldCheckIcon : ShieldAlertIcon;
  return (
    <section
      aria-labelledby="cost-guard-heading"
      className={cn("grid gap-3 rounded-lg border bg-card p-5", tone.panel, className)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="cost-guard-heading" className="eyebrow">
            Cost guard
          </h3>
          <p className={cn("mt-1.5 flex items-center gap-1.5 font-medium", tone.text)}>
            <Icon className="size-4 shrink-0" aria-hidden />
            {GUARD_WORDS[guard.level]}
          </p>
        </div>
        <p className={cn("font-serif text-2xl tabular-nums", tone.text)}>{guard.percent}%</p>
      </div>
      <GuardBar level={guard.level} percent={guard.percent} label="Cost guard" />
      <dl className="grid grid-cols-2 gap-3 text-sm tabular-nums">
        <div>
          <dt className="text-[0.8125rem] text-muted-foreground">Cost a piece so far</dt>
          <dd className="font-medium">{money(guard.perPiece, currency)}</dd>
        </div>
        <div>
          <dt className="text-[0.8125rem] text-muted-foreground">Target price</dt>
          <dd className="font-medium">{money(guard.target, currency)}</dd>
        </div>
      </dl>
      <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
        {guard.level === "OVER"
          ? "Each piece already costs more than its target price. Check the bills and costs before adding more."
          : `${money(guard.leftPerPiece, currency)} a piece is left before it reaches the target price. Production Managers get a message when it comes near (85%) and when it goes over.`}
      </p>
    </section>
  );
}

/**
 * A batch's cost guard over its styles with a target price: what they cost so
 * far against what their pieces may cost in all.
 */
export function BatchGuardLine({
  guard,
  currency,
}: {
  guard: { level: Level; percent: number; budget: string; spent: string; styles: number };
  currency: string;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-[0.8125rem] tabular-nums">
        <span className="min-w-0 text-muted-foreground">
          {money(guard.spent, currency)} of {money(guard.budget, currency)}
          {guard.styles > 1 ? ` · ${guard.styles} styles` : ""}
        </span>
        <span className={cn("font-medium whitespace-nowrap", GUARD_TONES[guard.level].text)}>
          {guard.percent}%
        </span>
      </div>
      <GuardBar level={guard.level} percent={guard.percent} label="Batch cost guard" />
    </div>
  );
}
