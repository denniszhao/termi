import test from "node:test";
import assert from "node:assert/strict";
import { createPairingManager } from "../src/pairing.ts";

test("pairing manager accepts the current code and rotates after success", () => {
  const seenChanges: Array<{ code: string; reason: string }> = [];
  const pairing = createPairingManager((code, reason) => {
    seenChanges.push({ code, reason });
  });

  const firstCode = pairing.getCode();
  assert.equal(pairing.verify(firstCode).ok, true);
  assert.notEqual(pairing.getCode(), firstCode);
  assert.equal(seenChanges.length >= 1, true);
  assert.equal(seenChanges[0]?.reason, "verified");
});

test("pairing manager rejects invalid codes", () => {
  const pairing = createPairingManager();
  assert.deepEqual(pairing.verify("WRONG1"), { ok: false, error: "invalid" });
});

test("pairing manager accepts lowercase input for the current code", () => {
  const pairing = createPairingManager();
  const code = pairing.getCode();
  assert.equal(pairing.verify(code.toLowerCase()).ok, true);
});

test("pairing manager refreshes expired codes when the code is requested again", () => {
  const seenChanges: Array<{ code: string; reason: string }> = [];
  const originalNow = Date.now;
  let now = 1_000;

  Date.now = () => now;
  try {
    const pairing = createPairingManager((code, reason) => {
      seenChanges.push({ code, reason });
    });
    const firstCode = pairing.getCode();

    now += 10 * 60 * 1000 + 1;
    const nextCode = pairing.getCode();

    assert.notEqual(nextCode, firstCode);
    assert.deepEqual(seenChanges.map((entry) => entry.reason), ["expired"]);
  } finally {
    Date.now = originalNow;
  }
});
