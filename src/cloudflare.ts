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

export interface CloudflareDnsRecord {
  id?: string;
  type: string;
  content: string;
}

export class PersistentTunnelAlreadyExistsError extends Error {
  constructor(tunnelName: string) {
    super(`Tunnel named "${tunnelName}" already exists in Cloudflare.`);
    this.name = "PersistentTunnelAlreadyExistsError";
  }
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

export async function fetchCloudflareZoneId(
  accountID: string,
  apiToken: string,
  zoneName: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones?account.id=${accountID}&name=${encodeURIComponent(zoneName)}&status=active&per_page=1`,
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) return null;
    const data = await res.json() as { result?: { id: string }[] };
    return data.result?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

export async function fetchCloudflareDnsRecord(
  zoneId: string,
  apiToken: string,
  hostname: string,
): Promise<CloudflareDnsRecord | null> {
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?name=${encodeURIComponent(hostname)}&per_page=20`,
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) return null;
    const data = await res.json() as { result?: Array<{ id: string; type: string; content: string }> };
    const record = data.result?.[0];
    if (!record) {
      return null;
    }
    return {
      id: record.id,
      type: record.type,
      content: record.content,
    };
  } catch {
    return null;
  }
}

export async function deleteCloudflareDnsRecord(
  zoneId: string,
  apiToken: string,
  recordId: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${recordId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    return res.ok;
  } catch {
    return false;
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
      throw new PersistentTunnelAlreadyExistsError(tunnelName);
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

export function findPersistentTunnelIdByName(
  cloudflaredPath: string,
  tunnelName: string,
): string | null {
  const tunnels = listPersistentTunnels(cloudflaredPath);
  const match = tunnels.find((tunnel) => tunnel.name === tunnelName);
  return match?.id ?? null;
}

export function findPersistentTunnelById(
  cloudflaredPath: string,
  tunnelId: string,
): { id: string; name: string } | null {
  const tunnels = listPersistentTunnels(cloudflaredPath);
  const match = tunnels.find((tunnel) => tunnel.id === tunnelId);
  return match ?? null;
}

function listPersistentTunnels(
  cloudflaredPath: string,
): Array<{ id: string; name: string }> {
  const listResult = spawnSync(
    cloudflaredPath,
    ["tunnel", "--origincert", certPath(), "list"],
    { encoding: "utf-8" },
  );

  if (listResult.status !== 0) {
    throw new Error(`Failed to list tunnels: ${listResult.stderr || listResult.stdout || "unknown error"}`);
  }

  return parseTunnelList((listResult.stdout || "") + (listResult.stderr || ""));
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

export function parseTunnelList(output: string): Array<{ id: string; name: string }> {
  return output
    .split("\n")
    .map((line) => line.trim())
    .flatMap((line) => {
      const match = line.match(/^([0-9a-f-]{36})\s+(\S+)/i);
      if (!match) {
        return [];
      }

      return [{
        id: match[1],
        name: match[2],
      }];
    });
}

export function tunnelDnsTarget(tunnelId: string): string {
  return `${tunnelId}.cfargotunnel.com`;
}

export function parseTunnelIdFromDnsTarget(record: CloudflareDnsRecord | null): string | null {
  if (!record || record.type !== "CNAME") {
    return null;
  }

  const match = record.content.trim().match(/^([0-9a-f-]{36})\.cfargotunnel\.com$/i);
  return match?.[1] ?? null;
}

export function dnsRecordMatchesTunnel(
  record: CloudflareDnsRecord | null,
  tunnelId: string,
): boolean {
  if (!record) {
    return false;
  }

  return record.type === "CNAME" && record.content.toLowerCase() === tunnelDnsTarget(tunnelId).toLowerCase();
}

export function deletePersistentTunnel(
  cloudflaredPath: string,
  tunnelId: string,
): boolean {
  const deleteResult = spawnSync(
    cloudflaredPath,
    ["tunnel", "--origincert", certPath(), "delete", "-f", tunnelId],
    { encoding: "utf-8" },
  );

  return deleteResult.status === 0;
}
