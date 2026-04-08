import { BRAND } from "./constants.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

function getVersion(): string {
  try {
    const dir = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(dir, "..", "package.json"), "utf-8"));
    return pkg.version;
  } catch {
    return "0.0.0-dev";
  }
}

const version = getVersion();
const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case "start":
  case undefined: {
    const { startCommand } = await import("./commands/start.js");
    await startCommand();
    break;
  }
  case "--version":
  case "-v":
    console.log(`${BRAND} Termi v${version}`);
    break;
  case "--help":
  case "-h":
  case "help":
    console.log(`${BRAND} Termi v${version}`);
    console.log("");
    console.log("Usage: termi [command]");
    console.log("");
    console.log("Commands:");
    console.log("  start    Start a terminal session (default)");
    console.log("  help     Show this help message");
    break;
  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}
