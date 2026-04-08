import { outro, spinner } from "@clack/prompts";
import { runWizard } from "../wizard.js";
import { spawnPty } from "../pty-manager.js";
import { startServer } from "../server.js";
import { startTunnel, startNamedTunnel, TunnelHandle } from "../tunnel.js";
import { printBanner, printSessionInfo } from "../display.js";
import { BRAND } from "../constants.js";
import { getVersion } from "../version.js";

export async function startCommand(): Promise<void> {
  const version = getVersion();
  const config = await runWizard();

  outro("Starting session...");

  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const pty = spawnPty(config.shell, cols, rows);

  // Buffer PTY output during setup so we don't lose the initial prompt
  const earlyBuffer: string[] = [];
  let attached = false;
  pty.onData((data) => {
    if (attached) {
      process.stdout.write(data);
    } else {
      earlyBuffer.push(data);
    }
  });

  const server = await startServer(pty, config.token, config.port);

  let tunnel: TunnelHandle | undefined;
  let url: string;

  if (config.mode === "persistent" && config.savedConfig) {
    const s = spinner();
    s.start("Connecting tunnel...");
    try {
      tunnel = await startNamedTunnel(
        config.cloudflaredPath,
        config.savedConfig.tunnel.id,
        config.savedConfig.tunnel.domain,
        server.port,
      );
      s.stop("Tunnel connected.");
      url = `${tunnel.url}/?t=${config.token}`;
    } catch (err) {
      s.stop("Tunnel failed.");
      console.error(
        `\n  Failed to connect tunnel: ${err instanceof Error ? err.message : err}`,
      );
      console.error("  Run 'termi reset' to reconfigure.\n");
      process.exit(1);
    }
  } else {
    const s = spinner();
    s.start("Opening tunnel (waiting for DNS)...");
    try {
      tunnel = await startTunnel(config.cloudflaredPath, server.port);
      s.stop("Tunnel ready.");
      url = `${tunnel.url}/?t=${config.token}`;
    } catch (err) {
      s.stop("Tunnel failed.");
      console.error(
        `\n  Failed to start tunnel: ${err instanceof Error ? err.message : err}`,
      );
      process.exit(1);
    }
  }

  printBanner(version);
  printSessionInfo(url, config.mode === "persistent" ? "persistent" : "tunnel");

  let cleanedUp = false;
  function cleanup() {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    process.removeListener("SIGINT", cleanup);
    process.removeListener("SIGTERM", cleanup);

    if (process.stdin.isTTY && process.stdin.isRaw) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    console.log(`\n  ${BRAND} Session ended.\n`);
    try {
      pty.kill();
    } catch {}
    try {
      server.close();
    } catch {}
    try {
      tunnel?.kill();
    } catch {}
    process.exit(0);
  }

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  pty.onExit(() => cleanup());

  // Flush buffered output and go live
  attached = true;
  for (const chunk of earlyBuffer) {
    process.stdout.write(chunk);
  }

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.on("data", (data) => {
    pty.write(data.toString());
  });

  process.stdout.on("resize", () => {
    const c = process.stdout.columns || 80;
    const r = process.stdout.rows || 24;
    pty.resize(c, r);
  });
}
