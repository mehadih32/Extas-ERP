import type { Company, PageOrientation } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type { CompanyContext } from "@/modules/auth/context";
import type { BookFrame, Orientation } from "@/modules/documents/model";
import { DEFAULT_TAGLINE } from "@/modules/documents/tagline";

/*
 * The book frame's settings (documents/render.ts prints it): which way round a
 * booking book or a booking prints, and the company's header and footer. A
 * person picks Landscape or Portrait each time they download one; their last
 * pick is kept, and until they have picked, the company's default (Landscape)
 * is used.
 */

export const ORIENTATIONS: readonly Orientation[] = ["landscape", "portrait"];

const fromColumn = (value: PageOrientation): Orientation =>
  value === "PORTRAIT" ? "portrait" : "landscape";
const toColumn = (value: Orientation): PageOrientation =>
  value === "portrait" ? "PORTRAIT" : "LANDSCAPE";

/** "landscape" or "portrait" from a download link, or null for anything else. */
export function parseOrientation(value: string | null | undefined): Orientation | null {
  const v = value?.trim().toLowerCase();
  return v === "landscape" || v === "portrait" ? v : null;
}

/** The way round this person prints a book: their last pick, else the company's default. */
export async function pdfOrientationFor(ctx: CompanyContext): Promise<Orientation> {
  const pref = await prisma.userPreference.findUnique({
    where: { userId: ctx.user.id },
    select: { pdfOrientation: true },
  });
  return fromColumn(pref?.pdfOrientation ?? ctx.company.bookOrientation);
}

/** Keeps this person's pick for the next download (no change when it is the same). */
export async function rememberOrientation(ctx: CompanyContext, orientation: Orientation) {
  const value = toColumn(orientation);
  await prisma.userPreference.upsert({
    where: { userId: ctx.user.id },
    create: { userId: ctx.user.id, pdfOrientation: value },
    update: { pdfOrientation: value },
  });
}

/**
 * The orientation of a download: the one asked for in its link (kept as this
 * person's pick), else their last pick or the company's default.
 */
export async function downloadOrientation(
  ctx: CompanyContext,
  asked: string | null | undefined,
): Promise<Orientation> {
  const picked = parseOrientation(asked);
  if (!picked) return pdfOrientationFor(ctx);
  await rememberOrientation(ctx, picked);
  return picked;
}

/** "EXTAS | +8801764751616 | info@extas.com.bd | House-17, Road-08, Nikunja-02, Dhaka" */
export function contactLine(
  company: Pick<Company, "name" | "phone" | "email" | "address">,
): string {
  const address = company.address?.replace(/\s*\r?\n\s*/g, ", ").trim();
  return [company.name.toUpperCase(), company.phone?.trim(), company.email?.trim(), address]
    .filter((part): part is string => Boolean(part))
    .join(" | ");
}

/**
 * The frame of a booking book or a booking: its orientation, the company's
 * tagline and contacts from the Company record (so each company prints its
 * own), and the header's DOC NO, BUYER · PO, DATE and PREPARED BY: the name of
 * the person who made it, with a line beside it to sign on (a blank line to
 * write on when there is no name).
 */
export function bookFrame(
  company: Pick<Company, "name" | "phone" | "email" | "address" | "tagline">,
  options: {
    orientation: Orientation;
    docNo: string;
    buyerPo: string;
    date: string;
    preparedBy?: string | null;
  },
): BookFrame {
  return {
    orientation: options.orientation,
    tagline: company.tagline?.trim() || DEFAULT_TAGLINE,
    fields: [
      { label: "Doc no", value: options.docNo },
      { label: "Buyer · PO", value: options.buyerPo },
      { label: "Date", value: options.date },
      { label: "Prepared by", value: options.preparedBy?.trim() ?? "", sign: true },
    ],
    contact: contactLine(company),
  };
}
