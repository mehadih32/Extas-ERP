import type { CompanyContext } from "@/modules/auth/context";
import { registrationNumbers } from "@/modules/companies/letterhead";
import { loadPrintLogo } from "@/modules/companies/logo.service";
import { registrationLines } from "@/modules/documents/builders";
import type { PrintDocument } from "@/modules/documents/model";
import { renderDocumentPdf } from "@/modules/documents/render";

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
  const [logo, numbers] = await Promise.all([
    loadPrintLogo(ctx.company.id),
    registrationNumbers(ctx.company.id),
  ]);
  const registrations = registrationLines(numbers);
  const doc =
    registrations.length > 0
      ? { ...model, letterhead: { ...model.letterhead, registrations } }
      : model;
  return renderDocumentPdf(doc, { logo: logo?.bytes ?? null, images });
}
