import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { TermiSavedConfig, TrustedDevice } from "./types.js";

const CONFIG_DIR = join(homedir(), ".termi");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
const TMP_DIR = join(CONFIG_DIR, "tmp");
const CONFIG_DIR_MODE = 0o700;
const CONFIG_FILE_MODE = 0o600;

function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true, mode: CONFIG_DIR_MODE });
  chmodSync(path, CONFIG_DIR_MODE);
  return path;
}

export function configDir(): string {
  return ensureDir(CONFIG_DIR);
}

export function loadConfig(): TermiSavedConfig | null {
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    return normalizeConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveConfig(config: TermiSavedConfig): void {
  writeSecureFile(CONFIG_PATH, JSON.stringify(normalizeConfig(config), null, 2) + "\n");
}

export function listTrustedDevices(): TrustedDevice[] {
  return loadConfig()?.trustedDevices ?? [];
}

export function removeTrustedDevice(deviceId: string): boolean {
  const config = loadConfig();
  if (!config) {
    return false;
  }

  const nextTrustedDevices = config.trustedDevices.filter((device) => device.id !== deviceId);
  if (nextTrustedDevices.length === config.trustedDevices.length) {
    return false;
  }

  saveConfig({
    ...config,
    trustedDevices: nextTrustedDevices,
  });
  return true;
}

export function clearTrustedDevices(): number {
  const config = loadConfig();
  if (!config) {
    return 0;
  }

  const count = config.trustedDevices.length;
  if (count === 0) {
    return 0;
  }

  saveConfig({
    ...config,
    trustedDevices: [],
  });
  return count;
}

export function resetPersistentState(): void {
  if (existsSync(CONFIG_PATH)) {
    unlinkSync(CONFIG_PATH);
  }
  if (existsSync(certPath())) {
    unlinkSync(certPath());
  }
  if (existsSync(credentialsPath())) {
    unlinkSync(credentialsPath());
  }
  if (existsSync(TMP_DIR)) {
    rmSync(TMP_DIR, { recursive: true, force: true });
  }
}

export function tmpDir(): string {
  return ensureDir(TMP_DIR);
}

export function writeSecureFile(path: string, contents: string | Uint8Array): void {
  configDir();
  writeFileSync(path, contents, { mode: CONFIG_FILE_MODE });
  chmodSync(path, CONFIG_FILE_MODE);
}

export function copySecureFile(from: string, to: string): void {
  configDir();
  copyFileSync(from, to);
  chmodSync(to, CONFIG_FILE_MODE);
}

export function certPath(): string {
  return join(CONFIG_DIR, "cert.pem");
}

export function credentialsPath(): string {
  return join(CONFIG_DIR, "credentials.json");
}

function normalizeConfig(config: Partial<TermiSavedConfig>): TermiSavedConfig {
  return {
    tunnel: {
      id: String(config.tunnel?.id || ""),
      name: String(config.tunnel?.name || ""),
      domain: String(config.tunnel?.domain || ""),
    },
    trustedDevices: normalizeTrustedDevices(config.trustedDevices),
  };
}

function normalizeTrustedDevices(devices: unknown): TrustedDevice[] {
  if (!Array.isArray(devices)) {
    return [];
  }

  return devices.flatMap((device) => {
    if (!device || typeof device !== "object") {
      return [];
    }

    const trustedDevice = device as Partial<TrustedDevice>;
    if (!trustedDevice.id || !trustedDevice.secretHash) {
      return [];
    }

    return [{
      id: String(trustedDevice.id),
      secretHash: String(trustedDevice.secretHash),
      createdAt: String(trustedDevice.createdAt || ""),
      lastSeenAt: String(trustedDevice.lastSeenAt || trustedDevice.createdAt || ""),
    }];
  });
}
