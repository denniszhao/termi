import * as childProcess from "node:child_process";
import { createInterface } from "node:readline";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { credentialsPath, tmpDir, writeSecureFile } from "./config.js";

function yamlQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export interface TunnelHandle {
  url: string;
  kill(): void;
}

const URL_RE = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;

export function parseTunnelUrl(line: string): string | null {
  try {
    const parsed = JSON.parse(line);
    const match = parsed.message?.match(URL_RE);
    return match ? match[0] : null;
  } catch {
    const match = line.match(URL_RE);
    return match ? match[0] : null;
  }
}

export async function waitForTunnelReady(url: string, timeoutMs = 30_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch {
      // DNS not ready yet or connection refused — keep trying
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

function attachTunnelOutput(
  proc: ReturnType<typeof childProcess.spawn>,
  onLine: (line: string) => void,
): void {
  if (proc.stdout) {
    createInterface({ input: proc.stdout }).on("line", onLine);
  }
  if (proc.stderr) {
    createInterface({ input: proc.stderr }).on("line", onLine);
  }
}

function createTunnelHandle(proc: ReturnType<typeof childProcess.spawn>, url: string): TunnelHandle {
  return {
    url,
    kill: () => proc.kill("SIGTERM"),
  };
}

function rejectIfExitedBeforeReady(
  proc: ReturnType<typeof childProcess.spawn>,
  onReject: (err: Error) => void,
  isResolved: () => boolean,
  clearTimeoutFn: () => void,
): void {
  proc.on("error", (err) => {
    if (!isResolved()) {
      clearTimeoutFn();
      onReject(err);
    }
  });

  proc.on("exit", (code) => {
    if (!isResolved()) {
      clearTimeoutFn();
      onReject(new Error(`cloudflared exited with code ${code}`));
    } else if (!proc.killed) {
      console.error(`\n  Warning: cloudflared exited unexpectedly (code ${code})`);
    }
  });
}

export function startNamedTunnel(
  cloudflaredPath: string,
  tunnelId: string,
  domain: string,
  localPort: number,
): Promise<TunnelHandle> {
  const cfgPath = join(tmpDir(), "cloudflared-persistent.yml");
  const credPath = credentialsPath();

  const yml = [
    `tunnel: ${yamlQuote(tunnelId)}`,
    `credentials-file: ${yamlQuote(credPath)}`,
    `ingress:`,
    `  - hostname: ${yamlQuote(domain)}`,
    `    service: http://127.0.0.1:${localPort}`,
    `  - service: http_status:404`,
  ].join("\n") + "\n";
  writeSecureFile(cfgPath, yml);

  const proc = childProcess.spawn(
    cloudflaredPath,
    ["tunnel", "--no-autoupdate", "--config", cfgPath, "run"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  return waitForNamedTunnelConnection(proc, domain);
}

export function waitForNamedTunnelConnection(
  proc: ReturnType<typeof childProcess.spawn>,
  domain: string,
): Promise<TunnelHandle> {
  return new Promise((resolve, reject) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error("Timed out waiting for tunnel connection (30s)"));
    }, 30_000);

    function handleLine(line: string) {
      if (resolved) return;
      if (!line.includes("Registered tunnel connection")) {
        return;
      }

      resolved = true;
      clearTimeout(timeout);

      // For persistent tunnels, Cloudflare DNS propagation can lag behind the
      // tunnel registration event. Once the tunnel is connected, let the
      // session continue instead of failing setup on a transient public check.
      resolve(createTunnelHandle(proc, `https://${domain}`));
    }

    attachTunnelOutput(proc, handleLine);
    rejectIfExitedBeforeReady(proc, reject, () => resolved, () => clearTimeout(timeout));
  });
}

export function startTunnel(
  cloudflaredPath: string,
  localPort: number,
): Promise<TunnelHandle> {
  return new Promise((resolve, reject) => {
    // Write a minimal config to avoid picking up the user's existing
    // cloudflared config (which may have ingress rules that interfere).
    const tmpConfig = join(tmpDir(), "cloudflared-quick.yml");
    rmSync(tmpConfig, { force: true });
    writeSecureFile(tmpConfig, "# termi quick tunnel\n");

    const proc = childProcess.spawn(
      cloudflaredPath,
      ["tunnel", "--no-autoupdate", "--config", tmpConfig, "--url", `http://127.0.0.1:${localPort}`],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    let resolved = false;
    const timeout = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error("Timed out waiting for tunnel URL (30s)"));
    }, 30_000);

    function handleLine(line: string) {
      if (resolved) return;
      const url = parseTunnelUrl(line);
      if (url) {
        resolved = true;
        clearTimeout(timeout);
        waitForTunnelReady(url).then((ready) => {
          if (ready) {
            resolve(createTunnelHandle(proc, url));
          } else {
            proc.kill("SIGTERM");
            reject(new Error("Tunnel URL was allocated but health check never succeeded"));
          }
        });
      }
    }

    attachTunnelOutput(proc, handleLine);
    rejectIfExitedBeforeReady(proc, reject, () => resolved, () => clearTimeout(timeout));
  });
}
