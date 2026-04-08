import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket from "ws";
import { startServer } from "../src/server.ts";
import type { PtyHandle } from "../src/pty-manager.ts";

const runServerTests = process.env.TERMI_RUN_SERVER_TESTS === "1";

class FakePty implements PtyHandle {
  private dataHandlers: Array<(data: string) => void> = [];
  private exitHandlers: Array<(exitCode: number) => void> = [];
  writes: string[] = [];
  resizes: Array<{ cols: number; rows: number }> = [];

  write(data: string): void {
    this.writes.push(data);
  }

  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows });
  }

  onData(cb: (data: string) => void): void {
    this.dataHandlers.push(cb);
  }

  onExit(cb: (exitCode: number) => void): void {
    this.exitHandlers.push(cb);
  }

  kill(): void {
    this.exitHandlers.forEach((cb) => cb(0));
  }

  emitData(data: string): void {
    this.dataHandlers.forEach((cb) => cb(data));
  }
}

test("server serves health and protects the session page with a token", { skip: !runServerTests }, async () => {
  const pty = new FakePty();
  const token = "secret-token";
  const server = await startServer(pty, token, 0);

  try {
    const health = await fetch(`http://127.0.0.1:${server.port}/health`);
    assert.equal(health.status, 200);
    assert.equal(await health.text(), "ok");

    const unauthorized = await fetch(`http://127.0.0.1:${server.port}/`);
    assert.equal(unauthorized.status, 401);

    const authorized = await fetch(`http://127.0.0.1:${server.port}/?t=${token}`);
    assert.equal(authorized.status, 200);
    assert.match(await authorized.text(), /<title>Termi<\/title>/);
  } finally {
    server.close();
  }
});

test("server replays PTY output and forwards websocket input", { skip: !runServerTests }, async () => {
  const pty = new FakePty();
  const token = "secret-token";
  const server = await startServer(pty, token, 0);

  try {
    pty.emitData("history line\r\n");
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/?t=${token}`);
    await once(ws, "open");

    const [historyMessage] = await once(ws, "message");
    const historyPayload = JSON.parse(String(historyMessage)) as { type: string; data: string };
    assert.equal(historyPayload.type, "data");
    assert.match(historyPayload.data, /history line/);

    pty.emitData("live line\r\n");
    const [liveMessage] = await once(ws, "message");
    const livePayload = JSON.parse(String(liveMessage)) as { type: string; data: string };
    assert.equal(livePayload.type, "data");
    assert.match(livePayload.data, /live line/);

    ws.send(JSON.stringify({ type: "data", data: "ls\n" }));
    ws.send(JSON.stringify({ type: "resize", cols: 120, rows: 40 }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.deepEqual(pty.writes, ["ls\n"]);
    assert.deepEqual(pty.resizes, [{ cols: 120, rows: 40 }]);
    ws.close();
  } finally {
    server.close();
  }
});
