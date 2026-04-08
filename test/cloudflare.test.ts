import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseCertToken } from "../src/cloudflare.ts";

test("parseCertToken reads account and API token from an argo cert", () => {
  const dir = mkdtempSync(join(tmpdir(), "termi-cert-"));
  const certPath = join(dir, "cert.pem");
  const payload = Buffer.from(
    JSON.stringify({ accountID: "acct-123", apiToken: "token-456" }),
  ).toString("base64");

  writeFileSync(
    certPath,
    [
      "-----BEGIN ARGO TUNNEL TOKEN-----",
      payload,
      "-----END ARGO TUNNEL TOKEN-----",
      "",
    ].join("\n"),
  );

  assert.deepEqual(parseCertToken(certPath), {
    accountID: "acct-123",
    apiToken: "token-456",
  });
});

test("parseCertToken returns null for invalid files", () => {
  const dir = mkdtempSync(join(tmpdir(), "termi-cert-invalid-"));
  const certPath = join(dir, "cert.pem");
  writeFileSync(certPath, "not a real cert");
  assert.equal(parseCertToken(certPath), null);
});

