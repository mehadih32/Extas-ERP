import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import type { HelpPicture } from "@/modules/help/pictures";

import { guideHash, screenFingerprint, shellFiles, shotRoute } from "./screens";

/*
 * Which Help pictures are out of date (v6.4 L1). A guide's picture is out of
 * date when it has none, when it shows another page, when its file is gone,
 * when the screen's code changed since it was taken, or when the steps it marks
 * changed. tests/unit/help-guides.test.ts needs every picture up to date,
 * except on the branches below; the Docker build lists the out-of-date ones
 * for Bug Guard (scripts/help/list-old-pictures.ts).
 */

export type OldPicture = {
  slug: string;
  section: string;
  /** none: no picture; page: of another page; file: the file is gone; screen or steps changed. */
  why: "none" | "page" | "file" | "screen" | "steps";
};

type Guide = Parameters<typeof guideHash>[0] & { slug: string; steps: unknown[] };

/** The guides whose picture is out of date, in the order given. */
export function oldPictures(
  root: string,
  guides: ReadonlyArray<{ section: { id: string }; article: Guide }>,
  pictures: Readonly<Record<string, HelpPicture>>,
  exists = (src: string) => existsSync(path.join(root, "public", src)),
): OldPicture[] {
  const shell = shellFiles(root);
  return guides.flatMap(({ section, article }): OldPicture[] => {
    const old = (why: OldPicture["why"]) => [{ slug: article.slug, section: section.id, why }];
    const picture = pictures[article.slug];
    const route = shotRoute(article);
    if (!picture) return old("none");
    if (picture.route !== route) return old("page");
    if (!exists(picture.src)) return old("file");
    if (picture.screen !== screenFingerprint(root, route, shell)) return old("screen");
    const marks = picture.marks.some((n) => n < 1 || n > article.steps.length);
    if (picture.guide !== guideHash(article) || marks) return old("steps");
    return [];
  });
}

/** Claude Code's fix branches on GitHub (claude.yml): "claude/issue-<number>-…". */
const CLAUDE_FIX = /^claude\/issue-\d+(-|$)/;

/**
 * Whether pictures may be out of date on this branch: a Claude Code fix (it
 * cannot take pictures), and main, where such a fix lands and the Deploy runs
 * the tests again. A part or Release PR's own branch, or no branch known, needs
 * every picture up to date.
 */
export function picturesMayWait(branch: string | null): boolean {
  return branch !== null && (branch === "main" || CLAUDE_FIX.test(branch));
}

const gitBranch = () =>
  execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

/**
 * The branch the tests run on: a pull request's own branch on GitHub, else the
 * branch GitHub's run is for, else the one checked out. Null when unknown.
 */
export function branchUnderTest(
  env: Record<string, string | undefined> = process.env,
  git: () => string = gitBranch,
): string | null {
  if (env.GITHUB_HEAD_REF) return env.GITHUB_HEAD_REF;
  if (env.GITHUB_ACTIONS === "true" && env.GITHUB_REF_NAME) return env.GITHUB_REF_NAME;
  try {
    const branch = git().trim();
    return branch && branch !== "HEAD" ? branch : null;
  } catch {
    return null;
  }
}
