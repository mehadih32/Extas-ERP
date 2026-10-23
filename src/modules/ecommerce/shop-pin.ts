/*
 * Which changes to an online shop need the owner's PIN (CN-005). Shared by the
 * service (integration.service.ts), which asks for it, and the "Edit" form,
 * which shows the PIN field before it is asked: no server code here.
 */

/** An IP address written one way, so "2001:DB8:0::1" and "2001:db8::1" are the same. */
function sameIp(ip: string) {
  const text = ip.trim().toLowerCase();
  if (!text.includes(":")) return text;
  try {
    return new URL(`http://[${text}]/`).hostname.slice(1, -1);
  } catch {
    return text;
  }
}

/**
 * What a change needs the PIN for, or null: a new webhook address (the shop's
 * stock and product changes go there, signed) or an address taken off the IP
 * allow-list (more places may then call the API with the key). Adding an
 * address only narrows who may call, so it needs no PIN.
 */
export function pinNeededFor(
  before: { webhookUrl: string | null; ipAllowList: string[] },
  after: { webhookUrl?: string | null; ipAllowList: string[] },
): string | null {
  if ((after.webhookUrl ?? null) !== (before.webhookUrl ?? null)) {
    return "change the shop's webhook URL";
  }
  const kept = new Set(after.ipAllowList.map(sameIp));
  if (before.ipAllowList.some((ip) => !kept.has(sameIp(ip)))) {
    return "take an address off the shop's IP allow-list";
  }
  return null;
}
