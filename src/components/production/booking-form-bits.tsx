"use client";

import { cn } from "@/lib/utils";

/*
 * Controls the booking wizard is built from: big choice cards (the source and
 * the garment family), a segmented switch (tube or open, English or বাংলা) and
 * a step's heading. Plain controlled inputs, so they behave on phones too.
 */

/** Radio buttons drawn as cards, chosen with a tap or the arrow keys. */
export function ChoiceCards<T extends string>({
  name,
  legend,
  options,
  value,
  onChange,
  columns = "sm:grid-cols-2",
  disabled = false,
}: {
  name: string;
  legend: string;
  options: ReadonlyArray<{ value: T; label: string; hint?: string; icon?: React.ReactNode }>;
  value: T;
  onChange: (value: T) => void;
  columns?: string;
  disabled?: boolean;
}) {
  return (
    <fieldset className="grid min-w-0 gap-2" disabled={disabled}>
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className={cn("grid grid-cols-1 gap-2", columns)}>
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              "flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border bg-card px-3.5 py-3 transition-colors",
              "has-[:checked]:border-primary has-[:checked]:bg-secondary has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/25",
              disabled && "cursor-not-allowed opacity-70",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
              className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary"
            />
            {option.icon && (
              <span className="mt-0.5 shrink-0 text-primary" aria-hidden>
                {option.icon}
              </span>
            )}
            <span className="grid min-w-0 gap-0.5">
              <span className="text-sm font-medium">{option.label}</span>
              {option.hint && (
                <span className="text-[0.8125rem] leading-snug text-muted-foreground">
                  {option.hint}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Two to four options side by side, one pressed. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  size = "md",
}: {
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T | "";
  onChange: (value: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex max-w-full rounded-md border bg-muted/50 p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "min-w-0 rounded-[5px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25",
            size === "sm" ? "px-2.5 py-1 text-[0.8125rem]" : "px-3.5 py-1.5 text-sm",
            option.value === value
              ? "bg-card text-primary shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** The heading of a wizard step and what it is for. */
export function StepHeading({
  id,
  title,
  children,
  action,
}: {
  id: string;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h3 id={id} className="font-serif text-xl text-primary" tabIndex={-1}>
          {title}
        </h3>
        {children && (
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">{children}</p>
        )}
      </div>
      {action}
    </div>
  );
}

/** A live figure the wizard works out ("Total sets 1,030"). */
export function Figure({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-md border bg-card px-3 py-2">
      <dt className="text-[0.75rem] text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 truncate tabular-nums",
          strong ? "font-serif text-lg text-primary" : "text-sm font-medium",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
