import {
  BookingSource,
  CollarStyle,
  DocumentLanguage,
  GarmentCategory,
  MeasurementUnit,
  PurchaseOrderStatus,
  RawMaterialKind,
} from "@prisma/client";
import { z } from "zod";

import { DIA_TYPES, LINE_ROLES, WEIGHT_UNITS } from "@/modules/production/booking-presets";

/*
 * What the booking API takes. A line names an existing raw material, or a new
 * one by name, kind and unit (the booking adds it to the catalogue). Its
 * quantity is typed, or worked out by the service: from the collar and cuff
 * matrix for the collar and cuff lines, or from the fabric calculator (pieces,
 * consumption per dozen and process loss). The specification fields are kept
 * on the order line as JSON, checked by `lineSpecsSchema` on the way in and
 * on the way out.
 */

const id = z.string().min(1);
const optionalText = (max: number) => z.string().trim().max(max).nullish();
const take = z.coerce.number().int().min(1).max(200).optional();
/** Quantities: to the gram or millimetre (3 decimals). */
const quantity = z
  .number()
  .max(100_000_000)
  .multipleOf(0.001)
  .refine((v) => v > 0, "Must be more than zero");
/** Prices per unit: up to 4 decimals. */
const price = z.number().min(0).max(100_000_000).multipleOf(0.0001);
/** A collar or cuff measurement in centimetres. */
const cm = z.number().positive().max(500).multipleOf(0.01);
const measure = (max: number) => z.number().positive().max(max).multipleOf(0.01);

export const lineSpecsSchema = z.object({
  role: z.enum(LINE_ROLES),
  fabricType: optionalText(80),
  composition: optionalText(120),
  colour: optionalText(60),
  weight: measure(10_000).nullish(),
  weightUnit: z.enum(WEIGHT_UNITS).nullish(),
  dia: measure(200).nullish(),
  diaType: z.enum(DIA_TYPES).nullish(),
  width: measure(500).nullish(),
  construction: optionalText(80),
  yarnCount: optionalText(40),
  gauge: measure(100).nullish(),
  finish: optionalText(120),
  size: optionalText(120),
  pieces: z.number().int().positive().max(10_000_000).nullish(),
  perDozen: z.number().positive().max(100_000).multipleOf(0.001).nullish(),
  lossPercent: z.number().min(0).max(100).multipleOf(0.01).nullish(),
});

const bookingLineSchema = z
  .object({
    /** An existing raw material... */
    materialId: id.nullish(),
    /** ...or a new one: its name, kind and unit (found again when it already exists). */
    name: z.string().trim().min(2).max(160).nullish(),
    kind: z.enum(RawMaterialKind).nullish(),
    unit: z.enum(MeasurementUnit).nullish(),
    /** Left out for lines the collar matrix or the fabric calculator works out. */
    quantity: quantity.nullish(),
    /** Empty: the price is agreed when the goods arrive. */
    unitPrice: price.nullish(),
    description: optionalText(500),
    imageId: id.nullish(),
    /** The role defaults to fabric for fabric and to trim for the rest. */
    specs: lineSpecsSchema.partial({ role: true }).default({}),
  })
  .superRefine((line, ctx) => {
    if (line.materialId) return;
    for (const field of ["name", "kind", "unit"] as const) {
      if (!line[field]) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message:
            field === "name" ? "Name the item" : `Choose the ${field === "kind" ? "kind" : "unit"}`,
        });
      }
    }
  });

const collarSchema = z
  .object({
    style: z.enum(CollarStyle),
    /** Booked over the garment pieces, in percent. */
    extraPercent: z.number().min(0).max(50).multipleOf(0.01).default(0),
    notes: optionalText(1000),
    sizes: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(20),
          collarLength: cm,
          collarWidth: cm,
          cuffLength: cm.nullish(),
          cuffWidth: cm.nullish(),
        }),
      )
      .min(1)
      .max(12)
      .refine(
        (sizes) => new Set(sizes.map((s) => s.label.toUpperCase())).size === sizes.length,
        "Each size group can be given once",
      ),
    colours: z
      .array(
        z.object({
          garmentColour: z.string().trim().min(1).max(60),
          /** Defaults to the garment colour. */
          collarColour: optionalText(60),
          tippingColour: optionalText(60),
          /** Garment pieces in each size group, in the order of `sizes`. */
          pieces: z.array(z.number().int().min(0).max(1_000_000)).max(12),
        }),
      )
      .min(1)
      .max(40)
      .refine(
        (colours) =>
          new Set(colours.map((c) => c.garmentColour.toUpperCase())).size === colours.length,
        "Each garment colour can be given once",
      ),
  })
  .superRefine((collar, ctx) => {
    collar.colours.forEach((c, i) => {
      if (c.pieces.length !== collar.sizes.length) {
        ctx.addIssue({
          code: "custom",
          path: ["colours", i, "pieces"],
          message: "Give the pieces of every size group",
        });
      }
    });
    if (collar.colours.every((c) => c.pieces.every((p) => p === 0))) {
      ctx.addIssue({
        code: "custom",
        path: ["colours"],
        message: "Enter the pieces to book collars for",
      });
    }
    collar.sizes.forEach((s, i) => {
      if ((s.cuffLength == null) !== (s.cuffWidth == null)) {
        ctx.addIssue({
          code: "custom",
          path: ["sizes", i, "cuffWidth"],
          message: "Give both cuff measurements, or neither",
        });
      }
    });
  });

/** What can change on an open booking, also after goods have arrived. */
const paperworkFields = {
  expectedDate: z.iso.date().nullish(),
  supplierRef: optionalText(60),
  title: optionalText(160),
  styleRef: optionalText(80),
  deliveryPlace: optionalText(300),
  paymentTerms: optionalText(300),
  termsLanguage: z.enum(DocumentLanguage).default("EN"),
  /** One condition per line; empty: the standard terms for the source and garment family. */
  terms: z.string().trim().max(12_000).nullish(),
  notes: optionalText(2000),
};

const bookingFields = {
  source: z.enum(BookingSource),
  category: z.enum(GarmentCategory),
  supplierId: id,
  garmentPieces: z.number().int().positive().max(10_000_000).nullish(),
  collar: collarSchema.nullish(),
  lines: z.array(bookingLineSchema).min(1, "Add at least one item").max(60),
  ...paperworkFields,
};

export const createBookingSchema = z.object({
  ...bookingFields,
  /** Attached to this master batch at once (its fabric is booked here). */
  batchId: id.nullish(),
});

/** Everything, while nothing has arrived on the booking. */
export const updateBookingSchema = z.object(bookingFields);

/** The paperwork only (the expected day, references and terms), while it is open. */
export const updateBookingPaperworkSchema = z.object(paperworkFields);

export const attachBookingSchema = z.object({ batchId: id });

export const listBookingsSchema = z.object({
  search: z.string().trim().max(100).optional(),
  source: z.enum(BookingSource).optional(),
  category: z.enum(GarmentCategory).optional(),
  status: z.enum(PurchaseOrderStatus).optional(),
  batchId: id.optional(),
  supplierId: id.optional(),
  take,
  cursor: id.optional(),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type BookingLineInput = z.infer<typeof bookingLineSchema>;
export type CollarInput = z.infer<typeof collarSchema>;
