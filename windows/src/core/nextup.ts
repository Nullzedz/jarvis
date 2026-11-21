// JARVIS: what the Overview's Today tile shows (src/views/widgets.ts). Pure, tested in
// tests/widgets.test.mjs.

import type { CalEvent } from "./ics";
import type { MyEvent } from "../views/gcal";
import { language, t } from "../i18n/i18n";

export interface NextUp { title: string; at: Date }

/** The next thing on your calendar that hasn't started yet: Google's or yours, all-day ones left out. */
export function nextUp(google: readonly CalEvent[], mine: readonly MyEvent[], now: Date): NextUp | null {
  const all: NextUp[] = google.filter((e) => !e.allDay).map((e) => ({ title: e.title, at: e.start }));
  for (const m of mine) {
    if (!m.time) continue;
    const [hh, mm] = m.time.split(":").map(Number);
    const at = new Date(m.start);
    at.setHours(hh, mm, 0, 0);
    all.push({ title: m.title, at });
  }
  return all.filter((e) => e.at.getTime() >= now.getTime()).sort((a, b) => a.at.getTime() - b.at.getTime())[0] ?? null;
}

/** "in 40 min", "in 2 h", or the day when it isn't today. */
export function untilText(at: Date, now: Date): string {
  const min = Math.round((at.getTime() - now.getTime()) / 60_000);
  const sameDay = at.toDateString() === now.toDateString();
  if (min < 60) return t("in {n} min", { n: Math.max(min, 0) });
  if (sameDay) return t("in {n} h", { n: Math.round(min / 60) });
  return at.toLocaleDateString(language(), { weekday: "short" });
}

