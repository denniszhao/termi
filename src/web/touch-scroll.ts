import type { Terminal } from "@xterm/xterm";

interface CreateTouchScrollControllerOptions {
  isMobile: boolean;
  term: Terminal;
  terminalEl: HTMLDivElement;
}

export interface TouchScrollController {
  mount(): void;
}

export function createTouchScrollController(
  options: CreateTouchScrollControllerOptions,
): TouchScrollController {
  const { isMobile, term, terminalEl } = options;
  let isTracking = false;
  let lastTouchY = 0;
  let viewportEl: HTMLElement | null = null;

  function getViewport(): HTMLElement | null {
    if (viewportEl && terminalEl.contains(viewportEl)) {
      return viewportEl;
    }
    viewportEl = terminalEl.querySelector(".xterm-viewport") as HTMLElement | null;
    return viewportEl;
  }

  function canScrollHistory(): boolean {
    const activeBuffer = term.buffer.active;
    return activeBuffer.type === "normal" && activeBuffer.baseY > 0;
  }

  function mount(): void {
    if (!isMobile) {
      return;
    }

    terminalEl.addEventListener("touchstart", (event) => {
      if (event.touches.length !== 1 || !canScrollHistory()) {
        isTracking = false;
        return;
      }

      isTracking = true;
      lastTouchY = event.touches[0]!.clientY;
    }, { passive: true });

    terminalEl.addEventListener("touchmove", (event) => {
      if (!isTracking || event.touches.length !== 1) {
        return;
      }

      const viewport = getViewport();
      if (!viewport) {
        return;
      }

      const nextTouchY = event.touches[0]!.clientY;
      const deltaY = nextTouchY - lastTouchY;
      lastTouchY = nextTouchY;
      if (deltaY === 0) {
        return;
      }

      event.preventDefault();
      viewport.scrollTop -= deltaY;
    }, { passive: false });

    terminalEl.addEventListener("touchend", () => {
      isTracking = false;
    });

    terminalEl.addEventListener("touchcancel", () => {
      isTracking = false;
    });
  }

  return {
    mount,
  };
}
