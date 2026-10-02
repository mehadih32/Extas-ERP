import { open, stat } from "node:fs/promises";
import path from "node:path";

import { AppError } from "@/lib/errors";

/*
 * Google Drive (Google One) for backups, over plain HTTPS. The platform owner
 * connects their own Google account once (OAuth, "drive.file" scope: the app can
 * only see the files it creates), so backups use that account's storage. A
 * service account cannot be used: it has no storage of its own on personal Drive.
 *   connect     authorizationUrl -> Google consent -> exchangeCode (refresh token)
 *   each backup accessToken -> createFolder -> uploadFile (resumable, in chunks)
 *   retention   listOldFolders -> deleteFile
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER = "application/vnd.google-apps.folder";
/** Upload chunks must be multiples of 256 KiB. */
const CHUNK_BYTES = 32 * 256 * 1024;

type OAuthClient = { clientId: string; clientSecret: string; redirectUri: string };

export function driveConfigured(): boolean {
  return Boolean(process.env.GOOGLE_DRIVE_CLIENT_ID && process.env.GOOGLE_DRIVE_CLIENT_SECRET);
}

function oauthClient(): OAuthClient {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new AppError(
      "UNAVAILABLE",
      "Google Drive is not set up on the server (GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET).",
    );
  }
  const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
  return { clientId, clientSecret, redirectUri: `${appUrl}/api/backups/google/callback` };
}

/** The address Google sends the owner back to; it must be listed in the Google Cloud console. */
export function redirectUri(): string {
  return oauthClient().redirectUri;
}

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

/** Google's consent page; `state` comes back unchanged to the callback. */
export function authorizationUrl(state: string): string {
  const { clientId, redirectUri: redirect } = oauthClient();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: "code",
    scope: SCOPE,
    // A refresh token, every time (so reconnecting replaces a revoked one).
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

async function tokenRequest(form: Record<string, string>, what: string) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  if (!response.ok) throw await failure(response, what);
  return (await response.json()) as { access_token: string; refresh_token?: string };
}

/** Exchanges the code from the consent page for a long-lived refresh token. */
export async function exchangeCode(code: string) {
  const client = oauthClient();
  const tokens = await tokenRequest(
    {
      code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: client.redirectUri,
      grant_type: "authorization_code",
    },
    "Google sign-in failed",
  );
  if (!tokens.refresh_token) {
    throw new DriveError("Google did not return a refresh token; connect again.", 400, true);
  }
  return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token };
}

/** A fresh access token (valid about an hour) from the stored refresh token. */
export async function accessToken(refreshToken: string): Promise<string> {
  const client = oauthClient();
  const tokens = await tokenRequest(
    {
      refresh_token: refreshToken,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      grant_type: "refresh_token",
    },
    "Google Drive access failed",
  );
  return tokens.access_token;
}

/** Best effort: tells Google to forget the app's access. */
export async function revoke(refreshToken: string): Promise<void> {
  try {
    await fetch(`${REVOKE_URL}?token=${encodeURIComponent(refreshToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  } catch {
    // Disconnecting still forgets the token on our side.
  }
}

async function api<T>(token: string, url: string, init: RequestInit, what: string): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  if (!response.ok) throw await failure(response, what);
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

/** The connected account's email address. */
export async function accountEmail(token: string): Promise<string | null> {
  const about = await api<{ user?: { emailAddress?: string } }>(
    token,
    `${API}/about?fields=user(emailAddress)`,
    { method: "GET" },
    "Reading the Google account failed",
  );
  return about.user?.emailAddress ?? null;
}

export async function createFolder(token: string, name: string, parentId?: string) {
  return api<{ id: string; name: string }>(
    token,
    `${API}/files?fields=id,name`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({
        name,
        mimeType: FOLDER,
        ...(parentId ? { parents: [parentId] } : {}),
      }),
    },
    "Creating the Drive folder failed",
  );
}

/** Whether a folder the app created still exists (not deleted or in the bin). */
export async function folderExists(token: string, folderId: string): Promise<boolean> {
  const response = await fetch(`${API}/files/${encodeURIComponent(folderId)}?fields=id,trashed`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 404) return false;
  if (!response.ok) throw await failure(response, "Checking the Drive folder failed");
  const file = (await response.json()) as { trashed?: boolean };
  return !file.trashed;
}

/** Uploads a file from disk in resumable chunks, so large dumps survive slow links. */
export async function uploadFile(
  token: string,
  filePath: string,
  folderId: string,
  mimeType = "application/octet-stream",
): Promise<{ id: string }> {
  const { size } = await stat(filePath);
  const start = await fetch(`${UPLOAD_API}/files?uploadType=resumable&fields=id`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": mimeType,
      "X-Upload-Content-Length": String(size),
    },
    body: JSON.stringify({ name: path.basename(filePath), parents: [folderId] }),
  });
  if (!start.ok) throw await failure(start, `Uploading ${path.basename(filePath)} failed`);
  const session = start.headers.get("location");
  if (!session) throw new DriveError("Google Drive did not open an upload session.", 502);

  if (size === 0) {
    const done = await fetch(session, { method: "PUT", headers: { "Content-Range": "bytes */0" } });
    if (!done.ok) throw await failure(done, `Uploading ${path.basename(filePath)} failed`);
    return (await done.json()) as { id: string };
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
      if (!response.ok)
        throw await failure(response, `Uploading ${path.basename(filePath)} failed`);
      return (await response.json()) as { id: string };
    }
    throw new DriveError(`Uploading ${path.basename(filePath)} did not finish.`, 502);
  } finally {
    await file.close();
  }
}

/** Run folders inside the backup folder created before `before`. */
export async function listOldFolders(token: string, parentId: string, before: Date) {
  const q = [
    `'${parentId.replace(/'/g, "")}' in parents`,
    "trashed = false",
    `mimeType = '${FOLDER}'`,
    `createdTime < '${before.toISOString()}'`,
  ].join(" and ");
  const result = await api<{ files?: Array<{ id: string; name: string; createdTime: string }> }>(
    token,
    `${API}/files?${new URLSearchParams({ q, fields: "files(id,name,createdTime)", pageSize: "200" })}`,
    { method: "GET" },
    "Listing old Drive backups failed",
  );
  return result.files ?? [];
}

/** Deletes a file or folder the app created (a folder goes with everything in it). */
export async function deleteFile(token: string, fileId: string): Promise<void> {
  const response = await fetch(`${API}/files/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok && response.status !== 404) {
    throw await failure(response, "Deleting an old Drive backup failed");
  }
}
