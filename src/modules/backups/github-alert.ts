import { decryptSecret } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { sealedBox } from "@/lib/sealed-box";
import { ownersLinks } from "@/modules/ai/bot/push";
import type { CompanyContext } from "@/modules/auth/context";
import { audit, getBackupConfig, googleClient } from "@/modules/backups/backup-core";
import { githubAlertSchema } from "@/modules/backups/schemas";
import { platformCompanyId } from "@/modules/bug-guard/security";

/*
 * The late-backup alert on GitHub (v6.4.1, A13): .github/workflows/backup-watch.yml
 * looks at the newest backup in Google Drive every 6 hours and tells the owner on
 * Telegram when it is late, so the owner hears even when this server is down.
 *
 * It needs the ERP's Google sign-in for Drive and the Telegram bot as GitHub
 * repository secrets. Those are never shown on a screen: with the PIN and a
 * GitHub token made for this one step ("Secrets: Read and write" on the
 * repository), the ERP locks each value to the repository's own public key
 * (libsodium's sealed box, src/lib/sealed-box.ts: only GitHub Actions can open
 * it) and sends it to GitHub itself. The token is used for this and forgotten;
 * nothing of the values is kept or logged here, only the repository and when.
 * A restore drill copy (test mode) or a copy on standby never does it: it holds the
 * real ERP's sign-ins and would overwrite the repository's secrets (like
 * github/github.ts, it refuses).
 * GITHUB_API_URL points the calls elsewhere in tests.
 */

const API = () => (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");

/** The repository secrets the workflow reads (scripts/backup-watch.mjs). */
export const ALERT_SECRETS = [
  "BACKUP_ALERT_GOOGLE_CLIENT_ID",
  "BACKUP_ALERT_GOOGLE_CLIENT_SECRET",
  "BACKUP_ALERT_GOOGLE_REFRESH_TOKEN",
  "BACKUP_ALERT_DRIVE_FOLDER_ID",
  "BACKUP_ALERT_TELEGRAM_BOT_TOKEN",
  "BACKUP_ALERT_TELEGRAM_CHAT_ID",
] as const;
type AlertSecret = (typeof ALERT_SECRETS)[number];

async function github(
  token: string,
  repo: string,
  method: "GET" | "PUT",
  path: string,
  body?: unknown,
) {
  // A restore drill copy (test mode) or a copy on standby only reads: it never sets a secret.
  if (method !== "GET") await refuseOnDrill();
  let response: Response;
  try {
    response = await fetch(`${API()}/repos/${repo}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Extas-ERP",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new AppError("UNAVAILABLE", "GitHub could not be reached. Try again in a minute.");
  }
  if (response.ok) return response.status === 204 ? null : ((await response.json()) as unknown);
  if (response.status === 401) {
    throw new AppError(
      "VALIDATION",
      "GitHub refused the token (wrong or expired): make a new one.",
      {
        token: ["GitHub refused this token"],
      },
    );
  }
  if (response.status === 403 || response.status === 404) {
    throw new AppError(
      "VALIDATION",
      `This token cannot set the secrets of ${repo}: make it for that repository with "Secrets: Read and write".`,
      { token: ["This token cannot set the repository's secrets"] },
    );
  }
  throw new AppError("UNAVAILABLE", `GitHub answered ${response.status}. Try again in a minute.`);
}

async function refuseOnDrill() {
  const { DRILL_NOT_SENT, onDrill, onStandby, STANDBY_NOT_DONE } =
    await import("@/modules/backups/standby");
  if (await onDrill()) throw new AppError("UNAVAILABLE", DRILL_NOT_SENT);
  if (await onStandby()) throw new AppError("UNAVAILABLE", STANDBY_NOT_DONE);
}

/** Everything the alert needs from this ERP, or a plain reason what to set up first. */
async function alertValues(): Promise<Record<AlertSecret, string>> {
  const config = await getBackupConfig();
  const client = googleClient(config);
  if (!client || !config.credentialsRef) {
    throw new AppError(
      "VALIDATION",
      "Connect Google Drive first (Google Drive, on this screen): the alert reads the backups there.",
    );
  }
  const platform = await platformCompanyId();
  const link = platform
    ? await prisma.aiBotLink.findFirst({
        where: {
          companyId: platform,
          channel: "TELEGRAM",
          linkedAt: { not: null },
          chatId: { not: null },
          ...ownersLinks(platform),
        },
        select: { tokenSealed: true, chatId: true },
      })
    : null;
  if (!link?.chatId) {
    throw new AppError(
      "VALIDATION",
      "Link the Telegram bot to your own chat first (AI > Bot): the alert is sent there.",
    );
  }
  return {
    BACKUP_ALERT_GOOGLE_CLIENT_ID: client.clientId,
    BACKUP_ALERT_GOOGLE_CLIENT_SECRET: client.clientSecret,
    BACKUP_ALERT_GOOGLE_REFRESH_TOKEN: decryptSecret(config.credentialsRef),
    BACKUP_ALERT_DRIVE_FOLDER_ID: config.googleDriveFolderId ?? "",
    BACKUP_ALERT_TELEGRAM_BOT_TOKEN: decryptSecret(link.tokenSealed),
    BACKUP_ALERT_TELEGRAM_CHAT_ID: link.chatId,
  };
}

/**
 * "Set up the alert on GitHub" (the platform owner, with the PIN): sends the
 * alert's values to the repository's secrets, each locked to the repository's
 * public key. Run it again after connecting Google Drive or the bot again.
 */
export async function setUpGitHubAlert(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  if (!ctx.user.isSuperAdmin) {
    throw new AppError("FORBIDDEN", "Only the platform owner sets up the backup alert.");
  }
  const input = githubAlertSchema.parse(raw);
  await refuseOnDrill();
  const { requirePin } = await import("@/modules/ai/settings.service");
  await requirePin(ctx, input.pin, "send the backup alert's settings to GitHub");
  const values = await alertValues();

  const key = (await github(input.token, input.repo, "GET", "/actions/secrets/public-key")) as {
    key_id?: string;
    key?: string;
  } | null;
  const publicKey = key?.key ? new Uint8Array(Buffer.from(key.key, "base64")) : null;
  if (!key?.key_id || !publicKey || publicKey.length !== 32) {
    throw new AppError(
      "UNAVAILABLE",
      "GitHub did not give the repository's key. Try again in a minute.",
    );
  }
  const sent: AlertSecret[] = [];
  for (const name of ALERT_SECRETS) {
    const value = values[name];
    if (!value) continue;
    const sealed = sealedBox(new TextEncoder().encode(value), publicKey);
    await github(input.token, input.repo, "PUT", `/actions/secrets/${name}`, {
      encrypted_value: Buffer.from(sealed).toString("base64"),
      key_id: key.key_id,
    });
    sent.push(name);
  }

  const config = await getBackupConfig();
  const at = new Date();
  await prisma.backupConfig.update({
    where: { id: config.id },
    data: { githubAlertRepo: input.repo, githubAlertAt: at },
  });
  await audit({ userId: ctx.user.id }, meta, {
    action: "UPDATE",
    entityType: "BackupConfig",
    entityId: config.id,
    summary: `Set up the late-backup alert on GitHub (${input.repo}): sent ${sent.length} secrets, each locked to the repository's key; the GitHub token used was not kept`,
  });
  return { repo: input.repo, setAt: at, secrets: sent };
}
