import { MailIcon, MessageCircleIcon, PhoneIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { whatsappDigits } from "@/modules/parties/contact";

/** "tel:" with the digits and a leading +, or null without a number. */
export function telHref(phone: string | null | undefined): string | null {
  const dial = phone?.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "") ?? "";
  return dial.replace(/\D/g, "").length >= 3 ? `tel:${dial}` : null;
}

/** A wa.me chat with their WhatsApp number (else their phone), or null without one. */
export function whatsappHref(whatsapp: string | null | undefined, phone?: string | null) {
  const digits = whatsappDigits(whatsapp) ?? whatsappDigits(phone);
  return digits ? `https://wa.me/${digits}` : null;
}

const linkClass =
  "relative z-10 inline-flex shrink-0 items-center justify-center rounded-full border bg-card text-muted-foreground transition-colors outline-none hover:border-primary/40 hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/25";

/**
 * One-tap contact for an employee: a WhatsApp chat (their WhatsApp number,
 * else their phone) and a call; an email too when asked for. Nothing shows
 * for a way they have no number or address for.
 */
export function ContactLinks({
  name,
  phone,
  whatsapp,
  email,
  size = "md",
  className,
}: {
  name: string;
  phone: string | null;
  whatsapp: string | null;
  email?: string | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const chat = whatsappHref(whatsapp, phone);
  const call = telHref(phone ?? whatsapp);
  if (!chat && !call && !email) return null;
  const box =
    size === "sm" ? "size-10 md:size-8 [&_svg]:size-4" : "size-10 [&_svg]:size-[1.125rem]";
  return (
    <span className={cn("flex shrink-0 items-center gap-1.5", className)}>
      {chat && (
        <a
          href={chat}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`WhatsApp ${name}`}
          title={`WhatsApp ${name}`}
          className={cn(linkClass, box, "hover:text-success")}
        >
          <MessageCircleIcon aria-hidden />
        </a>
      )}
      {call && (
        <a
          href={call}
          aria-label={`Call ${name}`}
          title={`Call ${name}`}
          className={cn(linkClass, box)}
        >
          <PhoneIcon aria-hidden />
        </a>
      )}
      {email && (
        <a
          href={`mailto:${email}`}
          aria-label={`Email ${name}`}
          title={`Email ${name}`}
          className={cn(linkClass, box)}
        >
          <MailIcon aria-hidden />
        </a>
      )}
    </span>
  );
}
