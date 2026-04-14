import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "./app.css";
import { mustGetElement } from "./dom.js";
import { createKeyboardController } from "./keyboard.js";
import { createTerminalInputGuard } from "./input-guard.js";
import { createLayoutController } from "./layout.js";
import { createTerminalSocket, type TerminalSocketController } from "./socket.js";
import { createStatusController } from "./status.js";
import { createTouchScrollController } from "./touch-scroll.js";

const isMobile = "ontouchstart" in window;
const proto = location.protocol === "https:" ? "wss:" : "ws:";
const wsUrl = `${proto}//${location.host}/`;
const bootstrap = getBootstrapData();

const appShellEl = mustGetElement<HTMLDivElement>("app-shell");
const terminalEl = mustGetElement<HTMLDivElement>("terminal");
const keyboardEl = mustGetElement<HTMLDivElement>("keyboard");
const mobileActionsEl = mustGetElement<HTMLDivElement>("mobile-actions");
const toggleButton = mustGetElement<HTMLButtonElement>("kb-toggle");
const virtualToggleButton = mustGetElement<HTMLButtonElement>("vk-toggle");
const noticeOverlay = mustGetElement<HTMLDivElement>("notice-overlay");
const noticeTitle = mustGetElement<HTMLHeadingElement>("notice-title");
const noticeBody = mustGetElement<HTMLDivElement>("notice-body");
const noticeDismiss = mustGetElement<HTMLButtonElement>("notice-dismiss");
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

function showNotice(title: string, body: string, dismissable = false): void {
  noticeTitle.textContent = title;
  noticeBody.innerHTML = body;
  noticeDismiss.hidden = !dismissable;
  noticeOverlay.hidden = false;
}

let socket: TerminalSocketController;
const status = createStatusController();
const inputGuard = createTerminalInputGuard({
  onBlockedExitAttempt: () => {
    showNotice(
      "Keep This Session Running",
      "<p>Close this tab to disconnect this browser.</p>"
      + "<p>To end the Termi session itself, use the local device where Termi was started.</p>",
      true,
    );
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
  helperTextarea?.removeAttribute("inputmode");
  helperTextarea?.focus({ preventScroll: true });
  term.focus();
}

function hideNativeKeyboard(): void {
  term.blur();
  helperTextarea?.blur();
}

const layout = createLayoutController({
  appShellEl,
  helperTextarea,
  isMobile,
  keyboardEl,
  mobileActionsEl,
  toggleButton,
  virtualToggleButton,
  fit: () => fitAddon.fit(),
  focusNativeKeyboard,
  hideNativeKeyboard,
  sendResize,
});

socket = createTerminalSocket({
  wsUrl,
  onSessionEnded: () => {
    showNotice(
      "Session Ended",
      "<p>The Termi session was ended from the local device.</p>"
      + "<p>You can close this tab.</p>",
    );
  },
  onSessionReplaced: () => {
    showNotice(
      "Session Taken Over",
      "<p>Another browser has taken over this terminal session.</p>"
      + "<p>You can close this tab or refresh to reconnect.</p>",
    );
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
const touchScroll = createTouchScrollController({
  isMobile,
  term,
  terminalEl,
});

toggleButton.addEventListener("click", (event) => {
  event.preventDefault();
  layout.toggleKeyboard();
});

virtualToggleButton.addEventListener("click", (event) => {
  event.preventDefault();
  layout.toggleCustomKeyboardVisibility();
});

term.onData((data) => {
  inputGuard.send(data);
});

noticeDismiss.addEventListener("click", () => {
  noticeOverlay.hidden = true;
});

keyboard.mount();
touchScroll.mount();
if (isMobile) {
  keyboard.render();
}

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
