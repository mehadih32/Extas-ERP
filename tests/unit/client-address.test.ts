import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/*
 * v6.4 fresh review S2: behind Cloudflare's proxy every visitor reached the
 * ERP from a Cloudflare address, so Bug Guard's blocks could lock out
 * everyone. Caddy now trusts only Cloudflare's published ranges, settles the
 * visitor's address from CF-Connecting-IP when (and only when) the request
 * came from one of them, and hands the app exactly that one address. A
 * direct visitor's own X-Forwarded-For is never believed.
 */

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

  it("trusts only Cloudflare's published ranges, and reads their visitor header strictly", () => {
    const servers = block(global, global.indexOf("servers {"));
    expect(servers.length, "a global servers { } block").toBeGreaterThan(2);
    const trusted = servers.filter((l) => l.startsWith("trusted_proxies "));
    expect(trusted).toHaveLength(1);
    const words = trusted[0]!.split(/\s+/);
    expect(words.slice(0, 2)).toEqual(["trusted_proxies", "static"]);
    expect([...words.slice(2)].sort()).toEqual([...CLOUDFLARE].sort());
    // Never private ranges or "everyone": a visitor at the door could then name any address.
    expect(trusted[0]).not.toMatch(/private_ranges|0\.0\.0\.0\/0|::\/0/);
    expect(servers).toContain("trusted_proxies_strict");
    expect(servers).toContain("client_ip_headers CF-Connecting-IP X-Forwarded-For");
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
