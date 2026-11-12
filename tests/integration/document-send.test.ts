import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { CompanyContext } from "@/modules/auth/context";
import * as sending from "@/modules/documents/send.service";
import * as catalog from "@/modules/inventory/catalog.service";
import * as styles from "@/modules/inventory/style.service";
import { type OutgoingMail, standInForMail } from "@/modules/mail/mail.service";
import * as parties from "@/modules/parties/party.service";
import * as quotations from "@/modules/sales/quotation.service";

import { GET as openLinkRoute } from "../../src/app/api/public/documents/[token]/route";
import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const ROLES = ["SUPER_ADMIN", "SALES_EXECUTIVE", "WAREHOUSE_TEAM", "ACCOUNTS"] as const;

/** A company with a buyer (Rahim Traders, with an email and a phone) and one quotation. */
async function setup(name: string) {
  const { company, roles } = await makeCompany(name);
  const as = {} as Record<(typeof ROLES)[number], CompanyContext>;
  for (const role of ROLES) {
    const user = await makeUser(`${role.toLowerCase()}@${company.slug}.test`);
    await addToCompany(user.id, company.id, roles[role]);
    as[role] = await contextFor(user.id, company.id);
  }
  const ctx = as.SUPER_ADMIN;
  const tops = await catalog.createCategory(ctx, { name: "Tops" });
  const brand = await catalog.createBrand(ctx, { name: `${name} Men` });
  const polo = await styles.createStyle(ctx, {
    code: "EX-PL-001",
    name: "Classic Polo",
    categoryId: tops.id,
    brandId: brand.id,
    wholesalePrice: 900,
  });
  const buyer = (
    await parties.createParty(ctx, {
      kind: "BUYER",
      name: "Rahim Traders",
      contactPerson: "Abdur Rahim",
      phone: "01711223344",
      email: "rahim@buyer.test",
    })
  ).party;
  const quotation = await quotations.createQuotation(ctx, {
    partyId: buyer.id,
    validUntil: "2099-12-31",
    items: [
      {
        categoryId: tops.id,
        styleId: polo.id,
        description: "Pique polo",
        sizeBreakdown: { S: 10, M: 20 },
        unitPrice: 650,
      },
    ],
  });
  return { company, as, ctx, buyer, quotation };
}

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

const tokenOf = (path: string) => path.split("/").pop()!;

run("sending documents to buyers", () => {
  let uploads: string;
  let mails: OutgoingMail[];

  beforeEach(async () => {
    await resetDb();
    uploads = await mkdtemp(path.join(os.tmpdir(), "extras-send-"));
    vi.stubEnv("UPLOAD_DIR", uploads);
    vi.stubEnv("SMTP_HOST", "");
    vi.stubEnv("SMTP_FROM", "");
    mails = [];
    standInForMail(async (_config, mail) => {
      mails.push(mail);
      return { messageId: `<m${mails.length}@mail.test>` };
    });
  });

  afterEach(async () => {
    standInForMail(null);
    vi.unstubAllEnvs();
    await rm(uploads, { recursive: true, force: true });
  });

  const mailbox = (companyId: string) =>
    prisma.companyMailSettings.create({
      data: {
        companyId,
        host: "smtp.mail.test",
        port: 587,
        secure: false,
        fromAddress: "sales@extas.test",
      },
    });

  it("emails the PDF only when asked, from the company's mailbox, and logs the send", async () => {
    const env = await setup("Extras");
    const seller = env.as.SALES_EXECUTIVE;
    const request = { type: "QUOTATION", id: env.quotation.id };

    // No mailbox yet: says so plainly, nothing goes and nothing is logged as sent.
    await expectAppError(
      sending.sendDocumentByEmail(seller, { request, to: "rahim@buyer.test", subject: "Q" }),
      "UNAVAILABLE",
    );
    expect(mails).toHaveLength(0);
    expect(await prisma.documentSend.count()).toBe(0);

    await mailbox(env.company.id);
    const sent = await sending.sendDocumentByEmail(seller, {
      request,
      to: "rahim@buyer.test, buying@buyer.test",
      subject: `Quotation ${env.quotation.number}`,
      message: "Please find the quotation.",
    });
    expect(sent.to).toEqual(["rahim@buyer.test", "buying@buyer.test"]);
    expect(mails).toHaveLength(1);
    const mail = mails[0]!;
    expect(mail.to).toBe("rahim@buyer.test, buying@buyer.test");
    expect(mail.subject).toBe(`Quotation ${env.quotation.number}`);
    expect(mail.attachments).toHaveLength(1);
    const attachment = mail.attachments![0]!;
    expect(attachment.contentType).toBe("application/pdf");
    expect(attachment.filename).toMatch(/\.pdf$/);
    expect(attachment.content.subarray(0, 5).toString()).toBe("%PDF-");

    const rows = await prisma.documentSend.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      companyId: env.company.id,
      channel: "EMAIL",
      status: "SENT",
      documentType: "QUOTATION",
      referenceId: env.quotation.id,
      partyId: env.buyer.id,
      recipients: "rahim@buyer.test, buying@buyer.test",
      sentById: seller.user.id,
    });
    expect(
      await prisma.notificationLog.count({ where: { channel: "EMAIL", status: "SENT" } }),
    ).toBe(1);

    // A bad address is refused before anything goes.
    await expect(
      sending.sendDocumentByEmail(seller, { request, to: "not-an-address", subject: "Q" }),
    ).rejects.toThrow();
    expect(mails).toHaveLength(1);

    // A failed send is logged as failed.
    standInForMail(async () => {
      throw Object.assign(new Error("auth"), { code: "EAUTH" });
    });
    await expectAppError(
      sending.sendDocumentByEmail(seller, { request, to: "rahim@buyer.test", subject: "Q" }),
      "UNAVAILABLE",
    );
    expect(await prisma.documentSend.count({ where: { status: "FAILED" } })).toBe(1);

    // The history on the document and on the buyer.
    const history = await sending.listDocumentSends(seller, { referenceIds: [env.quotation.id] });
    expect(history.items.map((i) => [i.channel, i.status])).toEqual([
      ["EMAIL", "FAILED"],
      ["EMAIL", "SENT"],
    ]);
    const buyerHistory = await sending.listDocumentSends(env.ctx, { partyId: env.buyer.id });
    expect(buyerHistory.items).toHaveLength(2);
  });

  it("refuses people without the permission, people who cannot see the document, and the AI", async () => {
    const env = await setup("Extras");
    await mailbox(env.company.id);
    const request = { type: "QUOTATION", id: env.quotation.id };
    const email = { request, to: "rahim@buyer.test", subject: "Q" };
    // The store team sees sales but may not send to buyers.
    await expectAppError(sending.sendDocumentByEmail(env.as.WAREHOUSE_TEAM, email), "FORBIDDEN");
    await expectAppError(
      sending.createWhatsAppLink(env.as.WAREHOUSE_TEAM, { request }),
      "FORBIDDEN",
    );
    await expectAppError(sending.recordShare(env.as.WAREHOUSE_TEAM, { request }), "FORBIDDEN");
    // Accounts may not send either (no documents.send by default).
    await expectAppError(sending.sendDocumentByEmail(env.as.ACCOUNTS, email), "FORBIDDEN");
    // The AI never sends anything to a buyer, whatever it holds.
    const ai = { ...env.ctx, byAi: true } as CompanyContext;
    await expectAppError(sending.sendDocumentByEmail(ai, email), "FORBIDDEN");
    await expectAppError(sending.createWhatsAppLink(ai, { request }), "FORBIDDEN");
    // Holding documents.send without seeing statements is not enough for a statement.
    const seller = env.as.SALES_EXECUTIVE;
    const noLedger = {
      ...seller,
      can: (p: string) => p !== "parties.ledger.view" && seller.can(p as never),
    } as CompanyContext;
    await expectAppError(
      sending.sendDocumentByEmail(noLedger, {
        request: { type: "LEDGER_STATEMENT", partyId: env.buyer.id },
        to: "rahim@buyer.test",
        subject: "Statement",
      }),
      "FORBIDDEN",
    );
    // Documents that do not go to buyers are refused.
    await expectAppError(
      sending.sendDocumentByEmail(env.ctx, { ...email, request: { type: "LETTERHEAD" } }),
      "VALIDATION",
    );
    expect(mails).toHaveLength(0);
    expect(await prisma.documentSend.count()).toBe(0);
  });

  it("makes a WhatsApp link that serves only its PDF, expires, can be stopped and is tenant-locked", async () => {
    const env = await setup("Extras");
    const other = await setup("Other House");
    const seller = env.as.SALES_EXECUTIVE;
    const now = new Date("2026-11-12T06:00:00Z");
    const made = await sending.createWhatsAppLink(
      seller,
      {
        request: { type: "QUOTATION", id: env.quotation.id },
        phone: "01711-223344",
        message: "Dear Abdur Rahim, please find the quotation.",
      },
      undefined,
      now,
    );
    expect(made.phone).toBe("8801711223344");
    expect(made.path).toMatch(/^\/api\/public\/documents\/[A-Za-z0-9_-]{30,}$/);
    // 7 days by default.
    expect(made.expiresAt.getTime() - now.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    const token = tokenOf(made.path);

    // Only the token's hash is kept.
    const link = await prisma.documentLink.findUniqueOrThrow({ where: { id: made.linkId } });
    expect(link.tokenHash).not.toContain(token);
    expect(JSON.stringify(link)).not.toContain(token);
    const send = await prisma.documentSend.findUniqueOrThrow({ where: { id: made.id } });
    expect(send).toMatchObject({ channel: "WHATSAPP", recipients: "8801711223344" });

    // The link opens the PDF, without signing in.
    const opened = await sending.openDocumentLink(token, now);
    expect(opened?.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const response = await openLinkRoute(new Request(`http://erp.test${made.path}`), {
      params: Promise.resolve({ token }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("cache-control")).toContain("no-store");

    // A wrong token is 404 and shows nothing.
    const wrong = await openLinkRoute(new Request("http://erp.test/x"), {
      params: Promise.resolve({ token: `${token.slice(0, -2)}zz` }),
    });
    expect(wrong.status).toBe(404);
    expect(await wrong.text()).not.toContain("Rahim");
    expect(await sending.openDocumentLink("short", now)).toBeNull();

    // It expires.
    const later = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
    expect(await sending.openDocumentLink(token, later)).toBeNull();

    // Another company cannot see or stop it.
    await expectAppError(
      sending.stopDocumentLink(other.as.SALES_EXECUTIVE, made.linkId),
      "NOT_FOUND",
    );
    const theirs = await sending.listDocumentSends(other.ctx, { partyId: env.buyer.id });
    expect(theirs.items).toHaveLength(0);
    // Without documents.send nobody stops it.
    await expectAppError(sending.stopDocumentLink(env.as.WAREHOUSE_TEAM, made.linkId), "FORBIDDEN");

    // Stopped: 404 from then on, and the history says so.
    const stopped = await sending.stopDocumentLink(seller, made.linkId, undefined, now);
    expect(stopped.state).toBe("STOPPED");
    expect(await sending.openDocumentLink(token, now)).toBeNull();
    const history = await sending.listDocumentSends(seller, { referenceIds: [env.quotation.id] });
    expect(history.items[0]?.link?.state).toBe("STOPPED");
    expect(history.canStop).toBe(true);

    // The company's own number of days.
    await prisma.company.update({
      where: { id: env.company.id },
      data: { documentLinkDays: 2 },
    });
    const short = await sending.createWhatsAppLink(
      seller,
      { request: { type: "QUOTATION", id: env.quotation.id } },
      undefined,
      now,
    );
    expect(short.expiresAt.getTime() - now.getTime()).toBe(2 * 24 * 60 * 60 * 1000);
    expect(short.phone).toBe("");

    // The nightly clock deletes a link's PDF copy 3 days after it ended; the link and
    // its "Sent" row stay. A live link keeps its file.
    const day = 24 * 60 * 60 * 1000;
    const fileOf = async (linkId: string) =>
      (await prisma.documentLink.findUniqueOrThrow({ where: { id: linkId } })).fileId;
    const stoppedFile = (await fileOf(made.linkId))!;
    expect(await sending.purgeEndedLinkFiles(new Date(now.getTime() + 2 * day))).toBe(0);
    expect(await sending.purgeEndedLinkFiles(new Date(now.getTime() + 4 * day))).toBe(1);
    expect(await fileOf(made.linkId)).toBeNull();
    expect(await prisma.fileAsset.findUnique({ where: { id: stoppedFile } })).toBeNull();
    expect(await fileOf(short.linkId)).not.toBeNull();
    expect(await sending.purgeEndedLinkFiles(new Date(now.getTime() + 6 * day))).toBe(1);
    expect(await fileOf(short.linkId)).toBeNull();
    expect(await prisma.documentSend.count({ where: { channel: "WHATSAPP" } })).toBe(2);
    const after = await sending.listDocumentSends(seller, { referenceIds: [env.quotation.id] });
    expect(after.items).toHaveLength(2);
    expect(after.items.map((i) => i.link?.state)).toContain("STOPPED");
  });

  it("counts link opens by the address our own proxy added, not one the visitor wrote", () => {
    const headers = (forwarded: string) => new Headers({ "x-forwarded-for": forwarded });
    expect(sending.linkVisitor(headers("203.0.113.9"))).toBe("203.0.113.9");
    expect(sending.linkVisitor(headers("1.2.3.4, 203.0.113.9"))).toBe("203.0.113.9");
    expect(sending.linkVisitor(headers("1.2.3.4, not-an-address"))).toBeUndefined();
    expect(sending.linkVisitor(new Headers())).toBeUndefined();
  });

  it("logs a share from the phone with the kept PDF to share", async () => {
    const env = await setup("Extras");
    const shared = await sending.recordShare(env.as.SALES_EXECUTIVE, {
      request: { type: "QUOTATION", id: env.quotation.id },
    });
    expect(shared.fileName).toMatch(/\.pdf$/);
    const row = await prisma.documentSend.findUniqueOrThrow({ where: { id: shared.id } });
    expect(row).toMatchObject({ channel: "SHARE", documentId: shared.documentId });
  });

  it("turns a phone number into a WhatsApp number", () => {
    expect(sending.whatsappNumber("01711-223344")).toBe("8801711223344");
    expect(sending.whatsappNumber("+880 1711 223344")).toBe("8801711223344");
    expect(sending.whatsappNumber("0044 20 7946 0000")).toBe("442079460000");
    expect(sending.whatsappNumber("")).toBe("");
  });
});
