/**
 * A stand-in for Google's sign-in (device codes) and Drive, in memory, for the
 * backup tests and the restore drill (.github/workflows/restore-drill.yml). It
 * answers the calls src/modules/backups/google-drive.ts makes, at the addresses
 * GOOGLE_OAUTH_BASE and GOOGLE_DRIVE_BASE point to. Never used by the ERP itself.
 *   npx tsx scripts/fake-google.ts 9400   serves on port 9400 until stopped
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export type FakeFile = {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  appProperties: Record<string, string>;
  createdTime: string;
  trashed: boolean;
  data: Buffer | null;
};

export type FakeGoogleOptions = {
  /** Polls answered "authorization_pending" before the owner's phone says yes. */
  pendingPolls?: number;
  /** The owner says no on their phone. */
  deny?: boolean;
  /** Uploads fail as when the Drive is full. */
  quotaFull?: boolean;
  /** One byte of every upload is changed on the way (the check must catch it). */
  damageUploads?: boolean;
  email?: string;
};

export type FakeGoogle = {
  url: string;
  files: Map<string, FakeFile>;
  options: FakeGoogleOptions;
  /** Refresh tokens Google still honours (taking one out = access revoked). */
  refreshTokens: Set<string>;
  requests: string[];
  close: () => Promise<void>;
};

const FOLDER = "application/vnd.google-apps.folder";

function read(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function present(file: FakeFile, fields: string | null) {
  const all: Record<string, unknown> = {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    parents: file.parents,
    appProperties: file.appProperties,
    createdTime: file.createdTime,
    trashed: file.trashed,
    ...(file.data
      ? {
          size: String(file.data.length),
          md5Checksum: createHash("md5").update(file.data).digest("hex"),
        }
      : {}),
  };
  if (!fields) return all;
  const wanted = fields
    .replace(/^files\(|\)$/g, "")
    .split(",")
    .map((f) => f.trim());
  return Object.fromEntries(Object.entries(all).filter(([k]) => wanted.includes(k)));
}

/** The few Drive search terms the ERP uses, joined by "and". */
function matches(file: FakeFile, q: string): boolean {
  return q.split(/\s+and\s+(?![^{]*})/).every((term) => {
    let m: RegExpMatchArray | null;
    if ((m = term.match(/^'([^']*)' in parents$/))) return file.parents.includes(m[1]!);
    if (term === "trashed = false") return !file.trashed;
    if ((m = term.match(/^mimeType = '([^']*)'$/))) return file.mimeType === m[1];
    if ((m = term.match(/^name = '([^']*)'$/))) return file.name === m[1];
    if ((m = term.match(/^createdTime < '([^']*)'$/))) return file.createdTime < m[1]!;
    if ((m = term.match(/^appProperties has \{ key='([^']*)' and value='([^']*)' \}$/))) {
      return file.appProperties[m[1]!] === m[2];
    }
    throw new Error(`fake Google: unknown search term ${term}`);
  });
}

export async function startFakeGoogle(
  options: FakeGoogleOptions = {},
  port = 0,
): Promise<FakeGoogle> {
  const files = new Map<string, FakeFile>();
  const devices = new Map<string, { polls: number }>();
  const accessTokens = new Set<string>();
  const refreshTokens = new Set<string>();
  const sessions = new Map<string, { meta: Partial<FakeFile>; size: number; data: Buffer }>();
  const requests: string[] = [];
  let next = 0;
  let base = "";
  const newId = (prefix: string) => `${prefix}${++next}${randomBytes(3).toString("hex")}`;

  const authorized = (req: IncomingMessage) =>
    accessTokens.has((req.headers.authorization ?? "").replace(/^Bearer /, ""));

  const descendants = (id: string): string[] => [
    id,
    ...[...files.values()].filter((f) => f.parents.includes(id)).flatMap((f) => descendants(f.id)),
  ];

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", base);
    const method = req.method ?? "GET";
    requests.push(`${method} ${url.pathname}`);
    const body = await read(req);
    const form = () => Object.fromEntries(new URLSearchParams(body.toString()));

    // --- sign-in -----------------------------------------------------------------
    if (method === "POST" && url.pathname === "/device/code") {
      const { client_id: client, scope } = form();
      if (!client) return json(res, 401, { error: "invalid_client" });
      if (scope !== "https://www.googleapis.com/auth/drive.file") {
        return json(res, 400, { error: "invalid_scope" });
      }
      const code = newId("device-");
      devices.set(code, { polls: 0 });
      return json(res, 200, {
        device_code: code,
        user_code: "ABCD-EFGH",
        verification_url: "https://www.google.com/device",
        expires_in: 1800,
        interval: 1,
      });
    }
    if (method === "POST" && url.pathname === "/token") {
      const f = form();
      if (f.grant_type === "urn:ietf:params:oauth:grant-type:device_code") {
        const device = devices.get(f.device_code ?? "");
        if (!device) return json(res, 400, { error: "expired_token" });
        if (options.deny) return json(res, 403, { error: "access_denied" });
        if (device.polls++ < (options.pendingPolls ?? 0)) {
          return json(res, 428, { error: "authorization_pending" });
        }
        devices.delete(f.device_code!);
        const access = newId("access-");
        const refresh = newId("refresh-");
        accessTokens.add(access);
        refreshTokens.add(refresh);
        return json(res, 200, { access_token: access, refresh_token: refresh, expires_in: 3599 });
      }
      if (f.grant_type === "refresh_token") {
        if (!refreshTokens.has(f.refresh_token ?? "")) {
          return json(res, 400, {
            error: "invalid_grant",
            error_description: "Token has been expired or revoked.",
          });
        }
        const access = newId("access-");
        accessTokens.add(access);
        return json(res, 200, { access_token: access, expires_in: 3599 });
      }
      return json(res, 400, { error: "unsupported_grant_type" });
    }
    if (method === "POST" && url.pathname === "/revoke") {
      refreshTokens.delete(url.searchParams.get("token") ?? "");
      return json(res, 200, {});
    }

    // --- Drive -------------------------------------------------------------------
    if (url.pathname.startsWith("/upload/session/")) {
      const session = sessions.get(url.pathname.split("/").pop()!);
      if (!session) return json(res, 404, { error: { message: "Upload session not found" } });
      const range = String(req.headers["content-range"] ?? "");
      const m = range.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
      if (m) {
        if (Number(m[1]) !== session.data.length) {
          return json(res, 400, { error: { message: "Out of order" } });
        }
        session.data = Buffer.concat([session.data, body]);
      }
      if (session.data.length < session.size) {
        res.writeHead(308, { range: `bytes=0-${session.data.length - 1}` });
        return res.end();
      }
      const data = Buffer.from(session.data);
      if (options.damageUploads && data.length > 0) data[data.length >> 1]! ^= 0xff;
      const file: FakeFile = {
        id: newId("file-"),
        name: session.meta.name ?? "untitled",
        mimeType: session.meta.mimeType ?? "application/octet-stream",
        parents: session.meta.parents ?? [],
        appProperties: session.meta.appProperties ?? {},
        createdTime: new Date().toISOString(),
        trashed: false,
        data,
      };
      files.set(file.id, file);
      sessions.delete(url.pathname.split("/").pop()!);
      return json(res, 200, present(file, url.searchParams.get("fields")));
    }
    if (!authorized(req)) {
      return json(res, 401, {
        error: { message: "Request had invalid authentication credentials." },
      });
    }
    if (method === "GET" && url.pathname === "/drive/v3/about") {
      return json(res, 200, { user: { emailAddress: options.email ?? "owner@gmail.com" } });
    }
    if (method === "POST" && url.pathname === "/upload/drive/v3/files") {
      if (options.quotaFull) {
        return json(res, 403, {
          error: { message: "The user's Drive storage quota has been exceeded." },
        });
      }
      const meta = JSON.parse(body.toString() || "{}") as Partial<FakeFile>;
      const sid = newId("s");
      sessions.set(sid, {
        meta,
        size: Number(req.headers["x-upload-content-length"] ?? 0),
        data: Buffer.alloc(0),
      });
      res.writeHead(200, {
        location: `${base}/upload/session/${sid}?fields=${url.searchParams.get("fields") ?? ""}`,
      });
      return res.end();
    }
    if (method === "POST" && url.pathname === "/drive/v3/files") {
      const meta = JSON.parse(body.toString() || "{}") as Partial<FakeFile>;
      const file: FakeFile = {
        id: newId(meta.mimeType === FOLDER ? "folder-" : "file-"),
        name: meta.name ?? "untitled",
        mimeType: meta.mimeType ?? "application/octet-stream",
        parents: meta.parents ?? [],
        appProperties: meta.appProperties ?? {},
        createdTime: new Date().toISOString(),
        trashed: false,
        data: meta.mimeType === FOLDER ? null : Buffer.alloc(0),
      };
      files.set(file.id, file);
      return json(res, 200, present(file, url.searchParams.get("fields")));
    }
    if (method === "GET" && url.pathname === "/drive/v3/files") {
      const q = url.searchParams.get("q") ?? "";
      const found = [...files.values()]
        .filter((f) => matches(f, q))
        .sort((a, b) => a.createdTime.localeCompare(b.createdTime) || a.id.localeCompare(b.id));
      const fields = url.searchParams.get("fields");
      return json(res, 200, { files: found.map((f) => present(f, fields)) });
    }
    const id = decodeURIComponent(url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/)?.[1] ?? "");
    const file = id ? files.get(id) : undefined;
    if (id && !file) return json(res, 404, { error: { message: `File not found: ${id}.` } });
    if (file && method === "GET") {
      if (url.searchParams.get("alt") === "media") {
        res.writeHead(200, { "content-type": "application/octet-stream" });
        return res.end(file.data ?? Buffer.alloc(0));
      }
      return json(res, 200, present(file, url.searchParams.get("fields")));
    }
    if (file && method === "PATCH") {
      const change = JSON.parse(body.toString() || "{}") as Partial<FakeFile>;
      if (change.appProperties) Object.assign(file.appProperties, change.appProperties);
      if (change.name) file.name = change.name;
      return json(res, 200, present(file, url.searchParams.get("fields")));
    }
    if (file && method === "DELETE") {
      for (const gone of descendants(file.id)) files.delete(gone);
      res.writeHead(204);
      return res.end();
    }
    return json(res, 404, { error: { message: `fake Google: no ${method} ${url.pathname}` } });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) =>
      json(res, 500, { error: { message: String(error) } }),
    );
  });
  await new Promise<void>((resolve) => server.listen(port, "0.0.0.0", resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : port}`;
  return {
    url: base,
    files,
    options,
    refreshTokens,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

if (process.argv[1]?.endsWith("fake-google.ts")) {
  const port = Number(process.argv[2] ?? 9400);
  void startFakeGoogle({}, port).then((g) => console.log(`fake Google at ${g.url}`));
}
