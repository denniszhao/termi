import {
  intro,
  select,
  text,
  confirm,
  cancel,
  isCancel,
  spinner,
  note,
} from "@clack/prompts";
import chalk from "chalk";
import { BRAND, DEFAULT_PORT } from "./constants.js";
import { generateToken } from "./auth.js";
import {
  findCloudflared,
  downloadCloudflared,
} from "./cloudflared-installer.js";
import {
  loadConfig,
  saveConfig,
  configDir,
  certPath,
} from "./config.js";
import type { TermiSavedConfig } from "./types.js";
import {
  createPersistentTunnel,
  deletePersistentTunnel,
  ensureCloudflareAuth,
  fetchCloudflareDomains,
  parseCertToken,
  routeTunnelDns,
} from "./cloudflare.js";
import { waitForTunnelReady } from "./tunnel.js";

function handleCancel<T>(value: T): asserts value is Exclude<T, symbol> {
  if (isCancel(value)) {
    cancel("Cancelled.");
    process.exit(0);
  }
}

function randomDigits(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
  return s;
}

async function ensureCloudflared(): Promise<string> {
  let cfPath = findCloudflared() ?? undefined;

  if (cfPath) return cfPath;

  const install = await confirm({
    message: "cloudflared is not installed. Download it now? (~30MB)",
    initialValue: true,
  });
  handleCancel(install);

  if (!install) {
    cancel(
      "cloudflared is required. Install from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/",
    );
    process.exit(1);
  }

  const s = spinner();
  s.start("Downloading cloudflared...");
  try {
    cfPath = await downloadCloudflared();
    s.stop("cloudflared downloaded.");
    return cfPath;
  } catch (err) {
    s.stop("Download failed.");
    cancel(`Could not download cloudflared: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

async function setupPersistentTunnel(cloudflaredPath: string): Promise<TermiSavedConfig> {
  note(
    "You'll be asked to log into your Cloudflare account.\nThis authorizes Termi to create a tunnel on your domain.",
    "Cloudflare Auth",
  );

  try {
    ensureCloudflareAuth(cloudflaredPath);
  } catch (err) {
    cancel(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const cert = certPath();
  const tokenInfo = parseCertToken(cert);
  let domain: string;

  if (tokenInfo) {
    const s = spinner();
    s.start("Fetching your Cloudflare domains...");
    const domains = await fetchCloudflareDomains(tokenInfo.accountID, tokenInfo.apiToken);
    s.stop(domains.length > 0 ? `Found ${domains.length} domain${domains.length === 1 ? "" : "s"}.` : "Could not fetch domains.");

    if (domains.length > 0) {
      const options = [
        ...domains.map((d) => ({ value: d, label: d })),
        { value: "__other__", label: "Other domain...", hint: "enter manually" },
      ];

      const choice = await select({
        message: "Which domain?",
        options,
      });
      handleCancel(choice);

      if (choice === "__other__") {
        const typed = await text({
          message: "Domain name?",
          placeholder: "example.com",
        });
        handleCancel(typed);
        domain = String(typed);
      } else {
        domain = String(choice);
      }
    } else {
      const typed = await text({
        message: "Domain name? (must be on your Cloudflare account)",
        placeholder: "example.com",
      });
      handleCancel(typed);
      domain = String(typed);
    }
  } else {
    const typed = await text({
      message: "Domain name? (must be on your Cloudflare account)",
      placeholder: "example.com",
    });
    handleCancel(typed);
    domain = String(typed);
  }

  const defaultSub = `termi-${randomDigits(3)}`;
  const subdomain = await text({
    message: "Subdomain?",
    initialValue: defaultSub,
    placeholder: defaultSub,
  });
  handleCancel(subdomain);

  const fullDomain = `${subdomain}.${domain}`;
  note(`Your URL will be: ${chalk.cyan(`https://${fullDomain}`)}`, "Preview");

  const ok = await confirm({
    message: "Continue with this setup?",
    initialValue: true,
  });
  handleCancel(ok);
  if (!ok) {
    cancel("Cancelled.");
    process.exit(0);
  }

  const tunnelName = String(subdomain);
  const s2 = spinner();
  s2.start("Creating tunnel...");
  let tunnelId: string;
  try {
    tunnelId = createPersistentTunnel(cloudflaredPath, tunnelName);
    s2.stop("Tunnel created.");
  } catch (err) {
    s2.stop("Failed.");
    cancel(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const s3 = spinner();
  s3.start(`Setting up DNS for ${fullDomain}...`);
  if (!routeTunnelDns(cloudflaredPath, tunnelId, fullDomain)) {
    s3.stop("Failed.");
    const cleanedUp = deletePersistentTunnel(cloudflaredPath, tunnelId);
    cancel(
      cleanedUp
        ? `Failed to set up DNS for ${fullDomain}. The newly created tunnel was removed.`
        : `Failed to set up DNS for ${fullDomain}. The created tunnel (${tunnelId}) may need manual cleanup.`,
    );
    process.exit(1);
  } else {
    s3.stop(`DNS ready: ${fullDomain}`);
  }

  const s4 = spinner();
  s4.start(`Verifying ${fullDomain}...`);
  const ready = await waitForTunnelReady(`https://${fullDomain}`);
  if (!ready) {
    s4.stop("Failed.");
    const cleanedUp = deletePersistentTunnel(cloudflaredPath, tunnelId);
    cancel(
      cleanedUp
        ? `DNS was created, but ${fullDomain} did not become reachable within 30s. The new tunnel was removed and no config was saved.`
        : `DNS was created, but ${fullDomain} did not become reachable within 30s. The created tunnel (${tunnelId}) may need manual cleanup.`,
    );
    process.exit(1);
  }
  s4.stop(`${fullDomain} is reachable.`);

  const config: TermiSavedConfig = {
    tunnel: {
      id: tunnelId,
      name: tunnelName,
      domain: fullDomain,
    },
  };
  saveConfig(config);
  note(`Saved to ${configDir()}/config.json`, "Config");

  return config;
}

export interface WizardResult {
  mode: "tunnel" | "persistent";
  port: number;
  shell: string;
  token: string;
  cloudflaredPath: string;
  savedConfig?: TermiSavedConfig;
}

export async function runWizard(): Promise<WizardResult> {
  const saved = loadConfig();

  intro(`${BRAND} ${chalk.bold("Termi")}`);

  if (saved) {
    note(`Saved persistent URL: ${chalk.cyan(saved.tunnel.domain)}`, "Persistent URL");
  }

  const mode = await select({
    message: "How should your phone connect?",
    options: saved
      ? [
          {
            value: "saved-persistent" as const,
            label: "Use saved persistent URL",
            hint: saved.tunnel.domain,
          },
          {
            value: "tunnel" as const,
            label: "Quick tunnel",
            hint: "random URL this run",
          },
          {
            value: "persistent" as const,
            label: "Change persistent URL",
            hint: "replace the saved tunnel configuration",
          },
        ]
      : [
          {
            value: "tunnel" as const,
            label: "Quick tunnel",
            hint: "random URL each time — no setup needed",
          },
          {
            value: "persistent" as const,
            label: "Persistent URL",
            hint: "same URL every time — requires Cloudflare domain",
          },
        ],
  });
  handleCancel(mode);

  const cfPath = await ensureCloudflared();

  let savedConfig: TermiSavedConfig | undefined;
  const resolvedMode = mode === "saved-persistent" ? "persistent" : mode;

  if (mode === "saved-persistent") {
    savedConfig = saved ?? undefined;
  } else if (mode === "persistent") {
    savedConfig = await setupPersistentTunnel(cfPath);
  }

  return {
    mode: resolvedMode,
    port: DEFAULT_PORT,
    shell: process.env.SHELL || "/bin/bash",
    token: generateToken(),
    cloudflaredPath: cfPath,
    savedConfig,
  };
}
