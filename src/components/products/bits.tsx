import { cn } from "@/lib/utils";

/** A colour's swatch, outlined so white and ivory still show. */
export function Swatch({ hex, className }: { hex: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-3.5 shrink-0 rounded-full border border-black/15",
        className,
      )}
      style={{ backgroundColor: hex }}
    />
  );
}

/** "Nothing here": a dashed box with what to do next. */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-dashed px-6 py-10 text-center">
      <p className="font-serif text-lg text-primary">{title}</p>
      {children && (
        <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">
          {children}
        </p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/** A small figure with its label: "AVAILABLE 1,240". */
export function Figure({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1 font-serif text-lg leading-tight lining-nums tabular-nums">{value}</dd>
    </div>
  );
}
