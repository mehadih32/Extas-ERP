import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseRanges } from "@/lib/cloudflare-ips";

/*
 * v6.4.1 B2: deploy/cloudflare-ips.sh keeps Cloudflare's proxy addresses up to
 * date for Caddy and the app, run for real in bash with stand-in folders and
 * local files in place of Cloudflare's pages (never the network, never the
 * server's own paths). Only a sound list is ever written; a failed or strange
 * fetch keeps the last good list.
 */

type Run = { code: number; stdout: string; stderr: string };

const SCRIPT = path.join(process.cwd(), "deploy", "cloudflare-ips.sh");
const COPY = readFileSync(path.join(process.cwd(), "deploy", "cloudflare-ips.txt"), "utf8")
  .split("\n")
  .filter(Boolean);
const V4 = COPY.filter((r) => !r.includes(":"));
const V6 = COPY.filter((r) => r.includes(":"));

let dir: string;
let pages: string;
let out: string;

function run(script: string) {
  return new Promise<Run>((resolve) => {
    execFile(
      "bash",
      ["-c", `source "${SCRIPT}"\nCLOUDFLARE_IPS_BASE="file://${pages}"\n${script}`],
      { timeout: 60_000 },
      (error, stdout, stderr) =>
        resolve({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr }),
    );
  });
}

const update = () => run(`update_cloudflare_ips "${out}"; echo "changed=$CLOUDFLARE_IPS_CHANGED"`);
const publish = async (v4: string[] | string | null, v6: string[] | string | null) => {
  await rm(pages, { recursive: true, force: true });
  await mkdir(pages);
  const body = (list: string[] | string) => (Array.isArray(list) ? `${list.join("\n")}\n` : list);
  if (v4 !== null) await writeFile(path.join(pages, "ips-v4"), body(v4));
  if (v6 !== null) await writeFile(path.join(pages, "ips-v6"), body(v6));
};
const kept = () => readFileSync(path.join(out, "ips.txt"), "utf8").trim().split("\n");
const caddy = () => readFileSync(path.join(out, "trusted.caddy"), "utf8");

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "extras-cloudflare-ips-"));
  pages = path.join(dir, "pages");
  out = path.join(dir, "caddy", "cloudflare");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("Cloudflare's address list on the server (v6.4.1 B2)", () => {
  it("writes Cloudflare's list for the app and for Caddy, and again only when it changed", async () => {
    const added = [...V4, "198.18.0.0/15"];
    await publish(added, V6.join("\r\n"));
    const first = await update();
    expect(first.stdout).toContain("changed=1");
    expect(kept()).toEqual([...added, ...V6]);
    expect(parseRanges(readFileSync(path.join(out, "ips.txt"), "utf8"))).toHaveLength(23);
    const lines = caddy()
      .split("\n")
      .filter((l) => l && !l.startsWith("#"));
    expect(lines).toEqual([`trusted_proxies static ${[...added, ...V6].join(" ")}`]);
    expect(statSync(path.join(out, "ips.txt")).mode & 0o777).toBe(0o644);
    expect(statSync(path.join(out, "trusted.caddy")).mode & 0o777).toBe(0o644);
    // The same list again: nothing is written, so Caddy is not reloaded.
    expect((await update()).stdout).toContain("changed=0");
  });

  it("keeps the last good list when a fetch fails or brings something else", async () => {
    await publish(V4, V6);
    await update();
    const good = kept();
    for (const [v4, v6] of [
      [null, V6],
      [V4, null],
      ["<html>Cloudflare is down</html>\n", V6],
      [[...V4, "0.0.0.0/0"], V6],
      [V4, [...V6, "::/0"]],
      [V4.slice(0, 2), V6],
      [[...V4, "300.1.1.1/16"], V6],
      ["", ""],
    ] as const) {
      await publish(v4 as string[] | string | null, v6 as string[] | string | null);
      const done = await update();
      expect(done.code).toBe(0);
      expect(done.stdout).toContain("changed=0");
      expect(done.stdout).toContain("the last one fetched stays");
      expect(kept()).toEqual(good);
      expect(caddy()).toContain(`trusted_proxies static ${good.join(" ")}`);
    }
  });

  it("uses the copy that came with the ERP until the first fetch works", async () => {
    await publish(null, null);
    const done = await update();
    expect(done.stdout).toContain("the copy that came with the ERP stands in");
    expect(done.stdout).toContain("changed=1");
    expect(kept()).toEqual(COPY);
    expect(caddy()).toContain(`trusted_proxies static ${COPY.join(" ")}`);
  });

  it("is fetched every day by cron, set up at every update, and never fails the update", async () => {
    const cron = path.join(dir, "cron");
    const done = await run(`install_cloudflare_cron "${cron}"`);
    expect(done.code).toBe(0);
    const line = readFileSync(cron, "utf8")
      .split("\n")
      .filter((l) => l && !l.startsWith("#"));
    expect(line).toHaveLength(1);
    expect(line[0]).toMatch(
      /^\d+ \d+ \* \* \* root \S+\/deploy\/cloudflare-ips\.sh >\/dev\/null 2>&1$/,
    );
    expect(existsSync(SCRIPT) && statSync(SCRIPT).mode & 0o111).toBeTruthy();
    // Only Cloudflare's own pages, over HTTPS.
    expect(readFileSync(SCRIPT, "utf8")).toContain(
      'CLOUDFLARE_IPS_BASE="${CLOUDFLARE_IPS_BASE:-https://www.cloudflare.com}"',
    );
  });
});
