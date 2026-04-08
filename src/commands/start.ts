import { outro, spinner } from "@clack/prompts";
import { runWizard } from "../wizard.js";
import { createPairingManager } from "../pairing.js";
import { createPairingCodeAnnouncer } from "../pairing-announcer.js";
import { spawnPty } from "../pty-manager.js";
import { startServer, type ServerAuth } from "../server.js";
import { startTunnel, startNamedTunnel, TunnelHandle } from "../tunnel.js";
import {
  printBanner,
  printPairingCode,
  printPersistentAccessInfo,
  printSessionInfo,
  printTrustedBrowserConnected,
  printWaitingForTrustedBrowser,
} from "../display.js";
import { getVersion } from "../version.js";
import {
  attachLocalTerminalInput,
  createBufferedOutputBridge,
  createSessionCleanup,
} from "../session.js";
import { getMobileOnboardingSeen, markMobileOnboardingSeen, saveConfig } from "../config.js";

async function openRemoteTunnel(
  config: Awaited<ReturnType<typeof runWizard>>,
  port: number,
): Promise<TunnelHandle> {
  if (config.mode === "persistent" && config.savedConfig) {
    return startNamedTunnel(
      config.cloudflaredPath,
      config.savedConfig.tunnel.id,
      config.savedConfig.tunnel.domain,
      port,
    );
  }

  return startTunnel(config.cloudflaredPath, port);
}

function getTunnelSpinnerMessage(config: Awaited<ReturnType<typeof runWizard>>): string {
  return config.mode === "persistent" && config.savedConfig
    ? "Connecting tunnel..."
    : "Opening tunnel (waiting for DNS)...";
}

function getTunnelSuccessMessage(config: Awaited<ReturnType<typeof runWizard>>): string {
  return config.mode === "persistent" && config.savedConfig
    ? "Tunnel connected."
    : "Tunnel ready.";
}

function getTunnelFailureMessage(config: Awaited<ReturnType<typeof runWizard>>): string {
  return config.mode === "persistent" && config.savedConfig
    ? "Failed to connect tunnel"
    : "Failed to start tunnel";
}

function createServerAuth(
  config: Awaited<ReturnType<typeof runWizard>>,
  onTrustedSessionReady: () => void,
): ServerAuth {
  const mobileOnboardingSeen = getMobileOnboardingSeen();

  if (config.mode === "persistent" && config.savedConfig) {
    const pairingCodeAnnouncer = createPairingCodeAnnouncer((code) => {
      printPairingCode(code);
    });
    const pairing = createPairingManager((code, reason) => {
      if (reason === "expired") {
        pairingCodeAnnouncer.announce(code);
      }
    });

    return {
      mode: "trusted-browser",
      pairing,
      trustedDevices: config.savedConfig.trustedDevices,
      mobileOnboardingSeen,
      onTrustedDevicesChange: (trustedDevices) => {
        config.savedConfig = {
          ...config.savedConfig!,
          trustedDevices,
        };
        saveConfig(config.savedConfig);
      },
      onMobileOnboardingSeen: () => {
        markMobileOnboardingSeen();
      },
      onPairingRequired: (code) => {
        pairingCodeAnnouncer.announce(code);
      },
      onTrustedSessionReady,
    };
  }

  return {
    mode: "token",
    token: config.token!,
    mobileOnboardingSeen,
    onMobileOnboardingSeen: () => {
      markMobileOnboardingSeen();
    },
  };
}

export async function startCommand(): Promise<void> {
  const version = getVersion();
  const config = await runWizard();

  outro("Starting session...");

  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const pty = spawnPty(config.shell, cols, rows);
  const outputBridge = createBufferedOutputBridge(pty);
  let detachLocalInput = () => {};
  let localTerminalAttached = false;
  let localTerminalMayAttach = false;
  let trustedSessionReady = false;
  let trustedAttachMessagePrinted = false;

  function attachLocalTerminal(): void {
    if (localTerminalAttached) {
      return;
    }

    if (config.mode === "persistent" && !trustedAttachMessagePrinted) {
      trustedAttachMessagePrinted = true;
      printTrustedBrowserConnected();
    }

    localTerminalAttached = true;
    detachLocalInput = attachLocalTerminalInput(pty);
    outputBridge.attach();
  }

  function markTrustedSessionReady(): void {
    trustedSessionReady = true;
    if (localTerminalMayAttach) {
      attachLocalTerminal();
    }
  }

  const serverAuth = createServerAuth(config, markTrustedSessionReady);
  const server = await startServer(pty, serverAuth, config.port);

  let tunnel: TunnelHandle | undefined;
  const tunnelSpinner = spinner();
  tunnelSpinner.start(getTunnelSpinnerMessage(config));
  try {
    tunnel = await openRemoteTunnel(config, server.port);
    tunnelSpinner.stop(getTunnelSuccessMessage(config));
  } catch (err) {
    tunnelSpinner.stop("Tunnel failed.");
    console.error(
      `\n  ${getTunnelFailureMessage(config)}: ${err instanceof Error ? err.message : err}`,
    );
    if (config.mode === "persistent" && config.savedConfig) {
      console.error("  Run 'termi reset' to reconfigure.\n");
    }
    process.exit(1);
  }
  const url = config.mode === "persistent"
    ? tunnel.url
    : `${tunnel.url}/?t=${config.token}`;

  printBanner(version);
  printSessionInfo(url, config.mode === "persistent" ? "persistent" : "tunnel");
  if (serverAuth.mode === "trusted-browser") {
    printPersistentAccessInfo(serverAuth.trustedDevices.length > 0);
    printWaitingForTrustedBrowser();
    localTerminalMayAttach = true;
    if (trustedSessionReady) {
      attachLocalTerminal();
    }
  } else {
    attachLocalTerminal();
  }

  const cleanup = createSessionCleanup(pty, server, () => detachLocalInput(), () => tunnel);

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  pty.onExit(() => cleanup());
}
