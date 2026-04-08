import test from "node:test";
import assert from "node:assert/strict";
import { parseTunnelUrl, waitForTunnelReady } from "../src/tunnel.ts";

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
