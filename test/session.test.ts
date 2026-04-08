import test from "node:test";
import assert from "node:assert/strict";
import { createBufferedOutputBridge } from "../src/session.ts";
import type { PtyHandle } from "../src/pty-manager.ts";

class FakePty implements PtyHandle {
  private dataHandlers: Array<(data: string) => void> = [];

  write(): void {}

  resize(): void {}

  onData(cb: (data: string) => void): void {
    this.dataHandlers.push(cb);
  }

  onExit(): void {}

  kill(): void {}

  emitData(data: string): void {
    this.dataHandlers.forEach((cb) => cb(data));
  }
}

test("buffered output bridge caps early output before attach", () => {
  const pty = new FakePty();
  const bridge = createBufferedOutputBridge(pty);
  const originalWrite = process.stdout.write.bind(process.stdout);
  let output = "";

  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof process.stdout.write;

  try {
    pty.emitData("a".repeat(300 * 1024));
    pty.emitData("b".repeat(300 * 1024));
    pty.emitData("c".repeat(300 * 1024));
    bridge.attach();
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.ok(output.length <= 512 * 1024);
  assert.equal(output.endsWith("c".repeat(64)), true);
});
