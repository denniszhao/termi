import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { TermiSavedConfig } from "./types.js";

const CONFIG_DIR = join(homedir(), ".termi");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export function configDir(): string {
  mkdirSync(CONFIG_DIR, { recursive: true });
  return CONFIG_DIR;
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
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

export function resetConfig(): void {
  if (existsSync(CONFIG_PATH)) {
    unlinkSync(CONFIG_PATH);
  }
}

export function certPath(): string {
  return join(configDir(), "cert.pem");
}

export function credentialsPath(): string {
  return join(configDir(), "credentials.json");
}
