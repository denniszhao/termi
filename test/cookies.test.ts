import test from "node:test";
import assert from "node:assert/strict";
import { parseCookies, serializeCookie } from "../src/cookies.ts";

test("parseCookies ignores malformed cookie encodings", () => {
  assert.deepEqual(parseCookies("valid=ok; broken=%E0%A4%A"), {
    valid: "ok",
  });
});

test("serializeCookie includes both Max-Age and Expires for persistent cookies", () => {
  const originalNow = Date.now;
  Date.now = () => Date.parse("2026-04-21T08:16:43Z");

  try {
    const cookie = serializeCookie("__Host-termi_trust", "abc.def", 30 * 24 * 60 * 60);
    assert.match(cookie, /__Host-termi_trust=abc\.def/);
    assert.match(cookie, /Max-Age=2592000/);
    assert.match(cookie, /Expires=Thu, 21 May 2026 08:16:43 GMT/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Secure/);
  } finally {
    Date.now = originalNow;
  }
});
