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
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, copyFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
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
  credentialsPath,
} from "./config.js";
import type { TermiConfig, TermiSavedConfig } from "./types.js";

function handleCancel(value: unknown): asserts value is Exclude<typeof value, symbol> {
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

function parseCertToken(certFile: string): { accountID: string; apiToken: string } | null {
  try {
    const pem = readFileSync(certFile, "utf-8");
    const match = pem.match(
      /-----BEGIN ARGO TUNNEL TOKEN-----\n([\s\S]*?)\n-----END ARGO TUNNEL TOKEN-----/,
    );
    if (!match) return null;
    const json = JSON.parse(Buffer.from(match[1].trim(), "base64").toString());
    if (json.accountID && json.apiToken) {
      return { accountID: json.accountID, apiToken: json.apiToken };
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchCloudflareDomains(
  accountID: string,
  apiToken: string,
): Promise<string[]> {
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones?account.id=${accountID}&status=active&per_page=50`,
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) return [];
    const data = await res.json() as { result?: { name: string }[] };
    return (data.result || []).map((z) => z.name);
  } catch {
    return [];
  }
}

async function ensureAuth(cloudflaredPath: string): Promise<void> {
  const cert = certPath();
  if (existsSync(cert)) return;

  // cloudflared login always writes to ~/.cloudflared/cert.pem
  // We run login, then copy the cert to ~/.termi/
  const defaultCert = join(homedir(), ".cloudflared", "cert.pem");
  const hadExistingCert = existsSync(defaultCert);

  note(
    "You'll be asked to log into your Cloudflare account.\nThis authorizes Termi to create a tunnel on your domain.",
    "Cloudflare Auth",
  );

  const result = spawnSync(cloudflaredPath, ["login"], {
    stdio: "inherit",
  });

  if (result.status !== 0 || !existsSync(defaultCert)) {
    cancel("cloudflared login failed. Please try again.");
    process.exit(1);
  }

  copyFileSync(defaultCert, cert);

  // Clean up if we created the default cert (don't pollute ~/.cloudflared/)
  if (!hadExistingCert) {
    try { unlinkSync(defaultCert); } catch {}
  }
}

async function setupPersistentTunnel(cloudflaredPath: string): Promise<TermiSavedConfig> {
  // Step 1: Auth first
  await ensureAuth(cloudflaredPath);

  // Step 2: Parse cert and fetch domains from Cloudflare API
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

  // Step 3: Subdomain
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

  // Step 2: Create tunnel
  const cred = credentialsPath();
  const tunnelName = String(subdomain);
  const s2 = spinner();
  s2.start("Creating tunnel...");

  const createResult = spawnSync(
    cloudflaredPath,
    ["tunnel", "--origincert", cert, "--credentials-file", cred, "create", tunnelName],
    { encoding: "utf-8" },
  );

  if (createResult.status !== 0) {
    s2.stop("Failed.");
    const stderr = createResult.stderr || "";
    if (stderr.includes("already exists")) {
      cancel(`Tunnel named "${tunnelName}" already exists. Run 'termi reset' and try a different subdomain.`);
    } else {
      cancel(`Failed to create tunnel: ${stderr}`);
    }
    process.exit(1);
  }

  // Parse tunnel ID from output
  const output = (createResult.stdout || "") + (createResult.stderr || "");
  const idMatch = output.match(/with id ([a-f0-9-]+)/);
  if (!idMatch) {
    s2.stop("Failed.");
    cancel("Could not parse tunnel ID from cloudflared output.");
    process.exit(1);
  }
  const tunnelId = idMatch[1];
  s2.stop("Tunnel created.");

  // Step 3: Route DNS
  const s3 = spinner();
  s3.start(`Setting up DNS for ${fullDomain}...`);
  const routeResult = spawnSync(
    cloudflaredPath,
    ["tunnel", "--origincert", cert, "route", "dns", tunnelId, fullDomain],
    { encoding: "utf-8" },
  );

  if (routeResult.status !== 0) {
    s3.stop("Warning: DNS routing may have failed.");
    // Don't exit — the tunnel might still work if DNS was already set up
  } else {
    s3.stop(`DNS ready: ${fullDomain}`);
  }

  // Save config
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

  // If we have a saved persistent tunnel config, skip the wizard
  if (saved) {
    intro(`${BRAND} ${chalk.bold("Termi")}`);
    note(`Using saved tunnel: ${chalk.cyan(saved.tunnel.domain)}`, "Persistent URL");

    const cfPath = await ensureCloudflared();

    return {
      mode: "persistent",
      port: DEFAULT_PORT,
      shell: process.env.SHELL || "/bin/bash",
      token: generateToken(),
      cloudflaredPath: cfPath,
      savedConfig: saved,
    };
  }

  intro(`${BRAND} ${chalk.bold("Termi")}`);

  const mode = await select({
    message: "How should your phone connect?",
    options: [
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

  if (mode === "persistent") {
    savedConfig = await setupPersistentTunnel(cfPath);
  }

  return {
    mode,
    port: DEFAULT_PORT,
    shell: process.env.SHELL || "/bin/bash",
    token: generateToken(),
    cloudflaredPath: cfPath,
    savedConfig,
  };
}
