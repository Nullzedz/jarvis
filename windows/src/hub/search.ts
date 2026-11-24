// Settings search in the Coucou window: matches every setting of Flow,
// Notch and Mail in the app's language, whatever the accents and case.
// Port of SettingsSearch.swift and SettingsSearchMatch.swift.

import { t } from "../i18n/i18n";
import type { PageId } from "./shell";

export interface SettingsSearchEntry {
  /** The box's anchor, unique. */
  id: string;
  page: PageId;
  /** The box's title (catalog key, or a name that is never translated). */
  title: string;
  /** The labels inside the box (catalog keys). */
  terms: string[];
  /** Settings: the group it lives in (shown in the result), and that group's anchor to land on. */
  where?: string;
  group?: string;
}

export interface SettingsSearchHit {
  entry: SettingsSearchEntry;
  label?: string;
  id: string;
}

export type MatchResult =
  | { kind: "box" }
  | { kind: "label"; label: string };

/**
 * Normalizes a string for searching: case-insensitive, diacritic/accent-insensitive,
 * trimmed of leading/trailing whitespace.
 */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * The words of a query, normalized.
 */
export function words(query: string): string[] {
  return query
    .split(/\s+/)
    .map(normalize)
    .filter((w) => w.length > 0);
}

/**
 * Matches a list of query words against a box's title, page and inner labels.
 * Returns null when the box doesn't have every word.
 */
export function match(
  wordList: string[],
  title: string,
  page: string,
  labels: string[]
): MatchResult | null {
  if (wordList.length === 0) return null;
  const head = normalize(title + " " + page);
  const texts = labels.map(normalize);
  const all = [head, ...texts].join(" ");
  if (!wordList.every((w) => all.includes(w))) return null;
  if (wordList.every((w) => head.includes(w))) return { kind: "box" };

  // The label with the most of the words, the first one when tied.
  let bestIndex = -1;
  let bestCount = 0;
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    const count = wordList.filter((w) => text.includes(w)).length;
    if (count > 0 && count > bestCount) {
      bestIndex = i;
      bestCount = count;
    }
  }

  if (bestIndex < 0) return { kind: "box" };
  return { kind: "label", label: labels[bestIndex] };
}

/**
 * Every setting and page as the window shows them today (#84): their real names, the place they
 * live (`where`, a group of Settings or a tab) and, for Settings, the group anchor to land on when
 * the row itself isn't found. Results land on the row named by the hit (shell.ts landOn).
 */
export const SETTINGS_ENTRIES: SettingsSearchEntry[] = [
  // Settings › General
  { id: "s.startup", page: "prefs", where: "General", group: "group-general", title: "Launch at startup", terms: [] },
  { id: "s.recap", page: "prefs", where: "General", group: "group-general", title: "Weekly recap", terms: ["Keep a history of my coding sessions", "Clear history"] },
  { id: "s.updates", page: "prefs", where: "General", group: "group-general", title: "Updates", terms: ["Check now"] },
  { id: "s.language", page: "prefs", where: "General", group: "group-general", title: "Language", terms: [] },
  // Settings › Notch
  { id: "s.tabs", page: "prefs", where: "Island", group: "group-island", title: "Tabs in the island", terms: ["Focus", "Calendar", "Clipboard", "Reminders", "Overview", "Drop"] },
  { id: "s.pills", page: "prefs", where: "Island", group: "group-island", title: "Active pills", terms: ["Main tool"] },
  { id: "s.hover", page: "prefs", where: "Island", group: "group-island", title: "Open on hover", terms: [] },
  { id: "s.alerts", page: "prefs", where: "Island", group: "group-island", title: "Open for every pill’s alerts", terms: [] },
  { id: "s.clock", page: "prefs", where: "Island", group: "group-island", title: "Show clock in the island", terms: [] },
  { id: "s.closed", page: "prefs", where: "Island", group: "group-island", title: "Closed island shows", terms: [] },
  { id: "s.autoclose", page: "prefs", where: "Island", group: "group-island", title: "Auto-close", terms: ["Close after"] },
  { id: "s.screen", page: "prefs", where: "Island", group: "group-island", title: "Island lives on", terms: ["Screen", "Display", "Monitor"] },
  { id: "s.voicekeys", page: "prefs", group: "group-shortcuts", title: "Shortcuts", terms: ["Talk", "Ask", "Show more", "Dictate"] },
  // Settings › Shortcuts, Sound
  { id: "s.shortcuts", page: "prefs", where: "Shortcuts", group: "group-shortcuts", title: "Shortcuts", terms: ["Open or close the island", "Open the chat", "Put JARVIS to sleep or wake him", "Next pill", "Previous pill", "Open the terminal", "Keyboard"] },
  { id: "s.sound", page: "prefs", where: "Sound", group: "group-sound", title: "Sound", terms: ["Open sounds folder", "Reload sounds"] },
  { id: "s.volume", page: "prefs", where: "Sound", group: "group-sound", title: "Volume", terms: [] },
  // Settings › Voice, Dictation (drawn in place from their own pages)
  { id: "s.voice", page: "prefs", where: "Voice", group: "group-voice", title: "Voice", terms: ["Hey JARVIS", "Wake word", "Answer only my voice", "Microphone", "Your voice level", "Ask", "Talk"] },
  { id: "s.dictation", page: "prefs", where: "Dictation", group: "group-dictation", title: "Dictation", terms: ["Dictation language", "Voice model", "Parakeet", "Hands-free with one press", "Keep the history", "Notetaker"] },
  // Settings › Agents, phone, accounts, privacy, about
  { id: "s.claude", page: "prefs", where: "Agents", group: "group-agents", title: "Claude Code", terms: ["Hooks"] },
  { id: "s.agents", page: "prefs", where: "Agents", group: "group-agents", title: "Other agents", terms: ["Codex", "Cursor", "Gemini CLI", "Copilot CLI", "OpenCode", "Amp", "Hermes", "Antigravity"] },
  { id: "s.plan", page: "prefs", where: "Agents", group: "group-agents", title: "Plan usage", terms: [] },
  { id: "s.phone", page: "prefs", where: "Android phone", group: "group-phone", title: "Your phone", terms: ["Android phone", "Pairing", "Approvals"] },
  { id: "s.apikey", page: "prefs", where: "Accounts and keys", group: "group-accounts", title: "API key", terms: ["Claude", "Anthropic", "Key"] },
  { id: "s.subs", page: "prefs", where: "Accounts and keys", group: "group-accounts", title: "Your AI subscriptions", terms: [] },
  { id: "s.providers", page: "prefs", where: "Accounts and keys", group: "group-accounts", title: "Chat providers", terms: ["OpenAI", "Google AI", "DeepSeek", "Gemini"] },
  { id: "s.local", page: "prefs", where: "Accounts and keys", group: "group-accounts", title: "Local models", terms: ["Ollama", "LM Studio"] },
  { id: "s.privacy", page: "prefs", where: "Privacy", group: "group-privacy", title: "Privacy", terms: ["Telemetry"] },
  { id: "s.version", page: "prefs", where: "About", group: "group-about", title: "Version", terms: ["About"] },
  // Connections
  { id: "c.all", page: "integrations", title: "Connections", terms: ["Stripe", "GitHub", "GitLab", "Gitea", "Vercel", "n8n", "Notion", "Resend", "Cal.com", "WhatsApp", "Spotify", "Token"] },
  // Mail
  { id: "m.month", page: "mail", title: "Mail", terms: ["Waiting on you", "Files today", "When mail arrives"] },
  { id: "m.sort", page: "mailOverview", title: "Sort new messages automatically", terms: ["Journal", "Sent by Coucou", "VIP", "Banned words", "Rules"] },
  // Notes
  { id: "n.notetaker", page: "notes", title: "Notetaker", terms: ["Record", "Transcript"] },
  { id: "n.dictation", page: "dictation", title: "Dictation", terms: ["Dictionary", "Snippets", "Styles", "History", "Replacements", "Clean up with Claude"] },
];

/**
 * Searches the settings index given a query string and page title resolver.
 */
export function searchSettings(
  query: string,
  getPageTitle: (page: PageId) => string,
  entries: SettingsSearchEntry[] = SETTINGS_ENTRIES
): SettingsSearchHit[] {
  const qWords = words(query);
  if (qWords.length === 0) return [];
  const boxes: SettingsSearchHit[] = [];
  const labels: SettingsSearchHit[] = [];

  for (const entry of entries) {
    const titleText = t(entry.title);
    const pageText = getPageTitle(entry.page);
    const labelTexts = entry.terms.map((k) => t(k));
    const res = match(qWords, titleText, pageText, labelTexts);
    if (!res) continue;
    if (res.kind === "box") {
      boxes.push({ entry, id: entry.id });
    } else {
      labels.push({ entry, label: res.label, id: `${entry.id}|${res.label}` });
    }
  }

  return [...boxes, ...labels].slice(0, 30);
}
