import type { BackupConfig } from "@prisma/client";

import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import type { CompanyContext } from "@/modules/auth/context";
import { audit, getBackupConfig } from "@/modules/backups/backup-core";
import { presentConfig } from "@/modules/backups/backup.service";
import { cloudflareSchema } from "@/modules/backups/schemas";

/*
 * Cloudflare, for a new server (G8, G9): the restore points the ERP's domain at
 * the new server's address, and gets the HTTPS certificate with the Cloudflare
 * proxy on (the DNS challenge). The owner makes an API token that can only
 * read their domain and edit its DNS records, and saves it once here (with the
 * PIN). The token is kept sealed (encryptSecret), goes into every locked backup
 * (server.json), and is never shown again: the screen shows its last 4
 * characters. "Test" asks Cloudflare whether the token works, sees only this
 * domain, and can read its DNS records; nothing is changed.
 * CLOUDFLARE_API_BASE is changed only by the tests (scripts/fake-cloudflare.ts).
 */

const apiBase = () =>
  (process.env.CLOUDFLARE_API_BASE || "https://api.cloudflare.com/client/v4").replace(/\/+$/, "");

type CfResponse<T> = {
  success: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result: T;
};

export class CloudflareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudflareError";
  }
}

async function cf<T>(token: string, url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBase()}${url}`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new CloudflareError("Cloudflare did not answer: check the server's internet connection.");
  }
  let body: CfResponse<T> | null = null;
  try {
    body = (await response.json()) as CfResponse<T>;
  } catch {
    body = null;
  }
  if (!response.ok || !body?.success) {
    const detail = body?.errors?.map((e) => e.message).filter(Boolean)[0];
    if (response.status === 401 || response.status === 403) {
      throw new CloudflareError(
        `Cloudflare refused the token${detail ? ` (${detail})` : ""}: make it again with the steps on this screen.`,
      );
    }
    throw new CloudflareError(`Cloudflare said: ${detail ?? response.statusText}`);
  }
  return body.result;
}

export type CloudflareCheck = {
  zoneId: string;
  /** What the ERP's own address points to now ("erp.extasbd.com → 20.1.2.3"), when it has an A record. */
  records: Array<{ name: string; content: string; proxied: boolean }>;
};

/**
 * The token works, sees this one domain and nothing else, and can read its DNS
 * records. Nothing is changed.
 */
export async function checkCloudflare(
  token: string,
  zone: string,
  names: string[],
): Promise<CloudflareCheck> {
  const verified = await cf<{ status?: string }>(token, "/user/tokens/verify");
  if (verified.status !== "active") {
    throw new CloudflareError("This Cloudflare token is not active: make a new one.");
  }
  const zones = await cf<Array<{ id: string; name: string }>>(token, "/zones?per_page=50");
  const mine = zones.find((z) => z.name === zone);
  if (!mine) {
    throw new CloudflareError(
      `This token cannot reach ${zone}: in step 6 pick "Specific zone" and ${zone}.`,
    );
  }
  if (zones.length > 1) {
    throw new CloudflareError(
      `This token can reach ${zones.length} domains: make one for ${zone} only (step 6, "Specific zone").`,
    );
  }
  const records: CloudflareCheck["records"] = [];
  for (const name of names) {
    const found = await cf<Array<{ name: string; content: string; proxied?: boolean }>>(
      token,
      `/zones/${encodeURIComponent(mine.id)}/dns_records?type=A&name=${encodeURIComponent(name)}`,
    );
    for (const r of found)
      records.push({ name: r.name, content: r.content, proxied: Boolean(r.proxied) });
  }
  return { zoneId: mine.id, records };
}

/** The ERP's own addresses (the live one and the demo site), from APP_URL. */
function siteNames(zone: string): string[] {
  try {
    const host = new URL(process.env.APP_URL ?? "").hostname;
    if (host === zone || host.endsWith(`.${zone}`)) {
      const demo = process.env.DEMO_DOMAIN?.trim() || `demo.${zone}`;
      return [host, demo];
    }
  } catch {
    // No APP_URL: nothing to look up.
  }
  return [];
}

const tokenOf = (config: BackupConfig) =>
  config.cloudflareTokenRef ? decryptSecret(config.cloudflareTokenRef) : null;

const asAppError = (error: unknown) =>
  error instanceof CloudflareError ? new AppError("UNAVAILABLE", error.message) : error;

/** Saves the domain and token (with the PIN), after Cloudflare says the token works. */
export async function setCloudflare(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = cloudflareSchema.parse(raw);
  const { requirePin } = await import("@/modules/ai/settings.service");
  await requirePin(ctx, input.pin, "save the Cloudflare token");
  let check: CloudflareCheck;
  try {
    check = await checkCloudflare(input.token, input.zone, siteNames(input.zone));
  } catch (error) {
    throw asAppError(error);
  }
  const config = await getBackupConfig();
  const updated = await prisma.backupConfig.update({
    where: { id: config.id },
    data: {
      cloudflareZone: input.zone,
      cloudflareZoneId: check.zoneId,
      cloudflareTokenRef: encryptSecret(input.token),
      cloudflareTokenHint: input.token.slice(-4),
      cloudflareCheckedAt: new Date(),
    },
  });
  await audit({ userId: ctx.user.id }, meta, {
    action: "UPDATE",
    entityType: "BackupConfig",
    entityId: config.id,
    summary: `Saved the Cloudflare token for ${input.zone} (ends ${input.token.slice(-4)}); Cloudflare accepted it`,
  });
  return { config: presentConfig(updated), records: check.records };
}

/** "Test": asks Cloudflare again with the saved token; changes nothing there. */
export async function testCloudflare(actor: { userId: string }, meta?: RequestMeta) {
  const config = await getBackupConfig();
  const token = tokenOf(config);
  if (!token || !config.cloudflareZone) {
    throw new AppError("CONFLICT", "Save the Cloudflare domain and token first.");
  }
  let check: CloudflareCheck;
  try {
    check = await checkCloudflare(token, config.cloudflareZone, siteNames(config.cloudflareZone));
  } catch (error) {
    throw asAppError(error);
  }
  const updated = await prisma.backupConfig.update({
    where: { id: config.id },
    data: { cloudflareZoneId: check.zoneId, cloudflareCheckedAt: new Date() },
  });
  await audit(actor, meta, {
    action: "UPDATE",
    entityType: "BackupConfig",
    entityId: config.id,
    summary: `Tested the Cloudflare token for ${config.cloudflareZone}: it works`,
  });
  return { config: presentConfig(updated), records: check.records };
}

/** Forgets the token (with the PIN): a new server then gets HTTPS the usual way (HTTP challenge). */
export async function clearCloudflare(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const { pin } = (raw ?? {}) as { pin?: string };
  const { requirePin } = await import("@/modules/ai/settings.service");
  await requirePin(ctx, typeof pin === "string" ? pin : undefined, "remove the Cloudflare token");
  const config = await getBackupConfig();
  const updated = await prisma.backupConfig.update({
    where: { id: config.id },
    data: {
      cloudflareZone: null,
      cloudflareZoneId: null,
      cloudflareTokenRef: null,
      cloudflareTokenHint: null,
      cloudflareCheckedAt: null,
    },
  });
  await audit({ userId: ctx.user.id }, meta, {
    action: "UPDATE",
    entityType: "BackupConfig",
    entityId: config.id,
    summary: `Removed the Cloudflare token${config.cloudflareZone ? ` for ${config.cloudflareZone}` : ""}`,
  });
  return presentConfig(updated);
}
