import {
  BookOpenIcon,
  ClipboardListIcon,
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
  SparklesIcon,
  ShieldCheckIcon,
  ShirtIcon,
  SpoolIcon,
  StoreIcon,
  UsersRoundIcon,
} from "lucide-react";

/** "12টি নির্দেশিকা": the manual writes numbers in Western digits (CLAUDE.md section 5). */
export function guideCount(count: number): string {
  return `${count}টি নির্দেশিকা`;
}

/** Each part of the manual's icon, matching the menu. */
export const HELP_ICONS: Record<string, LucideIcon> = {
  "getting-started": BookOpenIcon,
  dashboard: LayoutDashboardIcon,
  business: StoreIcon,
  sales: ReceiptTextIcon,
  production: FactoryIcon,
  "tech-pack": ClipboardListIcon,
  accounts: LandmarkIcon,
  products: ShirtIcon,
  materials: SpoolIcon,
  parties: HandshakeIcon,
  hr: UsersRoundIcon,
  reports: FileTextIcon,
  planner: NotebookPenIcon,
  compliance: ShieldCheckIcon,
  "my-hr": IdCardIcon,
  ai: SparklesIcon,
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
