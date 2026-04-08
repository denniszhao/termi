import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  dnsRecordMatchesTunnel,
  parseCertToken,
  parseTunnelIdFromDnsTarget,
  parseTunnelList,
  tunnelDnsTarget,
} from "../src/cloudflare.ts";

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

test("parseTunnelList extracts tunnel ids and names from cloudflared output", () => {
  const output = [
    "ID                                   NAME    CREATED              CONNECTIONS",
    "12345678-1234-1234-1234-123456789abc termi   2026-04-08T12:00:00Z 0",
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee blog    2026-04-08T12:05:00Z 2",
  ].join("\n");

  assert.deepEqual(parseTunnelList(output), [
    { id: "12345678-1234-1234-1234-123456789abc", name: "termi" },
    { id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", name: "blog" },
  ]);
});

test("dnsRecordMatchesTunnel only accepts matching tunnel cname records", () => {
  const tunnelId = "12345678-1234-1234-1234-123456789abc";

  assert.equal(
    dnsRecordMatchesTunnel({ type: "CNAME", content: tunnelDnsTarget(tunnelId) }, tunnelId),
    true,
  );
  assert.equal(
    dnsRecordMatchesTunnel({ type: "A", content: "127.0.0.1" }, tunnelId),
    false,
  );
  assert.equal(
    dnsRecordMatchesTunnel({ type: "CNAME", content: "other.cfargotunnel.com" }, tunnelId),
    false,
  );
});

test("parseTunnelIdFromDnsTarget extracts tunnel ids from cfargotunnel cname records", () => {
  const tunnelId = "12345678-1234-1234-1234-123456789abc";

  assert.equal(
    parseTunnelIdFromDnsTarget({ type: "CNAME", content: tunnelDnsTarget(tunnelId) }),
    tunnelId,
  );
  assert.equal(
    parseTunnelIdFromDnsTarget({ type: "CNAME", content: "example.com" }),
    null,
  );
  assert.equal(
    parseTunnelIdFromDnsTarget({ type: "A", content: "127.0.0.1" }),
    null,
  );
});
