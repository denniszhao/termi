import { cancel, confirm, isCancel, select } from "@clack/prompts";
import { clearTrustedDevices, listTrustedDevices, removeTrustedDevice } from "../config.js";
import { formatTrustedDevice } from "../trusted-device-display.js";

const REVOKE_ALL = "__all__";

function handleCancel<T>(value: T): asserts value is Exclude<T, symbol> {
  if (isCancel(value)) {
    cancel("Cancelled.");
    process.exit(0);
  }
}

function compareTrustedDevices(a: { lastSeenAt: string }, b: { lastSeenAt: string }): number {
  return b.lastSeenAt.localeCompare(a.lastSeenAt);
}

export async function revokeCommand(): Promise<void> {
  const trustedDevices = listTrustedDevices().sort(compareTrustedDevices);

  if (trustedDevices.length === 0) {
    console.log("No trusted devices.");
    return;
  }

  const selection = await select({
    message: "Which trusted device should be revoked?",
    options: [
      ...trustedDevices.map((device) => ({
        value: device.id,
        label: formatTrustedDevice(device),
      })),
      {
        value: REVOKE_ALL,
        label: "All trusted devices",
      },
    ],
  });
  handleCancel(selection);

  const revokeAll = selection === REVOKE_ALL;
  const confirmed = await confirm({
    message: revokeAll
      ? "Revoke all trusted devices?"
      : "Revoke this trusted device?",
    initialValue: false,
  });
  handleCancel(confirmed);

  if (!confirmed) {
    cancel("Cancelled.");
    process.exit(0);
  }

  if (revokeAll) {
    clearTrustedDevices();
    console.log("All trusted devices revoked.");
    return;
  }

  if (!removeTrustedDevice(selection)) {
    console.log("Trusted device not found.");
    return;
  }

  console.log("Trusted device revoked.");
}
