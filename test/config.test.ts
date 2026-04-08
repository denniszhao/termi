import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

async function importFreshConfigModule(tempHome: string) {
  const previousHome = process.env.HOME;
  process.env.HOME = tempHome;
  try {
    const moduleUrl = pathToFileURL(resolve("src/config.ts")).href;
    return await import(`${moduleUrl}?home=${encodeURIComponent(tempHome)}&ts=${Date.now()}`);
  } finally {
    process.env.HOME = previousHome;
  }
}

test("config persists and resets saved state under the home directory", async () => {
  const tempHome = mkdtempSync(join(tmpdir(), "termi-home-"));
  const config = await importFreshConfigModule(tempHome);

  const saved = {
    tunnel: {
      id: "tunnel-id",
      name: "termi-123",
      domain: "termi-123.example.com",
    },
  };

  config.saveConfig(saved);

  const configPath = join(tempHome, ".termi", "config.json");
  assert.equal(existsSync(configPath), true);
  assert.deepEqual(config.loadConfig(), saved);
  assert.match(readFileSync(configPath, "utf-8"), /"domain": "termi-123\.example\.com"/);
  assert.equal(statSync(configPath).mode & 0o777, 0o600);

  config.resetPersistentState();
  assert.equal(config.loadConfig(), null);
  assert.equal(existsSync(configPath), false);
});

