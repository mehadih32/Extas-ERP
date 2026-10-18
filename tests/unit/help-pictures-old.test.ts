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
 * it makes must not wait for them. On its fix branches (claude/issue-…) a
 * picture may be out of date: Bug Guard lists those guides, and every release
 * takes all pictures again. v6.4.1 C2: main is checked too (the "Help pictures"
 * workflow runs the tests on every push to main and takes the old pictures
 * again), except in the Checks the Deploy runs, so an urgent fix still goes
 * live. Every other branch (a part or a Release PR) needs every picture up to
 * date, and every picture needs its numbered marks.
 */

const ROOT = path.resolve(__dirname, "../..");
// Made on first use, so a run that skips these tests leaves nothing behind.
let made = "";
const tmp = () => (made ||= mkdtempSync(path.join(os.tmpdir(), "help-pictures-old-")));
afterAll(() => {
  if (made) rmSync(made, { recursive: true, force: true });
});

describe("Which branch may leave Help pictures out of date (v6.4 L1, v6.4.1 C2)", () => {
  it("only a Claude Code fix branch; main only in the Deploy's own Checks", () => {
    const none = {};
    const deploy = { HELP_PICTURES_MAY_WAIT: "deploy" };
    expect(picturesMayWait("claude/issue-42-20261017-0930", none)).toBe(true);
    expect(picturesMayWait("claude/issue-7", none)).toBe(true);
    // v6.4.1 C2: main is checked too, by the tests and the "Help pictures" workflow.
    expect(picturesMayWait("main", none)).toBe(false);
    expect(picturesMayWait("main", { HELP_PICTURES_MAY_WAIT: "yes" })).toBe(false);
    // The Deploy's Checks: an urgent fix is never kept off the live site by a picture.
    expect(picturesMayWait("main", deploy)).toBe(true);
    expect(picturesMayWait("release/v6.4", deploy)).toBe(false);
    expect(picturesMayWait(null, deploy)).toBe(false);
    expect(picturesMayWait("claude/v64-fx-help", none)).toBe(false);
    expect(picturesMayWait("claude/issues-list", none)).toBe(false);
    expect(picturesMayWait("claude/issue-", none)).toBe(false);
    expect(picturesMayWait("feature/claude/issue-4", none)).toBe(false);
    expect(picturesMayWait("release/v6.4", none)).toBe(false);
    expect(picturesMayWait(null, none)).toBe(false);
  });

  it("is told by the Deploy alone, which the Checks pass on to the tests", () => {
    const read = (f: string) => readFileSync(path.join(ROOT, ".github", "workflows", f), "utf8");
    // The Deploy asks for it ...
    expect(read("deploy.yml")).toMatch(
      /uses: \.\/\.github\/workflows\/checks\.yml\n\s+with:\n\s+pictures-may-wait: true/,
    );
    // ... and the Checks pass it to the tests only when asked (a pull request never is).
    const checks = read("checks.yml");
    expect(checks).toMatch(/pictures-may-wait:\n\s+type: boolean\n\s+default: false/);
    expect(checks).toContain(
      "HELP_PICTURES_MAY_WAIT: ${{ inputs.pictures-may-wait && 'deploy' || '' }}",
    );
  });

  it("runs the pictures workflow on every pull request into main and push to main", () => {
    const yml = readFileSync(path.join(ROOT, ".github/workflows/help-pictures.yml"), "utf8");
    const on = yml.slice(yml.indexOf("\non:"), yml.indexOf("\npermissions:"));
    expect(on).toMatch(/\n {2}pull_request:\n {4}branches: \[main\]/);
    expect(on).toMatch(/\n {2}push:\n {4}branches: \[main\]/);
    expect(on).toContain('- "src/**"');
    // It checks first, without the pictures' own exemption on main, then takes the old ones.
    expect(yml).toMatch(/npx vitest run tests\/unit\/help-guides\.test\.ts/);
    expect(yml).not.toContain("HELP_PICTURES_MAY_WAIT");
    expect(yml).toContain("needs.check.outputs.old != '0'");
    expect(yml).toContain("node scripts/full-check/help-shots-selftest.mjs");
    // A workflow of its own: the Deploy never waits for it.
    const deploy = readFileSync(path.join(ROOT, ".github/workflows/deploy.yml"), "utf8");
    expect(deploy).not.toMatch(/help-pictures/);
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
  const fresh = {
    src: "/help/shots/sales-quotation.webp",
    width: 1,
    height: 1,
    marks: [1],
    labels: { "1": "New quotation" },
    clip: { y: 0, height: 1, target: "marks" },
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

  it("names a picture that marks nothing or does not say which part it shows (v6.4.1 C2)", () => {
    expect(oldPictures(ROOT, only, { [guide.slug]: { ...fresh, marks: [] } }, exists)).toEqual([
      { slug: guide.slug, section: "sales", why: "marks" },
    ]);
    const noClip = { ...fresh, clip: undefined };
    expect(oldPictures(ROOT, only, { [guide.slug]: noClip }, exists)).toEqual([
      { slug: guide.slug, section: "sales", why: "marks" },
    ]);
    // A guide with no picture on purpose is never listed.
    const none = [{ section: { id: "sales" }, article: { ...guide, shot: { none: "why" } } }];
    expect(oldPictures(ROOT, none, {}, exists)).toEqual([]);
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
    const at = path.join(tmp(), `report-${Math.random().toString(36).slice(2)}.json`);
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
    process.env.HELP_PICTURES_REPORT = path.join(tmp(), "missing.json");
    expect(await oldHelpPictures.run(ctx)).toEqual([]);
    report({ broken: true });
    expect(await oldHelpPictures.run(ctx)).toEqual([]);
  });

  it("is one of Bug Guard's checks", async () => {
    const { ALL_CHECKS } = await import("@/modules/bug-guard/checks");
    expect(ALL_CHECKS.map((c) => c.key)).toContain("product.help-pictures");
  });
});
