import type { CompanyContext } from "@/modules/auth/context";
import { registrationNumbers } from "@/modules/companies/letterhead";
import { loadPrintLogo } from "@/modules/companies/logo.service";
import { registrationLines } from "@/modules/documents/builders";
import type { PrintDocument } from "@/modules/documents/model";
import { type PartPages, renderDocumentPdf, renderWithParts } from "@/modules/documents/render";

/** Prints are made at most this often per person and minute (they are made fresh each time). */
export const ON_DEMAND_PER_MINUTE = 20;

/**
 * A document made when asked for and not kept (a tech pack, a purchase order):
 * on the letterhead with the logo and the registration numbers, with the rows'
 * pictures.
 */
export async function renderOnDemand(
  ctx: CompanyContext,
  model: PrintDocument,
  images?: ReadonlyMap<string, Buffer>,
) {
  const { logo, withNumbers } = await printExtras(ctx);
  return renderDocumentPdf(withNumbers(model), { logo, images });
}

async function printExtras(ctx: CompanyContext) {
  const [logo, numbers] = await Promise.all([
    loadPrintLogo(ctx.company.id),
    registrationNumbers(ctx.company.id),
  ]);
  const registrations = registrationLines(numbers);
  return {
    logo: logo?.bytes ?? null,
    withNumbers: (model: PrintDocument) =>
      registrations.length > 0
        ? { ...model, letterhead: { ...model.letterhead, registrations } }
        : model,
  };
}

/**
 * A book whose cover lists the pages of its parts (a booking book): made once
 * to count them, then again with the pages filled in. The cover's rows are the
 * same both times, so the parts fall on the same pages.
 */
export async function renderBookOnDemand(
  ctx: CompanyContext,
  build: (parts: PartPages[] | null) => PrintDocument,
  images?: ReadonlyMap<string, Buffer>,
) {
  const { logo, withNumbers } = await printExtras(ctx);
  const first = await renderWithParts(withNumbers(build(null)), { logo, images });
  return (await renderWithParts(withNumbers(build(first.parts)), { logo, images })).bytes;
}
