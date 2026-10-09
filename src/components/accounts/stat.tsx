import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * One figure in a box: a label, the amount, a line under it, and when given a
 * link to where the figure comes from. "alert" turns it red (money owed late,
 * a loss).
 */
export function Stat({
  label,
  value,
  hint,
  href,
  alert = false,
  className,
}: {
  label: string;
  value: string;
  hint?: React.ReactNode;
  href?: string;
  alert?: boolean;
  className?: string;
}) {
  const body = (
    <>
      <dt className="eyebrow">{label}</dt>
      <dd
        className={cn(
          "mt-1 font-serif text-xl leading-tight break-words lining-nums tabular-nums",
          alert ? "text-destructive" : "text-primary",
        )}
      >
        {value}
      </dd>
      {hint && <dd className="mt-1 text-[0.8125rem] text-muted-foreground">{hint}</dd>}
    </>
  );
  const box = cn(
    "block h-full min-w-0 rounded-lg border bg-card p-4",
    alert && "border-destructive/40",
    className,
  );
  return href ? (
    <div className="min-w-0">
      <Link
        href={href}
        className={cn(
          box,
          "transition-colors outline-none hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/25",
        )}
      >
        {body}
      </Link>
    </div>
  ) : (
    <div className={box}>{body}</div>
  );
}
