import { Prisma } from "@prisma/client";

import { formatAmount } from "@/lib/format";
import type { CompanyContext } from "@/modules/auth/context";
import { getPartyBalance } from "@/modules/parties/ledger.service";
import { getBatchSummary } from "@/modules/production/batch-summary.service";

import {
  POLO_BATCH,
  POLO_STYLES,
  type SimulationManifest,
} from "../../../prisma/demo/five-style-polo";

/*
 * The Simulation Report of a Five Style Polo run, in Markdown (the GitHub job
 * summary and the PR): every step, the styles, the CM rules at work (Demo Embo's
 * spoilage, the rejects over the 2% allowance, the missing pieces), the final
 * CM settlement, the batch's money as the batch summary shows it, each
 * supplier's Supplier Due before and after, the stock, and what the wipe took.
 */

const bdt = (value: Prisma.Decimal.Value) => `BDT ${formatAmount(value, 2, "BDT")}`;
const pcs = (n: number) => formatAmount(n, 0, "BDT");

/** The figures the report needs, read while the run is on the books. */
export async function readFiveStylePolo(ctx: CompanyContext, m: SimulationManifest) {
  const summary = await getBatchSummary(ctx, m.batchId!);
  const parties = [m.factory, m.mill, m.added.embo, m.added.trims, m.added.buttons].flatMap((p) =>
    p ? [p] : [],
  );
  const dues = [];
  for (const p of parties) {
    dues.push({
      name: p.name,
      before: m.before.due[p.id] ?? "0.00",
      after: (await getPartyBalance(ctx, p.id)).neg().toFixed(2),
    });
  }
  return { summary, dues };
}

export type FiveStylePoloFigures = Awaited<ReturnType<typeof readFiveStylePolo>>;

export function fiveStylePoloReport(
  m: SimulationManifest,
  { summary: s, dues }: FiveStylePoloFigures,
  wiped?: string[],
) {
  const out: string[] = [];
  const row = (...cells: Array<string | number | null>) =>
    out.push(`| ${cells.map((c) => (c === null ? "" : String(c))).join(" | ")} |`);
  const cm = s.penalties.cm.totals;
  out.push(`# Simulation Report: ${POLO_BATCH} (${m.batchCode})`, "");
  out.push(
    `${pcs(s.pieces.target)} pieces in five styles at **${m.factory!.name}** (CM), fabric from **${m.mill!.name}**, embroidery and print at **${m.added.embo!.name}** (Gazipur), accessories from **${m.added.trims!.name}** and **${m.added.buttons!.name}**, paid from **${m.bank!.code} ${m.bank!.name}**. Rejects allowed: ${s.batch.rejectAllowancePercent}% of the pieces cut.`,
    "",
  );
  out.push("## What ran, step by step", "");
  m.steps.forEach((step, i) => out.push(`${i + 1}. ${step}`));

  out.push("", "## The styles", "");
  row(
    "Style",
    "Brand",
    "Work",
    "Target price",
    "CM a piece",
    "Cut",
    "A",
    "B",
    "C",
    "Rejects",
    "Missing",
    "Total cost",
    "Cost a good piece",
  );
  row(
    "---",
    "---",
    "---",
    "---:",
    "---:",
    "---:",
    "---:",
    "---:",
    "---:",
    "---:",
    "---:",
    "---:",
    "---:",
  );
  for (const x of s.styles) {
    const style = m.styles.find((y) => y.projectId === x.id)!;
    const rejectPct = x.cut ? ((x.reject / x.cut) * 100).toFixed(2) : null;
    row(
      x.code,
      style.brand,
      `${style.work === "PRINT" ? "Print" : "Embroidery"} at ${bdt(style.workRate)}`,
      x.targetPrice ? bdt(x.targetPrice) : null,
      x.cmRate ? bdt(x.cmRate) : null,
      x.cut,
      x.a,
      x.b,
      x.c,
      `${x.reject}${rejectPct ? ` (${rejectPct}%)` : ""}`,
      x.missing,
      bdt(x.totalCost),
      x.perPiece ? bdt(x.perPiece) : null,
    );
  }
  row(
    "**All**",
    "",
    "",
    s.money.targetPrice ? bdt(s.money.targetPrice) : null,
    "",
    s.pieces.cut,
    s.pieces.a,
    s.pieces.b,
    s.pieces.c,
    s.pieces.reject,
    s.pieces.missing,
    `**${bdt(s.money.totalCost)}**`,
    s.money.perPiece ? `**${bdt(s.money.perPiece)}**` : null,
  );

  out.push("", "## The CM rules at work", "");
  const house = s.penalties.faults.filter((f) => f.kind === "SPOILED_PIECES");
  out.push(
    `**Spoiled at ${m.added.embo!.name}** (${house.reduce((t, f) => t + Number(f.quantity ?? 0), 0)} pieces): each valued at the fabric in a cut piece and taken off ${m.added.embo!.name}'s own Supplier Due at once, never the factory's.`,
    "",
  );
  row("Fault", "Style", "Pieces", "Value", "Status");
  row("---", "---", "---:", "---:", "---");
  for (const f of house) {
    row(f.number, f.style, f.quantity, f.amount ? bdt(f.amount) : null, f.statusText);
  }
  out.push(
    "",
    `**Rejects over the ${s.penalties.cm.rejectAllowancePercent}% allowance**: within the allowance the factory pays nothing; each reject over it comes off its CM at the style's target price.`,
    "",
  );
  row("Style", "Cut", "Rejects", "Allowance", "Over", "Target price", "Taken off");
  row("---", "---:", "---:", "---:", "---:", "---:", "---:");
  for (const x of s.styles) {
    const over = s.penalties.cm.overAllowance.find((o) => o.code === x.code);
    const allowance = x.cut
      ? Math.floor((x.cut * Number(s.penalties.cm.rejectAllowancePercent ?? 2)) / 100)
      : 0;
    row(
      x.code,
      x.cut,
      x.reject,
      over?.allowance ?? allowance,
      over?.over ?? 0,
      x.targetPrice ? bdt(x.targetPrice) : null,
      over ? bdt(over.amount) : "nothing",
    );
  }
  const missing = s.penalties.faults.filter((f) => f.kind === "MISSING_PIECES");
  out.push(
    "",
    `**Missing pieces** (${missing.reduce((t, f) => t + Number(f.quantity ?? 0), 0)}): no allowance, all charged to ${m.factory!.name} at the style's final unit cost: ${bdt(s.penalties.missing)}.`,
    "",
  );

  out.push("## The final CM settlement", "");
  row("Line", "Amount");
  row("---", "---:");
  row("Total CM (A + B + C + rejects at each style's CM)", bdt(cm.totalCm));
  row("Less missing pieces (at the final unit cost)", bdt(cm.faults));
  row(
    `Less rejects over the ${s.penalties.cm.rejectAllowancePercent}% allowance (at the target price)`,
    bdt(cm.rejects),
  );
  row("Less the CM of the C-grade pieces", bdt(cm.cGradeCm));
  row("Less the advance paid", bdt(cm.paid));
  row(
    `**Final payable to ${m.factory!.name}** (${s.penalties.cm.saved?.number ?? "not saved"})`,
    `**${bdt(cm.payable)}**`,
  );

  out.push("", "## The batch's money (as on the batch summary)", "");
  row("Figure", "Amount");
  row("---", "---:");
  row("Total cost", bdt(s.money.totalCost));
  row(
    `Cost a good piece (÷ ${pcs(s.pieces.good)} A and B)`,
    s.money.perPiece ? bdt(s.money.perPiece) : null,
  );
  row("Target price (average)", s.money.targetPrice ? bdt(s.money.targetPrice) : null);
  row("Taken back from suppliers (penalties and deductions)", bdt(s.money.recovered));
  row("Net cost", bdt(s.money.netCost));
  row("Net cost a good piece", s.money.netPerPiece ? bdt(s.money.netPerPiece) : null);
  out.push("", "Where the money went:", "");
  row("What", "Quantity", "Amount");
  row("---", "---:", "---:");
  for (const l of s.spent) {
    row(l.what, l.quantity ? `${l.quantity} ${l.unit ?? ""}`.trim() : null, bdt(l.amount));
  }

  out.push("", "## Supplier Due", "");
  row("Supplier", "Before", "After", "Change");
  row("---", "---:", "---:", "---:");
  for (const d of dues) {
    row(d.name, bdt(d.before), bdt(d.after), bdt(new Prisma.Decimal(d.after).minus(d.before)));
  }

  out.push("", "## Stock", "");
  row("Warehouse", "A", "B", "Value");
  row("---", "---:", "---:", "---:");
  for (const w of s.stock.rows) row(w.warehouse, w.a, w.b, bdt(w.value));
  row("**All**", s.stock.a, s.stock.b, `**${bdt(s.stock.value)}**`);
  out.push(
    "",
    `The plan behind it: ${POLO_STYLES.map((x) => `${x.brand} ${pcs(x.sizes.reduce((t, n) => t + n, 0))}`).join(", ")} pieces in S, M, L, XL and XXL.`,
  );

  if (wiped) {
    out.push(
      "",
      "## The wipe",
      "",
      "Every record above was deleted and every table checked to be exactly as before the run:",
      "",
    );
    wiped.forEach((w) => out.push(`- ${w}`));
  }
  return out.join("\n") + "\n";
}
