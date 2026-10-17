import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { checkCodeBundle } from "@/modules/backups/code-bundle";

/*
 * G15: the code inside a backup (a git bundle the server makes at each update)
 * is checked in the drill: the app has no git, so it reads the bundle itself.
 */

const exec = promisify(execFile);

describe("checking the code bundle in a backup", () => {
  let dir: string;
  let commit: string;
  let whole: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "extas-code-bundle-"));
    const repo = path.join(dir, "repo");
    const git = (...args: string[]) => exec("git", ["-C", repo, ...args]);
    await exec("git", ["init", "-q", repo]);
    await git("config", "user.email", "test@example.invalid");
    await git("config", "user.name", "Test");
    for (const n of [1, 2, 3]) {
      await writeFile(path.join(repo, `file${n}.txt`), `version ${n}\n`.repeat(50));
      await git("add", ".");
      await git("commit", "-q", "-m", `change ${n}`);
    }
    commit = (await git("rev-parse", "HEAD")).stdout.trim();
    whole = path.join(dir, "code.bundle");
    await git("bundle", "create", whole, "HEAD");
    await git("bundle", "create", path.join(dir, "part.bundle"), "HEAD~1..HEAD");
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("passes a whole bundle of the backup's version", async () => {
    expect(await checkCodeBundle(whole, commit)).toBeNull();
    expect(await checkCodeBundle(whole, null)).toBeNull();
  });

  it("finds a damaged bundle, one of another version, and one that needs other history", async () => {
    const bytes = await readFile(whole);
    const flipped = Buffer.from(bytes);
    flipped[bytes.length - 40]! ^= 1;
    await writeFile(path.join(dir, "flipped.bundle"), flipped);
    expect(await checkCodeBundle(path.join(dir, "flipped.bundle"), commit)).toBe(
      "the code in the backup is damaged",
    );
    await writeFile(path.join(dir, "short.bundle"), bytes.subarray(0, bytes.length - 30));
    expect(await checkCodeBundle(path.join(dir, "short.bundle"), commit)).toBe(
      "the code in the backup is damaged",
    );
    await writeFile(path.join(dir, "text.bundle"), "# v2 git bundle\nthe code at the commit\n");
    expect(await checkCodeBundle(path.join(dir, "text.bundle"), commit)).toBe(
      "the code in the backup is damaged",
    );
    expect(await checkCodeBundle(whole, "c0ffee".padEnd(40, "0"))).toBe(
      "the code in the backup is not the backup's version",
    );
    expect(await checkCodeBundle(path.join(dir, "part.bundle"), commit)).toBe(
      "the code in the backup is not complete (it needs history from elsewhere)",
    );
  });
});
