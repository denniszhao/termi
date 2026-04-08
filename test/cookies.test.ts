import test from "node:test";
import assert from "node:assert/strict";
import { parseCookies } from "../src/cookies.ts";

test("parseCookies ignores malformed cookie encodings", () => {
  assert.deepEqual(parseCookies("valid=ok; broken=%E0%A4%A"), {
    valid: "ok",
  });
});
