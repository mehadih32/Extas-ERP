import { cn } from "@/lib/utils";

/** "EXTAS ERP" set in the house serif. Inherits its colour. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-baseline gap-2 whitespace-nowrap", className)}>
      <span className="font-serif text-[1.3rem] leading-none font-medium tracking-[0.22em] uppercase">
        Extas
      </span>
      <span className="text-[0.625rem] leading-none font-medium tracking-[0.32em] uppercase opacity-70">
        ERP
      </span>
    </span>
  );
}
