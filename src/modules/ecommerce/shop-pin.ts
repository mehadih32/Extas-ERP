/*
 * Online shops' IP addresses and the changes that need the owner's PIN
 * (CN-005). Shared by the service (integration.service.ts), the API's
 * allow-list check (route.ts) and the "Edit" form, which shows the PIN field
 * before it is asked: no server code here.
 */

/**
 * An IP address written one way: lower case, IPv6 shortened ("2001:DB8:0::1"
 * is "2001:db8::1") and an IPv4 address inside IPv6 ("::ffff:1.2.3.4") as the
 * IPv4 address itself. Anything else comes back trimmed.
 */
export function normalizeIp(ip: string): string {
  const text = ip.trim().toLowerCase();
  if (!text.includes(":")) return text;
  let short: string;
  try {
    short = new URL(`http://[${text}]/`).hostname.slice(1, -1);
  } catch {
    return text;
  }
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(short);
  if (!mapped) return short;
  const high = parseInt(mapped[1]!, 16);
  const low = parseInt(mapped[2]!, 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

/**
 * What a change needs the PIN for, or null:
 *   - a new webhook address (also cleared or set for the first time): the
 *     shop's stock and product changes go there, signed;
 *   - an IP allow-list that lets more places call the API with the key: while
 *     the list has addresses only they may call, so adding one, or emptying the
 *     list (any address may then call), widens it. Taking addresses off while
 *     at least one stays, or starting a list, only narrows it: no PIN.
 */
export function pinNeededFor(
  before: { webhookUrl: string | null; ipAllowList: string[] },
  after: { webhookUrl?: string | null; ipAllowList: string[] },
): string | null {
  if ((after.webhookUrl ?? null) !== (before.webhookUrl ?? null)) {
    return "change the shop's webhook URL";
  }
  if (before.ipAllowList.length === 0) return null;
  const had = new Set(before.ipAllowList.map(normalizeIp));
  if (after.ipAllowList.length === 0 || after.ipAllowList.some((ip) => !had.has(normalizeIp(ip)))) {
    return "let more addresses call the shop's API";
  }
  return null;
}
