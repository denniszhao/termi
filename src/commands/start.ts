import { outro, spinner } from "@clack/prompts";
import { runWizard } from "../wizard.js";
import { spawnPty } from "../pty-manager.js";
import {
  startServer,
  type PendingApprovalInfo,
  type ServerAuth,
} from "../server.js";
import {
  createQuickPairingStrategy,
  createTrustedBrowserStrategy,
} from "../auth-strategy.js";
import { startTunnel, startNamedTunnel, TunnelHandle } from "../tunnel.js";
import {
  printBanner,
  printPendingApprovalRequest,
  printPendingApprovalResult,
  printPersistentAccessInfo,
  printSessionInfo,
  printTrustedBrowserTakeover,
  printTrustedBrowserConnected,
  printWaitingForTrustedBrowser,
} from "../display.js";
import { getVersion } from "../version.js";
import {
  createBufferedOutputBridge,
  createLocalTerminalInputController,
  createSessionCleanup,
} from "../session.js";
import { getMobileOnboardingSeen, markMobileOnboardingSeen, saveConfig } from "../config.js";
import { promptForLocalApproval } from "../local-approval.js";

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

function getTunnelMessages(config: Awaited<ReturnType<typeof runWizard>>): {
  spinner: string;
  success: string;
  failure: string;
} {
  return config.mode === "persistent" && config.savedConfig
    ? { spinner: "Connecting tunnel...", success: "Tunnel connected.", failure: "Failed to connect tunnel" }
    : { spinner: "Opening tunnel (waiting for DNS)...", success: "Tunnel ready.", failure: "Failed to start tunnel" };
}

function createServerAuth(
  config: Awaited<ReturnType<typeof runWizard>>,
  onTrustedSessionReady: () => void,
  onPendingApprovalRequest: (
    request: PendingApprovalInfo,
    actions: { approve(): boolean; reject(message?: string): boolean },
  ) => void,
  onTrustedBrowserTakeover: (label: string) => void,
): ServerAuth {
  const mobileOnboardingSeen = getMobileOnboardingSeen();

  const strategy = config.mode === "persistent" && config.savedConfig
    ? createTrustedBrowserStrategy({
        initialDevices: config.savedConfig.trustedDevices,
        onChange: (trustedDevices) => {
          config.savedConfig = {
            ...config.savedConfig!,
            trustedDevices,
          };
          saveConfig(config.savedConfig);
        },
      })
    : createQuickPairingStrategy();

  return {
    strategy,
    mobileOnboardingSeen,
    onPendingApprovalRequest,
    onTrustedBrowserTakeover,
    onMobileOnboardingSeen: () => {
      markMobileOnboardingSeen();
    },
    onTrustedSessionReady,
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
  const localInput = createLocalTerminalInputController(pty);
  let localTerminalOutputAttached = false;
  let localTerminalMayAttach = false;
  let trustedSessionReady = false;
  let trustedAttachMessagePrinted = false;
  let approvalPromptActive = false;

  function attachLocalTerminal(): void {
    if (!localTerminalOutputAttached) {
      if (config.mode === "persistent" && !trustedAttachMessagePrinted) {
        trustedAttachMessagePrinted = true;
        printTrustedBrowserConnected();
      }

      outputBridge.attach();
      localTerminalOutputAttached = true;
    }

    localInput.attach();
  }

  function markTrustedSessionReady(): void {
    trustedSessionReady = true;
    if (localTerminalMayAttach) {
      attachLocalTerminal();
    }
  }

  async function handlePendingApprovalRequest(
    request: PendingApprovalInfo,
    actions: { approve(): boolean; reject(message?: string): boolean },
  ): Promise<void> {
    if (approvalPromptActive || !process.stdin.isTTY) {
      actions.reject("Local approval is unavailable right now.");
      renderApprovalResult("Local approval is unavailable right now.");
      return;
    }

    const shouldPauseLocalInput = localInput.isAttached();
    approvalPromptActive = true;
    try {
      if (shouldPauseLocalInput) {
        localInput.pause();
      }

      renderApprovalNoticeBlock(request);

      const approved = await promptForLocalApproval({
        code: request.code,
        intent: request.intent,
        label: request.label,
      });
      const handled = approved
        ? actions.approve()
        : actions.reject("Browser approval rejected.");

      renderApprovalResult(
        handled
          ? approved
            ? "Browser approved. It can now finish pairing."
            : "Browser approval rejected."
          : "That approval request is no longer pending.",
        handled && approved,
      );
    } finally {
      if (shouldPauseLocalInput) {
        localInput.attach();
      }
      approvalPromptActive = false;
    }
  }

  function renderApprovalNoticeBlock(request: PendingApprovalInfo): void {
    if (localTerminalOutputAttached) {
      process.stdout.write("\r\n\r\n");
      process.stdout.write("  ───────────────────────────────\r\n");
    }

    printPendingApprovalRequest(request.label, request.code, request.intent);

    if (localTerminalOutputAttached) {
      process.stdout.write("  ───────────────────────────────\r\n\r\n");
    }
  }

  function renderApprovalResult(message: string, success = false): void {
    if (localTerminalOutputAttached) {
      process.stdout.write("\r\n");
    }

    printPendingApprovalResult(message, success);

    if (localTerminalOutputAttached) {
      process.stdout.write("\r\n");
    }
  }

  function renderTrustedBrowserTakeover(label: string): void {
    if (localTerminalOutputAttached) {
      process.stdout.write("\r\n\r\n");
      process.stdout.write("  ───────────────────────────────\r\n");
    }

    printTrustedBrowserTakeover(label);

    if (localTerminalOutputAttached) {
      process.stdout.write("  ───────────────────────────────\r\n\r\n");
    }
  }

  const serverAuth = createServerAuth(
    config,
    markTrustedSessionReady,
    (request, actions) => {
      void handlePendingApprovalRequest(request, actions);
    },
    (label) => {
      renderTrustedBrowserTakeover(label);
    },
  );
  const server = await startServer(pty, serverAuth, config.port);

  let tunnel: TunnelHandle | undefined;
  const tunnelMessages = getTunnelMessages(config);
  const tunnelSpinner = spinner();
  tunnelSpinner.start(tunnelMessages.spinner);
  try {
    tunnel = await openRemoteTunnel(config, server.port);
    tunnelSpinner.stop(tunnelMessages.success);
  } catch (err) {
    tunnelSpinner.stop("Tunnel failed.");
    console.error(
      `\n  ${tunnelMessages.failure}: ${err instanceof Error ? err.message : err}`,
    );
    if (config.mode === "persistent" && config.savedConfig) {
      console.error("  Run 'termi reset' to reconfigure.\n");
    }
    process.exit(1);
  }
  const url = tunnel.url;

  printBanner(version);
  printSessionInfo(url, config.mode === "persistent" ? "persistent" : "tunnel");
  if (config.mode === "persistent") {
    printPersistentAccessInfo(serverAuth.strategy.getKnownBrowsers().length > 0);
    printWaitingForTrustedBrowser();
    localTerminalMayAttach = true;
    if (trustedSessionReady) {
      attachLocalTerminal();
    }
  } else {
    attachLocalTerminal();
  }

  const cleanup = createSessionCleanup(pty, server, () => localInput.pause(), () => tunnel);

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  pty.onExit(() => cleanup());
}
