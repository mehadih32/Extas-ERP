import { randomBytes } from "node:crypto";

import type { DocumentLink, DocumentSend, DocumentSendChannel } from "@prisma/client";
import { z } from "zod";

import { hashText } from "@/lib/crypto";
import { localDay, localTime } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { formatInstantDay } from "@/lib/format";
import { PDF_MIME } from "@/lib/pdf";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientAddress, type RequestMeta } from "@/lib/request-meta";
import { isAiAddress } from "@/modules/ai/ai-address";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import type { PrintType } from "@/modules/documents/model";
import { mayPrintType, PRINT_INFO, printDocument } from "@/modules/documents/print.service";
import { type PrintRequest, printRequestSchema } from "@/modules/documents/schemas";
import {
  deleteStoredFile,
  readStoredFile,
  storedFileExists,
  writeGeneratedFile,
} from "@/modules/files/file.service";
import { mailConfigOf, NO_MAIL_TEXT, sendMail } from "@/modules/mail/mail.service";

/*
 * Sending a document to a buyer: the quotation, proforma invoice, invoice,
 * statement of account, stock sheet or packing list, as the PDF on the
 * letterhead. CLAUDE.md section 2: anything that reaches a buyer goes only when
 * a person presses the button. Nothing here is called by a clock, and the AI's
 * account can never send (assertMaySend). Every send is logged (DocumentSend):
 * who, when, which document, to whom and by which way.
 *
 *   Email     through the company's own mailbox (mail.service), PDF attached.
 *   WhatsApp  WhatsApp cannot take a file from a web link, so the person's
 *             WhatsApp opens with a message holding a secure link to the PDF:
 *             a random token (only its hash is kept) that serves only its own
 *             copy of that one PDF, until it expires (Company.documentLinkDays,
 *             7 by default) or is stopped.
 *   Share     on a phone, the phone's own Share sheet with the PDF file.
 *
 * Who may send: documents.send, and printing that kind of document (the same
 * people who see it). Checked here and by the route or action that calls it.
 */

/** The documents that can be sent to a buyer. */
export const SENDABLE_TYPES = [
  "QUOTATION",
  "PROFORMA_INVOICE",
  "COMMERCIAL_INVOICE",
  "PACKING_LIST",
  "LEDGER_STATEMENT",
  "STOCK_AVAILABILITY",
] as const satisfies readonly PrintType[];

export type SendableType = (typeof SENDABLE_TYPES)[number];

const isSendable = (type: PrintType): type is SendableType =>
  (SENDABLE_TYPES as readonly string[]).includes(type);

/** Sends a person may make in ten minutes (email, WhatsApp and Share together). */
export const SENDS_PER_TEN_MINUTES = 30;

/** Whether this person may send documents of this kind (documents.send and seeing it). */
export function maySendType(ctx: Pick<CompanyContext, "can">, type: PrintType): boolean {
  return isSendable(type) && ctx.can("documents.send") && mayPrintType(ctx, type);
}

function assertMaySend(ctx: CompanyContext, type: PrintType) {
  // The AI drafts and reminds; it never sends anything to a buyer (CLAUDE.md section 2).
  if (ctx.byAi || isAiAddress(ctx.user.email)) {
    throw new AppError("FORBIDDEN", "The AI cannot send documents to buyers. A person sends them.");
  }
  if (!isSendable(type)) {
    throw new AppError("VALIDATION", `${PRINT_INFO[type].label}s are not sent from here.`);
  }
  if (!ctx.can("documents.send")) {
    throw new AppError("FORBIDDEN", "You do not have permission to send documents to buyers.");
  }
  if (!mayPrintType(ctx, type)) {
    throw new AppError(
      "FORBIDDEN",
      `You do not have permission to see ${PRINT_INFO[type].plural}.`,
    );
  }
  checkRateLimit(`send-doc:${ctx.user.id}`, SENDS_PER_TEN_MINUTES, 10 * 60_000);
}

const EMAIL_SPLIT = /[\s,;]+/;

export const emailSendSchema = z.object({
  request: printRequestSchema,
  /** One or more addresses, separated by commas, semicolons or spaces. */
  to: z
    .string()
    .trim()
    .min(1, "Give at least one email address")
    .max(1000)
    .transform((value) => [...new Set(value.split(EMAIL_SPLIT).filter(Boolean))])
    .pipe(
      z
        .array(z.email("Check the email address"))
        .min(1, "Give at least one email address")
        .max(10, "Send to at most 10 addresses at once"),
    ),
  subject: z.string().trim().min(1, "Give a subject").max(200),
  message: z.string().trim().max(4000).default(""),
});

export const whatsappSendSchema = z.object({
  request: printRequestSchema,
  /** The buyer's phone; empty lets the person pick the chat in WhatsApp. */
  phone: z.string().trim().max(40).default(""),
  /** The message without the link (the link is added after it). */
  message: z.string().trim().max(2000).default(""),
});

export const shareSendSchema = z.object({ request: printRequestSchema });

/** The number for a wa.me link: digits only, a Bangladeshi 01XXXXXXXXX becomes 8801XXXXXXXXX. */
export function whatsappNumber(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("01")) digits = `88${digits}`;
  return digits;
}

/** Where a WhatsApp document link opens (the token is the only key). */
export const documentLinkPath = (token: string) => `/api/public/documents/${token}`;

/** Prints the document (or takes the kept copy) and reads its PDF. */
async function printedPdf(ctx: CompanyContext, request: PrintRequest, meta?: RequestMeta) {
  const printed = await printDocument(ctx, request, meta);
  const row = await ctx.db.generatedDocument.findUnique({
    where: { id: printed.id },
    select: { file: { select: { storagePath: true, fileName: true } } },
  });
  if (!row?.file) throw new AppError("NOT_FOUND", "The PDF could not be made. Try again.");
  const bytes = await readStoredFile(row.file);
  return { printed, bytes, fileName: row.file.fileName };
}

type Printed = Awaited<ReturnType<typeof printedPdf>>["printed"];

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

async function logSend(
  ctx: CompanyContext,
  printed: Printed,
  data: {
    channel: DocumentSendChannel;
    status?: "SENT" | "FAILED";
    recipients: string;
    subject?: string | null;
    message?: string | null;
    error?: string | null;
    linkId?: string | null;
  },
) {
  return ctx.db.documentSend.create({
    data: {
      companyId: ctx.company.id,
      channel: data.channel,
      status: data.status ?? "SENT",
      documentType: printed.type,
      documentId: printed.id,
      referenceType: printed.referenceType,
      referenceId: printed.referenceId,
      partyId: printed.party?.id ?? null,
      title: printed.title,
      recipients: clip(data.recipients, 1000),
      subject: data.subject ? clip(data.subject, 200) : null,
      message: data.message ? clip(data.message, 4000) : null,
      error: data.error ?? null,
      linkId: data.linkId ?? null,
      sentById: ctx.user.id,
    },
  });
}

/** Whether the company can send email (its own mailbox, or the server's). */
export async function emailReady(companyId: string) {
  return (await mailConfigOf(companyId)) !== null;
}

/**
 * Sends the document by email from the company's mailbox with the PDF
 * attached, to the addresses the person gave. Logged whether it went or not.
 */
export async function sendDocumentByEmail(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = emailSendSchema.parse(raw);
  assertMaySend(ctx, input.request.type);
  if (!(await emailReady(ctx.company.id))) throw new AppError("UNAVAILABLE", NO_MAIL_TEXT);
  const { printed, bytes, fileName } = await printedPdf(ctx, input.request, meta);
  const to = input.to.join(", ");
  try {
    await sendMail(
      ctx.company.id,
      {
        to,
        subject: input.subject,
        text: input.message || `Please find ${printed.title} attached.`,
        replyTo: ctx.user.email,
        attachments: [{ filename: fileName, content: bytes, contentType: PDF_MIME }],
      },
      { entityType: "GeneratedDocument", entityId: printed.id, userId: ctx.user.id },
    );
  } catch (error) {
    const message = error instanceof AppError ? error.message : "The email could not be sent.";
    await logSend(ctx, printed, {
      channel: "EMAIL",
      status: "FAILED",
      recipients: to,
      subject: input.subject,
      message: input.message,
      error: message,
    });
    throw error;
  }
  const send = await logSend(ctx, printed, {
    channel: "EMAIL",
    recipients: to,
    subject: input.subject,
    message: input.message,
  });
  await auditInCompany(ctx, meta, {
    action: "EXPORT",
    entityType: "DocumentSend",
    entityId: send.id,
    summary: `Sent ${printed.title} by email to ${to}`,
  });
  return { id: send.id, to: input.to, title: printed.title };
}

/**
 * Makes a secure link to the document's PDF for WhatsApp and logs the send.
 * The link holds its own copy of the PDF (kept sales PDFs are cleared after a
 * day) and works for the company's set number of days. Returns the link's
 * path (with the token, shown only now) and the number for wa.me.
 */
export async function createWhatsAppLink(
  ctx: CompanyContext,
  raw: unknown,
  meta?: RequestMeta,
  now: Date = new Date(),
) {
  const input = whatsappSendSchema.parse(raw);
  assertMaySend(ctx, input.request.type);
  const { printed, bytes, fileName } = await printedPdf(ctx, input.request, meta);
  const company = await prisma.company.findUniqueOrThrow({
    where: { id: ctx.company.id },
    select: { documentLinkDays: true },
  });
  const days = Math.max(1, company.documentLinkDays);
  const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const token = randomBytes(24).toString("base64url");
  const saved = await writeGeneratedFile(ctx.company.id, "document-links", ".pdf", bytes);
  const phone = whatsappNumber(input.phone);
  try {
    const { link, send } = await prisma.$transaction(async (tx) => {
      const asset = await tx.fileAsset.create({
        data: {
          companyId: ctx.company.id,
          uploadedById: null,
          fileName,
          mimeType: PDF_MIME,
          sizeBytes: saved.sizeBytes,
          storagePath: saved.storagePath,
          checksum: saved.checksum,
        },
      });
      const link = await tx.documentLink.create({
        data: {
          companyId: ctx.company.id,
          tokenHash: hashText(token),
          documentType: printed.type,
          documentId: printed.id,
          referenceType: printed.referenceType,
          referenceId: printed.referenceId,
          partyId: printed.party?.id ?? null,
          title: printed.title,
          fileId: asset.id,
          fileName,
          expiresAt,
          createdById: ctx.user.id,
        },
      });
      const send = await tx.documentSend.create({
        data: {
          companyId: ctx.company.id,
          channel: "WHATSAPP",
          status: "SENT",
          documentType: printed.type,
          documentId: printed.id,
          referenceType: printed.referenceType,
          referenceId: printed.referenceId,
          partyId: printed.party?.id ?? null,
          title: printed.title,
          recipients: phone || "Chosen in WhatsApp",
          message: input.message ? clip(input.message, 4000) : null,
          linkId: link.id,
          sentById: ctx.user.id,
        },
      });
      await auditInCompany(
        ctx,
        meta,
        {
          action: "EXPORT",
          entityType: "DocumentSend",
          entityId: send.id,
          summary: `Made a WhatsApp link to ${printed.title}${phone ? ` for ${phone}` : ""}, working for ${days} ${days === 1 ? "day" : "days"}`,
        },
        tx,
      );
      return { link, send };
    });
    return {
      id: send.id,
      linkId: link.id,
      path: documentLinkPath(token),
      phone,
      expiresAt,
      expiresOn: localDay(expiresAt, ctx.company.timezone),
      title: printed.title,
    };
  } catch (error) {
    await deleteStoredFile(saved).catch(() => undefined);
    throw error;
  }
}

/**
 * The phone's own Share with the PDF file: logged when the person presses it
 * (the phone does the sending), and the PDF to share comes from the kept copy.
 */
export async function recordShare(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = shareSendSchema.parse(raw);
  assertMaySend(ctx, input.request.type);
  const printed = await printDocument(ctx, input.request, meta);
  const send = await logSend(ctx, printed, { channel: "SHARE", recipients: "Chosen on the phone" });
  await auditInCompany(ctx, meta, {
    action: "EXPORT",
    entityType: "DocumentSend",
    entityId: send.id,
    summary: `Shared ${printed.title} from the phone`,
  });
  return {
    id: send.id,
    documentId: printed.id,
    fileName: printed.fileName ?? `${printed.title}.pdf`,
    title: printed.title,
  };
}

/** Stops a WhatsApp link at once (it answers "not found" from then on). */
export async function stopDocumentLink(
  ctx: CompanyContext,
  linkId: string,
  meta?: RequestMeta,
  now: Date = new Date(),
) {
  if (!ctx.can("documents.send")) {
    throw new AppError("FORBIDDEN", "You do not have permission to stop document links.");
  }
  const link = await ctx.db.documentLink.findUnique({ where: { id: linkId } });
  if (!link || !mayPrintType(ctx, link.documentType as PrintType)) {
    throw new AppError("NOT_FOUND", "Link not found.");
  }
  if (link.stoppedAt) return presentLink(link, now, ctx.company.timezone);
  const stopped = await ctx.db.documentLink.update({
    where: { id: link.id },
    data: { stoppedAt: now, stoppedById: ctx.user.id },
  });
  await auditInCompany(ctx, meta, {
    action: "STATUS_CHANGE",
    entityType: "DocumentLink",
    entityId: link.id,
    summary: `Stopped the WhatsApp link to ${link.title}`,
  });
  return presentLink(stopped, now, ctx.company.timezone);
}

/** "12 Nov 2026 14:05" in company time. */
const when = (at: Date, timeZone: string) =>
  `${formatInstantDay(at, timeZone)} ${localTime(at, timeZone)}`;

function presentLink(link: DocumentLink, now: Date, timeZone: string) {
  return {
    id: link.id,
    expiresAt: link.expiresAt,
    expiresText: when(link.expiresAt, timeZone),
    stoppedAt: link.stoppedAt,
    state: link.stoppedAt
      ? ("STOPPED" as const)
      : link.expiresAt <= now
        ? ("EXPIRED" as const)
        : ("ACTIVE" as const),
    openCount: link.openCount,
    lastOpenedAt: link.lastOpenedAt,
  };
}

export const sentHistorySchema = z
  .object({
    referenceIds: z.array(z.string().trim().min(1).max(64)).max(10).optional(),
    partyId: z.string().trim().min(1).max(64).optional(),
    type: z.enum(SENDABLE_TYPES).optional(),
    take: z.number().int().min(1).max(100).default(30),
  })
  .refine((v) => (v.referenceIds?.length ?? 0) > 0 || v.partyId, {
    message: "Say which document or buyer.",
  });

/**
 * Every send of a document (or to a buyer), newest first: only kinds of
 * documents this person sees, with each WhatsApp link's state and whether
 * they may stop it.
 */
export async function listDocumentSends(ctx: CompanyContext, raw: unknown, now: Date = new Date()) {
  const input = sentHistorySchema.parse(raw);
  const types = SENDABLE_TYPES.filter(
    (type) => mayPrintType(ctx, type) && (!input.type || input.type === type),
  );
  if (types.length === 0) return { items: [], canStop: false };
  const rows: DocumentSend[] = await ctx.db.documentSend.findMany({
    where: {
      documentType: { in: [...types] },
      ...(input.referenceIds?.length ? { referenceId: { in: input.referenceIds } } : {}),
      ...(input.partyId ? { partyId: input.partyId } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.take,
  });
  const linkIds = rows.flatMap((r) => (r.linkId ? [r.linkId] : []));
  const userIds = [...new Set(rows.flatMap((r) => (r.sentById ? [r.sentById] : [])))];
  const [links, users] = await Promise.all([
    linkIds.length
      ? ctx.db.documentLink.findMany({ where: { id: { in: linkIds } } })
      : Promise.resolve([]),
    userIds.length
      ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  return {
    canStop: ctx.can("documents.send"),
    items: rows.map((r) => {
      const link = r.linkId ? links.find((l) => l.id === r.linkId) : undefined;
      return {
        id: r.id,
        channel: r.channel,
        status: r.status,
        type: r.documentType as SendableType,
        title: r.title,
        recipients: r.recipients,
        subject: r.subject,
        error: r.error,
        sentBy: users.find((u) => u.id === r.sentById)?.name ?? null,
        sentAt: r.createdAt,
        sentText: when(r.createdAt, ctx.company.timezone),
        link: link ? presentLink(link, now, ctx.company.timezone) : null,
      };
    }),
  };
}

export type SentHistory = Awaited<ReturnType<typeof listDocumentSends>>;

/**
 * The public side of a WhatsApp link: the PDF it holds, or null (wrong,
 * stopped or expired token, or the file gone). No sign-in; the token is the
 * only key and it opens only this one file. Each open is counted.
 */
export async function openDocumentLink(token: string, now: Date = new Date()) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const link = await prisma.documentLink.findUnique({
    where: { tokenHash: hashText(token) },
    include: { file: true },
  });
  if (!link || link.stoppedAt || link.expiresAt <= now || !link.file) return null;
  // Its own copy, of its own company only.
  if (link.file.companyId !== link.companyId) return null;
  if (!(await storedFileExists(link.file))) return null;
  const bytes = await readStoredFile(link.file);
  await prisma.documentLink.update({
    where: { id: link.id },
    data: { openCount: { increment: 1 }, lastOpenedAt: now },
  });
  return { bytes, fileName: link.fileName };
}

/** Days a WhatsApp link's own PDF copy is kept after the link expired or was stopped. */
export const LINK_FILE_KEEP_DAYS = 3;

/**
 * Nightly (housekeeping/scheduler.ts): deletes the PDF copy of each WhatsApp
 * link that expired or was stopped more than LINK_FILE_KEEP_DAYS days ago.
 * The link and its "Sent" row stay (the file link is cleared: onDelete SetNull),
 * so the history still shows it. Returns the files deleted.
 */
export async function purgeEndedLinkFiles(now: Date = new Date()) {
  const before = new Date(now.getTime() - LINK_FILE_KEEP_DAYS * 24 * 60 * 60 * 1000);
  let removed = 0;
  for (let batch = 0; batch < 20; batch++) {
    const files = await prisma.fileAsset.findMany({
      where: {
        // A link's file, and no link on it still running or ended less than the keep days ago
        // (an empty stoppedAt is said outright: SQL never compares it).
        documentLinks: {
          some: {},
          none: {
            expiresAt: { gte: before },
            OR: [{ stoppedAt: null }, { stoppedAt: { gte: before } }],
          },
        },
      },
      select: { id: true, storagePath: true },
      orderBy: { createdAt: "asc" },
      take: 500,
    });
    for (const file of files) {
      await prisma.fileAsset.delete({ where: { id: file.id } });
      await deleteStoredFile(file).catch((error) => {
        console.error("[housekeeping] could not delete a link's PDF", file.storagePath, error);
      });
    }
    removed += files.length;
    if (files.length < 500) break;
  }
  return removed;
}

/**
 * Who is opening a link, for the rate limit: the right-most X-Forwarded-For
 * entry, the one our own proxy (Caddy) added, so an address a visitor writes
 * into the header first never counts; then the same Cloudflare handling as
 * every other route (clientAddress).
 */
export function linkVisitor(headers: Pick<Headers, "get">) {
  const ours = headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  return clientAddress({
    get: (name: string) =>
      name.toLowerCase() === "x-forwarded-for" ? (ours ?? null) : headers.get(name),
  });
}
