import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "./app.css";
import { mustGetElement } from "./dom.js";
import { createKeyboardController } from "./keyboard.js";
import { createLayoutController } from "./layout.js";
import { createTerminalSocket, type TerminalSocketController } from "./socket.js";
import { attachTrackpad } from "./trackpad.js";

const isMobile = "ontouchstart" in window;
const proto = location.protocol === "https:" ? "wss:" : "ws:";
const token = new URLSearchParams(location.search).get("t") ?? "";
const wsUrl = `${proto}//${location.host}/?t=${token}`;

const terminalEl = mustGetElement<HTMLDivElement>("terminal");
const terminalBrandEl = mustGetElement<HTMLDivElement>("terminal-brand");
const statusEl = mustGetElement<HTMLDivElement>("status");
const keyboardEl = mustGetElement<HTMLDivElement>("keyboard");
const toggleButton = mustGetElement<HTMLButtonElement>("kb-toggle");
const trackpadHint = mustGetElement<HTMLDivElement>("trackpad-hint");

const term = new Terminal({
  cursorBlink: true,
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
  statusEl,
  onData: (data) => {
    term.write(data);
  },
  onOpen: () => {
    layout.fitTerminal();
    sendResize();
  },
});

const keyboard = createKeyboardController({
  keyboardEl,
  isMobile,
  onInput: (data) => {
    socket.sendData(data);
  },
});

toggleButton.addEventListener("click", (event) => {
  event.preventDefault();
  layout.toggleKeyboard();
});

term.onData((data) => {
  socket.sendData(data);
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
    socket.sendData(data);
  },
  terminalEl,
  trackpadHint,
});

layout.initialize();
layout.fitTerminal();
socket.connect();
