// JARVIS: the island's Reminders and Notes tabs (docs/jarvis/design/SPEC.md §7, the
// Cupola-style notch). Both are kept on this PC, in the island's own storage.
//
// Reminders: "Add a reminder, press Enter", then a list with round checkboxes; ticked
// ones fade and sink to the bottom. Notes: the notes on the left, the open note on the
// right, saved as you type.

import { h, clear } from "./dom";
import { t } from "../i18n/i18n";
import { Bridge, onEvent, type ClipEntry } from "../core/bridge";
import type { ViewHost } from "./views";
import "./pocket.css";

export interface PocketHost {
  /** The island takes the keyboard for a text field, and gives it back. */
  keyboard(on: boolean): void;
  /** Something is being typed: the island stays open until it's done. */
  holdOpen(on: boolean): void;
  /** What the tab holds changed: the notch fits it again. */
  resize(): void;
}

/** How tall a tab's content is: from its top to its last child's bottom, plus its bottom
 *  padding (the prototype's fit(), which measures .inner). Lists don't scroll here; the notch
 *  stops at the window and the tab scrolls only past that. */
function contentHeight(el: HTMLElement): number {
  const last = el.lastElementChild as HTMLElement | null;
  if (!last) return 0;
  const pad = parseFloat(getComputedStyle(el).paddingBottom) || 0;
  return last.offsetTop + last.offsetHeight + pad;
}

import { Pocket, newId, noteTitle, save, REMINDERS_KEY, NOTES_KEY, type Note } from "../core/pocket";
export { Pocket, noteTitle } from "../core/pocket";
export type { Reminder, Note } from "../core/pocket";

/** A text field that takes the island's keyboard while focused. */
function field<E extends HTMLInputElement | HTMLTextAreaElement>(host: PocketHost, el: E): E {
  el.addEventListener("focus", () => host.keyboard(true));
  el.addEventListener("blur", () => { host.keyboard(false); host.holdOpen(false); });
  el.addEventListener("input", () => host.holdOpen(el.value.trim() !== ""));
  return el;
}

// ── Reminders ────────────────────────────────────────────────────────────────

export function buildReminders(host: PocketHost): ViewHost {
  const input = field(host, h("input", { type: "text", class: "pk-input", placeholder: t("Add a reminder, press Enter"), spellcheck: "false" }) as HTMLInputElement);
  const list = h("div", { class: "pk-list" });
  const el = h("div", { class: "view pk pk-rem" }, h("label", { class: "pk-add" }, h("span", { class: "pk-spark", text: "✦" }), input), list);

  function draw() {
    paint();
    host.resize();
  }
  function paint() {
    const all = Pocket.reminders().sort((a, b) => Number(a.done) - Number(b.done) || b.at - a.at);
    clear(list);
    if (all.length === 0) {
      list.append(h("p", { class: "pk-empty", text: t("Nothing to remember yet.") }));
      return;
    }
    for (const r of all) {
      const row = h("div", { class: `pk-chk${r.done ? " ok" : ""}` });
      const tick = h("button", { class: "pk-tick", "aria-label": r.done ? t("Not done") : t("Done"), onclick: () => toggle(r.id) });
      const del = h("button", { class: "pk-del", "aria-label": t("Delete"), text: "×", onclick: () => remove(r.id) });
      row.append(tick, h("span", { class: "pk-text", text: r.text }), del);
      list.append(row);
    }
  }
  function toggle(id: string) {
    save(REMINDERS_KEY, Pocket.reminders().map((r) => (r.id === id ? { ...r, done: !r.done } : r)));
    draw();
  }
  function remove(id: string) {
    save(REMINDERS_KEY, Pocket.reminders().filter((r) => r.id !== id));
    draw();
  }
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const text = input.value.trim();
    if (!text) return;
    save(REMINDERS_KEY, [{ id: newId(), text, done: false, at: Date.now() }, ...Pocket.reminders()]);
    input.value = "";
    host.holdOpen(false);
    draw();
  });
  paint();
  return { el, sync: paint, focus: () => input.focus(), fitHeight: () => contentHeight(el) };
}

// ── Notes ────────────────────────────────────────────────────────────────────

export function buildNotes(host: PocketHost): ViewHost {
  const list = h("div", { class: "pk-notes" });
  const area = field(host, h("textarea", { class: "pk-note", placeholder: t("Write something…"), spellcheck: "true" }) as HTMLTextAreaElement);
  const el = h("div", { class: "view pk pk-notewrap" }, list, area);
  let current: string | null = null;
  let typing = 0;

  function when(at: number): string {
    const d = new Date(at), now = new Date();
    return d.toDateString() === now.toDateString()
      ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString(undefined, { weekday: "long" });
  }
  function draw() {
    const notes = Pocket.notes().sort((a, b) => b.at - a.at);
    if (!current || !notes.some((n) => n.id === current)) current = notes[0]?.id ?? null;
    clear(list);
    list.append(h("button", { class: "pk-new", text: `+ ${t("New note")}`, onclick: () => add() }));
    for (const n of notes) {
      list.append(h("button", { class: `pk-nb${n.id === current ? " on" : ""}`, onclick: () => { current = n.id; draw(); area.focus(); } },
        h("span", { class: "pk-nt", text: noteTitle(n) }), h("span", { class: "pk-nd", text: when(n.at) })));
    }
    const open = notes.find((n) => n.id === current);
    if (document.activeElement !== area) area.value = open?.text ?? "";
    area.disabled = !open;
    area.placeholder = open ? t("Write something…") : t("Press + New note to start one.");
  }
  function add() {
    const n: Note = { id: newId(), text: "", at: Date.now() };
    save(NOTES_KEY, [n, ...Pocket.notes()]);
    current = n.id;
    draw();
    area.value = "";
    area.focus();
  }
  area.addEventListener("input", () => {
    clearTimeout(typing);
    typing = window.setTimeout(() => {
      if (!current) return;
      const text = area.value;
      // An emptied note goes away; the rest are saved as typed.
      const next = text.trim()
        ? Pocket.notes().map((n) => (n.id === current ? { ...n, text, at: Date.now() } : n))
        : Pocket.notes().filter((n) => n.id !== current);
      save(NOTES_KEY, next);
      if (!text.trim()) current = null;
      draw();
    }, 300);
  });
  draw();
  return { el, sync: draw, focus: () => area.focus(), fitHeight: () => contentHeight(el) };
}

// ── Clipboard ────────────────────────────────────────────────────────────────
// One to one with the notch prototype's Clipboard pane: a search field, then each copy
// as a row: what it is in a grey tag, the copy (an image as its small picture), a pin
// ★ (orange when pinned; pinned ones stay on top) and a blue Copy.

export type ClipKind = "text" | "link" | "email" | "code" | "image";

/** What a copy is: what its tag says. */
export function clipKind(c: Pick<ClipEntry, "kind" | "text">): ClipKind {
  if (c.kind === "image") return "image";
  const s = c.text.trim();
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s)) return "email";
  if (/^(https?:\/\/|www\.)\S+$/i.test(s) || /^[\w-]+(\.[\w-]+)+\/\S*$/.test(s)) return "link";
  if (
    /[{};]\s*$|=>|\(\)|::|^\s*(const|let|var|function|def|class|import|export|fn|pub|return|if|for|while)\b/m.test(s) ||
    /^(\$ |npm |npx |git |cargo |cd |ls |python |node |pip |curl )/m.test(s) ||
    /\n[ \t]{2,}\S/.test(s)
  ) return "code";
  return "text";
}

/** The tag's words, in the island's language. */
export function clipKindLabel(k: ClipKind): string {
  switch (k) {
    case "link": return t("Link");
    case "email": return t("Email");
    case "code": return t("Code");
    case "image": return t("Image");
    default: return t("Text");
  }
}

export function buildClipboard(host: Pick<PocketHost, "resize">): ViewHost {
  const search = h("input", { class: "td-qa-in", placeholder: t("Search what you copied"), spellcheck: "false" }) as HTMLInputElement;
  const searchRow = h("label", { class: "pk-add td-qa cb-search" }, h("span", { class: "cb-glass", text: "⌕" }), search);
  const list = h("div", { class: "cb-list" });
  const el = h("div", { class: "view pk pk-clip" }, searchRow, list);
  let clips: ClipEntry[] = [];

  function draw() {
    paint();
    host.resize();
  }
  function paint() {
    clear(list);
    const q = search.value.trim().toLowerCase();
    const shown = clips
      .filter((c) => !q || c.text.toLowerCase().includes(q) || clipKindLabel(clipKind(c)).toLowerCase().includes(q))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned));
    if (shown.length === 0) {
      list.append(h("p", { class: "pk-empty", text: q ? t("Nothing copied matches.") : t("What you copy shows here. Kept in memory only, never saved.") }));
      return;
    }
    for (const c of shown) {
      const what = c.kind === "image" && c.thumb
        ? h("span", { class: "t cb-img" }, h("img", { src: c.thumb, alt: "" }), h("span", { text: c.text }))
        : h("span", { class: "t", text: c.text.replace(/\s+/g, " "), title: c.text.slice(0, 400) });
      const pin = h("button", {
        class: c.pinned ? "pin on" : "pin",
        text: "★",
        title: c.pinned ? t("Unpin") : t("Pin"),
        "aria-label": c.pinned ? t("Unpin") : t("Pin"),
        onclick: () => void Bridge.clipboardPin(c.id, !c.pinned),
      });
      const copy = h("button", { class: "cb-copy", text: t("Copy") });
      copy.onclick = async () => {
        if (await Bridge.clipboardUse(c.id)) {
          copy.textContent = t("Copied");
          setTimeout(() => { copy.textContent = t("Copy"); }, 900);
        }
      };
      list.append(h("div", { class: "clip" }, h("span", { class: "k", text: clipKindLabel(clipKind(c)) }), what, pin, copy));
    }
  }
  search.addEventListener("input", draw);
  search.addEventListener("keydown", (e) => e.stopPropagation());
  void onEvent<ClipEntry[]>("clipboard-history", (next) => { clips = next; draw(); });
  const refresh = async () => { clips = (await Bridge.clipboardHistory()) ?? clips; draw(); };
  void refresh();
  return { el, sync: () => void refresh(), focus: () => search.focus(), fitHeight: () => contentHeight(el) };
}
