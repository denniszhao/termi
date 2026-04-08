import test from "node:test";
import assert from "node:assert/strict";
import { generateToken, validateToken } from "../src/auth.ts";

test("generateToken returns a non-empty base64url token", () => {
  const token = generateToken();
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.ok(token.length > 10);
});

test("validateToken accepts exact matches and rejects invalid input", () => {
  const token = generateToken();
  assert.equal(validateToken(token, token), true);
  assert.equal(validateToken(null, token), false);
  assert.equal(validateToken(`${token}x`, token), false);
  assert.equal(validateToken(token.slice(0, -1), token), false);
});

