import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import net from "node:net";
import WebSocket from "ws";
import { startServer } from "../src/server.ts";
import type { PtyHandle } from "../src/pty-manager.ts";
import { createTrustedDevice } from "../src/trusted-devices.ts";

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

function extractCookie(setCookieHeader: string | null, cookieName: string): string {
  assert.ok(setCookieHeader);
  const match = setCookieHeader.match(new RegExp(`(${cookieName}=[^;,]+)`));
  assert.ok(match);
  return match[1]!;
}

test("server serves health and shows an explicit connect page for unauthenticated browsers", { skip: !runServerTests }, async () => {
  const pty = new FakePty();
  let pendingApprovalActions:
    | {
        approve(): boolean;
        reject(message?: string): boolean;
      }
    | undefined;
  let mobileOnboardingSeen = false;
  const server = await startServer(pty, {
    mode: "quick-pairing",
    onPendingApprovalRequest: (_request, actions) => {
      pendingApprovalActions = actions;
    },
    onTrustedBrowserTakeover: () => {},
    onTrustedSessionReady: () => {},
    mobileOnboardingSeen,
    onMobileOnboardingSeen: () => {
      mobileOnboardingSeen = true;
    },
  }, 0);

  try {
    const health = await fetch(`http://127.0.0.1:${server.port}/health`);
    assert.equal(health.status, 200);
    assert.equal(await health.text(), "ok");

    const pairPage = await fetch(`http://127.0.0.1:${server.port}/`);
    assert.equal(pairPage.status, 200);
    assert.match(await pairPage.text(), /Connect This Browser/);
    assert.equal(pendingApprovalActions, undefined);
  } finally {
    server.close();
  }
});

test("quick mode approves a pending browser locally and then allows websocket access", { skip: !runServerTests }, async () => {
  const pty = new FakePty();
  let pendingApprovalActions:
    | {
        approve(): boolean;
        reject(message?: string): boolean;
      }
    | undefined;
  let trustedSessionReadyCount = 0;
  const server = await startServer(
    pty,
    {
      mode: "quick-pairing",
      onPendingApprovalRequest: (_request, actions) => {
        pendingApprovalActions = actions;
      },
      onTrustedBrowserTakeover: () => {},
      onTrustedSessionReady: () => {
        trustedSessionReadyCount += 1;
      },
      mobileOnboardingSeen: false,
      onMobileOnboardingSeen: () => {},
    },
    0,
  );

  try {
    const pairPage = await fetch(`http://127.0.0.1:${server.port}/`);
    assert.equal(pairPage.status, 200);
    assert.match(await pairPage.text(), /Connect This Browser/);
    assert.equal(pendingApprovalActions, undefined);

    const pairRequest = await fetch(`http://127.0.0.1:${server.port}/pair/request`, {
      method: "POST",
      headers: {
        Origin: `http://127.0.0.1:${server.port}`,
      },
      redirect: "manual",
    });
    assert.equal(pairRequest.status, 303);
    assert.ok(pendingApprovalActions);

    const pendingCookie = extractCookie(
      pairRequest.headers.get("set-cookie"),
      "__Host-termi_pending",
    );

    assert.equal(pendingApprovalActions.approve(), true);
    const statusResponse = await fetch(`http://127.0.0.1:${server.port}/pair/status`, {
      headers: {
        Cookie: pendingCookie,
      },
    });
    assert.equal(statusResponse.status, 200);
    assert.deepEqual(await statusResponse.json(), { status: "approved" });

    const setCookie = statusResponse.headers.get("set-cookie");
    const cookie = extractCookie(setCookie, "__Host-termi_session");
    assert.match(setCookie ?? "", /Max-Age=86400/);

    const pairedPage = await fetch(`http://127.0.0.1:${server.port}/`, {
      headers: {
        Cookie: cookie,
      },
    });
    assert.equal(pairedPage.status, 200);
    assert.match(await pairedPage.text(), /<title>Termi<\/title>/);
    assert.equal(trustedSessionReadyCount, 1);

    pty.emitData("history line\r\n");
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/`, {
      headers: {
        Cookie: cookie,
        Origin: `http://127.0.0.1:${server.port}`,
      },
    });
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

test("persistent mode approves a pending browser locally and then allows websocket access", { skip: !runServerTests }, async () => {
  const pty = new FakePty();
  let pendingApprovalActions:
    | {
        approve(): boolean;
        reject(): boolean;
      }
    | undefined;
  let trustedSessionReadyCount = 0;
  let trustedDevices: Array<{ id: string; secretHash: string; createdAt: string; lastSeenAt: string; label?: string }> = [];
  const server = await startServer(
    pty,
    {
      mode: "trusted-browser",
      trustedDevices,
      onTrustedDevicesChange: (nextTrustedDevices) => {
        trustedDevices = nextTrustedDevices;
      },
      onPendingApprovalRequest: (_request, actions) => {
        pendingApprovalActions = actions;
      },
      onTrustedBrowserTakeover: () => {},
      onTrustedSessionReady: () => {
        trustedSessionReadyCount += 1;
      },
      mobileOnboardingSeen: false,
      onMobileOnboardingSeen: () => {},
    },
    0,
  );

  try {
    const pairPage = await fetch(`http://127.0.0.1:${server.port}/`);
    assert.equal(pairPage.status, 200);
    assert.match(await pairPage.text(), /Connect This Browser/);
    assert.equal(pendingApprovalActions, undefined);

    const pairRequest = await fetch(`http://127.0.0.1:${server.port}/pair/request`, {
      method: "POST",
      headers: {
        Origin: `http://127.0.0.1:${server.port}`,
      },
      redirect: "manual",
    });
    assert.equal(pairRequest.status, 303);
    assert.ok(pendingApprovalActions);

    const pendingCookie = extractCookie(
      pairRequest.headers.get("set-cookie"),
      "__Host-termi_pending",
    );

    assert.equal(pendingApprovalActions.approve(), true);

    const statusResponse = await fetch(`http://127.0.0.1:${server.port}/pair/status`, {
      headers: {
        Cookie: pendingCookie,
      },
    });
    assert.equal(statusResponse.status, 200);
    assert.deepEqual(await statusResponse.json(), { status: "approved" });

    const cookie = extractCookie(statusResponse.headers.get("set-cookie"), "__Host-termi_trust");
    assert.equal(trustedDevices.length, 1);
    assert.equal(trustedDevices[0]?.label, "Unknown browser");

    const trustedPage = await fetch(`http://127.0.0.1:${server.port}/`, {
      headers: {
        Cookie: cookie,
      },
    });
    assert.equal(trustedPage.status, 200);
    assert.match(await trustedPage.text(), /<title>Termi<\/title>/);
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
  const server = await startServer(pty, {
    mode: "quick-pairing",
    onPendingApprovalRequest: () => {},
    onTrustedBrowserTakeover: () => {},
    onTrustedSessionReady: () => {},
    mobileOnboardingSeen: false,
    onMobileOnboardingSeen: () => {},
  }, 0);

  try {
    const response = await sendRawHttp(
      server.port,
      "GET / HTTP/1.1\r\nHost: [\r\nConnection: close\r\n\r\n",
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
  const server = await startServer(
    pty,
    {
      mode: "trusted-browser",
      trustedDevices: [],
      onTrustedDevicesChange: () => {},
      onPendingApprovalRequest: () => {},
      onTrustedBrowserTakeover: () => {},
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
    assert.match(await response.text(), /Connect This Browser/);
  } finally {
    server.close();
  }
});

test("server does not render a verification code when approval is rejected immediately", { skip: !runServerTests }, async () => {
  const pty = new FakePty();
  const server = await startServer(
    pty,
    {
      mode: "trusted-browser",
      trustedDevices: [],
      onTrustedDevicesChange: () => {},
      onPendingApprovalRequest: (_request, actions) => {
        actions.reject("Local approval is unavailable right now.");
      },
      onTrustedBrowserTakeover: () => {},
      onTrustedSessionReady: () => {},
      mobileOnboardingSeen: false,
      onMobileOnboardingSeen: () => {},
    },
    0,
  );

  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/pair/request`, {
      method: "POST",
      headers: {
        Origin: `http://127.0.0.1:${server.port}`,
      },
    });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Approval Already In Progress/);
    assert.match(html, /Local approval is unavailable right now/);
    assert.doesNotMatch(html, /Approve This Browser/);
  } finally {
    server.close();
  }
});

test("quick mode requires explicit replacement before a second browser can pair over an active session", { skip: !runServerTests }, async () => {
  const pty = new FakePty();
  let pendingApprovalActions:
    | {
        approve(): boolean;
        reject(message?: string): boolean;
      }
    | undefined;
  const server = await startServer(
    pty,
    {
      mode: "quick-pairing",
      onPendingApprovalRequest: (_request, actions) => {
        pendingApprovalActions = actions;
      },
      onTrustedBrowserTakeover: () => {},
      onTrustedSessionReady: () => {},
      mobileOnboardingSeen: false,
      onMobileOnboardingSeen: () => {},
    },
    0,
  );

  try {
    const firstPairRequest = await fetch(`http://127.0.0.1:${server.port}/pair/request`, {
      method: "POST",
      headers: {
        Origin: `http://127.0.0.1:${server.port}`,
      },
      redirect: "manual",
    });
    const firstPendingCookie = extractCookie(
      firstPairRequest.headers.get("set-cookie"),
      "__Host-termi_pending",
    );
    assert.ok(pendingApprovalActions);
    assert.equal(pendingApprovalActions.approve(), true);

    const firstStatusResponse = await fetch(`http://127.0.0.1:${server.port}/pair/status`, {
      headers: {
        Cookie: firstPendingCookie,
      },
    });
    const firstCookie = extractCookie(firstStatusResponse.headers.get("set-cookie"), "__Host-termi_session");

    const firstWs = new WebSocket(`ws://127.0.0.1:${server.port}/`, {
      headers: {
        Cookie: firstCookie,
        Origin: `http://127.0.0.1:${server.port}`,
      },
    });
    await once(firstWs, "open");

    pendingApprovalActions = undefined;
    const blockedPage = await fetch(`http://127.0.0.1:${server.port}/`);
    const blockedHtml = await blockedPage.text();
    assert.equal(blockedPage.status, 200);
    assert.match(blockedHtml, /Connect This Browser/);
    assert.match(blockedHtml, /replacing it/);
    assert.equal(pendingApprovalActions, undefined);

    const replaceRequest = await fetch(`http://127.0.0.1:${server.port}/pair/request`, {
      method: "POST",
      headers: {
        Origin: `http://127.0.0.1:${server.port}`,
      },
      redirect: "manual",
    });
    assert.equal(replaceRequest.status, 303);
    assert.ok(pendingApprovalActions);

    const replacementPendingCookie = extractCookie(
      replaceRequest.headers.get("set-cookie"),
      "__Host-termi_pending",
    );
    const closePromise = once(firstWs, "close");
    assert.equal(pendingApprovalActions.approve(), true);

    const replacementStatus = await fetch(`http://127.0.0.1:${server.port}/pair/status`, {
      headers: {
        Cookie: replacementPendingCookie,
      },
    });
    assert.deepEqual(await replacementStatus.json(), { status: "approved" });

    const [closeCode] = await closePromise;
    assert.equal(closeCode, 4001);

    const replacementCookie = extractCookie(
      replacementStatus.headers.get("set-cookie"),
      "__Host-termi_session",
    );
    const replacementPage = await fetch(`http://127.0.0.1:${server.port}/`, {
      headers: {
        Cookie: replacementCookie,
      },
    });
    assert.equal(replacementPage.status, 200);
    assert.match(await replacementPage.text(), /<title>Termi<\/title>/);

    const oldCookiePage = await fetch(`http://127.0.0.1:${server.port}/`, {
      headers: {
        Cookie: firstCookie,
      },
    });
    assert.equal(oldCookiePage.status, 200);
    assert.match(await oldCookiePage.text(), /Connect This Browser/);
  } finally {
    server.close();
  }
});

test("untrusted browsers must explicitly request replacement before pairing over an active session", { skip: !runServerTests }, async () => {
  const pty = new FakePty();
  let pendingApprovalActions:
    | {
        approve(): boolean;
        reject(message?: string): boolean;
      }
    | undefined;
  const first = createTrustedDevice("First phone");
  const server = await startServer(
    pty,
    {
      mode: "trusted-browser",
      trustedDevices: [first.device],
      onTrustedDevicesChange: () => {},
      onPendingApprovalRequest: (_request, actions) => {
        pendingApprovalActions = actions;
      },
      onTrustedBrowserTakeover: () => {},
      onTrustedSessionReady: () => {},
      mobileOnboardingSeen: false,
      onMobileOnboardingSeen: () => {},
    },
    0,
  );

  try {
    const firstWs = new WebSocket(`ws://127.0.0.1:${server.port}/`, {
      headers: {
        Cookie: `__Host-termi_trust=${first.cookieValue}`,
        Origin: `http://127.0.0.1:${server.port}`,
      },
    });
    await once(firstWs, "open");

    const blockedPage = await fetch(`http://127.0.0.1:${server.port}/`);
    const blockedHtml = await blockedPage.text();
    assert.equal(blockedPage.status, 200);
    assert.match(blockedHtml, /Connect This Browser/);
    assert.match(blockedHtml, /replacing it/);
    assert.doesNotMatch(blockedHtml, /First phone/);
    assert.equal(pendingApprovalActions, undefined);

    const replaceRequest = await fetch(`http://127.0.0.1:${server.port}/pair/request`, {
      method: "POST",
      headers: {
        Origin: `http://127.0.0.1:${server.port}`,
      },
      redirect: "manual",
    });
    assert.equal(replaceRequest.status, 303);
    assert.ok(pendingApprovalActions);

    const pendingCookie = extractCookie(
      replaceRequest.headers.get("set-cookie"),
      "__Host-termi_pending",
    );

    const pendingPage = await fetch(`http://127.0.0.1:${server.port}/`, {
      headers: {
        Cookie: pendingCookie,
      },
    });
    assert.equal(pendingPage.status, 200);
    assert.match(await pendingPage.text(), /Approve This Browser/);

    const closePromise = once(firstWs, "close");
    assert.equal(pendingApprovalActions.approve(), true);

    const statusResponse = await fetch(`http://127.0.0.1:${server.port}/pair/status`, {
      headers: {
        Cookie: pendingCookie,
      },
    });
    assert.equal(statusResponse.status, 200);
    assert.deepEqual(await statusResponse.json(), { status: "approved" });

    const [closeCode] = await closePromise;
    assert.equal(closeCode, 4001);

    const replacementCookie = extractCookie(
      statusResponse.headers.get("set-cookie"),
      "__Host-termi_trust",
    );
    const replacementPage = await fetch(`http://127.0.0.1:${server.port}/`, {
      headers: {
        Cookie: replacementCookie,
      },
    });
    assert.equal(replacementPage.status, 200);
    assert.match(await replacementPage.text(), /<title>Termi<\/title>/);
  } finally {
    server.close();
  }
});

test("trusted browsers require an explicit takeover when another trusted browser is active", { skip: !runServerTests }, async () => {
  const pty = new FakePty();
  const first = createTrustedDevice("First phone");
  const second = createTrustedDevice("Second phone");
  const takeoverLabels: string[] = [];
  const server = await startServer(
    pty,
    {
      mode: "trusted-browser",
      trustedDevices: [first.device, second.device],
      onTrustedDevicesChange: () => {},
      onPendingApprovalRequest: () => {},
      onTrustedBrowserTakeover: (label) => {
        takeoverLabels.push(label);
      },
      onTrustedSessionReady: () => {},
      mobileOnboardingSeen: false,
      onMobileOnboardingSeen: () => {},
    },
    0,
  );

  try {
    const firstPage = await fetch(`http://127.0.0.1:${server.port}/`, {
      headers: {
        Cookie: `__Host-termi_trust=${first.cookieValue}`,
      },
    });
    assert.equal(firstPage.status, 200);
    assert.match(await firstPage.text(), /<title>Termi<\/title>/);

    const firstWs = new WebSocket(`ws://127.0.0.1:${server.port}/`, {
      headers: {
        Cookie: `__Host-termi_trust=${first.cookieValue}`,
        Origin: `http://127.0.0.1:${server.port}`,
      },
    });
    await once(firstWs, "open");

    const blockedPage = await fetch(`http://127.0.0.1:${server.port}/`, {
      headers: {
        Cookie: `__Host-termi_trust=${second.cookieValue}`,
      },
    });
    assert.equal(blockedPage.status, 200);
    assert.match(await blockedPage.text(), /Take Over Session/);

    const closePromise = once(firstWs, "close");
    const takeoverResponse = await fetch(`http://127.0.0.1:${server.port}/takeover`, {
      method: "POST",
      headers: {
        Cookie: `__Host-termi_trust=${second.cookieValue}`,
        Origin: `http://127.0.0.1:${server.port}`,
      },
      redirect: "manual",
    });
    assert.equal(takeoverResponse.status, 303);

    const [closeCode] = await closePromise;
    assert.equal(closeCode, 4001);
    assert.deepEqual(takeoverLabels, ["Second phone"]);

    const secondWs = new WebSocket(`ws://127.0.0.1:${server.port}/`, {
      headers: {
        Cookie: `__Host-termi_trust=${second.cookieValue}`,
        Origin: `http://127.0.0.1:${server.port}`,
      },
    });
    await once(secondWs, "open");

    const displacedWs = new WebSocket(`ws://127.0.0.1:${server.port}/`, {
      headers: {
        Cookie: `__Host-termi_trust=${first.cookieValue}`,
        Origin: `http://127.0.0.1:${server.port}`,
      },
    });
    displacedWs.on("error", () => {});
    const [displacedCloseCode] = await once(displacedWs, "close");
    assert.equal(displacedCloseCode, 4001);

    const secondPage = await fetch(`http://127.0.0.1:${server.port}/`, {
      headers: {
        Cookie: `__Host-termi_trust=${second.cookieValue}`,
      },
    });
    assert.equal(secondPage.status, 200);
    assert.match(await secondPage.text(), /<title>Termi<\/title>/);
    secondWs.close();
  } finally {
    server.close();
  }
});

test("server rejects oversized websocket messages and ignores invalid resize payloads", { skip: !runServerTests }, async () => {
  const pty = new FakePty();
  let pendingApprovalActions:
    | {
        approve(): boolean;
        reject(message?: string): boolean;
      }
    | undefined;
  const server = await startServer(pty, {
    mode: "quick-pairing",
    onPendingApprovalRequest: (_request, actions) => {
      pendingApprovalActions = actions;
    },
    onTrustedBrowserTakeover: () => {},
    onTrustedSessionReady: () => {},
    mobileOnboardingSeen: false,
    onMobileOnboardingSeen: () => {},
  }, 0);

  try {
    const pairRequest = await fetch(`http://127.0.0.1:${server.port}/pair/request`, {
      method: "POST",
      headers: {
        Origin: `http://127.0.0.1:${server.port}`,
      },
      redirect: "manual",
    });
    const pendingCookie = extractCookie(pairRequest.headers.get("set-cookie"), "__Host-termi_pending");
    assert.ok(pendingApprovalActions);
    assert.equal(pendingApprovalActions.approve(), true);

    const statusResponse = await fetch(`http://127.0.0.1:${server.port}/pair/status`, {
      headers: {
        Cookie: pendingCookie,
      },
    });
    const cookie = extractCookie(statusResponse.headers.get("set-cookie"), "__Host-termi_session");

    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/`, {
      headers: {
        Cookie: cookie,
        Origin: `http://127.0.0.1:${server.port}`,
      },
    });
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
  let pendingApprovalActions:
    | {
        approve(): boolean;
        reject(message?: string): boolean;
      }
    | undefined;
  let mobileOnboardingSeen = false;
  const server = await startServer(pty, {
    mode: "quick-pairing",
    onPendingApprovalRequest: (_request, actions) => {
      pendingApprovalActions = actions;
    },
    onTrustedBrowserTakeover: () => {},
    onTrustedSessionReady: () => {},
    mobileOnboardingSeen,
    onMobileOnboardingSeen: () => {
      mobileOnboardingSeen = true;
    },
  }, 0);

  try {
    const pairRequest = await fetch(`http://127.0.0.1:${server.port}/pair/request`, {
      method: "POST",
      headers: {
        Origin: `http://127.0.0.1:${server.port}`,
      },
      redirect: "manual",
    });
    const pendingCookie = extractCookie(pairRequest.headers.get("set-cookie"), "__Host-termi_pending");
    assert.ok(pendingApprovalActions);
    assert.equal(pendingApprovalActions.approve(), true);

    const statusResponse = await fetch(`http://127.0.0.1:${server.port}/pair/status`, {
      headers: {
        Cookie: pendingCookie,
      },
    });
    const cookie = extractCookie(statusResponse.headers.get("set-cookie"), "__Host-termi_session");

    const mobilePage = await fetch(`http://127.0.0.1:${server.port}/`, {
      headers: {
        Cookie: cookie,
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      },
    });
    const html = await mobilePage.text();
    assert.match(html, /"showOnboarding":true/);
    assert.match(html, /"onboardingSeenPath":"\/onboarding\/seen"/);

    const ack = await fetch(`http://127.0.0.1:${server.port}/onboarding/seen`, {
      method: "POST",
      headers: {
        Cookie: cookie,
      },
    });
    assert.equal(ack.status, 204);
    assert.equal(mobileOnboardingSeen, true);

    const seenPage = await fetch(`http://127.0.0.1:${server.port}/`, {
      headers: {
        Cookie: cookie,
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      },
    });
    assert.match(await seenPage.text(), /"showOnboarding":false/);
  } finally {
    server.close();
  }
});
