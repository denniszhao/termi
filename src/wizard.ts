import {
  intro,
  select,
  confirm,
  cancel,
  isCancel,
  spinner,
} from "@clack/prompts";
import chalk from "chalk";
import { BRAND, DEFAULT_PORT } from "./constants.js";
import { generateToken } from "./auth.js";
import {
  findCloudflared,
  downloadCloudflared,
} from "./cloudflared-installer.js";
import type { TermiConfig } from "./types.js";

function handleCancel(value: unknown): asserts value is Exclude<typeof value, symbol> {
  if (isCancel(value)) {
    cancel("Cancelled.");
    process.exit(0);
  }
}

export async function runWizard(): Promise<TermiConfig & { cloudflaredPath?: string }> {
  intro(`${BRAND} ${chalk.bold("Termi")}`);

  const mode = await select({
    message: "How should your phone connect?",
    options: [
      {
        value: "tunnel" as const,
        label: "Cloudflare Tunnel",
        hint: "access from anywhere — recommended",
      },
      {
        value: "local" as const,
        label: "Local network only",
        hint: "same Wi-Fi",
      },
    ],
  });
  handleCancel(mode);

  let cloudflaredPath: string | undefined;

  if (mode === "tunnel") {
    cloudflaredPath = findCloudflared() ?? undefined;

    if (cloudflaredPath) {
      // already installed
    } else {
      const install = await confirm({
        message:
          "cloudflared is not installed. Download it now? (~30MB)",
        initialValue: true,
      });
      handleCancel(install);

      if (install) {
        const s = spinner();
        s.start("Downloading cloudflared...");
        try {
          cloudflaredPath = await downloadCloudflared();
          s.stop("cloudflared downloaded.");
        } catch (err) {
          s.stop("Download failed.");
          cancel(
            `Could not download cloudflared: ${err instanceof Error ? err.message : err}`,
          );
          process.exit(1);
        }
      } else {
        cancel(
          "cloudflared is required for tunnel mode. Install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/",
        );
        process.exit(1);
      }
    }
  }

  return {
    mode,
    port: DEFAULT_PORT,
    shell: process.env.SHELL || "/bin/bash",
    token: generateToken(),
    cloudflaredPath,
  };
}
