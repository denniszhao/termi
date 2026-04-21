import http from "node:http";
import { randomBytes, randomInt } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { parseCookies, serializeCookie } from "./cookies.js";
import type { PtyHandle } from "./pty-manager.js";
import {
  TRUSTED_DEVICE_COOKIE,
  addTrustedDevice,
  createTrustedDevice,
  getHeaderValue,
  inferTrustedDeviceLabel,
  touchTrustedDevice,
  verifyTrustedDeviceCookie,
} from "./trusted-devices.js";
import {
  getActiveSessionHtml,
  getApprovalBusyHtml,
  getConnectBrowserHtml,
  getHtml,
  getPendingApprovalHtml,
  getReplaceSessionHtml,
} from "./html.js";
import { icon192, favicon96, faviconIco, manifest } from "./assets.js";
import type { TrustedDevice, WsClientMessage } from "./types.js";

const HISTORY_LIMIT_BYTES = 512 * 1024;
const CLIENT_BUFFER_LIMIT_BYTES = 1024 * 1024;
const MAX_WS_MESSAGE_BYTES = 64 * 1024;
const FLUSH_INTERVAL_MS = 16;
const REQUEST_URL_BASE = "http://termi.local";
const PENDING_APPROVAL_COOKIE = "__Host-termi_pending";
const QUICK_SESSION_COOKIE = "__Host-termi_session";
const PENDING_APPROVAL_TTL_MS = 5 * 60 * 1000;
const QUICK_SESSION_TTL_SECONDS = 24 * 60 * 60;
const TRUSTED_DEVICE_TTL_SECONDS = 30 * 24 * 60 * 60;
const TAKEOVER_CLOSE_CODE = 4001;
const APPROVAL_CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const APPROVAL_CODE_LENGTH = 6;

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

export interface PendingApprovalInfo {
  code: string;
  expiresAt: string;
  id: string;
  intent: "replace-active-session" | "trust";
  label: string;
}

interface PendingApprovalRequest extends PendingApprovalInfo {
  approvedCookieValue?: string;
  statusMessage?: string;
  status: "approved" | "expired" | "pending" | "rejected";
}

type UntrustedBrowserState =
  | { kind: "approval-unavailable"; message: string }
  | { kind: "approval-pending"; request: PendingApprovalRequest }
  | { kind: "approval-busy"; message: string }
  | { kind: "replace-required" }
  | { kind: "pair-available" };

export type ServerAuth =
  | {
      mode: "quick-pairing";
      onPendingApprovalRequest(
        request: PendingApprovalInfo,
        actions: {
          approve(): boolean;
          reject(message?: string): boolean;
        },
      ): void;
      onTrustedBrowserTakeover(label: string): void;
      onTrustedSessionReady(): void;
      mobileOnboardingSeen: boolean;
      onMobileOnboardingSeen(): void;
    }
  | {
      mode: "trusted-browser";
      trustedDevices: TrustedDevice[];
      onTrustedDevicesChange(trustedDevices: TrustedDevice[]): void;
      onPendingApprovalRequest(
        request: PendingApprovalInfo,
        actions: {
          approve(): boolean;
          reject(message?: string): boolean;
        },
      ): void;
      onTrustedBrowserTakeover(label: string): void;
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

  const CACHED = "public, max-age=86400";
  const NO_STORE = "no-store";
  const STATIC_ASSETS: Record<string, { contentType: string; cache: string; body: Buffer | string }> = {
    "/icon-192.png":       { contentType: "image/png", cache: CACHED, body: icon192 },
    "/favicon-96x96.png":  { contentType: "image/png", cache: CACHED, body: favicon96 },
    "/favicon.ico":        { contentType: "image/x-icon", cache: CACHED, body: faviconIco },
    "/manifest.json":      { contentType: "application/json", cache: CACHED, body: manifest },
    "/app.js":             { contentType: "application/javascript; charset=utf-8", cache: NO_STORE, body: appJs },
    "/app.css":            { contentType: "text/css; charset=utf-8", cache: NO_STORE, body: appCss },
  };

  const clients = new Set<WebSocket>();
  const history: string[] = [];
  let activeClient:
    | {
        browserId: string;
        ws: WebSocket;
      }
    | undefined;
  let pendingApproval: PendingApprovalRequest | undefined;
  let quickPairedBrowser: TrustedDevice | null = null;
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

  function getKnownBrowsers(): TrustedDevice[] {
    return auth.mode === "trusted-browser"
      ? trustedDevices
      : quickPairedBrowser ? [quickPairedBrowser] : [];
  }

  function setKnownBrowsers(nextBrowsers: TrustedDevice[]): void {
    if (auth.mode === "trusted-browser") {
      trustedDevices = nextBrowsers;
      auth.onTrustedDevicesChange(trustedDevices);
      return;
    }

    quickPairedBrowser = nextBrowsers[0] ?? null;
  }

  function getAuthCookieName(): string {
    return auth.mode === "trusted-browser"
      ? TRUSTED_DEVICE_COOKIE
      : QUICK_SESSION_COOKIE;
  }

  function getAuthCookieMaxAgeSeconds(): number | undefined {
    return auth.mode === "trusted-browser"
      ? TRUSTED_DEVICE_TTL_SECONDS
      : QUICK_SESSION_TTL_SECONDS;
  }

  function persistTrustedDevices(nextTrustedDevices: TrustedDevice[]): void {
    setKnownBrowsers(nextTrustedDevices);
  }

  function clearPendingApproval(): void {
    pendingApproval = undefined;
  }

  function getPendingApprovalMessage(request: PendingApprovalRequest): string {
    return request.statusMessage
      ?? "This approval request is no longer available. Refresh to try again.";
  }

  function markPendingApprovalExpiredIfNeeded(): void {
    if (!pendingApproval) {
      return;
    }

    if (pendingApproval.expiresAt <= new Date().toISOString()) {
      pendingApproval = {
        ...pendingApproval,
        status: "expired",
      };
    }
  }

  function getPendingApproval(req: http.IncomingMessage): PendingApprovalRequest | null {
    if (!pendingApproval) {
      return null;
    }

    markPendingApprovalExpiredIfNeeded();

    const cookies = parseCookies(req.headers.cookie);
    return cookies[PENDING_APPROVAL_COOKIE] === pendingApproval.id
      ? pendingApproval
      : null;
  }

  function hasOutstandingPendingApproval(): boolean {
    markPendingApprovalExpiredIfNeeded();
    return pendingApproval?.status === "pending" || pendingApproval?.status === "approved";
  }

  function getActiveBrowser(): TrustedDevice | null {
    if (!activeClient) {
      return null;
    }

    return getKnownBrowsers().find((device) => device.id === activeClient?.browserId) ?? null;
  }

  function hasOtherActiveClient(browserId: string): boolean {
    return !!activeClient && activeClient.browserId !== browserId;
  }

  function notifyTrustedSessionReady(): void {
    if (trustedSessionReadyNotified) {
      return;
    }

    trustedSessionReadyNotified = true;
    auth.onTrustedSessionReady();
  }

  function getAuthenticatedBrowser(req: http.IncomingMessage): TrustedDevice | null {
    const cookies = parseCookies(req.headers.cookie);
    return verifyTrustedDeviceCookie(cookies[getAuthCookieName()], getKnownBrowsers());
  }

  function isAuthenticatedBrowserRequest(req: http.IncomingMessage): boolean {
    return getAuthenticatedBrowser(req) !== null;
  }

  function touchAuthenticatedBrowser(deviceId: string): void {
    persistTrustedDevices(touchTrustedDevice(getKnownBrowsers(), deviceId));
  }

  function generateApprovalCode(): string {
    let code = "";
    for (let i = 0; i < APPROVAL_CODE_LENGTH; i += 1) {
      code += APPROVAL_CODE_CHARS[randomInt(APPROVAL_CODE_CHARS.length)];
    }
    return code;
  }

  function createPendingApprovalRequest(
    req: http.IncomingMessage,
    intent: PendingApprovalInfo["intent"],
  ): PendingApprovalRequest {
    const request: PendingApprovalRequest = {
      code: generateApprovalCode(),
      expiresAt: new Date(Date.now() + PENDING_APPROVAL_TTL_MS).toISOString(),
      id: randomBytes(12).toString("base64url"),
      intent,
      label: inferTrustedDeviceLabel(req.headers),
      status: "pending",
    };

    pendingApproval = request;
    auth.onPendingApprovalRequest(
      {
        code: request.code,
        expiresAt: request.expiresAt,
        id: request.id,
        intent: request.intent,
        label: request.label,
      },
      {
        approve: () => approvePendingApprovalRequest(request.id),
        reject: (message) => rejectPendingApprovalRequest(request.id, message),
      },
    );

    return pendingApproval ?? request;
  }

  function approvePendingApprovalRequest(requestId: string): boolean {
    if (!pendingApproval || pendingApproval.id !== requestId) {
      return false;
    }
    if (pendingApproval.status !== "pending" || pendingApproval.expiresAt <= new Date().toISOString()) {
      pendingApproval = {
        ...pendingApproval,
        status: "expired",
      };
      return false;
    }

    const { device, cookieValue } = createTrustedDevice(pendingApproval.label);
    const nextBrowsers = auth.mode === "trusted-browser"
      ? addTrustedDevice(trustedDevices, device)
      : [device];
    persistTrustedDevices(nextBrowsers);
    pendingApproval = {
      ...pendingApproval,
      approvedCookieValue: cookieValue,
      status: "approved",
    };
    return true;
  }

  function rejectPendingApprovalRequest(requestId: string, statusMessage?: string): boolean {
    if (!pendingApproval || pendingApproval.id !== requestId || pendingApproval.status !== "pending") {
      return false;
    }

    pendingApproval = {
      ...pendingApproval,
      ...(statusMessage ? { statusMessage } : {}),
      status: "rejected",
    };
    return true;
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
        continue;
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

  function getUntrustedBrowserState(req: http.IncomingMessage): UntrustedBrowserState {
    const currentPending = getPendingApproval(req);
    if (currentPending) {
      if (currentPending.status === "rejected" || currentPending.status === "expired") {
        return {
          kind: "approval-unavailable",
          message: getPendingApprovalMessage(currentPending),
        };
      }

      return {
        kind: "approval-pending",
        request: currentPending,
      };
    }

    if (hasOutstandingPendingApproval()) {
      return {
        kind: "approval-busy",
        message: "Another browser is already waiting for local approval.",
      };
    }

    if (activeClient !== undefined) {
      return { kind: "replace-required" };
    }

    return { kind: "pair-available" };
  }

  function beginPendingApproval(
    req: http.IncomingMessage,
    intent: PendingApprovalInfo["intent"],
  ): UntrustedBrowserState {
    const request = createPendingApprovalRequest(req, intent);
    if (request.status === "rejected" || request.status === "expired") {
      return {
        kind: "approval-unavailable",
        message: getPendingApprovalMessage(request),
      };
    }

    return {
      kind: "approval-pending",
      request,
    };
  }

  function getPendingApprovalCookieHeader(request: PendingApprovalRequest): string {
    return serializeCookie(
      PENDING_APPROVAL_COOKIE,
      request.id,
      Math.floor(PENDING_APPROVAL_TTL_MS / 1000),
    );
  }

  function getApprovedCookieHeader(cookieValue: string): string {
    return serializeCookie(
      getAuthCookieName(),
      cookieValue,
      getAuthCookieMaxAgeSeconds(),
    );
  }

  function sendApprovalBlockedResponse(
    res: http.ServerResponse,
    state: UntrustedBrowserState,
  ): boolean {
    if (state.kind === "approval-unavailable") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Set-Cookie": serializeCookie(PENDING_APPROVAL_COOKIE, "", 0),
      });
      res.end(getApprovalBusyHtml(state.message));
      clearPendingApproval();
      return true;
    }

    if (state.kind === "approval-busy") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(getApprovalBusyHtml(state.message));
      return true;
    }

    return false;
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

    const staticAsset = STATIC_ASSETS[url.pathname];
    if (staticAsset) {
      res.writeHead(200, {
        "Content-Type": staticAsset.contentType,
        "Cache-Control": staticAsset.cache,
      });
      res.end(staticAsset.body);
      return;
    }

    if (url.pathname === "/") {
      const browser = getAuthenticatedBrowser(req);
      if (!browser) {
        const state = getUntrustedBrowserState(req);

        if (sendApprovalBlockedResponse(res, state)) {
          return;
        }

        if (state.kind === "approval-pending") {
          res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "Set-Cookie": getPendingApprovalCookieHeader(state.request),
          });
          res.end(getPendingApprovalHtml({
            code: state.request.code,
            expiresAt: state.request.expiresAt,
            label: state.request.label,
          }));
          return;
        }

        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(getConnectBrowserHtml({
          mayReplaceActiveSession: state.kind === "replace-required",
        }));
        return;
      }

      if (hasOtherActiveClient(browser.id)) {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(getActiveSessionHtml({
          activeDeviceLabel: getActiveBrowser()?.label ?? "another browser",
        }));
        return;
      }

      notifyTrustedSessionReady();
      touchAuthenticatedBrowser(browser.id);

      const html = getHtml({
        onboardingSeenPath: "/onboarding/seen",
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

    if (url.pathname === "/pair/status" && req.method === "GET") {
      const request = getPendingApproval(req);
      if (!request) {
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "Set-Cookie": serializeCookie(PENDING_APPROVAL_COOKIE, "", 0),
        });
        res.end(JSON.stringify({ status: "expired" }));
        return;
      }

      if (request.status === "approved" && request.approvedCookieValue) {
        if (request.intent === "replace-active-session" && activeClient) {
          const previousActiveClient = activeClient;
          activeClient = undefined;
          previousActiveClient.ws.close(
            TAKEOVER_CLOSE_CODE,
            "Session replaced by a newly approved browser",
          );
        }

        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "Set-Cookie": [
            getApprovedCookieHeader(request.approvedCookieValue),
            serializeCookie(PENDING_APPROVAL_COOKIE, "", 0),
          ],
        });
        clearPendingApproval();
        res.end(JSON.stringify({ status: "approved" }));
        return;
      }

      if (request.status === "rejected" || request.status === "expired") {
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "Set-Cookie": serializeCookie(PENDING_APPROVAL_COOKIE, "", 0),
        });
        const body = {
          message: request.statusMessage,
          status: request.status,
        };
        clearPendingApproval();
        res.end(JSON.stringify(body));
        return;
      }

      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ status: "pending" }));
      return;
    }

    if (url.pathname === "/pair/request" && req.method === "POST") {
      if (!isSameOriginOrMissing(req)) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("Forbidden");
        return;
      }

      if (getAuthenticatedBrowser(req)) {
        res.writeHead(303, {
          Location: "/",
          "Cache-Control": "no-store",
        });
        res.end();
        return;
      }

      const state = getUntrustedBrowserState(req);
      const intent = activeClient !== undefined
        ? "replace-active-session"
        : "trust";
      const resolvedState = state.kind === "pair-available" || state.kind === "replace-required"
        ? beginPendingApproval(req, intent)
        : state;

      if (sendApprovalBlockedResponse(res, resolvedState)) {
        return;
      }

      if (resolvedState.kind !== "approval-pending") {
        res.writeHead(303, {
          Location: "/",
          "Cache-Control": "no-store",
        });
        res.end();
        return;
      }

      res.writeHead(303, {
        Location: "/",
        "Cache-Control": "no-store",
        "Set-Cookie": getPendingApprovalCookieHeader(resolvedState.request),
      });
      res.end();
      return;
    }

    if (url.pathname === "/onboarding/seen" && req.method === "POST") {
      if (!isSameOriginOrMissing(req)) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("Forbidden");
        return;
      }

      if (!isAuthenticatedBrowserRequest(req)) {
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

    if (url.pathname === "/takeover" && req.method === "POST") {
      if (!isSameOrigin(req)) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("Forbidden");
        return;
      }

      const browser = getAuthenticatedBrowser(req);
      if (!browser) {
        res.writeHead(401, { "Content-Type": "text/plain" });
        res.end("Unauthorized");
        return;
      }

      if (hasOtherActiveClient(browser.id)) {
        const previousActiveClient = activeClient;
        activeClient = undefined;
        auth.onTrustedBrowserTakeover(browser.label ?? "Unknown browser");
        previousActiveClient?.ws.close(TAKEOVER_CLOSE_CODE, "Session taken over by another browser");
      }

      res.writeHead(303, {
        Location: "/",
        "Cache-Control": "no-store",
      });
      res.end();
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

    const browser = getAuthenticatedBrowser(req);
    if (!isSameOrigin(req) || !browser) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    if (hasOtherActiveClient(browser.id)) {
      socket.write("HTTP/1.1 409 Conflict\r\n\r\n");
      socket.destroy();
      return;
    }

    notifyTrustedSessionReady();

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws, req) => {
    const browser = getAuthenticatedBrowser(req);
    if (!browser) {
      ws.close(4000, "Unauthorized");
      return;
    }

    if (activeClient?.ws && activeClient.browserId === browser.id && activeClient.ws !== ws) {
      activeClient.ws.close(TAKEOVER_CLOSE_CODE, "Session reopened on the same browser");
    }
    activeClient = {
      browserId: browser.id,
      ws,
    };

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
      if (activeClient?.ws === ws) {
        activeClient = undefined;
      }
      clients.delete(ws);
    });

    ws.on("error", () => {
      if (activeClient?.ws === ws) {
        activeClient = undefined;
      }
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
        server.removeAllListeners("error");
        const addr = server.address();
        const actualPort = typeof addr === "object" && addr ? addr.port : p;
        resolve({
          port: actualPort,
          close: () => {
            if (flushTimer) {
              clearTimeout(flushTimer);
            }
            for (const ws of clients) ws.close(4000, "Server shutting down");
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
