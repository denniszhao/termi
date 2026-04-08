import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { parseTunnelUrl, waitForNamedTunnelConnection, waitForTunnelReady } from "../src/tunnel.ts";

class FakeTunnelProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;

  kill(): boolean {
    this.killed = true;
    return true;
  }
}

test("parseTunnelUrl extracts a trycloudflare URL from JSON log output", () => {
  const line = JSON.stringify({
    message: "Your quick Tunnel has been created! Visit https://abc-123.trycloudflare.com",
  });
  assert.equal(parseTunnelUrl(line), "https://abc-123.trycloudflare.com");
});

test("parseTunnelUrl extracts a trycloudflare URL from plain text output", () => {
  const line = "INF | Connected at https://hello-world.trycloudflare.com";
  assert.equal(parseTunnelUrl(line), "https://hello-world.trycloudflare.com");
});

test("parseTunnelUrl returns null when no URL is present", () => {
  assert.equal(parseTunnelUrl("no tunnel url here"), null);
});

test("waitForTunnelReady returns true when the health check succeeds", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("ok", { status: 200 });

  try {
    assert.equal(await waitForTunnelReady("https://example.com", 10), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("waitForTunnelReady returns false when the timeout expires", async () => {
  assert.equal(await waitForTunnelReady("https://example.com", 0), false);
});

test("waitForNamedTunnelConnection resolves once cloudflared registers the tunnel", async () => {
  const proc = new FakeTunnelProcess();
  const handlePromise = waitForNamedTunnelConnection(
    proc as Parameters<typeof waitForNamedTunnelConnection>[0],
    "termi.example.com",
  );

  proc.stderr.write("2026-04-09T10:00:00Z INF Registered tunnel connection connIndex=0\n");

  const handle = await handlePromise;
  assert.equal(handle.url, "https://termi.example.com");

  handle.kill();
  assert.equal(proc.killed, true);
});
