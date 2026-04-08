import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { TrustedDevice } from "./types.js";

export const TRUSTED_DEVICE_COOKIE = "__Host-termi_trust";

export function createTrustedDevice(): { device: TrustedDevice; cookieValue: string } {
  const id = randomBytes(12).toString("base64url");
  const secret = randomBytes(24).toString("base64url");
  const now = new Date().toISOString();

  return {
    device: {
      id,
      secretHash: hashSecret(secret),
      createdAt: now,
      lastSeenAt: now,
    },
    cookieValue: `${id}.${secret}`,
  };
}

export function verifyTrustedDeviceCookie(
  cookieValue: string | undefined,
  trustedDevices: TrustedDevice[],
): TrustedDevice | null {
  if (!cookieValue) {
    return null;
  }

  const [id, secret] = cookieValue.split(".");
  if (!id || !secret) {
    return null;
  }

  const device = trustedDevices.find((entry) => entry.id === id);
  if (!device) {
    return null;
  }

  const expected = Buffer.from(device.secretHash);
  const candidate = Buffer.from(hashSecret(secret));
  if (expected.length !== candidate.length) {
    return null;
  }

  return timingSafeEqual(expected, candidate) ? device : null;
}

export function addTrustedDevice(
  trustedDevices: TrustedDevice[],
  device: TrustedDevice,
): TrustedDevice[] {
  return [...trustedDevices.filter((entry) => entry.id !== device.id), device];
}

export function touchTrustedDevice(
  trustedDevices: TrustedDevice[],
  deviceId: string,
): TrustedDevice[] {
  const now = new Date().toISOString();
  return trustedDevices.map((device) =>
    device.id === deviceId
      ? { ...device, lastSeenAt: now }
      : device,
  );
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("base64url");
}

