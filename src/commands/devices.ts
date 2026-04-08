import { listTrustedDevices } from "../config.js";
import { formatTrustedDevice } from "../trusted-device-display.js";

function compareTrustedDevices(a: { lastSeenAt: string }, b: { lastSeenAt: string }): number {
  return b.lastSeenAt.localeCompare(a.lastSeenAt);
}

export async function devicesCommand(): Promise<void> {
  const trustedDevices = listTrustedDevices().sort(compareTrustedDevices);

  if (trustedDevices.length === 0) {
    console.log("No trusted devices.");
    return;
  }

  console.log("Trusted devices:");
  for (const device of trustedDevices) {
    console.log(`  ${formatTrustedDevice(device)}`);
  }
}
