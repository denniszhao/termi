import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { PtyHandle } from "./pty-manager.js";
import { validateToken } from "./auth.js";
import { getHtml } from "./html.js";
import { icon192, favicon96, faviconIco, manifest } from "./assets.js";
import type { WsClientMessage } from "./types.js";

const HISTORY_LIMIT_BYTES = 512 * 1024;
const CLIENT_BUFFER_LIMIT_BYTES = 1024 * 1024;
const FLUSH_INTERVAL_MS = 16;

export interface ServerHandle {
  port: number;
  close(): void;
}

export function startServer(
  ptyHandle: PtyHandle,
  token: string,
  port: number,
): Promise<ServerHandle> {
  const html = getHtml();
  const clients = new Set<WebSocket>();
  const history: string[] = [];
  let historyBytes = 0;
  let pendingOutput = "";
  let flushTimer: NodeJS.Timeout | undefined;

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

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

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

    if (url.pathname === "/") {
      const reqToken = url.searchParams.get("t");
      if (!validateToken(reqToken, token)) {
        res.writeHead(401, { "Content-Type": "text/plain" });
        res.end("Unauthorized");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": "inline",
        "Cache-Control": "no-store",
      });
      res.end(html);
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const reqToken = url.searchParams.get("t");

    if (!validateToken(reqToken, token)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
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
        if (msg.type === "data" && msg.data) {
          ptyHandle.write(msg.data);
        } else if (msg.type === "resize" && msg.cols && msg.rows) {
          ptyHandle.resize(msg.cols, msg.rows);
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
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
