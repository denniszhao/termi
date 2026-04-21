import test from "node:test";
import assert from "node:assert/strict";
import { createTerminalSocket } from "../src/web/socket.ts";

class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.OPEN;
  onclose?: (event: { code: number }) => void;
  onerror?: () => void;
  onmessage?: (event: { data: string }) => void;
  onopen?: () => void;
  sent: string[] = [];
  closeCalls = 0;

  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closeCalls += 1;
  }
}

test("stale websocket close events do not replace the current session", () => {
  const previousWindow = globalThis.window;
  const previousWebSocket = globalThis.WebSocket;
  const timers: Array<() => void> = [];
  const states: string[] = [];
  let replacedCount = 0;
  let openCount = 0;

  FakeWebSocket.instances = [];
  (globalThis as { WebSocket?: typeof FakeWebSocket }).WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  (globalThis as { window?: Window & typeof globalThis }).window = {
    setTimeout: ((cb: () => void) => {
      timers.push(cb);
      return timers.length;
    }) as typeof setTimeout,
  } as Window & typeof globalThis;

  try {
    const socket = createTerminalSocket({
      wsUrl: "ws://example.test/",
      onData: () => {},
      onOpen: () => {
        openCount += 1;
      },
      onSessionReplaced: () => {
        replacedCount += 1;
      },
      onStateChange: (state) => {
        states.push(state);
      },
    });

    socket.connect();
    const first = FakeWebSocket.instances[0]!;
    first.onopen?.();
    first.onclose?.({ code: 1006 });

    assert.equal(timers.length, 1);
    timers[0]!();

    const second = FakeWebSocket.instances[1]!;
    second.onopen?.();
    first.onclose?.({ code: 4001 });

    assert.equal(openCount, 2);
    assert.equal(replacedCount, 0);
    assert.deepEqual(states, ["connecting", "connected", "disconnected", "reconnecting", "connecting", "connected"]);
  } finally {
    (globalThis as { WebSocket?: typeof WebSocket }).WebSocket = previousWebSocket;
    (globalThis as { window?: Window & typeof globalThis }).window = previousWindow;
  }
});

test("stale websocket errors do not close the current connection", () => {
  const previousWindow = globalThis.window;
  const previousWebSocket = globalThis.WebSocket;

  FakeWebSocket.instances = [];
  (globalThis as { WebSocket?: typeof FakeWebSocket }).WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  (globalThis as { window?: Window & typeof globalThis }).window = globalThis as Window & typeof globalThis;

  try {
    const socket = createTerminalSocket({
      wsUrl: "ws://example.test/",
      onData: () => {},
      onOpen: () => {},
      onSessionReplaced: () => {},
      onStateChange: () => {},
    });

    socket.connect();
    const first = FakeWebSocket.instances[0]!;
    socket.connect();
    const second = FakeWebSocket.instances[1]!;

    first.onerror?.();

    assert.equal(first.closeCalls, 0);
    assert.equal(second.closeCalls, 0);
  } finally {
    (globalThis as { WebSocket?: typeof WebSocket }).WebSocket = previousWebSocket;
    (globalThis as { window?: Window & typeof globalThis }).window = previousWindow;
  }
});

test("session replacement closes do not schedule reconnects", () => {
  const previousWindow = globalThis.window;
  const previousWebSocket = globalThis.WebSocket;
  const timers: Array<() => void> = [];
  const states: string[] = [];
  let replacedCount = 0;

  FakeWebSocket.instances = [];
  (globalThis as { WebSocket?: typeof FakeWebSocket }).WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  (globalThis as { window?: Window & typeof globalThis }).window = {
    setTimeout: ((cb: () => void) => {
      timers.push(cb);
      return timers.length;
    }) as typeof setTimeout,
  } as Window & typeof globalThis;

  try {
    const socket = createTerminalSocket({
      wsUrl: "ws://example.test/",
      onData: () => {},
      onOpen: () => {},
      onSessionReplaced: () => {
        replacedCount += 1;
      },
      onStateChange: (state) => {
        states.push(state);
      },
    });

    socket.connect();
    const first = FakeWebSocket.instances[0]!;
    first.onopen?.();
    first.onclose?.({ code: 4001 });

    assert.equal(replacedCount, 1);
    assert.equal(timers.length, 0);
    assert.deepEqual(states, ["connecting", "connected", "disconnected"]);
  } finally {
    (globalThis as { WebSocket?: typeof WebSocket }).WebSocket = previousWebSocket;
    (globalThis as { window?: Window & typeof globalThis }).window = previousWindow;
  }
});
