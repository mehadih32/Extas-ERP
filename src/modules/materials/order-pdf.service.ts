import { Prisma } from "@prisma/client";

import { formatAmount, formatDay } from "@/lib/format";
import { checkRateLimit } from "@/lib/rate-limit";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { letterheadOf, sizeOrderOf } from "@/modules/documents/builders";
import { type Block, documentFileName, type PrintDocument } from "@/modules/documents/model";
import { ON_DEMAND_PER_MINUTE, renderOnDemand } from "@/modules/documents/on-demand";
import { canSeeMaterialCosts } from "@/modules/materials/access";
import { getPurchaseOrder } from "@/modules/materials/purchase-order.service";
import { loadMaterialImages } from "@/modules/production/material-image.service";
import { gridTable } from "@/modules/production/tech-pack.service";
import {
  ORDER_STATUS_LABELS,
  quantity as materialQuantity,
  UNIT_LABELS,
} from "@/components/materials/labels";

/*
 * A purchase order as the supplier gets it, on the letterhead: its lines with
 * their pictures and prices (or "At receive" for a price agreed on arrival),
 * then for an order made for a master batch each line's style-wise breakdown,
 * and the colour × size matrix of every line ordered by colour and size
 * (collars and cuffs), each on a page of its own. People who may not see
 * material prices get it without prices. Made when asked for and not kept.
 */

type Order = Awaited<ReturnType<typeof getPurchaseOrder>>;
type Line = Order["lines"][number];

const trimmed = (d: Prisma.Decimal) => d.toFixed(3).replace(/\.?0+$/, "") || "0";

/** Each line's shares by style: a table per line, with the colour when it is split by colour. */
function breakdownBlocks(lines: Line[], currency: string): Block[] {
  const blocks: Block[] = [];
  for (const [i, line] of lines.entries()) {
    if (line.shares.length === 0) continue;
    const unit = line.material.unit;
    const byStyleColour = new Map<
      string,
      { style: string; colour: string; quantity: Prisma.Decimal }
    >();
    for (const sh of line.shares) {
      const key = `${sh.project.id}|${sh.colorName ?? ""}`;
      const row = byStyleColour.get(key) ?? {
        style: `${sh.project.code} · ${sh.project.name}`,
        colour: sh.colorName ?? "All colours",
        quantity: new Prisma.Decimal(0),
      };
      row.quantity = row.quantity.plus(sh.quantity);
      byStyleColour.set(key, row);
    }
    const rows = [...byStyleColour.values()];
    blocks.push({
      kind: "table",
      title: `Line ${i + 1}: ${line.material.code} ${line.material.name} by style`,
      columns: [
        { label: "Style", weight: 4 },
        { label: "Colour", weight: 2 },
        { label: "Quantity", align: "right", weight: 1.6 },
      ],
      rows: [
        ...rows.map((r) => ({
          cells: [r.style, r.colour, materialQuantity(trimmed(r.quantity), unit, currency)],
        })),
        {
          cells: ["Total", "", materialQuantity(trimmed(line.quantity), unit, currency)],
          style: "total" as const,
        },
      ],
    });
  }
  return blocks;
}

/** A page per line and style ordered by colour and size: its colour × size matrix. */
function matrixBlocks(lines: Line[], sizeRank: (size: string) => number): Block[] {
  const blocks: Block[] = [];
  for (const [i, line] of lines.entries()) {
    const sized = line.shares.filter((sh) => sh.sizeName && sh.colorName);
    if (sized.length === 0) continue;
    const styles = [...new Map(sized.map((sh) => [sh.project.id, sh.project])).values()];
    blocks.push(
      { kind: "pageBreak" },
      {
        kind: "heading",
        title: `${line.material.name}: colour and size matrix`,
        subtitle: `Line ${i + 1} · ${line.material.code}${line.description ? ` · ${line.description}` : ""} · in ${UNIT_LABELS[line.material.unit]}`,
      },
    );
    for (const style of styles) {
      const cells = sized
        .filter((sh) => sh.project.id === style.id)
        .sort((a, b) => sizeRank(a.sizeName!) - sizeRank(b.sizeName!))
        .map((sh) => ({ colorName: sh.colorName!, sizeName: sh.sizeName!, value: sh.quantity }));
      blocks.push(gridTable(`${style.code} · ${style.name}`, cells, trimmed));
    }
  }
  return blocks;
}

export function purchaseOrderDocument(
  ctx: CompanyContext,
  o: Order,
  sizeRank: (size: string) => number,
): PrintDocument {
  const currency = ctx.company.currency;
  const showPrices = canSeeMaterialCosts(ctx);
  const later = o.lines.filter((l) => l.priceLater);
  const priceText = (l: Line) =>
    l.priceLater ? "At receive" : l.unitPrice ? formatAmount(l.unitPrice, 2, currency) : "";
  return {
    type: "PURCHASE_ORDER",
    title: "Purchase Order",
    subtitle: o.supplier.name,
    reference: o.number,
    letterhead: letterheadOf(ctx.company),
    stamp: o.status === "CANCELLED" ? { text: "Cancelled", tone: "danger" } : undefined,
    meta: [
      { label: "Order no.", value: o.number },
      { label: "Date", value: formatDay(o.orderDate) },
      ...(o.expectedDate ? [{ label: "Deliver by", value: formatDay(o.expectedDate) }] : []),
      ...(o.supplierRef ? [{ label: "Your ref.", value: o.supplierRef }] : []),
      ...(o.batch ? [{ label: "Master batch", value: o.batch.code }] : []),
      ...(o.project ? [{ label: "Project", value: o.project.code }] : []),
      ...(o.status !== "OPEN" ? [{ label: "Status", value: ORDER_STATUS_LABELS[o.status] }] : []),
    ],
    parties: [
      {
        heading: "Supplier",
        lines: [o.supplier.name, o.supplier.phone].filter((l): l is string => Boolean(l)),
      },
      {
        heading: "Ordered for",
        lines: o.batch
          ? [o.batch.name, o.batch.code]
          : o.project
            ? [o.project.name, o.project.code]
            : ["Raw material stock"],
      },
    ],
    blocks: [
      {
        kind: "table",
        columns: [
          { label: "#", align: "right", weight: 0.45 },
          { label: "Material", weight: 4 },
          { label: "Quantity", align: "right", weight: 1.5 },
          ...(showPrices
            ? [
                { label: "Unit price", align: "right" as const, weight: 1.3 },
                { label: "Amount", align: "right" as const, weight: 1.4 },
              ]
            : []),
        ],
        rows: o.lines.map((l, i) => ({
          cells: [
            String(i + 1),
            `${l.material.code} · ${l.material.name}`,
            materialQuantity(trimmed(l.quantity), l.material.unit, currency),
            ...(showPrices
              ? [
                  priceText(l),
                  l.priceLater || !l.amount ? "–" : formatAmount(l.amount, 2, currency),
                ]
              : []),
          ],
          details: [
            l.description,
            l.shares.length > 0
              ? `For ${[...new Set(l.shares.map((sh) => sh.project.code))].join(", ")}`
              : null,
          ].filter((d): d is string => Boolean(d)),
          image: l.imageId ?? undefined,
        })),
      },
      ...(showPrices && o.totalAmount
        ? [
            {
              kind: "totals" as const,
              rows: [
                {
                  label: later.length > 0 ? "Total of the priced lines" : "Total",
                  value: formatAmount(o.totalAmount, 2, currency),
                  strong: true,
                },
              ],
            },
          ]
        : []),
      ...(later.length > 0
        ? [
            {
              kind: "note" as const,
              text: `${later.length === 1 ? "One line is" : `${later.length} lines are`} priced at receive: the price is agreed when the goods arrive and goes on your bill.`,
            },
          ]
        : []),
      ...(o.notes?.trim()
        ? [{ kind: "text" as const, title: "Notes", paragraphs: o.notes.trim().split(/\r?\n/) }]
        : []),
      {
        kind: "list",
        title: "Terms",
        items: [
          { text: "Quote this order number on your challan and bill." },
          {
            text: "The goods are counted and weighed on arrival; short quantities and faults are taken off the bill.",
          },
          ...(o.lines.some((l) => l.shares.some((sh) => sh.sizeName))
            ? [
                {
                  text: "Knit collars and cuffs to the colour and size matrix on the following pages.",
                },
              ]
            : []),
        ],
      },
      ...(o.lines.some((l) => l.shares.length > 0)
        ? [
            { kind: "pageBreak" as const },
            {
              kind: "heading" as const,
              title: "Style-wise breakdown",
              subtitle: "What each line is for, by style and garment colour",
            },
            ...breakdownBlocks(o.lines, currency),
          ]
        : []),
      ...matrixBlocks(o.lines, sizeRank),
    ],
    signatures: ["Supplier (name, signature & date)", "Authorised signature"],
  };
}

/** The order's PDF for download (logged; nothing is kept). */
export async function purchaseOrderPdf(ctx: CompanyContext, orderId: string, meta?: RequestMeta) {
  checkRateLimit(`on-demand-print:${ctx.user.id}`, ON_DEMAND_PER_MINUTE, 60_000);
  const [o, sizeOrder] = await Promise.all([getPurchaseOrder(ctx, orderId), sizeOrderOf(ctx)]);
  const rank = (size: string) => sizeOrder.get(size.toUpperCase()) ?? Number.MAX_SAFE_INTEGER;
  const model = purchaseOrderDocument(ctx, o, rank);
  const images = await loadMaterialImages(
    ctx.company.id,
    o.lines.map((l) => l.imageId),
  );
  const bytes = await renderOnDemand(ctx, model, images);
  await auditInCompany(ctx, meta, {
    action: "EXPORT",
    entityType: "PurchaseOrder",
    entityId: o.id,
    summary: `Printed purchase order ${o.number} to ${o.supplier.name}`,
  });
  return {
    fileName: documentFileName(ctx.company.name, `Purchase order ${o.number} ${o.supplier.name}`),
    bytes,
  };
}
