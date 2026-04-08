import type { IncomingHttpHeaders } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { TrustedDevice } from "./types.js";

export const TRUSTED_DEVICE_COOKIE = "__Host-termi_trust";

export function createTrustedDevice(label?: string): { device: TrustedDevice; cookieValue: string } {
  const id = randomBytes(12).toString("base64url");
  const secret = randomBytes(24).toString("base64url");
  const now = new Date().toISOString();

  return {
    device: {
      id,
      secretHash: hashSecret(secret),
      createdAt: now,
      lastSeenAt: now,
      ...(label ? { label } : {}),
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

export function inferTrustedDeviceLabel(headers: IncomingHttpHeaders): string {
  const userAgent = getHeaderValue(headers["user-agent"]).toLowerCase();
  const platformHint = getHeaderValue(headers["sec-ch-ua-platform"]).replaceAll("\"", "").toLowerCase();
  const mobileHint = getHeaderValue(headers["sec-ch-ua-mobile"]).toLowerCase();

  const browser = inferBrowser(userAgent);
  const device = inferDevice(userAgent, platformHint, mobileHint);

  if (device && browser) {
    return `${device} ${browser}`;
  }
  if (browser) {
    return browser;
  }
  if (device) {
    return device;
  }

  return "Unknown browser";
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("base64url");
}

function getHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

function inferBrowser(userAgent: string): string {
  if (userAgent.includes("edg/")) {
    return "Edge";
  }
  if (userAgent.includes("firefox/")) {
    return "Firefox";
  }
  if (userAgent.includes("crios/")) {
    return "Chrome";
  }
  if (userAgent.includes("fxios/")) {
    return "Firefox";
  }
  if (userAgent.includes("chrome/") || userAgent.includes("chromium/")) {
    return "Chrome";
  }
  if (userAgent.includes("safari/")) {
    return "Safari";
  }

  return "";
}

function inferDevice(userAgent: string, platformHint: string, mobileHint: string): string {
  if (userAgent.includes("iphone") || userAgent.includes("ipod")) {
    return "iPhone";
  }
  if (userAgent.includes("ipad")) {
    return "iPad";
  }
  if (userAgent.includes("android")) {
    return mobileHint === "?1" || userAgent.includes("mobile")
      ? "Android phone"
      : "Android tablet";
  }
  if (platformHint.includes("android")) {
    return mobileHint === "?1" ? "Android phone" : "Android tablet";
  }
  if (userAgent.includes("mac os x") || platformHint.includes("mac")) {
    return "Mac";
  }
  if (userAgent.includes("windows") || platformHint.includes("windows")) {
    return "Windows PC";
  }
  if (userAgent.includes("linux") || platformHint.includes("linux")) {
    return "Linux PC";
  }

  return mobileHint === "?1" ? "Mobile" : "";
}
