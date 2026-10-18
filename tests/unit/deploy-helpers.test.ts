import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { inTerminal } from "../fixtures/terminal";

/*
 * Small pieces of deploy/lib.sh, run for real in bash with stand-in folders
 * (never the server's own paths): what a restore or an update decides.
 */

type Run = { code: number; stdout: string; stderr: string };

/** Runs a few lines of bash after loading deploy/lib.sh. */
function withLib(script: string, options: { env?: Record<string, string>; input?: string } = {}) {
  return new Promise<Run>((resolve) => {
    const child = execFile(
      "bash",
      ["-c", `source "${path.join(process.cwd(), "deploy", "lib.sh")}"\n${script}`],
      { env: { ...process.env, ...options.env }, timeout: 60_000 },
      (error, stdout, stderr) =>
        resolve({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr }),
    );
    child.stdin!.end(options.input ?? "");
  });
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "extas-deploy-helpers-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("counting the problems the check after a restore found (G10)", () => {
  const output = [
    "",
    "==> Opened 151 of 152 screens without an error",
    "==> Problem: Screen /production/bookings answered 500",
    "==> Booking (landscape) printed",
    "==> Invoice: nothing to print yet",
    "==> Problem: Payslip did not answer (timeout)",
    "==> Bot PINs: 3 hidden, every one typed after the bot asked for the PIN",
    "==> The check found 2 problem(s): /production/bookings, Payslip",
  ].join("\n");

  it("counts only the lines marked as a problem, never the notes around them", async () => {
    const done = await withLib("check_problems", { input: output });
    expect(done).toMatchObject({ code: 0, stdout: "2\n" });
    const none = await withLib("check_problems", {
      input: "==> Opened 5 of 5 screens without an error\n==> Bot PINs: not counted (x)\n",
    });
    expect(none.stdout).toBe("0\n");
  });

  it("is what restore.sh counts, and check-update.ts marks every failure that way", () => {
    const restore = readFileSync(path.join("deploy", "restore.sh"), "utf8");
    expect(restore).toMatch(/count="\$\(check_problems <<<"\$check_output"\)"/);
    expect(restore).not.toMatch(/grep -v -e '\^Opened '/);
    // The Backups screen lists the problems themselves, without the mark.
    expect(restore).toMatch(
      /problems="\$\(sed -n 's\/\^==> Problem: \/\/p' <<<"\$check_output"\)"/,
    );
    const check = readFileSync(path.join("scripts", "check-update.ts"), "utf8");
    expect(check).toMatch(/const problem = \(text: string\) => say\(`Problem: \$\{text\}`\)/);
    const pushes = check.match(/failed\.push\([^)]*\);\s*\n\s*(\w+)\(/g) ?? [];
    expect(pushes.length).toBeGreaterThanOrEqual(4);
    for (const push of pushes) expect(push).toMatch(/problem\($/);
    expect(check).toMatch(/problem\(`The check could not run/);
  });
});

describe("the code bundle the server makes for the backups (G15)", () => {
  async function repoWithCommits() {
    const repo = path.join(dir, "install");
    const git = (...args: string[]) =>
      new Promise<string>((resolve, reject) =>
        execFile("git", ["-C", repo, ...args], (error, stdout) =>
          error ? reject(error) : resolve(stdout.trim()),
        ),
      );
    await new Promise((resolve) => execFile("git", ["init", "-q", repo], resolve));
    await git("config", "user.email", "test@example.invalid");
    await git("config", "user.name", "Test");
    await mkdir(path.join(repo, "deploy"));
    await writeFile(path.join(repo, "deploy", "bootstrap.sh"), "echo restore\n");
    await git("add", ".");
    await git("commit", "-q", "-m", "one");
    await git("commit", "-q", "--allow-empty", "-m", "two");
    return { repo, commit: await git("rev-parse", "HEAD") };
  }
  /*
   * On the server record_host_files runs as root and gives its folder and files to root.
   * Only root may do that, so where the tests run as another user (GitHub's machines)
   * install and chown keep the owner as it is (chown still stops on a missing file, as the
   * real one does), and everything else runs for real.
   */
  const asAnotherUser =
    process.getuid?.() === 0
      ? ""
      : `install() { local args=(); while [ $# -gt 0 ]; do case "$1" in -o | -g) shift 2 ;; *) args+=("$1"); shift ;; esac; done; command install "\${args[@]}"; }
chown() { local f; shift; for f in "$@"; do [ -e "$f" ] || { echo "chown: cannot access $f" >&2; return 1; }; done; }`;
  /** record_host_files with stand-in folders; git may be wrapped to spoil the bundle. */
  const record = (repo: string, wrap = "") =>
    withLib(
      `DEPLOY_DIR="${repo}/deploy"; DATA_DIR="${dir}/data"; ENV_FILE="${dir}/env"; APP_UID=$(id -u)
${asAnotherUser}
${wrap}
record_host_files; echo "exit $?"`,
    );

  it("keeps a bundle only when git finds it whole and it holds the running commit", async () => {
    const { repo, commit } = await repoWithCommits();
    const done = await record(repo);
    expect(done.stdout).toContain("exit 0");
    const host = path.join(dir, "data", "backups", ".host");
    expect(readFileSync(path.join(host, "code.commit"), "utf8").trim()).toBe(commit);
    expect(readFileSync(path.join(host, "code.bundle")).subarray(0, 15).toString()).toBe(
      "# v2 git bundle",
    );
  });

  it("keeps no bundle when the one just made is damaged, rather than a broken one", async () => {
    const { repo } = await repoWithCommits();
    // A stand-in git that spoils the bundle it makes.
    const spoil = `git() { command git "$@"; local code=$?; if [ "\${3:-} \${4:-}" = "bundle create" ]; then truncate -s -30 "$5"; fi; return $code; }`;
    const done = await record(repo, spoil);
    expect(done.stdout).toContain("exit 0");
    expect(done.stdout + done.stderr).toMatch(/The code bundle for the backups did not check out/);
    const host = path.join(dir, "data", "backups", ".host");
    expect(existsSync(path.join(host, "code.bundle"))).toBe(false);
    expect(existsSync(path.join(host, "code.bundle.new"))).toBe(false);
    expect(existsSync(path.join(host, "code.commit"))).toBe(false);
  });

  it("keeps the restore command and its tool of the running version, for the Drive folder (G17)", async () => {
    const { repo } = await repoWithCommits();
    await writeFile(path.join(repo, "deploy", "restore-tool.py"), "print('tool')\n");
    await new Promise((resolve) =>
      execFile("git", ["-C", repo, "add", "."], () =>
        execFile("git", ["-C", repo, "commit", "-q", "-m", "tool"], resolve),
      ),
    );
    // A change not committed is not the running version: never copied.
    await writeFile(path.join(repo, "deploy", "bootstrap.sh"), "echo changed\n");
    expect((await record(repo)).stdout).toContain("exit 0");
    const host = path.join(dir, "data", "backups", ".host");
    expect(readFileSync(path.join(host, "restore.sh"), "utf8")).toBe("echo restore\n");
    expect(readFileSync(path.join(host, "restore-tool.py"), "utf8")).toBe("print('tool')\n");
    expect(statSync(path.join(host, "restore.sh")).mode & 0o777).toBe(0o644);
    // Its checksum is the one the guide's command checks.
    const version = JSON.parse(readFileSync(path.join(host, "version.json"), "utf8")) as {
      bootstrapSha256: string;
    };
    expect(version.bootstrapSha256).toBe(
      createHash("sha256").update("echo restore\n").digest("hex"),
    );
  });
});

describe("what a restore leaves for the ERP, and for undoing it (G4, G5, G9)", () => {
  const restore = readFileSync(path.join("deploy", "restore.sh"), "utf8");
  const request = readFileSync(path.join("deploy", "restore-request.sh"), "utf8");
  const lib = readFileSync(path.join("deploy", "lib.sh"), "utf8");

  it("keeps this server's backup settings only for a restore asked for on the screen", () => {
    expect(request).toMatch(/restore\.sh" --yes --check --keep-backup-settings /);
    expect(restore).toMatch(/--keep-backup-settings\) keep_settings=1 ;;/);
    // Read with the app stopped, just before the database is replaced, into a file only root reads.
    expect(restore).toMatch(
      /compose stop app[\s\S]*if \[ "\$keep_settings" = 1 \]; then[\s\S]*umask 077[\s\S]*"\$KEEP_SQL"[\s\S]*restore_database "\$inside\/database\.dump"/,
    );
    // The mark for the ERP is written once the database is in, before the app starts.
    expect(restore).toMatch(
      /restore_database "\$inside\/database\.dump"[\s\S]*write_restored_mark[\s\S]*Starting the app/,
    );
    // Going back to the safety copy takes the mark away again.
    expect(restore).toMatch(/Going back to the safety copy: \$1"\n\s*rm -f "\$restored_mark"/);
  });

  it("writes the mark only the app reads, with the backup's name and time", async () => {
    const folder = path.join(dir, "2026-10-04_020000");
    await mkdir(folder);
    await writeFile(
      path.join(folder, "manifest.json"),
      JSON.stringify({ createdAt: "2026-10-04T20:00:00.000Z" }),
    );
    await writeFile(path.join(dir, "kept.json"), '{"id":"c1","isEnabled":true}\n');
    const mark = path.join(dir, ".restored.json");
    const done = await withLib(
      `APP_UID=$(id -u)
write_restored_mark "${folder}" "${dir}/kept.json" "${mark}"; echo "exit $?"`,
    );
    expect(done.stdout).toContain("exit 0");
    expect(JSON.parse(readFileSync(mark, "utf8"))).toMatchObject({
      name: "2026-10-04_020000",
      backupCreatedAt: "2026-10-04T20:00:00.000Z",
      fromDrive: false,
      keptSettings: { id: "c1", isEnabled: true },
    });
    expect(statSync(mark).mode & 0o777).toBe(0o600);
    expect(existsSync(path.join(dir, "kept.json"))).toBe(false);
    // Without settings to keep (a new server): the name and time only.
    await withLib(`APP_UID=$(id -u)\nwrite_restored_mark "${folder}" "" "${mark}"`);
    expect(JSON.parse(readFileSync(mark, "utf8"))).toMatchObject({ keptSettings: null });
    // Opened from Google Drive (BACKUP_DIR/restores/<name>): the ERP knows it is there.
    const fromDrive = path.join(dir, "restores", "2026-10-05_020000");
    await mkdir(fromDrive, { recursive: true });
    await withLib(`APP_UID=$(id -u)\nwrite_restored_mark "${fromDrive}" "" "${mark}"`);
    expect(JSON.parse(readFileSync(mark, "utf8"))).toMatchObject({
      name: "2026-10-05_020000",
      backupCreatedAt: null,
      fromDrive: true,
    });
  });

  it("keeps the uploaded files from before a restore for 30 days, and says undoing puts back the database only", async () => {
    const data = path.join(dir, "data");
    const old = path.join(data, "uploads.before-restore-2026-09-01_100000");
    const young = path.join(data, "uploads.before-restore-2026-10-15_100000");
    const failed = path.join(data, "uploads.failed-restore-2026-09-01_100000");
    const live = path.join(data, "uploads");
    for (const d of [old, young, failed, live]) await mkdir(d, { recursive: true });
    const longAgo = new Date(Date.now() - 31 * 86_400_000);
    for (const d of [old, failed, live]) await utimes(d, longAgo, longAgo);
    const done = await withLib(`DATA_DIR="${data}"\nprune_old_uploads; echo "exit $?"`);
    expect(done.stdout).toContain("exit 0");
    expect([existsSync(old), existsSync(failed), existsSync(young), existsSync(live)]).toEqual([
      false,
      false,
      true,
      true,
    ]);
    // Counted from the restore (the folder is touched when it is set aside), every day by cron too.
    expect(restore).toMatch(
      /mv "\$DATA_DIR\/uploads" "\$DATA_DIR\/uploads\.before-restore-\$stamp" \|\| return 1\n\s*touch "\$DATA_DIR\/uploads\.before-restore-\$stamp"/,
    );
    expect(restore).toMatch(/load_settings\ntake_update_lock\nprune_old_uploads/);
    expect(lib).toMatch(
      /^23 3 \* \* \* root find \$DATA_DIR .*\\\( -name 'uploads\.before-restore-\*'.*\\\) -mtime \+30 /m,
    );
    expect(restore).toMatch(
      /To undo it, restore the safety copy: sudo \$0 \$safety\. That puts back the database only/,
    );
  });
});

describe("the v6.3 restore command's secrets in shell history (G14)", () => {
  it("takes out only the lines that set the GitHub token or the Google client, printing none of them", async () => {
    const root = path.join(dir, "root_history");
    const user = path.join(dir, "user_history");
    const secret = "GOCSPX-very-secret-value";
    await writeFile(
      root,
      [
        "ls -la",
        `curl -fsSLo bootstrap.sh https://example.invalid && sudo GITHUB_REPOSITORY=x/y GITHUB_TOKEN="$T" GOOGLE_CLIENT_ID='1-abc.apps.googleusercontent.com' GOOGLE_CLIENT_SECRET='${secret}' bash bootstrap.sh`,
        "sudo ./deploy/deploy.sh",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    await writeFile(user, `export GITHUB_TOKEN=ghp_abcdef123456\ncd /opt\n`, { mode: 0o640 });
    const done = await withLib(`forget_secrets_in_history "${root}" "${user}" "${dir}/none"`);
    expect(done.code).toBe(0);
    expect(readFileSync(root, "utf8")).toBe("ls -la\nsudo ./deploy/deploy.sh\n");
    expect(readFileSync(user, "utf8")).toBe("cd /opt\n");
    expect(statSync(root).mode & 0o777).toBe(0o600);
    expect(statSync(user).mode & 0o777).toBe(0o640);
    const shown = done.stdout + done.stderr;
    expect(shown).toContain(
      "2 lines with a GitHub token or the Google client were taken out of shell history",
    );
    for (const hidden of [secret, "ghp_abcdef123456", "1-abc"]) expect(shown).not.toContain(hidden);
    // Nothing to take out: nothing said.
    const again = await withLib(`forget_secrets_in_history "${root}" "${user}"`);
    expect(again.stdout + again.stderr).toBe("");
  });

  it("runs at every update and every restore", () => {
    const deploy = readFileSync(path.join("deploy", "deploy.sh"), "utf8");
    const restore = readFileSync(path.join("deploy", "restore.sh"), "utf8");
    expect(deploy).toMatch(/forget_secrets_in_history \|\| true/);
    expect(restore).toMatch(/forget_secrets_in_history \|\| true/);
    const lib = readFileSync(path.join("deploy", "lib.sh"), "utf8");
    expect(lib).toMatch(/set -- \/root\/\.bash_history \/home\/\*\/\.bash_history/);
  });
});

describe("standby after a restore on a second server (G2)", () => {
  /** Stand-ins for DNS (getent) and the web (curl): where the web address points, what answers there. */
  async function network(points: string, answers = "") {
    const bin = path.join(dir, "bin");
    await mkdir(bin, { recursive: true });
    await writeFile(
      path.join(bin, "getent"),
      `#!/bin/sh\n[ -n "${points}" ] && echo "${points}    STREAM $3"\n[ -n "${points}" ]\n`,
      { mode: 0o755 },
    );
    await writeFile(path.join(bin, "curl"), `#!/bin/sh\nprintf '%s' '${answers}'\n`, {
      mode: 0o755,
    });
    return { PATH: `${bin}:${process.env.PATH}`, PUBLIC_IP: "203.0.113.7" };
  }

  it("goes live only when the web address points here and is typed", async () => {
    const backups = path.join(dir, "backups");
    await mkdir(backups);
    await writeFile(path.join(backups, ".standby"), "3f9a0c1d2e4b5a6978");
    // Still pointing at the old server: stopped before any question, nothing changed.
    const elsewhere = await withLib(`leave_standby "${backups}" erp.example.com`, {
      env: await network("198.51.100.20"),
      input: "erp.example.com\n",
    });
    expect(elsewhere.code).toBe(1);
    expect(elsewhere.stderr).toContain(
      "stopped: erp.example.com does not point to this server yet (it points to 198.51.100.20; this server is 203.0.113.7). Point erp.example.com here first (step F6 in the restore guide)",
    );
    expect(elsewhere.stdout).not.toContain("Type erp.example.com");
    expect(existsSync(path.join(backups, ".standby"))).toBe(true);

    const here = await network("203.0.113.7");
    for (const typed of ["", "demo.example.com"]) {
      const stopped = await withLib(`leave_standby "${backups}" erp.example.com`, {
        env: here,
        input: `${typed}\n`,
      });
      expect(stopped.code).toBe(1);
      expect(stopped.stderr).toContain("stopped: nothing was changed");
      expect(existsSync(path.join(backups, ".standby"))).toBe(true);
    }
    const live = await withLib(`leave_standby "${backups}" erp.example.com`, {
      env: here,
      input: "HTTPS://Erp.Example.com/\n",
    });
    expect(live.code).toBe(0);
    expect(live.stdout).toContain("this ERP is the one in use");
    expect(existsSync(path.join(backups, ".standby"))).toBe(false);
    // Not on standby: nothing to do.
    const again = await withLib(`leave_standby "${backups}" erp.example.com`);
    expect(again.code).toBe(0);
    expect(again.stdout).toContain("This ERP is not on standby");
  });

  it("knows the web address reaches this server through Cloudflare's proxy by the ERP answering there", async () => {
    const backups = path.join(dir, "backups");
    await mkdir(backups);
    const words = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
    await writeFile(path.join(backups, ".standby"), words);
    const id = createHash("sha256").update(words).digest("hex").slice(0, 16);
    // Cloudflare's address in DNS; another ERP (another standby id) answers: stopped.
    const other = await withLib(`leave_standby "${backups}" erp.example.com`, {
      env: await network("104.16.1.1", '{"status":"ok","standby":"0000000000000000"}'),
      input: "erp.example.com\n",
    });
    expect(other.code).toBe(1);
    expect(existsSync(path.join(backups, ".standby"))).toBe(true);
    // This ERP answers there (src/app/api/health/route.ts gives its standby id).
    const proxied = await withLib(`leave_standby "${backups}" erp.example.com`, {
      env: await network("104.16.1.1", `{"status":"ok","database":"connected","standby":"${id}"}`),
      input: "erp.example.com\n",
    });
    expect(proxied.code).toBe(0);
    expect(existsSync(path.join(backups, ".standby"))).toBe(false);
    const health = readFileSync(path.join("src", "app", "api", "health", "route.ts"), "utf8");
    expect(health).toMatch(/standby: standby\.id/);
    const standby = readFileSync(path.join("src", "modules", "backups", "standby.ts"), "utf8");
    expect(standby).toMatch(
      /createHash\("sha256"\)\.update\(words\)\.digest\("hex"\)\.slice\(0, 16\)/,
    );
  });

  it("never takes a key pressed earlier as the answer to go live", async () => {
    const backups = path.join(dir, "backups");
    await mkdir(backups);
    await writeFile(path.join(backups, ".standby"), "words");
    const env = await network("203.0.113.7");
    const run = await inTerminal(
      [
        "bash",
        "-c",
        `source "${path.join(process.cwd(), "deploy", "lib.sh")}"\nleave_standby "${backups}" erp.example.com`,
      ],
      {
        env,
        // An Enter pressed before the question: without it being dropped, it would stop here.
        early: "\r",
        replies: [["Type erp.example.com to go on", "erp.example.com"]],
      },
    );
    expect(run.screen).not.toContain("stopped: nothing was changed");
    expect(run.screen).toContain("this ERP is the one in use");
    expect(run.code).toBe(0);
  });

  it("is left by the restore command until the restore went well and the web address points here", () => {
    const bootstrap = readFileSync(path.join("deploy", "bootstrap.sh"), "utf8");
    const code = bootstrap
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    // The mark (random words) is in place before the restored database first starts.
    expect(code).toMatch(
      /head -c 16 \/dev\/urandom [^\n]*>"\$DATA\/backups\/\.standby"\nchmod 644 "\$DATA\/backups\/\.standby"\nstandby=1[\s\S]*"\$DIR\/deploy\/restore\.sh" --yes/,
    );
    // The web address is moved only after the restore went well; then the mark goes.
    const restored = code.indexOf("restored=1\n");
    const dns = code.indexOf('tool dns --work "$WORK"');
    expect(restored).toBeGreaterThan(code.indexOf('"$DIR/deploy/restore.sh" --yes'));
    expect(dns).toBeGreaterThan(restored);
    expect(code.match(/tool dns /g)).toHaveLength(1);
    expect(code.slice(dns)).toMatch(
      /^tool dns [^\n]*\n[^\n]*\nif \[ -n "\$\(tool fact --work "\$WORK" dnsMoved\)" \]; then\n\s*rm -f "\$DATA\/backups\/\.standby"\n\s*standby=0/,
    );
    // Said at the end, in big words, as the last thing on the screen.
    expect(code).toMatch(
      /warn W10 "this ERP waits on standby: \$APP_DOMAIN does not point to this server yet/,
    );
    const banner = code.lastIndexOf('"THIS ERP IS ON STANDBY"');
    expect(banner).toBeGreaterThan(code.lastIndexOf("Next (part F of the guide)"));
    const goLive = readFileSync(path.join("deploy", "go-live.sh"), "utf8");
    expect(goLive).toMatch(/leave_standby "\$DATA_DIR\/backups" "\$APP_DOMAIN"/);
  });
});

describe("a restore that fails half-way goes back, and says so (restore.sh)", () => {
  /*
   * restore.sh run for real, with deploy/lib.sh's Docker and database parts played by
   * stand-ins: a copy of restore.sh beside a lib.sh that loads the real one and then
   * replaces only those parts. Everything else (the folders, tar, the result file)
   * is real, in a folder of the test's own.
   */
  async function harness() {
    const deploy = path.join(dir, "deploy");
    const data = path.join(dir, "data");
    const log = path.join(dir, "calls.log");
    await mkdir(deploy, { recursive: true });
    await writeFile(
      path.join(deploy, "restore.sh"),
      readFileSync(path.join("deploy", "restore.sh"), "utf8"),
    );
    await writeFile(
      path.join(deploy, "lib.sh"),
      `source "${path.join(process.cwd(), "deploy", "lib.sh")}"
APP_UID=$(id -u)
need_root() { :; }
load_settings() { DATA_DIR="${data}"; POSTGRES_DB=erp; APP_DB_USER=erp; }
take_update_lock() { :; }
forget_secrets_in_history() { :; }
flush_keys() { :; }
prepare_folders() { mkdir -p "$DATA_DIR"/uploads "$DATA_DIR"/backups "$DATA_DIR"/safety-copies; }
compose() {
  echo "compose $*" >>"${log}"
  case "$*" in *psql*) [ -z "\${COUNTS_FAIL:-}" ] || return 1; cat >/dev/null; echo '{"User": 3}' ;; esac
}
wait_healthy() { echo "healthy? $1" >>"${log}"; [ "$1" != app ] || [ -z "\${APP_NEVER_STARTS:-}" ]; }
safety_copy() { mkdir -p "$DATA_DIR/safety-copies/$1" && printf '%s' "$DATA_DIR/safety-copies/$1"; }
restore_database() { echo "restore_database $1" >>"${log}"; }
write_restored_mark() { echo '{}' >"$3"; }
`,
    );
    // The ERP's files as they are now, and a backup to restore.
    await mkdir(path.join(data, "uploads", "c1"), { recursive: true });
    await writeFile(path.join(data, "uploads", "c1", "now.pdf"), "the file there now");
    const backup = path.join(data, "backups", "2026-10-04_020000");
    await mkdir(path.join(backup, "files", "c1"), { recursive: true });
    await writeFile(path.join(backup, "database.dump"), "dump");
    await writeFile(path.join(backup, "files", "c1", "old.pdf"), "the file in the backup");
    await new Promise((resolve) =>
      execFile(
        "tar",
        ["-czf", path.join(backup, "media.tar.gz"), "-C", path.join(backup, "files"), "."],
        resolve,
      ),
    );
    await rm(path.join(backup, "files"), { recursive: true });
    const run = (env: Record<string, string> = {}) =>
      new Promise<Run>((resolve) =>
        execFile(
          "bash",
          [
            path.join(deploy, "restore.sh"),
            "--yes",
            "--result",
            path.join(dir, "result.json"),
            "--counts",
            path.join(dir, "counts.json"),
            backup,
          ],
          { env: { ...process.env, ...env }, timeout: 60_000 },
          (error, stdout, stderr) =>
            resolve({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr }),
        ),
      );
    const result = () =>
      JSON.parse(readFileSync(path.join(dir, "result.json"), "utf8")) as {
        ok: boolean;
        wentBack: boolean;
        message: string;
      };
    return { data, backup, log, run, result };
  }

  it("puts the database and the files back as they were when the files cannot be restored", async () => {
    const h = await harness();
    // A damaged files archive: the database is already replaced when it fails.
    await writeFile(path.join(h.backup, "media.tar.gz"), "not a tar file at all");
    const done = await h.run();
    expect(done.code).not.toBe(0);
    const calls = readFileSync(h.log, "utf8");
    expect(calls).toMatch(
      /restore_database \/backups\/2026-10-04_020000\/database\.dump[\s\S]*restore_database \/safety-copies\/before-restore-[\d_-]+\/database\.dump[\s\S]*compose up -d[\s\S]*healthy\? app/,
    );
    // The files there before are back in place, and nothing half-unpacked is left.
    expect(readFileSync(path.join(h.data, "uploads", "c1", "now.pdf"), "utf8")).toBe(
      "the file there now",
    );
    expect(existsSync(path.join(h.data, "uploads.restoring"))).toBe(false);
    expect(existsSync(path.join(h.data, "backups", ".restored.json"))).toBe(false);
    expect(h.result()).toMatchObject({
      ok: false,
      wentBack: true,
      message:
        "the uploaded files could not be restored, so it was put back as it was before the restore (the safety copy). The lines above say why.",
    });
    // No success line once a step failed.
    expect(done.stdout).not.toContain("Restored from");
    expect(done.stdout).not.toContain("kept for 30 days");
  });

  it("says the records were NOT counted when the count fails, and leaves no count to compare", async () => {
    const h = await harness();
    const done = await h.run({ COUNTS_FAIL: "1" });
    expect(done.code).toBe(0);
    expect(done.stdout).toContain(
      "The records could NOT be counted, so they cannot be checked against the backup; the restore goes on",
    );
    expect(existsSync(path.join(dir, "counts.json"))).toBe(false);
    // Counted: the count is there for the comparison.
    const counted = await h.run();
    expect(counted.code).toBe(0);
    expect(JSON.parse(readFileSync(path.join(dir, "counts.json"), "utf8"))).toEqual({ User: 3 });
    expect(readFileSync(path.join(h.data, "uploads", "c1", "old.pdf"), "utf8")).toBe(
      "the file in the backup",
    );
    expect(h.result()).toMatchObject({ ok: true, wentBack: false });
  });

  it("goes back the same way when the ERP does not start on the restored data", async () => {
    const h = await harness();
    const done = await h.run({ APP_NEVER_STARTS: "1" });
    expect(done.code).not.toBe(0);
    expect(h.result()).toMatchObject({ ok: false, wentBack: true });
    expect(h.result().message).toContain("the ERP did not start on the restored data");
    // The files from before are back; the backup's are kept aside.
    expect(readFileSync(path.join(h.data, "uploads", "c1", "now.pdf"), "utf8")).toBe(
      "the file there now",
    );
  });
});

describe("waiting for a new VM's own updates before installing (setup-server.sh, bootstrap.sh)", () => {
  /** A stand-in for fuser: apt's lock is held for the first `busy` asks. */
  async function stubs(busy: number) {
    const bin = path.join(dir, "bin");
    await mkdir(bin, { recursive: true });
    await writeFile(path.join(dir, "asks"), "");
    await writeFile(
      path.join(bin, "fuser"),
      `#!/bin/sh\necho x >>"${dir}/asks"\n[ "$(wc -l <"${dir}/asks")" -le ${busy} ] || exit 1\nexit 0\n`,
      { mode: 0o755 },
    );
    await writeFile(path.join(bin, "sleep"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const lock = path.join(dir, "lock-frontend");
    await writeFile(lock, "");
    return {
      PATH: `${bin}:${process.env.PATH}`,
      APT_LOCKS: lock,
      APT_WAIT_SECONDS: "60",
    };
  }

  it("waits while the automatic updates hold apt's lock, then goes on", async () => {
    // Busy for 3 checks (one lock file: fuser is asked once a check).
    const env = await stubs(3);
    const lib = await withLib(`if wait_for_apt; then echo "exit 0"; else echo "exit 1"; fi`, {
      env,
    });
    expect(lib.stdout).toContain("The server is installing its own updates first");
    expect(lib.stdout).toContain("exit 0");
    expect(readFileSync(path.join(dir, "asks"), "utf8").split("\n").filter(Boolean)).toHaveLength(
      4,
    );
    // The restore command does the same before it installs its tools.
    await writeFile(path.join(dir, "asks"), "");
    const boot = await new Promise<Run>((resolve) =>
      execFile(
        "bash",
        [path.join("deploy", "bootstrap.sh"), "--wait-apt"],
        { env: { ...process.env, ...env } },
        (error, stdout, stderr) =>
          resolve({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr }),
      ),
    );
    expect(boot.stdout).toContain("The server is installing its own updates first");
    expect(boot.stdout).toContain("APT FREE");
  });

  it("gives up after its time limit instead of waiting for ever", async () => {
    const env = await stubs(1000);
    const lib = await withLib(`if wait_for_apt; then echo "exit 0"; else echo "exit 1"; fi`, {
      env: { ...env, APT_WAIT_SECONDS: "10" },
    });
    expect(lib.stdout).toContain("exit 1");
  });

  it("is used before every apt command of setup-server.sh, and a run cut off is finished first", () => {
    const setup = readFileSync(path.join("deploy", "setup-server.sh"), "utf8");
    expect(setup).toMatch(/wait_for_apt \|\|\n\s*die /);
    expect(setup).toMatch(/dpkg --configure -a/);
    expect(setup.indexOf("wait_for_apt ||")).toBeLessThan(setup.indexOf("apt_get update"));
    // Every apt command waits for the lock too.
    expect(setup).not.toMatch(/^\s*apt-get /m);
    const bootstrap = readFileSync(path.join("deploy", "bootstrap.sh"), "utf8");
    expect(bootstrap.indexOf("wait_for_apt ||")).toBeLessThan(bootstrap.indexOf("apt_get update"));
  });
});
