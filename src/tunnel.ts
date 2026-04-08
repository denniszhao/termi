import { spawn, ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface TunnelHandle {
  url: string;
  kill(): void;
}

const URL_RE = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;

function parseTunnelUrl(line: string): string | null {
  try {
    const parsed = JSON.parse(line);
    const match = parsed.message?.match(URL_RE);
    return match ? match[0] : null;
  } catch {
    const match = line.match(URL_RE);
    return match ? match[0] : null;
  }
}

export function startTunnel(
  cloudflaredPath: string,
  localPort: number,
): Promise<TunnelHandle> {
  return new Promise((resolve, reject) => {
    // Write a minimal config to avoid picking up the user's existing
    // cloudflared config (which may have ingress rules that interfere).
    const tmpDir = join(homedir(), ".termi", "tmp");
    mkdirSync(tmpDir, { recursive: true });
    const tmpConfig = join(tmpDir, "cloudflared.yml");
    writeFileSync(tmpConfig, "# termi quick tunnel\n");

    const proc = spawn(
      cloudflaredPath,
      ["tunnel", "--no-autoupdate", "--config", tmpConfig, "--url", `http://127.0.0.1:${localPort}`],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    const timeout = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error("Timed out waiting for tunnel URL (30s)"));
    }, 30_000);

    let resolved = false;

    function handleLine(line: string) {
      if (resolved) return;
      const url = parseTunnelUrl(line);
      if (url) {
        resolved = true;
        clearTimeout(timeout);
        resolve({
          url,
          kill: () => proc.kill("SIGTERM"),
        });
      }
    }

    if (proc.stdout) {
      createInterface({ input: proc.stdout }).on("line", handleLine);
    }
    if (proc.stderr) {
      createInterface({ input: proc.stderr }).on("line", handleLine);
    }

    proc.on("error", (err) => {
      if (!resolved) {
        clearTimeout(timeout);
        reject(err);
      }
    });

    proc.on("exit", (code) => {
      if (!resolved) {
        clearTimeout(timeout);
        reject(new Error(`cloudflared exited with code ${code}`));
      } else {
        console.error(`\n  Warning: cloudflared exited unexpectedly (code ${code})`);
      }
    });
  });
}
