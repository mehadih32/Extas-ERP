import { z } from "zod";

import { queryBoolean } from "@/lib/query-params";
import { TEMPLATE_TYPES } from "@/modules/templates/tags";

const id = z.string().trim().min(1).max(64);
const name = z.string().trim().min(2).max(120);
const someField = (v: Record<string, unknown>) => Object.values(v).some((x) => x !== undefined);

/** The form fields sent with an uploaded template (multipart, so all text). */
export const uploadTemplateSchema = z.object({
  name,
  documentType: z.enum(TEMPLATE_TYPES),
  /** Make it the one offered first for its document type. */
  isDefault: queryBoolean.optional(),
});

/** An HTML template sent as text instead of a file. */
export const createHtmlTemplateSchema = z.object({
  name,
  documentType: z.enum(TEMPLATE_TYPES),
  html: z.string().min(1).max(1_000_000),
  isDefault: z.boolean().optional(),
});

export const updateTemplateSchema = z
  .object({
    name: name.optional(),
    isDefault: z.boolean().optional(),
    /** Inactive templates are kept but not offered for filling. */
    isActive: z.boolean().optional(),
    /** HTML templates: the new page (tags are read again). */
    html: z.string().min(1).max(1_000_000).optional(),
  })
  .refine(someField, "Nothing to change");

const coordinate = z.number().min(0).max(5000);

/**
 * What each tag means and, on PDF and image templates, where it is printed.
 * Word and HTML templates: the tags found in the file, mapped to data (or left
 * as found). PDF and image templates: the whole list of placed tags.
 */
export const placeholdersSchema = z.object({
  placeholders: z
    .array(
      z.object({
        /** "{BuyerName}" or "BuyerName". */
        tag: z.string().trim().min(1).max(80),
        /** The data it prints ("buyer.name"); null prints nothing; left out = the catalog's meaning. */
        sourcePath: z.string().trim().max(64).nullish(),
        format: z.enum(["upper", "lower"]).nullish(),
        /** PDF and image templates: the page (1 = first) and the text's top-left corner in points. */
        page: z.number().int().min(1).max(20).optional(),
        x: coordinate.optional(),
        y: coordinate.optional(),
        fontSize: z.number().int().min(4).max(72).optional(),
        bold: z.boolean().optional(),
        align: z.enum(["left", "center", "right"]).optional(),
        /** The box the text is aligned in and cut to. */
        width: z.number().min(1).max(5000).nullish(),
      }),
    )
    .max(200),
});

export const listTemplatesSchema = z.object({
  documentType: z.enum(TEMPLATE_TYPES).optional(),
  /** Only templates offered for filling (people without templates.manage see only these). */
  active: queryBoolean.optional(),
});

export const catalogSchema = z.object({ documentType: z.enum(TEMPLATE_TYPES) });

/** What to fill a template with: the document's id, or (letterhead) a buyer or supplier. */
export const fillTemplateSchema = z.object({
  id: id.optional(),
  partyId: id.optional(),
});
