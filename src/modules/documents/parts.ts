import type { PrintDocument } from "@/modules/documents/model";

/*
 * Parts of a printed document that need no server: kept free of Node imports so
 * the browser can use them too (the invoice's page 1 drawn as a picture).
 */

/**
 * The document up to its first page break: an invoice's money side without the
 * packing list on page 2. A document without a break is returned as it is.
 */
export function firstPage(model: PrintDocument): PrintDocument {
  const end = model.blocks.findIndex((b) => b.kind === "pageBreak");
  return end < 0 ? model : { ...model, blocks: model.blocks.slice(0, end) };
}
