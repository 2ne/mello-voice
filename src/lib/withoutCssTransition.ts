let timeoutAction: number | undefined;
let timeoutEnable: number | undefined;

/**
 * Runs `action` while a one-shot stylesheet forces `transition: none` on all elements,
 * so DOM updates (e.g. toggling `dark` on `<html>`) apply instantly instead of tweening.
 *
 * @see https://reemus.dev/article/disable-css-transition-color-scheme-change
 * @see https://paco.me/writing/disable-theme-transitions
 */
export function withoutCssTransition(action: () => void): void {
  if (typeof document === "undefined") {
    action();
    return;
  }

  clearTimeout(timeoutAction);
  clearTimeout(timeoutEnable);

  const style = document.createElement("style");
  style.setAttribute("data-mello-disable-transitions", "");
  style.appendChild(
    document.createTextNode(`* {
  -webkit-transition: none !important;
  transition: none !important;
}`),
  );

  const disable = () => {
    if (!style.isConnected) {
      document.head.appendChild(style);
    }
  };

  const enable = () => {
    if (style.isConnected) {
      document.head.removeChild(style);
    }
  };

  if (typeof window.getComputedStyle !== "undefined") {
    disable();
    action();
    void window.getComputedStyle(style).opacity;
    enable();
    return;
  }

  if (typeof window.requestAnimationFrame !== "undefined") {
    disable();
    action();
    window.requestAnimationFrame(enable);
    return;
  }

  disable();
  timeoutAction = window.setTimeout(() => {
    action();
    timeoutEnable = window.setTimeout(enable, 120);
  }, 120);
}
