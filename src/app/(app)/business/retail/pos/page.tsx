import type { Metadata } from "next";

import { PosScreen } from "@/components/business/ecommerce-screen";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "POS" };

/** Business > Retail > POS: empty until the first showroom (plan v6 sec 11). */
export default async function PosPage() {
  await requireCompanyPage();
  return <PosScreen />;
}
