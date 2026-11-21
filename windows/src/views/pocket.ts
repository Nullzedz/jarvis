// JARVIS: the island's Reminders and Notes tabs (docs/jarvis/design/SPEC.md §7, the
// Cupola-style notch). Both are kept on this PC, in the island's own storage.
//
// Reminders: "Add a reminder, press Enter", then a list with round checkboxes; ticked
// ones fade and sink to the bottom. Notes: the notes on the left, the open note on the
// right, saved as you type.

import { h, clear } from "./dom";
import { t } from "../i18n/i18n";
import type { ViewHost } from "./views";
import "./pocket.css";

export interface PocketHost {
  /** The island takes the keyboard for a text field, and gives it back. */
  keyboard(on: boolean): void;
  /** Something is being typed: the island stays open until it's done. */
  holdOpen(on: boolean): void;
}

export interface Reminder { id: string; text: string; done: boolean; at: number }
export interface Note { id: string; text: string; at: number }

const REMINDERS_KEY = "jarvis.reminders";
const NOTES_KEY = "jarvis.notes";

function load<T>(key: string): T[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function save<T>(key: string, v: T[]) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch {}
  dispatchEvent(new CustomEvent("jarvis-pocket", { detail: key }));
}
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const Pocket = {
  reminders: () => load<Reminder>(REMINDERS_KEY),
  notes: () => load<Note>(NOTES_KEY),
};

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
  const el = h("div", { class: "pk pk-rem" }, h("label", { class: "pk-add" }, h("span", { class: "pk-spark", text: "✦" }), input), list);

  function draw() {
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
  draw();
  return { el, sync: draw, focus: () => input.focus() };
}

// ── Notes ────────────────────────────────────────────────────────────────────

/** A note's title: its first line. */
export function noteTitle(n: Note): string {
  return n.text.split("\n").find((l) => l.trim())?.trim().slice(0, 60) || t("New note");
}

export function buildNotes(host: PocketHost): ViewHost {
  const list = h("div", { class: "pk-notes" });
  const area = field(host, h("textarea", { class: "pk-note", placeholder: t("Write something…"), spellcheck: "true" }) as HTMLTextAreaElement);
  const el = h("div", { class: "pk pk-notewrap" }, list, area);
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
  return { el, sync: draw, focus: () => area.focus() };
}
