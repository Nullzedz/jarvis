// JARVIS (#84): a page that fills the window (Mail's month, the JARVIS conversation) measures the
// space it really has, instead of guessing it from the window's height (calc(100vh - N) left a
// 5 px scrollbar on Mail and put the JARVIS type box below the window when it was small).

/** Runs `fn` once `el` is in the window's scroller (a page is drawn before the shell shows it). */
export function whenShown(el: HTMLElement, fn: (scroller: HTMLElement) => void, tries = 60) {
  const sc = el.isConnected ? el.closest<HTMLElement>(".hub-scroll") : null;
  if (sc) { fn(sc); return; }
  if (tries > 0) requestAnimationFrame(() => whenShown(el, fn, tries - 1));
}

/** Keeps `el` exactly as tall as the room left under it in its scroller, never less than `min`. */
export function fillWindow(el: HTMLElement, min: number): () => void {
  const fit = () => {
    const sc = el.closest<HTMLElement>(".hub-scroll");
    if (!sc) return;
    const pad = parseFloat(getComputedStyle(sc).paddingBottom) || 0;
    const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
    el.style.height = `${Math.max(min, Math.floor(sc.clientHeight - top - pad))}px`;
  };
  // Once it's in the window, then whenever the window changes size.
  whenShown(el, fit);
  addEventListener("resize", fit);
  return () => removeEventListener("resize", fit);
}
