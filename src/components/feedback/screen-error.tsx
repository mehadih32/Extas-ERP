"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { ErrorDialog } from "@/components/feedback/error-dialog";
import { errorCodeFor } from "@/lib/error-code";

/** What error.tsx and global-error.tsx show: the error modal over a calm page. */
export function ScreenError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const [code] = useState(() => errorCodeFor(error));
  const pathname = usePathname();

  useEffect(() => {
    // Server failures are already in the server log under this code; this one is for the browser.
    console.error(`[${code}]`, error);
  }, [code, error]);

  return (
    <div className="min-h-[60vh]" aria-busy="false">
      <ErrorDialog
        code={code}
        title="This screen could not open"
        onRetry={retry}
        showHomeLink={pathname !== "/"}
      />
    </div>
  );
}
