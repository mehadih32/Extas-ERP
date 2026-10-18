import { readFileSync, statSync } from "node:fs";
import { BlockList, isIP } from "node:net";

/*
 * Cloudflare's proxy addresses (v6.4.1 B2). Behind the orange cloud every
 * visitor reaches the server from one of them, so such an address is never a
 * visitor: it is never blocked, never counted as one place for sign-in limits,
 * and a request that really came from one names its visitor in
 * CF-Connecting-IP (request-meta.ts). The list is Cloudflare's own
 * (https://www.cloudflare.com/ips-v4 and /ips-v6): deploy/cloudflare-ips.sh
 * fetches it on the server every day into the file CLOUDFLARE_IPS_FILE names
 * (Caddy reads the same list), keeping the last good one when a fetch fails.
 * Without that file, or when it is not a list of ranges, the copy below
 * (deploy/cloudflare-ips.txt, read 2026-10-16) stands in.
 */

export const CLOUDFLARE_RANGES: readonly string[] = [
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

/** How often the server's file is looked at again for a newer list. */
const LOOK_EVERY_MS = 60_000;

/**
 * The ranges in a list (one per line; blank lines and # notes left out), or
 * null when it is not a sound list of Cloudflare's: a line that is not a range,
 * a range wider than /8 (IPv4) or /16 (IPv6), or too few of either.
 */
export function parseRanges(text: string): string[] | null {
  const ranges = text
    .split("\n")
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter(Boolean);
  let v4 = 0;
  let v6 = 0;
  for (const range of ranges) {
    const [address, bits, extra] = range.split("/");
    const version = isIP(address ?? "");
    const prefix = Number(bits);
    if (extra !== undefined || !version || !/^\d{1,3}$/.test(bits ?? "")) return null;
    if (version === 4 && (prefix < 8 || prefix > 32)) return null;
    if (version === 6 && (prefix < 16 || prefix > 128)) return null;
    if (version === 4) v4 += 1;
    else v6 += 1;
  }
  return v4 >= 5 && v6 >= 3 && ranges.length <= 400 ? ranges : null;
}

function blockListOf(ranges: readonly string[]): BlockList {
  const list = new BlockList();
  for (const range of ranges) {
    const [address, bits] = range.split("/") as [string, string];
    list.addSubnet(address, Number(bits), isIP(address) === 6 ? "ipv6" : "ipv4");
  }
  return list;
}

const builtIn = blockListOf(CLOUDFLARE_RANGES);
let cached: { file: string; mtimeMs: number; lookedAt: number; list: BlockList } | null = null;

/** The list in use: the server's file while it is a sound list, else the copy here. */
function currentList(now = Date.now()): BlockList {
  const file = process.env.CLOUDFLARE_IPS_FILE?.trim();
  if (!file) return builtIn;
  if (cached && cached.file === file && now - cached.lookedAt < LOOK_EVERY_MS) return cached.list;
  try {
    const { mtimeMs } = statSync(file);
    if (cached && cached.file === file && cached.mtimeMs === mtimeMs) {
      cached.lookedAt = now;
      return cached.list;
    }
    const ranges = parseRanges(readFileSync(file, "utf8"));
    cached = { file, mtimeMs, lookedAt: now, list: ranges ? blockListOf(ranges) : builtIn };
  } catch {
    cached = { file, mtimeMs: -1, lookedAt: now, list: builtIn };
  }
  return cached.list;
}

/** Tests change the server's file: the next look reads it again. */
export function forgetCloudflareList() {
  cached = null;
}

/** An IPv6 form of an IPv4 address ("::ffff:1.2.3.4") is that IPv4 address. */
const plain = (address: string) => {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  return mapped ? mapped[1]! : address;
};

/** Whether an address is one of Cloudflare's proxies (never a visitor). */
export function isCloudflareAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  const ip = plain(address.trim());
  const version = isIP(ip);
  if (!version) return false;
  return currentList().check(ip, version === 6 ? "ipv6" : "ipv4");
}

/**
 * A visitor's address that may be blocked, slowed down or counted as one
 * place: undefined when unknown, or when it is a Cloudflare address (many
 * visitors share it).
 */
export function visitorAddress(address: string | null | undefined): string | undefined {
  return address && !isCloudflareAddress(address) ? address : undefined;
}
