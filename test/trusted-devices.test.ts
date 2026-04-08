import test from "node:test";
import assert from "node:assert/strict";
import {
  addTrustedDevice,
  createTrustedDevice,
  touchTrustedDevice,
  verifyTrustedDeviceCookie,
} from "../src/trusted-devices.ts";

test("trusted device cookie verifies against the stored device", () => {
  const created = createTrustedDevice();
  const trustedDevices = addTrustedDevice([], created.device);
  assert.deepEqual(verifyTrustedDeviceCookie(created.cookieValue, trustedDevices), created.device);
});

test("trusted device cookie rejects tampered secrets", () => {
  const created = createTrustedDevice();
  const trustedDevices = addTrustedDevice([], created.device);
  assert.equal(
    verifyTrustedDeviceCookie(`${created.device.id}.tampered`, trustedDevices),
    null,
  );
});

test("touchTrustedDevice updates the last seen time", async () => {
  const created = createTrustedDevice();
  const staleDevice = {
    ...created.device,
    lastSeenAt: "2000-01-01T00:00:00.000Z",
  };
  const touched = touchTrustedDevice([staleDevice], staleDevice.id);
  assert.equal(touched[0].id, created.device.id);
  assert.notEqual(touched[0].lastSeenAt, staleDevice.lastSeenAt);
});
