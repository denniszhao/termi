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

export function printPairingCode(code: string): void {
  console.log(`  ${chalk.yellow("Pairing code:")} ${chalk.bold(code)}`);
  console.log(chalk.dim("  Enter this on your phone to trust a new browser."));
  console.log("");
}
