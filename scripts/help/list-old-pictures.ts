/**
 * The Help pictures that are out of date, for Bug Guard (v6.4 L1). The Docker
 * build runs it and the app's image carries the list beside the server:
 *
 *   npx tsx scripts/help/list-old-pictures.ts help-pictures-old.json
 *
 * Bug Guard's "Help pictures out of date" check reads it
 * (src/modules/bug-guard/checks/help-pictures.ts).
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { HELP_SECTIONS } from "@/modules/help";
import { HELP_PICTURES } from "@/modules/help/pictures";

import { oldPictures } from "./old-pictures";

const root = process.cwd();
const file = path.resolve(root, process.argv[2] ?? "help-pictures-old.json");
const guides = HELP_SECTIONS.flatMap((section) =>
  section.articles.map((article) => ({ section, article })),
);
const old = oldPictures(root, guides, HELP_PICTURES);
writeFileSync(file, JSON.stringify({ made: new Date().toISOString(), old }, null, 2));
console.log(`${old.length} of ${guides.length} Help pictures are out of date: ${file}`);
