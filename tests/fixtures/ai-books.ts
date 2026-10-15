import { prisma } from "@/lib/prisma";
import { booksOf } from "@/modules/ai/knowledge";

/**
 * Mehedi 2.0 has passed every book's test today, on the books as they are now:
 * his Do cells count as Do (until then they ask first).
 */
export async function passAllBooks(companyId: string, at: Date = new Date()) {
  const books = await booksOf(companyId);
  await prisma.aiTestRun.createMany({
    data: books.map((b) => ({
      companyId,
      book: b.code,
      bookVersion: b.version,
      status: "DONE" as const,
      total: 8,
      right: 8,
      passed: true,
      createdAt: at,
      finishedAt: at,
    })),
  });
}
