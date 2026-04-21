import {
  TRUSTED_DEVICE_COOKIE,
  addTrustedDevice,
  touchTrustedDevice,
} from "./trusted-devices.js";
import type { TrustedDevice } from "./types.js";

export const QUICK_SESSION_COOKIE = "__Host-termi_session";
const QUICK_SESSION_TTL_SECONDS = 24 * 60 * 60;
const TRUSTED_DEVICE_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface AuthStrategy {
  readonly cookieName: string;
  readonly cookieMaxAgeSeconds: number | undefined;
  getKnownBrowsers(): TrustedDevice[];
  addApprovedBrowser(device: TrustedDevice): void;
  touchBrowser(deviceId: string): void;
}

export function createQuickPairingStrategy(): AuthStrategy {
  let current: TrustedDevice | null = null;

  return {
    cookieName: QUICK_SESSION_COOKIE,
    cookieMaxAgeSeconds: QUICK_SESSION_TTL_SECONDS,
    getKnownBrowsers: () => (current ? [current] : []),
    addApprovedBrowser: (device) => {
      current = device;
    },
    touchBrowser: (deviceId) => {
      if (current && current.id === deviceId) {
        current = { ...current, lastSeenAt: new Date().toISOString() };
      }
    },
  };
}

export function createTrustedBrowserStrategy(options: {
  initialDevices: TrustedDevice[];
  onChange: (devices: TrustedDevice[]) => void;
}): AuthStrategy {
  let devices = [...options.initialDevices];

  function persist(next: TrustedDevice[]): void {
    devices = next;
    options.onChange(devices);
  }

  return {
    cookieName: TRUSTED_DEVICE_COOKIE,
    cookieMaxAgeSeconds: TRUSTED_DEVICE_TTL_SECONDS,
    getKnownBrowsers: () => devices,
    addApprovedBrowser: (device) => {
      persist(addTrustedDevice(devices, device));
    },
    touchBrowser: (deviceId) => {
      persist(touchTrustedDevice(devices, deviceId));
    },
  };
}
