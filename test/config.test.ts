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
    trustedDevices: [],
    mobileOnboardingSeen: false,
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

test("trusted device helpers remove one device or clear them all", async () => {
  const tempHome = mkdtempSync(join(tmpdir(), "termi-home-"));
  const config = await importFreshConfigModule(tempHome);

  const deviceA = {
    id: "device-a",
    secretHash: "hash-a",
    createdAt: "2026-04-08T10:00:00.000Z",
    lastSeenAt: "2026-04-08T10:05:00.000Z",
    label: "iPhone Safari",
  };
  const deviceB = {
      id: "device-b",
      secretHash: "hash-b",
      createdAt: "2026-04-08T11:00:00.000Z",
      lastSeenAt: "2026-04-08T11:05:00.000Z",
    };

  config.saveConfig({
    tunnel: {
      id: "tunnel-id",
      name: "termi-123",
      domain: "termi-123.example.com",
    },
    trustedDevices: [deviceA, deviceB],
    mobileOnboardingSeen: false,
  });

  assert.deepEqual(config.listTrustedDevices(), [deviceA, deviceB]);
  assert.equal(config.removeTrustedDevice("missing"), false);
  assert.equal(config.removeTrustedDevice("device-a"), true);
  assert.deepEqual(config.listTrustedDevices(), [deviceB]);
  assert.equal(config.clearTrustedDevices(), 1);
  assert.deepEqual(config.listTrustedDevices(), []);
  assert.equal(config.clearTrustedDevices(), 0);
});

test("mobile onboarding state is persisted when a config already exists", async () => {
  const tempHome = mkdtempSync(join(tmpdir(), "termi-home-"));
  const config = await importFreshConfigModule(tempHome);

  config.saveConfig({
    tunnel: { id: "t-1", name: "termi-001", domain: "termi-001.example.com" },
    trustedDevices: [],
    mobileOnboardingSeen: false,
  });

  assert.equal(config.getMobileOnboardingSeen(), false);
  config.markMobileOnboardingSeen();
  assert.equal(config.getMobileOnboardingSeen(), true);

  const saved = config.loadConfig();
  assert.equal(saved?.mobileOnboardingSeen, true);
  assert.equal(saved?.tunnel.id, "t-1");
});

test("markMobileOnboardingSeen is a no-op without an existing config", async () => {
  const tempHome = mkdtempSync(join(tmpdir(), "termi-home-"));
  const config = await importFreshConfigModule(tempHome);

  assert.equal(config.getMobileOnboardingSeen(), false);
  config.markMobileOnboardingSeen();
  assert.equal(config.getMobileOnboardingSeen(), false);
  assert.equal(config.loadConfig(), null);
});
