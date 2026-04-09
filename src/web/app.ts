import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "./app.css";
import { mustGetElement } from "./dom.js";
import { createKeyboardController } from "./keyboard.js";
import { createTerminalInputGuard } from "./input-guard.js";
import { createLayoutController } from "./layout.js";
import { createTerminalSocket, type TerminalSocketController } from "./socket.js";
import { createStatusController } from "./status.js";
import { attachTrackpad } from "./trackpad.js";

const isMobile = "ontouchstart" in window;
const proto = location.protocol === "https:" ? "wss:" : "ws:";
const token = new URLSearchParams(location.search).get("t") ?? "";
const wsUrl = token
  ? `${proto}//${location.host}/?t=${token}`
  : `${proto}//${location.host}/`;
const bootstrap = getBootstrapData();

const terminalEl = mustGetElement<HTMLDivElement>("terminal");
const terminalBrandEl = mustGetElement<HTMLDivElement>("terminal-brand");
const keyboardEl = mustGetElement<HTMLDivElement>("keyboard");
const toggleButton = mustGetElement<HTMLButtonElement>("kb-toggle");
const trackpadHint = mustGetElement<HTMLDivElement>("trackpad-hint");
const remoteExitNotice = mustGetElement<HTMLDivElement>("remote-exit-notice");
const remoteExitDismissButton = mustGetElement<HTMLButtonElement>("remote-exit-dismiss");
const onboardingBackdrop = mustGetElement<HTMLDivElement>("onboarding-backdrop");
const onboardingDismissButton = mustGetElement<HTMLButtonElement>("onboarding-dismiss");
const onboardingErrorEl = mustGetElement<HTMLParagraphElement>("onboarding-error");

const term = new Terminal({
  cursorBlink: true,
  fontFamily: 'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  fontSize: isMobile ? 13 : 14,
  theme: { background: "#1e1e1e" },
});
const fitAddon = new FitAddon();
term.loadAddon(fitAddon);
term.open(terminalEl);

const helperTextarea = document.querySelector(".xterm-helper-textarea") as HTMLTextAreaElement | null;
if (helperTextarea) {
  helperTextarea.setAttribute("autocomplete", "off");
  helperTextarea.setAttribute("autocorrect", "off");
  helperTextarea.setAttribute("autocapitalize", "off");
  helperTextarea.setAttribute("spellcheck", "false");
}

let socket: TerminalSocketController;
const status = createStatusController();
const inputGuard = createTerminalInputGuard({
  onBlockedExitAttempt: () => {
    remoteExitNotice.hidden = false;
  },
  onInput: (data) => {
    socket.sendData(data);
  },
});

function sendResize(): void {
  const dims = fitAddon.proposeDimensions();
  if (dims) {
    socket.sendResize(dims.cols, dims.rows);
  }
}

function focusNativeKeyboard(): void {
  window.requestAnimationFrame(() => {
    term.focus();
  });
}

function hideNativeKeyboard(): void {
  term.blur();
  helperTextarea?.blur();
}

const layout = createLayoutController({
  helperTextarea,
  isMobile,
  keyboardEl,
  terminalBrandEl,
  terminalEl,
  toggleButton,
  fit: () => fitAddon.fit(),
  focusNativeKeyboard,
  hideNativeKeyboard,
  sendResize,
});

socket = createTerminalSocket({
  wsUrl,
  onSessionReplaced: () => {
    if (!token) {
      window.location.href = "/";
    }
  },
  onData: (data) => {
    term.write(data);
  },
  onOpen: () => {
    layout.fitTerminal();
    sendResize();
  },
  onStateChange: (state) => {
    status.setState(state);
  },
});

const keyboard = createKeyboardController({
  keyboardEl,
  isMobile,
  onInput: (data) => {
    inputGuard.send(data);
  },
});

toggleButton.addEventListener("click", (event) => {
  event.preventDefault();
  layout.toggleKeyboard();
});

term.onData((data) => {
  inputGuard.send(data);
});

remoteExitDismissButton.addEventListener("click", () => {
  remoteExitNotice.hidden = true;
});

keyboard.mount();
if (isMobile) {
  keyboard.render();
}

attachTrackpad({
  focusTerminal: () => term.focus(),
  isMobile,
  isUsingCustomKeyboard: layout.isUsingCustomKeyboard,
  sendKey: (data) => {
    inputGuard.send(data);
  },
  terminalEl,
  trackpadHint,
});

layout.initialize();
layout.fitTerminal();
setupOnboarding();
socket.connect();

function getBootstrapData(): { onboardingSeenPath: string; showOnboarding: boolean } {
  const bootstrapEl = mustGetElement<HTMLScriptElement>("termi-bootstrap");
  return JSON.parse(bootstrapEl.textContent || "{}") as { onboardingSeenPath: string; showOnboarding: boolean };
}

function setupOnboarding(): void {
  if (!isMobile || !bootstrap.showOnboarding) {
    onboardingBackdrop.style.display = "none";
    return;
  }

  onboardingBackdrop.style.display = "grid";
  let submitting = false;

  const dismissOnboarding = async () => {
    if (submitting) {
      return;
    }

    submitting = true;
    onboardingDismissButton.disabled = true;
    onboardingErrorEl.hidden = true;

    try {
      const response = await fetch(bootstrap.onboardingSeenPath, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error("Failed to save onboarding state");
      }

      onboardingBackdrop.style.display = "none";
    } catch {
      submitting = false;
      onboardingDismissButton.disabled = false;
      onboardingErrorEl.hidden = false;
    }
  };

  onboardingDismissButton.addEventListener("pointerup", (event) => {
    event.preventDefault();
    void dismissOnboarding();
  });
  onboardingDismissButton.addEventListener("click", (event) => {
    event.preventDefault();
    void dismissOnboarding();
  });
}
