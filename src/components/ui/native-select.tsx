import { ChevronDownIcon } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/** The phone's own picker on mobile, styled to match the inputs. */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative w-full sm:w-auto">
      <select
        data-slot="native-select"
        className={cn(
          "h-11 w-full min-w-0 cursor-pointer appearance-none rounded-md border border-input bg-card py-2 pr-9 pl-3 text-base transition-[color,border-color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/15 disabled:cursor-not-allowed disabled:opacity-50 md:h-9 md:text-sm",
          className,
        )}
        {...props}
      />
      <ChevronDownIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}

export { NativeSelect };
