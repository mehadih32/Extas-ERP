import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";

import { FormAlert } from "@/components/forms/field";
import type { BlockedModel } from "@/modules/ai/settings.service";

/**
 * The warning on AI Home and Models (v6.4 A7): models with no price that have
 * work. The AI never uses a model with no price, so the work set to it stops
 * until the owner adds the price or gives the work another model.
 */
export function BlockedModels({
  blocked,
  link = false,
}: {
  blocked: readonly BlockedModel[];
  /** A link to Models (on AI Home). */
  link?: boolean;
}) {
  if (blocked.length === 0) return null;
  return (
    <FormAlert tone="error">
      <p className="font-medium">
        {blocked.length === 1
          ? "A model with no price is blocked"
          : `${blocked.length} models with no price are blocked`}
      </p>
      <p className="mt-1">
        The AI never uses a model without a price, so this work stops until you add the price on AI
        Center &gt; Models, or give the work another model.
      </p>
      <ul className="mt-2 grid gap-1">
        {blocked.map((b) => (
          <li key={b.model} className="break-words">
            <span className="font-medium">{b.label}</span>: {b.where.join(", ")}
          </li>
        ))}
      </ul>
      {link && (
        <Link
          href="/ai/models#ai-prices-heading"
          className="mt-2 inline-flex items-center gap-1 underline underline-offset-4"
        >
          Add the prices
          <ArrowRightIcon aria-hidden className="size-3.5" />
        </Link>
      )}
    </FormAlert>
  );
}
