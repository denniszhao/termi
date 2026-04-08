import test from "node:test";
import assert from "node:assert/strict";
import {
  addTrustedDevice,
  createTrustedDevice,
  inferTrustedDeviceLabel,
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

test("trusted device labels are inferred from mobile browser headers", () => {
  assert.equal(
    inferTrustedDeviceLabel({
      "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    }),
    "iPhone Safari",
  );

  assert.equal(
    inferTrustedDeviceLabel({
      "user-agent": "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36",
      "sec-ch-ua-mobile": "?1",
    }),
    "Android phone Chrome",
  );
});
