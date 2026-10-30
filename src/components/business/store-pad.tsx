"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Panel } from "@/components/sales/detail-bits";
import { Button } from "@/components/ui/button";
import { removeStoreLogoAction, uploadStoreLogoAction } from "@/server/actions/retail.actions";

/*
 * The store's own pad (plan v6 sec 12): the logo its reports print with, and
 * its year-end summaries (sec 14, point 2), kept once each year is over.
 */
export function StorePad({
  storeId,
  logoId,
  yearReports,
  canManage,
}: {
  storeId: string;
  logoId: string | null;
  yearReports: Array<{ id: string; year: number }>;
  canManage: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function run(action: () => Promise<{ ok: boolean; error?: { message: string } }>) {
    setPending(true);
    const result = await action();
    setPending(false);
    setError(result.ok ? undefined : result.error?.message);
    if (result.ok) router.refresh();
  }

  return (
    <Panel
      title="Pad and year-end summaries"
      id="store-pad"
      action={
        canManage && (
          <div className="flex flex-wrap gap-2">
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              aria-label="Logo file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                const form = new FormData();
                form.set("file", file);
                void run(() => uploadStoreLogoAction(storeId, form));
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => input.current?.click()}
            >
              {logoId ? "Change logo" : "Upload logo"}
            </Button>
            {logoId && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => void run(() => removeStoreLogoAction(storeId))}
              >
                Remove logo
              </Button>
            )}
          </div>
        )
      }
    >
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <p className="eyebrow">Logo on the pad</p>
          {logoId ? (
            // eslint-disable-next-line @next/next/no-img-element -- a private file, not a public asset
            <img
              src={`/api/business/stores/${storeId}/logo?v=${logoId}`}
              alt="The store's logo"
              className="mt-2 max-h-16 max-w-48 object-contain"
            />
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              No logo yet: the store&apos;s reports print with its name, address and phone.
            </p>
          )}
        </div>
        <div className="min-w-0">
          <p className="eyebrow">Year-end summaries</p>
          {yearReports.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">
              None yet. The first is made by itself after the year ends.
            </p>
          ) : (
            <ul className="mt-1 flex flex-wrap gap-3 text-sm">
              {yearReports.map((r) => (
                <li key={r.id}>
                  <a
                    href={`/api/business/year-reports/${r.id}`}
                    className="text-primary hover:underline"
                  >
                    {r.year} (PDF)
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
    </Panel>
  );
}
