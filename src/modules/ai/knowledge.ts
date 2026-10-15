import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Db } from "@/lib/db-types";
import { prisma } from "@/lib/prisma";

/*
 * Mehedi 2.0's books: K1 (the owner's mind and rules), K2 (the map of the ERP),
 * K3 (a buying-house owner's knowledge), K4 (the Bangladesh garment market), K5
 * (handling foreign buyers), and X26 (his own rules). They ship with the app in
 * assets/knowledge, with the v6.2 corrections (profit % per order, no overhead,
 * CM fixed per style, fabric at the supplier's price per kg, the Order check
 * card instead of a score) and without their test sections; a company can
 * change a book's text (AiKnowledgeBook). Each book ends with a test
 * (tests.json): no Do on a task until he passes the books it needs, and a pass
 * counts for a month and only for the text it was taken on.
 */

export const BOOK_CODES = ["K1", "K2", "K3", "K4", "K5", "X26"] as const;
export type BookCode = (typeof BOOK_CODES)[number];

export const isBookCode = (code: string): code is BookCode =>
  (BOOK_CODES as readonly string[]).includes(code);

export const BOOKS: Record<BookCode, { title: string; about: string }> = {
  K1: {
    title: "K1 · The owner's mind and rules",
    about: "Who the owner is, how he thinks, the rules he decided, how to talk, what never to do.",
  },
  K2: {
    title: "K2 · Map of the ERP",
    about: "The modules, flows, permissions, delete paths and tools of this ERP.",
  },
  K3: {
    title: "K3 · Buying-house owner's knowledge",
    about: "Costing, pricing, payment and cash flow, T&A, choosing factories, risk.",
  },
  K4: {
    title: "K4 · Bangladesh garment market",
    about:
      "Exports, mills and clusters, lead times, the Eid and monsoon calendar, wages, gas, power, the dollar.",
  },
  K5: {
    title: "K5 · Handling foreign buyers",
    about: "How brands buy, communication, approvals, claims, compliance, the email templates.",
  },
  X26: {
    title: "X26 · Mehedi 2.0's own rules",
    about:
      "His limits, Control and modes, decisions, checks, costing and buyer rules, bot and Teach.",
  },
};

/** A pass needs 7 of every 8 questions right (the experts' mark; the source gives none). */
export const PASS_SHARE = 7 / 8;
export const passMark = (total: number) => Math.ceil(total * PASS_SHARE);

/** A pass counts for this many days: he is tested again every month. */
export const TEST_VALID_DAYS = 31;

const DIR = path.join(process.cwd(), "assets", "knowledge");

export const versionOf = (text: string) =>
  createHash("sha256").update(text).digest("hex").slice(0, 12);

const shipped = new Map<BookCode, Promise<string>>();

/** The book as it ships with the app. */
export function shippedBook(code: BookCode): Promise<string> {
  let text = shipped.get(code);
  if (!text) {
    text = readFile(path.join(DIR, `${code}.md`), "utf8").then((t) => t.trim());
    text.catch(() => shipped.delete(code));
    shipped.set(code, text);
  }
  return text;
}

export type Book = {
  code: BookCode;
  title: string;
  text: string;
  version: string;
  /** The company changed it. */
  own: boolean;
  updatedAt: Date | null;
};

/** The company's books: its own text where it changed one, the shipped text otherwise. */
export async function booksOf(
  companyId: string,
  codes: readonly BookCode[] = BOOK_CODES,
  db: Db = prisma,
): Promise<Book[]> {
  const own = await db.aiKnowledgeBook.findMany({
    where: { companyId, code: { in: [...codes] } },
    select: { code: true, text: true, version: true, updatedAt: true },
  });
  return Promise.all(
    codes.map(async (code) => {
      const row = own.find((r) => r.code === code);
      const text = row?.text ?? (await shippedBook(code));
      return {
        code,
        title: BOOKS[code].title,
        text,
        version: row?.version ?? versionOf(text),
        own: Boolean(row),
        updatedAt: row?.updatedAt ?? null,
      };
    }),
  );
}

export type BookQuestion = { n: number; q: string; expected: string; v62?: string };

let testsFile: Promise<Record<BookCode, { title: string; questions: BookQuestion[] }>> | null =
  null;

/** Every book's end-of-book test: the questions and the answers expected (v6.2). */
export function bookTests() {
  if (!testsFile) {
    testsFile = readFile(path.join(DIR, "tests.json"), "utf8").then((t) => JSON.parse(t));
    testsFile.catch(() => (testsFile = null));
  }
  return testsFile;
}

/**
 * The books an action needs passed before it can be Do: K1, K2 and X26 for
 * everything; K3 and K4 for production and materials; K3 and K5 for sales and
 * buyers; K3 for accounts.
 */
export function booksFor(key: string): BookCode[] {
  const base: BookCode[] = ["K1", "K2", "X26"];
  if (/^(ai\.production\.|production\.|materials\.|costing\.|inventory\.)/.test(key)) {
    return [...base, "K3", "K4"];
  }
  if (/^(ai\.buyer\.|ai\.sales\.|sales\.|parties\.)/.test(key)) return [...base, "K3", "K5"];
  if (/^(accounts\.|expenses\.)/.test(key)) return [...base, "K3"];
  return base;
}

export type TestState = "PASSED" | "FAILED" | "EXPIRED" | "CHANGED" | "RUNNING" | "NONE";

export type BookStanding = {
  code: BookCode;
  state: TestState;
  /** The last finished run. */
  last: { id: string; right: number; total: number; passed: boolean; at: Date } | null;
  /** Until when a pass counts. */
  validUntil: Date | null;
  running: boolean;
};

const DAY_MS = 86_400_000;

/** Where each book's test stands now. */
export async function testStanding(
  companyId: string,
  now: Date = new Date(),
  db: Db = prisma,
): Promise<Record<BookCode, BookStanding>> {
  const [books, runs] = await Promise.all([
    booksOf(companyId, BOOK_CODES, db),
    db.aiTestRun.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        book: true,
        bookVersion: true,
        status: true,
        right: true,
        total: true,
        passed: true,
        createdAt: true,
        finishedAt: true,
      },
    }),
  ]);
  const out = {} as Record<BookCode, BookStanding>;
  for (const book of books) {
    const mine = runs.filter((r) => r.book === book.code);
    // A run left RUNNING for an hour died with its server: it no longer blocks a new one.
    const running = mine.some(
      (r) => r.status === "RUNNING" && now.getTime() - r.createdAt.getTime() < 3_600_000,
    );
    const done = mine.find((r) => r.status === "DONE") ?? null;
    const validUntil = done?.passed
      ? new Date(done.createdAt.getTime() + TEST_VALID_DAYS * DAY_MS)
      : null;
    const state: TestState = !done
      ? running
        ? "RUNNING"
        : "NONE"
      : !done.passed
        ? "FAILED"
        : done.bookVersion !== book.version
          ? "CHANGED"
          : validUntil! <= now
            ? "EXPIRED"
            : "PASSED";
    out[book.code] = {
      code: book.code,
      state,
      last: done
        ? {
            id: done.id,
            right: done.right,
            total: done.total,
            passed: done.passed,
            at: done.finishedAt ?? done.createdAt,
          }
        : null,
      validUntil,
      running,
    };
  }
  return out;
}

export const STATE_TEXT: Record<TestState, string> = {
  PASSED: "Passed",
  FAILED: "Not passed",
  EXPIRED: "Due again",
  CHANGED: "Book changed: test again",
  RUNNING: "Running",
  NONE: "Not taken yet",
};

/** The books an action still needs passed before it can be Do (none: it may be Do). */
export async function testsMissingFor(
  companyId: string,
  key: string,
  now: Date = new Date(),
  db: Db = prisma,
): Promise<BookCode[]> {
  const standing = await testStanding(companyId, now, db);
  return booksFor(key).filter((code) => standing[code].state !== "PASSED");
}

type Section = { book: BookCode; heading: string; text: string };

/** A book cut into its sections (by headings and bold lines), for looking things up. */
export function sectionsOf(book: BookCode, text: string): Section[] {
  const sections: Section[] = [];
  let heading = BOOKS[book].title;
  let lines: string[] = [];
  const flush = () => {
    const body = lines.join("\n").trim();
    if (body) sections.push({ book, heading, text: body });
    lines = [];
  };
  for (const line of text.split("\n")) {
    const title = /^#{1,4}\s+(.+)$/.exec(line) ?? /^\*\*([^*]{2,120})\*\*\s*$/.exec(line);
    if (title) {
      flush();
      heading = title[1]!.trim();
      continue;
    }
    lines.push(line);
  }
  flush();
  return sections;
}

const termsOf = (query: string) =>
  [
    ...new Set(
      query
        .toLowerCase()
        .split(/[\s,.;:!?()"'“”‘’।|/\\[\]{}]+/)
        .filter((w) => w.length >= 2),
    ),
  ].slice(0, 20);

/** The book sections that best match a question, best first (a plain word search). */
export async function searchBooks(
  companyId: string,
  query: string,
  options: { books?: readonly BookCode[]; limit?: number; maxChars?: number } = {},
  db: Db = prisma,
): Promise<Section[]> {
  const terms = termsOf(query);
  if (terms.length === 0) return [];
  const books = await booksOf(companyId, options.books ?? BOOK_CODES, db);
  const scored = books
    .flatMap((b) => sectionsOf(b.code, b.text))
    .map((s) => {
      const hay = `${s.heading}\n${s.text}`.toLowerCase();
      let score = 0;
      for (const term of terms) {
        const hits = hay.split(term).length - 1;
        if (hits > 0) score += 1 + Math.min(hits, 5) * 0.2;
      }
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const maxChars = options.maxChars ?? 2500;
  return scored.slice(0, options.limit ?? 4).map(({ s }) => ({
    ...s,
    text: s.text.length > maxChars ? `${s.text.slice(0, maxChars)}…` : s.text,
  }));
}
