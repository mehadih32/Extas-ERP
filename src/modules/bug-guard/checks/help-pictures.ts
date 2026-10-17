import { readFile } from "node:fs/promises";
import path from "node:path";

import { HELP_SECTIONS } from "@/modules/help";

import type { Check, Found } from "../types";

/*
 * Help pictures out of date (v6.4 L1). Claude Code on GitHub cannot take the
 * Help Center's pictures, so its screen fixes reach main with the old ones.
 * The Docker build lists the guides whose picture is out of date
 * (scripts/help/list-old-pictures.ts); this check reads that list. Nothing is
 * wrong in the guides' words; every release takes all pictures again.
 */

type Report = { made?: string; old?: Array<{ slug?: string; why?: string }> };

/** Where the build left the list (the Docker image; see the Dockerfile). */
export const HELP_PICTURES_REPORT = () =>
  process.env.HELP_PICTURES_REPORT || path.join(process.cwd(), "help-pictures-old.json");

const WHY_BN: Record<string, string> = {
  none: "ছবি নেই",
  page: "ছবি অন্য পাতার",
  file: "ছবির ফাইল নেই",
  screen: "স্ক্রিন বদলেছে",
  steps: "ধাপ বদলেছে",
};

export const oldHelpPictures: Check = {
  key: "product.help-pictures",
  area: "PRODUCT",
  label: "Help pictures out of date",
  platform: true,
  async run() {
    let report: Report;
    try {
      report = JSON.parse(await readFile(HELP_PICTURES_REPORT(), "utf8")) as Report;
    } catch {
      return [];
    }
    const titles = new Map(
      HELP_SECTIONS.flatMap((s) => s.articles.map((a) => [a.slug, a.title] as const)),
    );
    const old = (Array.isArray(report.old) ? report.old : []).filter(
      (o): o is { slug: string; why?: string } => typeof o?.slug === "string" && titles.has(o.slug),
    );
    if (old.length === 0) return [];
    const slugs = old.map((o) => o.slug).sort();
    const found: Found = {
      key: `product.help-pictures:${slugs.join("|")}`.slice(0, 300),
      area: "PRODUCT",
      severity: "LATER",
      title: `Help-এর ${old.length}টি নির্দেশিকার ছবি পুরোনো: স্ক্রিন বা ধাপ বদলেছে, ছবি এখনো আগের।`,
      href: "/help",
      place: "Help",
      why: "নির্দেশিকার লেখা ঠিক আছে, শুধু ছবিটি আগের স্ক্রিনের; নতুন কেউ ছবির সাথে স্ক্রিন না মিললে একটু থমকে যেতে পারে।",
      fix: "কিছু করতে হবে না: প্রতিটি রিলিজে সব ছবি নতুন করে তোলা হয়।",
      fixKind: "NONE",
      evidence: old
        .slice(0, 15)
        .map((o) => ({ label: titles.get(o.slug)!, value: WHY_BN[o.why ?? ""] ?? "পুরোনো" })),
    };
    return [found];
  },
};
