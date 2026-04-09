import test from "node:test";
import assert from "node:assert/strict";
import { createTerminalInputGuard } from "../src/web/input-guard.ts";

test("terminal input guard blocks remote ctrl+d and shows the exit notice", () => {
  const sent: string[] = [];
  let blockedCount = 0;
  const guard = createTerminalInputGuard({
    onBlockedExitAttempt: () => {
      blockedCount += 1;
    },
    onInput: (data) => {
      sent.push(data);
    },
  });

  guard.send("\x04");

  assert.equal(blockedCount, 1);
  assert.deepEqual(sent, []);
});

test("terminal input guard forwards normal terminal input", () => {
  const sent: string[] = [];
  let blockedCount = 0;
  const guard = createTerminalInputGuard({
    onBlockedExitAttempt: () => {
      blockedCount += 1;
    },
    onInput: (data) => {
      sent.push(data);
    },
  });

  guard.send("ls\r");

  assert.equal(blockedCount, 0);
  assert.deepEqual(sent, ["ls\r"]);
});
