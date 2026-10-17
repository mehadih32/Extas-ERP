import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { HELP_PICTURES_REPORT, oldHelpPictures } from "@/modules/bug-guard/checks/help-pictures";
import type { CheckContext } from "@/modules/bug-guard/types";
import { HELP_SECTIONS } from "@/modules/help";

import { branchUnderTest, oldPictures, picturesMayWait } from "../../scripts/help/old-pictures";
import { guideHash, screenFingerprint, shellFiles, shotRoute } from "../../scripts/help/screens";

/*
 * v6.4 L1: Claude Code on GitHub cannot take the Help pictures, so a screen fix
 * it makes must not wait for them. On its fix branches (claude/issue-…) and on
 * main itself, a picture may be out of date: Bug Guard lists those guides, and
 * every release takes all pictures again. Every other branch (a part or a
 * Release PR) still needs every picture up to date.
 */

const ROOT = path.resolve(__dirname, "../..");
const tmp = mkdtempSync(path.join(os.tmpdir(), "help-pictures-old-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("Which branch may leave Help pictures out of date (v6.4 L1)", () => {
  it("only a Claude Code fix branch, and main once a pull request is in", () => {
    expect(picturesMayWait("claude/issue-42-20261017-0930")).toBe(true);
    expect(picturesMayWait("claude/issue-7")).toBe(true);
    expect(picturesMayWait("main")).toBe(true);
    expect(picturesMayWait("claude/v64-fx-help")).toBe(false);
    expect(picturesMayWait("claude/issues-list")).toBe(false);
    expect(picturesMayWait("claude/issue-")).toBe(false);
    expect(picturesMayWait("feature/claude/issue-4")).toBe(false);
    expect(picturesMayWait("release/v6.4")).toBe(false);
    expect(picturesMayWait(null)).toBe(false);
  });

  it("reads the branch from the pull request, then GitHub's run, then git", () => {
    const git = () => "claude/issue-3-x";
    const pr = {
      GITHUB_ACTIONS: "true",
      GITHUB_HEAD_REF: "release/v6.4",
      GITHUB_REF_NAME: "12/merge",
    };
    expect(branchUnderTest(pr, git)).toBe("release/v6.4");
    const push = { GITHUB_ACTIONS: "true", GITHUB_HEAD_REF: "", GITHUB_REF_NAME: "main" };
    expect(branchUnderTest(push, git)).toBe("main");
    expect(branchUnderTest({}, git)).toBe("claude/issue-3-x");
    // A detached checkout, or no git at all: no branch, so every picture must be up to date.
    expect(branchUnderTest({}, () => "HEAD")).toBeNull();
    expect(
      branchUnderTest({}, () => {
        throw new Error("no git");
      }),
    ).toBeNull();
  });
});

describe("The list of out-of-date pictures the build leaves for Bug Guard (v6.4 L1)", () => {
  const shell = shellFiles(ROOT);
  const guide = HELP_SECTIONS.find((s) => s.id === "sales")!.articles.find(
    (a) => a.slug === "sales-quotation",
  )!;
  const route = shotRoute(guide);
  const file = path.join(tmp, "shot.webp");
  writeFileSync(file, "");
  const fresh = {
    src: "/help/shots/sales-quotation.webp",
    width: 1,
    height: 1,
    marks: [1],
    route,
    screen: screenFingerprint(ROOT, route, shell),
    guide: guideHash(guide),
    taken: "2026-10-17",
  };
  const only = [{ section: { id: "sales" }, article: guide }];
  const exists = (src: string) => src === fresh.src;

  it("names a guide with no picture, a picture of another page, or a lost file", () => {
    expect(oldPictures(ROOT, only, {}, exists)).toEqual([
      { slug: guide.slug, section: "sales", why: "none" },
    ]);
    expect(
      oldPictures(ROOT, only, { [guide.slug]: { ...fresh, route: "/sales/orders" } }, exists),
    ).toEqual([{ slug: guide.slug, section: "sales", why: "page" }]);
    expect(oldPictures(ROOT, only, { [guide.slug]: fresh }, () => false)).toEqual([
      { slug: guide.slug, section: "sales", why: "file" },
    ]);
  });

  it("names a guide whose screen or steps changed since its picture, and never a fresh one", () => {
    expect(oldPictures(ROOT, only, { [guide.slug]: fresh }, exists)).toEqual([]);
    expect(oldPictures(ROOT, only, { [guide.slug]: { ...fresh, screen: "old" } }, exists)).toEqual([
      { slug: guide.slug, section: "sales", why: "screen" },
    ]);
    expect(oldPictures(ROOT, only, { [guide.slug]: { ...fresh, guide: "old" } }, exists)).toEqual([
      { slug: guide.slug, section: "sales", why: "steps" },
    ]);
    const marked = { ...fresh, marks: [guide.steps.length + 1] };
    expect(oldPictures(ROOT, only, { [guide.slug]: marked }, exists)).toEqual([
      { slug: guide.slug, section: "sales", why: "steps" },
    ]);
  });

  it("is made in the Docker build and goes into the app's image beside the server", () => {
    const docker = readFileSync(path.join(ROOT, "Dockerfile"), "utf8");
    const [build, runner] = docker.split(/^FROM .* AS runner$/m);
    expect(build).toMatch(/scripts\/help\/list-old-pictures\.ts help-pictures-old\.json/);
    expect(runner).toMatch(
      /^COPY --from=builder .*\/app\/help-pictures-old\.json \.\/help-pictures-old\.json$/m,
    );
    delete process.env.HELP_PICTURES_REPORT;
    expect(HELP_PICTURES_REPORT()).toBe(path.join(process.cwd(), "help-pictures-old.json"));
  });
});

describe("Bug Guard reports out-of-date Help pictures (v6.4 L1)", () => {
  const ctx = {} as CheckContext;
  const report = (body: unknown) => {
    const at = path.join(tmp, `report-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(at, JSON.stringify(body));
    process.env.HELP_PICTURES_REPORT = at;
  };
  afterAll(() => {
    delete process.env.HELP_PICTURES_REPORT;
  });

  it("lists the guides by name, in Bengali, as something that can wait", async () => {
    report({
      made: "2026-10-17T01:00:00.000Z",
      old: [
        { slug: "sales-quotation", section: "sales", why: "screen" },
        { slug: "production-costing", section: "production", why: "none" },
        { slug: "no-such-guide", section: "sales", why: "steps" },
      ],
    });
    const found = await oldHelpPictures.run(ctx);
    expect(oldHelpPictures.platform).toBe(true);
    expect(found).toHaveLength(1);
    const [f] = found;
    expect(f).toMatchObject({ area: "PRODUCT", severity: "LATER", fixKind: "NONE", href: "/help" });
    expect(f!.title).toMatch(/2টি/);
    expect(f!.title).not.toMatch(/[০-৯]/);
    const titles = HELP_SECTIONS.flatMap((s) => s.articles)
      .filter((a) => ["sales-quotation", "production-costing"].includes(a.slug))
      .map((a) => a.title);
    expect(f!.evidence!.map((e) => e.label).sort()).toEqual([...titles].sort());
    expect(f!.fix).toMatch(/রিলিজে/);
    // The same list keeps the same finding from run to run.
    const again = await oldHelpPictures.run(ctx);
    expect(again[0]!.key).toBe(f!.key);
  });

  it("says nothing when every picture is up to date, or the build left no list", async () => {
    report({ made: "2026-10-17T01:00:00.000Z", old: [] });
    expect(await oldHelpPictures.run(ctx)).toEqual([]);
    process.env.HELP_PICTURES_REPORT = path.join(tmp, "missing.json");
    expect(await oldHelpPictures.run(ctx)).toEqual([]);
    report({ broken: true });
    expect(await oldHelpPictures.run(ctx)).toEqual([]);
  });

  it("is one of Bug Guard's checks", async () => {
    const { ALL_CHECKS } = await import("@/modules/bug-guard/checks");
    expect(ALL_CHECKS.map((c) => c.key)).toContain("product.help-pictures");
  });
});
