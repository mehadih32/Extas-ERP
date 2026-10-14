import { Prisma } from "@prisma/client";

import { localDay } from "@/lib/dates";
import { formatAmount, formatDay } from "@/lib/format";
import { checkRateLimit } from "@/lib/rate-limit";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { letterheadOf } from "@/modules/documents/builders";
import { documentFileName, type Block, type PrintDocument } from "@/modules/documents/model";
import { ON_DEMAND_PER_MINUTE, renderOnDemand } from "@/modules/documents/on-demand";
import { loadMaterialImages } from "@/modules/production/material-image.service";
import { techPackExtraBlocks } from "@/modules/production/tech-pack-export";
import {
  getMaterialNeeds,
  gridAxes,
  type MaterialNeeds,
  perPieceText,
} from "@/modules/production/material-need.service";
import { quantity as materialQuantity, UNIT_LABELS } from "@/components/materials/labels";

/*
 * A style's tech pack for the factory: its pieces per colour and size, its
 * materials per piece with their pictures, where each goes and what the pieces
 * need in all, its measurement chart, logos and colours, and the making notes.
 * It carries no prices. Made when asked for
 * and not kept (each one is logged).
 */

const SPLIT_TEXT = {
  TOTAL: "One total",
  COLOUR: "By colour",
  COLOUR_SIZE: "By colour and size",
} as const;

const Decimal = Prisma.Decimal;
const trimmed = (d: Prisma.Decimal) => d.toFixed(3).replace(/\.?0+$/, "") || "0";

/** A colour × size matrix (pieces, or a material's quantities) with row and column totals. */
export function gridTable(
  title: string,
  cells: ReadonlyArray<{ colorName: string; sizeName: string; value: Prisma.Decimal.Value }>,
  format: (value: Prisma.Decimal) => string,
): Block {
  const { colours, sizes } = gridAxes(
    cells.map((c) => ({ colorName: c.colorName, sizeName: c.sizeName, quantity: 0 })),
  );
  const at = new Map(cells.map((c) => [`${c.colorName}|${c.sizeName}`, new Decimal(c.value)]));
  const sum = (values: Array<Prisma.Decimal | undefined>) =>
    values.reduce<Prisma.Decimal>((t, v) => (v ? t.plus(v) : t), new Decimal(0));
  const rows = colours.map((colour) => {
    const row = sizes.map((size) => at.get(`${colour}|${size}`));
    return { cells: [colour, ...row.map((v) => (v ? format(v) : "–")), format(sum(row))] };
  });
  const sizeTotals = sizes.map((size) => sum(colours.map((c) => at.get(`${c}|${size}`))));
  return {
    kind: "table",
    title,
    columns: [
      { label: "Colour", weight: 2 },
      ...sizes.map((s) => ({ label: s, align: "right" as const })),
      { label: "Total", align: "right", weight: 1.2 },
    ],
    rows: [
      ...rows,
      { cells: ["Total", ...sizeTotals.map(format), format(sum(sizeTotals))], style: "total" },
    ],
  };
}

export function techPackDocument(
  ctx: CompanyContext,
  data: MaterialNeeds,
  notes: string | null,
  /** The measurement chart, logos and colours (tech-pack-export.ts). */
  extra: Block[] = [],
) {
  const { project: p, grid, needs } = data;
  const currency = ctx.company.currency;
  const tz = ctx.company.timezone;
  const factory = p.factory?.name ?? p.factoryName;
  const model: PrintDocument = {
    type: "TECH_PACK",
    title: "Tech Pack",
    subtitle: p.name,
    reference: p.code,
    letterhead: letterheadOf(ctx.company),
    meta: [
      { label: "Project", value: p.code },
      ...(p.style ? [{ label: "Style", value: p.style.code }] : []),
      ...(p.batch ? [{ label: "Master batch", value: p.batch.code }] : []),
      { label: "Pieces", value: formatAmount(p.targetQuantity, 0, currency) },
      ...(p.targetDate
        ? [{ label: "Finish by", value: formatDay(localDay(p.targetDate, tz)) }]
        : []),
      { label: "Made on", value: formatDay(localDay(new Date(), tz)) },
    ],
    parties: [
      {
        heading: "Factory",
        lines: [
          factory ?? "Not given",
          ...(p.factory
            ? [p.factory.phone, [p.factory.address, p.factory.city].filter(Boolean).join(", ")]
            : []),
        ].filter((l): l is string => Boolean(l)),
      },
      {
        heading: "Style",
        lines: [
          p.name,
          ...(p.style ? [`${p.style.code} · ${p.style.name}`] : []),
          ...(p.category ? [p.category.name] : []),
          p.buyer ? `Made for ${p.buyer.name}` : "In-House, for our own stock",
        ],
      },
    ],
    blocks: [
      grid.length > 0
        ? gridTable(
            "Pieces per colour and size",
            grid.map((c) => ({ ...c, value: c.quantity })),
            (v) => formatAmount(v, 0, currency),
          )
        : {
            kind: "note",
            text: `${formatAmount(p.targetQuantity, 0, currency)} pieces in all; no colour and size breakdown is given.`,
          },
      {
        kind: "table",
        title: "Materials per piece",
        empty: "No materials per piece yet.",
        columns: [
          { label: "#", align: "right", weight: 0.45 },
          { label: "Material", weight: 4 },
          { label: "Per piece", align: "right", weight: 1.9 },
          { label: "How ordered", weight: 1.4 },
          { label: "For all pieces", align: "right", weight: 1.5 },
        ],
        rows: needs.map((n, i) => ({
          cells: [
            String(i + 1),
            `${n.placement ? `${n.placement}: ` : ""}${n.material.name}`,
            perPieceText(n),
            SPLIT_TEXT[n.split],
            materialQuantity(trimmed(n.total), n.material.unit, currency),
          ],
          details: [
            n.material.code,
            n.material.specification,
            n.material.color ? `Colour: ${n.material.color}` : null,
            n.notes,
          ].filter((l): l is string => Boolean(l)),
          image: n.imageId ?? undefined,
        })),
      },
      ...needs
        .filter((n) => n.split === "COLOUR_SIZE" && n.parts.some((pt) => pt.sizeName))
        .map((n): Block =>
          gridTable(
            `${n.placement ?? n.material.name}: ${n.material.name} by colour and size (${UNIT_LABELS[n.material.unit]})`,
            n.parts.map((pt) => ({
              colorName: pt.colorName ?? "",
              sizeName: pt.sizeName ?? "",
              value: pt.quantity,
            })),
            trimmed,
          ),
        ),
      ...extra,
      ...(notes?.trim()
        ? [
            {
              kind: "text" as const,
              title: "Making notes",
              paragraphs: notes.trim().split(/\r?\n/).filter(Boolean),
            },
          ]
        : []),
      {
        kind: "note",
        text: "Quantities for all pieces include the wastage. This tech pack carries no prices.",
      },
    ],
    signatures: ["Factory (name, signature & date)", "Production Manager"],
  };
  return model;
}

/** The tech pack's PDF for download (logged; nothing is kept). */
export async function techPackPdf(ctx: CompanyContext, projectId: string, meta?: RequestMeta) {
  checkRateLimit(`on-demand-print:${ctx.user.id}`, ON_DEMAND_PER_MINUTE, 60_000);
  const data = await getMaterialNeeds(ctx, projectId);
  const p = data.project;
  const model = techPackDocument(ctx, data, p.techPackNotes, await techPackExtraBlocks(ctx, p.id));
  const images = await loadMaterialImages(
    ctx.company.id,
    data.needs.map((n) => n.imageId),
  );
  const bytes = await renderOnDemand(ctx, model, images);
  await auditInCompany(ctx, meta, {
    action: "EXPORT",
    entityType: "ProductionProject",
    entityId: p.id,
    summary: `Made the tech pack of ${p.code} (${data.needs.length} material(s))`,
  });
  return { fileName: documentFileName(ctx.company.name, `Tech pack ${p.code} ${p.name}`), bytes };
}
