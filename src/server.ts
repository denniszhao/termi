import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { parseCookies, serializeCookie } from "./cookies.js";
import type { PtyHandle } from "./pty-manager.js";
import type { PairingManager } from "./pairing.js";
import {
  TRUSTED_DEVICE_COOKIE,
  addTrustedDevice,
  createTrustedDevice,
  inferTrustedDeviceLabel,
  touchTrustedDevice,
  verifyTrustedDeviceCookie,
} from "./trusted-devices.js";
import { validateToken } from "./auth.js";
import { getHtml, getPairingHtml } from "./html.js";
import { icon192, favicon96, faviconIco, manifest } from "./assets.js";
import type { TrustedDevice, WsClientMessage } from "./types.js";

const HISTORY_LIMIT_BYTES = 512 * 1024;
const CLIENT_BUFFER_LIMIT_BYTES = 1024 * 1024;
const BODY_LIMIT_BYTES = 1024;
const MAX_WS_MESSAGE_BYTES = 64 * 1024;
const FLUSH_INTERVAL_MS = 16;
const REQUEST_URL_BASE = "http://termi.local";

function resolvePublicDir(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDir, "public"),
    join(process.cwd(), "dist", "public"),
  ];

  for (const candidate of candidates) {
    if (existsSync(join(candidate, "app.js")) && existsSync(join(candidate, "app.css"))) {
      return candidate;
    }
  }

  throw new Error("Could not locate built web assets");
}

export interface ServerHandle {
  port: number;
  close(): void;
}

export type ServerAuth =
  | {
      mode: "token";
      token: string;
      mobileOnboardingSeen: boolean;
      onMobileOnboardingSeen(): void;
    }
  | {
      mode: "trusted-browser";
      pairing: PairingManager;
      trustedDevices: TrustedDevice[];
      onTrustedDevicesChange(trustedDevices: TrustedDevice[]): void;
      onPairingRequired(code: string): void;
      onTrustedSessionReady(): void;
      mobileOnboardingSeen: boolean;
      onMobileOnboardingSeen(): void;
    };

export function startServer(
  ptyHandle: PtyHandle,
  auth: ServerAuth,
  port: number,
): Promise<ServerHandle> {
  const publicDir = resolvePublicDir();
  const appJs = readFileSync(join(publicDir, "app.js"));
  const appCss = readFileSync(join(publicDir, "app.css"));
  const clients = new Set<WebSocket>();
  const history: string[] = [];
  let trustedDevices =
    auth.mode === "trusted-browser"
      ? [...auth.trustedDevices]
      : [];
  let historyBytes = 0;
  let pendingOutput = "";
  let flushTimer: NodeJS.Timeout | undefined;
  let trustedSessionReadyNotified = false;
  let mobileOnboardingSeen = auth.mobileOnboardingSeen;

  function appendToHistory(chunk: string): void {
    history.push(chunk);
    historyBytes += Buffer.byteLength(chunk);

    while (historyBytes > HISTORY_LIMIT_BYTES && history.length > 0) {
      const removed = history.shift()!;
      historyBytes -= Buffer.byteLength(removed);
    }
  }

  function flushPendingOutput(): void {
    flushTimer = undefined;
    if (!pendingOutput) {
      return;
    }

    const data = pendingOutput;
    pendingOutput = "";
    appendToHistory(data);

    const msg = JSON.stringify({ type: "data", data });
    for (const ws of clients) {
      if (ws.readyState !== WebSocket.OPEN) {
        continue;
      }
      if (ws.bufferedAmount > CLIENT_BUFFER_LIMIT_BYTES) {
        ws.close(1013, "Client too slow");
        continue;
      }
      ws.send(msg, (err) => {
        if (err) {
          ws.terminate();
        }
      });
    }
  }

  function scheduleFlush(): void {
    if (!flushTimer) {
      flushTimer = setTimeout(flushPendingOutput, FLUSH_INTERVAL_MS);
    }
  }

  function persistTrustedDevices(nextTrustedDevices: TrustedDevice[]): void {
    trustedDevices = nextTrustedDevices;
    if (auth.mode === "trusted-browser") {
      auth.onTrustedDevicesChange(trustedDevices);
    }
  }

  function notifyTrustedSessionReady(): void {
    if (auth.mode !== "trusted-browser" || trustedSessionReadyNotified) {
      return;
    }

    trustedSessionReadyNotified = true;
    auth.onTrustedSessionReady();
  }

  function getTrustedDevice(req: http.IncomingMessage): TrustedDevice | null {
    if (auth.mode !== "trusted-browser") {
      return null;
    }
    const cookies = parseCookies(req.headers.cookie);
    return verifyTrustedDeviceCookie(cookies[TRUSTED_DEVICE_COOKIE], trustedDevices);
  }

  function isTrustedBrowserRequest(req: http.IncomingMessage): boolean {
    return getTrustedDevice(req) !== null;
  }

  function touchTrustedBrowser(deviceId: string): void {
    persistTrustedDevices(touchTrustedDevice(trustedDevices, deviceId));
  }

  function isSameOrigin(req: http.IncomingMessage): boolean {
    const host = req.headers.host;
    if (!host) {
      return false;
    }

    const candidates = [req.headers.origin, req.headers.referer];
    for (const candidate of candidates) {
      if (!candidate || Array.isArray(candidate)) {
        continue;
      }
      try {
        if (new URL(candidate).host === host) {
          return true;
        }
      } catch {
        return false;
      }
    }

    return false;
  }

  function isSameOriginOrMissing(req: http.IncomingMessage): boolean {
    const hasOrigin = !!req.headers.origin;
    const hasReferer = !!req.headers.referer;

    if (!hasOrigin && !hasReferer) {
      return true;
    }

    return isSameOrigin(req);
  }

  function isLikelyMobileRequest(req: http.IncomingMessage): boolean {
    const userAgent = getHeaderValue(req.headers["user-agent"]).toLowerCase();
    const mobileHint = getHeaderValue(req.headers["sec-ch-ua-mobile"]).toLowerCase();

    return mobileHint === "?1" || /(iphone|ipad|ipod|android|mobile|windows phone)/.test(userAgent);
  }

  function parseRequestUrl(req: http.IncomingMessage): URL | null {
    try {
      return new URL(req.url || "/", REQUEST_URL_BASE);
    } catch {
      return null;
    }
  }

  async function readBody(req: http.IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buffer);
      totalBytes += buffer.length;
      if (totalBytes > BODY_LIMIT_BYTES) {
        throw new Error("Request body too large");
      }
    }
    return Buffer.concat(chunks).toString("utf-8");
  }

  const server = http.createServer((req, res) => {
    const url = parseRequestUrl(req);
    if (!url) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Bad request");
      return;
    }

    if (url.pathname === "/health") {
      res.writeHead(200);
      res.end("ok");
      return;
    }

    if (url.pathname === "/icon-192.png") {
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" });
      res.end(icon192);
      return;
    }

    if (url.pathname === "/favicon-96x96.png") {
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" });
      res.end(favicon96);
      return;
    }

    if (url.pathname === "/favicon.ico") {
      res.writeHead(200, { "Content-Type": "image/x-icon", "Cache-Control": "public, max-age=86400" });
      res.end(faviconIco);
      return;
    }

    if (url.pathname === "/manifest.json") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "public, max-age=86400" });
      res.end(manifest);
      return;
    }

    if (url.pathname === "/app.js") {
      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(appJs);
      return;
    }

    if (url.pathname === "/app.css") {
      res.writeHead(200, {
        "Content-Type": "text/css; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(appCss);
      return;
    }

    if (url.pathname === "/") {
      if (auth.mode === "token") {
        const reqToken = url.searchParams.get("t");
        if (!validateToken(reqToken, auth.token)) {
          res.writeHead(401, { "Content-Type": "text/plain" });
          res.end("Unauthorized");
          return;
        }
      } else {
        const trustedDevice = getTrustedDevice(req);
        if (!trustedDevice) {
          auth.onPairingRequired(auth.pairing.getCode());
          res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
          });
          res.end(getPairingHtml());
          return;
        }
        notifyTrustedSessionReady();
        touchTrustedBrowser(trustedDevice.id);
      }

      const onboardingSeenPath = auth.mode === "token"
        ? `/onboarding/seen?t=${encodeURIComponent(auth.token)}`
        : "/onboarding/seen";
      const html = getHtml({
        onboardingSeenPath,
        showOnboarding: isLikelyMobileRequest(req) && !mobileOnboardingSeen,
      });

      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": "inline",
        "Cache-Control": "no-store",
      });
      res.end(html);
      return;
    }

    if (url.pathname === "/onboarding/seen" && req.method === "POST") {
      if (!isSameOriginOrMissing(req)) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("Forbidden");
        return;
      }

      if (auth.mode === "token") {
        const reqToken = url.searchParams.get("t");
        if (!validateToken(reqToken, auth.token)) {
          res.writeHead(401, { "Content-Type": "text/plain" });
          res.end("Unauthorized");
          return;
        }
      } else if (!isTrustedBrowserRequest(req)) {
        res.writeHead(401, { "Content-Type": "text/plain" });
        res.end("Unauthorized");
        return;
      }

      mobileOnboardingSeen = true;
      auth.onMobileOnboardingSeen();
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === "/pair" && req.method === "POST") {
      if (auth.mode !== "trusted-browser") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      if (!isSameOrigin(req)) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("Forbidden");
        return;
      }

      readBody(req)
        .then((body) => {
          const code = new URLSearchParams(body).get("code") ?? "";
          const result = auth.pairing.verify(code);
          if (!result.ok) {
            const message = result.error === "expired"
              ? "The pairing code expired or changed. Check the local terminal for the current code."
              : "That pairing code was not valid.";
            res.writeHead(401, {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-store",
            });
            res.end(getPairingHtml(message));
            return;
          }

          const { device, cookieValue } = createTrustedDevice(inferTrustedDeviceLabel(req.headers));
          persistTrustedDevices(addTrustedDevice(trustedDevices, device));
          notifyTrustedSessionReady();
          res.writeHead(303, {
            Location: "/",
            "Set-Cookie": serializeCookie(TRUSTED_DEVICE_COOKIE, cookieValue, 30 * 24 * 60 * 60),
            "Cache-Control": "no-store",
          });
          res.end();
        })
        .catch((err) => {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end(err instanceof Error ? err.message : "Bad request");
        });
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_MESSAGE_BYTES });

  server.on("upgrade", (req, socket, head) => {
    const url = parseRequestUrl(req);
    if (!url) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    if (auth.mode === "token") {
      const reqToken = url.searchParams.get("t");

      if (!validateToken(reqToken, auth.token)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
    } else {
      if (!isSameOrigin(req) || !isTrustedBrowserRequest(req)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      notifyTrustedSessionReady();
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws);
    });
  });

  wss.on("connection", (ws) => {
    const initialOutput = history.join("");
    if (initialOutput) {
      ws.send(JSON.stringify({ type: "data", data: initialOutput }), (err) => {
        if (err) {
          ws.terminate();
        }
      });
    }

    clients.add(ws);

    ws.on("message", (raw) => {
      try {
        const msg: WsClientMessage = JSON.parse(String(raw));
        if (
          msg.type === "data" &&
          typeof msg.data === "string" &&
          msg.data.length > 0 &&
          Buffer.byteLength(msg.data) <= MAX_WS_MESSAGE_BYTES
        ) {
          ptyHandle.write(msg.data);
        } else if (
          msg.type === "resize" &&
          Number.isInteger(msg.cols) &&
          Number.isInteger(msg.rows) &&
          msg.cols >= 1 &&
          msg.cols <= 500 &&
          msg.rows >= 1 &&
          msg.rows <= 200
        ) {
          ptyHandle.resize(msg.cols, msg.rows);
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
    });

    ws.on("error", () => {
      clients.delete(ws);
      ws.terminate();
    });
  });

  ptyHandle.onData((data) => {
    pendingOutput += data;
    scheduleFlush();
  });

  return new Promise((resolve, reject) => {
    const tryListen = (p: number, attempts: number) => {
      server.listen(p, "127.0.0.1", () => {
        const addr = server.address();
        const actualPort = typeof addr === "object" && addr ? addr.port : p;
        resolve({
          port: actualPort,
          close: () => {
            if (flushTimer) {
              clearTimeout(flushTimer);
            }
            for (const ws of clients) ws.close();
            wss.close();
            server.close();
          },
        });
      });

      server.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE" && attempts > 0) {
          server.removeAllListeners("error");
          tryListen(p + 1, attempts - 1);
        } else {
          reject(err);
        }
      });
    };

    tryListen(port, 10);
  });
}

function getHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}
