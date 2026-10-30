import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

/*
 * The one restore command (deploy/bootstrap.sh), owner's item 5 of v6.4.2:
 *   - nothing opened stays on a VM: what a restore cut off half-way left in its
 *     work folder (the opened database, the settings file, server.json, the
 *     Google sign-in) is deleted at every start and, by a boot unit the command
 *     installs, when the server starts; only a download that is still locked stays;
 *   - restore.sh and setup-server.sh run from the command's own version, not the
 *     backup's, on the ERP in /opt/extras-erp (lib.sh's EXTRAS_DEPLOY_DIR);
 *   - a restore over an ERP in use that does not finish puts its own code back.
 * Run here in bash on made-up folders, as any user, with a local stand-in for
 * GitHub (never the server's own paths, never the internet).
 */

const exec = promisify(execFile);
const BOOTSTRAP = path.join(process.cwd(), "deploy", "bootstrap.sh");
const SCRIPT = readFileSync(BOOTSTRAP, "utf8");
const RESTORE = readFileSync(path.join(process.cwd(), "deploy", "restore.sh"), "utf8");

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "extas-steps-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function put(file: string, text = "") {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), text);
}

const git = (cwd: string, ...args: string[]) =>
  exec("git", ["-c", "user.email=t@example.com", "-c", "user.name=Test", ...args], { cwd });

/** What a restore cut off half-way leaves in its work folder ($format: the backup's manifest format). */
async function cutOff(format: number) {
  await put("work/download/manifest.json", JSON.stringify({ format, files: [] }));
  await put("work/download/database.dump.locked", "locked");
  for (const file of ["google.json", "server.json", "settings.env", "state.json", "code.bundle"]) {
    await put(`work/${file}`, "plain");
  }
  await put("work/restore/database.dump", "plain");
  await put("work/opened/media.tar.gz", "plain");
  await put("data/backups/restores/2026-10-18_020000/database.dump", "plain");
  await put("work/opened-copy", path.join(root, "data/backups/restores/2026-10-18_020000"));
}

describe("nothing opened stays on the VM (v6.4.2)", () => {
  it("keeps only the download, while still locked, at every start of the command", async () => {
    await cutOff(3);
    await exec("bash", [BOOTSTRAP, "--forget-opened", path.join(root, "work")]);
    expect(await readdir(path.join(root, "work"))).toEqual(["download"]);
    expect((await readdir(path.join(root, "work/download"))).sort()).toEqual([
      "database.dump.locked",
      "manifest.json",
    ]);
    expect(await readdir(path.join(root, "data/backups/restores"))).toEqual([]);
  });

  it("does not keep a download that is not locked (a backup from before v6.3)", async () => {
    await cutOff(1);
    await exec("bash", [BOOTSTRAP, "--forget-opened", path.join(root, "work")]);
    expect(await readdir(path.join(root, "work"))).toEqual([]);
    // A download cut off before its manifest came: nothing to tell it is locked, so it goes.
    await put("work/download/.backup", "drive-folder-id");
    await exec("bash", [BOOTSTRAP, "--forget-opened", path.join(root, "work")]);
    expect(await readdir(path.join(root, "work"))).toEqual([]);
  });

  it("does the same when the server starts, by a boot unit, even if the command never runs again", async () => {
    await cutOff(3);
    const out = path.join(root, "unit");
    await mkdir(out);
    await exec("bash", [BOOTSTRAP, "--boot-clean-files", out, path.join(root, "work")]);
    const unit = await readFile(path.join(out, "extras-erp-restore-clean.service"), "utf8");
    expect(unit).toContain("ExecStart=/usr/local/sbin/extras-erp-restore-clean\n");
    expect(unit).toContain("WantedBy=multi-user.target\n");
    expect(unit).toContain("Before=docker.service\n");
    const script = path.join(out, "extras-erp-restore-clean");
    const text = await readFile(script, "utf8");
    expect(text).toMatch(/^#!\/usr\/bin\/env bash\n/);
    expect(text).toContain("set -euo pipefail\n");
    // Never while a restore runs (it holds the restore's lock); here a lock of the test's own.
    expect(text).toContain("exec 8>/run/extas-erp-restore.lock\nflock -n 8 || exit 0\n");
    const lock = path.join(root, "restore.lock");
    await writeFile(script, text.replace("/run/extas-erp-restore.lock", lock));
    await chmod(script, 0o700);
    await exec("bash", [script]);
    expect(await readdir(path.join(root, "work"))).toEqual(["download"]);
    expect(await readdir(path.join(root, "data/backups/restores"))).toEqual([]);
    // Nothing there (the restore ended well): nothing to do, no error.
    await rm(path.join(root, "work"), { recursive: true });
    await exec("bash", [script]);
  });

  it("installs the boot unit before anything is downloaded, and never keeps the Google sign-in", () => {
    const code = SCRIPT.slice(SCRIPT.indexOf('step "Checking this server"'));
    expect(code.indexOf("install_boot_clean")).toBeGreaterThan(-1);
    expect(code.indexOf("install_boot_clean")).toBeLessThan(code.indexOf("tool fetch"));
    expect(code.indexOf("forget_opened")).toBeLessThan(code.indexOf("tool fetch"));
    expect(SCRIPT).not.toMatch(/! -name google\.json/);
    expect(SCRIPT).toContain("the next try asks for a new Google code");
  });
});

describe("the restore steps of the command's own version (v6.4.2)", () => {
  /** A stand-in for github.com with the repository at two versions; returns both. */
  async function github() {
    const source = path.join(root, "source");
    await mkdir(path.join(source, "deploy"), { recursive: true });
    await git(root, "init", "-q", source);
    for (const file of ["lib.sh", "restore.sh", "self-update.sh", "setup-server.sh"]) {
      await writeFile(
        path.join(source, "deploy", file),
        readFileSync(path.join(process.cwd(), "deploy", file)),
      );
    }
    await git(source, "add", ".");
    await git(source, "commit", "-qm", "one");
    const first = (await git(source, "rev-parse", "HEAD")).stdout.trim();
    await git(
      source,
      "clone",
      "-q",
      "--bare",
      source,
      path.join(root, "gh/mehadih32/Extas-ERP.git"),
    );
    await writeFile(path.join(source, "deploy", "setup-server.sh"), "# the newest\n");
    await git(source, "commit", "-qam", "two");
    await git(source, "push", "-q", path.join(root, "gh/mehadih32/Extas-ERP.git"), "HEAD:main");
    return { first, source };
  }

  async function ownSteps(dir: string, commit?: string, base = `file://${root}/gh`) {
    const work = path.join(root, "work");
    await mkdir(work, { recursive: true });
    const { stdout } = await exec(
      "bash",
      [BOOTSTRAP, "--own-steps", dir, work, ...(commit ? [commit] : [])],
      { env: { ...process.env, EXTAS_GIT_BASE: base } },
    );
    return stdout.trim();
  }

  it("takes restore.sh, setup-server.sh and lib.sh at the command's version from GitHub", async () => {
    const { first } = await github();
    await mkdir(path.join(root, "erp"));
    expect(await ownSteps(path.join(root, "erp"), first)).toBe(
      `STEPS ${path.join(root, "work/steps/deploy")}`,
    );
    const steps = path.join(root, "work/steps/deploy");
    expect((await readdir(steps)).sort()).toEqual([
      "lib.sh",
      "restore.sh",
      "self-update.sh",
      "setup-server.sh",
    ]);
    // That version exactly, not the newest.
    expect(await readFile(path.join(steps, "setup-server.sh"), "utf8")).toBe(
      readFileSync(path.join(process.cwd(), "deploy", "setup-server.sh"), "utf8"),
    );
    // No version given: main.
    await ownSteps(path.join(root, "erp"));
    expect(await readFile(path.join(steps, "setup-server.sh"), "utf8")).toBe("# the newest\n");
  });

  it("takes them from the backup's code when it has the command's version, with no GitHub", async () => {
    const { first, source } = await github();
    expect(await ownSteps(source, first, `file://${root}/nowhere`)).toBe(
      `STEPS ${path.join(root, "work/steps/deploy")}`,
    );
    expect(await readFile(path.join(root, "work/steps/deploy/setup-server.sh"), "utf8")).not.toBe(
      "# the newest\n",
    );
  });

  it("says so when neither has them, and never takes a version that cannot run from another folder", async () => {
    const { first, source } = await github();
    await mkdir(path.join(root, "erp"));
    expect(await ownSteps(path.join(root, "erp"), first, `file://${root}/nowhere`)).toBe(
      "NO STEPS",
    );
    // A version from before v6.4.2: its lib.sh would work on its own folder only.
    await writeFile(path.join(source, "deploy", "lib.sh"), "DEPLOY_DIR=here\n");
    await git(source, "commit", "-qam", "old");
    const old = (await git(source, "rev-parse", "HEAD")).stdout.trim();
    expect(await ownSteps(source, old)).toBe("NO STEPS");
    // The command then uses the backup's own, with a note the guide explains.
    expect(SCRIPT).toContain('STEPS="$DIR/deploy"\n  warn W14 ');
  });

  it("runs them on the ERP in its own folder: lib.sh's EXTRAS_DEPLOY_DIR", async () => {
    const steps = path.join(root, "steps");
    await mkdir(steps);
    await writeFile(
      path.join(steps, "lib.sh"),
      readFileSync(path.join(process.cwd(), "deploy", "lib.sh")),
    );
    const show = 'source "$1/lib.sh"; echo "$DEPLOY_DIR|$ENV_FILE"';
    const erp = path.join(root, "opt/extras-erp/deploy");
    const own = await exec("bash", ["-c", show, "x", steps]);
    expect(own.stdout.trim()).toBe(`${steps}|${steps}/.env`);
    const there = await exec("bash", ["-c", show, "x", steps], {
      env: { ...process.env, EXTRAS_DEPLOY_DIR: erp },
    });
    expect(there.stdout.trim()).toBe(`${erp}|${erp}/.env`);
    // What the command runs, and how.
    expect(SCRIPT).toContain(
      'EXTAS_RESTORE=1 EXTRAS_DEPLOY_DIR="$DIR/deploy" "$STEPS/setup-server.sh" || fail R17',
    );
    expect(SCRIPT).toContain('EXTRAS_DEPLOY_DIR="$DIR/deploy" "$STEPS/restore.sh" --yes --check');
    expect(SCRIPT).not.toMatch(/"\$DIR\/deploy\/(restore|setup-server)\.sh"/);
    // restore.sh's messages name the ERP's own restore.sh, never the copy it ran from.
    expect(RESTORE).not.toMatch(/sudo \$0\b/);
  });
});

describe("a restore over an ERP in use that does not finish (v6.4.2)", () => {
  /** The ERP's program folder at its own version, then the backup's code checked out. */
  async function erp() {
    const dir = path.join(root, "opt/extras-erp");
    await mkdir(path.join(dir, "deploy"), { recursive: true });
    await git(root, "init", "-q", "-b", "main", dir);
    await writeFile(
      path.join(dir, "deploy", "deploy.sh"),
      '#!/bin/sh\necho "INSTALLED $(cat "$(dirname "$0")/version")"\n',
    );
    await chmod(path.join(dir, "deploy", "deploy.sh"), 0o755);
    await writeFile(path.join(dir, "deploy", "version"), "own\n");
    await git(dir, "add", ".");
    await git(dir, "commit", "-qm", "own");
    const own = (await git(dir, "rev-parse", "HEAD")).stdout.trim();
    await writeFile(path.join(dir, "deploy", "version"), "backup\n");
    await git(dir, "commit", "-qam", "backup");
    return { dir, own };
  }
  const back = (dir: string, own: string, deployed: 0 | 1) =>
    exec("bash", [BOOTSTRAP, "--own-code-back", dir, own, String(deployed)]);

  it("puts its own code back, and installs it again when the backup's was installed", async () => {
    const { dir, own } = await erp();
    const run = await back(dir, own, 1);
    expect((await git(dir, "rev-parse", "HEAD")).stdout.trim()).toBe(own);
    expect((await git(dir, "rev-parse", "--abbrev-ref", "HEAD")).stdout.trim()).toBe("main");
    expect(run.stdout).toContain("INSTALLED own");
    expect(run.stdout).toContain("The ERP that was in use here runs on its own code again.");
  });

  it("only puts the code back when the backup's was not installed yet, and does nothing when it never moved", async () => {
    const { dir, own } = await erp();
    const run = await back(dir, own, 0);
    expect((await git(dir, "rev-parse", "HEAD")).stdout.trim()).toBe(own);
    expect(run.stdout).not.toContain("INSTALLED");
    const again = await back(dir, own, 1);
    expect(again.stdout).toBe("");
  });

  it("does it whenever the command stops before the backup is in, never after", () => {
    const cleanup = SCRIPT.slice(
      SCRIPT.indexOf("cleanup() {"),
      SCRIPT.indexOf("\nforget_opened\n"),
    );
    expect(cleanup).toContain(
      '[ "$code" != 0 ] && [ "$restored" = 0 ] && [ "${replacing:-0}" = 1 ] && [ "$code_moved" = 1 ]',
    );
    // Its own version is noted before the backup's code is put in place, and the
    // install is marked before deploy.sh runs.
    const code = SCRIPT.slice(SCRIPT.indexOf('step "Putting the ERP\'s code in place"'));
    expect(code.indexOf("own_head=")).toBeLessThan(code.indexOf("code_moved=1"));
    expect(code.indexOf("deployed=1")).toBeLessThan(
      code.indexOf('"$DIR/deploy/deploy.sh" || fail R18'),
    );
    expect(code.indexOf("restored=1")).toBeGreaterThan(code.indexOf("$STEPS/restore.sh"));
  });

  it("marks a new server's restore until the command finished or the ERP is live there, so a second run goes on (v6.4.2 review)", () => {
    const code = SCRIPT.slice(SCRIPT.indexOf('step "Writing this server\'s settings"'));
    const mark = code.indexOf(': >"$DATA/backups/$UNFINISHED"');
    expect(mark).toBeGreaterThan(-1);
    expect(code.slice(mark - 120, mark)).toContain('if [ "${replacing:-0}" = 0 ]; then');
    expect(mark).toBeLessThan(code.indexOf('"$DIR/deploy/deploy.sh"'));
    // Not when the backup is in: Cloudflare, HTTPS or the checks may still stop it.
    const unmarks = [...code.matchAll(/rm -f "\$DATA\/backups\/\$UNFINISHED"/g)].map(
      (m) => m.index!,
    );
    expect(unmarks).toHaveLength(2);
    // Once the web address points here (the ERP may be in use from then on) ...
    const live = code.indexOf('if [ -n "$moved" ]; then');
    expect(unmarks[0]).toBeGreaterThan(live);
    expect(unmarks[0]).toBeLessThan(code.indexOf('step "Starting the demo site"'));
    // ... or when the command has done every step (its last lines).
    expect(unmarks[1]).toBeGreaterThan(code.indexOf('note "The full log of this restore'));
    expect(code.slice(unmarks[1])).toMatch(
      /^rm -f "\$DATA\/backups\/\$UNFINISHED"\n\[ "\$compare" = 0 \] \|\| exit 4\n$/,
    );
  });
});
