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
import type { TermiSavedConfig } from "./types.js";

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
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveConfig(config: TermiSavedConfig): void {
  writeSecureFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
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
