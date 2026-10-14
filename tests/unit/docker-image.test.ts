import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("the Docker image", () => {
  it("ships public/ beside the standalone server: the favicon, app icons and service worker", () => {
    // Next's standalone build leaves public/ out, so the image must copy it itself;
    // without it the live site answers 404 for /favicon.ico (found 2026-10-14).
    const runner = readFileSync("Dockerfile", "utf8").split(/^FROM .* AS runner$/m)[1] ?? "";
    expect(runner).toMatch(/^COPY --from=builder .*\/app\/public \.\/public$/m);
    expect(runner).toMatch(/^COPY --from=builder .*\/app\/\.next\/standalone \.\/$/m);
  });
});
