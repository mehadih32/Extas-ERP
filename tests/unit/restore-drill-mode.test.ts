import { execFile } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

/*
 * The practice drill (v6.4.1, owner's item 12): `sudo bash restore.sh <commit>
 * --drill` restores onto a small test server under a test web address of its
 * own, so the real address's DNS is never touched, and marks the copy as a
 * drill (BACKUP_DIR/.drill) before the ERP first starts, so it sends nothing
 * (src/modules/backups/standby.ts). At the end the drill's time and result go
 * into the mark, for the Backups screens. Run here in bash on made-up folders,
 * as any user (never the server's own paths).
 */

const BOOTSTRAP = path.join(process.cwd(), "deploy", "bootstrap.sh");
const SCRIPT = readFileSync(BOOTSTRAP, "utf8");

type Run = { code: number; stdout: string; stderr: string };

function bootstrap(args: string[], env: Record<string, string> = {}) {
  return new Promise<Run>((resolve) => {
    execFile(
      "bash",
      [BOOTSTRAP, ...args],
      { env: { ...process.env, ...env }, timeout: 60_000 },
      (error, stdout, stderr) =>
        resolve({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr }),
    );
  });
}

let dir: string;
let envFile: string;
let data: string;
const SETTINGS = [
  "APP_DOMAIN=erp.example.com",
  "ACME_EMAIL=owner@example.com",
  "DEMO_SITE=on",
  "ENCRYPTION_KEY=kept-as-it-is",
  "",
].join("\n");

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "extas-drill-"));
  envFile = path.join(dir, ".env");
  data = path.join(dir, "data");
  await writeFile(envFile, SETTINGS);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** The drill's settings with `typed` as the answer to the test address question. */
async function drillSettings(typed: string) {
  const answers = path.join(dir, "answers");
  await writeFile(answers, `drill_domain=${typed}\n`, { mode: 0o600 });
  return bootstrap(["--drill-settings", envFile, data], { RESTORE_ANSWERS: answers });
}

describe("a restore drill's own web address", () => {
  it("never takes the real ERP's or its demo site's address, nor a made-up one", async () => {
    for (const typed of [
      "erp.example.com",
      "https://ERP.example.com/",
      "demo.example.com",
      "not an address",
      "",
    ]) {
      const run = await drillSettings(typed);
      expect(run.code, typed).toBe(2);
      expect(run.stderr, typed).toContain("Error R30:");
      // Nothing changed: the settings and no mark.
      expect(await readFile(envFile, "utf8")).toBe(SETTINGS);
      await expect(readFile(path.join(data, "backups", ".drill"), "utf8")).rejects.toThrow();
    }
  });

  it("puts the test address in the settings, turns the demo site off and marks the copy", async () => {
    const run = await drillSettings("Drill.Example.com");
    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout).toContain("DRILL drill.example.com");
    expect(run.stdout).toContain("erp.example.com is not touched");
    const settings = await readFile(envFile, "utf8");
    // The last line wins in deploy/lib.sh and docker compose; only one of each is left.
    expect(settings.match(/^APP_DOMAIN=.*$/gm)).toEqual(["APP_DOMAIN=drill.example.com"]);
    expect(settings.match(/^DEMO_SITE=.*$/gm)).toEqual(["DEMO_SITE=off"]);
    expect(settings).toContain("ENCRYPTION_KEY=kept-as-it-is");
    const mark = path.join(data, "backups", ".drill");
    const drill = JSON.parse(await readFile(mark, "utf8")) as Record<string, string>;
    expect(drill.address).toBe("drill.example.com");
    expect(Number.isNaN(Date.parse(drill.startedAt!))).toBe(false);
    // The app (another user in its container) reads it.
    expect(statSync(mark).mode & 0o777).toBe(0o644);
  });
});

describe("a restore drill's result", () => {
  async function result(compare: unknown, https: string, screens: string) {
    const mark = path.join(dir, ".drill");
    await writeFile(mark, '{"address":"drill.example.com","startedAt":"2026-10-18T04:00:00Z"}');
    const comparison = path.join(dir, "compare.json");
    await writeFile(comparison, JSON.stringify(compare));
    const run = await bootstrap([
      "--drill-result",
      mark,
      comparison,
      "2712",
      "2026-10-17-1400",
      https,
      screens,
    ]);
    return { run, drill: JSON.parse(await readFile(mark, "utf8")) as Record<string, unknown> };
  }

  it("keeps the time it took and says it worked when everything came back over HTTPS", async () => {
    const { run, drill } = await result(
      {
        ok: true,
        records: 1200,
        files: 30,
        problems: [],
        compared: { records: true, files: true },
      },
      "1",
      "0",
    );
    expect(run.stdout.trim()).toBe("it worked");
    expect(drill).toMatchObject({
      address: "drill.example.com",
      startedAt: "2026-10-18T04:00:00Z",
      seconds: 2712,
      backup: "2026-10-17-1400",
      records: 1200,
      files: 30,
      problems: 0,
      screenProblems: 0,
      https: true,
      result: "worked",
    });
    expect(Number.isNaN(Date.parse(String(drill.finishedAt)))).toBe(false);
  });

  it("says it had problems when a table differs, HTTPS did not come or a screen failed", async () => {
    const bad = await result({ ok: false, problems: [{ table: "Invoice" }] }, "1", "0");
    expect(bad.drill).toMatchObject({ result: "problems", problems: 1 });
    expect(bad.run.stdout).toContain("with problems");
    expect((await result({ ok: true, problems: [] }, "0", "0")).drill).toMatchObject({
      result: "problems",
      https: false,
    });
    expect((await result({ ok: true, problems: [] }, "1", "2")).drill).toMatchObject({
      result: "problems",
      screenProblems: 2,
    });
  });
});

describe("the restore command in a drill", () => {
  it("takes --drill only after the version, and sets the drill up before DNS, Docker and the ERP", () => {
    expect(SCRIPT).toMatch(/case "\$\{2:-\}" in\n\s+""\) ;;\n\s+--drill\) drill=1 ;;/);
    const settings = SCRIPT.indexOf('[ -z "$drill" ] || drill_settings "$env_file" "$DATA"');
    expect(settings).toBeGreaterThan(SCRIPT.indexOf('tool env --work "$WORK" --env "$env_file"'));
    for (const later of [
      'step "Pointing the web address at this server"',
      '"$DIR/deploy/setup-server.sh"',
      '"$DIR/deploy/deploy.sh"',
      '"$DIR/deploy/restore.sh" --yes',
    ]) {
      expect(SCRIPT.indexOf(later), later).toBeGreaterThan(settings);
    }
    // A server that holds a drill copy stays a drill, even without --drill.
    expect(SCRIPT).toMatch(
      /if \[ -z "\$drill" \] && \[ -f "\$DATA\/backups\/\.drill" \]; then[\s\S]{0,200}drill=1/,
    );
    // The end says the drill's time and never sends the owner to set up GitHub's updates.
    expect(SCRIPT).toContain('say "Restore drill finished in $((took / 60)) min $((took % 60)) s');
    expect(SCRIPT).toMatch(/\[ -n "\$drill" \] \|\|\n\s+note "Next \(part F of the guide\)/);
  });
});
