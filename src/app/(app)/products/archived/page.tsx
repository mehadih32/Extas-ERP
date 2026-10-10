import type { Metadata } from "next";

import { StyleListPage } from "@/components/products/style-list-page";

export const metadata: Metadata = { title: "Archived styles" };

/** The Archived styles tab: styles put away, still in every report. */
export default function ArchivedStylesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <StyleListPage searchParams={searchParams} archived />;
}
