import type { GarmentCategory } from "@prisma/client";

import { env } from "@/lib/env";
import { formatAmount, formatDay } from "@/lib/format";
import { checkRateLimit } from "@/lib/rate-limit";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { bookFrame, downloadOrientation } from "@/modules/documents/book-frame";
import { letterheadOf } from "@/modules/documents/builders";
import {
  type Block,
  type Column,
  documentFileName,
  type Orientation,
  type PrintDocument,
  type Row,
} from "@/modules/documents/model";
import { ON_DEMAND_PER_MINUTE, renderOnDemand } from "@/modules/documents/on-demand";
import { canSeeMaterialCosts } from "@/modules/materials/access";
import { diaText, type LineSpecs, weightText } from "@/modules/production/booking-math";
import {
  CATEGORY_LABELS,
  CATEGORY_PRESETS,
  COLLAR_STYLE_LABELS,
  SOURCE_SHORT_LABELS,
  SOURCE_TITLES,
} from "@/modules/production/booking-presets";
import { type BookingDetail, getBooking } from "@/modules/production/booking.service";
import { revisionLabel } from "@/modules/production/booking-revisions";
import { splitTerm, termLines } from "@/modules/production/booking-terms";
import { loadMaterialImages } from "@/modules/production/material-image.service";
import { type SwatchRow, swatchListBlocks } from "@/modules/production/swatch-list";
import {
  ORDER_STATUS_LABELS,
  quantity as materialQuantity,
  UNIT_LABELS,
} from "@/components/materials/labels";

/*
 * A booking as the supplier gets it, in the book frame (documents/render.ts):
 * A4 Landscape or Portrait as the person picks when downloading, a blank strip
 * at the top for binding, the company's header and footer on every page with
 * "PAGE 2 OF 7", a QR code that opens the booking in the ERP, and the supplier's
 * initials at the foot of every page.
 * Then the fabric (or yarn) with its specification in columns of the garment
 * family (GSM and DIA for knitwear, width, construction and weight for woven,
 * count and gauge for sweaters), the trims, the collar and cuff matrix with
 * its measurements and sets, what each item is for by style (a booking on a
 * batch), the terms numbered in English or Bengali, four signatures, and the
 * fabric swatch list on a page of its own. Tables run on over as many pages as
 * they need, their header repeated and no row ever cut in two. People who may
 * not see material prices get it without prices. Made when asked for and not kept.
 */

type Booking = BookingDetail;
type Line = Booking["lines"][number];

const num = (n: number) => String(Number(n.toFixed(3)));

/** The fabric table's specification columns for each garment family. */
export const SPEC_COLUMNS: Record<
  GarmentCategory,
  Array<{ label: string; weight: number; value: (s: LineSpecs) => string }>
> = {
  KNITWEAR: [
    { label: "GSM", weight: 0.8, value: (s) => (s.weight ? num(s.weight) : "") },
    { label: "DIA", weight: 1, value: (s) => diaText(s) ?? "" },
  ],
  WOVEN: [
    { label: "Width", weight: 0.8, value: (s) => (s.width ? `${num(s.width)}"` : "") },
    { label: "Construction", weight: 1.5, value: (s) => s.construction ?? "" },
    { label: "Weight", weight: 1, value: (s) => weightText(s) ?? "" },
  ],
  OUTERWEAR: [
    { label: "Width", weight: 0.8, value: (s) => (s.width ? `${num(s.width)}"` : "") },
    { label: "Weight", weight: 1, value: (s) => weightText(s) ?? "" },
  ],
  SWEATER: [
    { label: "Count", weight: 1, value: (s) => s.yarnCount ?? "" },
    { label: "Gauge", weight: 0.8, value: (s) => (s.gauge ? `${num(s.gauge)} GG` : "") },
  ],
  OTHER: [
    { label: "Width", weight: 0.8, value: (s) => (s.width ? `${num(s.width)}"` : "") },
    { label: "Weight", weight: 1, value: (s) => weightText(s) ?? "" },
  ],
};

/** "For 6,000 pcs at 2.4 per dozen + 10% process loss" */
function calculatorNote(l: Line): string | null {
  const s = l.specs;
  if (!s.pieces || !s.perDozen) return null;
  return `For ${s.pieces.toLocaleString("en-US")} pcs at ${num(s.perDozen)} ${UNIT_LABELS[l.material.unit]} a dozen + ${num(s.lossPercent ?? 0)}% process loss`;
}

function priceColumns(show: boolean): Column[] {
  return show
    ? [
        { label: "Rate", align: "right", weight: 1.1 },
        { label: "Amount", align: "right", weight: 1.3 },
      ]
    : [];
}

function priceCells(l: Line, show: boolean, currency: string): string[] {
  if (!show) return [];
  if (l.priceLater) return ["At receive", "–"];
  return [
    l.unitPrice ? formatAmount(l.unitPrice, 2, currency) : "",
    l.amount ? formatAmount(l.amount, 2, currency) : "",
  ];
}

function fabricTable(b: Booking, lines: Line[], show: boolean, currency: string): Block {
  const preset = CATEGORY_PRESETS[b.category];
  const specs = SPEC_COLUMNS[b.category];
  const rows: Row[] = lines.map((l, i) => ({
    cells: [
      String(i + 1),
      `${l.material.name} (${l.material.code})`,
      l.specs.colour ?? l.material.color ?? "",
      ...specs.map((c) => c.value(l.specs)),
      materialQuantity(l.quantity, l.material.unit, currency),
      ...priceCells(l, show, currency),
    ],
    details: [
      [l.specs.fabricType, l.specs.composition, l.specs.finish].filter(Boolean).join(" · "),
      l.description,
      calculatorNote(l),
    ].filter((d): d is string => Boolean(d)),
    image: l.imageId ?? undefined,
  }));
  return {
    kind: "table",
    title: b.category === "SWEATER" ? "Yarn" : `Fabric · ${preset.fabricName.toLowerCase()}`,
    columns: [
      { label: "#", align: "right", weight: 0.4 },
      { label: b.category === "SWEATER" ? "Yarn" : "Fabric", weight: 3.2 },
      { label: "Colour", weight: 1.2 },
      ...specs.map((c) => ({ label: c.label, weight: c.weight })),
      { label: "Quantity", align: "right", weight: 1.4 },
      ...priceColumns(show),
    ],
    rows,
  };
}

function trimsTable(lines: Line[], first: number, show: boolean, currency: string): Block {
  return {
    kind: "table",
    title: "Trims & accessories",
    columns: [
      { label: "#", align: "right", weight: 0.4 },
      { label: "Item", weight: 3.6 },
      { label: "Colour", weight: 1.3 },
      { label: "Size / details", weight: 1.8 },
      { label: "Quantity", align: "right", weight: 1.4 },
      ...priceColumns(show),
    ],
    rows: lines.map((l, i) => ({
      cells: [
        String(first + i + 1),
        `${l.material.name} (${l.material.code})`,
        l.specs.colour ?? l.material.color ?? (l.role === "TRIM" ? "" : "As the matrix"),
        l.specs.size ?? "",
        materialQuantity(l.quantity, l.material.unit, currency),
        ...priceCells(l, show, currency),
      ],
      details: [
        l.role === "COLLAR"
          ? "Collar: by the colour and size matrix"
          : l.role === "CUFF"
            ? "Cuff: two a set, by the colour and size matrix"
            : null,
        l.description,
      ].filter((d): d is string => Boolean(d)),
      image: l.imageId ?? undefined,
    })),
  };
}

const grouped = (n: number) => n.toLocaleString("en-US");
const cm = (length: number | null, width: number | null) =>
  length !== null && width !== null ? `${num(length)} × ${num(width)} cm` : "—";

/** The collar and cuff part: style and extra, measurements, sets per colour and size group. */
export function collarBlocks(c: NonNullable<Booking["collar"]>): Block[] {
  const cuffed = c.sizes.some((s) => s.cuffLength !== null);
  return [
    {
      kind: "heading",
      title: "Collar & cuff matrix",
      subtitle: `${COLLAR_STYLE_LABELS[c.style]} collar${cuffed ? " and cuffs" : ""}, booked ${num(c.extraPercent)}% over the garment pieces${c.notes ? ` · ${c.notes}` : ""}`,
    },
    {
      kind: "figures",
      figures: [
        { label: "Collar style", value: COLLAR_STYLE_LABELS[c.style] },
        { label: "Garment pieces", value: grouped(c.totalPieces) },
        {
          label: "Collar sets",
          value: grouped(c.totalSets),
          hint: `${num(c.extraPercent)}% extra`,
        },
        ...(cuffed ? [{ label: "Cuffs", value: grouped(c.totalSets * 2), hint: "Two a set" }] : []),
      ],
    },
    {
      kind: "table",
      title: "Measurements (length × width)",
      columns: [
        { label: "Size group", weight: 1.4 },
        { label: "Collar", weight: 2 },
        ...(cuffed ? [{ label: "Cuff", weight: 2 }] : []),
        { label: "Garment pieces", align: "right", weight: 1.4 },
        { label: "Sets", align: "right", weight: 1.2 },
      ],
      rows: c.sizes.map((s, i) => ({
        cells: [
          s.label,
          cm(s.collarLength, s.collarWidth),
          ...(cuffed ? [cm(s.cuffLength, s.cuffWidth)] : []),
          grouped(c.piecesBySize[i] ?? 0),
          grouped(c.bySize[i] ?? 0),
        ],
      })),
    },
    {
      kind: "table",
      title: "Collar sets by colour and size group",
      columns: [
        { label: "Garment colour", weight: 2 },
        { label: "Collar colour", weight: 2.2 },
        ...c.sizes.map((s) => ({ label: s.label, align: "right" as const, weight: 1 })),
        { label: "Total", align: "right", weight: 1.1 },
      ],
      rows: [
        ...c.colours.map((col, i) => ({
          cells: [
            col.garmentColour,
            col.tippingColour
              ? `${col.collarColour}, tipping ${col.tippingColour}`
              : col.collarColour,
            ...col.sets.map((n) => (n ? grouped(n) : "–")),
            grouped(c.byColour[i] ?? 0),
          ],
          details: [`${grouped(col.pieces.reduce((t, n) => t + n, 0))} garment pieces`],
        })),
        {
          cells: ["Garment pieces", "", ...c.piecesBySize.map(grouped), grouped(c.totalPieces)],
          style: "subtotal" as const,
        },
        {
          cells: ["Sets to knit", "", ...c.bySize.map(grouped), grouped(c.totalSets)],
          style: "total" as const,
        },
      ],
    },
  ];
}

/** Each item's shares by style and colour, for a booking on a master batch. */
function styleBlocks(lines: Line[], currency: string): Block[] {
  const rows: Row[] = [];
  for (const l of lines) {
    const byStyleColour = new Map<string, { style: string; colour: string; quantity: number }>();
    for (const sh of l.shares) {
      const key = `${sh.project.id}|${sh.colorName ?? ""}`;
      const row = byStyleColour.get(key) ?? {
        style: `${sh.project.code} · ${sh.project.name}`,
        colour: sh.colorName ?? "All colours",
        quantity: 0,
      };
      row.quantity += Number(sh.quantity);
      byStyleColour.set(key, row);
    }
    for (const [i, r] of [...byStyleColour.values()].entries()) {
      rows.push({
        cells: [
          i === 0 ? `${l.material.name} (${l.material.code})` : "",
          r.style,
          r.colour,
          materialQuantity(num(r.quantity), l.material.unit, currency),
        ],
      });
    }
  }
  if (rows.length === 0) return [];
  return [
    {
      kind: "table",
      title: "What each item is for, by style",
      columns: [
        { label: "Item", weight: 2.8 },
        { label: "Style", weight: 2.8 },
        { label: "Colour", weight: 1.4 },
        { label: "Quantity", align: "right", weight: 1.4 },
      ],
      rows,
    },
  ];
}

/** The swatch list's rows: each fabric line by style and colour on a batch, else by its colour. */
function swatchRows(fabric: Line[]): SwatchRow[] {
  const rows: SwatchRow[] = [];
  for (const l of fabric) {
    const name = l.specs.colour ?? l.material.color ?? l.material.name;
    if (l.shares.length === 0) {
      rows.push({ label: name, quantity: Number(l.quantity), unit: l.material.unit });
      continue;
    }
    const byStyle = new Map<string, SwatchRow>();
    for (const sh of l.shares) {
      const label = `${sh.project.code} · ${sh.colorName ?? name}`;
      const row = byStyle.get(label) ?? { label, quantity: 0, unit: l.material.unit };
      row.quantity += Number(sh.quantity);
      byStyle.set(label, row);
    }
    rows.push(...byStyle.values());
  }
  return rows;
}

/**
 * A revision's changes from the one before (R1 from R0), so the supplier sees
 * what to change: each item as it was and as it is now.
 */
function changeBlocks(b: Booking): Block[] {
  if (b.revision === 0 || !b.changes || b.changes.changes.length === 0) return [];
  return [
    {
      kind: "table",
      title: `Changes from ${revisionLabel(b.changes.from)}`,
      columns: [
        { label: "What changed", weight: 3 },
        { label: "Was", weight: 2.2 },
        { label: "Now", weight: 2.2 },
      ],
      rows: b.changes.changes.map((c) => ({ cells: [c.item, c.was, c.now] })),
    },
    {
      kind: "note",
      text: `This is revision ${b.revisionLabel} of ${b.number}. It replaces ${revisionLabel(b.changes.from)}: please work to this one.`,
    },
  ];
}

/** The booking's link in the ERP, for its QR code. */
export const bookingLink = (bookingId: string) =>
  `${env.APP_URL.replace(/\/+$/, "")}/production/bookings/${encodeURIComponent(bookingId)}`;

export function bookingDocument(
  ctx: CompanyContext,
  b: Booking,
  options: { link?: string; orientation?: Orientation } = {},
): PrintDocument {
  const currency = ctx.company.currency;
  const show = canSeeMaterialCosts(ctx);
  const fabric = b.lines.filter((l) => l.role === "FABRIC");
  const trims = b.lines.filter((l) => l.role !== "FABRIC");
  const later = b.lines.filter((l) => l.priceLater).length;
  const fabricTotals = new Map<string, number>();
  for (const l of fabric) {
    fabricTotals.set(
      l.material.unit,
      (fabricTotals.get(l.material.unit) ?? 0) + Number(l.quantity),
    );
  }
  const bengali = b.termsLanguage === "BN";
  const terms = termLines(b.terms).map(splitTerm);
  const supplier = b.supplier;
  const deliverTo = b.deliveryPlace?.trim()
    ? b.deliveryPlace.split(/\r?\n/)
    : [ctx.company.name, ...(ctx.company.address ? ctx.company.address.split(/\r?\n/) : [])];
  const sourceTitle = SOURCE_TITLES[b.source];
  const parties = [
    {
      heading: b.source === "MARKET_PURCHASE" ? "Seller" : "Supplier",
      lines: [
        supplier.name,
        supplier.contactPerson,
        supplier.phone,
        [supplier.address, supplier.city].filter(Boolean).join(", "),
      ].filter((l): l is string => Boolean(l)),
    },
    { heading: "Deliver to", lines: deliverTo },
    {
      heading: "Booked for",
      lines: [
        b.batch ? `${b.batch.name} (${b.batch.code})` : (b.title ?? "Raw material stock"),
        b.styleRef ? `Styles: ${b.styleRef}` : null,
        b.garmentPieces ? `${grouped(b.garmentPieces)} garment pieces` : null,
      ].filter((l): l is string => Boolean(l)),
    },
  ];
  const details = [
    `Source: ${SOURCE_SHORT_LABELS[b.source]}`,
    `Garment: ${CATEGORY_LABELS[b.category]}`,
    b.supplierRef ? `Your ref.: ${b.supplierRef}` : null,
    b.batch ? `Master batch: ${b.batch.code}` : null,
    b.status !== "OPEN" ? `Status: ${ORDER_STATUS_LABELS[b.status]}` : null,
  ].filter((d): d is string => Boolean(d));
  const blocks: Block[] = [
    {
      kind: "section",
      title: `${sourceTitle} · ${supplier.name}`,
      label: `${b.source === "MARKET_PURCHASE" ? "Market purchase" : "Booking"} · ${b.docNo}`,
      subtitle: b.title ?? undefined,
    },
    { kind: "parties", parties },
    { kind: "note", text: details.join(" · ") },
    ...changeBlocks(b),
    {
      kind: "figures",
      figures: [
        ...[...fabricTotals].map(([unit, total]) => ({
          label: b.category === "SWEATER" ? "Yarn" : "Fabric",
          value: materialQuantity(num(total), unit as Line["material"]["unit"], currency),
        })),
        { label: "Items", value: String(b.lines.length) },
        ...(b.collar ? [{ label: "Collar sets", value: grouped(b.collar.totalSets) }] : []),
        {
          label: "Deliver by",
          value: b.expectedDate ? formatDay(b.expectedDate) : "As agreed",
        },
      ].slice(0, 4),
    },
    ...(fabric.length > 0 ? [fabricTable(b, fabric, show, currency)] : []),
    ...(trims.length > 0 ? [trimsTable(trims, fabric.length, show, currency)] : []),
    ...(show && b.totalAmount
      ? [
          {
            kind: "totals" as const,
            rows: [
              {
                label: later > 0 ? "Total of the priced items" : "Total",
                value: formatAmount(b.totalAmount, 2, currency),
                strong: true,
              },
            ],
          },
        ]
      : []),
    ...(later > 0
      ? [
          {
            kind: "note" as const,
            text: `${later === 1 ? "One item is" : `${later} items are`} priced at receive: the price is agreed when the goods arrive and goes on your bill.`,
          },
        ]
      : []),
    ...(b.paymentTerms?.trim() || b.deliveryPlace?.trim()
      ? [
          {
            kind: "list" as const,
            title: "Commercial terms",
            items: [
              ...(b.paymentTerms?.trim()
                ? [{ label: "Payment", text: b.paymentTerms.trim() }]
                : []),
              ...(b.deliveryPlace?.trim()
                ? [{ label: "Delivery place", text: b.deliveryPlace.trim().replace(/\s+/g, " ") }]
                : []),
            ],
          },
        ]
      : []),
    ...(b.notes?.trim()
      ? [{ kind: "text" as const, title: "Notes", paragraphs: b.notes.trim().split(/\r?\n/) }]
      : []),
    ...(b.collar ? [{ kind: "pageBreak" as const }, ...collarBlocks(b.collar)] : []),
    ...styleBlocks(b.lines, currency),
    {
      kind: "list",
      title: bengali ? "শর্তাবলি · Terms & conditions" : "Terms & conditions",
      numbered: true,
      items: terms.map((t) => (t.heading ? { label: t.heading, text: t.text } : { text: t.text })),
    },
    {
      kind: "signatures",
      labels: [
        "Prepared by",
        "Merchandiser",
        "Authorised signature",
        b.source === "MARKET_PURCHASE" ? "Seller (sign & seal)" : "Supplier (sign & seal)",
      ],
    },
    ...swatchListBlocks(supplier.name, swatchRows(fabric), currency),
  ];
  // The order the goods are for: the master batch, else the styles named on the booking.
  const order = b.batch?.code ?? b.styleRef ?? "";
  return {
    type: "BOOKING",
    title: sourceTitle,
    subtitle: [supplier.name, b.title].filter(Boolean).join(" · "),
    reference: b.docNo,
    letterhead: letterheadOf(ctx.company),
    stamp:
      b.status === "CANCELLED"
        ? { text: "Cancelled", tone: "danger" }
        : b.status === "CLOSED"
          ? { text: "Closed", tone: "success" }
          : b.stage === "DRAFT"
            ? { text: "Draft", tone: "danger" }
            : undefined,
    meta: [
      { label: "Booking no.", value: b.docNo },
      { label: "Date", value: formatDay(b.orderDate) },
      ...(b.expectedDate ? [{ label: "Deliver by", value: formatDay(b.expectedDate) }] : []),
      { label: "Source", value: SOURCE_SHORT_LABELS[b.source] },
      { label: "Garment", value: CATEGORY_LABELS[b.category] },
      ...(b.supplierRef ? [{ label: "Your ref.", value: b.supplierRef }] : []),
      ...(b.batch ? [{ label: "Master batch", value: b.batch.code }] : []),
      ...(b.status !== "OPEN" ? [{ label: "Status", value: ORDER_STATUS_LABELS[b.status] }] : []),
    ],
    // The parties print inside the first part (blocks), under its title.
    parties: [],
    blocks,
    signatures: [],
    qr: options.link ? { data: options.link, caption: "Scan to open the booking" } : undefined,
    initials: b.source === "MARKET_PURCHASE" ? "Seller's initials" : "Supplier's initials",
    // The buyer is not named on a supplier's copy: the order reference only.
    frame: bookFrame(ctx.company, {
      orientation: options.orientation ?? "landscape",
      docNo: b.docNo,
      buyerPo: order,
      date: formatDay(b.orderDate),
      // PREPARED BY: whoever made the booking, with a line beside it to sign.
      preparedBy: b.createdBy?.name ?? null,
    }),
  };
}

/**
 * The booking's PDF for download (logged; nothing is kept), Landscape or
 * Portrait as asked (kept as this person's pick), else as they last printed.
 */
export async function bookingPdf(
  ctx: CompanyContext,
  bookingId: string,
  meta?: RequestMeta,
  asked?: string | null,
) {
  checkRateLimit(`on-demand-print:${ctx.user.id}`, ON_DEMAND_PER_MINUTE, 60_000);
  const b = await getBooking(ctx, bookingId);
  const orientation = await downloadOrientation(ctx, asked);
  const model = bookingDocument(ctx, b, { link: bookingLink(b.id), orientation });
  const images = await loadMaterialImages(
    ctx.company.id,
    b.lines.map((l) => l.imageId),
  );
  const bytes = await renderOnDemand(ctx, model, images);
  await auditInCompany(ctx, meta, {
    action: "EXPORT",
    entityType: "Booking",
    entityId: b.id,
    summary: `Printed booking ${b.docNo}${b.stage === "DRAFT" ? " (draft)" : ""} to ${b.supplier.name} (${orientation})`,
  });
  return {
    fileName: documentFileName(ctx.company.name, `Booking ${b.docNo} ${b.supplier.name}`),
    bytes,
    orientation,
  };
}
