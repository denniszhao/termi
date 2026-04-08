import test from "node:test";
import assert from "node:assert/strict";
import { createPairingCodeAnnouncer } from "../src/pairing-announcer.ts";

test("pairing announcer suppresses duplicate announcements for the same code", () => {
  const seenCodes: string[] = [];
  const announcer = createPairingCodeAnnouncer((code) => {
    seenCodes.push(code);
  });

  announcer.announce("ABC123");
  announcer.announce("ABC123");
  announcer.announce("XYZ789");

  assert.deepEqual(seenCodes, ["ABC123", "XYZ789"]);
});
