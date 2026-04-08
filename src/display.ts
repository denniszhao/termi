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
      chalk.dim(` (${mode === "tunnel" ? "Cloudflare Tunnel" : "local network"})`),
  );
  console.log("");

  qrcode.generate(url, { small: true }, (qr) => {
    for (const line of qr.split("\n")) {
      console.log(`  ${line}`);
    }
    console.log("");
    console.log(`  ${chalk.cyan(url)}`);
    console.log("");
    console.log(chalk.dim("  Scan the QR code or open the URL on your phone."));
    console.log(chalk.dim("  Press Ctrl+C to stop."));
    console.log("");
  });
}
