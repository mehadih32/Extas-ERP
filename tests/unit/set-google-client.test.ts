import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

/*
 * deploy/set-google-client.sh (plan v5): puts Extas's central Google client (the
 * "TVs and Limited Input devices" client the restore guide prints) in a server's
 * deploy/.env, asked with hidden typing. Run for real in bash, on a stand-in
 * deploy folder, never the server's own.
 */

const SCRIPT = path.join(process.cwd(), "deploy", "set-google-client.sh");
const ID = "123-extas.apps.googleusercontent.com";
const SECRET = "GOCSPX-central_secret-123";

type Run = { code: number; stdout: string; stderr: string };

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "extas-google-client-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A few lines of bash after loading the script (its main part does not run then). */
function withScript(script: string) {
  return new Promise<Run>((resolve) => {
    execFile(
      "bash",
      ["-c", `source "${SCRIPT}"\n${script}`],
      { env: { ...process.env, EXTRAS_DEPLOY_DIR: dir }, timeout: 30_000 },
      (error, stdout, stderr) =>
        resolve({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr }),
    );
  });
}

describe("deploy/set-google-client.sh", () => {
  it("writes the client into deploy/.env, replacing an earlier one and keeping every other line, its owner and mode", async () => {
    const env = path.join(dir, ".env");
    await writeFile(
      env,
      [
        "APP_DOMAIN=erp.extasbd.com",
        "GOOGLE_DRIVE_CLIENT_ID=",
        "ENCRYPTION_KEY=keep-me",
        "GOOGLE_DRIVE_CLIENT_SECRET=old-secret",
        "SEED_COMPANIES=Extas", // no newline at the end: still kept
      ].join("\n"),
      { mode: 0o600 },
    );
    // The values are function arguments inside one bash: never a program's arguments.
    const done = await withScript(
      `id='${ID}'; secret='${SECRET}'; write_google_client "$id" "$secret"`,
    );
    expect(done).toMatchObject({ code: 0, stdout: "", stderr: "" });
    expect(readFileSync(env, "utf8")).toBe(
      [
        "APP_DOMAIN=erp.extasbd.com",
        "ENCRYPTION_KEY=keep-me",
        "SEED_COMPANIES=Extas",
        `GOOGLE_DRIVE_CLIENT_ID=${ID}`,
        `GOOGLE_DRIVE_CLIENT_SECRET=${SECRET}`,
        "",
      ].join("\n"),
    );
    expect(statSync(env).mode & 0o777).toBe(0o600);
    expect(statSync(path.join(dir, ".env")).uid).toBe(process.getuid!());
  });

  it("never leaves the secret in a file others can read, even when it stops half way", async () => {
    const env = path.join(dir, ".env");
    await writeFile(env, "APP_DOMAIN=erp.extasbd.com\n", { mode: 0o600 });
    // The new file's mode while it is written, and what is left when chown fails.
    const done = await withScript(
      `umask 022
chown() { stat -c %a "$ENV_FILE.new"; return 1; }
id='${ID}'; secret='${SECRET}'; write_google_client "$id" "$secret"`,
    );
    expect(done.code).not.toBe(0);
    expect(done.stdout.trim()).toBe("600");
    expect(existsSync(`${env}.new`)).toBe(false);
    expect(readFileSync(env, "utf8")).toBe("APP_DOMAIN=erp.extasbd.com\n");
  });

  it("takes only a real client ID and secret, so nothing else reaches deploy/.env", async () => {
    const check = async (fn: string, value: string) =>
      (await withScript(`${fn} '${value.replace(/'/g, "'\\''")}'`)).code === 0;
    expect(await check("valid_client_id", ID)).toBe(true);
    expect(await check("valid_client_id", "123-extas.apps.googleusercontent.com.evil")).toBe(false);
    expect(await check("valid_client_id", "x\nGITHUB_TOKEN=1.apps.googleusercontent.com")).toBe(
      false,
    );
    expect(await check("valid_client_secret", SECRET)).toBe(true);
    expect(await check("valid_client_secret", "short")).toBe(false);
    expect(await check("valid_client_secret", "GOCSPX-a b$(id)")).toBe(false);
    expect(await check("valid_client_secret", "GOCSPX-abc\nAPP_DOMAIN=evil.com")).toBe(false);
  });

  it("asks for the secret with hidden typing and never prints it", () => {
    const text = readFileSync(SCRIPT, "utf8");
    expect(text).toMatch(/read -r -s -p "\$1" answer <\/dev\/tty/);
    expect(text).toMatch(/secret="\$\(ask_hidden "Google client secret: "\)"/);
    // The only places the secret is written: deploy/.env, through printf (a built-in).
    const shown = text
      .split("\n")
      .filter((l) => /\b(echo|say|die)\b.*\$(secret\b|\{secret\})/.test(l));
    expect(shown).toEqual([]);
    expect(text).toMatch(/printf 'GOOGLE_DRIVE_CLIENT_SECRET=%s\\n' "\$secret"/);
    // Its main part runs only when the script is run, not when it is loaded.
    expect(text).toMatch(/if \[ "\$\{BASH_SOURCE\[0\]\}" = "\$0" \]; then\n {2}main "\$@"\nfi/);
  });
});
