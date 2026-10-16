import { createWriteStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/*
 * Google Drive for backups, over plain HTTPS. The owner makes one Google Cloud
 * client of the type "TVs and Limited Input devices" (Backups screen, "Google
 * setup") and signs in once with a code on their phone: the same client then
 * works on this server and on a new one (deploy/bootstrap.sh), with no return
 * address to register. The "drive.file" scope lets the ERP see only the files it
 * made itself, in the owner's own Drive storage.
 *   connect     startDeviceSignIn -> the owner enters the code -> pollDeviceSignIn
 *   each backup accessToken -> createFolder -> uploadFile -> fileInfo (the check)
 *   restoring   listFolders -> listFiles -> downloadFile
 * GOOGLE_OAUTH_BASE and GOOGLE_DRIVE_BASE are only changed by the tests and the
 * restore drill, which use a stand-in for Google (scripts/fake-google.ts).
 */

const oauthBase = () =>
  (process.env.GOOGLE_OAUTH_BASE || "https://oauth2.googleapis.com").replace(/\/+$/, "");
const driveBase = () =>
  (process.env.GOOGLE_DRIVE_BASE || "https://www.googleapis.com").replace(/\/+$/, "");
const api = () => `${driveBase()}/drive/v3`;
const uploadApi = () => `${driveBase()}/upload/drive/v3`;
export const SCOPE = "https://www.googleapis.com/auth/drive.file";
export const FOLDER = "application/vnd.google-apps.folder";
/** Upload pieces must be multiples of 256 KiB. */
const CHUNK_BYTES = 32 * 256 * 1024;

export type GoogleClient = { clientId: string; clientSecret: string };

export class DriveError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The connection itself is gone (revoked or expired): the owner must connect again. */
    readonly reconnect = false,
  ) {
    super(message);
    this.name = "DriveError";
  }
}

async function failure(response: Response, what: string): Promise<DriveError> {
  let detail = response.statusText;
  try {
    const body = (await response.json()) as {
      error?: string | { message?: string };
      error_description?: string;
    };
    detail =
      body.error_description ??
      (typeof body.error === "string" ? body.error : body.error?.message) ??
      detail;
  } catch {
    // Not JSON; keep the status text.
  }
  const reconnect = detail === "invalid_grant" || /revoked|expired/i.test(detail);
  return new DriveError(`${what}: ${detail} (HTTP ${response.status})`, response.status, reconnect);
}

async function form(url: string, fields: Record<string, string>) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
}

// =============================================================================
// Signing in with a code on the owner's phone
// =============================================================================

export type DeviceSignIn = {
  deviceCode: string;
  /** What the owner types on the Google page ("ABCD-EFGH"). */
  userCode: string;
  /** The Google page to open on a phone (https://www.google.com/device). */
  verificationUrl: string;
  expiresAt: Date;
  /** Seconds to wait between asks. */
  interval: number;
};

/** Starts a sign-in: a code the owner enters at Google's device page. */
export async function startDeviceSignIn(client: GoogleClient): Promise<DeviceSignIn> {
  const response = await form(`${oauthBase()}/device/code`, {
    client_id: client.clientId,
    scope: SCOPE,
  });
  if (!response.ok) {
    const error = await failure(response, "Google did not give a sign-in code");
    if (/invalid_client|unauthorized_client/.test(error.message)) {
      throw new DriveError(
        'Google did not accept this client. It must be an OAuth client of the type "TVs and Limited Input devices" (Backups screen, Google setup).',
        error.status,
      );
    }
    throw error;
  }
  const body = (await response.json()) as {
    device_code: string;
    user_code: string;
    verification_url?: string;
    verification_uri?: string;
    expires_in: number;
    interval?: number;
  };
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUrl:
      body.verification_url ?? body.verification_uri ?? "https://www.google.com/device",
    expiresAt: new Date(Date.now() + body.expires_in * 1000),
    interval: body.interval ?? 5,
  };
}

export type DevicePoll =
  | { status: "waiting" }
  | { status: "denied" }
  | { status: "expired" }
  | { status: "connected"; accessToken: string; refreshToken: string };

/** Asks Google whether the owner has said yes on their phone yet. */
export async function pollDeviceSignIn(
  client: GoogleClient,
  deviceCode: string,
): Promise<DevicePoll> {
  const response = await form(`${oauthBase()}/token`, {
    client_id: client.clientId,
    client_secret: client.clientSecret,
    device_code: deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    access_token?: string;
    refresh_token?: string;
  };
  if (response.ok && body.access_token) {
    if (!body.refresh_token) {
      throw new DriveError("Google did not return a refresh token; connect again.", 400, true);
    }
    return {
      status: "connected",
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
    };
  }
  if (body.error === "authorization_pending" || body.error === "slow_down")
    return { status: "waiting" };
  if (body.error === "access_denied") return { status: "denied" };
  if (body.error === "expired_token") return { status: "expired" };
  throw new DriveError(
    `Google sign-in failed: ${body.error ?? response.statusText}`,
    response.status,
  );
}

/** A fresh access token (valid about an hour) from the stored refresh token. */
export async function accessToken(client: GoogleClient, refreshToken: string): Promise<string> {
  const response = await form(`${oauthBase()}/token`, {
    refresh_token: refreshToken,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    grant_type: "refresh_token",
  });
  if (!response.ok) throw await failure(response, "Google Drive access failed");
  return ((await response.json()) as { access_token: string }).access_token;
}

/** Best effort: tells Google to forget the ERP's access. */
export async function revoke(refreshToken: string): Promise<void> {
  try {
    await fetch(`${oauthBase()}/revoke?token=${encodeURIComponent(refreshToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  } catch {
    // Disconnecting still forgets the token on our side.
  }
}

// =============================================================================
// Drive
// =============================================================================

async function call<T>(token: string, url: string, init: RequestInit, what: string): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  if (!response.ok) throw await failure(response, what);
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export type DriveFile = {
  id: string;
  name: string;
  createdTime?: string;
  size?: string;
  md5Checksum?: string;
  appProperties?: Record<string, string>;
};

const FILE_FIELDS = "id,name,createdTime,size,md5Checksum,appProperties";

/** The signed-in account's email address. */
export async function accountEmail(token: string): Promise<string | null> {
  const about = await call<{ user?: { emailAddress?: string } }>(
    token,
    `${api()}/about?fields=user(emailAddress)`,
    { method: "GET" },
    "Reading the Google account failed",
  );
  return about.user?.emailAddress ?? null;
}

export async function createFolder(
  token: string,
  name: string,
  parentId?: string,
  appProperties?: Record<string, string>,
) {
  return call<DriveFile>(
    token,
    `${api()}/files?fields=${FILE_FIELDS}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({
        name,
        mimeType: FOLDER,
        ...(parentId ? { parents: [parentId] } : {}),
        ...(appProperties ? { appProperties } : {}),
      }),
    },
    "Creating the Drive folder failed",
  );
}

/** Whether a folder the ERP made still exists (not deleted or in the bin). */
export async function folderExists(token: string, folderId: string): Promise<boolean> {
  const response = await fetch(`${api()}/files/${encodeURIComponent(folderId)}?fields=id,trashed`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 404) return false;
  if (!response.ok) throw await failure(response, "Checking the Drive folder failed");
  const file = (await response.json()) as { trashed?: boolean };
  return !file.trashed;
}

/** A file's name, size, MD5 and labels, as Drive has them. */
export async function fileInfo(token: string, fileId: string): Promise<DriveFile> {
  return call<DriveFile>(
    token,
    `${api()}/files/${encodeURIComponent(fileId)}?fields=${FILE_FIELDS}`,
    { method: "GET" },
    "Reading a Drive file failed",
  );
}

/** Adds labels to a file or folder (the ERP's own, invisible in Drive). */
export async function label(token: string, fileId: string, appProperties: Record<string, string>) {
  await call<DriveFile>(
    token,
    `${api()}/files/${encodeURIComponent(fileId)}?fields=id`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ appProperties }),
    },
    "Labelling a Drive file failed",
  );
}

async function search(token: string, q: string, what: string): Promise<DriveFile[]> {
  const result = await call<{ files?: DriveFile[] }>(
    token,
    `${api()}/files?${new URLSearchParams({ q, fields: `files(${FILE_FIELDS})`, pageSize: "1000", orderBy: "createdTime" })}`,
    { method: "GET" },
    what,
  );
  return result.files ?? [];
}

const quoted = (id: string) => `'${id.replace(/['\\]/g, "")}'`;

/** Folders the ERP made with this label (the backup folder itself, on a new server). */
export async function findFolders(token: string, key: string, value: string) {
  return search(
    token,
    [
      `appProperties has { key=${quoted(key)} and value=${quoted(value)} }`,
      "trashed = false",
      `mimeType = '${FOLDER}'`,
    ].join(" and "),
    "Looking for the backup folder in Drive failed",
  );
}

/** The folders inside a folder, oldest first. */
export async function listFolders(token: string, parentId: string) {
  return search(
    token,
    [`${quoted(parentId)} in parents`, "trashed = false", `mimeType = '${FOLDER}'`].join(" and "),
    "Listing the backups in Drive failed",
  );
}

/** The files inside a folder. */
export async function listFiles(token: string, folderId: string) {
  return search(
    token,
    [`${quoted(folderId)} in parents`, "trashed = false"].join(" and "),
    "Listing a backup's files in Drive failed",
  );
}

/** Uploads a file from disk in resumable pieces, so large dumps survive slow links. */
export async function uploadFile(
  token: string,
  filePath: string,
  folderId: string,
  mimeType = "application/octet-stream",
): Promise<DriveFile> {
  const name = path.basename(filePath);
  const { size } = await stat(filePath);
  const start = await fetch(`${uploadApi()}/files?uploadType=resumable&fields=${FILE_FIELDS}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": mimeType,
      "X-Upload-Content-Length": String(size),
    },
    body: JSON.stringify({ name, parents: [folderId] }),
  });
  if (!start.ok) throw await failure(start, `Uploading ${name} failed`);
  const session = start.headers.get("location");
  if (!session) throw new DriveError("Google Drive did not open an upload session.", 502);

  if (size === 0) {
    const done = await fetch(session, { method: "PUT", headers: { "Content-Range": "bytes */0" } });
    if (!done.ok) throw await failure(done, `Uploading ${name} failed`);
    return (await done.json()) as DriveFile;
  }

  const file = await open(filePath, "r");
  try {
    let offset = 0;
    const buffer = Buffer.alloc(Math.min(CHUNK_BYTES, size));
    while (offset < size) {
      const { bytesRead } = await file.read(
        buffer,
        0,
        Math.min(buffer.length, size - offset),
        offset,
      );
      const end = offset + bytesRead - 1;
      const response = await fetch(session, {
        method: "PUT",
        headers: {
          "Content-Length": String(bytesRead),
          "Content-Range": `bytes ${offset}-${end}/${size}`,
        },
        body: new Uint8Array(buffer.subarray(0, bytesRead)),
      });
      if (response.status === 308) {
        // Google says how much it has; carry on from there.
        const range = response.headers.get("range");
        offset = range ? Number(range.split("-")[1]) + 1 : end + 1;
        continue;
      }
      if (!response.ok) throw await failure(response, `Uploading ${name} failed`);
      return (await response.json()) as DriveFile;
    }
    throw new DriveError(`Uploading ${name} did not finish.`, 502);
  } finally {
    await file.close();
  }
}

/** Downloads a file to disk. */
export async function downloadFile(token: string, fileId: string, to: string): Promise<void> {
  const response = await fetch(`${api()}/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok || !response.body)
    throw await failure(response, "Downloading from Drive failed");
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(to));
}

/** Deletes a file or folder the ERP made (a folder goes with everything in it). */
export async function deleteFile(token: string, fileId: string): Promise<void> {
  const response = await fetch(`${api()}/files/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok && response.status !== 404) {
    throw await failure(response, "Deleting an old Drive backup failed");
  }
}
