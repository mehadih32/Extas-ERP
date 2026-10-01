import { Prisma } from "@prisma/client";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

/** Every model that has a `companyId` column (i.e. tenant-owned data). */
export const TENANT_MODELS: ReadonlySet<string> = new Set(
  Prisma.dmmf.datamodel.models
    .filter((model) => model.fields.some((field) => field.name === "companyId"))
    .map((model) => model.name),
);

const WHERE_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
]);

type Data = Record<string, unknown>;

function isRelationWrite(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(value instanceof Prisma.Decimal) &&
    ["connect", "create", "connectOrCreate"].some((k) => k in value)
  );
}

function assertSameCompany(model: string, data: Data, companyId: string) {
  const explicit =
    (data.companyId as string | undefined) ??
    (data.company as { connect?: { id?: string } } | undefined)?.connect?.id;
  if (explicit !== undefined && explicit !== companyId) {
    throw new AppError("FORBIDDEN", `Cannot write ${model} data for another company.`);
  }
}

/** Adds the company to create-data in whichever style (checked / unchecked) the caller used. */
export function withCompany(model: string, data: Data, companyId: string): Data {
  assertSameCompany(model, data, companyId);
  if ("companyId" in data || "company" in data) return data;
  const usesRelationStyle = Object.values(data).some(isRelationWrite);
  return usesRelationStyle
    ? { ...data, company: { connect: { id: companyId } } }
    : { ...data, companyId };
}

/**
 * A Prisma client locked to one company. Every read, update and delete on a
 * tenant model is filtered by `companyId`, and every create is checked against it
 * (and stamped with it when missing), so module code cannot accidentally read or
 * write another company's data. Prisma's types still ask for `companyId` on
 * create; pass `ctx.company.id` and the guard rejects any other value.
 *
 * Nested writes (e.g. `order.create({ data: { items: { create: [...] } } })`) are
 * not rewritten; child rows of tenant models must set `companyId` themselves.
 */
export function tenantDb(companyId: string) {
  return prisma.$extends({
    name: "tenant-isolation",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) return query(args);
          const a = (args ?? {}) as Data;

          if (WHERE_OPERATIONS.has(operation)) {
            a.where = { ...(a.where as Data | undefined), companyId };
            if ((operation === "update" || operation.startsWith("updateMany")) && a.data) {
              assertSameCompany(model, a.data as Data, companyId);
            }
          } else if (operation === "create") {
            a.data = withCompany(model, a.data as Data, companyId);
          } else if (operation === "createMany" || operation === "createManyAndReturn") {
            const rows = Array.isArray(a.data) ? a.data : [a.data];
            a.data = rows.map((row: Data) => {
              assertSameCompany(model, row, companyId);
              return { ...row, companyId };
            });
          } else if (operation === "upsert") {
            a.where = { ...(a.where as Data), companyId };
            a.create = withCompany(model, a.create as Data, companyId);
            assertSameCompany(model, a.update as Data, companyId);
          }
          return query(a as typeof args);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof tenantDb>;
