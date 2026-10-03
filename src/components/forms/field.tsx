import { CircleAlertIcon, CircleCheckIcon, InfoIcon } from "lucide-react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** A labelled form control with its hint or error underneath. */
export function Field({
  id,
  label,
  hint,
  error,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-[0.8125rem] text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[0.8125rem] text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A message about the whole form, e.g. "Incorrect email or password." A "note"
 * points something out before the person acts ("This is your own role").
 */
export function FormAlert({
  children,
  tone = "error",
}: {
  children: React.ReactNode;
  tone?: "error" | "success" | "note";
}) {
  const Icon = tone === "note" ? InfoIcon : tone === "success" ? CircleCheckIcon : CircleAlertIcon;
  return (
    <div
      role={tone === "error" ? "alert" : tone === "success" ? "status" : "note"}
      className={cn(
        "flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm",
        tone === "error" && "border-destructive/25 bg-destructive/5 text-destructive",
        tone === "success" && "border-primary/20 bg-secondary text-primary",
        tone === "note" && "border-border bg-muted/60 text-foreground",
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}
