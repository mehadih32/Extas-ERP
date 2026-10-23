import { beforeEach, describe, expect, it, vi } from "vitest";

// No real name is ever looked up: each test says what a name resolves to.
const dns = vi.hoisted(() => ({
  answer: { addresses: ["93.184.216.34"] as string[], error: null as Error | null },
  asked: [] as string[],
}));
vi.mock("node:dns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:dns")>();
  const lookup = (
    host: string,
    _options: unknown,
    callback: (error: Error | null, found: unknown[]) => void,
  ) => {
    dns.asked.push(host);
    const { addresses, error } = dns.answer;
    callback(
      error,
      error ? [] : addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
    );
  };
  return { ...actual, default: { ...actual, lookup }, lookup };
});

import { pinNeededFor, privateAddress } from "@/modules/ecommerce/integration.service";
import { deliver, refuseAddress, shopLookup } from "@/modules/ecommerce/webhooks";

/** shopLookup's answer, as node:net would get it. */
function look(all: boolean) {
  return new Promise<{ error: Error | null; address: unknown; family?: number }>((resolve) =>
    shopLookup("shop.example.com", { all }, (error, address, family) =>
      resolve({ error, address, family }),
    ),
  );
}

describe("privateAddress: never a shop's webhook address (CN-005)", () => {
  it.each([
    // IPv4: this network, private, loopback, shared, link-local, multicast and reserved
    "0.0.0.0",
    "10.1.2.3",
    "127.0.0.1",
    "100.64.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "224.0.0.1",
    "255.255.255.255",
    // 198.18.0.0/15 (benchmarking), 192.0.0.0/24 (protocol assignments) and Azure's host
    "198.18.0.1",
    "198.19.255.254",
    "192.0.0.8",
    "168.63.129.16",
    // IPv6: loopback, unspecified, IPv4-compatible and IPv4-mapped
    "::1",
    "::",
    "0:0:0:0:0:0:0:1",
    "::10.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:93.184.216.34",
    // 64:ff9b::/96 and 64:ff9b:1::/48 (NAT64), 2002::/16 (6to4), 2001::/32 (Teredo)
    "64:ff9b::a00:1",
    "64:ff9b::93.184.216.34",
    "64:ff9b:1::1",
    "2002:a00:1::1",
    "2001:0:4136:e378::1",
    // unique local, link-local (all of fe80::/10), site-local fec0::/10, multicast
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "febf::1",
    "fec0::1",
    "feff::1",
    "ff02::1",
    "[fe80::1%eth0]",
    // names
    "localhost",
    "intranet",
    "erp.local",
    "db.internal",
    "a.localhost",
  ])("refuses %s", (host) => {
    expect(privateAddress(host)).toBe(true);
  });

  it.each([
    "93.184.216.34",
    "198.17.255.255",
    "198.20.0.1",
    "192.0.1.1",
    "168.63.129.17",
    "100.63.255.255",
    "2606:4700::1111",
    "[2a00:1450:4001:80b::200e]",
    "64:ff9b:2::1",
    "2003::1",
    "fc::1",
    "shop.example.com",
  ])("allows %s", (host) => {
    expect(privateAddress(host)).toBe(false);
  });
});

describe("pinNeededFor: the shop changes that need the owner's PIN", () => {
  const before = { webhookUrl: "https://shop.example.com/hook", ipAllowList: ["203.0.113.7"] };
  it("asks for a new, added or cleared webhook URL", () => {
    expect(pinNeededFor(before, { ...before, webhookUrl: "https://shop.example.com/v2" })).toBe(
      "change the shop's webhook URL",
    );
    expect(pinNeededFor(before, { ...before, webhookUrl: null })).not.toBeNull();
    expect(pinNeededFor({ ...before, webhookUrl: null }, before)).not.toBeNull();
    expect(pinNeededFor(before, { ...before })).toBeNull();
  });
  it("asks when an address goes, not when one is added", () => {
    expect(pinNeededFor(before, { ...before, ipAllowList: ["203.0.113.7", "::1"] })).toBeNull();
    expect(pinNeededFor(before, { ...before, ipAllowList: [] })).toBe(
      "take an address off the shop's IP allow-list",
    );
    expect(pinNeededFor(before, { ...before, ipAllowList: ["203.0.113.8"] })).not.toBeNull();
    const v6 = { ...before, ipAllowList: ["2001:DB8:0::1"] };
    expect(pinNeededFor(v6, { ...v6, ipAllowList: ["2001:db8::1"] })).toBeNull();
  });
});

describe("Webhook sending checks the address it connects to (CN-005)", () => {
  beforeEach(() => {
    dns.answer = { addresses: ["93.184.216.34"], error: null };
    dns.asked = [];
  });

  it("answers node:net with the checked addresses, one or all", async () => {
    expect(await look(true)).toMatchObject({
      error: null,
      address: [{ address: "93.184.216.34", family: 4 }],
    });
    expect(await look(false)).toMatchObject({
      error: null,
      address: "93.184.216.34",
      family: 4,
    });
  });

  it("refuses a name when any of its addresses is private, or it is not found", async () => {
    dns.answer = { addresses: ["93.184.216.34", "10.0.0.7"], error: null };
    expect((await look(false)).error?.message).toBe(
      "The shop's webhook address points to a private network.",
    );
    dns.answer = { addresses: ["64:ff9b::a00:7"], error: null };
    expect((await look(true)).error?.message).toBe(
      "The shop's webhook address points to a private network.",
    );
    dns.answer = { addresses: [], error: new Error("ENOTFOUND") };
    expect((await look(true)).error?.message).toBe(
      "The shop's webhook address could not be found (DNS).",
    );
  });

  it("checks the address's form before anything is looked up", () => {
    expect(refuseAddress("http://shop.example.com/hook")).toContain("https://");
    expect(refuseAddress("https://user:pw@shop.example.com/hook")).toContain("password");
    expect(refuseAddress("https://[::ffff:127.0.0.1]/hook")).toContain("private network");
    expect(refuseAddress("https://168.63.129.16/hook")).toContain("private network");
    expect(refuseAddress("https://shop.example.com/hook")).toBeNull();
    expect(dns.asked).toEqual([]);
  });

  it("is refused inside node:https's own connection, before anything is sent", async () => {
    // A real https request: Node's connection asks shopLookup, which refuses.
    dns.answer = { addresses: ["10.0.0.7"], error: null };
    const result = await deliver("https://rebound.example.com/hook", "secret", {
      id: "x",
      type: "ping",
      raw: "{}",
    });
    expect(result).toMatchObject({
      ok: false,
      status: null,
      error: "The shop's webhook address points to a private network.",
    });
    expect(dns.asked).toEqual(["rebound.example.com"]);
  });
});
