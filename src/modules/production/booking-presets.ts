import type {
  BookingSource,
  CollarStyle,
  DocumentLanguage,
  GarmentCategory,
  MeasurementUnit,
  RawMaterialKind,
} from "@prisma/client";

/*
 * What a booking starts with for each garment family, the way the trade books
 * it: knitwear fabric by the kilogram with its GSM and DIA (tube or open) and
 * the collar, cuff, twill tape and buttons; woven by the yard with its width,
 * construction and weight; outerwear with its lining, padding and zippers;
 * sweaters as yarn by the pound with the count and gauge. The wizard loads
 * these and anything can still be changed, removed or added ("Add custom
 * item"). Plain data with no server code, so the screens and the services read
 * the same lists.
 */

export const BOOKING_SOURCES = [
  "SUPPLIER_PO",
  "MARKET_PURCHASE",
] as const satisfies readonly BookingSource[];

export const SOURCE_LABELS: Record<BookingSource, string> = {
  SUPPLIER_PO: "Supplier PO",
  MARKET_PURCHASE: "Ready stock / market purchase",
};

/** Short names for badges, filters and the printed header. */
export const SOURCE_SHORT_LABELS: Record<BookingSource, string> = {
  SUPPLIER_PO: "Supplier PO",
  MARKET_PURCHASE: "Market purchase",
};

export const SOURCE_HINTS: Record<BookingSource, string> = {
  SUPPLIER_PO: "A mill or trims supplier makes the goods to this booking's specification.",
  MARKET_PURCHASE:
    "Ready goods bought on the open market (like Islampur), checked at the shop before they leave it.",
};

/** The printed title for each source. */
export const SOURCE_TITLES: Record<BookingSource, string> = {
  SUPPLIER_PO: "Fabric & Trims Booking",
  MARKET_PURCHASE: "Market Purchase Order",
};

export const GARMENT_CATEGORIES = [
  "KNITWEAR",
  "WOVEN",
  "OUTERWEAR",
  "SWEATER",
  "OTHER",
] as const satisfies readonly GarmentCategory[];

export const CATEGORY_LABELS: Record<GarmentCategory, string> = {
  KNITWEAR: "Knitwear",
  WOVEN: "Woven",
  OUTERWEAR: "Outerwear",
  SWEATER: "Sweater",
  OTHER: "Other",
};

export const CATEGORY_HINTS: Record<GarmentCategory, string> = {
  KNITWEAR: "Polo, T-shirt",
  WOVEN: "Shirt, trouser",
  OUTERWEAR: "Jacket, vest",
  SWEATER: "Pullover, cardigan",
  OTHER: "Anything else, or trims only",
};

export const COLLAR_STYLES = [
  "SOLID",
  "JACQUARD_RIB",
  "AMBUSH_RIB",
  "TIPPING",
  "HONEYCOMB",
] as const satisfies readonly CollarStyle[];

export const COLLAR_STYLE_LABELS: Record<CollarStyle, string> = {
  SOLID: "Solid",
  JACQUARD_RIB: "Jacquard rib",
  AMBUSH_RIB: "Ambush rib",
  TIPPING: "Tipping",
  HONEYCOMB: "Honeycomb",
};

export const LANGUAGE_LABELS: Record<DocumentLanguage, string> = {
  EN: "English",
  BN: "বাংলা",
};

/** What a line is on the booking: the main fabric (or yarn), the collar, the cuff, or a trim. */
export const LINE_ROLES = ["FABRIC", "COLLAR", "CUFF", "TRIM"] as const;
export type LineRole = (typeof LINE_ROLES)[number];

export const ROLE_LABELS: Record<LineRole, string> = {
  FABRIC: "Fabric",
  COLLAR: "Collar",
  CUFF: "Cuff",
  TRIM: "Trim",
};

export const DIA_TYPES = ["TUBE", "OPEN"] as const;
export type DiaType = (typeof DIA_TYPES)[number];
export const DIA_LABELS: Record<DiaType, string> = { TUBE: "Tube", OPEN: "Open" };

export const WEIGHT_UNITS = ["GSM", "OZ"] as const;
export type WeightUnit = (typeof WEIGHT_UNITS)[number];
export const WEIGHT_LABELS: Record<WeightUnit, string> = { GSM: "GSM", OZ: "oz/yd²" };

/** The specification fields a line can carry. */
export const SPEC_FIELDS = [
  "fabricType",
  "composition",
  "colour",
  "weight",
  "dia",
  "width",
  "construction",
  "yarnCount",
  "gauge",
  "finish",
  "size",
] as const;
export type SpecField = (typeof SPEC_FIELDS)[number];

export const SPEC_FIELD_INFO: Record<
  SpecField,
  { label: string; placeholder: string; numeric?: boolean }
> = {
  fabricType: { label: "Fabric type", placeholder: "Single jersey" },
  composition: { label: "Composition", placeholder: "100% cotton" },
  colour: { label: "Colour", placeholder: "Navy" },
  weight: { label: "Weight", placeholder: "180", numeric: true },
  dia: { label: "DIA (inches)", placeholder: "36", numeric: true },
  width: { label: "Width (inches)", placeholder: "58", numeric: true },
  construction: { label: "Construction", placeholder: "40x40 / 133x72" },
  yarnCount: { label: "Yarn count", placeholder: "2/28 Nm" },
  gauge: { label: "Gauge (GG)", placeholder: "12", numeric: true },
  finish: { label: "Finish / wash", placeholder: "Enzyme, silicone" },
  size: { label: "Size / details", placeholder: "18L, 4 holes" },
};

/** A trim the wizard loads for a garment family. */
export type PresetTrim = {
  name: string;
  kind: RawMaterialKind;
  unit: MeasurementUnit;
  role: LineRole;
  /** What to write in its details, shown as the field's placeholder. */
  detailsHint: string;
};

export type CategoryPreset = {
  /** The main line's name ("Body fabric", "Shell fabric", "Yarn"). */
  fabricName: string;
  fabricUnit: MeasurementUnit;
  /** Units the main line may be booked in, the default first. */
  fabricUnits: readonly MeasurementUnit[];
  /** The main line's fields, in the order the wizard and the PDF show them. */
  fabricFields: readonly SpecField[];
  /** Weight units offered (empty: no weight field). */
  weightUnits: readonly WeightUnit[];
  trims: readonly PresetTrim[];
  /** Knitwear books its collars and cuffs by colour and size group. */
  collarMatrix: boolean;
  /** Process loss the fabric calculator starts with, in percent. */
  processLoss: number;
};

export const CATEGORY_PRESETS: Record<GarmentCategory, CategoryPreset> = {
  KNITWEAR: {
    fabricName: "Body fabric",
    fabricUnit: "KG",
    fabricUnits: ["KG"],
    fabricFields: ["fabricType", "composition", "colour", "weight", "dia", "finish"],
    weightUnits: ["GSM"],
    trims: [
      {
        name: "Collar",
        kind: "TRIM",
        unit: "PCS",
        role: "COLLAR",
        detailsHint: "Flat knit, as the matrix",
      },
      { name: "Cuff", kind: "TRIM", unit: "PCS", role: "CUFF", detailsHint: "Flat knit, 2 a set" },
      { name: "Twill tape", kind: "TRIM", unit: "METER", role: "TRIM", detailsHint: "1 cm, neck" },
      { name: "Button", kind: "ACCESSORY", unit: "PCS", role: "TRIM", detailsHint: "18L, 4 holes" },
    ],
    collarMatrix: true,
    processLoss: 10,
  },
  WOVEN: {
    fabricName: "Main fabric",
    fabricUnit: "YARD",
    fabricUnits: ["YARD", "METER"],
    fabricFields: [
      "fabricType",
      "composition",
      "colour",
      "width",
      "construction",
      "weight",
      "finish",
    ],
    weightUnits: ["GSM", "OZ"],
    trims: [
      { name: "Pocketing", kind: "TRIM", unit: "YARD", role: "TRIM", detailsHint: 'TC 45x45, 58"' },
      {
        name: "Interlining",
        kind: "TRIM",
        unit: "YARD",
        role: "TRIM",
        detailsHint: "Fusible, 40 GSM",
      },
      {
        name: "Collar bone",
        kind: "ACCESSORY",
        unit: "PCS",
        role: "TRIM",
        detailsHint: "Plastic, 2.5 inches",
      },
      { name: "Button", kind: "ACCESSORY", unit: "PCS", role: "TRIM", detailsHint: "14L, 4 holes" },
    ],
    collarMatrix: false,
    processLoss: 5,
  },
  OUTERWEAR: {
    fabricName: "Shell fabric",
    fabricUnit: "YARD",
    fabricUnits: ["YARD", "METER"],
    fabricFields: ["fabricType", "composition", "colour", "width", "weight", "finish"],
    weightUnits: ["GSM", "OZ"],
    trims: [
      {
        name: "Lining",
        kind: "TRIM",
        unit: "YARD",
        role: "TRIM",
        detailsHint: "Polyester taffeta",
      },
      {
        name: "Padding",
        kind: "TRIM",
        unit: "YARD",
        role: "TRIM",
        detailsHint: "Wadding, 100 GSM",
      },
      {
        name: "Zipper",
        kind: "ACCESSORY",
        unit: "PCS",
        role: "TRIM",
        detailsHint: '#5 nylon, 24"',
      },
    ],
    collarMatrix: false,
    processLoss: 5,
  },
  SWEATER: {
    fabricName: "Yarn",
    fabricUnit: "LB",
    fabricUnits: ["LB", "KG"],
    fabricFields: ["composition", "colour", "yarnCount", "gauge"],
    weightUnits: [],
    trims: [],
    collarMatrix: false,
    processLoss: 3,
  },
  OTHER: {
    fabricName: "Fabric",
    fabricUnit: "METER",
    fabricUnits: ["METER", "YARD", "KG"],
    fabricFields: ["fabricType", "composition", "colour", "width", "weight"],
    weightUnits: ["GSM", "OZ"],
    trims: [],
    collarMatrix: false,
    processLoss: 5,
  },
};

/** Fields a trim line shows. */
export const TRIM_FIELDS: readonly SpecField[] = ["colour", "size"];

/** The size groups a new collar and cuff matrix starts with (cm). */
export const DEFAULT_COLLAR_SIZES = [
  { label: "S-M", collarLength: 42, collarWidth: 9, cuffLength: 38, cuffWidth: 3.5 },
  { label: "L-XL", collarLength: 44, collarWidth: 9, cuffLength: 38, cuffWidth: 3.5 },
  { label: "2XL", collarLength: 46, collarWidth: 9, cuffLength: 38, cuffWidth: 3.5 },
] as const;

/** Collars and cuffs booked over the pieces unless changed (knitting and linking losses). */
export const DEFAULT_COLLAR_EXTRA = 3;

/** The size group a garment size falls in ("M" is in "S-M"; "XXL" in "2XL"). */
export function sizeGroupOf(size: string, groups: readonly string[]): number {
  const norm = (s: string) =>
    s
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/^XXXL$/, "3XL")
      .replace(/^XXL$/, "2XL");
  const wanted = norm(size);
  return groups.findIndex((g) =>
    g
      .split(/[-/,]/)
      .map(norm)
      .some((part) => part === wanted),
  );
}
