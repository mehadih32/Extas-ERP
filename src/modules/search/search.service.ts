import type { Prisma } from "@prisma/client";
import { z } from "zod";

import { partyHref } from "@/components/parties/labels";
import { localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import type { CompanyContext } from "@/modules/auth/context";
import { SEE_BOOKINGS } from "@/modules/production/booking.service";
import { TECH_PACK_READ } from "@/modules/production/tech-pack-access";
import { STAGE_LABELS } from "@/modules/production/timeline";
import type { PermissionKey } from "@/modules/rbac/permissions";

/*
 * The search box in the top bar (Release 2): one box for orders, invoices,
 * quotations, proforma invoices, buyers and suppliers, styles, bookings,
 * purchase orders, production projects and batches, tech packs and
 * employees. Each kind is searched only for people who may open its pages
 * (the same permissions as those pages' Server Actions), through the
 * company's own locked client (ctx.db), a few of the newest matches a kind.
 * A result carries only what names the record (its number or code, name,
 * the buyer or supplier, a status and a day): never a price, a total, a cost
 * or a salary, so nothing turns up here that the person's role hides on the
 * record's page.
 */

/** At most this many results of each kind. */
export const RESULTS_PER_KIND = 5;
/** Kinds searched at the same time, so one search never holds many database connections. */
const KINDS_AT_ONCE = 4;
/** The fewest letters searched for. */
export const MIN_QUERY = 2;
const MAX_QUERY = 80;

export const searchQuerySchema = z.object({
  q: z.string().trim().max(MAX_QUERY, `Search for at most ${MAX_QUERY} letters.`),
});

export type SearchKind =
  | "orders"
  | "invoices"
  | "quotations"
  | "proformas"
  | "parties"
  | "styles"
  | "bookings"
  | "purchaseOrders"
  | "projects"
  | "batches"
  | "techPacks"
  | "employees";

export type SearchHit = {
  id: string;
  /** Its number, code or name. */
  title: string;
  /** What else tells it apart: the buyer or supplier, a status, a day. */
  detail: string;
  href: string;
};

export type SearchGroup = { kind: SearchKind; label: string; hits: SearchHit[] };

export type SearchResult = { query: string; groups: SearchGroup[] };

type Finder = (ctx: CompanyContext, q: string) => Promise<SearchHit[]>;

const has = (q: string) => ({ contains: q, mode: "insensitive" as Prisma.QueryMode });
const words = (value: string) =>
  value.charAt(0) + value.slice(1).toLowerCase().replaceAll("_", " ");
const join = (...parts: Array<string | null | undefined | false>) =>
  parts.filter((p): p is string => typeof p === "string" && p.trim().length > 0).join(" · ");
const at = (prefix: string, id: string) => `${prefix}/${encodeURIComponent(id)}`;
const day = (ctx: CompanyContext, value: Date) => localDay(value, ctx.company.timezone);
const take = RESULTS_PER_KIND;

const orders: Finder = async (ctx, q) => {
  const rows = await ctx.db.salesOrder.findMany({
    where: {
      OR: [
        { number: has(q) },
        { externalOrderId: has(q) },
        { customerName: has(q) },
        { customerPhone: has(q) },
        { party: { name: has(q) } },
      ],
    },
    select: {
      id: true,
      number: true,
      status: true,
      orderDate: true,
      customerName: true,
      party: { select: { name: true } },
    },
    orderBy: [{ orderDate: "desc" }, { id: "desc" }],
    take,
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.number,
    detail: join(
      r.party?.name ?? r.customerName ?? "Walk-in customer",
      words(r.status),
      day(ctx, r.orderDate),
    ),
    href: at("/sales/orders", r.id),
  }));
};

const invoices: Finder = async (ctx, q) => {
  const rows = await ctx.db.invoice.findMany({
    where: {
      OR: [
        { number: has(q) },
        { order: { number: has(q) } },
        { party: { name: has(q) } },
        { order: { customerName: has(q) } },
      ],
    },
    select: {
      id: true,
      number: true,
      status: true,
      issueDate: true,
      party: { select: { name: true } },
      order: { select: { number: true, customerName: true } },
    },
    orderBy: [{ issueDate: "desc" }, { id: "desc" }],
    take,
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.number,
    detail: join(
      r.party?.name ?? r.order.customerName ?? "Walk-in customer",
      `order ${r.order.number}`,
      words(r.status),
      day(ctx, r.issueDate),
    ),
    href: at("/sales/invoices", r.id),
  }));
};

const quotations: Finder = async (ctx, q) => {
  const rows = await ctx.db.quotation.findMany({
    where: { OR: [{ number: has(q) }, { party: { name: has(q) } }] },
    select: {
      id: true,
      number: true,
      status: true,
      issueDate: true,
      party: { select: { name: true } },
    },
    orderBy: [{ issueDate: "desc" }, { id: "desc" }],
    take,
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.number,
    detail: join(r.party.name, words(r.status), day(ctx, r.issueDate)),
    href: at("/sales/quotations", r.id),
  }));
};

const proformas: Finder = async (ctx, q) => {
  const rows = await ctx.db.proformaInvoice.findMany({
    where: {
      OR: [{ number: has(q) }, { buyerPoNumber: has(q) }, { party: { name: has(q) } }],
    },
    select: {
      id: true,
      number: true,
      status: true,
      issueDate: true,
      buyerPoNumber: true,
      party: { select: { name: true } },
    },
    orderBy: [{ issueDate: "desc" }, { id: "desc" }],
    take,
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.number,
    detail: join(
      r.party.name,
      r.buyerPoNumber && `buyer PO ${r.buyerPoNumber}`,
      words(r.status),
      day(ctx, r.issueDate),
    ),
    href: at("/sales/proformas", r.id),
  }));
};

const PARTY_KIND: Record<string, string> = {
  BUYER: "Buyer",
  SUPPLIER: "Supplier",
  BOTH: "Buyer and supplier",
};

const parties: Finder = async (ctx, q) => {
  const rows = await ctx.db.party.findMany({
    where: {
      OR: [
        { name: has(q) },
        { code: has(q) },
        { contactPerson: has(q) },
        { phone: has(q) },
        { email: has(q) },
      ],
    },
    select: { id: true, code: true, name: true, kind: true, oneTime: true, city: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take,
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.name,
    detail: join(PARTY_KIND[r.kind], r.code, r.city),
    href: partyHref(r),
  }));
};

const styles: Finder = async (ctx, q) => {
  const rows = await ctx.db.style.findMany({
    where: { OR: [{ code: has(q) }, { name: has(q) }] },
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
      category: { select: { name: true } },
    },
    orderBy: [{ isActive: "desc" }, { code: "asc" }],
    take,
  });
  return rows.map((r) => ({
    id: r.id,
    title: `${r.code} · ${r.name}`,
    detail: join(r.category.name, !r.isActive && "Inactive"),
    href: at("/products", r.id),
  }));
};

const bookings: Finder = async (ctx, q) => {
  const rows = await ctx.db.booking.findMany({
    where: {
      OR: [
        { title: has(q) },
        { styleRef: has(q) },
        { order: { number: has(q) } },
        { order: { supplierRef: has(q) } },
        { order: { supplier: { name: has(q) } } },
      ],
    },
    select: {
      id: true,
      title: true,
      styleRef: true,
      stage: true,
      revision: true,
      order: { select: { number: true, supplier: { select: { name: true } } } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.revision > 0 ? `${r.order.number}-R${r.revision}` : r.order.number,
    detail: join(r.order.supplier.name, r.title ?? r.styleRef, words(r.stage)),
    href: at("/production/bookings", r.id),
  }));
};

const purchaseOrders: Finder = async (ctx, q) => {
  const rows = await ctx.db.purchaseOrder.findMany({
    where: {
      // A booking's order is found as the booking.
      booking: null,
      OR: [{ number: has(q) }, { supplierRef: has(q) }, { supplier: { name: has(q) } }],
    },
    select: {
      id: true,
      number: true,
      status: true,
      orderDate: true,
      supplier: { select: { name: true } },
    },
    orderBy: [{ orderDate: "desc" }, { id: "desc" }],
    take,
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.number,
    detail: join(r.supplier.name, words(r.status), day(ctx, r.orderDate)),
    href: at("/materials/orders", r.id),
  }));
};

const projects: Finder = async (ctx, q) => {
  const rows = await ctx.db.productionProject.findMany({
    where: {
      OR: [
        { code: has(q) },
        { name: has(q) },
        { style: { code: has(q) } },
        { style: { name: has(q) } },
      ],
    },
    select: {
      id: true,
      code: true,
      name: true,
      stage: true,
      status: true,
      style: { select: { code: true } },
    },
    orderBy: [{ startDate: "desc" }, { id: "desc" }],
    take,
  });
  return rows.map((r) => ({
    id: r.id,
    title: `${r.code} · ${r.name}`,
    detail: join(r.style?.code, r.status === "ACTIVE" ? STAGE_LABELS[r.stage] : words(r.status)),
    href: at("/production/projects", r.id),
  }));
};

const batches: Finder = async (ctx, q) => {
  const rows = await ctx.db.productionBatch.findMany({
    where: { OR: [{ code: has(q) }, { name: has(q) }] },
    select: { id: true, code: true, name: true, createdAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
  });
  return rows.map((r) => ({
    id: r.id,
    title: `${r.code} · ${r.name}`,
    detail: join("Master batch", day(ctx, r.createdAt)),
    href: at("/production/batches", r.id),
  }));
};

const techPacks: Finder = async (ctx, q) => {
  const rows = await ctx.db.techPack.findMany({
    where: {
      OR: [
        { number: has(q) },
        { title: has(q) },
        { season: has(q) },
        { style: { code: has(q) } },
        { style: { name: has(q) } },
      ],
    },
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      style: { select: { code: true } },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take,
  });
  return rows.map((r) => ({
    id: r.id,
    title: join(r.number, r.title) || "Tech pack",
    detail: join(r.style?.code, words(r.status)),
    href: at("/tech-packs", r.id),
  }));
};

const employees: Finder = async (ctx, q) => {
  const rows = await ctx.db.employee.findMany({
    where: {
      OR: [{ name: has(q) }, { code: has(q) }, { phone: has(q) }, { designation: has(q) }],
    },
    // Never the salary or anything about money: only what names the person.
    select: { id: true, code: true, name: true, designation: true, status: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take,
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.name,
    detail: join(r.designation, r.code, r.status !== "ACTIVE" && words(r.status)),
    href: at("/hr/employees", r.id),
  }));
};

/**
 * The kinds in the order they are shown, each with the permissions that open
 * its pages (any one of them).
 */
export const SEARCH_KINDS: ReadonlyArray<{
  kind: SearchKind;
  label: string;
  anyOf: readonly PermissionKey[];
  find: Finder;
}> = [
  { kind: "orders", label: "Orders", anyOf: ["sales.view"], find: orders },
  { kind: "invoices", label: "Invoices", anyOf: ["sales.view"], find: invoices },
  { kind: "quotations", label: "Quotations", anyOf: ["sales.view"], find: quotations },
  { kind: "proformas", label: "Proforma invoices", anyOf: ["sales.view"], find: proformas },
  { kind: "parties", label: "Buyers and suppliers", anyOf: ["parties.view"], find: parties },
  { kind: "styles", label: "Styles", anyOf: ["inventory.view"], find: styles },
  { kind: "bookings", label: "Bookings", anyOf: SEE_BOOKINGS, find: bookings },
  {
    kind: "purchaseOrders",
    label: "Purchase orders",
    anyOf: ["materials.view"],
    find: purchaseOrders,
  },
  {
    kind: "projects",
    label: "Production projects",
    anyOf: ["production.view"],
    find: projects,
  },
  { kind: "batches", label: "Master batches", anyOf: ["production.view"], find: batches },
  { kind: "techPacks", label: "Tech packs", anyOf: TECH_PACK_READ, find: techPacks },
  {
    kind: "employees",
    label: "Employees",
    anyOf: ["hr.view", "hr.manage", "hr.payroll"],
    find: employees,
  },
];

/** The kinds this person may search: those whose pages they may open. */
export function searchableKinds(can: (permission: PermissionKey) => boolean): SearchKind[] {
  return SEARCH_KINDS.filter((k) => k.anyOf.some((p) => can(p))).map((k) => k.kind);
}

/**
 * Searches every kind this person may open for the words typed: a part of a
 * number, code, name, phone or e-mail, any case. Fewer than MIN_QUERY letters
 * search nothing. Only kinds with matches come back, in the menu's order.
 */
export async function globalSearch(ctx: CompanyContext, input: unknown): Promise<SearchResult> {
  const parsed = searchQuerySchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("VALIDATION", parsed.error.issues[0]?.message ?? "Check the search words.");
  }
  const query = parsed.data.q;
  if (query.length < MIN_QUERY) return { query, groups: [] };
  const allowed = SEARCH_KINDS.filter((k) => k.anyOf.some((p) => ctx.can(p)));
  const found: SearchHit[][] = [];
  for (let i = 0; i < allowed.length; i += KINDS_AT_ONCE) {
    const batch = allowed.slice(i, i + KINDS_AT_ONCE);
    found.push(...(await Promise.all(batch.map((k) => k.find(ctx, query)))));
  }
  return {
    query,
    groups: allowed
      .map((k, i) => ({ kind: k.kind, label: k.label, hits: found[i]! }))
      .filter((g) => g.hits.length > 0),
  };
}
