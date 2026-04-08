import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { PtyHandle } from "./pty-manager.js";
import { validateToken } from "./auth.js";
import { getHtml } from "./html.js";
import type { WsClientMessage } from "./types.js";

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

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (url.pathname === "/health") {
      res.writeHead(200);
      res.end("ok");
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
    const msg = JSON.stringify({ type: "data", data });
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  });

  return new Promise((resolve, reject) => {
    const tryListen = (p: number, attempts: number) => {
      server.listen(p, "127.0.0.1", () => {
        const addr = server.address();
        const actualPort = typeof addr === "object" && addr ? addr.port : p;
        resolve({
          port: actualPort,
          close: () => {
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
