import { ImageIcon } from "lucide-react";

import type { CompanyDetails } from "@/modules/companies/company.service";

/**
 * The letterhead logo, read from GET /api/company/logo (open to everyone in the
 * company). The file's id in the address shows a new upload straight away.
 */
export function CompanyLogo({ logo }: { logo: CompanyDetails["logo"] }) {
  return (
    <div className="flex h-24 w-40 shrink-0 items-center justify-center rounded-md border bg-background p-3">
      {logo ? (
        // A signed-in API image, not a static asset, so next/image's optimiser cannot fetch it.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/company/logo?v=${logo.id}`}
          alt={`Logo: ${logo.fileName}`}
          className="max-h-full max-w-full object-contain"
        />
      ) : (
        <span className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
          <ImageIcon className="size-5" aria-hidden />
          No logo yet
        </span>
      )}
    </div>
  );
}
