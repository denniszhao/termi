import { BRAND } from "./constants.js";
import { getVersion } from "./version.js";

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
  case "reset": {
    const { resetPersistentState } = await import("./config.js");
    resetPersistentState();
    console.log(`${BRAND} Local persistent tunnel state cleared. Run 'termi' to set up again.`);
    break;
  }
  case "devices": {
    const { devicesCommand } = await import("./commands/devices.js");
    await devicesCommand();
    break;
  }
  case "revoke": {
    const { revokeCommand } = await import("./commands/revoke.js");
    await revokeCommand();
    break;
  }
  case "--help":
  case "-h":
  case "help":
    console.log(`${BRAND} Termi v${version}`);
    console.log("");
    console.log("Usage: termi [command]");
    console.log("");
    console.log("Commands:");
    console.log("  start    Start a terminal session (default)");
    console.log("  devices  List trusted browsers for persistent sessions");
    console.log("  revoke   Revoke one or all trusted browsers");
    console.log("  reset    Clear local persistent tunnel setup");
    console.log("  help     Show this help message");
    break;
  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}
