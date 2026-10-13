import { ScissorsIcon } from "lucide-react";
import Link from "next/link";

import { FormAlert } from "@/components/forms/field";
import { StatusBadge, type Tone } from "@/components/sales/badges";
import { Fact, Panel } from "@/components/sales/detail-bits";
import { Button } from "@/components/ui/button";
import { formatCount, formatDay } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { CheckLevel, Milestone } from "@/modules/production/cutting";
import type { CuttingScreen } from "@/modules/production/cutting.service";

import { pieces, productionHref } from "./labels";

/*
 * The parts of a style's cutting that only show: pieces by colour and size,
 * the cross-checks, the dates, and the summary on the project page.
 */

const CHECK_LEVELS: Record<CheckLevel, { tone: Tone; label: string }> = {
  SHORT: { tone: "warn", label: "Short" },
  WARN: { tone: "plain", label: "Check" },
  OK: { tone: "done", label: "OK" },
};
const CHECK_ABOUT = { FABRIC: "Fabric", COLLAR_CUFF: "Collar and cuff", ACCESSORY: "Accessory" };

/** "Navy M", or "All pieces" for a style without colours and sizes. */
export const cellName = (c: { colorName: string | null; sizeName: string | null }) =>
  [c.colorName, c.sizeName].filter(Boolean).join(" ") || "All pieces";

/** Good pieces cut: what was cut less what was spoiled outside (until cut again). */
export const goodPieces = (totals: CuttingScreen["totals"]) => totals.cut - totals.spoiled;

/** A cutting or sewing day with where it stands: late, due soon or done. */
export function MilestoneText({ m }: { m: Milestone }) {
  if (!m.dueOn) return <span className="text-muted-foreground">Not set</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {formatDay(m.dueOn)}
      {m.level === "LATE" && (
        <StatusBadge tone="warn">
          {m.days} {m.days === 1 ? "day" : "days"} late
        </StatusBadge>
      )}
      {m.level === "DUE_SOON" && <StatusBadge tone="plain">Due soon</StatusBadge>}
      {m.level === "DONE" && <StatusBadge tone="done">Done</StatusBadge>}
    </span>
  );
}

/** Late and due-soon dates as alerts: red when late, a note when near. */
export function DateWarnings({ warnings }: { warnings: CuttingScreen["warnings"] }) {
  return warnings.map((w) => (
    <FormAlert key={w.text} tone={w.level === "LATE" ? "error" : "note"}>
      {w.text}
    </FormAlert>
  ));
}

/** Pieces cut against the pieces to make, by colour (rows) and size (columns). */
export function CuttingGrid({ screen, currency }: { screen: CuttingScreen; currency: string }) {
  const { cells, colours, sizes, hasGrid } = screen;
  const at = (colour: string | null, size: string | null) =>
    cells.find((c) => c.colorName === colour && c.sizeName === size);
  const head = "px-2 py-2 text-left text-[0.75rem] font-medium tracking-wide text-muted-foreground";
  return (
    <Panel title="Pieces by colour and size" id="cut-grid-heading">
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        Good pieces cut of the pieces to make. Pieces spoiled at embroidery or print come off until
        they are cut again.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[20rem] border-collapse text-sm tabular-nums">
          <caption className="sr-only">Pieces cut by colour and size</caption>
          <thead>
            <tr className="border-b">
              <th scope="col" className={head}>
                {hasGrid ? "Colour" : ""}
              </th>
              {sizes.map((size) => (
                <th key={size ?? "all"} scope="col" className={head}>
                  {size ?? "Pieces"}
                </th>
              ))}
              {sizes.length > 1 && (
                <th scope="col" className={head}>
                  Total
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {colours.map((colour) => {
              const row = sizes.map((size) => at(colour, size));
              const good = row.reduce((t, c) => t + (c ? c.cut - c.spoiled : 0), 0);
              const target = row.reduce((t, c) => t + (c?.target ?? 0), 0);
              return (
                <tr key={colour ?? "all"} className="border-b last:border-b-0">
                  <th scope="row" className="px-2 py-2.5 text-left font-medium">
                    {colour ?? "All"}
                  </th>
                  {row.map((c, i) => {
                    if (!c) {
                      return (
                        <td key={i} className="px-2 py-2.5 text-muted-foreground">
                          –
                        </td>
                      );
                    }
                    const cellGood = c.cut - c.spoiled;
                    return (
                      <td
                        key={i}
                        className={cn(
                          "px-2 py-2.5 align-top",
                          cellGood >= c.target && "bg-primary/5",
                        )}
                      >
                        <span className="font-medium">{formatCount(cellGood, currency)}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          / {formatCount(c.target, currency)}
                        </span>
                        {(c.out > 0 || c.spoiled > 0) && (
                          <span className="block text-[0.75rem] text-muted-foreground">
                            {[c.out > 0 && `${c.out} out`, c.spoiled > 0 && `${c.spoiled} spoiled`]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  {sizes.length > 1 && (
                    <td className="px-2 py-2.5 align-top">
                      <span className="font-medium">{formatCount(good, currency)}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        / {formatCount(target, currency)}
                      </span>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/** What was cut against the fabric, the collars and cuffs ordered, and the accessories issued. */
export function CrossChecks({ checks }: { checks: CuttingScreen["checks"] }) {
  return (
    <Panel title="Cross-checks" id="cut-checks-heading">
      {checks.length === 0 ? (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          The checks start with the first cutting report: pieces a kg of fabric against the tech
          pack, collars and cuffs by colour and size against what was ordered, and accessories
          against what was issued.
        </p>
      ) : (
        <ul aria-label="Cross-checks" className="mt-4 grid divide-y">
          {checks.map((c) => (
            <li key={c.material.id} className="grid min-w-0 gap-1.5 py-3 first:pt-0 last:pb-0">
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <StatusBadge tone={CHECK_LEVELS[c.level].tone}>
                  {CHECK_LEVELS[c.level].label}
                </StatusBadge>
                <span className="font-medium">{c.material.code}</span>
                <span className="text-muted-foreground">{CHECK_ABOUT[c.about]}</span>
              </p>
              <p
                className={cn(
                  "text-[0.8125rem] leading-relaxed break-words",
                  c.level === "SHORT" ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {c.text}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** The project page's view of the style's cutting, with the way in. */
export function CuttingSummaryPanel({
  screen,
  currency,
}: {
  screen: CuttingScreen;
  currency: string;
}) {
  const { project: p, totals, milestones } = screen;
  const short = screen.checks.filter((c) => c.level === "SHORT");
  return (
    <Panel
      title="Cutting and embroidery"
      id="cutting-heading"
      action={
        <Button asChild size="sm" variant="outline">
          <Link href={productionHref.cutting(p.id)}>
            <ScissorsIcon aria-hidden />
            Open cutting
          </Link>
        </Button>
      }
    >
      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Fact label="Cut">
          {formatCount(goodPieces(totals), currency)} of {pieces(p.target, currency)}
        </Fact>
        <Fact label="At embroidery or print">{pieces(totals.out, currency)}</Fact>
        <Fact label="Cutting by">
          <MilestoneText m={milestones.cutting} />
        </Fact>
        <Fact label="Sewing by">
          <MilestoneText m={milestones.sewing} />
        </Fact>
      </dl>
      {(screen.warnings.length > 0 || short.length > 0) && (
        <div className="mt-4 grid gap-2">
          <DateWarnings warnings={screen.warnings} />
          {short.length > 0 && (
            <FormAlert>
              What was cut runs short of {short.map((c) => c.material.code).join(", ")}. See the
              cross-checks on the cutting page.
            </FormAlert>
          )}
        </div>
      )}
      {screen.reports.length === 0 && (
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          Nothing cut yet. Each day&apos;s cutting is recorded by colour and size, and the checks
          against the fabric, collars and accessories start with the first report.
        </p>
      )}
    </Panel>
  );
}
