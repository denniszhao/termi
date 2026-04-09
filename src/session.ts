import { BRAND } from "./constants.js";
import type { PtyHandle } from "./pty-manager.js";
import type { ServerHandle } from "./server.js";
import type { TunnelHandle } from "./tunnel.js";

const EARLY_OUTPUT_LIMIT_BYTES = 512 * 1024;

export interface BufferedOutputBridge {
  attach(): void;
}

export interface LocalTerminalInputController {
  attach(): void;
  isAttached(): boolean;
  pause(): void;
}

export function createBufferedOutputBridge(pty: PtyHandle): BufferedOutputBridge {
  const earlyBuffer: string[] = [];
  let earlyBufferBytes = 0;
  let attached = false;

  function trimEarlyBuffer(): void {
    while (earlyBufferBytes > EARLY_OUTPUT_LIMIT_BYTES && earlyBuffer.length > 0) {
      const overflow = earlyBufferBytes - EARLY_OUTPUT_LIMIT_BYTES;
      const first = earlyBuffer[0]!;
      const firstBytes = Buffer.byteLength(first);

      if (firstBytes <= overflow) {
        earlyBuffer.shift();
        earlyBufferBytes -= firstBytes;
        continue;
      }

      const trimmed = Buffer.from(first).subarray(overflow).toString("utf8");
      earlyBuffer[0] = trimmed;
      earlyBufferBytes -= firstBytes - Buffer.byteLength(trimmed);
    }
  }

  pty.onData((data) => {
    if (attached) {
      process.stdout.write(data);
      return;
    }
    earlyBuffer.push(data);
    earlyBufferBytes += Buffer.byteLength(data);
    trimEarlyBuffer();
  });

  return {
    attach: () => {
      attached = true;
      for (const chunk of earlyBuffer) {
        process.stdout.write(chunk);
      }
      earlyBuffer.length = 0;
      earlyBufferBytes = 0;
    },
  };
}

export function createLocalTerminalInputController(pty: PtyHandle): LocalTerminalInputController {
  const onData = (data: Buffer | string) => {
    pty.write(data.toString());
  };

  const onResize = () => {
    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;
    pty.resize(cols, rows);
  };

  let attached = false;

  return {
    attach: () => {
      if (attached) {
        return;
      }

      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();
      process.stdin.on("data", onData);
      process.stdout.on("resize", onResize);
      attached = true;
    },
    isAttached: () => attached,
    pause: () => {
      if (!attached) {
        return;
      }

      process.stdin.off("data", onData);
      process.stdout.off("resize", onResize);

      if (process.stdin.isTTY && process.stdin.isRaw) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
      attached = false;
    },
  };
}

export function createSessionCleanup(
  pty: PtyHandle,
  server: ServerHandle,
  detachLocalInput: () => void,
  getTunnel: () => TunnelHandle | undefined,
): () => void {
  let cleanedUp = false;

  const cleanup = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;

    process.removeListener("SIGINT", cleanup);
    process.removeListener("SIGTERM", cleanup);

    detachLocalInput();
    console.log(`\n  ${BRAND} Session ended.\n`);

    try {
      pty.kill();
    } catch {}
    try {
      server.close();
    } catch {}
    try {
      getTunnel()?.kill();
    } catch {}
    process.exit(0);
  };

  return cleanup;
}
