import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

/*
 * Small pieces of deploy/lib.sh, run for real in bash with stand-in folders
 * (never the server's own paths): what a restore or an update decides.
 */

type Run = { code: number; stdout: string; stderr: string };

/** Runs a few lines of bash after loading deploy/lib.sh. */
function withLib(script: string, options: { env?: NodeJS.ProcessEnv; input?: string } = {}) {
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
  /** record_host_files with stand-in folders; git may be wrapped to spoil the bundle. */
  const record = (repo: string, wrap = "") =>
    withLib(
      `DEPLOY_DIR="${repo}/deploy"; DATA_DIR="${dir}/data"; ENV_FILE="${dir}/env"; APP_UID=$(id -u)
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
    expect(restore).toMatch(/going back to the safety copy"[\s\S]*rm -f "\$restored_mark"/);
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
      /mv "\$DATA_DIR\/uploads" "\$DATA_DIR\/uploads\.before-restore-\$stamp"\n\s*touch "\$DATA_DIR\/uploads\.before-restore-\$stamp"/,
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
