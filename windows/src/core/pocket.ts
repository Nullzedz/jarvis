// JARVIS: what the island's Reminders and Notes keep, on this PC (the island's own
// storage). No DOM here, so the calendar's quick add and the tests can use it too.

import { t } from "../i18n/i18n";

export interface Reminder { id: string; text: string; done: boolean; at: number }
export interface Note { id: string; text: string; at: number }

export const REMINDERS_KEY = "jarvis.reminders";
export const NOTES_KEY = "jarvis.notes";

function load<T>(key: string): T[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
export function save<T>(key: string, v: T[]) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch {}
  dispatchEvent(new CustomEvent("jarvis-pocket", { detail: key }));
}
export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const Pocket = {
  reminders: () => load<Reminder>(REMINDERS_KEY),
  notes: () => load<Note>(NOTES_KEY),
  /** Today's quick add hands "buy / call / send / remind" here. */
  addReminder: (text: string) => save(REMINDERS_KEY, [{ id: newId(), text, done: false, at: Date.now() }, ...load<Reminder>(REMINDERS_KEY)]),
};

/** A note's title: its first line. */
export function noteTitle(n: Note): string {
  return n.text.split("\n").find((l) => l.trim())?.trim().slice(0, 60) || t("New note");
}

