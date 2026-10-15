import { cn } from "@/lib/utils";

/*
 * The tech pack's colour signals, the same everywhere: green confirmed (by the
 * buyer or a person), yellow an AI guess, red missing. Each colour comes with
 * a symbol, so a black-and-white print still reads.
 */

export type Signal = "green" | "yellow" | "red";

export const SIGNAL_TEXT: Record<Signal, { symbol: string; label: string }> = {
  green: { symbol: "✓", label: "Confirmed" },
  yellow: { symbol: "?", label: "AI guess" },
  red: { symbol: "!", label: "Missing" },
};

const MARK: Record<Signal, string> = {
  green: "bg-success text-white",
  yellow: "bg-amber-400 text-amber-950",
  red: "bg-destructive text-white",
};

export function SignalMark({ signal, className }: { signal: Signal; className?: string }) {
  const s = SIGNAL_TEXT[signal];
  return (
    <span
      role="img"
      aria-label={s.label}
      title={s.label}
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-semibold",
        MARK[signal],
        className,
      )}
    >
      {s.symbol}
    </span>
  );
}

/** Cell backgrounds for the measurement grid. */
export const CELL_TONE: Record<Signal, string> = {
  green: "bg-success/10",
  yellow: "bg-amber-100 dark:bg-amber-950/40",
  red: "bg-destructive/10",
};

export function SignalLegend() {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.8125rem] text-muted-foreground">
      {(Object.keys(SIGNAL_TEXT) as Signal[]).map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <SignalMark signal={s} />
          {SIGNAL_TEXT[s].label}
        </span>
      ))}
    </p>
  );
}

export function Completeness({
  percent,
  signals,
}: {
  percent: number;
  signals: Record<Signal, number>;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">Completeness</span>
        <span className="font-serif text-2xl text-primary tabular-nums">{percent}%</span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Completeness"
      >
        <div className="h-full bg-success" style={{ width: `${percent}%` }} />
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-[0.8125rem] text-muted-foreground tabular-nums">
        {(Object.keys(SIGNAL_TEXT) as Signal[]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <SignalMark signal={s} />
            {signals[s]} {SIGNAL_TEXT[s].label.toLowerCase()}
          </span>
        ))}
      </p>
    </div>
  );
}
