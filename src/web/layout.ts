export interface LayoutController {
  fitTerminal(): void;
  initialize(): void;
  isUsingCustomKeyboard(): boolean;
  toggleKeyboard(): void;
}

interface CreateLayoutControllerOptions {
  helperTextarea: HTMLTextAreaElement | null;
  isMobile: boolean;
  keyboardEl: HTMLDivElement;
  terminalBrandEl: HTMLDivElement;
  terminalEl: HTMLDivElement;
  toggleButton: HTMLButtonElement;
  fit: () => void;
  focusNativeKeyboard: () => void;
  hideNativeKeyboard: () => void;
  sendResize: () => void;
}

export function createLayoutController(
  options: CreateLayoutControllerOptions,
): LayoutController {
  const {
    helperTextarea,
    isMobile,
    keyboardEl,
    terminalBrandEl,
    terminalEl,
    toggleButton,
    fit,
    focusNativeKeyboard,
    hideNativeKeyboard,
    sendResize,
  } = options;

  let useCustomKeyboard = isMobile;

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
    terminalEl.style.height = `${viewportHeight - keyboardHeight - terminalBrandEl.offsetHeight}px`;
    fit();
    positionToggle();
  }

  function toggleKeyboard(): void {
    useCustomKeyboard = !useCustomKeyboard;

    if (useCustomKeyboard) {
      hideNativeKeyboard();
      helperTextarea?.setAttribute("inputMode", "none");
      keyboardEl.classList.add("visible");
      toggleButton.classList.remove("native-active");
    } else {
      keyboardEl.classList.remove("visible");
      toggleButton.classList.add("native-active");
      helperTextarea?.removeAttribute("inputMode");
    }

    toggleButton.textContent = "\u2328";
    fitTerminal();
    sendResize();

    if (useCustomKeyboard) {
      hideNativeKeyboard();
    } else {
      focusNativeKeyboard();
    }
  }

  function initialize(): void {
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

    if (!isMobile) {
      return;
    }

    helperTextarea?.setAttribute("inputMode", "none");
    keyboardEl.classList.add("visible");
    toggleButton.classList.add("visible");
    toggleButton.textContent = "\u2328";
    window.setTimeout(positionToggle, 50);
  }

  return {
    fitTerminal,
    initialize,
    isUsingCustomKeyboard: () => useCustomKeyboard,
    toggleKeyboard,
  };
}

