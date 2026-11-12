// Tries the free handwriting reader (PaddleOCR, run on our own machine, no AI service)
// on a folder of packing-list photos, to see how much of the handwriting it reads before
// it is built into "Upload packing list" (the owner's decision, 2026-11-12).
//
//   npm install --no-save @gutenye/ocr-node
//   node scripts/packing-list/handwriting-check.mjs <folder of photos>
//
// The owner's photos are never committed (the repository is public): keep them outside it.
import { readdirSync } from "node:fs";
import path from "node:path";

const folder = process.argv[2];
if (!folder) {
  console.error(
    "Give the folder of photos: node scripts/packing-list/handwriting-check.mjs <folder>",
  );
  process.exit(1);
}
const { default: Ocr } = await import("@gutenye/ocr-node");
const ocr = await Ocr.create();
const photos = readdirSync(folder)
  .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
  .sort();
for (const photo of photos) {
  const started = Date.now();
  const lines = await ocr.detect(path.join(folder, photo));
  console.log(`=== ${photo} (${Date.now() - started} ms, ${lines.length} lines)`);
  for (const line of lines) console.log(`${line.text}   [${(line.mean ?? 0).toFixed(2)}]`);
}
