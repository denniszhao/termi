import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");

export const icon192 = readFileSync(join(ASSETS_DIR, "web-app-manifest-192x192.png"));
export const favicon96 = readFileSync(join(ASSETS_DIR, "favicon-96x96.png"));
export const faviconIco = readFileSync(join(ASSETS_DIR, "favicon.ico"));

export const manifest = JSON.stringify({
  name: "Termi",
  short_name: "Termi",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
  ],
  theme_color: "#1e1e1e",
  background_color: "#1e1e1e",
  display: "standalone",
});
