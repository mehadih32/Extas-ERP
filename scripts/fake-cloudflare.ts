/**
 * A stand-in for Cloudflare's API, in memory, for the backup tests and the
 * restore proof on a fresh server (deploy/restore-tool.py points at it with
 * CLOUDFLARE_API_BASE). It answers the calls src/modules/backups/cloudflare.ts
 * and the restore tool make. Never used by the ERP itself.
 *   npx tsx scripts/fake-cloudflare.ts 9500 <token> <zone>   serves until stopped
 */
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export type FakeRecord = {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
  ttl: number;
};

export type FakeCloudflare = {
  url: string;
  /** token -> the zones it can reach (empty: an inactive token). */
  tokens: Map<string, string[]>;
  zones: Map<string, { id: string; name: string; records: FakeRecord[] }>;
  requests: string[];
  close: () => Promise<void>;
};

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const ok = (res: ServerResponse, result: unknown) =>
  json(res, 200, { success: true, errors: [], messages: [], result });
const refuse = (res: ServerResponse, status: number, message: string) =>
  json(res, status, { success: false, errors: [{ code: status, message }], result: null });

export async function startFakeCloudflare(
  setup: { zones: string[]; tokens: Record<string, string[]> },
  port = 0,
): Promise<FakeCloudflare> {
  const zones = new Map<string, { id: string; name: string; records: FakeRecord[] }>();
  for (const name of setup.zones) {
    zones.set(name, { id: randomBytes(16).toString("hex"), name, records: [] });
  }
  const tokens = new Map(Object.entries(setup.tokens));
  const requests: string[] = [];

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://fake");
      const method = req.method ?? "GET";
      requests.push(`${method} ${url.pathname}${url.search}`);
      const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      const reach = tokens.get(token);
      if (!reach) return refuse(res, 401, "Invalid API Token");
      const path = url.pathname.replace(/^\/client\/v4/, "");
      if (method === "GET" && path === "/user/tokens/verify") {
        return ok(res, { id: "t1", status: reach.length ? "active" : "disabled" });
      }
      const visible = [...zones.values()].filter((z) => reach.includes(z.name));
      if (method === "GET" && path === "/zones") {
        const name = url.searchParams.get("name");
        return ok(
          res,
          visible.filter((z) => !name || z.name === name).map((z) => ({ id: z.id, name: z.name })),
        );
      }
      const m = path.match(/^\/zones\/([^/]+)\/dns_records(?:\/([^/]+))?$/);
      const zone = m ? visible.find((z) => z.id === m[1]) : undefined;
      if (!m || !zone) return refuse(res, 404, `fake Cloudflare: no ${method} ${path}`);
      const body = chunks.length
        ? (JSON.parse(Buffer.concat(chunks).toString()) as Partial<FakeRecord>)
        : {};
      if (method === "GET" && !m[2]) {
        const type = url.searchParams.get("type");
        const name = url.searchParams.get("name");
        return ok(
          res,
          zone.records.filter((r) => (!type || r.type === type) && (!name || r.name === name)),
        );
      }
      if (method === "POST" && !m[2]) {
        const record: FakeRecord = {
          id: randomBytes(8).toString("hex"),
          type: body.type ?? "A",
          name: body.name ?? "",
          content: body.content ?? "",
          proxied: Boolean(body.proxied),
          ttl: body.ttl ?? 1,
        };
        zone.records.push(record);
        return ok(res, record);
      }
      const record = zone.records.find((r) => r.id === m[2]);
      if (!record) return refuse(res, 404, "Record not found");
      if (method === "PUT" || method === "PATCH") {
        Object.assign(record, body, { id: record.id });
        return ok(res, record);
      }
      return refuse(res, 405, "Method not allowed");
    });
  });
  await new Promise<void>((resolve) => server.listen(port, "0.0.0.0", resolve));
  const address = server.address();
  const actual = typeof address === "object" && address ? address.port : port;
  return {
    url: `http://127.0.0.1:${actual}/client/v4`,
    tokens,
    zones,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

if (process.argv[1]?.endsWith("fake-cloudflare.ts")) {
  const port = Number(process.argv[2] ?? 9500);
  const token = process.argv[3] ?? "fake-cloudflare-token-0123456789abcdef0123";
  const zone = process.argv[4] ?? "example.com";
  void startFakeCloudflare({ zones: [zone], tokens: { [token]: [zone] } }, port).then((f) =>
    console.log(`fake Cloudflare at ${f.url}`),
  );
}
