import { type Lead, type LeadActivityKind, type LeadStage, Prisma } from "@prisma/client";

import type { Db } from "@/lib/db-types";
import { addDays, dateColumn, dateOnly, localDay, startOfDayInZone, nextDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { readOnlyReason } from "@/lib/read-only";
import type { RequestMeta } from "@/lib/request-meta";
import { canSeeSalesAmounts } from "@/modules/dashboard/access";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { requirePin } from "@/modules/ai/settings.service";
import { storeUpload } from "@/modules/files/file.service";
import { createParty } from "@/modules/parties/party.service";
import { activeMembers, isActiveMember } from "@/modules/reminders/audience";
import {
  type Candidate,
  cleanEmail,
  companyDomain,
  isFollowUpStage,
  isOpenStage,
  keysOf,
  leadCheck,
  leadNumber,
  matchDuplicates,
  FOLLOW_UP_STAGES,
  phoneDigits,
  STAGE_LABELS,
  suppressionHash,
  suppressionHint,
  suppressionValue,
  websiteDomain,
} from "@/modules/leads/rules";
import {
  addLeadSchema,
  assignSchema,
  contactSchema,
  contactUpdateSchema,
  duplicateCheckSchema,
  editLeadSchema,
  eraseSchema,
  listLeadsSchema,
  logActivitySchema,
  makeBuyerSchema,
  messageSentSchema,
  nextStepSchema,
  reportSchema,
  sampleSchema,
  sampleUpdateSchema,
  settingsSchema,
  sourceActiveSchema,
  sourceSchema,
  stageSchema,
  suppressionSchema,
} from "@/modules/leads/schemas";

/*
 * Leads (Sales > Leads, phase 1): companies that are not buyers yet. No AI and
 * nothing sent by the ERP: the email and WhatsApp buttons open the person's own
 * mail app or WhatsApp, and "I sent it" logs it.
 *   - Who sees what: leads.view sees the leads given to them and the ones not
 *     given to anyone; leads.all sees every lead. Checked in every read and write.
 *   - The history (LeadActivity) is only ever added to: this module has no way to
 *     change or remove a line, and a correction is a new note.
 *   - A lead becomes a buyer at its first quotation or by "Make buyer"
 *     (leads.convert and parties.manage); the buyer keeps the lead's history.
 *   - "Do not contact": a hash of the email, domain or phone (never the value), so
 *     erasing a person's data (leads.erase, with the PIN) keeps them off for good.
 *     No money or stock is touched by anything here.
 */

type Tx = Prisma.TransactionClient;

export const DEFAULT_SOURCES: ReadonlyArray<{
  name: string;
  kind: Prisma.LeadSourceCreateManyInput["kind"];
}> = [
  { name: "Trade fair", kind: "TRADE_FAIR" },
  { name: "Referral", kind: "REFERRAL" },
  { name: "Existing network", kind: "EXISTING_NETWORK" },
  { name: "LinkedIn", kind: "LINKEDIN" },
  { name: "Shipment data", kind: "SHIPMENT_DATA" },
  { name: "Website enquiry", kind: "WEBSITE" },
  { name: "Marketplace", kind: "MARKETPLACE" },
  { name: "Own research", kind: "COLD_RESEARCH" },
];

// =============================================================================
// Access
// =============================================================================

export function leadAccess(ctx: Pick<CompanyContext, "can">) {
  const all = ctx.can("leads.all");
  return {
    view: all || ctx.can("leads.view"),
    all,
    manage: ctx.can("leads.manage"),
    assign: ctx.can("leads.assign"),
    convert: ctx.can("leads.convert") && ctx.can("parties.manage"),
    export: ctx.can("leads.export"),
    settings: ctx.can("leads.settings"),
    erase: ctx.can("leads.erase"),
  };
}

export type LeadAccess = ReturnType<typeof leadAccess>;

function mustView(ctx: CompanyContext) {
  if (!leadAccess(ctx).view) throw new AppError("FORBIDDEN", "Leads are not part of your role.");
}

function mustManage(ctx: CompanyContext) {
  mustView(ctx);
  if (!ctx.can("leads.manage")) {
    throw new AppError("FORBIDDEN", "Adding and changing leads is not part of your role.");
  }
}

/** The leads this person may see: every lead, or their own and the ones not given to anyone. */
export function visibleLeads(ctx: Pick<CompanyContext, "can" | "user">): Prisma.LeadWhereInput {
  if (ctx.can("leads.all")) return {};
  return { OR: [{ ownerUserId: ctx.user.id }, { ownerUserId: null }] };
}

async function leadOrThrow(ctx: CompanyContext, leadId: string) {
  const lead = await ctx.db.lead.findFirst({ where: { id: leadId, ...visibleLeads(ctx) } });
  if (!lead) throw new AppError("NOT_FOUND", "Lead not found.");
  return lead;
}

const todayOf = (ctx: CompanyContext, now = new Date()) => localDay(now, ctx.company.timezone);

/** A line of the lead's history (the only way one is written). */
async function addActivity(
  db: Db | Tx,
  ctx: CompanyContext,
  leadId: string,
  line: {
    kind: LeadActivityKind;
    summary: string;
    body?: string | null;
    contactId?: string | null;
    fromStage?: LeadStage | null;
    toStage?: LeadStage | null;
    occurredAt?: Date;
  },
) {
  const now = new Date();
  await db.leadActivity.create({
    data: {
      companyId: ctx.company.id,
      leadId,
      kind: line.kind,
      summary: line.summary,
      body: line.body ?? null,
      contactId: line.contactId ?? null,
      fromStage: line.fromStage ?? null,
      toStage: line.toStage ?? null,
      occurredAt: line.occurredAt ?? now,
      userId: ctx.user.id,
    },
  });
  await db.lead.updateMany({
    where: { id: leadId, companyId: ctx.company.id },
    data: { lastActivityAt: now },
  });
}

/** A person given a lead must be an active member who may see leads. */
async function assertOwner(ctx: CompanyContext, ownerUserId: string | null | undefined) {
  if (!ownerUserId) return null;
  if (!(await isActiveMember(ctx.company.id, ownerUserId))) {
    throw new AppError("VALIDATION", "Give it to someone in your team.", {
      ownerUserId: ["Pick a person from the list"],
    });
  }
  const member = (await activeMembers(ctx.company.id)).find((m) => m.userId === ownerUserId);
  if (!member || !(member.permissions.has("leads.view") || member.permissions.has("leads.all"))) {
    throw new AppError("VALIDATION", "That person's role does not see leads.", {
      ownerUserId: ["That person's role does not see leads"],
    });
  }
  return ownerUserId;
}

async function assertSource(ctx: CompanyContext, sourceId: string | null | undefined) {
  if (!sourceId) return null;
  const source = await ctx.db.leadSource.findFirst({ where: { id: sourceId } });
  if (!source) {
    throw new AppError("VALIDATION", "Pick a source from the list.", {
      sourceId: ["Pick a source from the list"],
    });
  }
  return source.id;
}

// =============================================================================
// Settings and sources
// =============================================================================

/**
 * The company's sources, made the first time leads are opened (each company its
 * own); never where nothing may be written (a Full check session, Bug Guard).
 */
export async function ensureSources(companyId: string, db: Db = prisma) {
  if (await readOnlyReason()) return;
  const count = await db.leadSource.count({ where: { companyId } });
  if (count > 0) return;
  await db.leadSource.createMany({
    data: DEFAULT_SOURCES.map((s) => ({ companyId, name: s.name, kind: s.kind })),
    skipDuplicates: true,
  });
}

export async function leadSettingsOf(companyId: string, db: Db = prisma) {
  const row = await db.leadSettings.findUnique({ where: { companyId } });
  return {
    targetCountries: row?.targetCountries ?? [],
    riskyCountries: row?.riskyCountries ?? [],
    productFocus: row?.productFocus ?? [],
    minPieces: row?.minPieces ?? null,
    priceMin: row?.priceMin ? Number(row.priceMin) : null,
    priceMax: row?.priceMax ? Number(row.priceMax) : null,
    followUpDays: row?.followUpDays ?? 7,
  };
}

export async function getLeadSettingsPage(ctx: CompanyContext) {
  mustView(ctx);
  if (!ctx.can("leads.settings")) {
    throw new AppError("FORBIDDEN", "Lead settings are not part of your role.");
  }
  await ensureSources(ctx.company.id);
  const [settings, sources] = await Promise.all([
    leadSettingsOf(ctx.company.id),
    ctx.db.leadSource.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      include: { _count: { select: { leads: true } } },
    }),
  ]);
  return {
    settings,
    currency: ctx.company.currency,
    sources: sources.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      isActive: s.isActive,
      leads: s._count.leads,
    })),
  };
}

export async function saveLeadSettings(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  mustView(ctx);
  if (!ctx.can("leads.settings")) {
    throw new AppError("FORBIDDEN", "Lead settings are not part of your role.");
  }
  const input = settingsSchema.parse(raw);
  const data = {
    targetCountries: input.targetCountries,
    riskyCountries: input.riskyCountries,
    productFocus: input.productFocus,
    minPieces: input.minPieces ?? null,
    priceMin: input.priceMin ?? null,
    priceMax: input.priceMax ?? null,
    followUpDays: input.followUpDays,
    updatedById: ctx.user.id,
  };
  await ctx.db.leadSettings.upsert({
    where: { companyId: ctx.company.id },
    create: { companyId: ctx.company.id, ...data },
    update: data,
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "LeadSettings",
    summary: "Changed the lead settings (lead check rules)",
  });
}

export async function addLeadSource(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  mustView(ctx);
  if (!ctx.can("leads.settings")) {
    throw new AppError("FORBIDDEN", "Lead settings are not part of your role.");
  }
  const input = sourceSchema.parse(raw);
  const clash = await ctx.db.leadSource.findFirst({
    where: { name: { equals: input.name, mode: "insensitive" } },
  });
  if (clash) {
    throw new AppError("CONFLICT", "A source with this name is already there.", {
      name: ["A source with this name is already there"],
    });
  }
  const source = await ctx.db.leadSource.create({
    data: { companyId: ctx.company.id, name: input.name, kind: input.kind },
  });
  await auditInCompany(ctx, meta, {
    action: "CREATE",
    entityType: "LeadSource",
    entityId: source.id,
    summary: `Added the lead source "${source.name}"`,
  });
  return { id: source.id };
}

/** Sources are switched off, never removed (leads keep pointing at them). */
export async function setLeadSourceActive(
  ctx: CompanyContext,
  sourceId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  mustView(ctx);
  if (!ctx.can("leads.settings")) {
    throw new AppError("FORBIDDEN", "Lead settings are not part of your role.");
  }
  const { isActive } = sourceActiveSchema.parse(raw);
  const source = await ctx.db.leadSource.findFirst({ where: { id: sourceId } });
  if (!source) throw new AppError("NOT_FOUND", "Source not found.");
  await ctx.db.leadSource.update({ where: { id: source.id }, data: { isActive } });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "LeadSource",
    entityId: source.id,
    summary: `${isActive ? "Switched on" : "Switched off"} the lead source "${source.name}"`,
  });
}

// =============================================================================
// "Do not contact" list
// =============================================================================

type SuppressionKey = { kind: "EMAIL" | "DOMAIN" | "PHONE"; hash: string };

function contactKeys(
  companyId: string,
  c: { email?: string | null; phone?: string | null; whatsapp?: string | null },
) {
  const keys: SuppressionKey[] = [];
  const email = cleanEmail(c.email);
  if (email) {
    keys.push({ kind: "EMAIL", hash: suppressionHash(companyId, email) });
    const domain = companyDomain(email);
    if (domain) keys.push({ kind: "DOMAIN", hash: suppressionHash(companyId, domain) });
  }
  for (const phone of [c.phone, c.whatsapp]) {
    const digits = phoneDigits(phone);
    if (digits) keys.push({ kind: "PHONE", hash: suppressionHash(companyId, digits) });
  }
  return keys;
}

/** Whether a contact's email, email domain or phone is on the "Do not contact" list. */
export async function isSuppressed(
  companyId: string,
  c: { email?: string | null; phone?: string | null; whatsapp?: string | null },
  db: Db = prisma,
) {
  const keys = contactKeys(companyId, c);
  if (keys.length === 0) return false;
  const hit = await db.leadSuppression.findFirst({
    where: { companyId, OR: keys.map((k) => ({ kind: k.kind, valueHash: k.hash })) },
    select: { id: true },
  });
  return hit !== null;
}

export async function listSuppressions(ctx: CompanyContext) {
  mustView(ctx);
  const rows = await ctx.db.leadSuppression.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    hint: r.valueHint,
    reason: r.reason,
    note: r.note,
    addedOn: localDay(r.createdAt, ctx.company.timezone),
  }));
}

/** Adds an email, domain or phone to the list; its leads' contacts stop being offered. */
export async function addSuppression(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  mustManage(ctx);
  const input = suppressionSchema.parse(raw);
  const value = suppressionValue(input.kind, input.value);
  if (!value) {
    throw new AppError("VALIDATION", "That is not a full email, domain or phone number.", {
      value: ["Give a full email, domain or phone number"],
    });
  }
  const valueHash = suppressionHash(ctx.company.id, value);
  await ctx.db.leadSuppression.upsert({
    where: {
      companyId_kind_valueHash: { companyId: ctx.company.id, kind: input.kind, valueHash },
    },
    create: {
      companyId: ctx.company.id,
      kind: input.kind,
      valueHash,
      valueHint: suppressionHint(input.kind, value),
      reason: "ASKED",
      note: input.note,
      createdById: ctx.user.id,
    },
    update: {},
  });
  await markSuppressedContacts(ctx);
  await auditInCompany(ctx, meta, {
    action: "CREATE",
    entityType: "LeadSuppression",
    summary: `Added ${suppressionHint(input.kind, value)} to "Do not contact"`,
  });
}

/** Ticks "Do not contact" on every contact the list now covers. */
async function markSuppressedContacts(ctx: CompanyContext) {
  const contacts = await ctx.db.leadContact.findMany({
    where: { doNotContact: false, erasedAt: null },
    select: { id: true, email: true, phone: true, whatsapp: true },
  });
  for (const c of contacts) {
    if (await isSuppressed(ctx.company.id, c)) {
      await ctx.db.leadContact.update({ where: { id: c.id }, data: { doNotContact: true } });
    }
  }
}

// =============================================================================
// Duplicates
// =============================================================================

async function candidates(ctx: CompanyContext, excludeLeadId?: string | null) {
  const [leads, buyers] = await Promise.all([
    ctx.db.lead.findMany({
      where: excludeLeadId ? { id: { not: excludeLeadId } } : {},
      select: {
        id: true,
        number: true,
        name: true,
        country: true,
        website: true,
        archivedAt: true,
        ownerUserId: true,
        owner: { select: { name: true } },
        contacts: { select: { email: true, phone: true, whatsapp: true } },
      },
    }),
    ctx.db.party.findMany({
      where: { kind: { in: ["BUYER", "BOTH"] }, systemRole: null },
      select: {
        id: true,
        code: true,
        name: true,
        country: true,
        email: true,
        phone: true,
        whatsapp: true,
      },
    }),
  ]);
  const seesAll = ctx.can("leads.all");
  const list: Candidate[] = [
    ...leads.map((l) => {
      // A lead someone else follows, for a person who sees only their own and free
      // leads: it still warns, but without its name, number or link.
      const hidden = !seesAll && !!l.ownerUserId && l.ownerUserId !== ctx.user.id;
      return {
        ...keysOf({
          name: l.name,
          country: l.country,
          website: l.website,
          emails: l.contacts.map((c) => c.email),
          phones: l.contacts.flatMap((c) => [c.phone, c.whatsapp]),
        }),
        id: l.id,
        kind: "LEAD" as const,
        hidden,
        label: hidden
          ? "a lead already followed by someone else"
          : `${l.number} ${l.name}${l.owner ? ` (followed by ${l.owner.name})` : ""}${l.archivedAt ? " (archived)" : ""}`,
      };
    }),
    ...buyers.map((b) => ({
      ...keysOf({
        name: b.name,
        country: b.country,
        emails: [b.email],
        phones: [b.phone, b.whatsapp],
      }),
      id: b.id,
      kind: "BUYER" as const,
      label: `${b.code} ${b.name}`,
    })),
  ];
  return list;
}

/** What "Add lead" warns about while typing: leads and buyers that look the same, and the list. */
export async function checkLeadDuplicates(ctx: CompanyContext, raw: unknown) {
  mustView(ctx);
  const input = duplicateCheckSchema.parse(raw);
  const keys = keysOf({
    name: input.name,
    country: input.country,
    website: input.website,
    emails: [input.email],
    phones: [input.phone],
  });
  const matches =
    input.name.trim().length >= 2 || keys.websiteDomain || keys.emails.length || keys.phones.length
      ? matchDuplicates(keys, await candidates(ctx, input.excludeLeadId))
      : [];
  const suppressed = await isSuppressed(ctx.company.id, { email: input.email, phone: input.phone });
  return { matches: matches.slice(0, 8), suppressed };
}

// =============================================================================
// Reading
// =============================================================================

const LIST_INCLUDE = {
  owner: { select: { id: true, name: true } },
  source: { select: { id: true, name: true } },
  contacts: {
    where: { isPrimary: true },
    select: { name: true, erasedAt: true },
    take: 1,
  },
  party: { select: { id: true, code: true } },
} satisfies Prisma.LeadInclude;

type ListRow = Lead & {
  owner: { id: string; name: string } | null;
  source: { id: string; name: string } | null;
  contacts: Array<{ name: string; erasedAt: Date | null }>;
  party: { id: string; code: string } | null;
};

function presentRow(row: ListRow, today: string, tz: string) {
  const next = row.nextActionOn ? dateOnly(row.nextActionOn) : null;
  return {
    id: row.id,
    number: row.number,
    name: row.name,
    country: row.country,
    category: row.category,
    products: row.products,
    stage: row.stage,
    owner: row.owner,
    source: row.source?.name ?? null,
    contact: row.contacts[0] && !row.contacts[0].erasedAt ? row.contacts[0].name : null,
    nextActionOn: next,
    nextActionKind: row.nextActionKind,
    nextActionNote: row.nextActionNote,
    /** The next step's day has passed (open leads only). */
    late: next !== null && isFollowUpStage(row.stage) && next < today,
    dueToday: next !== null && isFollowUpStage(row.stage) && next === today,
    expectedValue: row.expectedValue?.toFixed(2) ?? null,
    buyer: row.party,
    lastActivityOn: localDay(row.lastActivityAt, tz),
    archived: row.archivedAt !== null,
  };
}

export type LeadRow = ReturnType<typeof presentRow>;

export async function listLeads(ctx: CompanyContext, raw: unknown = {}) {
  mustView(ctx);
  await ensureSources(ctx.company.id);
  const f = listLeadsSchema.parse(raw);
  const today = todayOf(ctx);
  const where: Prisma.LeadWhereInput = {
    AND: [
      visibleLeads(ctx),
      { archivedAt: f.archived ? { not: null } : null },
      f.stage ? { stage: f.stage } : {},
      f.owner === "me"
        ? { ownerUserId: ctx.user.id }
        : f.owner === "none"
          ? { ownerUserId: null }
          : f.owner
            ? { ownerUserId: f.owner }
            : {},
      f.sourceId ? { sourceId: f.sourceId } : {},
      f.country ? { country: { equals: f.country, mode: "insensitive" } } : {},
      f.due
        ? { stage: { in: [...FOLLOW_UP_STAGES] }, nextActionOn: { lte: dateColumn(today) } }
        : {},
      f.q
        ? {
            OR: [
              { name: { contains: f.q, mode: "insensitive" } },
              { number: { contains: f.q, mode: "insensitive" } },
              { country: { contains: f.q, mode: "insensitive" } },
              {
                contacts: {
                  some: {
                    OR: [
                      { name: { contains: f.q, mode: "insensitive" } },
                      { email: { contains: f.q, mode: "insensitive" } },
                    ],
                  },
                },
              },
            ],
          }
        : {},
    ],
  };
  const [rows, sources, members] = await Promise.all([
    ctx.db.lead.findMany({
      where,
      include: LIST_INCLUDE,
      orderBy: [{ nextActionOn: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: 500,
    }),
    ctx.db.leadSource.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    leadPeople(ctx),
  ]);
  return {
    today,
    currency: ctx.company.currency,
    rows: rows.map((r) => presentRow(r, today, ctx.company.timezone)),
    sources,
    people: members,
    access: leadAccess(ctx),
  };
}

/** People a lead can be given to: active members whose role sees leads. */
async function leadPeople(ctx: CompanyContext) {
  const members = await activeMembers(ctx.company.id);
  return members
    .filter((m) => m.permissions.has("leads.view") || m.permissions.has("leads.all"))
    .map((m) => ({ id: m.userId, name: m.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getAddLeadForm(ctx: CompanyContext) {
  mustManage(ctx);
  await ensureSources(ctx.company.id);
  const [sources, people, settings] = await Promise.all([
    ctx.db.leadSource.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    leadPeople(ctx),
    leadSettingsOf(ctx.company.id),
  ]);
  return {
    sources,
    people: ctx.can("leads.assign") ? people : people.filter((p) => p.id === ctx.user.id),
    me: ctx.user.id,
    canAssign: ctx.can("leads.assign"),
    currency: ctx.company.currency,
    defaultNextOn: addDays(todayOf(ctx), settings.followUpDays),
  };
}

/** Lead 360: the lead, its contacts, history, samples, files, check card and buyer. */
export async function getLead(ctx: CompanyContext, leadId: string) {
  mustView(ctx);
  const lead = await leadOrThrow(ctx, leadId);
  const tz = ctx.company.timezone;
  const today = todayOf(ctx);
  const [full, settings, people, sources] = await Promise.all([
    ctx.db.lead.findFirstOrThrow({
      where: { id: lead.id },
      include: {
        owner: { select: { id: true, name: true } },
        source: { select: { id: true, name: true } },
        party: { select: { id: true, code: true, name: true } },
        contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
        activities: { orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }], take: 300 },
        samples: { orderBy: { createdAt: "desc" } },
        files: {
          orderBy: { createdAt: "desc" },
          include: { file: { select: { id: true, fileName: true, sizeBytes: true } } },
        },
      },
    }),
    leadSettingsOf(ctx.company.id),
    leadPeople(ctx),
    ctx.db.leadSource.findMany({
      where: { OR: [{ isActive: true }, { id: lead.sourceId ?? "" }] },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  const userIds = [...new Set(full.activities.map((a) => a.userId).filter(Boolean))] as string[];
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true },
      })
    : [];
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const contactName = new Map(
    full.contacts.map((c) => [c.id, c.erasedAt ? "Erased contact" : c.name]),
  );
  const suppressed = new Set<string>();
  for (const c of full.contacts) {
    if (!c.erasedAt && (await isSuppressed(ctx.company.id, c))) suppressed.add(c.id);
  }
  const check = leadCheck(
    {
      products: full.products,
      piecesPerStyle: full.piecesPerStyle,
      targetPrice: full.targetPrice ? Number(full.targetPrice) : null,
      country: full.country,
      paymentTerms: full.paymentTerms,
      contacts: full.contacts.map((c) => ({
        isDecisionMaker: c.isDecisionMaker,
        email: c.email,
        phone: c.phone,
        whatsapp: c.whatsapp,
        erased: c.erasedAt !== null,
      })),
    },
    settings,
    ctx.company.currency,
  );
  const next = full.nextActionOn ? dateOnly(full.nextActionOn) : null;
  return {
    id: full.id,
    number: full.number,
    name: full.name,
    website: full.website,
    country: full.country,
    city: full.city,
    category: full.category,
    products: full.products,
    piecesPerStyle: full.piecesPerStyle,
    targetPrice: full.targetPrice?.toFixed(2) ?? null,
    expectedValue: full.expectedValue?.toFixed(2) ?? null,
    paymentTerms: full.paymentTerms,
    stage: full.stage,
    stageChangedOn: localDay(full.stageChangedAt, tz),
    owner: full.owner,
    source: full.source,
    sourceNote: full.sourceNote,
    nextActionOn: next,
    nextActionKind: full.nextActionKind,
    nextActionNote: full.nextActionNote,
    late: next !== null && isFollowUpStage(full.stage) && next < today,
    lostReason: full.lostReason,
    doNotContact: full.doNotContact,
    archived: full.archivedAt !== null,
    buyer: full.party,
    convertedOn: full.convertedAt ? localDay(full.convertedAt, tz) : null,
    createdOn: localDay(full.createdAt, tz),
    today,
    currency: ctx.company.currency,
    companyName: ctx.company.name,
    check,
    contacts: full.contacts.map((c) => ({
      id: c.id,
      name: c.erasedAt ? "Erased contact" : c.name,
      jobTitle: c.jobTitle,
      email: c.email,
      phone: c.phone,
      whatsapp: c.whatsapp,
      isPrimary: c.isPrimary,
      isDecisionMaker: c.isDecisionMaker,
      doNotContact: c.doNotContact || suppressed.has(c.id) || full.doNotContact,
      erased: c.erasedAt !== null,
    })),
    activities: full.activities.map((a) => ({
      id: a.id,
      kind: a.kind,
      summary: a.summary,
      body: a.body,
      contact: a.contactId ? (contactName.get(a.contactId) ?? null) : null,
      fromStage: a.fromStage,
      toStage: a.toStage,
      by: a.userId ? (userName.get(a.userId) ?? null) : null,
      at: a.occurredAt.toISOString(),
      on: localDay(a.occurredAt, tz),
    })),
    samples: full.samples.map((s) => ({
      id: s.id,
      description: s.description,
      quantity: s.quantity,
      status: s.status,
      courier: s.courier,
      trackingNo: s.trackingNo,
      sentOn: s.sentOn ? dateOnly(s.sentOn) : null,
      feedback: s.feedback,
    })),
    files: full.files.map((f) => ({
      id: f.id,
      fileId: f.file.id,
      fileName: f.file.fileName,
      sizeKb: Math.ceil(f.file.sizeBytes / 1024),
      addedOn: localDay(f.createdAt, tz),
    })),
    people: ctx.can("leads.assign") ? people : [],
    sources,
    access: { ...leadAccess(ctx), sendMine: true },
  };
}

export type LeadDetail = Awaited<ReturnType<typeof getLead>>;

// =============================================================================
// Writing
// =============================================================================

async function nextLeadNumber(db: Db | Tx, companyId: string) {
  const rows = await db.lead.findMany({
    where: { companyId, number: { startsWith: "LD-" } },
    select: { number: true },
  });
  const max = rows.reduce((m, r) => {
    const n = Number(r.number.slice(3));
    return Number.isInteger(n) && n > m ? n : m;
  }, 0);
  return leadNumber(max + 1);
}

/** "Add lead": the company, its first contact, where it came from, who follows it and the next step. */
export async function addLead(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  mustManage(ctx);
  const input = addLeadSchema.parse(raw);
  await ensureSources(ctx.company.id);
  // Without leads.assign a new lead is your own or nobody's.
  let owner: string | null = ctx.user.id;
  if (input.ownerUserId === null) owner = null;
  else if (input.ownerUserId && input.ownerUserId !== ctx.user.id) {
    if (!ctx.can("leads.assign")) {
      throw new AppError("FORBIDDEN", "Giving leads to other people is not part of your role.");
    }
    owner = await assertOwner(ctx, input.ownerUserId);
  }
  const sourceId = await assertSource(ctx, input.sourceId);

  const keys = keysOf({
    name: input.name,
    country: input.country,
    website: input.website,
    emails: [input.contact?.email],
    phones: [input.contact?.phone, input.contact?.whatsapp],
  });
  const matches = matchDuplicates(keys, await candidates(ctx));
  const sameLead = matches.find((m) => m.kind === "LEAD" && m.strong);
  if (sameLead) {
    throw new AppError(
      "CONFLICT",
      `This lead is already there: ${sameLead.label} (${sameLead.why}). Open that one instead.`,
      { name: [`Already there: ${sameLead.label}`] },
    );
  }
  if (matches.length > 0 && !input.confirmDuplicate) {
    throw new AppError(
      "CONFLICT",
      `This looks like ${matches[0]!.label} (${matches[0]!.why}). Check it, or save it anyway.`,
      { confirmDuplicate: matches.map((m) => `${m.label}: ${m.why}`) },
    );
  }

  const settings = await leadSettingsOf(ctx.company.id);
  const nextOn = input.nextActionOn ?? addDays(todayOf(ctx), settings.followUpDays);
  const suppressed = input.contact ? await isSuppressed(ctx.company.id, input.contact) : false;

  for (let attempt = 0; ; attempt++) {
    try {
      const lead = await prisma.$transaction(async (tx) => {
        const created = await tx.lead.create({
          data: {
            companyId: ctx.company.id,
            number: await nextLeadNumber(tx, ctx.company.id),
            name: input.name,
            website: input.website,
            websiteDomain: websiteDomain(input.website),
            country: input.country,
            city: input.city,
            category: input.category,
            products: input.products,
            piecesPerStyle: input.piecesPerStyle ?? null,
            targetPrice: input.targetPrice ?? null,
            expectedValue: input.expectedValue ?? null,
            paymentTerms: input.paymentTerms ?? null,
            ownerUserId: owner,
            sourceId,
            sourceNote: input.sourceNote,
            nextActionOn: dateColumn(nextOn),
            nextActionKind: input.nextActionKind ?? "EMAIL",
            nextActionNote: input.nextActionNote,
            createdById: ctx.user.id,
          },
        });
        if (input.contact) {
          await tx.leadContact.create({
            data: {
              companyId: ctx.company.id,
              leadId: created.id,
              ...input.contact,
              emailDomain: companyDomain(input.contact.email),
              isPrimary: true,
              doNotContact: suppressed,
            },
          });
        }
        await addActivity(tx, ctx, created.id, {
          kind: "NOTE",
          summary: `Lead added${matches.length ? " (saved although it looked like one already there)" : ""}`,
        });
        await auditInCompany(
          ctx,
          meta,
          {
            action: "CREATE",
            entityType: "Lead",
            entityId: created.id,
            summary: `Added lead ${created.number} "${created.name}"`,
          },
          tx,
        );
        return created;
      });
      return { id: lead.id, number: lead.number, suppressed };
    } catch (error) {
      const clash = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
      if (!clash || attempt >= 5) throw error;
    }
  }
}

const EDIT_WORDS: Record<string, string> = {
  name: "name",
  website: "website",
  country: "country",
  city: "city",
  category: "kind of company",
  products: "products",
  piecesPerStyle: "pieces per style",
  targetPrice: "their price",
  expectedValue: "expected value",
  paymentTerms: "payment",
  sourceId: "source",
  sourceNote: "source note",
  doNotContact: "do not contact",
};

export async function editLead(
  ctx: CompanyContext,
  leadId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  mustManage(ctx);
  const lead = await leadOrThrow(ctx, leadId);
  const input = editLeadSchema.parse(raw);
  if (input.sourceId !== undefined) await assertSource(ctx, input.sourceId);
  const changed = Object.keys(input).filter((k) => k in EDIT_WORDS);
  const data: Prisma.LeadUncheckedUpdateInput = { ...input };
  if (input.website !== undefined) data.websiteDomain = websiteDomain(input.website);
  await ctx.db.lead.update({ where: { id: lead.id }, data });
  if (changed.length > 0) {
    await addActivity(prisma, ctx, lead.id, {
      kind: "EDIT",
      summary: `Details changed: ${changed.map((k) => EDIT_WORDS[k]).join(", ")}`,
    });
  }
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "Lead",
    entityId: lead.id,
    summary: `Changed lead ${lead.number}: ${changed.map((k) => EDIT_WORDS[k]).join(", ")}`,
  });
}

/** "Log activity": a call, a meeting, an email or WhatsApp sent or received, a note. */
export async function logLeadActivity(
  ctx: CompanyContext,
  leadId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  mustManage(ctx);
  const lead = await leadOrThrow(ctx, leadId);
  const input = logActivitySchema.parse(raw);
  if (input.contactId) await contactOf(ctx, lead.id, input.contactId);
  const tz = ctx.company.timezone;
  const today = todayOf(ctx);
  if (input.occurredOn && input.occurredOn > today) {
    throw new AppError("VALIDATION", "It cannot have happened after today.", {
      occurredOn: ["Pick today or a day before"],
    });
  }
  await addActivity(prisma, ctx, lead.id, {
    kind: input.kind,
    summary: input.summary,
    body: input.body,
    contactId: input.contactId ?? null,
    occurredAt:
      input.occurredOn && input.occurredOn !== today
        ? startOfDayInZone(input.occurredOn, tz)
        : undefined,
  });
  // The first contact moves a new lead on.
  if (lead.stage === "NEW" && input.kind !== "NOTE") {
    await moveStage(ctx, lead, "CONTACTED", null);
  }
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "Lead",
    entityId: lead.id,
    summary: `Logged on lead ${lead.number}: ${input.summary}`,
  });
}

async function moveStage(
  ctx: CompanyContext,
  lead: Lead,
  stage: LeadStage,
  reason: string | null,
  db: Db | Tx = prisma,
) {
  const now = new Date();
  await db.lead.update({
    where: { id: lead.id, companyId: ctx.company.id },
    data: {
      stage,
      stageChangedAt: now,
      ...(stage === "WON" ? { wonAt: now } : {}),
      ...(stage === "LOST" ? { lostAt: now, lostReason: reason } : {}),
    },
  });
  await addActivity(db, ctx, lead.id, {
    kind: "STAGE",
    summary: `${STAGE_LABELS[lead.stage]} → ${STAGE_LABELS[stage]}${reason ? `: ${reason}` : ""}`,
    fromStage: lead.stage,
    toStage: stage,
  });
}

/** "Change stage": Won, Lost (with its reason) or Nurture (with a day to look again) too. */
export async function changeLeadStage(
  ctx: CompanyContext,
  leadId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  mustManage(ctx);
  const lead = await leadOrThrow(ctx, leadId);
  const input = stageSchema.parse(raw);
  if (input.stage === lead.stage) return;
  if (input.stage === "LOST" && !input.reason) {
    throw new AppError("VALIDATION", "Say why it was lost.", { reason: ["Say why it was lost"] });
  }
  if (input.stage === "NURTURE" && !input.lookAgainOn) {
    throw new AppError("VALIDATION", "Pick the day to look at it again.", {
      lookAgainOn: ["Pick the day to look at it again"],
    });
  }
  await prisma.$transaction(async (tx) => {
    await moveStage(ctx, lead, input.stage, input.reason ?? null, tx);
    if (input.stage === "NURTURE") {
      await tx.lead.update({
        where: { id: lead.id, companyId: ctx.company.id },
        data: { nextActionOn: dateColumn(input.lookAgainOn!), nextActionKind: "OTHER" },
      });
    }
  });
  await auditInCompany(ctx, meta, {
    action: "STATUS_CHANGE",
    entityType: "Lead",
    entityId: lead.id,
    summary: `Lead ${lead.number}: ${STAGE_LABELS[lead.stage]} → ${STAGE_LABELS[input.stage]}`,
  });
}

/** "Set next step": what to do next and on which day (the reminders follow it). */
export async function setNextStep(
  ctx: CompanyContext,
  leadId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  mustManage(ctx);
  const lead = await leadOrThrow(ctx, leadId);
  const input = nextStepSchema.parse(raw);
  await ctx.db.lead.update({
    where: { id: lead.id },
    data: {
      nextActionOn: dateColumn(input.nextActionOn),
      nextActionKind: input.nextActionKind,
      nextActionNote: input.nextActionNote,
    },
  });
  await addActivity(prisma, ctx, lead.id, {
    kind: "NEXT_STEP",
    summary: `Next step: ${input.nextActionKind.toLowerCase()} on ${input.nextActionOn}${input.nextActionNote ? ` (${input.nextActionNote})` : ""}`,
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "Lead",
    entityId: lead.id,
    summary: `Lead ${lead.number}: next step on ${input.nextActionOn}`,
  });
}

/** "Give to": only with leads.assign. */
export async function assignLead(
  ctx: CompanyContext,
  leadId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  mustManage(ctx);
  if (!ctx.can("leads.assign")) {
    throw new AppError("FORBIDDEN", "Giving leads to other people is not part of your role.");
  }
  const lead = await leadOrThrow(ctx, leadId);
  const { ownerUserId } = assignSchema.parse(raw);
  const owner = await assertOwner(ctx, ownerUserId);
  if (owner === lead.ownerUserId) return;
  const name = owner
    ? (await prisma.user.findUnique({ where: { id: owner }, select: { name: true } }))?.name
    : null;
  await ctx.db.lead.update({ where: { id: lead.id }, data: { ownerUserId: owner } });
  await addActivity(prisma, ctx, lead.id, {
    kind: "ASSIGN",
    summary: name ? `Given to ${name}` : "Not given to anyone now",
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "Lead",
    entityId: lead.id,
    summary: `Lead ${lead.number}: ${name ? `given to ${name}` : "not given to anyone"}`,
  });
}

/** "Archive" / "Bring back": a lead is never deleted. */
export async function setLeadArchived(
  ctx: CompanyContext,
  leadId: string,
  archived: boolean,
  meta?: RequestMeta,
) {
  mustManage(ctx);
  const lead = await leadOrThrow(ctx, leadId);
  await ctx.db.lead.update({
    where: { id: lead.id },
    data: { archivedAt: archived ? new Date() : null },
  });
  await addActivity(prisma, ctx, lead.id, {
    kind: "NOTE",
    summary: archived ? "Archived" : "Brought back from the archive",
  });
  await auditInCompany(ctx, meta, {
    action: "STATUS_CHANGE",
    entityType: "Lead",
    entityId: lead.id,
    summary: `Lead ${lead.number}: ${archived ? "archived" : "brought back"}`,
  });
}

// --- Contacts ------------------------------------------------------------------------------

async function contactOf(ctx: CompanyContext, leadId: string, contactId: string) {
  const contact = await ctx.db.leadContact.findFirst({ where: { id: contactId, leadId } });
  if (!contact) throw new AppError("NOT_FOUND", "Contact not found.");
  return contact;
}

export async function addLeadContact(
  ctx: CompanyContext,
  leadId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  mustManage(ctx);
  const lead = await leadOrThrow(ctx, leadId);
  const input = contactSchema.parse(raw);
  const suppressed = await isSuppressed(ctx.company.id, input);
  const first = (await ctx.db.leadContact.count({ where: { leadId: lead.id } })) === 0;
  const contact = await prisma.$transaction(async (tx) => {
    if (input.isPrimary) {
      await tx.leadContact.updateMany({
        where: { leadId: lead.id, companyId: ctx.company.id },
        data: { isPrimary: false },
      });
    }
    const created = await tx.leadContact.create({
      data: {
        companyId: ctx.company.id,
        leadId: lead.id,
        ...input,
        isPrimary: input.isPrimary || first,
        emailDomain: companyDomain(input.email),
        doNotContact: suppressed,
      },
    });
    await addActivity(tx, ctx, lead.id, {
      kind: "CONTACT",
      summary: `Contact added${input.isDecisionMaker ? " (decides)" : ""}`,
      contactId: created.id,
    });
    return created;
  });
  await auditInCompany(ctx, meta, {
    action: "CREATE",
    entityType: "LeadContact",
    entityId: contact.id,
    summary: `Added a contact to lead ${lead.number}`,
  });
  return { id: contact.id, suppressed };
}

export async function updateLeadContact(
  ctx: CompanyContext,
  leadId: string,
  contactId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  mustManage(ctx);
  const lead = await leadOrThrow(ctx, leadId);
  const contact = await contactOf(ctx, lead.id, contactId);
  if (contact.erasedAt) {
    throw new AppError("CONFLICT", "This person's data was erased; add them again if needed.");
  }
  const input = contactUpdateSchema.parse(raw);
  const merged = { ...contact, ...input };
  const suppressed = await isSuppressed(ctx.company.id, merged);
  await prisma.$transaction(async (tx) => {
    if (input.isPrimary) {
      await tx.leadContact.updateMany({
        where: { leadId: lead.id, companyId: ctx.company.id },
        data: { isPrimary: false },
      });
    }
    await tx.leadContact.update({
      where: { id: contact.id, companyId: ctx.company.id },
      data: {
        ...input,
        ...(input.email !== undefined ? { emailDomain: companyDomain(input.email) } : {}),
        // The list always wins: a contact on it cannot be ticked back.
        doNotContact: suppressed || (input.doNotContact ?? contact.doNotContact),
      },
    });
    await addActivity(tx, ctx, lead.id, {
      kind: "CONTACT",
      summary: "Contact details changed",
      contactId: contact.id,
    });
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "LeadContact",
    entityId: contact.id,
    summary: `Changed a contact of lead ${lead.number}`,
  });
}

/**
 * "Erase personal data" (leads.erase, with the PIN): the person's name, job title,
 * email and phones are blanked for good, and their own email and phones go on the
 * "Do not contact" list as a hash, so they are never contacted again. Their email's
 * company domain is not added: other people at that company may still be contacted.
 * The lead, its history (which names no one) and anything else stay. The reason
 * typed is kept in the lead's history and the activity log.
 */
export async function eraseLeadContact(
  ctx: CompanyContext,
  leadId: string,
  contactId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  mustView(ctx);
  if (!ctx.can("leads.erase")) {
    throw new AppError("FORBIDDEN", "Erasing personal data is not part of your role.");
  }
  const input = eraseSchema.parse(raw);
  const lead = await leadOrThrow(ctx, leadId);
  const contact = await contactOf(ctx, lead.id, contactId);
  if (contact.erasedAt) return;
  await requirePin(ctx, input.pin, "erase a person's data");

  const values: Array<{ kind: "EMAIL" | "PHONE"; value: string }> = [];
  const email = cleanEmail(contact.email);
  if (email) values.push({ kind: "EMAIL", value: email });
  for (const phone of new Set([phoneDigits(contact.phone), phoneDigits(contact.whatsapp)])) {
    if (phone) values.push({ kind: "PHONE", value: phone });
  }
  await prisma.$transaction(async (tx) => {
    for (const v of values) {
      const valueHash = suppressionHash(ctx.company.id, v.value);
      await tx.leadSuppression.upsert({
        where: {
          companyId_kind_valueHash: { companyId: ctx.company.id, kind: v.kind, valueHash },
        },
        create: {
          companyId: ctx.company.id,
          kind: v.kind,
          valueHash,
          valueHint: suppressionHint(v.kind, v.value),
          reason: "ERASED",
          createdById: ctx.user.id,
        },
        update: { reason: "ERASED" },
      });
    }
    await tx.leadContact.update({
      where: { id: contact.id, companyId: ctx.company.id },
      data: {
        name: "Erased contact",
        jobTitle: null,
        email: null,
        emailDomain: null,
        phone: null,
        whatsapp: null,
        isDecisionMaker: false,
        doNotContact: true,
        erasedAt: new Date(),
      },
    });
    await addActivity(tx, ctx, lead.id, {
      kind: "ERASE",
      summary: `A contact's personal data was erased; they stay on "Do not contact"${
        input.reason ? ` (why: ${input.reason})` : ""
      }`,
      contactId: contact.id,
    });
  });
  // The log names no one: only that a contact of this lead was erased.
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "LeadContact",
    entityId: contact.id,
    summary: `Erased the personal data of a contact of lead ${lead.number}${
      input.reason ? ` (why: ${input.reason})` : ""
    }`,
  });
}

/** The email and WhatsApp buttons opened the person's own app: "I sent it" logs it. */
export async function logMessageSent(
  ctx: CompanyContext,
  leadId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  mustManage(ctx);
  const lead = await leadOrThrow(ctx, leadId);
  const input = messageSentSchema.parse(raw);
  const contact = await contactOf(ctx, lead.id, input.contactId);
  if (
    lead.doNotContact ||
    contact.doNotContact ||
    contact.erasedAt ||
    (await isSuppressed(ctx.company.id, contact))
  ) {
    throw new AppError("CONFLICT", 'This person is on "Do not contact".');
  }
  await addActivity(prisma, ctx, lead.id, {
    kind: input.channel === "EMAIL" ? "EMAIL_OUT" : "WHATSAPP",
    summary:
      input.channel === "EMAIL"
        ? `Email sent from my own mail${input.subject ? `: ${input.subject}` : ""}`
        : "WhatsApp message sent from my own WhatsApp",
    contactId: contact.id,
  });
  if (lead.stage === "NEW") await moveStage(ctx, lead, "CONTACTED", null);
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "Lead",
    entityId: lead.id,
    summary: `Lead ${lead.number}: ${input.channel === "EMAIL" ? "email" : "WhatsApp"} logged`,
  });
}

// --- Samples and files -----------------------------------------------------------------------

const SAMPLE_WORDS: Record<string, string> = {
  REQUESTED: "requested",
  IN_MAKING: "in making",
  DISPATCHED: "sent",
  FEEDBACK: "feedback in",
  APPROVED: "approved",
  REJECTED: "rejected",
};

export async function addLeadSample(
  ctx: CompanyContext,
  leadId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  mustManage(ctx);
  const lead = await leadOrThrow(ctx, leadId);
  const input = sampleSchema.parse(raw);
  const sample = await prisma.$transaction(async (tx) => {
    const created = await tx.leadSample.create({
      data: {
        companyId: ctx.company.id,
        leadId: lead.id,
        description: input.description,
        quantity: input.quantity ?? null,
        status: input.status,
        courier: input.courier,
        trackingNo: input.trackingNo,
        sentOn: input.sentOn ? dateColumn(input.sentOn) : null,
        feedback: input.feedback,
        createdById: ctx.user.id,
      },
    });
    await addActivity(tx, ctx, lead.id, {
      kind: "SAMPLE",
      summary: `Sample ${SAMPLE_WORDS[created.status]}: ${created.description}`,
    });
    return created;
  });
  if (["NEW", "CONTACTED", "IN_TALKS"].includes(lead.stage)) {
    await moveStage(ctx, lead, "SAMPLING", null);
  }
  await auditInCompany(ctx, meta, {
    action: "CREATE",
    entityType: "LeadSample",
    entityId: sample.id,
    summary: `Sample for lead ${lead.number}: ${sample.description}`,
  });
  return { id: sample.id };
}

export async function updateLeadSample(
  ctx: CompanyContext,
  leadId: string,
  sampleId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  mustManage(ctx);
  const lead = await leadOrThrow(ctx, leadId);
  const sample = await ctx.db.leadSample.findFirst({ where: { id: sampleId, leadId: lead.id } });
  if (!sample) throw new AppError("NOT_FOUND", "Sample not found.");
  const input = sampleUpdateSchema.parse(raw);
  await ctx.db.leadSample.update({
    where: { id: sample.id },
    data: {
      ...input,
      ...(input.sentOn !== undefined
        ? { sentOn: input.sentOn ? dateColumn(input.sentOn) : null }
        : {}),
    },
  });
  const status = input.status ?? sample.status;
  await addActivity(prisma, ctx, lead.id, {
    kind: "SAMPLE",
    summary: `Sample ${SAMPLE_WORDS[status]}: ${input.description ?? sample.description}${input.feedback ? ` (${input.feedback})` : ""}`,
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "LeadSample",
    entityId: sample.id,
    summary: `Sample of lead ${lead.number}: ${SAMPLE_WORDS[status]}`,
  });
}

export async function addLeadFile(
  ctx: CompanyContext,
  leadId: string,
  upload: { fileName: string; bytes: Buffer },
  meta?: RequestMeta,
) {
  mustManage(ctx);
  const lead = await leadOrThrow(ctx, leadId);
  const file = await storeUpload(ctx, upload, meta);
  await ctx.db.leadFile.create({
    data: { companyId: ctx.company.id, leadId: lead.id, fileId: file.id, addedById: ctx.user.id },
  });
  await addActivity(prisma, ctx, lead.id, {
    kind: "FILE",
    summary: `File added: ${file.fileName}`,
  });
  return { id: file.id };
}

// =============================================================================
// Becoming a buyer
// =============================================================================

/**
 * "Make buyer": the buyer is made through the normal path (code, audit), or an
 * existing buyer is linked. One transaction that locks the lead first, so two
 * clicks never make two buyers. The lead keeps its history, and the buyer's page
 * shows where it came from.
 */
export async function makeBuyer(
  ctx: CompanyContext,
  leadId: string,
  raw: unknown = {},
  meta?: RequestMeta,
) {
  mustManage(ctx);
  if (!leadAccess(ctx).convert) {
    throw new AppError("FORBIDDEN", "Making a lead a buyer is not part of your role.");
  }
  const lead = await leadOrThrow(ctx, leadId);
  if (lead.partyId) {
    const party = await ctx.db.party.findFirst({ where: { id: lead.partyId } });
    if (party) return { partyId: party.id, code: party.code, created: false };
  }
  const { partyId } = makeBuyerSchema.parse(raw);
  const companyId = ctx.company.id;
  const contact = partyId
    ? null
    : await ctx.db.leadContact.findFirst({
        where: { leadId: lead.id, erasedAt: null },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      });

  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        // The lead is locked and checked first: a second click waits here, then stops.
        await tx.$queryRaw`SELECT "id" FROM "Lead" WHERE "id" = ${lead.id} AND "companyId" = ${companyId} FOR UPDATE`;
        const fresh = await tx.lead.findFirst({
          where: { id: lead.id, companyId },
          select: { partyId: true },
        });
        if (fresh?.partyId) {
          throw new AppError("CONFLICT", "This lead was just made a buyer by someone else.");
        }
        let party: { id: string; code: string; name: string };
        let created = false;
        if (partyId) {
          const found = await tx.party.findFirst({
            where: { id: partyId, companyId, kind: { in: ["BUYER", "BOTH"] }, systemRole: null },
          });
          if (!found) throw new AppError("NOT_FOUND", "Buyer not found.");
          const taken = await tx.lead.findFirst({ where: { companyId, partyId: found.id } });
          if (taken) {
            throw new AppError("CONFLICT", `That buyer already came from lead ${taken.number}.`);
          }
          party = found;
        } else {
          const result = await createParty(
            ctx,
            {
              kind: "BUYER",
              buyerType: ["CORPORATE_UNIFORM", "PROMOTIONAL"].includes(lead.category)
                ? "B2B_CORPORATE"
                : "WHOLESALE",
              name: lead.name,
              contactPerson: contact?.name ?? null,
              phone: contact?.phone ?? null,
              whatsapp: contact?.whatsapp ?? null,
              email: contact?.email ?? null,
              city: lead.city,
              country: lead.country,
              tradePayment: lead.paymentTerms,
              notes: `From lead ${lead.number}${lead.website ? ` · ${lead.website}` : ""}`,
            },
            meta,
            tx,
          );
          party = result.party;
          created = true;
        }
        await tx.lead.update({
          where: { id: lead.id, companyId },
          data: { partyId: party.id, convertedAt: new Date(), convertedById: ctx.user.id },
        });
        await addActivity(tx, ctx, lead.id, {
          kind: "CONVERT",
          summary: `${created ? "Made buyer" : "Linked to buyer"} ${party.code} ${party.name}`,
        });
        await auditInCompany(
          ctx,
          meta,
          {
            action: "UPDATE",
            entityType: "Lead",
            entityId: lead.id,
            summary: `Lead ${lead.number} ${created ? "made buyer" : "linked to buyer"} ${party.code}`,
          },
          tx,
        );
        return { partyId: party.id, code: party.code, created };
      });
    } catch (error) {
      // Two people made a buyer at once and picked the same code: try again.
      const codeClash =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        String(error.meta?.target ?? "").includes("code");
      if (!codeClash || attempt >= 4) throw error;
    }
  }
}

/**
 * A quotation was written for a buyer that came from a lead: the lead moves to
 * Quoted (when it was before it) and its history says so. Runs inside the
 * quotation's transaction.
 */
export async function noteQuotationOnLead(
  tx: Tx,
  ctx: CompanyContext,
  partyId: string,
  quotationNumber: string,
) {
  const lead = await tx.lead.findFirst({ where: { companyId: ctx.company.id, partyId } });
  if (!lead) return;
  await addActivity(tx, ctx, lead.id, {
    kind: "NOTE",
    summary: `Quotation ${quotationNumber} written`,
  });
  if (["NEW", "CONTACTED", "IN_TALKS", "SAMPLING"].includes(lead.stage)) {
    await moveStage(ctx, lead, "QUOTED", null, tx);
  }
}

/** The buyer a new quotation starts with ("New quotation" on a lead): only a buyer of this company. */
export async function quotationBuyer(ctx: CompanyContext, partyId: string) {
  if (!ctx.can("sales.quotation.manage")) {
    throw new AppError("FORBIDDEN", "Making quotations is not part of your role.");
  }
  return ctx.db.party.findFirst({
    where: { id: partyId, kind: { in: ["BUYER", "BOTH"] }, systemRole: null },
    select: { id: true, code: true, name: true },
  });
}

/** Buyer 360's "Came from lead" block: the lead and its history, for those who see leads. */
export async function leadOfBuyer(ctx: CompanyContext, partyId: string) {
  if (!leadAccess(ctx).view) return null;
  const lead = await ctx.db.lead.findFirst({
    where: { partyId, ...visibleLeads(ctx) },
    include: {
      source: { select: { name: true } },
      activities: { orderBy: { occurredAt: "desc" }, take: 20 },
    },
  });
  if (!lead) return null;
  return {
    id: lead.id,
    number: lead.number,
    source: lead.source?.name ?? null,
    sourceNote: lead.sourceNote,
    addedOn: localDay(lead.createdAt, ctx.company.timezone),
    history: lead.activities.map((a) => ({
      id: a.id,
      kind: a.kind,
      summary: a.summary,
      on: localDay(a.occurredAt, ctx.company.timezone),
    })),
  };
}

// =============================================================================
// Follow-ups, reports and the export
// =============================================================================

/** Home's "Lead follow-ups" card: open or Nurture leads whose next step is today or late. */
export async function leadFollowUps(ctx: CompanyContext, now = new Date(), limit = 6) {
  if (!leadAccess(ctx).view) return null;
  const today = todayOf(ctx, now);
  const where: Prisma.LeadWhereInput = {
    AND: [
      visibleLeads(ctx),
      { archivedAt: null, stage: { in: [...FOLLOW_UP_STAGES] } },
      { nextActionOn: { lte: dateColumn(today) } },
    ],
  };
  const [count, rows] = await Promise.all([
    ctx.db.lead.count({ where }),
    ctx.db.lead.findMany({
      where,
      orderBy: [{ nextActionOn: "asc" }, { id: "asc" }],
      take: limit,
      select: {
        id: true,
        number: true,
        name: true,
        nextActionOn: true,
        nextActionKind: true,
        nextActionNote: true,
      },
    }),
  ]);
  return {
    count,
    items: rows.map((r) => {
      const on = dateOnly(r.nextActionOn!);
      return {
        id: r.id,
        number: r.number,
        name: r.name,
        on,
        late: on < today,
        kind: r.nextActionKind,
        note: r.nextActionNote,
      };
    }),
  };
}

/** Leads > Reports: by source (a fair is a source), won and lost, and value. */
export async function leadReport(ctx: CompanyContext, raw: unknown = {}) {
  mustView(ctx);
  const f = reportSchema.parse(raw);
  const tz = ctx.company.timezone;
  const created: Prisma.DateTimeFilter = {};
  if (f.from) created.gte = startOfDayInZone(f.from, tz);
  if (f.to) created.lt = startOfDayInZone(nextDay(f.to), tz);
  const leads = await ctx.db.lead.findMany({
    where: { AND: [visibleLeads(ctx), f.from || f.to ? { createdAt: created } : {}] },
    select: {
      stage: true,
      expectedValue: true,
      partyId: true,
      lostReason: true,
      source: { select: { id: true, name: true } },
    },
  });
  // The orders money column only for those who see sales or the money figures.
  const seesOrders = canSeeSalesAmounts(ctx);
  const partyIds = leads.map((l) => l.partyId).filter(Boolean) as string[];
  const sales =
    seesOrders && partyIds.length
      ? await ctx.db.salesOrder.groupBy({
          by: ["partyId"],
          where: { partyId: { in: partyIds }, status: { not: "CANCELLED" } },
          _sum: { total: true },
        })
      : [];
  const salesOf = new Map(sales.map((s) => [s.partyId, s._sum.total ?? new Prisma.Decimal(0)]));

  type Line = {
    source: string;
    leads: number;
    open: number;
    won: number;
    lost: number;
    buyers: number;
    pipeline: Prisma.Decimal;
    orders: Prisma.Decimal;
  };
  const bySource = new Map<string, Line>();
  const lost = new Map<string, number>();
  for (const l of leads) {
    const key = l.source?.name ?? "No source";
    const line =
      bySource.get(key) ??
      ({
        source: key,
        leads: 0,
        open: 0,
        won: 0,
        lost: 0,
        buyers: 0,
        pipeline: new Prisma.Decimal(0),
        orders: new Prisma.Decimal(0),
      } satisfies Line);
    line.leads += 1;
    if (isOpenStage(l.stage)) {
      line.open += 1;
      line.pipeline = line.pipeline.plus(l.expectedValue ?? 0);
    }
    if (l.stage === "WON") line.won += 1;
    if (l.stage === "LOST") {
      line.lost += 1;
      const reason = l.lostReason?.trim() || "No reason given";
      lost.set(reason, (lost.get(reason) ?? 0) + 1);
    }
    if (l.partyId) {
      line.buyers += 1;
      line.orders = line.orders.plus(salesOf.get(l.partyId) ?? 0);
    }
    bySource.set(key, line);
  }
  const lines = [...bySource.values()].sort((a, b) => b.leads - a.leads);
  const total = lines.reduce(
    (t, l) => ({
      leads: t.leads + l.leads,
      open: t.open + l.open,
      won: t.won + l.won,
      lost: t.lost + l.lost,
      buyers: t.buyers + l.buyers,
      pipeline: t.pipeline.plus(l.pipeline),
      orders: t.orders.plus(l.orders),
    }),
    {
      leads: 0,
      open: 0,
      won: 0,
      lost: 0,
      buyers: 0,
      pipeline: new Prisma.Decimal(0),
      orders: new Prisma.Decimal(0),
    },
  );
  const byStage = new Map<LeadStage, number>();
  for (const l of leads) byStage.set(l.stage, (byStage.get(l.stage) ?? 0) + 1);
  const money = (d: Prisma.Decimal) => d.toFixed(2);
  return {
    from: f.from ?? null,
    to: f.to ?? null,
    currency: ctx.company.currency,
    seesAll: ctx.can("leads.all"),
    seesOrders,
    lines: lines.map((l) => ({
      ...l,
      pipeline: money(l.pipeline),
      orders: seesOrders ? money(l.orders) : null,
    })),
    total: {
      ...total,
      pipeline: money(total.pipeline),
      orders: seesOrders ? money(total.orders) : null,
    },
    stages: [...byStage].map(([stage, count]) => ({ stage, count })),
    lostReasons: [...lost]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
  };
}

const csvCell = (v: string | number | null | undefined) => {
  const text = v === null || v === undefined ? "" : String(v);
  // A cell a spreadsheet would run as a formula starts with a quote mark instead.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** The lead list as a spreadsheet (CSV): only for leads.export (the owner), and logged. */
export async function exportLeads(ctx: CompanyContext, meta?: RequestMeta) {
  mustView(ctx);
  if (!ctx.can("leads.export")) {
    throw new AppError("FORBIDDEN", "Downloading the lead list is only for the owner.");
  }
  const rows = await ctx.db.lead.findMany({
    where: visibleLeads(ctx),
    orderBy: { number: "asc" },
    include: {
      owner: { select: { name: true } },
      source: { select: { name: true } },
      contacts: {
        where: { erasedAt: null },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        take: 1,
      },
    },
  });
  const tz = ctx.company.timezone;
  const header = [
    "Number",
    "Company",
    "Country",
    "Kind",
    "Stage",
    "Follows up",
    "Source",
    "Next step",
    "Contact",
    "Email",
    "Phone",
    "Do not contact",
    `Expected value (${ctx.company.currency})`,
    "Added",
    "Archived",
  ];
  const lines = rows.map((l) => {
    const c = l.contacts[0];
    const blocked = l.doNotContact || c?.doNotContact;
    return [
      l.number,
      l.name,
      l.country,
      l.category,
      STAGE_LABELS[l.stage],
      l.owner?.name ?? "",
      l.source?.name ?? "",
      l.nextActionOn ? dateOnly(l.nextActionOn) : "",
      c?.name ?? "",
      blocked ? "" : (c?.email ?? ""),
      blocked ? "" : (c?.phone ?? c?.whatsapp ?? ""),
      blocked ? "Yes" : "",
      l.expectedValue?.toFixed(2) ?? "",
      localDay(l.createdAt, tz),
      l.archivedAt ? "Yes" : "",
    ]
      .map(csvCell)
      .join(",");
  });
  await auditInCompany(ctx, meta, {
    action: "EXPORT",
    entityType: "Lead",
    summary: `Downloaded the lead list (${rows.length} leads)`,
  });
  const text = `﻿${[header.join(","), ...lines].join("\r\n")}\r\n`;
  return {
    fileName: `leads-${localDay(new Date(), tz)}.csv`,
    mimeType: "text/csv",
    bytes: Buffer.from(text, "utf8"),
  };
}
