import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * v6.4 fresh review S2: behind Cloudflare's proxy every visitor reached the
 * ERP from a Cloudflare address, so Bug Guard's blocks could lock out
 * everyone. Caddy now trusts only Cloudflare's published ranges, settles the
 * visitor's address from CF-Connecting-IP when (and only when) the request
 * came from one of them, and hands the app exactly that one address. A
 * direct visitor's own X-Forwarded-For is never believed.
 */

import {
  CLOUDFLARE_RANGES,
  forgetCloudflareList,
  isCloudflareAddress,
  parseRanges,
  visitorAddress,
} from "@/lib/cloudflare-ips";
import { clientAddress } from "@/lib/request-meta";

// Cloudflare's published ranges (https://www.cloudflare.com/ips-v4 and /ips-v6, read 2026-10-16).
const CLOUDFLARE = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

const deploy = (file: string) =>
  readFileSync(join(__dirname, "..", "..", "deploy", file), "utf8")
    .split("\n")
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter(Boolean);

/** The lines of the block that opens on line `start` (ending in "{"), through its "}". */
function block(lines: string[], start: number): string[] {
  let depth = 0;
  const out: string[] = [];
  for (const line of lines.slice(start)) {
    if (line.endsWith("{")) depth += 1;
    if (line === "}") depth -= 1;
    out.push(line);
    if (depth === 0) break;
  }
  return out;
}

describe("Caddy in front of the ERP (S2)", () => {
  const caddyfile = deploy("Caddyfile");
  const global = block(caddyfile, caddyfile.indexOf("{"));

  it("trusts only Cloudflare's published ranges, fetched every day, and reads their visitor header strictly", () => {
    const servers = block(global, global.indexOf("servers {"));
    expect(servers.length, "a global servers { } block").toBeGreaterThan(2);
    // The list itself comes from the file deploy/cloudflare-ips.sh keeps up to date (v6.4.1 B2).
    expect(servers.filter((l) => l.startsWith("trusted_proxies "))).toEqual([]);
    expect(servers).toContain("import cloudflare/*.caddy");
    expect(servers).toContain("trusted_proxies_strict");
    expect(servers).toContain("client_ip_headers CF-Connecting-IP X-Forwarded-For");
    // The copy that stands in before the first fetch, and the app's own, are Cloudflare's list.
    expect([...deploy("cloudflare-ips.txt")].sort()).toEqual([...CLOUDFLARE].sort());
    expect([...CLOUDFLARE_RANGES].sort()).toEqual([...CLOUDFLARE].sort());
  });

  it("gives Caddy and the app the same fetched list, the app read-only", () => {
    const compose = readFileSync(join(__dirname, "..", "..", "deploy", "compose.yml"), "utf8");
    expect(compose).toContain(
      "${DATA_DIR:-/srv/extras-erp}/caddy/cloudflare:/etc/caddy/cloudflare:ro",
    );
    // The live app and the demo app.
    expect(
      compose.match(/\$\{DATA_DIR:-\/srv\/extras-erp\}\/caddy\/cloudflare:\/data\/cloudflare:ro/g),
    ).toHaveLength(2);
    expect(compose.match(/CLOUDFLARE_IPS_FILE: \/data\/cloudflare\/ips\.txt/g)).toHaveLength(2);
    const update = readFileSync(join(__dirname, "..", "..", "deploy", "deploy.sh"), "utf8");
    expect(update).toMatch(/"\$DEPLOY_DIR\/cloudflare-ips\.sh" --setup \|\|/);
    // Before Caddy starts.
    expect(update.indexOf('cloudflare-ips.sh" --setup')).toBeLessThan(update.indexOf("compose up"));
  });

  it("hands the app only the address it settled on, on the ERP and on the demo site", () => {
    for (const file of ["Caddyfile", "demo.caddy"]) {
      const lines = deploy(file);
      const proxies = lines.flatMap((l, i) => (l.startsWith("reverse_proxy ") ? [i] : []));
      expect(proxies.length, file).toBeGreaterThan(0);
      for (const at of proxies) {
        expect(lines[at], `${file}: reverse_proxy has its own block`).toMatch(/\{$/);
        expect(block(lines, at), file).toContain("header_up X-Forwarded-For {client_ip}");
      }
    }
  });
});

describe("The visitor's address the ERP keeps (S2)", () => {
  const from = (values: Record<string, string>) => clientAddress(new Headers(values));

  it("is the one address Caddy hands on", () => {
    expect(from({ "x-forwarded-for": "203.0.113.7" })).toBe("203.0.113.7");
    expect(from({ "x-forwarded-for": "2001:db8::42" })).toBe("2001:db8::42");
    // Before Caddy settled it (an older Caddyfile): still the first entry.
    expect(from({ "x-forwarded-for": "203.0.113.7, 162.158.1.1" })).toBe("203.0.113.7");
  });

  it("is never words a visitor typed into a header", () => {
    expect(from({ "x-forwarded-for": "<script>alert(1)</script>" })).toBeUndefined();
    expect(from({ "x-forwarded-for": "unknown" })).toBeUndefined();
    expect(from({ "x-forwarded-for": `${"1".repeat(600)}` })).toBeUndefined();
    expect(from({ "x-forwarded-for": "nonsense", "x-real-ip": "198.51.100.9" })).toBe(
      "198.51.100.9",
    );
    expect(from({})).toBeUndefined();
  });
});

describe("Cloudflare's own addresses are never a visitor (v6.4.1 B2)", () => {
  const from = (values: Record<string, string>) => clientAddress(new Headers(values));
  afterEach(() => {
    vi.unstubAllEnvs();
    forgetCloudflareList();
  });

  it("takes CF-Connecting-IP only from a request that came from a Cloudflare address", () => {
    // Caddy's list was older than Cloudflare's: it handed on Cloudflare's address.
    expect(from({ "x-forwarded-for": "162.158.10.20", "cf-connecting-ip": "203.0.113.9" })).toBe(
      "203.0.113.9",
    );
    expect(
      from({ "x-forwarded-for": "2606:4700:10::ac43:1", "cf-connecting-ip": "2001:db8::9" }),
    ).toBe("2001:db8::9");
    // From anywhere else the header is the visitor's own words: never believed.
    expect(from({ "x-forwarded-for": "203.0.113.7", "cf-connecting-ip": "198.51.100.1" })).toBe(
      "203.0.113.7",
    );
    // Nothing usable in it: the Cloudflare address is kept for the logs only.
    for (const named of ["", "nonsense", "104.16.0.1"]) {
      expect(from({ "x-forwarded-for": "162.158.10.20", "cf-connecting-ip": named })).toBe(
        "162.158.10.20",
      );
    }
  });

  it("never blocks or counts a Cloudflare address as one visitor", () => {
    for (const address of ["162.158.10.20", "104.16.0.1", "2a06:98c0::1", "::ffff:172.64.1.1"]) {
      expect(isCloudflareAddress(address), address).toBe(true);
      expect(visitorAddress(address), address).toBeUndefined();
    }
    for (const address of ["203.0.113.7", "2001:db8::42", "::ffff:203.0.113.7"]) {
      expect(isCloudflareAddress(address), address).toBe(false);
      expect(visitorAddress(address), address).toBe(address);
    }
    expect(visitorAddress(undefined)).toBeUndefined();
    expect(isCloudflareAddress("not an address")).toBe(false);
  });

  it("follows the list the server fetched, and keeps the copy when that file is not a sound list", () => {
    const dir = mkdtempSync(join(tmpdir(), "extras-cloudflare-"));
    try {
      const file = join(dir, "ips.txt");
      // Cloudflare added a range (a documentation range here) and dropped one.
      const fetched = [...CLOUDFLARE.filter((r) => r !== "131.0.72.0/22"), "198.18.0.0/15"];
      writeFileSync(file, `${fetched.join("\n")}\n`);
      vi.stubEnv("CLOUDFLARE_IPS_FILE", file);
      forgetCloudflareList();
      expect(isCloudflareAddress("198.18.4.4")).toBe(true);
      expect(isCloudflareAddress("131.0.72.1")).toBe(false);
      expect(from({ "x-forwarded-for": "198.18.4.4", "cf-connecting-ip": "203.0.113.50" })).toBe(
        "203.0.113.50",
      );

      // A broken file (an error page, say): the copy that came with the ERP stands in.
      writeFileSync(file, "<html>error</html>\n");
      forgetCloudflareList();
      expect(isCloudflareAddress("198.18.4.4")).toBe(false);
      expect(isCloudflareAddress("131.0.72.1")).toBe(true);
      vi.stubEnv("CLOUDFLARE_IPS_FILE", join(dir, "missing.txt"));
      forgetCloudflareList();
      expect(isCloudflareAddress("162.158.10.20")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("takes only a sound list of ranges", () => {
    expect(parseRanges(CLOUDFLARE.join("\n"))).toEqual(CLOUDFLARE);
    expect(parseRanges(`# Cloudflare\n${CLOUDFLARE.join("\r\n")}\n\n`)).toHaveLength(22);
    expect(parseRanges("")).toBeNull();
    expect(parseRanges([...CLOUDFLARE, "0.0.0.0/0"].join("\n"))).toBeNull();
    expect(parseRanges([...CLOUDFLARE, "::/0"].join("\n"))).toBeNull();
    expect(parseRanges([...CLOUDFLARE, "10.0.0.0"].join("\n"))).toBeNull();
    expect(parseRanges(CLOUDFLARE.slice(0, 4).join("\n"))).toBeNull();
  });
});
