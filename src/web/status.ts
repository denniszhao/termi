import { mustGetElement } from "./dom.js";
import type { TerminalSocketState } from "./socket.js";

const CONNECTED_TEXT_TIMEOUT_MS = 1800;

export interface StatusController {
  setState(state: TerminalSocketState): void;
}

export function createStatusController(): StatusController {
  const statusEl = mustGetElement<HTMLSpanElement>("status");
  const statusTextEl = mustGetElement<HTMLSpanElement>("status-text");
  let hideTextTimer: number | undefined;

  function setState(state: TerminalSocketState): void {
    if (hideTextTimer !== undefined) {
      window.clearTimeout(hideTextTimer);
      hideTextTimer = undefined;
    }

    statusEl.dataset.state = state;
    statusTextEl.textContent = getStatusText(state);
    statusEl.classList.remove("text-hidden");

    if (state === "connected") {
      hideTextTimer = window.setTimeout(() => {
        statusEl.classList.add("text-hidden");
      }, CONNECTED_TEXT_TIMEOUT_MS);
    }
  }

  return { setState };
}

function getStatusText(state: TerminalSocketState): string {
  switch (state) {
    case "connecting":
      return "Connecting";
    case "connected":
      return "Connected";
    case "reconnecting":
      return "Reconnecting";
    case "disconnected":
      return "Disconnected";
  }
}
