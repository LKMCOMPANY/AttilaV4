import { createServer } from "http";
import { parse } from "url";
import { readFileSync } from "fs";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import { createClient } from "@supabase/supabase-js";

// Load .env.local before anything else (top-level ESM runs before Next.js
// has a chance to load env files for its own context)
const envFile = new URL(".env.local", import.meta.url);
try {
  for (const line of readFileSync(envFile, "utf-8").split("\n")) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
} catch { /* .env.local may not exist in prod */ }

// ---------------------------------------------------------------------------
// 1. Create the HTTP server FIRST, then pass it to Next.js via httpServer
//    so Next.js can attach its Turbopack/HMR WebSocket handler to it.
// ---------------------------------------------------------------------------
const dev = process.env.NODE_ENV !== "production";
const server = createServer();
const app = next({ dev, httpServer: server });
const handle = app.getRequestHandler();

const CF_HEADERS = {
  "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID,
  "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET,
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ---------------------------------------------------------------------------
// Box hostname cache (TTL 30s)
// ---------------------------------------------------------------------------
const boxCache = new Map();
const BOX_CACHE_TTL = 30_000;

async function resolveBox(boxId) {
  const cached = boxCache.get(boxId);
  if (cached && Date.now() - cached.ts < BOX_CACHE_TTL) return cached.hostname;

  const { data, error } = await supabase
    .from("boxes")
    .select("tunnel_hostname")
    .eq("id", boxId)
    .single();

  if (error || !data) return null;

  boxCache.set(boxId, { hostname: data.tunnel_hostname, ts: Date.now() });
  return data.tunnel_hostname;
}

// ---------------------------------------------------------------------------
// Session validation from raw cookie header
// ---------------------------------------------------------------------------
const SUPABASE_PROJECT_REF = (process.env.NEXT_PUBLIC_SUPABASE_URL || "")
  .replace("https://", "")
  .split(".")[0];

function parseCookies(cookieHeader) {
  const map = {};
  if (!cookieHeader) return map;
  for (const pair of cookieHeader.split(";")) {
    const idx = pair.indexOf("=");
    if (idx < 0) continue;
    map[pair.substring(0, idx).trim()] = decodeURIComponent(
      pair.substring(idx + 1).trim()
    );
  }
  return map;
}

function decodeSessionCookie(raw) {
  if (!raw) return null;
  try {
    const json = raw.startsWith("base64-")
      ? Buffer.from(raw.slice(7), "base64").toString("utf-8")
      : raw;
    const parsed = JSON.parse(json);
    return parsed.access_token || null;
  } catch {
    return null;
  }
}

function extractAccessToken(cookieHeader) {
  const cookies = parseCookies(cookieHeader);
  const base = `sb-${SUPABASE_PROJECT_REF}-auth-token`;

  if (cookies[base]) return decodeSessionCookie(cookies[base]);

  // Chunked cookies: sb-xxx-auth-token.0, sb-xxx-auth-token.1, ...
  let chunks = "";
  for (let i = 0; ; i++) {
    const chunk = cookies[`${base}.${i}`];
    if (!chunk) break;
    chunks += chunk;
  }
  if (chunks) return decodeSessionCookie(chunks);

  return null;
}

async function validateSession(cookieHeader, boxId) {
  const token = extractAccessToken(cookieHeader);
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, account_id")
    .eq("id", data.user.id)
    .single();

  if (!profile) return null;
  if (profile.role === "admin") return profile;
  if (!profile.account_id) return null;

  // Mirror `canUserAccessBox` (src/lib/auth/session.ts): box-level share via
  // `account_boxes`, OR at least one device on the box assigned directly to
  // the account. Without the box-level branch, every WebSocket attempt for a
  // box-only-shared device 401s and the operator UI never streams.
  const [boxLink, deviceLink] = await Promise.all([
    supabase
      .from("account_boxes")
      .select("box_id", { count: "exact", head: true })
      .eq("box_id", boxId)
      .eq("account_id", profile.account_id),
    supabase
      .from("devices")
      .select("id", { count: "exact", head: true })
      .eq("box_id", boxId)
      .eq("account_id", profile.account_id),
  ]);

  if ((boxLink.count ?? 0) === 0 && (deviceLink.count ?? 0) === 0) return null;
  return profile;
}

// ---------------------------------------------------------------------------
// WebSocket proxy (our streaming paths only)
// ---------------------------------------------------------------------------
const WS_PATH_RE = /^\/ws\/stream\/([^/]+)\/([^/]+)\/(video|touch|audio)$/;
const wss = new WebSocketServer({ noServer: true });

function proxyWebSocket(clientWs, targetUrl) {
  const upstream = new WebSocket(targetUrl, { headers: CF_HEADERS });
  const pending = [];
  let clientReady = clientWs.readyState === WebSocket.OPEN;

  if (!clientReady) {
    clientWs.on("open", () => {
      clientReady = true;
      for (const [msg, opts] of pending) clientWs.send(msg, opts);
      pending.length = 0;
    });
  }

  upstream.on("open", () => {
    console.log(`[ws] connected → ${targetUrl}`);
  });

  upstream.on("message", (data, isBinary) => {
    if (clientReady && clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data, { binary: isBinary });
    } else if (!clientReady) {
      pending.push([data, { binary: isBinary }]);
    }
  });

  clientWs.on("message", (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary });
    }
  });

  const cleanup = (source) => {
    console.log(`[ws] closed (${source})`);
    if (upstream.readyState === WebSocket.OPEN) upstream.close();
    if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
  };

  upstream.on("close", () => cleanup("upstream"));
  upstream.on("error", (e) => {
    console.error(`[ws] upstream error: ${e.message}`);
    cleanup("upstream-error");
  });
  clientWs.on("close", () => cleanup("client"));
  clientWs.on("error", (e) => {
    console.error(`[ws] client error: ${e.message}`);
    cleanup("client-error");
  });
}

// ---------------------------------------------------------------------------
// 2. Prepare Next.js, then attach request + upgrade handlers and listen.
//    Next.js already attached its HMR/Turbopack upgrade handler to `server`
//    via the httpServer option, so we only handle /ws/stream/... paths here.
// ---------------------------------------------------------------------------
app.prepare().then(() => {
  server.on("request", (req, res) => {
    handle(req, res, parse(req.url, true));
  });

  server.on("upgrade", async (req, socket, head) => {
    const { pathname } = parse(req.url, true);
    const match = pathname?.match(WS_PATH_RE);

    if (!match) return;

    const [, boxId, containerId, type] = match;

    try {
      const profile = await validateSession(req.headers.cookie, boxId);
      if (!profile) {
        console.warn(`[ws] unauthorized attempt for box ${boxId}`);
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      const hostname = await resolveBox(boxId);
      if (!hostname) {
        console.warn(`[ws] box not found: ${boxId}`);
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
        return;
      }

      const targetUrl = `wss://${hostname}/stream/${containerId}/${type}`;

      wss.handleUpgrade(req, socket, head, (ws) => {
        proxyWebSocket(ws, targetUrl);
      });
    } catch (err) {
      console.error(`[ws] upgrade error:`, err);
      socket.destroy();
    }
  });

  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
    console.log(`> WS proxy path: /ws/stream/{boxId}/{containerId}/{type}`);
    startPipelineWorkers(port);
  });
});

// ---------------------------------------------------------------------------
// 3. Pipeline workers — continuous loops calling the API routes internally.
//    Replaces the external Render cron jobs (Option A → Option B).
//    Concurrency is safe: claim uses FOR UPDATE SKIP LOCKED, execute uses
//    status guard. Multiple workers never collide on the same post/job.
// ---------------------------------------------------------------------------

const PROCESS_CONCURRENCY = parseInt(process.env.PIPELINE_PROCESS_CONCURRENCY || "3", 10);
const EXECUTE_CONCURRENCY = parseInt(process.env.PIPELINE_EXECUTE_CONCURRENCY || "2", 10);
const IDLE_MS = parseInt(process.env.PIPELINE_IDLE_MS || "5000", 10);
const SWEEP_INTERVAL_MS = parseInt(process.env.GORGONE_SWEEP_INTERVAL_MS || "60000", 10);
const CRON_SECRET = process.env.CRON_SECRET;

async function workerLoop(name, port, path, opts = {}) {
  const url = `http://localhost:${port}${path}`;
  const headers = {
    "Authorization": `Bearer ${CRON_SECRET}`,
    "Content-Type": "application/json",
  };
  const idleMs = opts.idleMs ?? IDLE_MS;
  const fixedIntervalMs = opts.fixedIntervalMs ?? null;

  while (true) {
    const cycleStart = Date.now();

    try {
      const res = await fetch(url, { method: "POST", headers });
      const data = await res.json();

      const isIdle = data.action === "idle";
      if (!isIdle) {
        console.log(`[${name}]`, JSON.stringify(data));
      }

      if (fixedIntervalMs != null) {
        // Fixed-cadence loop (sweep): always wait the remainder of the interval.
        const elapsed = Date.now() - cycleStart;
        const wait = Math.max(0, fixedIntervalMs - elapsed);
        await new Promise((r) => setTimeout(r, wait));
      } else if (isIdle) {
        // Idle-aware loop (pipeline): only back off when there's nothing to do.
        await new Promise((r) => setTimeout(r, idleMs));
      }
    } catch (err) {
      console.error(`[${name}] Error: ${err.message}`);
      await new Promise((r) => setTimeout(r, idleMs));
    }
  }
}

function startPipelineWorkers(port) {
  if (!CRON_SECRET) {
    console.warn("[Pipeline] CRON_SECRET not set — workers disabled");
    return;
  }

  for (let i = 0; i < PROCESS_CONCURRENCY; i++) {
    workerLoop(`Worker-Process-${i}`, port, "/api/pipeline/process");
  }
  console.log(`> Pipeline process workers: ${PROCESS_CONCURRENCY}`);

  for (let i = 0; i < EXECUTE_CONCURRENCY; i++) {
    workerLoop(`Worker-Execute-${i}`, port, "/api/pipeline/execute");
  }
  console.log(`> Pipeline execute workers: ${EXECUTE_CONCURRENCY}`);

  // Gorgone sweep — safety net behind the webhook ingestion. One worker is
  // enough because the sweep is idempotent and doesn't bottleneck the pipe.
  workerLoop("Gorgone-Sweep", port, "/api/gorgone/sweep", {
    fixedIntervalMs: SWEEP_INTERVAL_MS,
  });
  console.log(`> Gorgone sweep worker: every ${SWEEP_INTERVAL_MS}ms`);
}
