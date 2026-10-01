import type { CustomFieldDefinition, CustomFieldEntity, Prisma } from "@prisma/client";

import { AppError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { customFieldDefinitionSchema, updateCustomFieldSchema } from "@/modules/sales/schemas";

/*
 * Dynamic custom fields: management adds extra fields (e.g. "GSM", "Wash type",
 * "Delivery port") to quotations and other records without code changes.
 * Values live in the record's `customFields` JSON, keyed by the field's key.
 */

export async function listCustomFields(
  ctx: CompanyContext,
  entity?: CustomFieldEntity,
  includeInactive = false,
) {
  return ctx.db.customFieldDefinition.findMany({
    where: { ...(entity ? { entity } : {}), ...(includeInactive ? {} : { isActive: true }) },
    orderBy: [{ entity: "asc" }, { sortOrder: "asc" }, { label: "asc" }],
  });
}

export async function createCustomField(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = customFieldDefinitionSchema.parse(raw);
  const exists = await ctx.db.customFieldDefinition.findFirst({
    where: { entity: input.entity, key: input.key },
  });
  if (exists) throw new AppError("CONFLICT", `A field with key "${input.key}" already exists.`);
  const field = await ctx.db.customFieldDefinition.create({
    data: { ...input, options: input.options ?? [], companyId: ctx.company.id },
  });
  await auditInCompany(ctx, meta, {
    action: "CREATE",
    entityType: "CustomFieldDefinition",
    entityId: field.id,
    summary: `Added ${field.entity.toLowerCase()} field "${field.label}" (${field.fieldType})`,
  });
  return field;
}

export async function updateCustomField(
  ctx: CompanyContext,
  fieldId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const input = updateCustomFieldSchema.parse(raw);
  const field = await ctx.db.customFieldDefinition.findUnique({ where: { id: fieldId } });
  if (!field) throw new AppError("NOT_FOUND", "Custom field not found.");
  if (field.fieldType === "SELECT" && input.options && input.options.length === 0) {
    throw new AppError("VALIDATION", "A choice field needs at least one option.");
  }
  const updated = await ctx.db.customFieldDefinition.update({
    where: { id: field.id },
    data: input,
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "CustomFieldDefinition",
    entityId: field.id,
    summary: `Updated field "${updated.label}": ${Object.keys(input).join(", ")}`,
  });
  return updated;
}

function coerceValue(def: CustomFieldDefinition, value: unknown): unknown {
  const fail = (msg: string): never => {
    throw new AppError("VALIDATION", `${def.label}: ${msg}`, {
      [`customFields.${def.key}`]: [msg],
    });
  };
  switch (def.fieldType) {
    case "TEXT":
    case "LONG_TEXT": {
      if (typeof value !== "string") return fail("must be text");
      const max = def.fieldType === "TEXT" ? 500 : 5000;
      if (value.length > max) return fail(`must be at most ${max} characters`);
      return value.trim();
    }
    case "NUMBER": {
      const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
      if (typeof n !== "number" || !Number.isFinite(n)) return fail("must be a number");
      return n;
    }
    case "DATE": {
      const d = typeof value === "string" ? new Date(value) : value;
      if (!(d instanceof Date) || Number.isNaN(d.getTime())) return fail("must be a date");
      return d.toISOString().slice(0, 10);
    }
    case "BOOLEAN":
      if (typeof value !== "boolean") return fail("must be yes or no");
      return value;
    case "SELECT":
      if (typeof value !== "string" || !def.options.includes(value)) {
        return fail(`must be one of: ${def.options.join(", ")}`);
      }
      return value;
    case "COLOR":
      if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) {
        return fail("must be a hex color like #BE1434");
      }
      return value.toUpperCase();
  }
}

/**
 * Checks values against the company's active field definitions: unknown keys
 * are rejected, required fields must be filled and each value must match its type.
 */
export async function validateCustomFields(
  ctx: CompanyContext,
  entity: CustomFieldEntity,
  values: Record<string, unknown> | null | undefined,
): Promise<Prisma.InputJsonObject | undefined> {
  const defs = await ctx.db.customFieldDefinition.findMany({ where: { entity, isActive: true } });
  const input = values ?? {};
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const unknown = Object.keys(input).filter((k) => !byKey.has(k));
  if (unknown.length > 0) {
    throw new AppError("VALIDATION", `Unknown field(s): ${unknown.join(", ")}.`);
  }
  const clean: Record<string, Prisma.InputJsonValue> = {};
  for (const def of defs) {
    const value = input[def.key];
    const empty = value === undefined || value === null || value === "";
    if (empty) {
      if (def.isRequired) {
        throw new AppError("VALIDATION", `${def.label} is required.`, {
          [`customFields.${def.key}`]: ["Required"],
        });
      }
      continue;
    }
    clean[def.key] = coerceValue(def, value) as Prisma.InputJsonValue;
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

/** Values with their labels, in display order (for documents). */
export function labelledCustomFields(
  defs: CustomFieldDefinition[],
  values: Prisma.JsonValue | null,
): Array<{ key: string; label: string; value: unknown }> {
  const obj = (
    values && typeof values === "object" && !Array.isArray(values) ? values : {}
  ) as Record<string, unknown>;
  return defs
    .filter((d) => obj[d.key] !== undefined)
    .map((d) => ({ key: d.key, label: d.label, value: obj[d.key] }));
}
