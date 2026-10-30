import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

/*
 * The owner's decision (2026-10-30): the server installs each merge into main by
 * itself, with no key or secret on GitHub and nothing typed on the server.
 * deploy/self-update.sh runs here on a made-up program folder, a local stand-in
 * for GitHub's repository (git) and for its checks (curl), and a stand-in
 * auto-deploy.sh that only writes down the commit it was given.
 */

const exec = promisify(execFile);
const SCRIPT = path.join(process.cwd(), "deploy", "self-update.sh");

describe("the server installs each merge by itself (self-update.sh)", () => {
  let root: string;
  let dir: string;
  let data: string;
  let installed: string;
  let newest: string;

  const git = (cwd: string, ...args: string[]) =>
    exec("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd });

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "extras-self-update-"));
    dir = path.join(root, "opt");
    data = path.join(root, "data");
    installed = path.join(root, "installed");
    const remote = path.join(root, "remote", "acme", "erp.git");
    await mkdir(path.join(dir, "deploy"), { recursive: true });
    await mkdir(path.join(data, "backups"), { recursive: true });
    await mkdir(path.join(root, "bin"));
    await mkdir(path.join(root, "run"));
    await writeFile(path.join(dir, "deploy", ".env"), `DATA_DIR=${data}\n`);
    await writeFile(
      path.join(dir, "deploy", "auto-deploy.sh"),
      `#!/bin/sh\nread -r c\necho "$c" >>${installed}\n`,
    );
    await chmod(path.join(dir, "deploy", "auto-deploy.sh"), 0o755);
    await writeFile(path.join(dir, ".gitignore"), "deploy/\n");
    await git(dir, "init", "-q", "-b", "main");
    await git(dir, "add", ".gitignore");
    await git(dir, "commit", "-q", "-m", "one");
    await git(dir, "remote", "add", "origin", "https://github.com/acme/erp.git");
    await exec("git", ["clone", "-q", "--bare", dir, remote]);
    // A newer commit on GitHub's main.
    const work = path.join(root, "work");
    await exec("git", ["clone", "-q", remote, work]);
    await git(work, "commit", "-q", "--allow-empty", "-m", "two");
    await git(work, "push", "-q", "origin", "main");
    newest = (await git(work, "rev-parse", "HEAD")).stdout.trim();
    await checks("success");
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** GitHub's checks on the newest commit: a conclusion, "pending" or none. */
  async function checks(conclusion: string | null) {
    const runs =
      conclusion === null
        ? []
        : [
            {
              id: 1,
              name: "Checks / Tests and build",
              status: conclusion === "pending" ? "in_progress" : "completed",
              conclusion: conclusion === "pending" ? null : conclusion,
            },
          ];
    await writeFile(path.join(root, "checks.json"), JSON.stringify({ check_runs: runs }));
    await writeFile(
      path.join(root, "bin", "curl"),
      `#!/bin/sh\ncase "$*" in *"/repos/acme/erp/commits/${newest}/check-runs"*) cat ${root}/checks.json ;; *) exit 22 ;; esac\n`,
    );
    await chmod(path.join(root, "bin", "curl"), 0o755);
  }

  async function run() {
    await exec("bash", [SCRIPT, dir], {
      env: {
        ...process.env,
        PATH: `${path.join(root, "bin")}:${process.env.PATH}`,
        EXTRAS_GIT_BASE: `file://${path.join(root, "remote")}`,
        EXTRAS_RUN_DIR: path.join(root, "run"),
      },
    });
    return readFile(installed, "utf8").then(
      (text) => text.trim().split("\n"),
      () => [] as string[],
    );
  }
  const log = () => readFile(path.join(data, "deploy-logs", "self-update.log"), "utf8");

  it("installs the newest commit on main once its checks passed, exactly that one, once", async () => {
    expect(await run()).toEqual([newest]);
    expect(await log()).toContain("installing it");
    // Installed: the next run (the code is that commit now) does nothing.
    await git(dir, "fetch", "-q", path.join(root, "remote", "acme", "erp.git"), "main");
    await git(dir, "merge", "-q", "--ff-only", "FETCH_HEAD");
    expect(await run()).toEqual([newest]);
  });

  it("waits while the checks run, and never installs a commit whose checks failed", async () => {
    await checks("pending");
    expect(await run()).toEqual([]);
    await checks(null);
    expect(await run()).toEqual([]);
    await checks("failure");
    expect(await run()).toEqual([]);
    expect(await log()).toContain("checks failed");
    expect(await run()).toEqual([]);
    // The checks run again and pass (review 2026-10-30): it is installed after all.
    await checks("success");
    expect(await run()).toEqual([newest]);
  });

  it("waits, using up no try, while an update or a screen restore holds the update lock", async () => {
    const lock = path.join(root, "run", "extras-erp-update.lock");
    await writeFile(lock, "");
    const holder = exec("flock", [lock, "sleep", "3"]);
    await new Promise((r) => setTimeout(r, 300));
    expect(await run()).toEqual([]);
    await expect(
      readFile(path.join(data, "deploy-logs", "self-update.state"), "utf8"),
    ).rejects.toThrow();
    await holder;
    expect(await run()).toEqual([newest]);
  });

  it("finds swapon and the other system tools under cron's short PATH (review 2026-10-30)", async () => {
    await writeFile(
      path.join(dir, "deploy", "auto-deploy.sh"),
      `#!/bin/sh\nread -r c\necho "$PATH" >>${installed}\n`,
    );
    await exec("bash", [SCRIPT, dir], {
      env: {
        NODE_ENV: "test",
        PATH: `${path.join(root, "bin")}:/usr/bin:/bin`,
        EXTRAS_GIT_BASE: `file://${path.join(root, "remote")}`,
        EXTRAS_RUN_DIR: path.join(root, "run"),
      },
    });
    expect((await readFile(installed, "utf8")).split(":")).toEqual(
      expect.arrayContaining(["/usr/sbin", "/sbin"]),
    );
    expect(readFileSync(path.join("deploy", "lib.sh"), "utf8")).toMatch(
      /cron\.d\/extras-erp-self-update <<EOF\n#[^\n]*\nPATH=\/usr\/local\/sbin:\/usr\/local\/bin:\/usr\/sbin:\/usr\/bin:\/sbin:\/bin\n/,
    );
  });

  it("does nothing on standby, on a drill copy, during a restore, or off main", async () => {
    for (const mark of [".standby", ".drill", ".restore-unfinished"]) {
      await writeFile(path.join(data, "backups", mark), "");
      expect(await run(), mark).toEqual([]);
      await rm(path.join(data, "backups", mark));
    }
    await writeFile(path.join(dir, "deploy", ".env"), `DATA_DIR=${data}\nAUTO_UPDATE=off\n`);
    expect(await run()).toEqual([]);
    await writeFile(path.join(dir, "deploy", ".env"), `DATA_DIR=${data}\n`);
    // Put back to an earlier version by hand: not on main.
    await git(dir, "checkout", "-q", "--detach");
    expect(await run()).toEqual([]);
  });

  it("tries a failed install again after an hour, three times at most", async () => {
    await mkdir(path.join(data, "deploy-logs"), { recursive: true });
    const state = path.join(data, "deploy-logs", "self-update.state");
    const now = Math.floor(Date.now() / 1000);
    await writeFile(state, `${newest} 1 ${now - 60}\n`);
    expect(await run()).toEqual([]);
    await writeFile(state, `${newest} 1 ${now - 3700}\n`);
    expect(await run()).toEqual([newest]);
    await writeFile(state, `${newest} 3 ${now - 99999}\n`);
    expect(await run()).toEqual([newest]);
  });
});
