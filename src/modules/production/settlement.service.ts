import type { Prisma, ProductionStatus, SupplierCategory } from "@prisma/client";

import { localDay } from "@/lib/dates";
import type { Db } from "@/lib/db-types";
import type { RequestMeta } from "@/lib/request-meta";
import {
  projectSupplierBalances,
  type SupplierProjectBalance,
} from "@/modules/accounts/supplier-projects";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { ZERO } from "@/modules/production/costing";

/*
 * Settling a production project with its suppliers. Fabric, FOB and CM
 * suppliers (and suppliers with no category set) are settled project by
 * project: when the project is completed (closed), each supplier's bills for it
 * are added up against what was paid on them, and a settlement statement is
 * kept. Whatever is still due simply stays on the supplier's own ledger (the
 * master ledger), where every bill already is, so nothing is posted to the books
 * and nothing is counted twice; the project's balance with them shows as zero
 * from then on, and later payments keep settling their oldest bills (or the ones
 * a payment is made for). Accessories suppliers run on a continuous ledger and
 * are not settled by project. Reopening a project sets its statements aside;
 * completing it again makes new ones.
 */

type Tx = Prisma.TransactionClient;

/** Whether a supplier is settled project by project (everyone but accessories-only suppliers). */
export function settledByProject(categories: readonly SupplierCategory[]): boolean {
  return !(categories.length > 0 && categories.every((c) => c === "ACCESSORIES"));
}

const fixed = (value: Prisma.Decimal) => value.toFixed(2);

function billsJson(balance: SupplierProjectBalance, timeZone: string): SettledBill[] {
  return balance.bills.map((b) => ({
    id: b.id,
    number: b.number,
    billOn: localDay(b.billDate, timeZone),
    charged: fixed(b.charged),
    paid: fixed(b.paid),
    due: fixed(b.due),
  }));
}

/**
 * Keeps a settlement statement for each supplier settled by project who has
 * bills on this project. Called as the project is completed, in the same
 * transaction. Posts nothing.
 */
export async function settleProjectSuppliersTx(
  tx: Tx,
  ctx: CompanyContext,
  project: { id: string; code: string },
  meta?: RequestMeta,
) {
  const companyId = ctx.company.id;
  const balances = await projectSupplierBalances(tx, companyId, project.id);
  if (balances.size === 0) return [];
  const suppliers = await tx.party.findMany({
    where: { companyId, id: { in: [...balances.keys()] } },
    select: { id: true, name: true, supplierCategories: true },
    orderBy: { name: "asc" },
  });
  const settledAt = new Date();
  const made: Array<{ supplier: string; carried: Prisma.Decimal }> = [];
  for (const supplier of suppliers) {
    if (!settledByProject(supplier.supplierCategories)) continue;
    const balance = balances.get(supplier.id)!;
    await tx.projectSettlement.create({
      data: {
        companyId,
        projectId: project.id,
        supplierId: supplier.id,
        settledAt,
        billed: balance.billed,
        paid: balance.paid,
        carried: balance.due,
        bills: billsJson(balance, ctx.company.timezone),
        settledById: ctx.user.id,
      },
    });
    made.push({ supplier: supplier.name, carried: balance.due });
  }
  if (made.length > 0) {
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "ProductionProject",
        entityId: project.id,
        summary: `Settled ${project.code} with ${made
          .map((m) =>
            m.carried.gt(0)
              ? `${m.supplier} (${fixed(m.carried)} left on their ledger)`
              : m.supplier,
          )
          .join(", ")}`,
      },
      tx,
    );
  }
  return made;
}

/** A reopened project's statements no longer stand. */
export async function setAsideSettlementsTx(tx: Tx, companyId: string, projectId: string) {
  await tx.projectSettlement.updateMany({
    where: { companyId, projectId, reopenedAt: null },
    data: { reopenedAt: new Date() },
  });
}

/** A bill as it stood when the project was settled. */
export type SettledBill = {
  id: string;
  number: string;
  billOn: string;
  charged: string;
  paid: string;
  due: string;
};

export type ProjectSupplierRow = {
  supplier: { id: string; code: string; name: string; categories: SupplierCategory[] };
  /** Accessories suppliers: on a running ledger, never settled by project. */
  runningLedger: boolean;
  billed: string;
  paid: string;
  /** What the project still owes them: zero once it is settled. */
  balance: string;
  /** Settled when the project closed: what was left on their ledger, and when. */
  settlement: {
    id: string;
    settledOn: string;
    carried: string;
    bills: SettledBill[];
  } | null;
};

/**
 * Each supplier's balance with one project (amounts: for people who see
 * production costs). A completed project shows its settlement statements, its
 * balances at zero; an open one what its bills owe today.
 */
export async function projectSupplierRows(
  db: Db,
  ctx: CompanyContext,
  project: { id: string; status: ProductionStatus },
): Promise<ProjectSupplierRow[]> {
  const companyId = ctx.company.id;
  const tz = ctx.company.timezone;
  const [live, statements] = await Promise.all([
    projectSupplierBalances(db, companyId, project.id),
    project.status === "COMPLETED"
      ? db.projectSettlement.findMany({
          where: { companyId, projectId: project.id, reopenedAt: null },
        })
      : Promise.resolve([]),
  ]);
  const settled = new Map(statements.map((s) => [s.supplierId, s]));
  const ids = [...new Set([...live.keys(), ...settled.keys()])];
  if (ids.length === 0) return [];
  const suppliers = await db.party.findMany({
    where: { companyId, id: { in: ids } },
    select: { id: true, code: true, name: true, supplierCategories: true },
    orderBy: { name: "asc" },
  });
  return suppliers.map((s) => {
    const statement = settled.get(s.id);
    const balance = live.get(s.id);
    const runningLedger = !settledByProject(s.supplierCategories);
    const base = {
      supplier: { id: s.id, code: s.code, name: s.name, categories: s.supplierCategories },
      runningLedger,
    };
    if (statement) {
      return {
        ...base,
        billed: fixed(statement.billed),
        paid: fixed(statement.paid),
        balance: fixed(ZERO),
        settlement: {
          id: statement.id,
          settledOn: localDay(statement.settledAt, tz),
          carried: fixed(statement.carried),
          bills: statement.bills as SettledBill[],
        },
      };
    }
    return {
      ...base,
      billed: fixed(balance?.billed ?? ZERO),
      paid: fixed(balance?.paid ?? ZERO),
      balance: fixed(balance?.due ?? ZERO),
      settlement: null,
    };
  });
}
