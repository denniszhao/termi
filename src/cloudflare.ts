import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  copySecureFile,
  certPath,
  credentialsPath,
} from "./config.js";

export interface CloudflareTokenInfo {
  accountID: string;
  apiToken: string;
}

export function parseCertToken(certFile: string): CloudflareTokenInfo | null {
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

export async function fetchCloudflareDomains(
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
    return (data.result || []).map((zone) => zone.name);
  } catch {
    return [];
  }
}

export function ensureCloudflareAuth(cloudflaredPath: string): void {
  const cert = certPath();
  if (existsSync(cert)) {
    return;
  }

  const defaultCert = join(homedir(), ".cloudflared", "cert.pem");
  const hadExistingCert = existsSync(defaultCert);
  const result = spawnSync(cloudflaredPath, ["login"], {
    stdio: "inherit",
  });

  if (result.status !== 0 || !existsSync(defaultCert)) {
    throw new Error("cloudflared login failed. Please try again.");
  }

  copySecureFile(defaultCert, cert);

  if (!hadExistingCert) {
    try {
      unlinkSync(defaultCert);
    } catch {}
  }
}

export function createPersistentTunnel(
  cloudflaredPath: string,
  tunnelName: string,
): string {
  const createResult = spawnSync(
    cloudflaredPath,
    [
      "tunnel",
      "--origincert",
      certPath(),
      "--credentials-file",
      credentialsPath(),
      "create",
      tunnelName,
    ],
    { encoding: "utf-8" },
  );

  if (createResult.status !== 0) {
    const stderr = createResult.stderr || "";
    if (stderr.includes("already exists")) {
      throw new Error(
        `Tunnel named "${tunnelName}" already exists. Run 'termi reset' and try a different subdomain.`,
      );
    }
    throw new Error(`Failed to create tunnel: ${stderr}`);
  }

  const output = (createResult.stdout || "") + (createResult.stderr || "");
  const idMatch = output.match(/with id ([a-f0-9-]+)/);
  if (!idMatch) {
    throw new Error("Could not parse tunnel ID from cloudflared output.");
  }

  return idMatch[1];
}

export function routeTunnelDns(
  cloudflaredPath: string,
  tunnelId: string,
  fullDomain: string,
): boolean {
  const routeResult = spawnSync(
    cloudflaredPath,
    ["tunnel", "--origincert", certPath(), "route", "dns", tunnelId, fullDomain],
    { encoding: "utf-8" },
  );

  return routeResult.status === 0;
}
