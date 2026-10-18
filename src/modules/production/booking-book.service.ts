import type { BookingStage, MeasurementUnit } from "@prisma/client";

import { localDay } from "@/lib/dates";
import { formatDay } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { bookFrame, downloadOrientation } from "@/modules/documents/book-frame";
import { letterheadOf } from "@/modules/documents/builders";
import {
  type Block,
  documentFileName,
  type Orientation,
  type PrintDocument,
  type Row,
} from "@/modules/documents/model";
import { ON_DEMAND_PER_MINUTE, renderBookOnDemand } from "@/modules/documents/on-demand";
import type { PartPages } from "@/modules/documents/render";
import { batchMaterialPlan } from "@/modules/production/batch-orders.service";
import { specsText } from "@/modules/production/booking-math";
import { collarBlocks } from "@/modules/production/booking-pdf.service";
import { STAGE_LABELS } from "@/modules/production/booking-revisions";
import { batchBookingDetails, type BookingDetail } from "@/modules/production/booking.service";
import { styleGrids } from "@/modules/production/material-need.service";
import { type SwatchRow, swatchListBlocks } from "@/modules/production/swatch-list";
import { colourCode, styleCode } from "@/modules/production/tech-pack";
import { quantity as materialQuantity } from "@/components/materials/labels";

/*
 * A master batch's booking book: one PDF with every booking made for it, in
 * the book frame (Landscape or Portrait). Its cover lists who gets which part
 * and on which pages; then the order (each style with a code, A, B..., and
 * each of its colours, A-01, A-02..., by size), the fabric booked from each
 * mill (FS-1, FS-2) by style and colour, the collar and cuff matrices, the
 * trims from each supplier (TS-1...), the summary that checks what is booked
 * against what the styles need, the sign-off page and a swatch list for each
 * mill's fabric. It carries no prices. Made when asked for and not kept.
 */

type Line = BookingDetail["lines"][number];

const num = (n: number) => String(Number(n.toFixed(3)));
const grouped = (n: number) => n.toLocaleString("en-US");

/** A style of the batch as the book names it. */
export type BookStyle = {
  id: string;
  /** "A" */
  letter: string;
  code: string;
  name: string;
  buyer: string | null;
  pieces: number;
  /** Its colours in order, each with its code ("A-01"). */
  colours: Array<{ code: string; name: string }>;
  sizes: string[];
  /** Pieces by "colour|size". */
  grid: Map<string, number>;
};

export type BookData = {
  batch: { id: string; code: string; name: string };
  styles: BookStyle[];
  bookings: BookingDetail[];
  /** What the open styles need of each material, and what is booked of it. */
  plan: Array<{
    code: string;
    name: string;
    unit: MeasurementUnit;
    needed: string;
    toOrder: string;
  }>;
  today: string;
  currency: string;
};

/** A part of the book that goes to someone, for the cover's distribution list. */
type Part = {
  key: string;
  recipient: string;
  part: string;
  bookings: BookingDetail[];
  blocks: Block[];
};

const stageText = (bookings: BookingDetail[]) => {
  const stages = [...new Set(bookings.map((b) => b.stage))] as BookingStage[];
  return stages.map((s) => STAGE_LABELS[s]).join(", ") || "—";
};

const docNos = (bookings: BookingDetail[]) => bookings.map((b) => b.docNo).join(", ");

const inHouse = (bookings: BookingDetail[]) => {
  const days = bookings.map((b) => b.expectedDate).filter((d): d is string => Boolean(d));
  return days.length > 0 ? formatDay(days.sort()[0]!) : "Not set";
};

/** "A-01 · Navy" for a share of a style's colour; "A · All colours" when not split by colour. */
function shareLabel(styles: Map<string, BookStyle>, projectId: string, colour: string | null) {
  const style = styles.get(projectId);
  if (!style) return colour ?? "All colours";
  if (!colour) return `${style.letter} · All colours`;
  const found = style.colours.find((c) => c.name === colour);
  return `${found?.code ?? style.letter} · ${colour}`;
}

/** A line's quantity by style and colour (sizes added up), in the order they appear. */
function byStyleColour(line: Line, styles: Map<string, BookStyle>) {
  const out = new Map<string, number>();
  for (const s of line.shares) {
    const label = shareLabel(styles, s.project.id, s.colorName);
    // Three decimals at most, so adding in thousandths stays exact.
    out.set(label, Math.round(((out.get(label) ?? 0) + Number(s.quantity)) * 1000) / 1000);
  }
  return [...out];
}

function totalsByUnit(rows: Array<{ unit: MeasurementUnit; quantity: number }>, currency: string) {
  const byUnit = new Map<MeasurementUnit, number>();
  for (const r of rows) byUnit.set(r.unit, (byUnit.get(r.unit) ?? 0) + r.quantity);
  return [...byUnit]
    .map(([unit, total]) => materialQuantity(num(total), unit, currency))
    .join(" + ");
}

/** Groups the batch's bookings' lines by supplier, suppliers in the order first booked. */
function bySupplier(bookings: BookingDetail[], fabric: boolean) {
  const out = new Map<
    string,
    { name: string; lines: Array<{ booking: BookingDetail; line: Line }> }
  >();
  for (const b of bookings) {
    for (const l of b.lines) {
      if ((l.role === "FABRIC") !== fabric) continue;
      const group = out.get(b.supplier.id) ?? { name: b.supplier.name, lines: [] };
      group.lines.push({ booking: b, line: l });
      out.set(b.supplier.id, group);
    }
  }
  return [...out];
}

const uniqueBookings = (lines: Array<{ booking: BookingDetail }>) => [
  ...new Map(lines.map((l) => [l.booking.id, l.booking])).values(),
];

const draftNote = (bookings: BookingDetail[]) =>
  bookings.some((b) => b.stage === "DRAFT") ? " · Draft: approve before sending" : "";

/** The order: each style with its code, its colours with theirs, by size. */
function orderBlocks(data: BookData): Block[] {
  const blocks: Block[] = [
    {
      kind: "table",
      title: "Styles",
      columns: [
        { label: "Code", weight: 0.6 },
        { label: "Style", weight: 3 },
        { label: "Buyer", weight: 2 },
        { label: "Colours", weight: 3 },
        { label: "Pieces", align: "right", weight: 1 },
      ],
      rows: [
        ...data.styles.map((s) => ({
          cells: [
            s.letter,
            `${s.code} · ${s.name}`,
            s.buyer ?? "In-house",
            s.colours.map((c) => `${c.code} ${c.name}`).join(", ") || "One colour",
            grouped(s.pieces),
          ],
        })),
        {
          cells: ["", "Total", "", "", grouped(data.styles.reduce((t, s) => t + s.pieces, 0))],
          style: "total" as const,
        },
      ],
    },
  ];
  for (const s of data.styles) {
    if (s.colours.length === 0) continue;
    const rows: Row[] = s.colours.map((c) => {
      const cells = s.sizes.map((size) => s.grid.get(`${c.name}|${size}`) ?? 0);
      return {
        cells: [
          c.code,
          c.name,
          ...cells.map((n) => (n ? grouped(n) : "–")),
          grouped(cells.reduce((t, n) => t + n, 0)),
        ],
      };
    });
    const bySize = s.sizes.map((size) =>
      s.colours.reduce((t, c) => t + (s.grid.get(`${c.name}|${size}`) ?? 0), 0),
    );
    rows.push({
      cells: ["", "Total", ...bySize.map(grouped), grouped(bySize.reduce((t, n) => t + n, 0))],
      style: "total",
    });
    blocks.push({
      kind: "table",
      title: `${s.letter} · ${s.code} ${s.name}: pieces by colour and size`,
      columns: [
        { label: "Code", weight: 0.8 },
        { label: "Colour", weight: 1.8 },
        ...s.sizes.map((size) => ({ label: size, align: "right" as const, weight: 0.8 })),
        { label: "Total", align: "right", weight: 1 },
      ],
      rows,
    });
  }
  return blocks;
}

function fabricPart(
  data: BookData,
  styles: Map<string, BookStyle>,
  supplierId: string,
  group: { name: string; lines: Array<{ booking: BookingDetail; line: Line }> },
  n: number,
): Part {
  const bookings = uniqueBookings(group.lines);
  const rows: Row[] = [];
  const totals: Array<{ unit: MeasurementUnit; quantity: number }> = [];
  group.lines.forEach(({ booking, line }, i) => {
    const spec = [line.specs.colour, specsText(line.specs, booking.category)]
      .filter(Boolean)
      .join(" · ");
    const shares = byStyleColour(line, styles);
    const parts = shares.length > 0 ? shares : [["Not shared out", Number(line.quantity)] as const];
    parts.forEach(([label, quantity], j) => {
      rows.push({
        cells: [
          j === 0 ? String(i + 1) : "",
          j === 0 ? booking.docNo : "",
          j === 0 ? `${line.material.name} (${line.material.code})` : "",
          j === 0 ? spec : "",
          label,
          materialQuantity(num(quantity), line.material.unit, data.currency),
        ],
      });
    });
    totals.push({ unit: line.material.unit, quantity: Number(line.quantity) });
  });
  rows.push({
    cells: ["", "", `Total ${group.name}`, "", "", totalsByUnit(totals, data.currency)],
    style: "total",
  });
  return {
    key: `fabric:${supplierId}`,
    recipient: group.name,
    part: `Fabric · FS-${n}`,
    bookings,
    blocks: [
      {
        kind: "section",
        key: `fabric:${supplierId}`,
        title: `Fabric booking · ${group.name}`,
        label: `Fabric · FS-${n}`,
        subtitle: `${docNos(bookings)} · in-house by ${inHouse(bookings)}${draftNote(bookings)}`,
      },
      {
        kind: "table",
        title: "Fabric by style and colour",
        columns: [
          { label: "#", align: "right", weight: 0.4 },
          { label: "Booking", weight: 1.7 },
          { label: "Fabric", weight: 2.6 },
          { label: "Specification", weight: 2.4 },
          { label: "Style · colour", weight: 1.8 },
          { label: "Quantity", align: "right", weight: 1.3 },
        ],
        rows,
      },
    ],
  };
}

function collarPart(b: BookingDetail): Part | null {
  if (!b.collar) return null;
  const [heading, ...blocks] = collarBlocks(b.collar);
  return {
    key: `collar:${b.id}`,
    recipient: b.supplier.name,
    part: `Collar & cuff · ${b.docNo}`,
    bookings: [b],
    blocks: [
      {
        kind: "section",
        key: `collar:${b.id}`,
        title: `Collar & cuff · ${b.supplier.name}`,
        label: `Collar & cuff · ${b.docNo}`,
        subtitle: `${heading?.kind === "heading" ? (heading.subtitle ?? "") : ""} · in-house by ${inHouse([b])}${draftNote([b])}`,
      },
      ...blocks,
    ],
  };
}

function trimsPart(
  data: BookData,
  styles: Map<string, BookStyle>,
  supplierId: string,
  group: { name: string; lines: Array<{ booking: BookingDetail; line: Line }> },
  n: number,
): Part {
  const bookings = uniqueBookings(group.lines);
  return {
    key: `trims:${supplierId}`,
    recipient: group.name,
    part: `Trims · TS-${n}`,
    bookings,
    blocks: [
      {
        kind: "section",
        key: `trims:${supplierId}`,
        title: `Trims & accessories · ${group.name}`,
        label: `Trims · TS-${n}`,
        subtitle: `${docNos(bookings)} · in-house by ${inHouse(bookings)}${draftNote(bookings)}`,
      },
      {
        kind: "table",
        title: "Trims & accessories",
        columns: [
          { label: "#", align: "right", weight: 0.4 },
          { label: "Booking", weight: 1.7 },
          { label: "Item", weight: 2.8 },
          { label: "Colour", weight: 1.3 },
          { label: "Size / details", weight: 1.6 },
          { label: "For", weight: 2 },
          { label: "Quantity", align: "right", weight: 1.3 },
        ],
        rows: group.lines.map(({ booking, line }, i) => ({
          cells: [
            String(i + 1),
            booking.docNo,
            `${line.material.name} (${line.material.code})`,
            line.specs.colour ??
              line.material.color ??
              (line.role === "TRIM" ? "" : "As the matrix"),
            line.specs.size ?? "",
            byStyleColour(line, styles)
              .map(([label]) => label.split(" · ")[0])
              .filter((v, j, all) => all.indexOf(v) === j)
              .join(", ") || "All",
            materialQuantity(line.quantity, line.material.unit, data.currency),
          ],
          details: [line.description].filter((d): d is string => Boolean(d)),
        })),
      },
    ],
  };
}

/** What is booked against what the styles need, and where each booking stands. */
function summaryBlocks(data: BookData): Block[] {
  return [
    {
      kind: "section",
      key: "summary",
      title: "Summary & reconciliation",
      label: "Summary",
      subtitle: "What is booked against what the styles need, and where each booking stands.",
    },
    {
      kind: "table",
      title: "Needed and booked",
      empty: "No materials per piece on the batch's open styles.",
      columns: [
        { label: "Material", weight: 3.2 },
        { label: "Needed", align: "right", weight: 1.4 },
        { label: "Booked", align: "right", weight: 1.4 },
        { label: "Check", weight: 1.6 },
      ],
      rows: data.plan.map((m) => {
        const short = Number(m.toOrder);
        const booked = Number(m.needed) - short;
        return {
          cells: [
            `${m.name} (${m.code})`,
            materialQuantity(m.needed, m.unit, data.currency),
            materialQuantity(num(booked), m.unit, data.currency),
            short > 0 ? `Short ${materialQuantity(m.toOrder, m.unit, data.currency)}` : "OK",
          ],
        };
      }),
    },
    {
      kind: "table",
      title: "Bookings",
      columns: [
        { label: "Booking", weight: 1.8 },
        { label: "Supplier", weight: 2.6 },
        { label: "Items", align: "right", weight: 0.8 },
        { label: "In-house date", weight: 1.4 },
        { label: "Stage", weight: 1.2 },
      ],
      rows: data.bookings.map((b) => ({
        cells: [
          b.docNo,
          b.supplier.name,
          String(b.lines.length),
          b.expectedDate ? formatDay(b.expectedDate) : "Not set",
          STAGE_LABELS[b.stage],
        ],
      })),
    },
  ];
}

/** The booking book as a document; `pages` fills in the cover's page numbers (second pass). */
export function bookingBookDocument(
  ctx: CompanyContext,
  data: BookData,
  orientation: Orientation,
  pages: PartPages[] | null,
): PrintDocument {
  const styles = new Map(data.styles.map((s) => [s.id, s]));
  const fabricGroups = bySupplier(data.bookings, true);
  const trimGroups = bySupplier(data.bookings, false);
  const parts: Part[] = [
    ...fabricGroups.map(([id, g], i) => fabricPart(data, styles, id, g, i + 1)),
    ...data.bookings.map(collarPart).filter((p): p is Part => p !== null),
    ...trimGroups.map(([id, g], i) => trimsPart(data, styles, id, g, i + 1)),
  ];
  const swatches = fabricGroups.map(([id, g]): Part => {
    const rows: SwatchRow[] = [];
    for (const { line } of g.lines) {
      const shares = byStyleColour(line, styles);
      if (shares.length === 0) {
        rows.push({
          label: line.specs.colour ?? line.material.name,
          quantity: Number(line.quantity),
          unit: line.material.unit,
        });
      }
      for (const [label, quantity] of shares) {
        rows.push({ label, quantity, unit: line.material.unit });
      }
    }
    const blocks = swatchListBlocks(g.name, rows, data.currency).map((b) =>
      b.kind === "section" ? { ...b, key: `swatch:${id}` } : b,
    );
    return {
      key: `swatch:${id}`,
      recipient: "Store and cutting",
      part: `Swatch list · ${g.name}`,
      bookings: uniqueBookings(g.lines),
      blocks,
    };
  });
  const pageText = (key: string) => {
    const p = pages?.find((x) => x.key === key);
    if (!p) return "—";
    return p.first === p.last ? String(p.first) : `${p.first}–${p.last}`;
  };
  const pieces = data.styles.reduce((t, s) => t + s.pieces, 0);
  const suppliers = new Set(data.bookings.map((b) => b.supplier.id));
  const internal = (key: string, part: string, recipient: string) => ({
    cells: [recipient, part, "—", pageText(key), "—", "—"],
  });
  const buyers = [...new Set(data.styles.map((s) => s.buyer).filter(Boolean))].join(", ");
  const blocks: Block[] = [
    {
      kind: "section",
      key: "cover",
      title: `Booking book · ${data.batch.name}`,
      label: "Cover",
      subtitle: `${data.batch.code} · ${data.styles.length} style(s) · ${grouped(pieces)} pieces`,
    },
    {
      kind: "figures",
      figures: [
        { label: "Styles", value: String(data.styles.length) },
        { label: "Garment pieces", value: grouped(pieces) },
        { label: "Bookings", value: String(data.bookings.length) },
        { label: "Suppliers", value: String(suppliers.size) },
      ],
    },
    {
      kind: "table",
      title: "Distribution list",
      columns: [
        { label: "Recipient", weight: 2.4 },
        { label: "Part", weight: 2.4 },
        { label: "Booking no.", weight: 2.4 },
        { label: "Pages", align: "right", weight: 0.9 },
        { label: "In-house date", weight: 1.4 },
        { label: "Stage", weight: 1.2 },
      ],
      rows: [
        internal("order", "Order summary", "Merchandising"),
        ...[...parts, ...swatches].map((p) => ({
          cells: [
            p.recipient,
            p.part,
            docNos(p.bookings),
            pageText(p.key),
            inHouse(p.bookings),
            stageText(p.bookings),
          ],
        })),
        internal("summary", "Summary & reconciliation", "Owner"),
        internal("sign-off", "Sign-off", "Owner"),
      ],
    },
    {
      kind: "note",
      text: "This book carries no prices. Each supplier gets only its own part; a part still in draft is sent once it is approved.",
    },
    {
      kind: "section",
      key: "order",
      title: "Order summary",
      label: "Order summary",
      subtitle:
        "Each style has a code (A, B and so on) and each of its colours one too (A-01, A-02 and so on): the fabric and trims parts use them.",
    },
    ...orderBlocks(data),
    ...parts.flatMap((p) => p.blocks),
    ...summaryBlocks(data),
    {
      kind: "section",
      key: "sign-off",
      title: "Sign-off",
      label: "Sign-off",
      subtitle:
        "Signed before the parts go out; each supplier signs its acknowledgement on its own part.",
    },
    {
      kind: "list",
      title: "Checked",
      items: [
        { text: "Every style, colour and size of the order is booked (Summary & reconciliation)." },
        {
          text: "Collars and cuffs are booked over the pieces: at least 5 collars and 10 cuffs over each colour and size.",
        },
        {
          text: "Each part names its in-house date, and draft parts are approved before they are sent.",
        },
      ],
    },
    {
      kind: "signatures",
      labels: ["Prepared by", "Checked by", "Approved by", "Supplier acknowledgement"],
    },
    ...swatches.flatMap((p) => p.blocks),
  ];
  return {
    type: "BOOKING",
    title: "Booking Book",
    subtitle: data.batch.name,
    reference: data.batch.code,
    letterhead: letterheadOf(ctx.company),
    meta: [],
    parties: [],
    blocks,
    signatures: [],
    frame: bookFrame(ctx.company, {
      orientation,
      docNo: data.batch.code,
      buyerPo: buyers || "In-house",
      date: formatDay(data.today),
      preparedBy: preparedBy(data, ctx.user.name),
    }),
  };
}

/**
 * PREPARED BY on the book: whoever made its bookings (one name, two, or the
 * first two and how many more), else the person printing it.
 */
export function preparedBy(data: Pick<BookData, "bookings">, printer: string): string {
  const makers = [
    ...new Set(data.bookings.flatMap((b) => (b.createdBy?.name ? [b.createdBy.name] : []))),
  ];
  if (makers.length === 0) return printer;
  if (makers.length <= 2) return makers.join(", ");
  return `${makers.slice(0, 2).join(", ")} +${makers.length - 2}`;
}

/** What the booking book is made from: the batch, its styles with their codes, its bookings. */
export async function bookingBookData(ctx: CompanyContext, batchId: string): Promise<BookData> {
  const bookings = await batchBookingDetails(ctx, batchId);
  const plan = await batchMaterialPlan(ctx, batchId);
  const projects = await ctx.db.productionProject.findMany({
    where: { batchId: plan.batch.id, status: { not: "CANCELLED" } },
    select: {
      id: true,
      code: true,
      name: true,
      targetQuantity: true,
      buyer: { select: { name: true } },
    },
    orderBy: { code: "asc" },
  });
  // The styles were found through the company's own client; their grids are read by id.
  const grids = await styleGrids(
    prisma,
    projects.map((p) => p.id),
  );
  const trimmed = (d: { toFixed: (n: number) => string }) =>
    d.toFixed(3).replace(/\.?0+$/, "") || "0";
  return {
    batch: { id: plan.batch.id, code: plan.batch.code, name: plan.batch.name },
    styles: projects.map((p, i) => {
      const letter = styleCode(i);
      const grid = grids.get(p.id) ?? [];
      const colours = [...new Set(grid.map((c) => c.colorName))];
      return {
        id: p.id,
        letter,
        code: p.code,
        name: p.name,
        buyer: p.buyer?.name ?? null,
        pieces: p.targetQuantity,
        colours: colours.map((name, j) => ({ code: colourCode(letter, j), name })),
        sizes: [...new Set(grid.map((c) => c.sizeName))],
        grid: new Map(grid.map((c) => [`${c.colorName}|${c.sizeName}`, c.quantity])),
      };
    }),
    bookings,
    plan: plan.materials.map((m) => ({
      code: m.material.code,
      name: m.material.name,
      unit: m.material.unit,
      needed: trimmed(m.needed),
      toOrder: trimmed(m.toOrder),
    })),
    today: localDay(new Date(), ctx.company.timezone),
    currency: ctx.company.currency,
  };
}

/**
 * The batch's booking book for download (logged; nothing is kept), Landscape
 * or Portrait as asked (kept as this person's pick), else as they last printed.
 */
export async function bookingBookPdf(
  ctx: CompanyContext,
  batchId: string,
  meta?: RequestMeta,
  asked?: string | null,
) {
  checkRateLimit(`on-demand-print:${ctx.user.id}`, ON_DEMAND_PER_MINUTE, 60_000);
  const data = await bookingBookData(ctx, batchId);
  const orientation = await downloadOrientation(ctx, asked);
  const bytes = await renderBookOnDemand(ctx, (pages) =>
    bookingBookDocument(ctx, data, orientation, pages),
  );
  await auditInCompany(ctx, meta, {
    action: "EXPORT",
    entityType: "ProductionBatch",
    entityId: data.batch.id,
    summary: `Printed the booking book of ${data.batch.code} (${data.bookings.length} booking(s), ${orientation})`,
  });
  return {
    fileName: documentFileName(
      ctx.company.name,
      `Booking book ${data.batch.code} ${data.batch.name}`,
    ),
    bytes,
    orientation,
  };
}
