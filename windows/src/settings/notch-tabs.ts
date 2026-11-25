// JARVIS: Settings → General → "Tabs in the notch" (design C, as iPhone's Control Center
// settings): "In the notch", Home first and fixed, then the shown tabs with a red − and ≡ to
// drag them into order; "More tabs", the hidden ones, each with a green +. Saved where the
// notch keeps its order (core/taborder.ts) and sent to it at once.

import { emitToWindow } from "../core/bridge";
import {
  TABS_EVENT, TAB_IDS, dropIndex, loadHiddenTabs, loadTabOrder, moveItem, orderTabs, saveHiddenTabs, saveTabOrder,
  setShown, shownTabs,
} from "../core/taborder";
import { h, clear, svg } from "../views/dom";
import { ICONS } from "../views/icons";
import { t } from "../i18n/i18n";

/** Each tab as the notch draws it: name, icon, and its colour in this list. */
const TABS: Record<string, { name: () => string; color: string; icon: () => SVGSVGElement }> = {
  ask: { name: () => t("Ask"), color: "#0a84ff", icon: () => svg(ICONS.bubbleRound, 14) },
  drop: { name: () => t("Drop"), color: "#64d2ff", icon: () => svg(ICONS.plus, 13) },
  launch: { name: () => t("New Claude Code session"), color: "#636366", icon: () => svg(ICONS.terminal, 14, { stroke: 1.9 }) },
  calendar: { name: () => t("Calendar"), color: "#ff453a", icon: () => svg(ICONS.calendar, 14, { stroke: 1.9 }) },
  widgets: { name: () => t("Overview"), color: "#5e5ce6", icon: () => svg("M5 3.5h4a1.5 1.5 0 0 1 1.5 1.5v4A1.5 1.5 0 0 1 9 10.5H5A1.5 1.5 0 0 1 3.5 9V5A1.5 1.5 0 0 1 5 3.5zM15 3.5h4A1.5 1.5 0 0 1 20.5 5v4a1.5 1.5 0 0 1-1.5 1.5h-4A1.5 1.5 0 0 1 13.5 9V5A1.5 1.5 0 0 1 15 3.5zM5 13.5h4a1.5 1.5 0 0 1 1.5 1.5v4A1.5 1.5 0 0 1 9 20.5H5A1.5 1.5 0 0 1 3.5 19v-4A1.5 1.5 0 0 1 5 13.5zM15 13.5h4a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5h-4a1.5 1.5 0 0 1-1.5-1.5v-4a1.5 1.5 0 0 1 1.5-1.5z", 14, { stroke: 1.9 }) },
  reminders: { name: () => t("Reminders"), color: "#ff9f0a", icon: () => svg("M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM8.2 12.2l2.6 2.6 5-5.6", 14, { stroke: 1.9 }) },
  notes: { name: () => t("Notes"), color: "#ffcc00", icon: () => svg("M6 3.5h12v17H6zM9.5 8.5h5M9.5 12h5M9.5 15.5h3", 14, { stroke: 1.9 }) },
  clipboard: { name: () => t("Clipboard"), color: "#8e8e93", icon: () => svg("M7 5h10a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 17 21H7a1.5 1.5 0 0 1-1.5-1.5v-13A1.5 1.5 0 0 1 7 5zM9.5 3.5h5v3h-5z", 14, { stroke: 1.9 }) },
  focus: { name: () => t("Focus"), color: "#bf5af2", icon: () => svg("M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", 14, { stroke: 1.9 }) },
  agents: { name: () => t("Agents"), color: "#30d158", icon: () => {
    const s = svg("M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z", 14, { stroke: 1.9 });
    const ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    for (const [k, v] of [["cx", "12"], ["cy", "12"], ["r", "8"], ["fill", "none"], ["stroke", "currentColor"], ["stroke-width", "1.9"], ["stroke-dasharray", "2 3"]]) ring.setAttribute(k, v);
    s.append(ring);
    return s;
  } },
};

export function notchTabsSection(): HTMLElement {
  const shownList = h("div", { class: "nt-list" });
  const moreList = h("div", { class: "nt-list" });
  const moreWrap = h("div", {}, h("p", { class: "nt-cap", text: t("More tabs") }), moreList);

  function state() {
    return { order: orderTabs([...TAB_IDS], loadTabOrder()), hidden: loadHiddenTabs() };
  }
  function commit(order: string[], hidden: string[]) {
    saveTabOrder(order);
    saveHiddenTabs(hidden);
    void emitToWindow("island", TABS_EVENT);
    draw();
  }

  const square = (color: string, icon: SVGSVGElement) => {
    const sq = h("span", { class: "nt-icon" }, icon);
    sq.style.background = color;
    return sq;
  };

  function draw() {
    const { order, hidden } = state();
    const shown = shownTabs(order, hidden);
    clear(shownList);
    // Home: always there, always first.
    shownList.append(h("div", { class: "nt-row fixed" },
      h("span", { class: "nt-pm none" }),
      square("#8e8e93", svg(ICONS.house, 14)),
      h("span", { class: "nt-name", text: t("Home") }),
      h("span", { class: "nt-note", text: t("always first") })));
    for (const id of shown) {
      const info = TABS[id];
      if (!info) continue;
      const handle = h("span", { class: "nt-handle", title: t("Drag to reorder"), "aria-hidden": "true" }, "≡");
      const row = h("div", { class: "nt-row", "data-id": id },
        h("button", { class: "nt-pm minus", title: t("Hide"), "aria-label": t("Hide {name}", { name: info.name() }),
          onclick: () => { const s = state(); const n = setShown(s.order, s.hidden, id, false); commit(n.order, n.hidden); } }, "−"),
        square(info.color, info.icon()),
        h("span", { class: "nt-name", text: info.name() }),
        handle);
      dragRow(row, handle, shown);
      shownList.append(row);
    }
    clear(moreList);
    const more = order.filter((id) => hidden.includes(id));
    moreWrap.style.display = more.length ? "" : "none";
    for (const id of more) {
      const info = TABS[id];
      if (!info) continue;
      moreList.append(h("div", { class: "nt-row" },
        h("button", { class: "nt-pm plus", title: t("Show"), "aria-label": t("Show {name}", { name: info.name() }),
          onclick: () => { const s = state(); const n = setShown(s.order, s.hidden, id, true); commit(n.order, n.hidden); } }, "+"),
        square(info.color, info.icon()),
        h("span", { class: "nt-name", text: info.name() })));
    }
  }

  /** ≡: drag a shown row up or down; the others make room; dropped, the new order is saved. */
  function dragRow(row: HTMLElement, handle: HTMLElement, shown: string[]) {
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const rows = [...shownList.querySelectorAll<HTMLElement>(".nt-row[data-id]")];
      const from = rows.indexOf(row);
      const tops = rows.map((r) => r.getBoundingClientRect().top);
      const step = rows.length > 1 ? tops[1] - tops[0] : row.offsetHeight;
      const y0 = e.clientY;
      let to = from;
      try { handle.setPointerCapture(e.pointerId); } catch { /* fine without */ }
      row.classList.add("dragging");
      for (const r of rows) if (r !== row) r.style.transition = "transform .2s cubic-bezier(.32,.72,0,1)";
      const move = (ev: PointerEvent) => {
        const dy = Math.max(tops[0] - tops[from], Math.min(tops[rows.length - 1] - tops[from], ev.clientY - y0));
        row.style.transform = `translateY(${dy}px)`;
        const centres = tops.filter((_, i) => i !== from).map((top) => top + step / 2);
        to = dropIndex(centres, tops[from] + step / 2 + dy);
        rows.forEach((r, i) => {
          if (r === row) return;
          let shift = 0;
          if (from < to && i > from && i <= to) shift = -step;
          if (from > to && i >= to && i < from) shift = step;
          r.style.transform = shift ? `translateY(${shift}px)` : "";
        });
      };
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        const s = state();
        const next = moveItem(shown, from, to);
        commit([...next, ...s.order.filter((id) => s.hidden.includes(id))], s.hidden);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
  }

  draw();
  // Reordered in the notch meanwhile (dragging its tabs): this list follows, while it's on screen (#84).
  let seen = false;
  const onStore = (e: StorageEvent) => {
    if (!section.isConnected) { if (seen) window.removeEventListener("storage", onStore); return; }
    seen = true;
    if (e.key?.startsWith("jarvis.tabs.")) draw();
  };
  window.addEventListener("storage", onStore);

  const section = h("section", {},
    h("h2", {}, h("span", { text: t("Tabs in the island") })),
    h("div", { class: "hint", text: t("Choose what the island's tab bar shows, and in what order. Home always comes first; a hidden tab still opens from the Overview.") }),
    h("p", { class: "nt-cap", text: t("In the island") }),
    shownList,
    moreWrap);
  return section;
}
