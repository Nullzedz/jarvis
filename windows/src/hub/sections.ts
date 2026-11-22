// The window's destinations (docs/jarvis/design/SPEC.md §4): the front page, six
// sections in the sidebar, then Settings at the bottom. A section's pages show as
// tabs at its top, so every page the window had stays one click away.

import { t } from "../i18n/i18n";
import type { PageId } from "./shell";

export interface Section {
  id: "home" | "jarvis" | "agents" | "notes" | "mail" | "connections" | "settings";
  name: () => string;
  /** The coloured square it gets when the sidebar opens. */
  color: string;
  pages: PageId[];
  /** Windows only (classic Outlook). */
  windowsOnly?: boolean;
}

export const SECTIONS: Section[] = [
  { id: "home", name: () => t("Home"), color: "#8e8e93", pages: ["home"] },
  { id: "jarvis", name: () => "JARVIS", color: "#bf5af2", pages: ["talk"] },
  { id: "agents", name: () => t("Agents"), color: "#30d158", pages: ["sessions"] },
  { id: "notes", name: () => t("Notes"), color: "#ff9f0a", pages: ["dictation", "notes"] },
  { id: "mail", name: () => "Mail", color: "#0a84ff", pages: ["mailOverview", "mailRules", "mailBanned", "mailVIP"], windowsOnly: true },
  { id: "connections", name: () => t("Connections"), color: "#64d2ff", pages: ["integrations"] },
  { id: "settings", name: () => t("Settings"), color: "#3a3a3c", pages: ["prefs"] },
];

export function sectionOf(page: PageId): Section {
  return SECTIONS.find((s) => s.pages.includes(page)) ?? SECTIONS[0];
}
