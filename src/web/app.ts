import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "./app.css";

type KeyboardMode = "letters" | "numbers" | "symbols";
type ShiftState = "off" | "on" | "caps";

interface ModifierKey {
  id: string;
  label: string;
  mod?: boolean;
  wide?: boolean;
  space?: boolean;
}

type KeyboardKey = string | ModifierKey;

function mustGetElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing required element: ${id}`);
  }
  return el as T;
}

function getClosestKey(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) {
    return null;
  }
  return target.closest("[data-char],[data-id]") as HTMLElement | null;
}

const isMobile = "ontouchstart" in window;
const proto = location.protocol === "https:" ? "wss:" : "ws:";
const token = new URLSearchParams(location.search).get("t") ?? "";
const wsUrl = `${proto}//${location.host}/?t=${token}`;

const terminalEl = mustGetElement<HTMLDivElement>("terminal");
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

let keyboardMode: KeyboardMode = "letters";
let shiftState: ShiftState = "off";
let ctrlActive = false;
let useCustomKeyboard = true;
let lastShiftTap = 0;
let ws: WebSocket | undefined;
let reconnectTimer: number | undefined;
let trackpadHintTimer: number | undefined;

const LETTERS_TOP: string[][] = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
];
const LETTERS_SHIFT_ROW: KeyboardKey[] = [
  { id: "shift", label: "\u21e7", mod: true, wide: true },
  "z",
  "x",
  "c",
  "v",
  "b",
  "n",
  "m",
  { id: "backspace", label: "\u232b", mod: true, wide: true },
];
const LETTERS_BOTTOM_ROW: KeyboardKey[] = [
  { id: "numbers", label: "123", mod: true, wide: true },
  "/",
  "-",
  { id: "space", label: " ", space: true },
  ".",
];

const NUMBERS_TOP: string[][] = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["!", "@", "#", "$", "%", "^", "&", "*", "(", ")"],
];
const NUMBERS_SHIFT_ROW: KeyboardKey[] = [
  { id: "symbols", label: "#+=", mod: true, wide: true },
  "-",
  "_",
  "=",
  "+",
  "[",
  "]",
  "\\",
  { id: "backspace", label: "\u232b", mod: true, wide: true },
];
const NUMBERS_BOTTOM_ROW: KeyboardKey[] = [
  { id: "letters", label: "abc", mod: true, wide: true },
  "|",
  "~",
  { id: "space", label: " ", space: true },
  ":",
];

const SYMBOLS_TOP: string[][] = [
  ["`", "'", "\"", ";", ":", "{", "}", "<", ">", "?"],
  ["~", "|", "\\", "/", "&", "^", "%", "$", "#", "@"],
];
const SYMBOLS_SHIFT_ROW: KeyboardKey[] = [
  { id: "numbers", label: "123", mod: true, wide: true },
  "!",
  "+",
  "=",
  "*",
  "[",
  "]",
  "(",
  { id: "backspace", label: "\u232b", mod: true, wide: true },
];
const SYMBOLS_BOTTOM_ROW: KeyboardKey[] = [
  { id: "letters", label: "abc", mod: true, wide: true },
  "_",
  "~",
  { id: "space", label: " ", space: true },
  ".",
];

const ACTION_ROW: ModifierKey[] = [
  { id: "ctrlc", label: "^C" },
  { id: "ctrlz", label: "^Z" },
  { id: "ctrll", label: "^L" },
  { id: "tab", label: "Tab" },
  { id: "esc", label: "Esc" },
  { id: "ctrl", label: "Ctrl" },
  { id: "up", label: "\u2191" },
  { id: "down", label: "\u2193" },
];

const ACTION_KEYS: Record<string, string> = {
  ctrlc: "\x03",
  ctrlz: "\x1a",
  ctrll: "\x0c",
  tab: "\t",
  esc: "\x1b",
  up: "\x1b[A",
  down: "\x1b[B",
  backspace: "\x7f",
  space: " ",
  enter: "\r",
};

function getLayout(): { top: string[][]; shift: KeyboardKey[]; bottom: KeyboardKey[] } {
  if (keyboardMode === "numbers") {
    return { top: NUMBERS_TOP, shift: NUMBERS_SHIFT_ROW, bottom: NUMBERS_BOTTOM_ROW };
  }
  if (keyboardMode === "symbols") {
    return { top: SYMBOLS_TOP, shift: SYMBOLS_SHIFT_ROW, bottom: SYMBOLS_BOTTOM_ROW };
  }
  return { top: LETTERS_TOP, shift: LETTERS_SHIFT_ROW, bottom: LETTERS_BOTTOM_ROW };
}

function renderKey(key: KeyboardKey): string {
  if (typeof key === "string") {
    let char = key;
    if (keyboardMode === "letters" && shiftState !== "off") {
      char = key.toUpperCase();
    }
    return `<div class="kb-key" data-char="${char.replace(/"/g, "&quot;")}">${char}</div>`;
  }

  let className = "kb-key";
  if (key.mod) className += " mod";
  if (key.wide) className += " wide";
  if (key.space) className += " space";
  if (key.id === "shift" && shiftState !== "off") className += " active";
  return `<div class="${className}" data-id="${key.id}">${key.label}</div>`;
}

function renderKeyboard(): void {
  const layout = getLayout();
  let html = '<div class="kb-row action-row">';
  for (const action of ACTION_ROW) {
    let className = "kb-key action";
    if (action.id === "ctrl" && ctrlActive) className += " active";
    html += `<div class="${className}" data-id="${action.id}">${action.label}</div>`;
  }
  html += "</div>";

  for (const row of layout.top) {
    html += '<div class="kb-row">';
    for (const key of row) {
      html += renderKey(key);
    }
    html += "</div>";
  }

  html += '<div class="kb-bottom-wrap"><div class="kb-bottom-left">';
  html += '<div class="kb-row">';
  for (const key of layout.shift) {
    html += renderKey(key);
  }
  html += "</div>";

  html += '<div class="kb-row">';
  for (const key of layout.bottom) {
    html += renderKey(key);
  }
  html += '</div></div><div class="kb-enter" data-id="enter">\u21b5</div></div>';

  keyboardEl.innerHTML = html;
}

function sendKey(data: string): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "data", data }));
  }
}

function sendResize(): void {
  const dims = fitAddon.proposeDimensions();
  if (dims && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
  }
}

function handleKey(el: HTMLElement): void {
  const char = el.getAttribute("data-char");
  const id = el.getAttribute("data-id");

  if (char) {
    if (ctrlActive) {
      const code = char.toLowerCase().charCodeAt(0) - 96;
      sendKey(code >= 1 && code <= 26 ? String.fromCharCode(code) : char);
      ctrlActive = false;
      renderKeyboard();
    } else {
      sendKey(char);
      if (shiftState === "on") {
        shiftState = "off";
        renderKeyboard();
      }
    }
    return;
  }

  if (!id) {
    return;
  }

  if (id === "shift") {
    const now = Date.now();
    if (shiftState === "off") {
      shiftState = "on";
      lastShiftTap = now;
    } else if (shiftState === "on" && now - lastShiftTap < 400) {
      shiftState = "caps";
    } else {
      shiftState = "off";
    }
    renderKeyboard();
    return;
  }

  if (id === "ctrl") {
    ctrlActive = !ctrlActive;
    renderKeyboard();
    return;
  }

  if (id === "numbers" || id === "symbols" || id === "letters") {
    keyboardMode = id;
    renderKeyboard();
    return;
  }

  const sequence = ACTION_KEYS[id];
  if (sequence) {
    sendKey(sequence);
    if (ctrlActive) {
      ctrlActive = false;
      renderKeyboard();
    }
  }
}

function positionToggle(): void {
  if (!isMobile) {
    return;
  }
  if (useCustomKeyboard) {
    toggleButton.style.bottom = `${keyboardEl.offsetHeight + 6}px`;
    return;
  }

  const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  const keyboardHeight = window.innerHeight - viewportHeight;
  toggleButton.style.bottom = `${keyboardHeight > 50 ? keyboardHeight + 6 : 50}px`;
}

function fitTerminal(): void {
  const keyboardHeight = isMobile && useCustomKeyboard ? keyboardEl.offsetHeight : 0;
  const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  terminalEl.style.height = `${viewportHeight - keyboardHeight}px`;
  fitAddon.fit();
  positionToggle();
}

function toggleKeyboard(): void {
  useCustomKeyboard = !useCustomKeyboard;
  if (useCustomKeyboard) {
    helperTextarea?.setAttribute("inputMode", "none");
    keyboardEl.classList.add("visible");
    toggleButton.classList.remove("native-active");
  } else {
    helperTextarea?.removeAttribute("inputMode");
    keyboardEl.classList.remove("visible");
    toggleButton.classList.add("native-active");
  }
  toggleButton.textContent = "\u2328";
  fitTerminal();
  sendResize();
  term.focus();
}

function scheduleReconnect(): void {
  if (reconnectTimer !== undefined) {
    return;
  }
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = undefined;
    connect();
  }, 2000);
}

function connect(): void {
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    statusEl.textContent = "Connected";
    statusEl.classList.add("connected");
    fitTerminal();
    sendResize();
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(String(event.data)) as { type?: string; data?: string };
    if (msg.type === "data" && msg.data) {
      term.write(msg.data);
    }
  };

  ws.onclose = () => {
    statusEl.textContent = "Disconnected. Reconnecting...";
    statusEl.classList.remove("connected");
    scheduleReconnect();
  };

  ws.onerror = () => {
    ws?.close();
  };
}

toggleButton.addEventListener("click", (event) => {
  event.preventDefault();
  toggleKeyboard();
});

term.onData((data) => sendKey(data));

keyboardEl.addEventListener(
  "touchstart",
  (event) => {
    const el = getClosestKey(event.target);
    if (!el) {
      return;
    }
    event.preventDefault();
    el.classList.add("pressed");
    handleKey(el);
  },
  { passive: false },
);

keyboardEl.addEventListener("touchend", (event) => {
  const el = event.target instanceof Element
    ? (event.target.closest(".pressed") as HTMLElement | null)
    : null;
  el?.classList.remove("pressed");
});

keyboardEl.addEventListener("click", (event) => {
  if (isMobile) {
    return;
  }
  const el = getClosestKey(event.target);
  if (el) {
    handleKey(el);
  }
});

let trackpadStartX = 0;
let trackpadStartY = 0;
let trackpadLastX = 0;
let trackpadLastY = 0;
let trackpadDragging = false;
const DRAG_THRESHOLD = 10;
const STEP_X = 20;
const STEP_Y = 25;

if (isMobile) {
  terminalEl.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches.length !== 1) {
        return;
      }
      trackpadStartX = trackpadLastX = event.touches[0].clientX;
      trackpadStartY = trackpadLastY = event.touches[0].clientY;
      trackpadDragging = false;
    },
    { capture: true, passive: true },
  );

  terminalEl.addEventListener(
    "touchmove",
    (event) => {
      if (event.touches.length !== 1) {
        return;
      }

      const x = event.touches[0].clientX;
      const y = event.touches[0].clientY;

      if (!trackpadDragging) {
        const deltaX = Math.abs(x - trackpadStartX);
        const deltaY = Math.abs(y - trackpadStartY);
        if (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD) {
          trackpadDragging = true;
          trackpadHint.classList.add("show");
          if (trackpadHintTimer !== undefined) {
            window.clearTimeout(trackpadHintTimer);
          }
          trackpadHintTimer = window.setTimeout(() => {
            trackpadHint.classList.remove("show");
          }, 800);
        }
      }

      if (!trackpadDragging) {
        return;
      }

      event.preventDefault();
      let moveX = x - trackpadLastX;
      let moveY = y - trackpadLastY;

      while (moveX > STEP_X) {
        sendKey("\x1b[C");
        trackpadLastX += STEP_X;
        moveX -= STEP_X;
      }
      while (moveX < -STEP_X) {
        sendKey("\x1b[D");
        trackpadLastX -= STEP_X;
        moveX += STEP_X;
      }
      while (moveY > STEP_Y) {
        sendKey("\x1b[B");
        trackpadLastY += STEP_Y;
        moveY -= STEP_Y;
      }
      while (moveY < -STEP_Y) {
        sendKey("\x1b[A");
        trackpadLastY -= STEP_Y;
        moveY += STEP_Y;
      }
    },
    { capture: true, passive: false },
  );

  terminalEl.addEventListener(
    "touchend",
    () => {
      if (!trackpadDragging) {
        term.focus();
      }
      trackpadDragging = false;
    },
    { capture: true, passive: true },
  );
}

if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", () => {
    fitTerminal();
    sendResize();
  });
}

window.addEventListener("resize", () => {
  fitTerminal();
  sendResize();
});

if (isMobile) {
  helperTextarea?.setAttribute("inputMode", "none");
  renderKeyboard();
  keyboardEl.classList.add("visible");
  toggleButton.classList.add("visible");
  toggleButton.textContent = "\u2328";
  window.setTimeout(positionToggle, 50);
}

fitTerminal();
connect();
