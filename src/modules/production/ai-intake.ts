import type { StockGrade } from "@prisma/client";
import { z } from "zod";

import { AppError } from "@/lib/errors";

/*
 * AI Photo Intake: reads a factory packing list (photo or PDF) into colour x
 * size quantity lines, then matches them to the style's SKUs. Uses the Claude
 * API when AI_API_KEY and AI_INTAKE_MODEL are set; nothing is stocked until a
 * person confirms.
 */

/** Images sent to the AI reader are capped at 5 MB; PDFs can use the full upload size. */
export const AI_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type ParsedLine = {
  sku: string | null;
  styleCode: string | null;
  color: string | null;
  size: string | null;
  quantity: number;
  grade: StockGrade;
};

export type ParsedPackingList = {
  lines: ParsedLine[];
  /** 0 to 1: how sure the reader is about the quantities. */
  confidence: number;
  notes: string | null;
  model: string;
};

export type IntakeHints = {
  projectStyle: { code: string; name: string } | null;
  styleCodes: string[];
  colors: string[];
  sizes: string[];
};

export type IntakeFile = { bytes: Buffer; mimeType: string; fileName: string };

export interface IntakeParser {
  parse(file: IntakeFile, hints: IntakeHints): Promise<ParsedPackingList>;
}

const TOOL_NAME = "record_packing_list";

const toolInputSchema = z.object({
  lines: z
    .array(
      z.object({
        sku: z.string().nullish(),
        style_code: z.string().nullish(),
        color: z.string().nullish(),
        size: z.string().nullish(),
        quantity: z.number().int().min(0).max(1_000_000),
        grade: z.enum(["A", "B"]).nullish(),
      }),
    )
    .max(2000),
  confidence: z.number().min(0).max(1),
  notes: z.string().nullish(),
});

const TOOL = {
  name: TOOL_NAME,
  description: "Record every colour and size quantity line read from the factory packing list.",
  input_schema: {
    type: "object",
    properties: {
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            sku: { type: "string", description: "SKU exactly as printed, if any" },
            style_code: { type: "string", description: "Style / article code, if printed" },
            color: { type: "string" },
            size: { type: "string", description: "e.g. S, M, L, XL, XXL, 3XL" },
            quantity: { type: "integer", description: "Pieces, not cartons" },
            grade: {
              type: "string",
              enum: ["A", "B"],
              description: "B for seconds / rejects / B-grade pieces; otherwise A",
            },
          },
          required: ["quantity"],
        },
      },
      confidence: {
        type: "number",
        description: "0 to 1: how sure you are that every quantity is read correctly",
      },
      notes: { type: "string", description: "Anything unclear or unreadable" },
    },
    required: ["lines", "confidence"],
  },
} as const;

export function buildIntakePrompt(hints: IntakeHints): string {
  const list = (values: string[]) => (values.length ? values.join(", ") : "(none on file)");
  return [
    "This is a garment factory's packing list for finished goods delivered to our warehouse.",
    `Read it and call ${TOOL_NAME} with one line per colour and size (and grade).`,
    "",
    "Rules:",
    "- quantity is the number of pieces. If only cartons x pieces per carton are shown, multiply them.",
    "- When sizes are columns in a table, make one line per size with a quantity above zero.",
    '- grade is "B" for pieces marked B-grade, seconds, rejects, defective or alter; otherwise "A".',
    "- Copy SKUs and style codes exactly as printed.",
    "- Skip total and subtotal rows, carton numbers, weights and prices.",
    "- Use our names below when the printed name clearly means the same colour or size.",
    "",
    hints.projectStyle
      ? `This delivery is for style ${hints.projectStyle.code} (${hints.projectStyle.name}).`
      : "The style is not known in advance.",
    `Our style codes: ${list(hints.styleCodes)}`,
    `Our colours: ${list(hints.colors)}`,
    `Our sizes: ${list(hints.sizes)}`,
    "",
    "Put anything you could not read clearly in notes, and lower confidence when unsure.",
  ].join("\n");
}

/** Reads packing lists with the Claude API (Messages API, forced tool call). */
export function claudeIntakeParser(options: {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): IntakeParser {
  const { model } = options;
  const baseUrl = (options.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
  const doFetch = options.fetchImpl ?? fetch;

  return {
    async parse(file, hints) {
      const isPdf = file.mimeType === "application/pdf";
      if (!isPdf && file.bytes.length > AI_MAX_IMAGE_BYTES) {
        throw new AppError(
          "VALIDATION",
          "The photo is too large for AI reading (5 MB at most). Upload a smaller photo.",
        );
      }
      const data = file.bytes.toString("base64");
      const body = {
        model,
        max_tokens: 8192,
        tools: [TOOL],
        tool_choice: { type: "tool", name: TOOL_NAME },
        messages: [
          {
            role: "user",
            content: [
              isPdf
                ? {
                    type: "document",
                    source: { type: "base64", media_type: "application/pdf", data },
                  }
                : { type: "image", source: { type: "base64", media_type: file.mimeType, data } },
              { type: "text", text: buildIntakePrompt(hints) },
            ],
          },
        ],
      };

      let response: Response;
      try {
        response = await doFetch(`${baseUrl}/v1/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": options.apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(120_000),
        });
      } catch (error) {
        console.error("[ai-intake] request failed", error);
        throw new AppError(
          "UNAVAILABLE",
          "The AI reader could not be reached. Try again, or enter the quantities by hand.",
        );
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        console.error(`[ai-intake] ${response.status}`, detail.slice(0, 500));
        const message =
          response.status === 401 || response.status === 403
            ? "The AI reader refused the key. Check AI_API_KEY."
            : response.status === 404
              ? "The AI reader does not know this model. Check AI_INTAKE_MODEL."
              : response.status === 429 || response.status === 529
                ? "The AI reader is busy. Try again in a minute."
                : "The AI reader could not read this file. Enter the quantities by hand.";
        throw new AppError("UNAVAILABLE", message);
      }

      const json = (await response.json()) as {
        model?: string;
        content?: Array<{ type: string; name?: string; input?: unknown }>;
      };
      const call = json.content?.find((b) => b.type === "tool_use" && b.name === TOOL_NAME);
      const parsed = toolInputSchema.safeParse(call?.input);
      if (!parsed.success) {
        throw new AppError(
          "UNAVAILABLE",
          "The AI reader did not return readable lines. Enter the quantities by hand.",
        );
      }
      return {
        lines: parsed.data.lines
          .filter((l) => l.quantity > 0)
          .map((l) => ({
            sku: l.sku?.trim() || null,
            styleCode: l.style_code?.trim() || null,
            color: l.color?.trim() || null,
            size: l.size?.trim() || null,
            quantity: l.quantity,
            grade: l.grade === "B" ? "B_GRADE" : "A_GRADE",
          })),
        confidence: parsed.data.confidence,
        notes: parsed.data.notes?.trim() || null,
        model: json.model ?? model,
      };
    },
  };
}

/** The configured reader, or null until both AI_API_KEY and AI_INTAKE_MODEL are set. */
export function defaultIntakeParser(): IntakeParser | null {
  const apiKey = process.env.AI_API_KEY?.trim();
  const model = process.env.AI_INTAKE_MODEL?.trim();
  if (!apiKey || !model) return null;
  return claudeIntakeParser({ apiKey, model });
}

// =============================================================================
// Matching read lines to SKUs
// =============================================================================

export type MatchVariant = {
  id: string;
  sku: string;
  styleId: string;
  styleCode: string;
  colorName: string;
  sizeName: string;
};

export type UnmatchedLine = ParsedLine & { reason: string };

/** "ex-pl 001" -> "EXPL001": compares codes and names whatever their punctuation. */
export const normalizeCode = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
const norm = normalizeCode;

const SIZE_ALIASES: Record<string, string> = {
  SMALL: "S",
  MEDIUM: "M",
  MED: "M",
  LARGE: "L",
  XLARGE: "XL",
  EXTRALARGE: "XL",
  "2XL": "XXL",
  XXLARGE: "XXL",
  XXXL: "3XL",
  XXXXL: "4XL",
};

/** "Extra Large" -> XL, "2XL" -> XXL, "XXXL" -> 3XL, so printed sizes meet ours. */
export function canonicalSize(size: string): string {
  const n = norm(size);
  return SIZE_ALIASES[n] ?? n;
}

/**
 * Turns read lines into SKU quantities. A line matches by SKU, or by style code
 * (the project's style when none is printed) plus colour and size. Repeats of
 * the same SKU and grade are added up; anything else is returned with a reason.
 */
export function matchParsedLines(
  lines: ParsedLine[],
  variants: MatchVariant[],
  defaultStyleId: string | null,
) {
  const bySku = new Map(variants.map((v) => [norm(v.sku), v]));
  const styleIdsByCode = new Map<string, string>();
  for (const v of variants) styleIdsByCode.set(norm(v.styleCode), v.styleId);
  const colorsOf = (styleId: string) => [
    ...new Set(variants.filter((v) => v.styleId === styleId).map((v) => v.colorName)),
  ];

  const merged = new Map<string, { variantId: string; grade: StockGrade; quantity: number }>();
  const unmatched: UnmatchedLine[] = [];
  const add = (variantId: string, line: ParsedLine) => {
    const key = `${variantId}:${line.grade}`;
    const row = merged.get(key) ?? { variantId, grade: line.grade, quantity: 0 };
    row.quantity += line.quantity;
    merged.set(key, row);
  };

  for (const line of lines) {
    const skuHit = line.sku ? bySku.get(norm(line.sku)) : undefined;
    if (skuHit) {
      add(skuHit.id, line);
      continue;
    }
    const styleId = line.styleCode
      ? styleIdsByCode.get(norm(line.styleCode))
      : (defaultStyleId ?? undefined);
    if (!styleId) {
      unmatched.push({
        ...line,
        reason: line.styleCode
          ? `Style ${line.styleCode} is not in the catalog`
          : "No style on this line",
      });
      continue;
    }
    if (!line.color || !line.size) {
      unmatched.push({ ...line, reason: "Colour or size is missing" });
      continue;
    }
    // Exact colour name first; otherwise one colour whose name starts the same way.
    const colors = colorsOf(styleId);
    const wanted = norm(line.color);
    let color = colors.find((c) => norm(c) === wanted);
    if (!color) {
      const close = colors.filter((c) => norm(c).startsWith(wanted) || wanted.startsWith(norm(c)));
      if (close.length === 1) color = close[0];
    }
    const size = canonicalSize(line.size);
    const variant = color
      ? variants.find(
          (v) =>
            v.styleId === styleId && v.colorName === color && canonicalSize(v.sizeName) === size,
        )
      : undefined;
    if (!variant) {
      unmatched.push({
        ...line,
        reason: `${line.color} / ${line.size} is not in this style's matrix`,
      });
      continue;
    }
    add(variant.id, line);
  }
  return { lines: [...merged.values()], unmatched };
}
