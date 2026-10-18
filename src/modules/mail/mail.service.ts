import { createTransport } from "nodemailer";
import { z } from "zod";

import { decryptSecret, encryptSecret } from "@/lib/crypto";
import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";

/*
 * Sending email from the company's own mailbox (SMTP). The owner gives the
 * mailbox's login in AI Center > Settings ("Email for sending"); the password is
 * kept sealed and never shown again. The server's SMTP_* settings stand in
 * while a company has none. Every email sent (or failed) is kept in the
 * message log. Tests put a stand-in in place of the real sending (standInForMail).
 * Nothing here decides whether an email may go: the caller does (a buyer's
 * email only ever goes when the owner sends it).
 */

export type MailConfig = {
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  password: string | null;
  fromAddress: string;
  fromName: string | null;
  /** Where it comes from: the company's own settings or the server's. */
  source: "company" | "server";
};

export type OutgoingMail = {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>;
};

type Sender = (config: MailConfig, mail: OutgoingMail) => Promise<{ messageId: string }>;

const smtpSender: Sender = async (config, mail) => {
  const transport = createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.username ? { auth: { user: config.username, pass: config.password ?? "" } } : {}),
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  const from = config.fromName
    ? { name: config.fromName, address: config.fromAddress }
    : config.fromAddress;
  const info = await transport.sendMail({
    from,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
    ...(mail.attachments ? { attachments: mail.attachments } : {}),
  });
  return { messageId: info.messageId };
};

let sender: Sender = smtpSender;

/** Tests send through a stand-in (null puts the real one back). */
export function standInForMail(stand: Sender | null) {
  sender = stand ?? smtpSender;
}

function serverConfig(): MailConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const from = process.env.SMTP_FROM?.trim();
  if (!host || !from) return null;
  const port = Number(process.env.SMTP_PORT) || 587;
  return {
    host,
    port,
    secure: port === 465,
    username: process.env.SMTP_USER?.trim() || null,
    password: process.env.SMTP_PASSWORD ?? null,
    fromAddress: from,
    fromName: null,
    source: "server",
  };
}

/** The company's mailbox for sending, or null when none is set up. */
export async function mailConfigOf(companyId: string, db: Db = prisma): Promise<MailConfig | null> {
  const row = await db.companyMailSettings.findUnique({ where: { companyId } });
  if (!row) return serverConfig();
  let password: string | null = null;
  if (row.passwordSealed) {
    try {
      password = decryptSecret(row.passwordSealed);
    } catch (error) {
      console.error("[mail] the stored password could not be unlocked", error);
      return null;
    }
  }
  return {
    host: row.host,
    port: row.port,
    secure: row.secure,
    username: row.username,
    password,
    fromAddress: row.fromAddress,
    fromName: row.fromName,
    source: "company",
  };
}

export const NO_MAIL_TEXT =
  "Email is not set up yet. The owner adds the mailbox's login in AI Center > Settings.";

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** Plain words for a sending problem (the server's own words go to the log). */
function plainError(error: unknown): string {
  const code = (error as { code?: string; responseCode?: number } | null)?.code;
  if (code === "EAUTH") return "The mailbox refused the login. Check the user name and password.";
  if (code === "ECONNECTION" || code === "ETIMEDOUT" || code === "ESOCKET" || code === "EDNS") {
    return "The mail server could not be reached. Check the server name and port.";
  }
  if (code === "EENVELOPE") return "The mail server refused the address.";
  return "The email could not be sent. Try again, or check the email settings.";
}

/**
 * Sends one email from the company's mailbox and keeps it in the message log.
 * Throws UNAVAILABLE (with a line people can read) when email is not set up or
 * the mail server refuses it.
 */
export async function sendMail(
  companyId: string,
  mail: OutgoingMail,
  options: { entityType?: string; entityId?: string; userId?: string | null } = {},
): Promise<{ messageId: string }> {
  const config = await mailConfigOf(companyId);
  if (!config) throw new AppError("UNAVAILABLE", NO_MAIL_TEXT);
  const log = {
    companyId,
    channel: "EMAIL" as const,
    recipient: clip(mail.to, 300),
    userId: options.userId ?? null,
    subject: clip(mail.subject, 200),
    body: clip(mail.text, 2000),
    entityType: options.entityType ?? null,
    entityId: options.entityId ?? null,
  };
  // A restore drill copy (test mode) sends no email; the log says so.
  const { DRILL_NOT_SENT, onDrill } = await import("@/modules/backups/standby");
  if (await onDrill()) {
    await prisma.notificationLog
      .create({ data: { ...log, status: "FAILED", error: DRILL_NOT_SENT } })
      .catch(() => undefined);
    throw new AppError("UNAVAILABLE", DRILL_NOT_SENT);
  }
  try {
    const sent = await sender(config, mail);
    await prisma.notificationLog.create({
      data: { ...log, status: "SENT", sentAt: new Date(), providerMessageId: sent.messageId },
    });
    return sent;
  } catch (error) {
    console.error("[mail] sending failed", error instanceof Error ? error.message : error);
    const plain = plainError(error);
    await prisma.notificationLog
      .create({ data: { ...log, status: "FAILED", error: plain } })
      .catch(() => undefined);
    throw new AppError("UNAVAILABLE", plain);
  }
}

function assertManage(ctx: CompanyContext) {
  if (!ctx.can("ai.manage")) {
    throw new AppError("FORBIDDEN", "Only the owner sets up the company's email.");
  }
}

/** The email settings as the screen shows them (never the password). */
export async function getMailSettings(ctx: CompanyContext) {
  const row = await ctx.db.companyMailSettings.findUnique({ where: { companyId: ctx.company.id } });
  const server = serverConfig();
  return {
    own: row
      ? {
          host: row.host,
          port: row.port,
          secure: row.secure,
          username: row.username,
          hasPassword: row.passwordSealed !== null,
          fromAddress: row.fromAddress,
          fromName: row.fromName,
          testedAt: row.testedAt,
          updatedAt: row.updatedAt,
        }
      : null,
    server: server ? { fromAddress: server.fromAddress } : null,
    can: { manage: ctx.can("ai.manage") },
  };
}

export type MailSettingsScreen = Awaited<ReturnType<typeof getMailSettings>>;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullish();

export const mailSettingsSchema = z.object({
  host: z
    .string()
    .trim()
    .min(3, "Give the mail server, e.g. smtp.gmail.com")
    .max(200)
    .regex(/^[A-Za-z0-9.-]+$/, "Only the server name, e.g. smtp.gmail.com"),
  port: z.coerce
    .number({ error: "Give the port, e.g. 587" })
    .int("Give the port, e.g. 587")
    .min(1, "Give the port, e.g. 587")
    .max(65535, "Give the port, e.g. 587"),
  secure: z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean()),
  username: optionalText(200),
  /** Empty keeps the saved password. */
  password: z.string().max(500).optional(),
  fromAddress: z.email("Give the address emails come from").max(200),
  fromName: optionalText(100),
});

/** Saves the company's mailbox; an empty password keeps the one saved before. */
export async function saveMailSettings(ctx: CompanyContext, input: unknown, meta?: RequestMeta) {
  assertManage(ctx);
  const data = mailSettingsSchema.parse(input);
  const password = data.password?.length ? encryptSecret(data.password) : undefined;
  const fields = {
    host: data.host,
    port: data.port,
    secure: data.secure,
    username: data.username ?? null,
    fromAddress: data.fromAddress,
    fromName: data.fromName ?? null,
    updatedById: ctx.user.id,
    // A changed mailbox is tested again.
    testedAt: null,
  };
  await prisma.companyMailSettings.upsert({
    where: { companyId: ctx.company.id },
    create: { companyId: ctx.company.id, ...fields, passwordSealed: password ?? null },
    update: { ...fields, ...(password !== undefined ? { passwordSealed: password } : {}) },
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "CompanyMailSettings",
    entityId: ctx.company.id,
    summary: `Email for sending: ${data.fromAddress} through ${data.host}:${data.port}`,
  });
}

/** Removes the company's mailbox (the server's, if any, then stands in). */
export async function removeMailSettings(ctx: CompanyContext, meta?: RequestMeta) {
  assertManage(ctx);
  await prisma.companyMailSettings.deleteMany({ where: { companyId: ctx.company.id } });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "CompanyMailSettings",
    entityId: ctx.company.id,
    summary: "Removed the email for sending",
  });
}

/** Sends a test email to the owner's own address and remembers that it worked. */
export async function sendTestMail(ctx: CompanyContext) {
  assertManage(ctx);
  checkRateLimit(`mail-test:${ctx.company.id}`, 5, 10 * 60_000);
  const sent = await sendMail(
    ctx.company.id,
    {
      to: ctx.user.email,
      subject: `${ctx.company.name}: test email`,
      text: `This is a test email from ${ctx.company.name}'s ERP. Email sending works.`,
    },
    { userId: ctx.user.id, entityType: "CompanyMailSettings", entityId: ctx.company.id },
  );
  await prisma.companyMailSettings.updateMany({
    where: { companyId: ctx.company.id },
    data: { testedAt: new Date() },
  });
  return { to: ctx.user.email, messageId: sent.messageId };
}
