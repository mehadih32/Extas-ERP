import { type ContractKind, type MeasurementUnit, Prisma } from "@prisma/client";

import { quantity as materialQuantity, UNIT_LABELS } from "@/components/materials/labels";
import { aiText, aiTextOn } from "@/lib/ai-text";
import { dateColumn, dateOnly, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { formatAmount, formatDay } from "@/lib/format";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { runTransaction } from "@/lib/transaction";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { letterheadOf } from "@/modules/documents/builders";
import { documentFileName, type PrintDocument, type Row } from "@/modules/documents/model";
import { ON_DEMAND_PER_MINUTE, renderOnDemand } from "@/modules/documents/on-demand";
import { assertPartyCanTransact } from "@/modules/parties/party.service";
import { batchMaterialPlan } from "@/modules/production/batch-orders.service";
import {
  type Clause,
  CONTRACT_TITLES,
  type ContractFacts,
  parseClauses,
  readClauses,
  ruleClauses,
} from "@/modules/production/contract-terms";
import { createContractSchema, updateContractSchema } from "@/modules/production/schemas";
import { OPEN_STATUSES } from "@/modules/production/timeline";

/*
 * A master batch's contracts: a fabric agreement with each fabric supplier, an
 * accessories agreement with each trims supplier and a making (CM) agreement
 * with the factory. A draft is worded from the batch (AI when set up, plain
 * rules otherwise), its clauses are reviewed and changed, and it is printed to
 * sign. What it covers is printed from the batch as it is now: the supplier's
 * order lines for the batch (or, before ordering, what the styles still need),
 * or the factory's styles with their pieces and CM per piece. Prices and CM are
 * money, so contracts are for Production Managers and Accounts; only Production
 * Managers draft and change them. A signed contract keeps its terms until its
 * signed day is cleared.
 */

const ZERO = new Prisma.Decimal(0);
const trimmed = (d: Prisma.Decimal) => d.toFixed(3).replace(/\.?0+$/, "") || "0";
const isFabric = (kind: string) => kind === "FABRIC";

/** Who may read the batch's contracts (they carry prices and CM). */
export function canSeeContracts(ctx: Pick<CompanyContext, "can">) {
  return ctx.can("production.manage") || ctx.can("accounts.view");
}

function assertCanSee(ctx: CompanyContext) {
  if (!canSeeContracts(ctx)) {
    throw new AppError("FORBIDDEN", "Contracts are for Production Managers and Accounts.");
  }
}

function assertCanChange(ctx: CompanyContext) {
  if (!ctx.can("production.manage")) {
    throw new AppError("FORBIDDEN", "Only a Production Manager drafts and changes contracts.");
  }
}

const batchSelect = {
  id: true,
  code: true,
  name: true,
  kind: true,
  targetDate: true,
  factory: { select: { id: true, name: true } },
} satisfies Prisma.ProductionBatchSelect;

async function loadBatch(ctx: CompanyContext, batchId: string) {
  const batch = await ctx.db.productionBatch.findUnique({
    where: { id: batchId },
    select: batchSelect,
  });
  if (!batch) throw new AppError("NOT_FOUND", "Master batch not found.");
  return batch;
}

type Batch = Awaited<ReturnType<typeof loadBatch>>;

// =============================================================================
// What a contract covers
// =============================================================================

export type GoodsRow = {
  material: { code: string; name: string; unit: MeasurementUnit; details: string | null };
  quantity: Prisma.Decimal;
  /** Null: priced at receive (or, before ordering, still to agree). */
  unitPrice: Prisma.Decimal | null;
  order: string | null;
  expectedOn: string | null;
};

export type StyleRow = {
  id: string;
  code: string;
  name: string;
  pieces: number;
  cmRate: Prisma.Decimal | null;
  dueOn: string;
  closed: boolean;
};

/**
 * A supplier's goods for the batch: the lines of its orders for the batch of the
 * contract's kind (fabric, or everything else), or, before anything is ordered
 * from it, what the styles still need of the materials it usually supplies.
 */
async function supplyGoods(
  ctx: CompanyContext,
  batch: Batch,
  kind: ContractKind,
  partyId: string,
): Promise<{ rows: GoodsRow[]; ordered: boolean }> {
  const tz = ctx.company.timezone;
  const orders = await ctx.db.purchaseOrder.findMany({
    where: { batchId: batch.id, supplierId: partyId, status: { not: "CANCELLED" } },
    select: {
      number: true,
      expectedDate: true,
      lines: {
        select: {
          quantity: true,
          unitPrice: true,
          priceLater: true,
          rawMaterial: {
            select: {
              code: true,
              name: true,
              kind: true,
              unit: true,
              specification: true,
              color: true,
            },
          },
        },
        orderBy: { id: "asc" },
      },
    },
    orderBy: [{ orderDate: "asc" }, { number: "asc" }],
  });
  const fits = (materialKind: string) => isFabric(materialKind) === (kind === "FABRIC");
  const details = (m: { specification: string | null; color: string | null }) =>
    [m.specification, m.color].filter(Boolean).join(" · ") || null;
  const rows = orders.flatMap((o) =>
    o.lines
      .filter((l) => fits(l.rawMaterial.kind))
      .map((l) => ({
        material: { ...l.rawMaterial, details: details(l.rawMaterial) },
        quantity: l.quantity,
        unitPrice: l.priceLater ? null : l.unitPrice,
        order: o.number,
        expectedOn: o.expectedDate ? dateOnly(o.expectedDate) : null,
      })),
  );
  if (rows.length > 0) return { rows, ordered: true };
  const plan = await batchMaterialPlan(ctx, batch.id);
  return {
    ordered: false,
    rows: plan.materials
      .filter((m) => m.material.supplier?.id === partyId && fits(m.material.kind))
      .filter((m) => m.toOrder.gt(0))
      .map((m) => ({
        material: {
          code: m.material.code,
          name: m.material.name,
          unit: m.material.unit,
          details: m.placements.join(", ") || null,
        },
        quantity: m.toOrder,
        unitPrice: null,
        order: null,
        expectedOn: batch.targetDate ? localDay(batch.targetDate, tz) : null,
      })),
  };
}

/** The factory's styles in the batch: its own, and those with no factory when it is the batch's. */
async function factoryStyles(
  ctx: CompanyContext,
  batch: Batch,
  partyId: string,
): Promise<StyleRow[]> {
  const tz = ctx.company.timezone;
  const styles = await ctx.db.productionProject.findMany({
    where: {
      batchId: batch.id,
      status: { not: "CANCELLED" },
      OR: [{ factoryId: partyId }, ...(batch.factory?.id === partyId ? [{ factoryId: null }] : [])],
    },
    select: {
      id: true,
      code: true,
      name: true,
      targetQuantity: true,
      cmRate: true,
      targetDate: true,
      status: true,
    },
    orderBy: { code: "asc" },
  });
  return styles.map((s) => ({
    id: s.id,
    code: s.code,
    name: s.name,
    pieces: s.targetQuantity,
    cmRate: s.cmRate,
    dueOn: localDay(s.targetDate, tz),
    closed: !(OPEN_STATUSES as readonly string[]).includes(s.status),
  }));
}

type Scope =
  { kind: "SUPPLY"; goods: GoodsRow[]; ordered: boolean } | { kind: "FACTORY"; styles: StyleRow[] };

async function contractScope(
  ctx: CompanyContext,
  batch: Batch,
  kind: ContractKind,
  partyId: string,
): Promise<Scope> {
  if (kind === "FACTORY_CM") {
    return { kind: "FACTORY", styles: await factoryStyles(ctx, batch, partyId) };
  }
  const { rows, ordered } = await supplyGoods(ctx, batch, kind, partyId);
  return { kind: "SUPPLY", goods: rows, ordered };
}

// =============================================================================
// Drafting
// =============================================================================

const unitText = (unit: MeasurementUnit) => UNIT_LABELS[unit];

function contractFacts(
  ctx: CompanyContext,
  batch: Batch,
  kind: ContractKind,
  party: { name: string },
  scope: Scope,
): ContractFacts {
  const tz = ctx.company.timezone;
  const latest = (days: Array<string | null>) =>
    days
      .filter((d): d is string => Boolean(d))
      .sort()
      .at(-1) ?? null;
  const batchDue = batch.targetDate ? localDay(batch.targetDate, tz) : null;
  const due =
    scope.kind === "SUPPLY"
      ? latest(scope.goods.map((g) => g.expectedOn))
      : (latest(scope.styles.map((s) => s.dueOn)) ?? batchDue);
  return {
    kind,
    company: ctx.company.legalName?.trim() || ctx.company.name,
    party: party.name,
    batch: { code: batch.code, name: batch.name },
    dueOn: due ? formatDay(due) : null,
    pricesLater: scope.kind === "SUPPLY" && scope.goods.some((g) => g.unitPrice === null),
    materials:
      scope.kind === "SUPPLY"
        ? [...new Set(scope.goods.map((g) => `${g.material.name} (${unitText(g.material.unit)})`))]
        : [],
    styles:
      scope.kind === "FACTORY"
        ? scope.styles.map((s) => `${s.code} ${s.name} (${s.pieces} pcs)`)
        : [],
    cmAgreed: scope.kind === "FACTORY" && scope.styles.every((s) => s.cmRate !== null),
  };
}

/**
 * The clauses for a contract: the rules' draft, reworded by AI when it is set
 * up and its answer is usable (the same clauses, plainer, numbers kept).
 */
async function draftClauses(facts: ContractFacts): Promise<{ clauses: Clause[]; byAi: boolean }> {
  const rules = ruleClauses(facts);
  const ai = await aiText({
    instructions:
      "You help a garment company in Bangladesh draft a supplier or factory agreement. " +
      "You are given the facts and a draft of its clauses. Reword each clause in plain, short " +
      "English that a supplier and a factory manager understand, using these words: Short/Extra " +
      "(not variance), Final Match (not reconcile), Stock (not inventory), Supplier Due (not " +
      "accounts payable). Keep every number, day, percent and name exactly as given, keep the " +
      "same clauses in the same order, and add nothing that is not in the facts. Answer with " +
      'only a JSON array of {"title": string, "text": string}.',
    facts: { facts, draft: rules },
    maxTokens: 1800,
    maxChars: 9000,
  });
  const reworded = ai ? parseClauses(ai) : null;
  return reworded ? { clauses: reworded, byAi: true } : { clauses: rules, byAi: false };
}

// =============================================================================
// The batch's contracts
// =============================================================================

const contractSelect = {
  id: true,
  number: true,
  kind: true,
  signedOn: true,
  updatedAt: true,
  party: { select: { id: true, name: true } },
} satisfies Prisma.ProductionContractSelect;

/**
 * The batch's contracts, and the ones still to draft: a fabric agreement with
 * each supplier of its fabric, an accessories agreement with each supplier of
 * its trims (from its orders and its styles' usual suppliers) and a making
 * agreement with each factory its styles are made at.
 */
export async function getBatchContracts(ctx: CompanyContext, batchId: string) {
  assertCanSee(ctx);
  const batch = await loadBatch(ctx, batchId);
  const [contracts, orderLines, plan, factories] = await Promise.all([
    ctx.db.productionContract.findMany({
      where: { batchId: batch.id },
      select: contractSelect,
      orderBy: [{ kind: "asc" }, { createdAt: "asc" }],
    }),
    ctx.db.purchaseOrder.findMany({
      where: { batchId: batch.id, status: { not: "CANCELLED" } },
      select: {
        supplier: { select: { id: true, name: true } },
        lines: { select: { rawMaterial: { select: { kind: true } } } },
      },
    }),
    batchMaterialPlan(ctx, batch.id),
    ctx.db.productionProject.findMany({
      where: { batchId: batch.id, status: { not: "CANCELLED" }, factoryId: { not: null } },
      select: { factory: { select: { id: true, name: true } } },
      distinct: ["factoryId"],
    }),
  ]);
  const wanted = new Map<string, { kind: ContractKind; party: { id: string; name: string } }>();
  const want = (kind: ContractKind, party: { id: string; name: string } | null | undefined) => {
    if (party) wanted.set(`${kind}|${party.id}`, { kind, party });
  };
  for (const o of orderLines) {
    for (const l of o.lines)
      want(isFabric(l.rawMaterial.kind) ? "FABRIC" : "ACCESSORIES", o.supplier);
  }
  for (const m of plan.materials) {
    if (m.material.supplier) {
      want(isFabric(m.material.kind) ? "FABRIC" : "ACCESSORIES", m.material.supplier);
    }
  }
  if (batch.kind === "CM") {
    want("FACTORY_CM", batch.factory);
    for (const f of factories) want("FACTORY_CM", f.factory);
  }
  for (const c of contracts) wanted.delete(`${c.kind}|${c.party.id}`);
  const KINDS: ContractKind[] = ["FABRIC", "ACCESSORIES", "FACTORY_CM"];
  return {
    batch: { id: batch.id, code: batch.code, name: batch.name },
    contracts: contracts.map((c) => ({
      id: c.id,
      number: c.number,
      kind: c.kind,
      party: c.party,
      signedOn: c.signedOn ? dateOnly(c.signedOn) : null,
      changedOn: localDay(c.updatedAt, ctx.company.timezone),
    })),
    toDraft: [...wanted.values()].sort(
      (a, b) =>
        KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.party.name.localeCompare(b.party.name),
    ),
    can: { draft: ctx.can("production.manage") },
  };
}

export type BatchContracts = Awaited<ReturnType<typeof getBatchContracts>>;

/** Drafts a contract with one party for the batch (one of each kind per party). */
export async function createContract(
  ctx: CompanyContext,
  batchId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = createContractSchema.parse(raw);
  assertCanChange(ctx);
  const batch = await loadBatch(ctx, batchId);
  const party = await assertPartyCanTransact(ctx, input.partyId, "PURCHASE");
  const existing = await ctx.db.productionContract.findFirst({
    where: { batchId: batch.id, kind: input.kind, partyId: party.id },
    select: { number: true },
  });
  if (existing) {
    throw new AppError(
      "CONFLICT",
      `${batch.code} already has ${existing.number}, its ${CONTRACT_TITLES[input.kind].toLowerCase()} with ${party.name}.`,
    );
  }
  const scope = await contractScope(ctx, batch, input.kind, party.id);
  if (scope.kind === "FACTORY" && scope.styles.length === 0) {
    throw new AppError(
      "CONFLICT",
      `None of ${batch.code}'s styles is made at ${party.name}. Choose the factory on a style first.`,
    );
  }
  const { clauses } = await draftClauses(contractFacts(ctx, batch, input.kind, party, scope));
  const contract = await runTransaction(async (tx) => {
    await lockRow(tx, "ProductionBatch", batch.id);
    const made = await tx.productionContract.create({
      data: {
        companyId: ctx.company.id,
        batchId: batch.id,
        kind: input.kind,
        partyId: party.id,
        number: await nextDocumentNumber(tx, ctx.company.id, "PRODUCTION_CONTRACT"),
        clauses,
        createdById: ctx.user.id,
        updatedById: ctx.user.id,
      },
      select: { id: true, number: true },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "ProductionContract",
        entityId: made.id,
        summary: `Drafted ${made.number}, the ${CONTRACT_TITLES[input.kind].toLowerCase()} with ${party.name} for ${batch.code}`,
      },
      tx,
    );
    return made;
  }).catch((error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError(
        "CONFLICT",
        `${batch.code} already has that agreement with ${party.name}.`,
      );
    }
    throw error;
  });
  return contract;
}

async function loadContract(ctx: CompanyContext, contractId: string) {
  const contract = await ctx.db.productionContract.findUnique({
    where: { id: contractId },
    select: {
      id: true,
      number: true,
      kind: true,
      clauses: true,
      signedOn: true,
      createdAt: true,
      updatedAt: true,
      batchId: true,
      party: {
        select: {
          id: true,
          code: true,
          name: true,
          contactPerson: true,
          phone: true,
          email: true,
          address: true,
        },
      },
      createdBy: { select: { name: true } },
      updatedBy: { select: { name: true } },
    },
  });
  if (!contract) throw new AppError("NOT_FOUND", "Contract not found.");
  return contract;
}

/** One contract with what it covers now. */
export async function getContract(ctx: CompanyContext, contractId: string) {
  assertCanSee(ctx);
  const contract = await loadContract(ctx, contractId);
  const batch = await loadBatch(ctx, contract.batchId);
  const scope = await contractScope(ctx, batch, contract.kind, contract.party.id);
  return { contract: { ...contract, clauses: readClauses(contract.clauses) }, batch, scope };
}

export type ContractData = Awaited<ReturnType<typeof getContract>>;

/** A fresh draft of a contract's clauses from the batch as it is now (not saved). */
export async function redraftContract(ctx: CompanyContext, contractId: string) {
  assertCanChange(ctx);
  const { contract, batch, scope } = await getContract(ctx, contractId);
  return draftClauses(contractFacts(ctx, batch, contract.kind, contract.party, scope));
}

const sameClauses = (a: Clause[], b: Clause[]) =>
  a.length === b.length && a.every((c, i) => c.title === b[i]!.title && c.text === b[i]!.text);

/**
 * Saves the reviewed clauses, the signed day and (a making agreement) each
 * style's CM per piece. A signed contract keeps its terms and CM until its
 * signed day is cleared; a closed style keeps its CM.
 */
export async function updateContract(
  ctx: CompanyContext,
  contractId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = updateContractSchema.parse(raw);
  assertCanChange(ctx);
  const { contract, batch, scope } = await getContract(ctx, contractId);
  const today = localDay(new Date(), ctx.company.timezone);
  if (input.signedOn && input.signedOn > today) {
    throw new AppError("VALIDATION", "The signed day cannot be after today.", {
      signedOn: ["Choose today or an earlier day"],
    });
  }
  const styles = scope.kind === "FACTORY" ? new Map(scope.styles.map((s) => [s.id, s])) : null;
  const rates = (input.cmRates ?? []).flatMap((r, i) => {
    const style = styles?.get(r.projectId);
    if (!style) {
      throw new AppError("VALIDATION", "A CM rate is for a style this agreement does not cover.", {
        [`cmRates.${i}.projectId`]: ["Not one of this agreement's styles"],
      });
    }
    const next = r.cmRate === null ? null : new Prisma.Decimal(r.cmRate);
    const same = next === null ? style.cmRate === null : style.cmRate?.equals(next) === true;
    if (same) return [];
    if (style.closed) {
      throw new AppError("CONFLICT", `${style.code} is closed; its CM per piece stays as it is.`, {
        [`cmRates.${i}.cmRate`]: ["The style is closed"],
      });
    }
    return [{ style, cmRate: next }];
  });
  const signed = contract.signedOn ? dateOnly(contract.signedOn) : null;
  const stillSigned = signed !== null && Boolean(input.signedOn);
  if (stillSigned && (!sameClauses(contract.clauses, input.clauses) || rates.length > 0)) {
    throw new AppError(
      "CONFLICT",
      `${contract.number} was signed on ${formatDay(signed)}. Clear the signed day to change its terms.`,
    );
  }
  await runTransaction(async (tx) => {
    await lockRow(tx, "ProductionBatch", batch.id);
    await tx.productionContract.update({
      where: { id: contract.id },
      data: {
        clauses: input.clauses,
        signedOn: input.signedOn ? dateColumn(input.signedOn) : null,
        updatedById: ctx.user.id,
      },
    });
    for (const r of rates) {
      await tx.productionProject.update({
        where: { id: r.style.id },
        data: { cmRate: r.cmRate },
      });
    }
    const what = [
      !sameClauses(contract.clauses, input.clauses) && "its terms",
      rates.length > 0 &&
        `CM per piece of ${rates
          .map(
            (r) =>
              `${r.style.code} ${r.cmRate ? formatAmount(r.cmRate, 2, ctx.company.currency) : "(cleared)"}`,
          )
          .join(", ")}`,
      (input.signedOn ?? null) !== signed &&
        (input.signedOn ? `signed on ${formatDay(input.signedOn)}` : "the signed day cleared"),
    ].filter(Boolean);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "ProductionContract",
        entityId: contract.id,
        summary: `Changed ${contract.number} (${contract.party.name}): ${what.join("; ") || "saved as it was"}`,
      },
      tx,
    );
  });
  return { id: contract.id, number: contract.number, batchId: batch.id };
}

/** Deletes a draft contract (one drafted by mistake); a signed one stays. */
export async function deleteContract(ctx: CompanyContext, contractId: string, meta?: RequestMeta) {
  assertCanChange(ctx);
  const contract = await loadContract(ctx, contractId);
  if (contract.signedOn) {
    throw new AppError(
      "CONFLICT",
      `${contract.number} was signed; clear its signed day before deleting it.`,
    );
  }
  await prisma.$transaction(async (tx) => {
    await tx.productionContract.delete({ where: { id: contract.id } });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "DELETE",
        entityType: "ProductionContract",
        entityId: contract.id,
        summary: `Deleted the draft ${contract.number} with ${contract.party.name}`,
      },
      tx,
    );
  });
  return { id: contract.id, number: contract.number, batchId: contract.batchId };
}

// =============================================================================
// Printing
// =============================================================================

export function contractDocument(ctx: CompanyContext, data: ContractData): PrintDocument {
  const { contract: c, batch, scope } = data;
  const currency = ctx.company.currency;
  const amount = (v: Prisma.Decimal) => formatAmount(v, 2, currency);
  const tz = ctx.company.timezone;
  const company = ctx.company.legalName?.trim() || ctx.company.name;
  const isFactory = c.kind === "FACTORY_CM";
  const blocks: PrintDocument["blocks"] = [];
  if (scope.kind === "SUPPLY") {
    const priced = scope.goods.filter((g) => g.unitPrice !== null);
    const total = priced.reduce((t, g) => t.plus(g.quantity.times(g.unitPrice!)), ZERO);
    blocks.push({
      kind: "table",
      title: scope.ordered
        ? "What is bought"
        : "What is bought (not ordered yet: what the styles still need)",
      columns: [
        { label: "#", align: "right", weight: 0.45 },
        { label: "Material", weight: 3.6 },
        { label: "Quantity", align: "right", weight: 1.5 },
        { label: "Price", align: "right", weight: 1.3 },
        { label: "Amount", align: "right", weight: 1.4 },
        { label: "Order · by", weight: 1.8 },
      ],
      rows: scope.goods.map((g, i): Row => ({
        cells: [
          String(i + 1),
          `${g.material.code} · ${g.material.name}`,
          materialQuantity(trimmed(g.quantity), g.material.unit, currency),
          g.unitPrice
            ? formatAmount(g.unitPrice, 2, currency)
            : scope.ordered
              ? "At receive"
              : "To agree",
          g.unitPrice ? amount(g.quantity.times(g.unitPrice)) : "–",
          [g.order, g.expectedOn ? formatDay(g.expectedOn) : null].filter(Boolean).join(" · ") ||
            "–",
        ],
        details: g.material.details ? [g.material.details] : undefined,
      })),
      empty: "Nothing is ordered from this supplier for the batch yet.",
    });
    if (priced.length > 0) {
      blocks.push({
        kind: "totals",
        rows: [
          {
            label: priced.length < scope.goods.length ? "Total of the priced lines" : "Total",
            value: amount(total),
            strong: true,
          },
        ],
      });
    }
  } else {
    const agreed = scope.styles.filter((s) => s.cmRate !== null);
    const totalCm = agreed.reduce((t, s) => t.plus(s.cmRate!.times(s.pieces)), ZERO);
    const totalPieces = scope.styles.reduce((t, s) => t + s.pieces, 0);
    blocks.push({
      kind: "table",
      title: "What is made",
      columns: [
        { label: "#", align: "right", weight: 0.45 },
        { label: "Style", weight: 3.6 },
        { label: "Pieces", align: "right", weight: 1.2 },
        { label: "CM a piece", align: "right", weight: 1.3 },
        { label: "Total CM", align: "right", weight: 1.5 },
        { label: "Deliver by", weight: 1.4 },
      ],
      rows: [
        ...scope.styles.map((s, i): Row => ({
          cells: [
            String(i + 1),
            `${s.code} · ${s.name}`,
            s.pieces.toLocaleString("en-US"),
            s.cmRate ? amount(s.cmRate) : "To agree",
            s.cmRate ? amount(s.cmRate.times(s.pieces)) : "–",
            formatDay(s.dueOn),
          ],
        })),
        {
          cells: [
            "",
            "Total",
            totalPieces.toLocaleString("en-US"),
            "",
            agreed.length > 0 ? amount(totalCm) : "–",
            "",
          ],
          style: "total",
        },
      ],
    });
  }
  // Each clause under its own numbered heading, its paragraphs as written.
  for (const [i, cl] of c.clauses.entries()) {
    blocks.push({
      kind: "text",
      title: `${i + 1}. ${cl.title}`,
      paragraphs: cl.text
        .split(/\n\s*\n/)
        .map((p) => p.replace(/\s+/g, " ").trim())
        .filter(Boolean),
    });
  }
  const signedOn = c.signedOn ? dateOnly(c.signedOn) : null;
  return {
    type: "PRODUCTION_CONTRACT",
    title: CONTRACT_TITLES[c.kind],
    subtitle: `${c.party.name} · ${batch.name}`,
    reference: c.number,
    letterhead: letterheadOf(ctx.company),
    meta: [
      { label: "Agreement no.", value: c.number },
      {
        label: signedOn ? "Signed on" : "Drafted on",
        value: formatDay(signedOn ?? localDay(c.updatedAt, tz)),
      },
      { label: "Master batch", value: batch.code },
      ...(batch.targetDate
        ? [
            {
              label: isFactory ? "All done by" : "Batch done by",
              value: formatDay(localDay(batch.targetDate, tz)),
            },
          ]
        : []),
    ],
    parties: [
      {
        heading: "Between",
        lines: [company, ...(company !== ctx.company.name ? [ctx.company.name] : [])],
      },
      {
        heading: isFactory ? "And the factory" : "And the supplier",
        lines: [
          c.party.name,
          c.party.contactPerson,
          c.party.phone,
          c.party.email,
          c.party.address,
        ].filter((l): l is string => Boolean(l)),
      },
    ],
    blocks,
    signatures: [`For ${company}`, `For ${c.party.name}`, "Witness"],
  };
}

/** The contract's PDF to review and sign (logged; nothing is kept). */
export async function contractPdf(ctx: CompanyContext, contractId: string, meta?: RequestMeta) {
  checkRateLimit(`on-demand-print:${ctx.user.id}`, ON_DEMAND_PER_MINUTE, 60_000);
  const data = await getContract(ctx, contractId);
  const bytes = await renderOnDemand(ctx, contractDocument(ctx, data));
  await auditInCompany(ctx, meta, {
    action: "EXPORT",
    entityType: "ProductionContract",
    entityId: data.contract.id,
    summary: `Printed ${data.contract.number} (${data.contract.party.name})`,
  });
  return {
    fileName: documentFileName(
      ctx.company.name,
      `${CONTRACT_TITLES[data.contract.kind]} ${data.contract.number} ${data.contract.party.name}`,
    ),
    bytes,
  };
}

// =============================================================================
// The contract screen (plain values: amounts as "12500.00", days as "2026-10-08")
// =============================================================================

export async function getContractScreen(ctx: CompanyContext, contractId: string) {
  const data = await getContract(ctx, contractId);
  const { contract: c, batch, scope } = data;
  const tz = ctx.company.timezone;
  const fixed = (v: Prisma.Decimal) => v.toFixed(2);
  return {
    contract: {
      id: c.id,
      number: c.number,
      kind: c.kind,
      title: CONTRACT_TITLES[c.kind],
      party: { id: c.party.id, name: c.party.name, phone: c.party.phone },
      clauses: c.clauses,
      signedOn: c.signedOn ? dateOnly(c.signedOn) : null,
      draftedOn: localDay(c.createdAt, tz),
      changedOn: localDay(c.updatedAt, tz),
      draftedBy: c.createdBy?.name ?? null,
      changedBy: c.updatedBy?.name ?? null,
    },
    batch: { id: batch.id, code: batch.code, name: batch.name },
    goods:
      scope.kind === "SUPPLY"
        ? {
            ordered: scope.ordered,
            rows: scope.goods.map((g) => ({
              material: g.material,
              quantity: trimmed(g.quantity),
              unitPrice: g.unitPrice ? fixed(g.unitPrice) : null,
              amount: g.unitPrice ? fixed(g.quantity.times(g.unitPrice)) : null,
              order: g.order,
              expectedOn: g.expectedOn,
            })),
          }
        : null,
    styles:
      scope.kind === "FACTORY"
        ? scope.styles.map((s) => ({
            id: s.id,
            code: s.code,
            name: s.name,
            pieces: s.pieces,
            cmRate: s.cmRate ? fixed(s.cmRate) : null,
            totalCm: s.cmRate ? fixed(s.cmRate.times(s.pieces)) : null,
            dueOn: s.dueOn,
            closed: s.closed,
          }))
        : null,
    /** A making agreement: the CM of the styles with one agreed, and how many are still to agree. */
    cm:
      scope.kind === "FACTORY"
        ? {
            total: fixed(
              scope.styles.reduce(
                (t, s) => (s.cmRate ? t.plus(s.cmRate.times(s.pieces)) : t),
                ZERO,
              ),
            ),
            toAgree: scope.styles.filter((s) => s.cmRate === null).length,
          }
        : null,
    today: localDay(new Date(), tz),
    aiOn: aiTextOn(),
    can: { edit: ctx.can("production.manage") },
  };
}

export type ContractScreen = Awaited<ReturnType<typeof getContractScreen>>;
