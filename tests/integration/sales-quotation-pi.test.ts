import { access, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import * as bankAccounts from "@/modules/accounts/bank.service";
import { buildDocument } from "@/modules/documents/builders";
import type { Block, PrintDocument } from "@/modules/documents/model";
import * as printing from "@/modules/documents/print.service";
import { printRequestSchema } from "@/modules/documents/schemas";
import { getFileForDownload } from "@/modules/files/file.service";
import { runHousekeeping } from "@/modules/housekeeping/scheduler";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as stock from "@/modules/inventory/stock.service";
import * as styles from "@/modules/inventory/style.service";
import * as parties from "@/modules/parties/party.service";
import * as payments from "@/modules/sales/payment.service";
import * as proformas from "@/modules/sales/proforma.service";
import * as quotations from "@/modules/sales/quotation.service";
import * as pictures from "@/modules/sales/reference-image.service";
import * as screens from "@/modules/sales/screens.service";
import { templateData } from "@/modules/templates/data";
import { defaultPath } from "@/modules/templates/tags";

import { png } from "../fixtures/images";
import { pdfLines } from "../fixtures/pdf";
import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/**
 * A company with a polo (Navy / White x S M L XL, wholesale 900) and a single-colour
 * tee (Black x S M L), 10 pcs of each SKU, the buyer Rahim Traders, a bank account,
 * and a Super Admin, two Sales Executives and Accounts.
 */
async function setup() {
  const { company, roles } = await makeCompany("Extras");
  const person = async (role: keyof typeof roles, email: string) => {
    const user = await makeUser(`${email}@${company.slug}.test`);
    await addToCompany(user.id, company.id, roles[role]);
    return contextFor(user.id, company.id);
  };
  const ctx = await person("SUPER_ADMIN", "admin");
  const salesCtx = await person("SALES_EXECUTIVE", "sales");
  const otherSales = await person("SALES_EXECUTIVE", "sales2");
  const accountsCtx = await person("ACCOUNTS", "accounts");
  const storeCtx = await person("WAREHOUSE_TEAM", "store");

  const sizes = [];
  for (const name of ["S", "M", "L", "XL"]) sizes.push(await catalog.createSize(ctx, { name }));
  const navy = await catalog.createColor(ctx, { name: "Navy", hexCode: "#1F2A44" });
  const white = await catalog.createColor(ctx, { name: "White", hexCode: "#FFFFFF" });
  const tops = await catalog.createCategory(ctx, { name: "Tops" });
  const style = await styles.createStyle(ctx, {
    code: "EX-PL-001",
    name: "Classic Polo",
    categoryId: tops.id,
    wholesalePrice: 900,
  });
  await matrix.generateMatrix(ctx, style.id, {
    colorIds: [navy.id, white.id],
    sizeIds: sizes.map((s) => s.id),
  });
  for (const v of await prisma.productVariant.findMany({ where: { styleId: style.id } })) {
    await stock.adjustStock(ctx, { variantId: v.id, quantity: 10, type: "OPENING", unitCost: 500 });
  }
  const buyer = (
    await parties.createParty(ctx, { kind: "BUYER", name: "Rahim Traders", phone: "01711223344" })
  ).party;
  const bank = await bankAccounts.createBankAccount(ctx, {
    bankName: "City Bank",
    branch: "Gulshan",
    accountName: "Extras Ltd",
    accountNumber: "1102-334455",
    swiftCode: "CIBLBDDH",
  });
  return {
    ctx,
    salesCtx,
    otherSales,
    accountsCtx,
    storeCtx,
    company,
    style,
    tops,
    buyer,
    bank,
    sizes,
  };
}

type Env = Awaited<ReturnType<typeof setup>>;

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

const picture = (width = 60, height = 80) => png({ width, height, colorType: 2 });

/** A catalogue polo and a custom hoodie with full garment specs. */
const quotationInput = (env: Env, imageId?: string) => ({
  partyId: env.buyer.id,
  items: [
    {
      styleId: env.style.id,
      description: "Classic Polo, pique",
      colorNote: "Navy",
      sizeBreakdown: { S: 2, M: 4, L: 4, XL: 2 },
      unitPrice: 1000,
    },
    {
      categoryId: env.tops.id,
      description: "Zip hoodie, new design",
      fabric: "80% cotton 20% polyester fleece",
      gsm: 320,
      colorNote: "Charcoal",
      sizeRatio: "S:M:L:XL = 1:2:2:1",
      accessories: "YKK zip, woven main label, hang tag",
      imageId: imageId ?? null,
      quantity: 60,
      unitPrice: 1450,
    },
  ],
});

const tables = (model: PrintDocument) =>
  model.blocks.filter((b): b is Extract<Block, { kind: "table" }> => b.kind === "table");
const lists = (model: PrintDocument) =>
  model.blocks.filter((b): b is Extract<Block, { kind: "list" }> => b.kind === "list");
const build = (env: Env, type: "QUOTATION" | "PROFORMA_INVOICE", id: string) =>
  buildDocument(env.ctx, printRequestSchema.parse({ type, id }), new Date());
const imagesIn = (pdf: Buffer) => pdf.toString("latin1").split("/Subtype /Image").length - 1;

run("quotation custom items, garment specs and the proforma's details", () => {
  let uploads: string;

  beforeEach(async () => {
    await resetDb();
    uploads = await mkdtemp(path.join(os.tmpdir(), "extras-quotation-pi-"));
    vi.stubEnv("UPLOAD_DIR", uploads);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(uploads, { recursive: true, force: true });
  });

  const storedPictures = async (companyId: string) =>
    readdir(path.join(uploads, companyId, "quotation-images"), { recursive: true })
      .then((names) => names.filter((n) => /\.(png|jpg)$/.test(String(n))))
      .catch(() => []);

  it("keeps custom items and their specs on the quotation, never in Products", async () => {
    const env = await setup();
    const before = {
      styles: await prisma.style.count(),
      variants: await prisma.productVariant.count(),
    };
    const q = await quotations.createQuotation(env.salesCtx, quotationInput(env));
    expect(await prisma.style.count()).toBe(before.styles);
    expect(await prisma.productVariant.count()).toBe(before.variants);
    expect(q.total.toFixed(2)).toBe("99000.00"); // 12 x 1,000 + 60 x 1,450

    const screen = await screens.getQuotationScreen(env.salesCtx, q.id);
    expect(screen.quotation.items.map((i) => [i.custom, i.style?.code ?? null])).toEqual([
      [false, "EX-PL-001"],
      [true, null],
    ]);
    expect(screen.quotation.items[1]).toMatchObject({
      fabric: "80% cotton 20% polyester fleece",
      gsm: 320,
      colorNote: "Charcoal",
      sizeRatio: "S:M:L:XL = 1:2:2:1",
      accessories: "YKK zip, woven main label, hang tag",
      imageId: null,
      category: { name: "Tops" },
    });

    // The PDF prints the specs under each item.
    const { model } = await build(env, "QUOTATION", q.id);
    expect(tables(model)[0]!.rows.map((r) => r.details)).toEqual([
      ["Style: EX-PL-001 Classic Polo", "Colour: Navy", "Sizes: S 2 · M 4 · L 4 · XL 2"],
      [
        "Category: Tops",
        "Fabric: 80% cotton 20% polyester fleece · 320 GSM",
        "Colour: Charcoal",
        "Size ratio: S:M:L:XL = 1:2:2:1",
        "Accessories: YKK zip, woven main label, hang tag",
      ],
    ]);

    // GSM is a weight in grams; nonsense is refused before anything is saved.
    await expect(
      quotations.createQuotation(env.salesCtx, {
        ...quotationInput(env),
        items: [{ description: "Tee", gsm: 5, quantity: 1, unitPrice: 1 }],
      }),
    ).rejects.toThrow(ZodError);

    // The saved size ratios are offered on the form.
    await prisma.sizeRatioPreset.create({
      data: {
        companyId: env.company.id,
        name: "Standard",
        entries: {
          create: env.sizes.map((s, i) => ({ sizeId: s.id, ratio: [1, 2, 2, 1][i]! })),
        },
      },
    });
    expect((await screens.getQuotationForm(env.salesCtx)).sizeRatios).toEqual([
      "S:M:L:XL = 1:2:2:1",
    ]);
  });

  it("stores reference pictures safely, prints them and removes the unused ones", async () => {
    const env = await setup();
    const first = await pictures.storeReferenceImage(env.salesCtx, {
      fileName: "hoodie sketch.png",
      bytes: picture(),
    });
    expect(first).toMatchObject({ mimeType: "image/png", fileName: "hoodie sketch.png" });

    // Anything the PDF writer could not draw safely is refused.
    const gif = await expectAppError(
      pictures.storeReferenceImage(env.salesCtx, {
        fileName: "a.gif",
        bytes: Buffer.from("GIF89a"),
      }),
      "VALIDATION",
    );
    expect(gif.message).toBe("Use a PNG or JPG image.");
    await expectAppError(
      pictures.storeReferenceImage(env.salesCtx, {
        fileName: "huge.png",
        bytes: Buffer.alloc(600 * 1024, 1),
      }),
      "VALIDATION",
    );
    await expectAppError(
      pictures.storeReferenceImage(env.salesCtx, {
        fileName: "wide.png",
        bytes: picture(3000, 10),
      }),
      "VALIDATION",
    );
    expect(await storedPictures(env.company.id)).toHaveLength(1);

    // Only the person who uploaded it may put it on a new quotation.
    await expectAppError(
      quotations.createQuotation(env.otherSales, quotationInput(env, first.id)),
      "NOT_FOUND",
    );
    const q = await quotations.createQuotation(env.salesCtx, quotationInput(env, first.id));
    expect(q.items[1]!.imageId).toBe(first.id);

    // A colleague editing the quotation keeps the picture already on it.
    await quotations.updateQuotation(env.otherSales, q.id, quotationInput(env, first.id));
    // Everyone who sees sales opens it, the store included; no one else.
    expect((await getFileForDownload(env.storeCtx, first.id)).asset.mimeType).toBe("image/png");
    expect((await getFileForDownload(env.accountsCtx, first.id)).bytes.length).toBeGreaterThan(0);

    // Printed beside its item.
    const { model } = await build(env, "QUOTATION", q.id);
    expect(tables(model)[0]!.rows.map((r) => r.image)).toEqual([undefined, first.id]);
    const printed = await printing.printDocument(env.salesCtx, { type: "QUOTATION", id: q.id });
    const pdf = (await printing.downloadDocument(env.salesCtx, printed.id)).bytes;
    expect(imagesIn(pdf)).toBe(1);
    const text = pdfLines(pdf).join("\n");
    expect(text).toContain("320 GSM");
    expect(text).toContain("Size ratio: S:M:L:XL = 1:2:2:1");

    // A picture changed on disk is left off rather than drawn unchecked.
    const stored = await prisma.fileAsset.findUniqueOrThrow({ where: { id: first.id } });
    const bytes = await readFile(path.join(uploads, stored.storagePath));
    await writeFile(path.join(uploads, stored.storagePath), Buffer.from("tampered"));
    expect((await pictures.loadReferenceImages(env.company.id, [first.id])).size).toBe(0);
    await writeFile(path.join(uploads, stored.storagePath), bytes);

    // Replacing the picture deletes the old one at once.
    const second = await pictures.storeReferenceImage(env.salesCtx, {
      fileName: "sample.png",
      bytes: picture(40, 40),
    });
    await quotations.updateQuotation(env.salesCtx, q.id, quotationInput(env, second.id));
    expect(await prisma.fileAsset.findUnique({ where: { id: first.id } })).toBeNull();
    await expect(access(path.join(uploads, stored.storagePath))).rejects.toThrow();

    // A picture never saved on a quotation goes with the nightly housekeeping a day later.
    const stray = await pictures.storeReferenceImage(env.salesCtx, {
      fileName: "stray.png",
      bytes: picture(20, 20),
    });
    expect((await runHousekeeping()).picturesRemoved).toBe(0);
    const tomorrow = new Date(Date.now() + 25 * 60 * 60 * 1000);
    expect((await runHousekeeping(tomorrow)).picturesRemoved).toBe(1);
    expect(await prisma.fileAsset.findUnique({ where: { id: stray.id } })).toBeNull();
    expect(await prisma.fileAsset.findUnique({ where: { id: second.id } })).not.toBeNull();

    // Deleting the draft deletes its pictures.
    await quotations.deleteQuotation(env.salesCtx, q.id);
    expect(await prisma.fileAsset.findUnique({ where: { id: second.id } })).toBeNull();
    expect(await storedPictures(env.company.id)).toHaveLength(0);
  });

  it("makes the proforma with the buyer's PO, validity and bank details", async () => {
    const env = await setup();
    const q = await quotations.createQuotation(env.salesCtx, quotationInput(env));
    const qScreen = await screens.getQuotationScreen(env.salesCtx, q.id);
    expect(qScreen.proformaDefaults).toMatchObject({
      banks: [{ id: env.bank.id, label: "City Bank · 1102-334455" }],
    });
    expect(qScreen.proformaDefaults!.validUntil > qScreen.proformaDefaults!.issuedOn).toBe(true);

    // The bank must be one of the company's open accounts; the offer cannot end before it starts.
    const closed = await bankAccounts.createBankAccount(env.ctx, {
      bankName: "Old Bank",
      accountName: "Extras Ltd",
      accountNumber: "9999",
    });
    await bankAccounts.updateBankAccount(env.ctx, closed.id, { isActive: false });
    await expectAppError(
      proformas.convertQuotationToProforma(env.salesCtx, q.id, { bankAccountId: closed.id }),
      "VALIDATION",
    );
    await expectAppError(
      proformas.convertQuotationToProforma(env.salesCtx, q.id, {
        issueDate: "2026-10-10",
        validUntil: "2026-10-09",
      }),
      "VALIDATION",
    );

    const pi = await proformas.convertQuotationToProforma(env.salesCtx, q.id, {
      advancePercent: 30,
      issueDate: "2026-10-10",
      buyerPoNumber: "PO-778",
      validUntil: "2026-10-25",
      bankAccountId: env.bank.id,
    });
    expect(pi).toMatchObject({ buyerPoNumber: "PO-778", bankAccountId: env.bank.id });

    const screen = await screens.getProformaScreen(env.salesCtx, pi.id);
    expect(screen.proforma).toMatchObject({
      buyerPoNumber: "PO-778",
      validUntil: "2026-10-25",
      bank: { bankName: "City Bank", branch: "Gulshan", swiftCode: "CIBLBDDH" },
    });
    expect(screen.can.editDetails).toBe(true);
    expect(screen.banks.map((b) => b.id)).toEqual([env.bank.id]);
    expect((await screens.getProformaScreen(env.accountsCtx, pi.id)).can.editDetails).toBe(false);
    // The custom item and its specs carry over from the quotation.
    expect(screen.proforma.items.map((i) => i.custom)).toEqual([false, true]);

    // On paper: the PO and validity beside the title, the bank details under the totals.
    const { model } = await build(env, "PROFORMA_INVOICE", pi.id);
    expect(model.meta).toEqual(
      expect.arrayContaining([
        { label: "Valid until", value: "25 Oct 2026" },
        { label: "Buyer PO no.", value: "PO-778" },
      ]),
    );
    expect(lists(model)).toEqual([
      {
        kind: "list",
        title: "Bank details",
        items: [
          { label: "Account name", text: "Extras Ltd" },
          { label: "Account no.", text: "1102-334455" },
          { label: "Bank", text: "City Bank" },
          { label: "Branch", text: "Gulshan" },
          { label: "SWIFT", text: "CIBLBDDH" },
        ],
      },
    ]);
    expect(model.blocks.map((b) => b.kind).indexOf("list")).toBe(
      model.blocks.map((b) => b.kind).indexOf("totals") + 1,
    );

    // Custom templates can print them too.
    expect(defaultPath("BuyerPONo", "PROFORMA_INVOICE")).toBe("proforma.buyerPoNumber");
    expect(defaultPath("ValidUntil", "PROFORMA_INVOICE")).toBe("proforma.validUntil");
    expect(defaultPath("ValidUntil", "QUOTATION")).toBe("quotation.validUntil");
    const filled = await templateData(env.salesCtx, "PROFORMA_INVOICE", { id: pi.id }, new Date());
    expect(filled.data.values).toMatchObject({
      "proforma.buyerPoNumber": "PO-778",
      "proforma.validUntil": "25 Oct 2026",
      "bank.name": "City Bank",
      "bank.accountNumber": "1102-334455",
      "bank.swiftCode": "CIBLBDDH",
    });
    expect(filled.data.items[1]).toMatchObject({
      "item.gsm": "320",
      "item.sizeRatio": "S:M:L:XL = 1:2:2:1",
      "item.accessories": "YKK zip, woven main label, hang tag",
    });

    // Past its last day with no advance: Expired, shown only.
    vi.useFakeTimers({ now: new Date("2026-10-27T06:00:00Z"), toFake: ["Date"] });
    try {
      const late = await screens.getProformaScreen(env.salesCtx, pi.id);
      expect(late.proforma.isExpired).toBe(true);
      const rows = await screens.listProformaRows(env.salesCtx);
      expect(rows.items[0]).toMatchObject({ buyerPoNumber: "PO-778", isExpired: true });
    } finally {
      vi.useRealTimers();
    }

    // Changed while it is open: only what is sent changes, and it is logged.
    const edited = await proformas.updateProforma(env.salesCtx, pi.id, {
      buyerPoNumber: "PO-778-B",
      bankAccountId: null,
    });
    expect(edited).toMatchObject({ buyerPoNumber: "PO-778-B", bankAccountId: null });
    expect(edited.validUntil?.toISOString().slice(0, 10)).toBe("2026-10-25");
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "ProformaInvoice", entityId: pi.id, action: "UPDATE" },
    });
    expect(log.summary).toBe(`Updated ${pi.number}: buyerPoNumber, bankAccountId`);
    expect(lists((await build(env, "PROFORMA_INVOICE", pi.id)).model)).toEqual([]);
    await expectAppError(
      proformas.updateProforma(env.salesCtx, pi.id, { validUntil: "2026-10-01" }),
      "VALIDATION",
    );

    // Once the advance is in, it is no longer Expired; once it is an order, it is final.
    await payments.receivePayment(env.ctx, {
      proformaId: pi.id,
      amount: Number(pi.advanceAmount),
      method: "CASH",
    });
    await proformas.updateProforma(env.salesCtx, pi.id, { validUntil: "2026-10-10" });
    expect((await screens.getProformaScreen(env.salesCtx, pi.id)).proforma.isExpired).toBe(false);
    const order = await proformas.convertProformaToOrder(env.ctx, pi.id, {
      matrix: [
        {
          styleId: env.style.id,
          unitPrice: 1000,
          quantities: Object.fromEntries(
            (await prisma.productVariant.findMany({ where: { styleId: env.style.id } }))
              .slice(0, 8)
              .map((v) => [v.id, 10]),
          ),
        },
      ],
    });
    await expectAppError(
      proformas.updateProforma(env.salesCtx, pi.id, { buyerPoNumber: "late" }),
      "CONFLICT",
    );
    expect((await screens.getProformaScreen(env.salesCtx, pi.id)).can.editDetails).toBe(false);

    // Each step links to the others.
    expect((await screens.getQuotationScreen(env.salesCtx, q.id)).quotation.proforma).toMatchObject(
      { id: pi.id, salesOrder: { id: order.id, number: order.number } },
    );
    expect((await screens.getOrderScreen(env.salesCtx, order.id)).order.proforma).toMatchObject({
      id: pi.id,
      quotation: { id: q.id, number: q.number },
    });
  });
});
