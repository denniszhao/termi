interface AttachTrackpadOptions {
  focusTerminal: () => void;
  isMobile: boolean;
  isUsingCustomKeyboard: () => boolean;
  sendKey: (data: string) => void;
  terminalEl: HTMLDivElement;
  trackpadHint: HTMLDivElement;
}

const DRAG_THRESHOLD = 10;
const STEP_X = 20;
const STEP_Y = 25;

export function attachTrackpad(options: AttachTrackpadOptions): void {
  const { focusTerminal, isMobile, isUsingCustomKeyboard, sendKey, terminalEl, trackpadHint } = options;
  if (!isMobile) {
    return;
  }

  let trackpadStartX = 0;
  let trackpadStartY = 0;
  let trackpadLastX = 0;
  let trackpadLastY = 0;
  let trackpadDragging = false;
  let trackpadHintTimer: number | undefined;

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
      if (!trackpadDragging && !isUsingCustomKeyboard()) {
        focusTerminal();
      }
      trackpadDragging = false;
    },
    { capture: true, passive: true },
  );
}

