export interface LayoutController {
  fitTerminal(): void;
  initialize(): void;
  isUsingCustomKeyboard(): boolean;
  toggleKeyboard(): void;
  toggleCustomKeyboardVisibility(): void;
}

interface CreateLayoutControllerOptions {
  appShellEl: HTMLDivElement;
  helperTextarea: HTMLTextAreaElement | null;
  isMobile: boolean;
  keyboardEl: HTMLDivElement;
  mobileActionsEl: HTMLDivElement;
  toggleButton: HTMLButtonElement;
  virtualToggleButton: HTMLButtonElement;
  fit: () => void;
  focusNativeKeyboard: () => void;
  hideNativeKeyboard: () => void;
  sendResize: () => void;
}

export function createLayoutController(
  options: CreateLayoutControllerOptions,
): LayoutController {
  const {
    appShellEl,
    helperTextarea,
    isMobile,
    keyboardEl,
    mobileActionsEl,
    toggleButton,
    virtualToggleButton,
    fit,
    focusNativeKeyboard,
    hideNativeKeyboard,
    sendResize,
  } = options;

  let useCustomKeyboard = isMobile;
  let customKeyboardOpen = isMobile;
  let lastWindowWidth = window.innerWidth;

  function getViewportHeight(): number {
    return window.visualViewport ? window.visualViewport.height : window.innerHeight;
  }

  function syncShellHeight(): void {
    if (!isMobile) {
      appShellEl.style.removeProperty("height");
      return;
    }

    appShellEl.style.height = `${getViewportHeight()}px`;
  }

  function syncKeyboardUi(): void {
    if (!isMobile) {
      return;
    }

    const keyboardVisible = useCustomKeyboard && customKeyboardOpen;
    keyboardEl.classList.toggle("visible", keyboardVisible);
    const keyboardHeight = keyboardVisible ? keyboardEl.offsetHeight : 0;
    mobileActionsEl.classList.add("visible");
    mobileActionsEl.style.setProperty("--mobile-actions-offset", keyboardHeight > 0 ? `${keyboardHeight + 6}px` : "0px");

    toggleButton.classList.toggle("native-active", !useCustomKeyboard);
    toggleButton.textContent = "\u2328";
    toggleButton.setAttribute("aria-label", useCustomKeyboard ? "Use device keyboard" : "Use virtual keyboard");

    virtualToggleButton.hidden = !useCustomKeyboard;
    virtualToggleButton.textContent = customKeyboardOpen ? "\u2193" : "\u2191";
    virtualToggleButton.setAttribute("aria-label", customKeyboardOpen ? "Hide virtual keyboard" : "Show virtual keyboard");
  }

  function fitTerminal(notifyRemote = false): void {
    syncShellHeight();
    syncKeyboardUi();
    fit();
    syncKeyboardUi();
    if (notifyRemote) {
      sendResize();
    }
  }

  function handleWindowResize(): void {
    const nextWidth = window.innerWidth;
    const shouldNotifyRemote = !isMobile || nextWidth !== lastWindowWidth;
    lastWindowWidth = nextWidth;
    fitTerminal(shouldNotifyRemote);
  }

  function toggleKeyboard(): void {
    if (!isMobile) {
      return;
    }

    useCustomKeyboard = !useCustomKeyboard;

    if (useCustomKeyboard) {
      hideNativeKeyboard();
      helperTextarea?.setAttribute("inputMode", "none");
      customKeyboardOpen = true;
    } else {
      helperTextarea?.removeAttribute("inputMode");
    }

    syncKeyboardUi();
    fitTerminal(useCustomKeyboard);

    if (useCustomKeyboard) {
      hideNativeKeyboard();
    } else {
      focusNativeKeyboard();
    }
  }

  function toggleCustomKeyboardVisibility(): void {
    if (!isMobile || !useCustomKeyboard) {
      return;
    }

    customKeyboardOpen = !customKeyboardOpen;
    hideNativeKeyboard();
    fitTerminal(true);
  }

  function initialize(): void {
    if (isMobile && window.visualViewport) {
      window.visualViewport.addEventListener("resize", () => {
        fitTerminal();
      });
    }

    window.addEventListener("resize", handleWindowResize);

    if (!isMobile) {
      return;
    }

    helperTextarea?.setAttribute("inputMode", "none");
    syncKeyboardUi();
    window.setTimeout(() => {
      fitTerminal();
    }, 50);
  }

  return {
    fitTerminal,
    initialize,
    isUsingCustomKeyboard: () => useCustomKeyboard,
    toggleKeyboard,
    toggleCustomKeyboardVisibility,
  };
}
