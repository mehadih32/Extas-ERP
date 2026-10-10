import {
  BookOpenIcon,
  FactoryIcon,
  FileTextIcon,
  HandshakeIcon,
  IdCardIcon,
  LandmarkIcon,
  LayoutDashboardIcon,
  LifeBuoyIcon,
  type LucideIcon,
  NotebookPenIcon,
  ReceiptTextIcon,
  SettingsIcon,
  ShieldCheckIcon,
  ShirtIcon,
  SpoolIcon,
  UsersRoundIcon,
} from "lucide-react";

const BENGALI_DIGITS = "০১২৩৪৫৬৭৮৯";

/** A number in Bengali digits: 12 → "১২". */
export function bnDigits(value: number | string): string {
  return String(value).replace(/[0-9]/g, (d) => BENGALI_DIGITS[Number(d)]!);
}

/** "১২টি নির্দেশিকা" */
export function guideCount(count: number): string {
  return `${bnDigits(count)}টি নির্দেশিকা`;
}

/** Each part of the manual's icon, matching the menu. */
export const HELP_ICONS: Record<string, LucideIcon> = {
  "getting-started": BookOpenIcon,
  dashboard: LayoutDashboardIcon,
  sales: ReceiptTextIcon,
  production: FactoryIcon,
  accounts: LandmarkIcon,
  products: ShirtIcon,
  materials: SpoolIcon,
  parties: HandshakeIcon,
  hr: UsersRoundIcon,
  reports: FileTextIcon,
  planner: NotebookPenIcon,
  compliance: ShieldCheckIcon,
  "my-hr": IdCardIcon,
  settings: SettingsIcon,
  "help-center": LifeBuoyIcon,
};

export const helpHref = {
  home: (query?: string) => (query ? `/help?q=${encodeURIComponent(query)}` : "/help"),
  section: (id: string) => `/help/${encodeURIComponent(id)}`,
  article: (sectionId: string, slug: string) =>
    `/help/${encodeURIComponent(sectionId)}/${encodeURIComponent(slug)}`,
};

/** Shown on guides about pages the person's role does not open. */
export const NOT_IN_ROLE = "আপনার ভূমিকায় খোলা নেই";
