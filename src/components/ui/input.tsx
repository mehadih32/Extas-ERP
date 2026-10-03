import * as React from "react";

import { cn } from "@/lib/utils";

/** 16px text on phones so iOS does not zoom into the field. */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 py-2 text-base transition-[color,border-color,box-shadow] outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/15 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/15 md:h-10 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
