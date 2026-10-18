/**
 * The Help Center's automatic pictures, step 1 of 2 (`npm run help:shots`): which
 * guides need a new picture, and what to mark on it. A guide needs one when it
 * has none yet, when its screen's code changed since the picture was taken,
 * when its steps now point at other buttons or another part of the page, or
 * when its picture marks nothing (tests/unit/help-guides.test.ts fails until
 * then, except on Claude Code's fix branches: see scripts/help/old-pictures.ts).
 * Step 2, scripts/full-check/help-shots.mjs, takes them.
 *
 *   ALL=1       plan every guide again (a new release, or new sample data)
 *   ONLY        only these guides, comma-separated slugs
 *   HELP_PLAN   where to write the plan (default .help-shots/plan.json)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { HELP_SECTIONS } from "@/modules/help";
import { HELP_PICTURES } from "@/modules/help/pictures";

import { guideHash, markLabels, pages, screenFingerprint, shellFiles, shotRoute } from "./screens";

const root = process.cwd();
const shell = shellFiles(root);
const only = new Set((process.env.ONLY ?? "").split(",").filter(Boolean));
const all = process.env.ALL === "1";
const file = path.resolve(root, process.env.HELP_PLAN ?? ".help-shots/plan.json");

const guides = HELP_SECTIONS.flatMap((section) =>
  // A guide about what the demo data cannot show on a computer has no picture.
  section.articles
    .filter((article) => !article.shot?.none)
    .map((article) => {
      const route = shotRoute(article);
      return {
        slug: article.slug,
        section: section.id,
        route,
        // Its own addresses without a record in them: where a record's page is found.
        from: article.routes.filter((r) => !r.includes("[")),
        query: article.shot?.query ?? null,
        // The sign-in page is the only one shown without a session (src/proxy.ts);
        // changing the password, choosing a company and the terms need one.
        signedOut: route === "/sign-in",
        open: article.shot?.open ?? null,
        target: article.shot?.target ?? null,
        steps: article.steps.map((step) => markLabels(step.text)),
        screen: screenFingerprint(root, route, shell),
        guide: guideHash(article),
      };
    }),
);

const wanted = guides.filter((g) => {
  if (only.size) return only.has(g.slug);
  if (all) return true;
  const had = HELP_PICTURES[g.slug];
  return !had || had.screen !== g.screen || had.guide !== g.guide || !had.marks.length || !had.clip;
});

mkdirSync(path.dirname(file), { recursive: true });
writeFileSync(
  file,
  JSON.stringify(
    {
      patterns: pages(root).map((p) => p.route),
      guides: wanted,
      // Guides that have no picture: any old one is taken away.
      none: HELP_SECTIONS.flatMap((s) => s.articles)
        .filter((a) => a.shot?.none)
        .map((a) => a.slug),
    },
    null,
    2,
  ),
);
console.log(`${wanted.length} of ${guides.length} guides need a new picture: ${file}`);
