"use client";

import { MailIcon } from "lucide-react";

import { IntegrationPendingButton } from "@/components/feedback/integration-pending";

/**
 * The Email button for a 360° profile. Sending email comes with the
 * integrations, which are on hold, so for now it only says so.
 */
export function EmailPendingButton({
  what,
  className,
}: {
  /** What would be emailed: "Rahim Traders' 360° profile". */
  what: string;
  className?: string;
}) {
  return (
    <IntegrationPendingButton icon={MailIcon} label="Email" className={className}>
      Sending {what} by email comes with the integrations, which are on hold for now. Until then,
      download the PDF and attach it to your email.
    </IntegrationPendingButton>
  );
}
