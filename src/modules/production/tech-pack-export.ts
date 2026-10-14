import { localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { formatDay } from "@/lib/format";
import { checkRateLimit } from "@/lib/rate-limit";
import type { RequestMeta } from "@/lib/request-meta";
import { buildXlsx, type XlsxCell } from "@/lib/xlsx";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { letterheadOf } from "@/modules/documents/builders";
import { type Block, documentFileName, type PrintDocument } from "@/modules/documents/model";
import { ON_DEMAND_PER_MINUTE, renderOnDemand } from "@/modules/documents/on-demand";
import { readStoredFile } from "@/modules/files/file.service";
import { checkOption } from "@/modules/production/colour-check";
import { checkText, LOGO_FILE_RULES } from "@/modules/production/logo-files";
import {
  convertMeasure,
  inchText,
  type MeasureUnit,
  toleranceText,
} from "@/modules/production/measurements";
import { LOGO_FABRICS, LOGO_SOURCE_LABELS } from "@/modules/production/tech-pack-labels";
import {
  type Chart,
  getChart,
  loadTechPackProject,
} from "@/modules/production/tech-pack-spec.service";

/*
 * What leaves the tech pack on paper: the measurement sheet (PDF or Excel,
 * in the chart's unit with the other beside it), the chart, logos and colours
 * in the tech pack PDF, and the digitizing brief for the embroidery factory's
 * puncher when there is no machine file. No prices. Made when asked for and
 * not kept; each is logged.
 */

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const UNIT_TEXT: Record<MeasureUnit, string> = { INCH: "inch", CM: "cm" };

/** A value in the chart's unit: inches with ⅛ fractions, cm with one decimal. */
export function measureText(value: number | null | undefined, unit: MeasureUnit): string {
  if (value === null || value === undefined) return "–";
  return unit === "INCH" ? inchText(value) : value.toFixed(1).replace(/\.0$/, "");
}

const SOURCE_MARK = { BUYER: "", OWNER: "", RULE: " ?" } as const;

/** The chart as a table: one row per point, a column per size, ± tolerance. */
export function chartTable(chart: Chart, title = "Measurements"): Block {
  const unit = chart.unit;
  return {
    kind: "table",
    title: `${title} (${UNIT_TEXT[unit]}${chart.chestBasis ? `, chest ${chart.chestBasis.toLowerCase()}` : ""})`,
    empty: "No measurement chart yet.",
    columns: [
      { label: "Point of measure", weight: 3.2 },
      ...chart.sizes.map((s) => ({
        label: s === chart.baseSize ? `${s} (base)` : s,
        align: "right" as const,
      })),
      { label: "Tol ±", align: "right", weight: 0.9 },
    ],
    rows: chart.rows.map((r) => ({
      cells: [
        `${r.critical ? "★ " : ""}${r.name}`,
        ...chart.sizes.map(
          (s) =>
            `${measureText(r.values[s], unit)}${r.values[s] == null ? "" : SOURCE_MARK[r.sources[s] ?? "OWNER"]}`,
        ),
        toleranceText(r.tolerance, unit),
      ],
      details: r.howTo ? [r.howTo] : undefined,
    })),
  };
}

const chartNotes = (chart: Chart): Block[] => [
  {
    kind: "note",
    text: `★ critical point (checked on every piece). "?" marks a value made by the grading rules and not yet confirmed. Measured flat, in ${UNIT_TEXT[chart.unit]}.`,
  },
  ...(chart.questions.length > 0
    ? [
        {
          kind: "list" as const,
          title: "Open questions",
          items: chart.questions.map((q) => ({ text: q })),
        },
      ]
    : []),
];

export function measurementsDocument(
  ctx: CompanyContext,
  project: { code: string; name: string },
  chart: Chart,
): PrintDocument {
  return {
    type: "MEASUREMENTS",
    title: "Measurement Sheet",
    subtitle: project.name,
    reference: project.code,
    letterhead: letterheadOf(ctx.company),
    meta: [
      { label: "Project", value: project.code },
      { label: "Sizes", value: chart.sizes.join(", ") || "–" },
      ...(chart.baseSize ? [{ label: "Base size", value: chart.baseSize }] : []),
      { label: "Made on", value: formatDay(localDay(new Date(), ctx.company.timezone)) },
    ],
    parties: [],
    blocks: [chartTable(chart), ...chartNotes(chart)],
    signatures: ["Pattern Master", "QC Manager"],
  };
}

export function measurementsWorkbook(
  ctx: CompanyContext,
  project: { code: string; name: string },
  chart: Chart,
): Uint8Array {
  const sheet = (unit: MeasureUnit) => {
    const convert = (v: number | null | undefined) =>
      v === null || v === undefined
        ? null
        : unit === chart.unit
          ? v
          : Math.round(convertMeasure(v, chart.unit) * 100) / 100;
    const rows: XlsxCell[][] = [
      [{ value: `${project.code} · ${project.name}`, style: "title" }],
      [
        {
          value: `Measurements in ${UNIT_TEXT[unit]}${unit === chart.unit ? "" : ` (converted from ${UNIT_TEXT[chart.unit]})`}. "RULE" values are made by the grading rules and not yet confirmed.`,
          style: "note",
        },
      ],
      [],
      [
        { value: "Point of measure", style: "header" },
        ...chart.sizes.map((s) => ({ value: s, style: "header" as const })),
        { value: "Tol ±", style: "header" },
        { value: "Critical", style: "header" },
        { value: "Unconfirmed sizes", style: "header" },
        { value: "How to measure", style: "header" },
      ],
      ...chart.rows.map((r): XlsxCell[] => [
        { value: r.name },
        ...chart.sizes.map((s) => ({ value: convert(r.values[s]) })),
        { value: convert(r.tolerance) },
        { value: r.critical ? "Yes" : "" },
        { value: chart.sizes.filter((s) => r.sources[s] === "RULE").join(", ") },
        { value: r.howTo ?? "" },
      ]),
    ];
    return {
      name: `Measurements ${UNIT_TEXT[unit]}`,
      rows,
      widths: [30, ...chart.sizes.map(() => 9), 8, 9, 18, 50],
      freezeRows: 4,
    };
  };
  const other: MeasureUnit = chart.unit === "INCH" ? "CM" : "INCH";
  return buildXlsx([sheet(chart.unit), sheet(other)], {
    title: `Measurements ${project.code}`,
    creator: ctx.company.name,
    headerColor: ctx.company.primaryColor,
  });
}

/** The measurement sheet as a PDF or an Excel workbook (logged; nothing is kept). */
export async function measurementsFile(
  ctx: CompanyContext,
  projectId: string,
  format: "pdf" | "xlsx",
  meta?: RequestMeta,
) {
  checkRateLimit(`on-demand-print:${ctx.user.id}`, ON_DEMAND_PER_MINUTE, 60_000);
  const project = await loadTechPackProject(ctx, projectId);
  const chart = await getChart(ctx, project.id);
  if (chart.rows.length === 0) {
    throw new AppError("NOT_FOUND", `${project.code} has no measurement chart yet.`);
  }
  const bytes =
    format === "pdf"
      ? await renderOnDemand(ctx, measurementsDocument(ctx, project, chart))
      : measurementsWorkbook(ctx, project, chart);
  await auditInCompany(ctx, meta, {
    action: "EXPORT",
    entityType: "ProductionProject",
    entityId: project.id,
    summary: `Made the measurement sheet of ${project.code} (${format === "pdf" ? "PDF" : "Excel"})`,
  });
  return {
    fileName: documentFileName(
      ctx.company.name,
      `Measurements ${project.code} ${project.name}`,
      format === "pdf" ? ".pdf" : ".xlsx",
    ),
    mimeType: format === "pdf" ? "application/pdf" : XLSX_MIME,
    bytes: Buffer.from(bytes),
  };
}

/** The chart, logos and colours for the tech pack PDF (after the materials). */
export async function techPackExtraBlocks(
  ctx: CompanyContext,
  projectId: string,
): Promise<Block[]> {
  const [chart, techPack] = await Promise.all([
    getChart(ctx, projectId),
    ctx.db.techPack.findUnique({
      where: { projectId },
      select: {
        logos: { orderBy: { createdAt: "asc" } },
        colours: { orderBy: { createdAt: "asc" }, include: { options: true } },
      },
    }),
  ]);
  const blocks: Block[] = [];
  if (chart.rows.length > 0) blocks.push(chartTable(chart), ...chartNotes(chart));
  const logos = techPack?.logos ?? [];
  if (logos.length > 0) {
    blocks.push({
      kind: "table",
      title: "Logos and embroidery",
      columns: [
        { label: "Logo", weight: 2.4 },
        { label: "Size (mm)", weight: 1.2 },
        { label: "Machine file", weight: 2 },
        { label: "Owner's tick", weight: 1.2 },
      ],
      rows: logos.map((l) => ({
        cells: [
          l.name,
          l.widthMm ? `${Number(l.widthMm)} × ${l.heightMm ? Number(l.heightMm) : "?"}` : "–",
          l.machineFormat
            ? `${l.machineFormat}${l.source ? `, ${LOGO_SOURCE_LABELS[l.source].toLowerCase()}` : ""}`
            : "None yet",
          l.tickedAt ? "Ticked" : "Not yet: no bulk",
        ],
        details: [
          l.placement,
          l.threads ? `Threads: ${l.threads}` : null,
          l.fabric
            ? `Fabric version: ${LOGO_FABRICS[l.fabric as keyof typeof LOGO_FABRICS] ?? l.fabric}`
            : null,
        ].filter((d): d is string => Boolean(d)),
      })),
    });
  }
  const colours = techPack?.colours ?? [];
  if (colours.length > 0) {
    blocks.push({
      kind: "table",
      title: "Colours",
      columns: [
        { label: "Colour", weight: 2 },
        { label: "Code", weight: 1.6 },
        { label: "Limit (ΔE CMC 2:1)", align: "right", weight: 1.3 },
        { label: "Lights", weight: 1.3 },
        { label: "Lab dip", weight: 2 },
      ],
      rows: colours.map((c) => {
        const limit = Number(c.deltaLimit);
        const passing = c.options.filter(
          (o) =>
            checkOption({ deltaE: Number(o.deltaE), mi: o.mi ? Number(o.mi) : null }, limit)
              .verdict === "PASS",
        ).length;
        return {
          cells: [
            c.name,
            c.code ?? (c.codeSource === "IMAGE_ESTIMATE" ? "Approx. only: ask the buyer" : "–"),
            limit.toFixed(2),
            [c.primaryLight, c.secondaryLight].filter(Boolean).join(" / "),
            c.status === "BUYER_APPROVED"
              ? `Buyer approved ${c.approvedOption ?? ""}`.trim()
              : c.status === "BEST_CAN_DO"
                ? "Best can do (BCD)"
                : c.options.length === 0
                  ? "No lab dips yet"
                  : `${passing} of ${c.options.length} within the limit`,
          ],
        };
      }),
    });
    blocks.push({ kind: "note", text: "No bulk dyeing before the buyer approves a lab dip." });
  }
  return blocks;
}

/**
 * The digitizing brief for the embroidery factory's puncher: the logo's size,
 * threads, position, the fabric version and the formats needed, with the
 * rules for a clean file and the sew-out test.
 */
export async function digitizingBrief(
  ctx: CompanyContext,
  projectId: string,
  logoId: string,
  meta?: RequestMeta,
) {
  checkRateLimit(`on-demand-print:${ctx.user.id}`, ON_DEMAND_PER_MINUTE, 60_000);
  const project = await loadTechPackProject(ctx, projectId);
  const logo = await ctx.db.techPackLogo.findFirst({
    where: { id: logoId, techPack: { projectId: project.id } },
    include: { artworkFile: true },
  });
  if (!logo) throw new AppError("NOT_FOUND", "That logo is not on this tech pack.");
  const images = new Map<string, Buffer>();
  const picture =
    logo.artworkFile && ["image/jpeg", "image/png"].includes(logo.artworkFile.mimeType)
      ? logo.artworkFile
      : null;
  if (picture) images.set(picture.id, await readStoredFile(picture));
  const fabric = logo.fabric ? LOGO_FABRICS[logo.fabric as keyof typeof LOGO_FABRICS] : null;
  const model: PrintDocument = {
    type: "DIGITIZING_BRIEF",
    title: "Digitizing Brief",
    subtitle: `${logo.name} · ${project.name}`,
    reference: project.code,
    letterhead: letterheadOf(ctx.company),
    meta: [
      { label: "Project", value: project.code },
      { label: "Made on", value: formatDay(localDay(new Date(), ctx.company.timezone)) },
    ],
    parties: [],
    blocks: [
      {
        kind: "table",
        title: "The logo",
        columns: [
          { label: "Item", weight: 1.4 },
          { label: "Spec", weight: 3 },
        ],
        rows: [
          {
            cells: ["Logo", logo.name],
            image: picture?.id,
            details: logo.artworkFile
              ? [`Artwork: ${logo.artworkFile.fileName}`]
              : ["Artwork: ask for the buyer's vector"],
          },
          {
            cells: [
              "Size",
              logo.widthMm
                ? `${Number(logo.widthMm)} × ${logo.heightMm ? Number(logo.heightMm) : "?"} mm (±1 mm or 2%)`
                : "Ask the merchandiser",
            ],
          },
          { cells: ["Position", logo.placement ?? "As the tech pack shows (±3 mm)"] },
          { cells: ["Threads", logo.threads ?? "As the artwork shows"] },
          { cells: ["Colours", logo.colours ? String(logo.colours) : "As the artwork shows"] },
          { cells: ["Fabric", fabric ? `${fabric} (${logo.fabric})` : "As the tech pack shows"] },
          {
            cells: [
              "Files needed",
              "DST (machine unknown); also TAP for Happy, U01 for Barudan, DSB for Dahao, if asked",
            ],
          },
        ],
      },
      {
        kind: "list",
        title: "Rules for the file",
        numbered: true,
        items: LOGO_FILE_RULES.map((text) => ({ text })),
      },
      {
        kind: "list",
        title: "Sew-out test (a condition of the booking)",
        numbered: true,
        items: [
          { text: "Sew the logo out on the bulk fabric, with the backing for this fabric." },
          { text: "Photograph it next to the genuine sample, with a ruler in the photo." },
          {
            text: "Send the machine file and the photo back; bulk starts only after the owner's tick.",
          },
        ],
      },
      ...(logo.fileCheck
        ? [{ kind: "note" as const, text: `Last file check: ${checkText(logo.fileCheck)}` }]
        : []),
    ],
    signatures: ["Embroidery factory", "Merchandiser"],
  };
  const bytes = await renderOnDemand(ctx, model, images);
  await auditInCompany(ctx, meta, {
    action: "EXPORT",
    entityType: "ProductionProject",
    entityId: project.id,
    summary: `Made the digitizing brief for the logo ${logo.name} of ${project.code}`,
  });
  return {
    fileName: documentFileName(ctx.company.name, `Digitizing brief ${project.code} ${logo.name}`),
    bytes,
  };
}
