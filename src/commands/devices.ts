import { listTrustedDevices } from "../config.js";
import { compareTrustedDevices, formatTrustedDevice } from "../trusted-device-display.js";

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
