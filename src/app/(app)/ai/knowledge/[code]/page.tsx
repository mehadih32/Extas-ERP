import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BookScreen } from "@/components/ai/book-screen";
import { AiNoAccess } from "@/components/ai/no-access";
import { SectionError } from "@/components/dashboard/section-error";
import { getBookAction } from "@/server/actions/mehedi.actions";

export const metadata: Metadata = { title: "Book" };

/** One book (ai.view or ai.manage): its text, its test questions and the last runs. */
export default async function AiBookPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const result = await getBookAction(code);
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <AiNoAccess />;
    if (result.error.code === "NOT_FOUND") notFound();
    return <SectionError title="Book" heading="The book could not load" error={result.error} />;
  }
  return <BookScreen book={result.data} />;
}
