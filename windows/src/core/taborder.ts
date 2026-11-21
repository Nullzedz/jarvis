// JARVIS: the order of the island's tabs, as you drag them (src/views/views.ts). Home is not in
// here: it always stays first. Kept in the island's storage. Pure parts tested in
// tests/taborder.test.mjs.

const KEY = "jarvis.tabs.order";

/**
 * The tabs in your order: the saved ids first (those still known), then any new tab in its
 * default place at the end, so a tab added later is never lost.
 */
export function orderTabs(defaults: readonly string[], saved: readonly string[] | null): string[] {
  const known = (saved ?? []).filter((id, i, all) => defaults.includes(id) && all.indexOf(id) === i);
  return [...known, ...defaults.filter((id) => !known.includes(id))];
}

/** `list` with the item at `from` moved to `to` (both clamped to the list). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  const f = Math.max(0, Math.min(out.length - 1, from));
  const [item] = out.splice(f, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, item);
  return out;
}

/**
 * Where a dragged tab lands: among the others' centres (left to right, the dragged one's own
 * slot left out), the number of them left of the point its centre has reached.
 */
export function dropIndex(otherCentres: readonly number[], draggedCentre: number): number {
  return otherCentres.filter((c) => c < draggedCentre).length;
}

export function loadTabOrder(): string[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : null;
  } catch {
    return null;
  }
}

export function saveTabOrder(ids: readonly string[]) {
  try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* not remembered */ }
}
