/**
 * The Help Center's automatic pictures, step 1 of 2 (`npm run help:shots`): which
 * guides need a new picture, and what to mark on it. A guide needs one when it
 * has none yet, when its screen's code changed since the picture was taken, or
 * when its steps now point at other buttons (tests/unit/help-guides.test.ts
 * fails until then). Step 2, scripts/full-check/help-shots.mjs, takes them.
 *
 *   ALL=1       plan every guide again (a new release, or new sample data)
 *   ONLY        only these guides, comma-separated slugs
 *   HELP_PLAN   where to write the plan (default .help-shots/plan.json)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { HELP_SECTIONS } from "@/modules/help";
import { HELP_PICTURES } from "@/modules/help/pictures";

import {
  guideHash,
  pages,
  quotedLabels,
  screenFingerprint,
  shellFiles,
  shotRoute,
} from "./screens";

const root = process.cwd();
const shell = shellFiles(root);
const only = new Set((process.env.ONLY ?? "").split(",").filter(Boolean));
const all = process.env.ALL === "1";
const file = path.resolve(root, process.env.HELP_PLAN ?? ".help-shots/plan.json");

const guides = HELP_SECTIONS.flatMap((section) =>
  section.articles.map((article) => {
    const route = shotRoute(article);
    return {
      slug: article.slug,
      section: section.id,
      route,
      // The sign-in page is the only one shown without a session (src/proxy.ts);
      // changing the password, choosing a company and the terms need one.
      signedOut: route === "/sign-in",
      open: article.shot?.open ?? null,
      steps: article.steps.map((step) => quotedLabels(step.text)),
      screen: screenFingerprint(root, route, shell),
      guide: guideHash(article),
    };
  }),
);

const wanted = guides.filter((g) => {
  if (only.size) return only.has(g.slug);
  if (all) return true;
  const had = HELP_PICTURES[g.slug];
  return !had || had.screen !== g.screen || had.guide !== g.guide;
});

mkdirSync(path.dirname(file), { recursive: true });
writeFileSync(
  file,
  JSON.stringify({ patterns: pages(root).map((p) => p.route), guides: wanted }, null, 2),
);
console.log(`${wanted.length} of ${guides.length} guides need a new picture: ${file}`);
