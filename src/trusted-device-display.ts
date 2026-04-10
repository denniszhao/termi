import type { TrustedDevice } from "./types.js";

export function compareTrustedDevices(a: { lastSeenAt: string }, b: { lastSeenAt: string }): number {
  return b.lastSeenAt.localeCompare(a.lastSeenAt);
}

export function formatTrustedDevice(device: TrustedDevice): string {
  const label = device.label ? `${device.label}  ` : "";
  return `${label}${shortTrustedDeviceId(device.id)}  last seen ${formatTrustedDeviceTime(device.lastSeenAt)}  created ${formatTrustedDeviceTime(device.createdAt)}`;
}

function shortTrustedDeviceId(id: string): string {
  return id.slice(0, 8);
}

function formatTrustedDeviceTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value || "unknown";
  }

  return `${parsed.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
