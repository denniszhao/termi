import test from "node:test";
import assert from "node:assert/strict";
import { createPairingManager } from "../src/pairing.ts";

test("pairing manager accepts the current code and rotates after success", () => {
  const seenCodes: string[] = [];
  const pairing = createPairingManager((code) => {
    seenCodes.push(code);
  });

  const firstCode = pairing.getCode();
  assert.equal(pairing.verify(firstCode).ok, true);
  assert.notEqual(pairing.getCode(), firstCode);
  assert.equal(seenCodes.length >= 1, true);
});

test("pairing manager rejects invalid codes", () => {
  const pairing = createPairingManager();
  assert.deepEqual(pairing.verify("WRONG1"), { ok: false, error: "invalid" });
});
