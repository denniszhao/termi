import { execSync } from "node:child_process";
import { existsSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const KNOWN_PATHS = [
  "/usr/local/bin/cloudflared",
  "/opt/homebrew/bin/cloudflared",
];

export function findCloudflared(): string | null {
  try {
    const result = execSync("which cloudflared", { encoding: "utf-8" }).trim();
    if (result) return result;
  } catch {
    // not in PATH
  }

  for (const p of KNOWN_PATHS) {
    if (existsSync(p)) return p;
  }

  return null;
}

function getDownloadUrl(): string {
  const platform = process.platform;
  const arch = process.arch;

  let os: string;
  if (platform === "darwin") os = "darwin";
  else if (platform === "linux") os = "linux";
  else throw new Error(`Unsupported platform: ${platform}`);

  let cpu: string;
  if (arch === "arm64") cpu = "arm64";
  else if (arch === "x64") cpu = "amd64";
  else throw new Error(`Unsupported architecture: ${arch}`);

  return `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-${os}-${cpu}`;
}

export async function downloadCloudflared(): Promise<string> {
  const dir = join(homedir(), ".termi", "bin");
  const dest = join(dir, "cloudflared");

  mkdirSync(dir, { recursive: true });

  const url = getDownloadUrl();
  execSync(`curl -fsSL "${url}" -o "${dest}"`, { stdio: "pipe" });
  chmodSync(dest, 0o755);

  return dest;
}
