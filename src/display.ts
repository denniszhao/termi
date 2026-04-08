import chalk from "chalk";
import qrcode from "qrcode-terminal";
import { BRAND } from "./constants.js";

export function printBanner(version: string): void {
  console.log("");
  console.log(`  ${BRAND} ${chalk.bold("Termi")} ${chalk.dim(`v${version}`)}`);
  console.log("");
}

export function printSessionInfo(url: string, mode: string): void {
  console.log("");
  console.log(
    chalk.green("  Ready!") +
      chalk.dim(` (${mode === "persistent" ? "persistent URL" : "quick tunnel"})`),
  );
  console.log("");

  qrcode.generate(url, { small: true }, (qr: string) => {
    for (const line of qr.split("\n")) {
      console.log(`  ${line}`);
    }
    console.log("");
    console.log(`  ${chalk.cyan(url)}`);
    console.log("");
    console.log(chalk.dim("  Scan the QR code or open the URL on your phone."));
    console.log(chalk.dim("  Type 'exit' or press Ctrl+D to stop."));
    console.log("");
  });
}

export function printPersistentAccessInfo(hasTrustedDevices: boolean): void {
  if (hasTrustedDevices) {
    console.log(chalk.dim("  Trusted browsers will open the terminal right away."));
    console.log(chalk.dim("  New browsers will show a pairing screen, and the code will appear here."));
  } else {
    console.log(chalk.dim("  The first browser to open this URL will need to pair."));
    console.log(chalk.dim("  When that happens, the pairing code will appear here."));
  }
  console.log(chalk.dim("  The local terminal will attach after a trusted browser connects."));
  console.log("");
}

export function printWaitingForTrustedBrowser(): void {
  console.log(chalk.dim("  Waiting for a trusted browser to connect..."));
  console.log("");
}

export function printTrustedBrowserConnected(): void {
  console.log(`  ${chalk.green("✔")} ${chalk.green("Trusted browser connected. Attaching local terminal...")}`);
  console.log("");
}

export function printPairingCode(code: string): void {
  console.log(`  ${chalk.yellow("Pairing code:")} ${chalk.bold(code)}`);
  console.log(chalk.dim("  Enter this on your phone to trust a new browser."));
  console.log("");
}
