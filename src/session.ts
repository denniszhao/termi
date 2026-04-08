import { BRAND } from "./constants.js";
import type { PtyHandle } from "./pty-manager.js";
import type { ServerHandle } from "./server.js";
import type { TunnelHandle } from "./tunnel.js";

export interface BufferedOutputBridge {
  attach(): void;
}

export function createBufferedOutputBridge(pty: PtyHandle): BufferedOutputBridge {
  const earlyBuffer: string[] = [];
  let attached = false;

  pty.onData((data) => {
    if (attached) {
      process.stdout.write(data);
      return;
    }
    earlyBuffer.push(data);
  });

  return {
    attach: () => {
      attached = true;
      for (const chunk of earlyBuffer) {
        process.stdout.write(chunk);
      }
    },
  };
}

export function attachLocalTerminalInput(pty: PtyHandle): () => void {
  const onData = (data: Buffer | string) => {
    pty.write(data.toString());
  };

  const onResize = () => {
    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;
    pty.resize(cols, rows);
  };

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.on("data", onData);
  process.stdout.on("resize", onResize);

  return () => {
    process.stdin.off("data", onData);
    process.stdout.off("resize", onResize);

    if (process.stdin.isTTY && process.stdin.isRaw) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
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
