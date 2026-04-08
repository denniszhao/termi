import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { tmpDir, writeSecureFile } from "./config.js";

const KNOWN_PATHS = [
  "/usr/local/bin/cloudflared",
  "/opt/homebrew/bin/cloudflared",
];
const CLOUDFLARED_VERSION = "2026.3.0";

interface ArtifactSpec {
  filename: string;
  sha256: string;
  compressed: boolean;
}

const ARTIFACTS: Record<string, ArtifactSpec> = {
  "darwin-arm64": {
    filename: "cloudflared-darwin-arm64.tgz",
    sha256: "2aae4f69b0fc1c671b8353b4f594cbd902cd1e360c8eed2b8cad4602cb1546fb",
    compressed: true,
  },
  "darwin-x64": {
    filename: "cloudflared-darwin-amd64.tgz",
    sha256: "0f30140c4a5e213d22f951ef4c964cac5fb6a5f061ba6eba5ea932999f7c0394",
    compressed: true,
  },
  "linux-arm64": {
    filename: "cloudflared-linux-arm64",
    sha256: "0755ba4cbab59980e6148367fcf53a8f3ec85a97deefd63c2420cf7850769bee",
    compressed: false,
  },
  "linux-x64": {
    filename: "cloudflared-linux-amd64",
    sha256: "4a9e50e6d6d798e90fcd01933151a90bf7edd99a0a55c28ad18f2e16263a5c30",
    compressed: false,
  },
};

export function findCloudflared(): string | null {
  try {
    const result = execFileSync("which", ["cloudflared"], { encoding: "utf-8" }).trim();
    if (result) return result;
  } catch {
    // not in PATH
  }

  for (const p of KNOWN_PATHS) {
    if (existsSync(p)) return p;
  }

  return null;
}

function getArtifactSpec(): ArtifactSpec {
  const key = `${process.platform}-${process.arch}`;
  const spec = ARTIFACTS[key];
  if (!spec) {
    throw new Error(`Unsupported platform or architecture: ${process.platform}/${process.arch}`);
  }
  return spec;
}

function getDownloadUrl(spec: ArtifactSpec): string {
  return `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/${spec.filename}`;
}

function sha256File(path: string): string {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

function verifyChecksum(path: string, expected: string): void {
  const actual = sha256File(path);
  if (actual !== expected) {
    throw new Error(`Checksum verification failed for cloudflared (${actual} != ${expected})`);
  }
}

async function downloadToFile(url: string, path: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) {
    throw new Error(`Download failed with status ${res.status}`);
  }
  const body = await res.arrayBuffer();
  writeSecureFile(path, new Uint8Array(body));
}

function findExtractedBinary(dir: string): string {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = findExtractedBinary(fullPath);
      if (nested) return nested;
      continue;
    }
    if (entry.isFile() && entry.name === "cloudflared") {
      return fullPath;
    }
  }
  return "";
}

function installCompressedArtifact(archivePath: string, dest: string): void {
  const extractDir = mkdtempSync(join(tmpDir(), "cloudflared-extract-"));
  try {
    execFileSync("tar", ["-xzf", archivePath, "-C", extractDir], { stdio: "pipe" });
    const extractedBinary = findExtractedBinary(extractDir);
    if (!extractedBinary) {
      throw new Error("Could not locate cloudflared binary in downloaded archive");
    }
    renameSync(extractedBinary, dest);
    chmodSync(dest, 0o755);
  } finally {
    rmSync(extractDir, { recursive: true, force: true });
  }
}

export async function downloadCloudflared(): Promise<string> {
  const dir = join(homedir(), ".termi", "bin");
  const dest = join(dir, "cloudflared");
  const spec = getArtifactSpec();
  const url = getDownloadUrl(spec);
  const tempPath = join(tmpDir(), `${spec.filename}.download`);

  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  rmSync(tempPath, { force: true });
  await downloadToFile(url, tempPath);
  verifyChecksum(tempPath, spec.sha256);

  rmSync(dest, { force: true });
  if (spec.compressed) {
    installCompressedArtifact(tempPath, dest);
    rmSync(tempPath, { force: true });
  } else {
    renameSync(tempPath, dest);
    chmodSync(dest, 0o755);
  }

  return dest;
}
