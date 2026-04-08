import { getClosestKey } from "./dom.js";

type KeyboardMode = "letters" | "numbers" | "symbols";
type ShiftState = "off" | "on" | "caps";

interface ModifierKey {
  id: string;
  label: string;
  mod?: boolean;
  wide?: boolean;
  space?: boolean;
  enter?: boolean;
}

type KeyboardKey = string | ModifierKey;

interface CreateKeyboardControllerOptions {
  keyboardEl: HTMLDivElement;
  isMobile: boolean;
  onInput: (data: string) => void;
}

export interface KeyboardController {
  mount(): void;
  render(): void;
}

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
  { id: "enter", label: "\u21b5", enter: true },
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
  { id: "enter", label: "\u21b5", enter: true },
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
  { id: "enter", label: "\u21b5", enter: true },
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

export function createKeyboardController(
  options: CreateKeyboardControllerOptions,
): KeyboardController {
  const { keyboardEl, isMobile, onInput } = options;
  let keyboardMode: KeyboardMode = "letters";
  let shiftState: ShiftState = "off";
  let ctrlActive = false;
  let lastShiftTap = 0;

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
    if (key.enter) className += " enter";
    if (key.id === "shift" && shiftState !== "off") className += " active";
    return `<div class="${className}" data-id="${key.id}">${key.label}</div>`;
  }

  function render(): void {
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

    html += '<div class="kb-row">';
    for (const key of layout.shift) {
      html += renderKey(key);
    }
    html += "</div>";

    html += '<div class="kb-row">';
    for (const key of layout.bottom) {
      html += renderKey(key);
    }
    html += "</div>";

    keyboardEl.innerHTML = html;
  }

  function handleKey(el: HTMLElement): void {
    const char = el.getAttribute("data-char");
    const id = el.getAttribute("data-id");

    if (char) {
      if (ctrlActive) {
        const code = char.toLowerCase().charCodeAt(0) - 96;
        onInput(code >= 1 && code <= 26 ? String.fromCharCode(code) : char);
        ctrlActive = false;
        render();
      } else {
        onInput(char);
        if (shiftState === "on") {
          shiftState = "off";
          render();
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
      render();
      return;
    }

    if (id === "ctrl") {
      ctrlActive = !ctrlActive;
      render();
      return;
    }

    if (id === "numbers" || id === "symbols" || id === "letters") {
      keyboardMode = id;
      render();
      return;
    }

    const sequence = ACTION_KEYS[id];
    if (sequence) {
      onInput(sequence);
      if (ctrlActive) {
        ctrlActive = false;
        render();
      }
    }
  }

  function mount(): void {
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
  }

  return {
    mount,
    render,
  };
}

