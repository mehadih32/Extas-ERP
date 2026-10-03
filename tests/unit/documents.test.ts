import type { Company } from "@prisma/client";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { AppError } from "@/lib/errors";
import { formatInstantDay } from "@/lib/format";
import { ImageCheckError, inspectImage, inspectJpeg, inspectPng, LOGO_LIMITS } from "@/lib/images";
import { checkLogo, MAX_LOGO_BYTES } from "@/modules/companies/logo.service";
import { drCr, letterheadOf, registrationLines } from "@/modules/documents/builders";
import {
  contentHash,
  documentFileName,
  type Letterhead,
  type PrintDocument,
  TICK,
} from "@/modules/documents/model";
import { renderDocumentPdf } from "@/modules/documents/render";
import { listDocumentsSchema, printRequestSchema } from "@/modules/documents/schemas";

import {
  chunk,
  jpeg,
  type JpegOptions,
  palette,
  png,
  PNG_SIGNATURE,
  type PngOptions,
  scanlines,
} from "../fixtures/images";
import { pageCount, pdfLines } from "../fixtures/pdf";

/** Why the image was refused ("(accepted)" when it was not). */
function imageError(check: () => unknown): string {
  try {
    check();
  } catch (error) {
    if (error instanceof ImageCheckError) return error.message;
    throw error;
  }
  return "(accepted)";
}

const LETTERHEAD: Letterhead = {
  name: "Extras",
  legalName: "Extras Fashion Ltd.",
  contacts: ["House 12, Road 5, Dhanmondi", "Dhaka 1205", "01711-000000", "hello@extras.test"],
  footer: "Extras Fashion Ltd. · extras.test",
  primaryColor: "#0B3D2E",
  accentColor: "#BE1434",
};

/** A commercial invoice long enough for two pages. */
function sampleInvoice(overrides: Partial<PrintDocument> = {}): PrintDocument {
  return {
    type: "COMMERCIAL_INVOICE",
    title: "Commercial Invoice",
    reference: "INV-2026-00042",
    letterhead: LETTERHEAD,
    meta: [
      { label: "Invoice no.", value: "INV-2026-00042" },
      { label: "Date", value: "2 Oct 2026" },
    ],
    parties: [{ heading: "Bill to", lines: ["Rahim Traders", "01711223344", "Mirpur 10, Dhaka"] }],
    blocks: [
      {
        kind: "table",
        title: "Items",
        columns: [
          { label: "#", align: "right", weight: 0.45 },
          { label: "Item", weight: 4.4 },
          { label: "Qty", align: "right" },
          { label: "Amount (BDT)", align: "right", weight: 1.6 },
        ],
        rows: Array.from({ length: 60 }, (_, i) => ({
          cells: [String(i + 1), `Classic Polo – Navy / M`, "4", "3,600.00"],
          details: [`EX-PL-001-NAVY-M-${i + 1}`],
        })),
      },
      {
        kind: "totals",
        rows: [
          { label: "Subtotal", value: "2,16,000.00" },
          { label: "Total (BDT)", value: "2,16,000.00", strong: true },
        ],
        words: "Taka Two Lakh Sixteen Thousand Only",
      },
      {
        kind: "list",
        title: "Styling instructions",
        items: [{ label: "Collar & cuff", text: "The golden colour should be a little brighter" }],
      },
      { kind: "note", text: "Goods once sold are exchanged within 7 days." },
    ],
    signatures: ["Customer signature", "Authorised signature"],
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("logo checks", () => {
  it("accepts standard PNGs: colour, 16-bit, palette with transparency, greyscale, interlaced", () => {
    const cases: Array<[PngOptions, number, number]> = [
      [{ width: 40, height: 20 }, 40, 20],
      [{ width: 9, height: 5, depth: 16 }, 9, 5],
      [
        {
          width: 7,
          height: 3,
          colorType: 3,
          before: [palette(4), chunk("tRNS", Buffer.from([0, 255]))],
        },
        7,
        3,
      ],
      [{ width: 13, height: 3, depth: 1, colorType: 0 }, 13, 3],
      [{ width: 13, height: 7, colorType: 2, interlace: 1 }, 13, 7],
      [{ width: 1, height: 1, colorType: 4, interlace: 1 }, 1, 1],
      // Ancillary chunks (lower-case first letter) are skipped.
      [{ width: 3, height: 3, before: [chunk("tEXt", Buffer.from("Title\0Logo"))] }, 3, 3],
    ];
    for (const [options, width, height] of cases) {
      expect(inspectImage(png(options), LOGO_LIMITS)).toEqual({
        mimeType: "image/png",
        ext: ".png",
        width,
        height,
      });
    }
    // Picture data split over several IDAT chunks.
    const data = deflateSync(scanlines(10, 10, 32, false));
    const split = png({
      width: 10,
      height: 10,
      idat: [chunk("IDAT", data.subarray(0, 7)), chunk("IDAT", data.subarray(7))],
    });
    expect(inspectPng(split, LOGO_LIMITS)).toEqual({ width: 10, height: 10 });
  });

  it("refuses damaged or unusual PNGs", () => {
    const good = png({ width: 4, height: 4 });
    const flipped = Buffer.from(good);
    flipped[good.length - 20] = flipped[good.length - 20]! ^ 0xff; // IDAT data: its CRC fails
    expect(imageError(() => inspectPng(flipped, LOGO_LIMITS))).toBe("The PNG file is damaged.");

    expect(imageError(() => inspectPng(good.subarray(0, good.length - 6), LOGO_LIMITS))).toBe(
      "The PNG file is cut short.",
    );
    // A chunk length with the top bit set (a "negative" length) never loops.
    const negative = Buffer.from(good);
    negative.writeUInt32BE(0x80000000, 8 + 25);
    expect(imageError(() => inspectPng(negative, LOGO_LIMITS))).toBe("The PNG file is cut short.");

    const cases: Array<[PngOptions, RegExp]> = [
      [{ width: 4, height: 4, colorType: 2, depth: 4 }, /not supported/],
      [{ width: 4, height: 4, colorType: 5 }, /not supported/],
      [{ width: 4, height: 4, interlace: 2 }, /not supported/],
      [{ width: 4, height: 4, before: [chunk("QQQQ", Buffer.from([1]))] }, /not supported/],
      [{ width: 3001, height: 1, depth: 1, colorType: 0 }, /too large \(3001 × 1 pixels\)/],
      [{ width: 2001, height: 2001, raw: Buffer.alloc(1) }, /too large/],
      [{ width: 0, height: 4, raw: Buffer.alloc(0) }, /empty/],
      [{ width: 4, height: 4, colorType: 3 }, /damaged/], // palette image without a palette
      [{ width: 4, height: 4, colorType: 3, before: [palette(2), palette(2)] }, /damaged/],
      [{ width: 4, height: 4, colorType: 0, before: [palette(2)] }, /damaged/],
      [{ width: 4, height: 4, before: [chunk("tRNS", Buffer.alloc(6))] }, /damaged/],
      [{ width: 4, height: 4, depth: 1, colorType: 0, interlace: 1 }, /not supported/],
      [
        {
          width: 4,
          height: 4,
          depth: 2,
          colorType: 0,
          before: [chunk("tRNS", Buffer.alloc(2))],
        },
        /not supported/,
      ],
      [{ width: 4, height: 4, raw: scanlines(4, 3, 32, false) }, /picture data is damaged/],
      [{ width: 4, height: 4, raw: scanlines(4, 5, 32, false) }, /picture data is damaged/],
      [{ width: 4, height: 4, raw: scanlines(4, 4, 32, false, 5) }, /picture data is damaged/],
      [{ width: 4, height: 4, raw: scanlines(4, 4, 32, true, 9) }, /picture data is damaged/],
      [
        { width: 4, height: 4, idat: [chunk("IDAT", Buffer.from("not zlib data"))] },
        /picture data is damaged/,
      ],
      [{ width: 4, height: 4, idat: [] }, /no picture data/],
    ];
    for (const [options, message] of cases) {
      const { raw, before, idat, ...shape } = options;
      const label = JSON.stringify({ ...shape, raw: raw?.length, before: before?.length, idat });
      expect(
        imageError(() => inspectPng(png(options), LOGO_LIMITS)),
        label,
      ).toMatch(message);
    }
    // IDAT chunks must follow each other.
    const data = deflateSync(scanlines(4, 4, 32, false));
    const apart = png({
      width: 4,
      height: 4,
      idat: [
        chunk("IDAT", data.subarray(0, 5)),
        chunk("tEXt", Buffer.from("a\0b")),
        chunk("IDAT", data.subarray(5)),
      ],
    });
    expect(imageError(() => inspectPng(apart, LOGO_LIMITS))).toBe("The PNG file is damaged.");
    // IHDR must come first.
    const late = Buffer.concat([
      PNG_SIGNATURE,
      chunk("tEXt", Buffer.from("a\0b")),
      good.subarray(8),
    ]);
    expect(imageError(() => inspectPng(late, LOGO_LIMITS))).toBe("The PNG file is damaged.");
  });

  it("reads JPEG frames and refuses the kinds PDF readers cannot draw", () => {
    expect(inspectImage(jpeg({ width: 320, height: 120 }), LOGO_LIMITS)).toEqual({
      mimeType: "image/jpeg",
      ext: ".jpg",
      width: 320,
      height: 120,
    });
    expect(inspectJpeg(jpeg({ width: 50, height: 60, marker: 0xc2 }), LOGO_LIMITS)).toEqual({
      width: 50,
      height: 60,
    });
    expect(inspectJpeg(jpeg({ width: 8, height: 8, components: 1 }), LOGO_LIMITS)).toEqual({
      width: 8,
      height: 8,
    });
    const cases: Array<[JpegOptions, RegExp]> = [
      [{ width: 8, height: 8, marker: 0xc3 }, /not supported/], // lossless
      [{ width: 8, height: 8, marker: 0xc9 }, /not supported/], // arithmetic coding
      [{ width: 8, height: 8, precision: 12 }, /not supported/],
      [{ width: 8, height: 8, components: 2 }, /not supported/],
      [{ width: 8, height: 8, length: 10 }, /damaged/],
      [{ width: 3001, height: 10 }, /too large/],
      [{ width: 0, height: 10 }, /empty/],
    ];
    for (const [options, message] of cases) {
      expect(
        imageError(() => inspectJpeg(jpeg(options), LOGO_LIMITS)),
        JSON.stringify(options),
      ).toMatch(message);
    }
    const noFrame = Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 0xff, 0xd9]);
    expect(imageError(() => inspectJpeg(noFrame, LOGO_LIMITS))).toBe("The JPG file is damaged.");
    const stray = Buffer.from([0xff, 0xd8, 0x00, 0x00, 0x00, 0x00]);
    expect(imageError(() => inspectJpeg(stray, LOGO_LIMITS))).toBe("The JPG file is damaged.");
    const cut = jpeg({ width: 8, height: 8 }).subarray(0, 12);
    expect(imageError(() => inspectJpeg(cut, LOGO_LIMITS))).toBe("The JPG file is cut short.");
    expect(imageError(() => inspectImage(Buffer.from("GIF89a....."), LOGO_LIMITS))).toBe(
      "Use a PNG or JPG image.",
    );
  });

  it("only keeps logos the PDF writer reads the same way", () => {
    expect(checkLogo(png({ width: 30, height: 10 }))).toMatchObject({ width: 30, height: 10 });
    expect(checkLogo(jpeg({ width: 300, height: 100 }))).toMatchObject({ mimeType: "image/jpeg" });
    const message = (bytes: Buffer) => {
      try {
        checkLogo(bytes);
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).code).toBe("VALIDATION");
        return (error as AppError).message;
      }
      throw new Error("The logo was accepted.");
    };
    expect(message(Buffer.alloc(0))).toBe("The file is empty.");
    expect(message(Buffer.alloc(MAX_LOGO_BYTES + 1))).toBe("A logo can be up to 2 MB.");
    expect(message(Buffer.from("%PDF-1.7"))).toBe("Use a PNG or JPG image.");
    // A fill byte before the frame: valid JPEG, but pdfkit would misread it.
    const filled = jpeg({ width: 30, height: 10, before: Buffer.from([0xff]) });
    expect(inspectJpeg(filled, LOGO_LIMITS)).toEqual({ width: 30, height: 10 });
    expect(message(filled)).toMatch(/cannot be printed/);
  });
});

describe("document model", () => {
  it("hashes everything printed, whatever the key order", () => {
    const doc = sampleInvoice();
    const reordered = JSON.parse(
      JSON.stringify(doc, Object.keys(doc).sort().reverse()),
    ) as PrintDocument;
    const same = { ...reordered, ...doc };
    expect(contentHash(same, null)).toBe(contentHash(doc, null));
    expect(contentHash(doc, null)).toMatch(/^[0-9a-f]{64}$/);
    // A new logo, a payment or a stamp changes the hash.
    expect(contentHash(doc, "abc")).not.toBe(contentHash(doc, null));
    expect(contentHash(sampleInvoice({ stamp: { text: "Paid", tone: "success" } }), null)).not.toBe(
      contentHash(doc, null),
    );
    // Missing optional fields hash like absent ones.
    expect(contentHash({ ...doc, subtitle: undefined }, null)).toBe(contentHash(doc, null));
  });

  it("names files without characters file systems refuse", () => {
    expect(documentFileName("Extras", "Invoice INV-2026-00042")).toBe(
      "Extras - Invoice INV-2026-00042.pdf",
    );
    expect(documentFileName('Ex/tras: "BD"', "Statement: Rahim\\Traders?\n(1 Sep)")).toBe(
      "Ex tras BD - Statement Rahim Traders (1 Sep).pdf",
    );
  });

  it("builds the letterhead from the company settings", () => {
    const company = {
      name: "Extras",
      legalName: " Extras Fashion Ltd. ",
      address: "House 12, Road 5\nDhanmondi, Dhaka 1205\n",
      phone: "01711-000000",
      email: "hello@extras.test",
      website: "extras.test",
      letterheadFooter: null,
      primaryColor: "#123456",
      accentColor: "#654321",
    } as unknown as Company;
    expect(letterheadOf(company)).toEqual({
      name: "Extras",
      legalName: "Extras Fashion Ltd.",
      contacts: [
        "House 12, Road 5",
        "Dhanmondi, Dhaka 1205",
        "01711-000000",
        "hello@extras.test",
        "extras.test",
      ],
      footer: "Extras Fashion Ltd. · extras.test",
      primaryColor: "#123456",
      accentColor: "#654321",
    });
    expect(
      letterheadOf({ ...company, letterheadFooter: "Thank you for your business" }).footer,
    ).toBe("Thank you for your business");
    expect(letterheadOf({ ...company, legalName: null, website: null, address: null }).footer).toBe(
      "Extras",
    );
  });

  it("puts the BIN and trade licence number on the letterhead when they are on file", () => {
    expect(registrationLines({ bin: "000123456-0101", tradeLicense: "TRAD/DNCC/123" })).toEqual([
      "BIN: 000123456-0101",
      "Trade licence: TRAD/DNCC/123",
    ]);
    expect(registrationLines({ bin: null, tradeLicense: "TRAD/DNCC/123" })).toEqual([
      "Trade licence: TRAD/DNCC/123",
    ]);
    expect(registrationLines({ bin: null, tradeLicense: null })).toEqual([]);
    // The numbers are part of what is printed; a letterhead without them hashes as before.
    const doc = sampleInvoice();
    const numbered = sampleInvoice({
      letterhead: { ...LETTERHEAD, registrations: ["BIN: 000123456-0101"] },
    });
    expect(contentHash(numbered, null)).not.toBe(contentHash(doc, null));
    expect(
      contentHash(sampleInvoice({ letterhead: { ...LETTERHEAD, registrations: undefined } }), null),
    ).toBe(contentHash(doc, null));
  });

  it("shows balances as debit or credit", () => {
    expect(drCr("125000.5", "BDT")).toBe("1,25,000.50 Dr");
    expect(drCr("-3000", "BDT")).toBe("3,000.00 Cr");
    expect(drCr("0", "USD")).toBe("0.00");
    expect(drCr("-1234567.891", "USD")).toBe("1,234,567.89 Cr");
  });

  it("formats instants as calendar days in the company's time zone", () => {
    // 20:30 UTC on 1 Oct is 2:30 on 2 Oct in Dhaka.
    expect(formatInstantDay(new Date("2026-10-01T20:30:00Z"), "Asia/Dhaka")).toBe("2 Oct 2026");
    expect(formatInstantDay(new Date("2026-10-01T20:30:00Z"), "UTC")).toBe("1 Oct 2026");
  });

  it("checks print requests", () => {
    expect(printRequestSchema.parse({ type: "COMMERCIAL_INVOICE", id: " inv1 " })).toEqual({
      type: "COMMERCIAL_INVOICE",
      id: "inv1",
    });
    expect(printRequestSchema.parse({ type: "LETTERHEAD", id: "ignored" })).toEqual({
      type: "LETTERHEAD",
    });
    expect(
      printRequestSchema.safeParse({ type: "LEDGER_STATEMENT", partyId: "p", from: "2026-02-30" })
        .success,
    ).toBe(false);
    expect(printRequestSchema.parse({ type: "PACKING_LIST", id: "pl1" })).toEqual({
      type: "PACKING_LIST",
      id: "pl1",
    });
    expect(printRequestSchema.parse({ type: "PAYMENT_RECEIPT", id: " pay1 " })).toEqual({
      type: "PAYMENT_RECEIPT",
      id: "pay1",
    });
    expect(printRequestSchema.safeParse({ type: "PAYSLIP", id: "x" }).success).toBe(false);
    expect(printRequestSchema.safeParse({ type: "QUOTATION" }).success).toBe(false);
    expect(printRequestSchema.safeParse({ type: "PAYMENT_RECEIPT", id: "" }).success).toBe(false);
    expect(
      printRequestSchema.safeParse({
        type: "STOCK_AVAILABILITY",
        styleIds: Array.from({ length: 101 }, (_, i) => `s${i}`),
      }).success,
    ).toBe(false);
    expect(listDocumentsSchema.parse({ take: "5" })).toEqual({ take: 5 });
    expect(listDocumentsSchema.parse({ type: "PACKING_LIST" })).toEqual({
      type: "PACKING_LIST",
      take: 20,
    });
    expect(listDocumentsSchema.safeParse({ type: "PAYSLIP" }).success).toBe(false);
  });
});

describe("letterhead PDFs", () => {
  it("lays out a long invoice over pages with the letterhead, totals and signatures", async () => {
    const pdf = await renderDocumentPdf(sampleInvoice(), { compress: false });
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const pages = pageCount(pdf);
    expect(pages).toBeGreaterThanOrEqual(2);
    const lines = pdfLines(pdf);
    for (const text of [
      "Extras",
      "EXTRAS FASHION LTD.",
      "Dhaka 1205",
      "COMMERCIAL INVOICE",
      "INVOICE NO.",
      "INV-2026-00042",
      "BILL TO",
      "Rahim Traders",
      "Classic Polo – Navy / M",
      "EX-PL-001-NAVY-M-60",
      "2,16,000.00",
      "In words: Taka Two Lakh Sixteen Thousand Only",
      "STYLING INSTRUCTIONS",
      "Collar & cuff:",
      "The golden colour should be a little brighter",
      "Goods once sold are exchanged within 7 days.",
      "Customer signature",
      "Authorised signature",
      "Extras Fashion Ltd. · extras.test",
      "Items (continued)",
      "Commercial Invoice · INV-2026-00042",
    ]) {
      expect(lines).toContain(text);
    }
    expect(lines).toContain(`INV-2026-00042 · Page 1 of ${pages}`);
    expect(lines).toContain(`INV-2026-00042 · Page ${pages} of ${pages}`);
    // The table header repeats on every page it runs over.
    expect(lines.filter((l) => l === "Amount (BDT)").length).toBeGreaterThanOrEqual(2);
    // Compressed by default.
    const small = await renderDocumentPdf(sampleInvoice());
    expect(small.length).toBeLessThan(pdf.length);
  });

  it("marks void documents on every page and paid ones with a badge", async () => {
    const voided = await renderDocumentPdf(
      sampleInvoice({ stamp: { text: "Void", tone: "danger" } }),
      { compress: false },
    );
    const lines = pdfLines(voided);
    expect(lines.filter((l) => l === "VOID").length).toBe(pageCount(voided) + 1); // badge + marks
    const paid = pdfLines(
      await renderDocumentPdf(sampleInvoice({ stamp: { text: "Paid", tone: "success" } }), {
        compress: false,
      }),
    );
    expect(paid.filter((l) => l === "PAID")).toHaveLength(1);
    // A long title shrinks beside the badge instead of being cut.
    const statement = pdfLines(
      await renderDocumentPdf(
        sampleInvoice({
          title: "Statement of Account",
          stamp: { text: "Cancelled", tone: "danger" },
        }),
        { compress: false },
      ),
    );
    expect(statement).toContain("STATEMENT OF ACCOUNT");
    expect(statement).toContain("CANCELLED");
  });

  it("prints the BIN and trade licence number under the contact details", async () => {
    const registrations = ["BIN: 000123456-0101", "Trade licence: TRAD/DNCC/123"];
    const lines = pdfLines(
      await renderDocumentPdf(sampleInvoice({ letterhead: { ...LETTERHEAD, registrations } }), {
        compress: false,
      }),
    );
    const at = (text: string) => lines.indexOf(text);
    expect(at("hello@extras.test")).toBeGreaterThanOrEqual(0);
    expect(at("BIN: 000123456-0101")).toBeGreaterThan(at("hello@extras.test"));
    expect(at("Trade licence: TRAD/DNCC/123")).toBeGreaterThan(at("BIN: 000123456-0101"));
    // Only on the first page's letterhead, not the slim header of the pages after it.
    expect(lines.filter((l) => l === "BIN: 000123456-0101")).toHaveLength(1);

    // A company with no address or phone on file still shows them.
    const bare = pdfLines(
      await renderDocumentPdf(
        sampleInvoice({ letterhead: { ...LETTERHEAD, contacts: [], registrations } }),
        { compress: false },
      ),
    );
    expect(bare).toContain("BIN: 000123456-0101");
    expect(bare).toContain("Trade licence: TRAD/DNCC/123");
  });

  it("draws tick boxes in a check column and prints text on total rows", async () => {
    const pickList = (picked: string) =>
      sampleInvoice({
        title: "Packing List",
        blocks: [
          {
            kind: "table",
            columns: [
              { label: "SKU", weight: 3 },
              { label: "Qty (pcs)", align: "right" },
              { label: "Picked", align: "center", check: true },
            ],
            rows: [
              { cells: ["EX-PL-001-NAVY-S", "2", picked] },
              { cells: ["EX-PL-001-NAVY-M", "4", ""] },
              { cells: ["Total pieces", "6", "2 of 6"], style: "total" },
            ],
          },
        ],
      });
    const ticked = await renderDocumentPdf(pickList(TICK), { compress: false });
    const lines = pdfLines(ticked);
    for (const text of ["Picked", "EX-PL-001-NAVY-S", "EX-PL-001-NAVY-M", "2 of 6"]) {
      expect(lines).toContain(text);
    }
    // Boxes are drawn, never printed as a character the font lacks.
    expect(lines.some((l) => l.includes("?") || l.includes(TICK))).toBe(false);
    const content = ticked.toString("latin1");
    expect(content.match(/ 7 7 re\n/g)).toHaveLength(2);
    // The ticked box has one tick stroke more than the empty one.
    const empty = (await renderDocumentPdf(pickList(""), { compress: false })).toString("latin1");
    expect(empty.match(/ 7 7 re\n/g)).toHaveLength(2);
    const ticks = (pdf: string) => pdf.match(/\n1\.2 w\n/g)?.length ?? 0;
    expect(ticks(content)).toBe(ticks(empty) + 1);
  });

  it("prints the blank letterhead pad with the logo and a centred footer", async () => {
    const pad: PrintDocument = {
      type: "LETTERHEAD",
      title: "",
      letterhead: {
        ...LETTERHEAD,
        name: "এক্সট্রাস 漢字",
        footer: "এক্সট্রাস ফ্যাশন লিমিটেড · extras.test",
      },
      meta: [],
      parties: [],
      blocks: [],
      signatures: [],
    };
    const pdf = await renderDocumentPdf(pad, {
      logo: png({ width: 60, height: 20 }),
      compress: false,
    });
    expect(pageCount(pdf)).toBe(1);
    const text = pdf.toString("latin1");
    expect(text).toContain("/Subtype /Image");
    const lines = pdfLines(pdf);
    // Bengali prints in Noto Sans Bengali; scripts no PDF font has show as "?".
    expect(lines).toContain("এক্সট্রাস ?");
    expect(lines).toContain("এক্সট্রাস ফ্যাশন লিমিটেড · extras.test");
    expect(lines.some((l) => l.includes("Page"))).toBe(false);
    expect(lines.some((l) => l.includes("SIGNATURE"))).toBe(false);
  });

  it("draws 16-bit and palette logos and a JPEG frame", async () => {
    for (const logo of [
      png({ width: 9, height: 5, depth: 16 }),
      png({
        width: 7,
        height: 3,
        colorType: 3,
        before: [palette(4), chunk("tRNS", Buffer.from([0]))],
      }),
      png({ width: 13, height: 7, colorType: 2, interlace: 1 }),
      jpeg({ width: 300, height: 100 }),
    ]) {
      const pdf = await renderDocumentPdf(sampleInvoice({ blocks: [] }), { logo, compress: false });
      expect(pdf.toString("latin1")).toContain("/Subtype /Image");
    }
  });
});
