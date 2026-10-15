import type { BackgroundJob, Prisma } from "@prisma/client";
import { z } from "zod";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { enqueueJob } from "@/modules/jobs/queue";
import { kickJobWorker } from "@/modules/jobs/worker";

import { type Ask, AiAskFirst, aiReady, askClaude, textOf, toolInputOf } from "./claude";
import {
  BOOK_CODES,
  type BookCode,
  bookTests,
  BOOKS,
  booksOf,
  isBookCode,
  passMark,
  STATE_TEXT,
  TEST_VALID_DAYS,
  testStanding,
  versionOf,
} from "./knowledge";
import { mehediSystem } from "./persona";
import { companyModelFor, aiSettingsOf } from "./settings.service";
import { estimateInputTokens, estimateUse } from "./usage.service";

/*
 * AI Center > Books & tests: Mehedi 2.0's books (read them, or change a book's
 * text for this company) and their end-of-book tests. A test runs in the
 * background: he answers every question of the book with the book in front of
 * him (without its answers), then each answer is checked against the expected
 * one. A pass (7 of every 8 right) counts for a month and only for that text
 * of the book; until then the tasks that need the book stay Ask (aiMay).
 */

function assertView(ctx: CompanyContext) {
  if (!ctx.can("ai.view") && !ctx.can("ai.manage")) {
    throw new AppError("FORBIDDEN", "You do not have permission to see the AI Center.");
  }
}

function assertManage(ctx: CompanyContext) {
  if (!ctx.can("ai.manage")) {
    throw new AppError("FORBIDDEN", "Only the owner changes the books and runs the tests.");
  }
}

/** The books and where each test stands, as the Books & tests page shows them. */
export async function getKnowledge(ctx: CompanyContext) {
  assertView(ctx);
  const [books, standing, tests] = await Promise.all([
    booksOf(ctx.company.id),
    testStanding(ctx.company.id),
    bookTests(),
  ]);
  return {
    books: books.map((b) => ({
      code: b.code,
      title: b.title,
      about: BOOKS[b.code].about,
      characters: b.text.length,
      own: b.own,
      updatedAt: b.updatedAt,
      questions: tests[b.code]?.questions.length ?? 0,
      passMark: passMark(tests[b.code]?.questions.length ?? 0),
      test: {
        ...standing[b.code],
        text: STATE_TEXT[standing[b.code].state],
      },
    })),
    validDays: TEST_VALID_DAYS,
    can: { manage: ctx.can("ai.manage") },
  };
}

export type KnowledgeScreen = Awaited<ReturnType<typeof getKnowledge>>;

/** One book: its text, its questions, and its last test runs with the answers. */
export async function getBook(ctx: CompanyContext, code: string) {
  assertView(ctx);
  if (!isBookCode(code)) throw new AppError("NOT_FOUND", "There is no such book.");
  const [[book], tests, standing, runs] = await Promise.all([
    booksOf(ctx.company.id, [code]),
    bookTests(),
    testStanding(ctx.company.id),
    ctx.db.aiTestRun.findMany({
      where: { book: code },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { startedBy: { select: { name: true } } },
    }),
  ]);
  return {
    code,
    title: book!.title,
    about: BOOKS[code].about,
    text: book!.text,
    own: book!.own,
    updatedAt: book!.updatedAt,
    questions: tests[code]?.questions ?? [],
    passMark: passMark(tests[code]?.questions.length ?? 0),
    test: { ...standing[code], text: STATE_TEXT[standing[code].state] },
    runs: runs.map((r) => ({
      id: r.id,
      status: r.status,
      right: r.right,
      total: r.total,
      passed: r.passed,
      sameText: r.bookVersion === book!.version,
      answers: (Array.isArray(r.answers) ? r.answers : []) as RunAnswer[],
      model: r.model,
      error: r.error,
      by: r.startedBy?.name ?? null,
      createdAt: r.createdAt,
      finishedAt: r.finishedAt,
    })),
    can: { manage: ctx.can("ai.manage") },
  };
}

export type BookScreen = Awaited<ReturnType<typeof getBook>>;

export type RunAnswer = {
  n: number;
  q: string;
  expected: string;
  answer: string;
  right: boolean;
  why: string;
};

export const bookTextSchema = z.object({
  text: z
    .string()
    .trim()
    .min(200, "A book needs at least 200 characters")
    .max(400_000, "A book can have at most 400,000 characters"),
});

/** Changes a book's text for this company (its tests must then be taken again). */
export async function saveBook(
  ctx: CompanyContext,
  code: string,
  input: unknown,
  meta?: RequestMeta,
) {
  assertManage(ctx);
  if (!isBookCode(code)) throw new AppError("NOT_FOUND", "There is no such book.");
  const { text } = bookTextSchema.parse(input);
  const version = versionOf(text);
  await prisma.aiKnowledgeBook.upsert({
    where: { companyId_code: { companyId: ctx.company.id, code } },
    create: { companyId: ctx.company.id, code, text, version, updatedById: ctx.user.id },
    update: { text, version, updatedById: ctx.user.id },
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "AiKnowledgeBook",
    entityId: code,
    summary: `Changed the book ${BOOKS[code].title} (its test is due again)`,
  });
}

/** Puts the book back to the text shipped with the app. */
export async function resetBook(ctx: CompanyContext, code: string, meta?: RequestMeta) {
  assertManage(ctx);
  if (!isBookCode(code)) throw new AppError("NOT_FOUND", "There is no such book.");
  await prisma.aiKnowledgeBook.deleteMany({ where: { companyId: ctx.company.id, code } });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "AiKnowledgeBook",
    entityId: code,
    summary: `Put the book ${BOOKS[code].title} back to the app's text`,
  });
}

/** About this long are a question and an answer (tokens). */
const QUESTION_TOKENS = 200;
const ANSWER_TOKENS = 700;

/** The books a test answers from: the book itself, with K1 and X26 always. */
const booksForTest = (code: BookCode): BookCode[] => [...new Set<BookCode>([code, "K1", "X26"])];

export const startTestsSchema = z.object({
  books: z.array(z.enum(BOOK_CODES)).min(1, "Pick a book").max(BOOK_CODES.length),
  /** The owner saw the estimate and said go on. */
  costOk: z.boolean().optional(),
});

/**
 * Starts the tests of the books picked, in the background. The AI must be on
 * with its key. Without a monthly budget (or above "Ask before a task above")
 * it first returns the estimate (AiAskFirst), and starts once the owner agrees.
 */
export async function startTests(ctx: CompanyContext, input: unknown, meta?: RequestMeta) {
  assertManage(ctx);
  const { books, costOk } = startTestsSchema.parse(input);
  const ready = await aiReady(ctx.company.id);
  if (!ready.on) throw new AppError("UNAVAILABLE", ready.text);
  const standing = await testStanding(ctx.company.id);
  const busy = books.filter((b) => standing[b].running);
  if (busy.length > 0) {
    throw new AppError("CONFLICT", `The ${busy.join(", ")} test is running already.`);
  }
  const tests = await bookTests();
  const all = await booksOf(ctx.company.id);
  if (!costOk) {
    // The whole run: each book once in full, then from the cache for the other
    // questions, an answer per question, and the marking.
    const settings = await aiSettingsOf(ctx.company.id);
    const model = companyModelFor(settings, "knowledge.test");
    const use = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    for (const code of books) {
      const count = tests[code]?.questions.length ?? 0;
      const read = estimateInputTokens({
        system: all
          .filter((b) => booksForTest(code).includes(b.code))
          .map((b) => b.text)
          .join("\n"),
        messages: [],
        maxTokens: 0,
      });
      use.cacheWrite += read;
      use.cacheRead += read * Math.max(0, count - 1);
      use.input += count * (QUESTION_TOKENS + ANSWER_TOKENS);
      use.output += count * (ANSWER_TOKENS + 120);
    }
    const estimate = await estimateUse(ctx.company.id, model, use, { big: true });
    if (estimate.askFirst) throw new AiAskFirst(estimate);
  }
  const version = new Map(all.map((b) => [b.code, b.version]));
  const runs = await prisma.$transaction(async (tx) => {
    const made = [];
    for (const code of books) {
      const run = await tx.aiTestRun.create({
        data: {
          companyId: ctx.company.id,
          book: code,
          bookVersion: version.get(code)!,
          total: tests[code]?.questions.length ?? 0,
          startedById: ctx.user.id,
        },
      });
      await enqueueJob(tx, {
        kind: "ai.knowledge.test",
        companyId: ctx.company.id,
        payload: { runId: run.id, userId: ctx.user.id },
        // A test is paid work: it is never run again by itself.
        maxAttempts: 1,
      });
      made.push(run);
    }
    return made;
  });
  await auditInCompany(ctx, meta, {
    action: "CREATE",
    entityType: "AiTestRun",
    entityId: runs[0]?.id ?? null,
    summary: `Started the test of ${books.join(", ")}`,
  });
  kickJobWorker();
  return runs.map((r) => ({ id: r.id, book: r.book }));
}

const MARKER = "record_marks";

const markTool = {
  name: MARKER,
  description: "Record whether each answer matches the expected answer.",
  input_schema: {
    type: "object" as const,
    properties: {
      marks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            n: { type: "integer" },
            right: { type: "boolean" },
            why: {
              type: "string",
              description: "One short line: what matched or what was missing.",
            },
          },
          required: ["n", "right", "why"],
        },
      },
    },
    required: ["marks"],
  },
};

const marksOut = z.object({
  marks: z.array(z.object({ n: z.number().int(), right: z.boolean(), why: z.string() })),
});

/**
 * Runs one book's test: every question answered with the books, then marked
 * against the expected answers in one call. The job's own `ask` is the company's.
 */
export async function runBookTest(
  runId: string,
  options: { ask?: Ask; userId?: string | null } = {},
) {
  const run = await prisma.aiTestRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== "RUNNING" || !isBookCode(run.book)) return;
  const code = run.book;
  const ask: Ask =
    options.ask ??
    ((request) =>
      askClaude(run.companyId, { userId: options.userId ?? null, ...request, costOk: true }));
  try {
    const tests = await bookTests();
    const questions = tests[code]?.questions ?? [];
    const system = await mehediSystem(run.companyId, {
      books: booksForTest(code),
      extra:
        "This is your end-of-book test. Answer each question as you would for the owner: short, in the question's language, with the numbers and the rule you use. Where the books' v6.2 rules replace an older method, answer by the v6.2 rule.",
    });
    const answers: RunAnswer[] = [];
    let model: string | null = null;
    for (const q of questions) {
      const answer = await ask({
        task: "knowledge.test",
        system,
        messages: [{ role: "user", content: q.q }],
        maxTokens: ANSWER_TOKENS,
        why: `${code} test, question ${q.n}`,
        record: { type: "AiTestRun", id: run.id, label: `${code} test` },
        effort: "low",
      });
      model = answer.model;
      answers.push({
        n: q.n,
        q: q.q,
        expected: q.expected,
        answer: textOf(answer.message),
        right: false,
        why: "",
      });
    }
    const marking = await ask({
      task: "knowledge.test",
      system:
        "You mark a test. For each question, compare the answer with the expected answer: right when it reaches the same result or decision and does not break a rule the expected answer gives (the wording may differ; extra correct detail is fine). Be strict on numbers and on who decides. Record the marks with the tool.",
      messages: [
        {
          role: "user",
          content: answers
            .map(
              (a) =>
                `<q n="${a.n}">\nQuestion: ${a.q}\nExpected: ${a.expected}\nAnswer: ${a.answer}\n</q>`,
            )
            .join("\n\n"),
        },
      ],
      tools: [markTool],
      maxTokens: 300 + answers.length * 120,
      why: `${code} test, marking`,
      record: { type: "AiTestRun", id: run.id, label: `${code} test` },
    });
    const marks = marksOut.safeParse(toolInputOf(marking.message, MARKER));
    if (!marks.success)
      throw new AppError("UNAVAILABLE", "The marking could not be read. Run the test again.");
    for (const a of answers) {
      const mark = marks.data.marks.find((m) => m.n === a.n);
      a.right = mark?.right ?? false;
      a.why = mark?.why?.slice(0, 500) ?? "Not marked";
    }
    const right = answers.filter((a) => a.right).length;
    const passed = questions.length > 0 && right >= passMark(questions.length);
    await prisma.aiTestRun.update({
      where: { id: run.id },
      data: {
        status: "DONE",
        right,
        passed,
        answers: answers as unknown as Prisma.InputJsonValue,
        model,
        finishedAt: new Date(),
      },
    });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "The test stopped. Run it again.";
    console.error(`[ai] test ${run.id} failed`, error instanceof Error ? error.message : error);
    await prisma.aiTestRun.update({
      where: { id: run.id },
      data: { status: "FAILED", error: message.slice(0, 500), finishedAt: new Date() },
    });
  }
}

/** The background job: one book's test. */
export async function runKnowledgeTestJob(job: BackgroundJob) {
  const payload = job.payload as { runId?: string; userId?: string };
  if (!payload.runId) return;
  await runBookTest(payload.runId, { userId: payload.userId ?? null });
}
