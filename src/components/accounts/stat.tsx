import Link from "next/link";

import { cn } from "@/lib/utils";

import { Amount } from "./privacy";

/**
 * One figure in a box: a label, the amount, a line under it, and when given a
 * link to where the figure comes from. "alert" turns it red (money owed late,
 * a loss). With a `scope`, the amount hides behind the page's eye (privacy.tsx).
 */
export function Stat({
  label,
  value,
  hint,
  href,
  alert = false,
  scope,
  className,
}: {
  label: string;
  value: string;
  hint?: React.ReactNode;
  href?: string;
  alert?: boolean;
  /** Hides the amount until the page's eye (or this scope's) shows it. */
  scope?: string;
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
        {scope ? <Amount scope={scope}>{value}</Amount> : value}
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
