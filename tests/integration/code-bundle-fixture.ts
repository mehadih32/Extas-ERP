import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** A real git bundle of a tiny repository, as deploy.sh makes of the ERP's code (G15). */
export async function makeCodeBundle(): Promise<{ commit: string; bundle: Buffer }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "extas-code-"));
  try {
    const repo = path.join(dir, "repo");
    const git = (...args: string[]) => exec("git", ["-C", repo, ...args]);
    await exec("git", ["init", "-q", repo]);
    await git("config", "user.email", "test@example.invalid");
    await git("config", "user.name", "Test");
    await writeFile(path.join(repo, "README.md"), "Extas ERP\n".repeat(20));
    await git("add", ".");
    await git("commit", "-q", "-m", "the code at the commit");
    await git("bundle", "create", path.join(dir, "code.bundle"), "HEAD");
    return {
      commit: (await git("rev-parse", "HEAD")).stdout.trim(),
      bundle: await readFile(path.join(dir, "code.bundle")),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
