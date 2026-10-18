import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/actions/mehedi.actions", () => ({
  resetBookAction: vi.fn(),
  saveBookAction: vi.fn(),
}));

import { BookScreen } from "@/components/ai/book-screen";
import type { BookScreen as Book } from "@/modules/ai/knowledge.service";

/*
 * AI Center > Books & tests > a book, on a 390 px phone: a long word in the
 * book's text (an API path like /api/production/batches/[batchId]/booking-book)
 * breaks onto the next line instead of running off the side.
 */

const PATH = "/api/production/batches/[batchId]/booking-book?orientation=landscape";

function book(): Book {
  return {
    code: "K1",
    title: "K1 Garment basics",
    about: "What a buying house does",
    text: `Print it from ${PATH}.`,
    own: false,
    updatedAt: null,
    questions: [{ n: 1, q: `Where is ${PATH}?`, expected: PATH }],
    passMark: 1,
    test: { state: "PASSED", text: "Passed" },
    runs: [
      {
        id: "r1",
        status: "DONE",
        right: 1,
        total: 1,
        passed: true,
        sameText: true,
        answers: [{ n: 1, q: "Where?", answer: PATH, right: true, why: PATH }],
        model: "m",
        error: null,
        by: null,
        createdAt: new Date("2026-10-01T00:00:00Z"),
        finishedAt: null,
      },
    ],
    can: { manage: false },
  } as unknown as Book;
}

describe("A Mehedi 2.0 book on a phone", () => {
  it("breaks long words in the book's text, its questions and his answers", () => {
    const html = renderToStaticMarkup(createElement(BookScreen, { book: book() }));
    const tags = [...html.matchAll(/<(pre|p|li)\b[^>]*class="([^"]*)"[^>]*>([^<]*)/g)];
    const holding = tags.filter((m) => m[3]!.includes("/api/production/batches"));
    expect(holding.length).toBeGreaterThanOrEqual(3);
    for (const m of holding) expect(m[2]).toContain("wrap-anywhere");
  });
});
