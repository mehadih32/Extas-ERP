"use client";

import { DownloadIcon } from "lucide-react";
import { useState } from "react";

import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { ActionError } from "@/lib/result";

/*
 * "Download" on every Business page (plan v6 sec 12): the period, the parts to
 * put in (ticked), PDF to print or Excel to check. The last choice is
 * remembered in this browser; "Bank report" ticks the parts a bank asks for.
 */

const PARTS = [
  ["summary", "Summary"],
  ["profit", "Profit and loss"],
  ["months", "By month"],
  ["chart", "Chart"],
  ["sales", "Sales"],
  ["customers", "Customers"],
  ["ads", "Ads and budget"],
  ["returns", "Returns and delivery"],
  ["statement", "Statement"],
  ["days", "Every day (Excel only)"],
] as const;
const BANK = ["summary", "profit", "months", "statement"];
const PERIODS = [
  ["month", "This month"],
  ["year", "This year"],
  ["all", "Lifetime"],
  ["custom", "Your own days"],
] as const;
const KEY = "extras.business.download";

type Choice = { parts: string[]; format: "pdf" | "xlsx" };

function remembered(): Choice {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Choice | null;
    if (raw && Array.isArray(raw.parts) && (raw.format === "pdf" || raw.format === "xlsx")) {
      return raw;
    }
  } catch {
    // No browser storage here: start from the default.
  }
  return { parts: ["summary", "profit", "months", "chart"], format: "pdf" };
}

export function DownloadButton({
  scope,
  storeId,
  period,
}: {
  scope: "overview" | "ecommerce" | "pos" | "store";
  storeId?: string;
  /** The page's period, the window's first choice. */
  period?: { key: string; from: string; to: string };
}) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<Choice>(() => ({ parts: [], format: "pdf" }));
  const [periodKey, setPeriodKey] = useState(
    period && ["month", "year", "all"].includes(period.key)
      ? period.key
      : period
        ? "custom"
        : "month",
  );

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setChoice(remembered());
          setOpen(true);
        }}
      >
        <DownloadIcon aria-hidden />
        Download
      </Button>
      {open && (
        <FormDialog
          title="Download"
          description="Tick what goes in. A store's report prints on its own pad."
          submitLabel="Download"
          pendingLabel="Making the file"
          errorTitle="The file was not made"
          onClose={() => setOpen(false)}
          onSubmit={async (form) => {
            const parts = PARTS.map(([k]) => k).filter((k) => form.get(`part-${k}`) === "on");
            const format = form.get("format") === "xlsx" ? "xlsx" : "pdf";
            try {
              localStorage.setItem(KEY, JSON.stringify({ parts, format }));
            } catch {
              // Not remembered in this browser; the file is still made.
            }
            const params = new URLSearchParams({ scope, parts: parts.join(","), format });
            if (storeId) params.set("storeId", storeId);
            if (periodKey === "custom") {
              params.set("from", String(form.get("from") ?? ""));
              params.set("to", String(form.get("to") ?? ""));
            } else params.set("period", periodKey);
            const response = await fetch(`/api/business/report?${params}`);
            if (!response.ok) {
              const body = (await response.json().catch(() => null)) as {
                error?: ActionError;
              } | null;
              return body?.error ?? { code: "INTERNAL", message: "The file could not be made." };
            }
            const name =
              /filename\*=UTF-8''([^;]+)/.exec(
                response.headers.get("Content-Disposition") ?? "",
              )?.[1] ?? `report.${format}`;
            const url = URL.createObjectURL(await response.blob());
            const a = document.createElement("a");
            a.href = url;
            a.download = decodeURIComponent(name);
            a.click();
            URL.revokeObjectURL(url);
            setOpen(false);
            return undefined;
          }}
        >
          {() => (
            <>
              <label className="grid gap-1.5 text-sm">
                <span className="text-muted-foreground">Period</span>
                <NativeSelect
                  value={periodKey}
                  containerClassName="sm:w-full"
                  onChange={(e) => setPeriodKey(e.target.value)}
                >
                  {PERIODS.map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              {periodKey === "custom" && (
                <div className="grid grid-cols-2 gap-3">
                  <label className="grid gap-1.5 text-sm">
                    <span className="text-muted-foreground">From</span>
                    <Input type="date" name="from" defaultValue={period?.from} required />
                  </label>
                  <label className="grid gap-1.5 text-sm">
                    <span className="text-muted-foreground">To</span>
                    <Input type="date" name="to" defaultValue={period?.to} required />
                  </label>
                </div>
              )}
              <fieldset className="grid gap-2">
                <legend className="text-sm text-muted-foreground">What goes in</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {PARTS.map(([k, label]) => (
                    <label key={k} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name={`part-${k}`}
                        checked={choice.parts.includes(k)}
                        onChange={(e) =>
                          setChoice((c) => ({
                            ...c,
                            parts: e.target.checked
                              ? [...c.parts, k]
                              : c.parts.filter((p) => p !== k),
                          }))
                        }
                        className="size-4 accent-primary"
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-self-start"
                  onClick={() => setChoice((c) => ({ ...c, parts: BANK }))}
                >
                  Bank report
                </Button>
              </fieldset>
              <fieldset className="grid gap-2">
                <legend className="text-sm text-muted-foreground">File</legend>
                <div className="flex flex-wrap gap-4 text-sm">
                  {(
                    [
                      ["pdf", "PDF (to print)"],
                      ["xlsx", "Excel (to check)"],
                    ] as const
                  ).map(([v, label]) => (
                    <label key={v} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="format"
                        value={v}
                        checked={choice.format === v}
                        onChange={() => setChoice((c) => ({ ...c, format: v }))}
                        className="size-4 accent-primary"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          )}
        </FormDialog>
      )}
    </>
  );
}
