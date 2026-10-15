/*
 * The tech pack's fixed lists and names, shared by the services and the
 * screens (no database here, so the browser may import it).
 */

/** The six sections of the owner's instructions for the AI, in order. */
export const INSTRUCTION_SECTIONS = [
  "General",
  "Measurements",
  "Design",
  "Trims & Labels",
  "Print & Embroidery",
  "Packing",
] as const;
export type InstructionSection = (typeof INSTRUCTION_SECTIONS)[number];

/** Fabric versions of one logo master (X24). */
export const LOGO_FABRICS = {
  PQ: "Piqué",
  SJ: "Single jersey",
  IL: "Interlock",
  FL: "Fleece",
  WV: "Woven",
  TW: "Twill",
  DN: "Denim",
  CP: "Cap",
} as const;
export type LogoFabric = keyof typeof LOGO_FABRICS;

/** Where a logo's machine file came from, in the order they are tried. */
export const LOGO_SOURCE_LABELS = {
  BUYER_FILE: "The buyer's file",
  FACTORY_PUNCHER: "The embroidery factory's puncher",
  AI_FROM_VECTOR: "Draft from the buyer's vector",
} as const;

/** Light sources a buyer names for colour approval. */
export const LIGHTS = ["D65", "TL84", "CWF", "A", "TL83", "SPX35", "UV"] as const;
