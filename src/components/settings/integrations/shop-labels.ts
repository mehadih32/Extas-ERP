import type { Tone } from "@/components/sales/badges";

/*
 * The words of Settings > Integrations > E-commerce (CN-005), one place for the
 * list, the shop's page and the Help Center's guide.
 */

export const PLATFORM_OPTIONS = [
  { value: "CUSTOM_WEBSITE", label: "Custom website" },
  { value: "SHOPIFY", label: "Shopify" },
  { value: "WOOCOMMERCE", label: "WooCommerce" },
  { value: "OTHER", label: "Other" },
] as const;

const PLATFORM_LABELS: Record<string, string> = {
  CUSTOM_WEBSITE: "Custom website",
  SHOPIFY: "Shopify",
  WOOCOMMERCE: "WooCommerce",
  FACEBOOK_SHOP: "Facebook shop",
  OTHER: "Other",
};

export const platformLabel = (platform: string) => PLATFORM_LABELS[platform] ?? platform;

/** A webhook's state, as the log shows it. */
export function webhookState(row: { status: string; attempts: number }): {
  text: string;
  tone: Tone;
} {
  switch (row.status) {
    case "PROCESSED":
      return { text: "Delivered", tone: "done" };
    case "FAILED":
      return { text: "Failed", tone: "warn" };
    case "IGNORED":
      return { text: "Skipped", tone: "closed" };
    default:
      return row.attempts > 0
        ? { text: "Trying again", tone: "warn" }
        : { text: "Waiting", tone: "open" };
  }
}

/** The webhook log's filter: its value in the address (?status=) and its words. */
export const WEBHOOK_FILTER_OPTIONS = [
  { value: "ALL", label: "All" },
  { value: "PROCESSED", label: "Delivered" },
  { value: "RECEIVED", label: "Waiting" },
  { value: "FAILED", label: "Failed" },
  { value: "IGNORED", label: "Skipped" },
] as const;
