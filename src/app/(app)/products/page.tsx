import type { Metadata } from "next";

import { StyleListPage } from "@/components/products/style-list-page";

export const metadata: Metadata = { title: "Products" };

/** The Styles tab: the active styles. */
export default function StylesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <StyleListPage searchParams={searchParams} archived={false} />;
}
