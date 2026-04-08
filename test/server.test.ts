import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import net from "node:net";
import WebSocket from "ws";
import { startServer } from "../src/server.ts";
import { createPairingManager } from "../src/pairing.ts";
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

function sendRawHttp(port: number, request: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let response = "";

    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(request);
    });
    socket.on("data", (chunk) => {
      response += chunk;
    });
    socket.on("end", () => {
      resolve(response);
    });
    socket.on("error", reject);
  });
}

test("server serves health and protects the session page with a token", { skip: !runServerTests }, async () => {
  const pty = new FakePty();
  const token = "secret-token";
  let mobileOnboardingSeen = false;
  const server = await startServer(pty, {
    mode: "token",
    token,
    mobileOnboardingSeen,
    onMobileOnboardingSeen: () => {
      mobileOnboardingSeen = true;
    },
  }, 0);

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
  const server = await startServer(pty, {
    mode: "token",
    token,
    mobileOnboardingSeen: false,
    onMobileOnboardingSeen: () => {},
  }, 0);

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

test("persistent mode pairs a browser and then allows websocket access", { skip: !runServerTests }, async () => {
  const pty = new FakePty();
  const pairing = createPairingManager();
  const pairingRequests: string[] = [];
  let trustedSessionReadyCount = 0;
  let trustedDevices: Array<{ id: string; secretHash: string; createdAt: string; lastSeenAt: string; label?: string }> = [];
  const server = await startServer(
    pty,
    {
      mode: "trusted-browser",
      pairing,
      trustedDevices,
      onTrustedDevicesChange: (nextTrustedDevices) => {
        trustedDevices = nextTrustedDevices;
      },
      onPairingRequired: (code) => {
        pairingRequests.push(code);
      },
      onTrustedSessionReady: () => {
        trustedSessionReadyCount += 1;
      },
      mobileOnboardingSeen: false,
      onMobileOnboardingSeen: () => {},
    },
    0,
  );

  try {
    const pairingPage = await fetch(`http://127.0.0.1:${server.port}/`);
    assert.equal(pairingPage.status, 200);
    assert.match(await pairingPage.text(), /Pair This Browser/);
    assert.deepEqual(pairingRequests, [pairing.getCode()]);

    const pairResponse = await fetch(`http://127.0.0.1:${server.port}/pair`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: `http://127.0.0.1:${server.port}`,
      },
      body: `code=${pairing.getCode()}`,
      redirect: "manual",
    });
    assert.equal(pairResponse.status, 303);

    const cookie = pairResponse.headers.get("set-cookie");
    assert.ok(cookie);
    assert.equal(trustedDevices.length, 1);
    assert.equal(trustedDevices[0]?.label, "Unknown browser");

    const trustedPage = await fetch(`http://127.0.0.1:${server.port}/`, {
      headers: {
        Cookie: cookie,
      },
    });
    assert.equal(trustedPage.status, 200);
    assert.match(await trustedPage.text(), /<title>Termi<\/title>/);
    assert.deepEqual(pairingRequests, [pairingRequests[0]!]);
    assert.equal(trustedSessionReadyCount, 1);

    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/`, {
      headers: {
        Cookie: cookie,
        Origin: `http://127.0.0.1:${server.port}`,
      },
    });
    await once(ws, "open");
    ws.close();
  } finally {
    server.close();
  }
});

test("server returns 400 for malformed request hosts without crashing", { skip: !runServerTests }, async () => {
  const pty = new FakePty();
  const token = "secret-token";
  const server = await startServer(pty, {
    mode: "token",
    token,
    mobileOnboardingSeen: false,
    onMobileOnboardingSeen: () => {},
  }, 0);

  try {
    const response = await sendRawHttp(
      server.port,
      `GET /?t=${token} HTTP/1.1\r\nHost: [\r\nConnection: close\r\n\r\n`,
    );
    assert.match(response, /^HTTP\/1\.1 200 OK/m);

    const health = await fetch(`http://127.0.0.1:${server.port}/health`);
    assert.equal(health.status, 200);
  } finally {
    server.close();
  }
});

test("persistent mode ignores malformed trusted-device cookies", { skip: !runServerTests }, async () => {
  const pty = new FakePty();
  const pairing = createPairingManager();
  const server = await startServer(
    pty,
    {
      mode: "trusted-browser",
      pairing,
      trustedDevices: [],
      onTrustedDevicesChange: () => {},
      onPairingRequired: () => {},
      onTrustedSessionReady: () => {},
      mobileOnboardingSeen: false,
      onMobileOnboardingSeen: () => {},
    },
    0,
  );

  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/`, {
      headers: {
        Cookie: "__Host-termi_trust=%E0%A4%A",
      },
    });

    assert.equal(response.status, 200);
    assert.match(await response.text(), /Pair This Browser/);
  } finally {
    server.close();
  }
});

test("server rejects oversized websocket messages and ignores invalid resize payloads", { skip: !runServerTests }, async () => {
  const pty = new FakePty();
  const token = "secret-token";
  const server = await startServer(pty, {
    mode: "token",
    token,
    mobileOnboardingSeen: false,
    onMobileOnboardingSeen: () => {},
  }, 0);

  try {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/?t=${token}`);
    await once(ws, "open");
    ws.on("error", () => {});

    ws.send(JSON.stringify({ type: "resize", cols: 120, rows: 40 }));
    ws.send(JSON.stringify({ type: "resize", cols: -1, rows: 9999 }));
    ws.send(JSON.stringify({ type: "data", data: 123 }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.deepEqual(pty.resizes, [{ cols: 120, rows: 40 }]);
    assert.deepEqual(pty.writes, []);

    ws.send(JSON.stringify({ type: "data", data: "x".repeat(70 * 1024) }));
    const [code] = await once(ws, "close");
    assert.notEqual(code, 1000);
    assert.deepEqual(pty.writes, []);
  } finally {
    server.close();
  }
});

test("server only shows onboarding for mobile until it is acknowledged", { skip: !runServerTests }, async () => {
  const pty = new FakePty();
  const token = "secret-token";
  let mobileOnboardingSeen = false;
  const server = await startServer(pty, {
    mode: "token",
    token,
    mobileOnboardingSeen,
    onMobileOnboardingSeen: () => {
      mobileOnboardingSeen = true;
    },
  }, 0);

  try {
    const mobilePage = await fetch(`http://127.0.0.1:${server.port}/?t=${token}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      },
    });
    const html = await mobilePage.text();
    assert.match(html, /"showOnboarding":true/);
    assert.match(html, /"onboardingSeenPath":"\/onboarding\/seen\?t=secret-token"/);

    const ack = await fetch(`http://127.0.0.1:${server.port}/onboarding/seen?t=${token}`, {
      method: "POST",
    });
    assert.equal(ack.status, 204);
    assert.equal(mobileOnboardingSeen, true);

    const seenPage = await fetch(`http://127.0.0.1:${server.port}/?t=${token}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      },
    });
    assert.match(await seenPage.text(), /"showOnboarding":false/);
  } finally {
    server.close();
  }
});
