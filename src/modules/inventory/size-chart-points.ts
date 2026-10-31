/** The garments a size chart starts from, and their usual measurements (safe in the browser). */
export const GARMENTS = ["TOP", "BOTTOM", "OTHER"] as const;
export type Garment = (typeof GARMENTS)[number];

/** The measurements a new chart starts with, by garment. */
export const DEFAULT_POINTS: Record<Garment, readonly string[]> = {
  TOP: ["Chest", "Body length", "Shoulder", "Sleeve length"],
  BOTTOM: ["Waist", "Hip", "Length", "Inseam", "Thigh", "Leg opening"],
  OTHER: [],
};

export const MAX_POINTS = 20;
