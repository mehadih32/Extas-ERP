import type Anthropic from "@anthropic-ai/sdk";
import type { AiBotLink, Prisma } from "@prisma/client";
import { z } from "zod";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import type { CompanyContext } from "@/modules/auth/context";
import { readStoredFile, storeUpload } from "@/modules/files/file.service";
import {
  AI_MAX_IMAGE_BYTES,
  claudeIntakeParser,
  type IntakeFile,
  type ParsedPackingList,
} from "@/modules/production/ai-intake";
import { createPartySchema } from "@/modules/parties/schemas";

import { asAi, auditAsAi } from "../account";
import type { ChatCard } from "../chat/cards";
import { aiReady, askerFor, toolInputOf } from "../claude";
import type { IncomingFile } from "./channel";
import { type BotOut, renderCard } from "./render";

/*
 * Files sent to the bot (Release 5): a buyer's PO (PDF or photo) becomes an
 * order draft, a visiting card a buyer draft, a factory packing list a
 * delivery (packing-list) draft. Each is read by the AI (so it needs the AI
 * on), saved in the AI's name and waits for a person in the ERP: nothing is
 * booked, added, stocked or sent by itself. What a file is comes from the
 * words sent with it ("PO", "card", "packing") or from a button.
 */

/** Said when the AI is off or paused: no AI call is made. */
export const FILES_NEED_AI =
  "Voice notes and files need AI. The owner turns AI on in AI Center (and it must not be paused). Until then, type what you need.";

export const FILE_KINDS = ["order", "card", "packing"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** What the words sent with a file say it is, if they say. */
export function kindFromCaption(caption: string | null | undefined): FileKind | null {
  const text = caption?.toLowerCase() ?? "";
  if (/\bpacking\b|প্যাকিং/.test(text)) return "packing";
  if (/\b(visiting|business)?\s*card\b|কার্ড/.test(text)) return "card";
  if (/\b(po|order|purchase order)\b|অর্ডার/.test(text)) return "order";
  return null;
}

const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

const words = (text: string): BotOut => ({ text, buttons: [] });

/**
 * A file arrived: kept in the store (in the AI's name), then read as what its
 * words say it is, or the person picks with a button.
 */
export async function fileArrived(
  link: AiBotLink,
  ctx: CompanyContext,
  file: IncomingFile,
  caption: string | null,
  download: (id: string) => Promise<Buffer>,
  meta: RequestMeta,
): Promise<BotOut> {
  if (file.size !== null && file.size > MAX_FILE_BYTES) {
    return words("That file is too large (10 MB at most). Send a smaller photo or PDF.");
  }
  const bytes = await download(file.id);
  const ai = await asAi(ctx);
  let stored: { id: string; fileName: string };
  try {
    stored = await storeUpload(ai, { fileName: file.name ?? "file", bytes }, meta);
  } catch (error) {
    if (error instanceof AppError) return words(error.message);
    throw error;
  }
  const kind = kindFromCaption(caption);
  if (kind) return readFileAs(link, ctx, stored.id, kind, caption, meta);
  return {
    text: `Got ${stored.fileName}. What is it?`,
    buttons: [
      [{ label: "Buyer PO: make an order draft", data: `fk:${stored.id}:o` }],
      [{ label: "Visiting card: make a buyer draft", data: `fk:${stored.id}:c` }],
      [{ label: "Packing list: make a delivery draft", data: `fk:${stored.id}:p` }],
    ],
  };
}

/** Reads a kept file as an order, a visiting card or a packing list, into a draft. */
export async function readFileAs(
  link: AiBotLink,
  ctx: CompanyContext,
  fileId: string,
  kind: FileKind,
  caption: string | null,
  meta: RequestMeta,
): Promise<BotOut> {
  const ready = await aiReady(link.companyId);
  if (!ready.on) return words(FILES_NEED_AI);
  const file = await ctx.db.fileAsset.findUnique({
    where: { id: fileId },
    select: { id: true, fileName: true, mimeType: true, sizeBytes: true, storagePath: true },
  });
  if (!file) return words("That file is not there any more. Send it again.");
  try {
    if (kind === "order") return await orderDraft(ctx, file);
    if (kind === "card") return await buyerDraft(ctx, file);
    return await packingDraft(ctx, file, caption, meta);
  } catch (error) {
    if (error instanceof AppError) return words(`Not done: ${error.message}`);
    throw error;
  }
}

type KeptFile = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
};

/** A buyer's PO: a new order draft for AI Center > Orders, read by the AI. */
async function orderDraft(ctx: CompanyContext, file: KeptFile): Promise<BotOut> {
  const { createRunFromBot, readFiles } = await import("../orders/order-run.service");
  const run = await createRunFromBot(ctx, file);
  const href = `${appUrl()}/ai/orders/${run.id}`;
  let read: { filled: string[]; missing: string[] };
  try {
    read = await readFiles(ctx, run.id);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return words(
      `Order draft ${run.number} is made with your file, but it could not be read: ${error.message} Fill it in on AI Center > Orders. ${href}`,
    );
  }
  const row = await ctx.db.aiOrderRun.findUniqueOrThrow({
    where: { id: run.id },
    select: { fields: true },
  });
  const f = row.fields as { buyer?: string | null; po?: string | null; quantity?: number | null };
  return words(
    [
      `Order draft ${run.number} made from your file. It waits for you on AI Center > Orders: nothing is booked or sent until you approve its plan there.`,
      `Buyer: ${f.buyer ?? "not read"}`,
      `PO: ${f.po ?? "not read"}`,
      `Pieces: ${f.quantity ?? "not read"}`,
      read.missing.length > 0 ? `Still missing: ${read.missing.join(", ")}` : "",
      href,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

const CARD_TOOL = "record_visiting_card";

const cardTool: Anthropic.Tool = {
  name: CARD_TOOL,
  description: "Record the company and person on a visiting (business) card.",
  input_schema: {
    type: "object",
    properties: {
      company: { type: ["string", "null"], description: "The company's name" },
      person: { type: ["string", "null"], description: "The person's name" },
      email: { type: ["string", "null"] },
      phone: { type: ["string", "null"], description: "With the country code if printed" },
      country: { type: ["string", "null"] },
      address: { type: ["string", "null"] },
    },
    required: ["company"],
  },
};

const cardOut = z.object({
  company: z.string().trim().max(160).nullish(),
  person: z.string().trim().max(120).nullish(),
  email: z.string().trim().max(200).nullish(),
  phone: z.string().trim().max(40).nullish(),
  country: z.string().trim().max(80).nullish(),
  address: z.string().trim().max(500).nullish(),
});

/** The image of a file for the AI (a photo, or a PDF as a document). */
async function blockOf(file: KeptFile): Promise<Anthropic.ContentBlockParam> {
  const isPdf = file.mimeType === "application/pdf";
  if (!isPdf && file.sizeBytes > AI_MAX_IMAGE_BYTES) {
    throw new AppError("VALIDATION", "The photo is too large for AI reading (5 MB at most).");
  }
  const data = (await readStoredFile(file)).toString("base64");
  return isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
    : {
        type: "image",
        source: {
          type: "base64",
          media_type: file.mimeType as "image/jpeg" | "image/png" | "image/webp",
          data,
        },
      };
}

/**
 * A visiting card: a buyer draft, waiting for the owner's Apply (in the ERP's
 * chat or here). The buyer is added only then, in the owner's name.
 */
async function buyerDraft(ctx: CompanyContext, file: KeptFile): Promise<BotOut> {
  if (!ctx.can("parties.manage")) {
    throw new AppError("FORBIDDEN", "Adding buyers is not part of your role.");
  }
  const ask = await askerFor(ctx.company.id, ctx.user.id);
  if (!ask) return words(FILES_NEED_AI);
  const { message } = await ask({
    task: "read.documents",
    why: "Read a visiting card sent to the bot",
    userId: ctx.user.id,
    screen: "bot",
    maxTokens: 1000,
    tools: [cardTool],
    messages: [
      {
        role: "user",
        content: [
          await blockOf(file),
          { type: "text", text: `This is a visiting card. Read it and call ${CARD_TOOL}.` },
        ],
      },
    ],
  });
  const read = cardOut.safeParse(toolInputOf(message, CARD_TOOL));
  const name = read.success ? (read.data.company ?? read.data.person ?? "").trim() : "";
  if (!read.success || name.length < 2) {
    return words("I could not read a company or a name on that card. Add the buyer in the ERP.");
  }
  // Only what makes a valid buyer goes on the card; anything unclear is left out.
  const wanted = {
    kind: "BUYER" as const,
    name,
    contactPerson: read.data.company ? (read.data.person ?? null) : null,
    email: read.data.email ?? null,
    phone: read.data.phone ?? null,
    country: read.data.country ?? null,
    address: read.data.address ?? null,
  };
  const params: Record<string, string | null> = { name };
  for (const key of ["contactPerson", "email", "phone", "country", "address"] as const) {
    const value = wanted[key];
    if (!value) continue;
    if (createPartySchema.safeParse({ kind: "BUYER", name, [key]: value }).success) {
      params[key] = value;
    }
  }
  const labels: Record<string, string> = {
    name: "Name",
    contactPerson: "Contact person",
    email: "Email",
    phone: "Phone",
    country: "Country",
    address: "Address",
  };
  const card: ChatCard = {
    type: "change",
    action: "buyer.create",
    title: `Add the buyer ${name}`,
    page: "Buyers & suppliers",
    href: "/parties/buyers",
    lines: Object.entries(params)
      .filter(([, v]) => v)
      .map(([k, v]) => ({ label: labels[k]!, after: v! })),
    params,
  };
  const row = await prisma.aiChatMessage.create({
    data: {
      companyId: ctx.company.id,
      userId: ctx.user.id,
      channel: "BOT",
      role: "AI",
      text: "Read from a visiting card. Nothing is added until you press Apply.",
      intent: "bot.card",
      card: card as unknown as Prisma.InputJsonValue,
      cardStatus: "PROPOSED",
    },
  });
  await auditAsAi(ctx.company.id, {
    action: "CREATE",
    entityType: "AiChat",
    entityId: row.id,
    summary: `Buyer draft ${name} read from a visiting card sent to the bot, waiting for the owner`,
  });
  const shown = renderCard(card, { messageId: row.id, status: "PROPOSED", appUrl: appUrl() });
  return {
    ...shown,
    text: `Buyer draft from the visiting card. Nothing is added until you press Apply (here or in AI Center > Chat).\n\n${shown.text}`,
  };
}

/**
 * The one place the bot reads a packing list. It uses the AI delivery reader
 * for now; switch it to the non-AI packing-list reader here, and only here.
 */
export async function readPackingListForBot(
  ctx: CompanyContext,
  file: IntakeFile,
): Promise<ParsedPackingList> {
  const ask = await askerFor(ctx.company.id, ctx.user.id);
  if (!ask) throw new AppError("UNAVAILABLE", FILES_NEED_AI);
  const [styles, colors, sizes] = await Promise.all([
    ctx.db.style.findMany({
      where: { isActive: true },
      select: { code: true },
      orderBy: { code: "asc" },
      take: 200,
    }),
    ctx.db.color.findMany({ select: { name: true }, orderBy: [{ sortOrder: "asc" }] }),
    ctx.db.size.findMany({ select: { name: true }, orderBy: [{ sortOrder: "asc" }] }),
  ]);
  return claudeIntakeParser(ask).parse(file, {
    document: "PACKING_LIST",
    projectStyle: null,
    styleCodes: styles.map((s) => s.code),
    colors: colors.map((c) => c.name),
    sizes: sizes.map((s) => s.name),
  });
}

/**
 * A factory packing list: a delivery draft on its production batch (named in
 * the words sent with it, or the only open batch of the styles on the list).
 * Nothing goes into stock until a person checks and confirms it.
 */
async function packingDraft(
  ctx: CompanyContext,
  file: KeptFile,
  caption: string | null,
  meta: RequestMeta,
): Promise<BotOut> {
  if (!ctx.can("production.stock_intake")) {
    throw new AppError("FORBIDDEN", "Receiving factory deliveries is not part of your role.");
  }
  const parsed = await readPackingListForBot(ctx, {
    bytes: await readStoredFile(file),
    mimeType: file.mimeType,
    fileName: file.fileName,
  });
  const pieces = parsed.lines.reduce((s, l) => s + l.quantity, 0);
  const open = { status: { in: ["ACTIVE" as const, "ON_HOLD" as const] } };
  const tokens = (caption ?? "").split(/\s+/).filter((t) => t.length >= 3);
  let projects = tokens.length
    ? await ctx.db.productionProject.findMany({
        where: { ...open, code: { in: tokens, mode: "insensitive" } },
        select: { id: true, code: true },
      })
    : [];
  if (projects.length === 0) {
    const codes = [...new Set(parsed.lines.flatMap((l) => (l.styleCode ? [l.styleCode] : [])))];
    projects = codes.length
      ? await ctx.db.productionProject.findMany({
          where: { ...open, style: { code: { in: codes, mode: "insensitive" } } },
          select: { id: true, code: true },
          take: 3,
        })
      : [];
  }
  if (projects.length !== 1) {
    return words(
      `I read ${pieces} pieces on the packing list, but could not tell which production batch it is for. Send it again with the batch code in the words (like "packing PP-2026-0004"), or add the delivery in the ERP.`,
    );
  }
  const project = projects[0]!;
  const { createIntake } = await import("@/modules/production/intake.service");
  const ai = await asAi(ctx);
  // Read once above: the delivery takes those lines as they are (the same reader).
  const intake = await createIntake(ai, { projectId: project.id, sourceFileId: file.id }, meta, {
    parse: async () => parsed,
  });
  return words(
    [
      `Delivery draft ${intake.number} made for ${project.code}: ${pieces} pieces read. Nothing goes into stock until someone checks and confirms it in the ERP.`,
      `${appUrl()}/production/deliveries/${intake.id}`,
    ].join("\n"),
  );
}
