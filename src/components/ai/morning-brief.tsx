import { SunriseIcon } from "lucide-react";

import { Panel } from "@/components/sales/detail-bits";

/*
 * AI Home's morning brief: written by the ERP from its own data (no AI call),
 * the same note the owner gets at 08:00 while the AI is on.
 */
export function MorningBrief({ brief }: { brief: { title: string; lines: string[] } }) {
  return (
    <Panel
      title="Morning brief"
      id="ai-brief-heading"
      action={<SunriseIcon aria-hidden className="size-5 text-muted-foreground" />}
    >
      <p className="mt-1 text-[0.8125rem] text-muted-foreground">{brief.title}</p>
      <ul className="mt-3 grid gap-1.5 text-sm">
        {brief.lines.map((line, i) => (
          <li key={i} className="break-words">
            {line}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
