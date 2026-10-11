/** A whole number of pieces typed in a box: 0 for an empty box, NaN for anything else. */
export const piecesIn = (text: string | undefined) => {
  const value = (text ?? "").trim();
  if (value === "") return 0;
  return /^\d{1,7}$/.test(value) ? Number(value) : NaN;
};

/** The pieces typed across a grid's boxes, leaving out what is not a whole number. */
export const sumOf = (quantities: Record<string, string>) =>
  Object.values(quantities).reduce((s, q) => s + (piecesIn(q) || 0), 0);

/** Pieces per SKU as the boxes show them. */
export const asText = (quantities: Record<string, number>) =>
  Object.fromEntries(Object.entries(quantities).map(([id, q]) => [id, String(q)]));
