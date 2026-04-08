import { networkInterfaces } from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { outro } from "@clack/prompts";
import { runWizard } from "../wizard.js";
import { spawnPty } from "../pty-manager.js";
import { startServer } from "../server.js";
import { startTunnel, TunnelHandle } from "../tunnel.js";
import { printBanner, printSessionInfo } from "../display.js";
import { BRAND } from "../constants.js";

function getVersion(): string {
  try {
    const dir = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(dir, "..", "package.json"), "utf-8"));
    return pkg.version;
  } catch {
    return "0.0.0-dev";
  }
}

function getLocalIp(): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]!) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "127.0.0.1";
}

export async function startCommand(): Promise<void> {
  const version = getVersion();
  const config = await runWizard();

  outro("Starting session...");

  const pty = spawnPty(config.shell);
  const server = await startServer(pty, config.token, config.port);

  let tunnel: TunnelHandle | undefined;
  let url: string;

  if (config.mode === "tunnel" && config.cloudflaredPath) {
    try {
      tunnel = await startTunnel(config.cloudflaredPath, server.port);
      url = `${tunnel.url}/?t=${config.token}`;
    } catch (err) {
      console.error(
        `\n  Failed to start tunnel: ${err instanceof Error ? err.message : err}`,
      );
      console.error("  Falling back to local mode.\n");
      const ip = getLocalIp();
      url = `http://${ip}:${server.port}/?t=${config.token}`;
    }
  } else {
    const ip = getLocalIp();
    url = `http://${ip}:${server.port}/?t=${config.token}`;
  }

  printBanner(version);
  printSessionInfo(url, tunnel ? "tunnel" : "local");

  function cleanup() {
    console.log(`\n  ${BRAND} Session ended.\n`);
    pty.kill();
    server.close();
    tunnel?.kill();
    process.exit(0);
  }

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  pty.onExit(() => cleanup());
}
