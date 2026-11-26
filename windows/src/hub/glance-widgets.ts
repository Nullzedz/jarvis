// JARVIS: Home's last five widgets (steps 5–9 of #57), one to one with the demo's bento
// (prototypes/jarvis-home.html): Notetaker (the next call), Mail (this month by day, today by
// hour), Dictation (today's words, this week's bars), His windows (how many he drew today, the
// last ones) and Connections (the service tiles, how many are live). Each draws from what the
// app already has; with nothing yet it says so plainly.

import { h, clear } from "../views/dom";
import { t, language } from "../i18n/i18n";
import { Bridge, emitToWindow, onEvent, type HisWindows, type MailMonth } from "../core/bridge";
import { FlowBridge, type FlowStats } from "../core/flow";
import { eventsBetween } from "../core/ics";
import { nextUp } from "../core/nextup";
import { myEvents } from "../views/gcal";
import { AGENTS_WANTED, CONNECTIONS_SNAPSHOT, rankConnections, type ConnectionRow } from "../core/agents";

/** The demo's .wbig: the number, and its unit small beside it (lower case where `lower`). */
const big = (value: string, unit: string, lower = false) =>
  h("p", { class: "jv-wbig" }, document.createTextNode(value), h("small", { class: lower ? "lc" : "", text: unit }));
const fmt = (n: number) => n.toLocaleString(language());
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** Monday-first weekday letters (the demo's M T W T F S S), in the app's language. */
function weekdayLetters(): string[] {
  const monday = new Date(2024, 0, 1); // a Monday
  return Array.from({ length: 7 }, (_, i) => new Date(monday.getTime() + i * 86_400_000)
    .toLocaleDateString(language(), { weekday: "narrow" }));
}

// ── 5. Notetaker: the next call ──────────────────────────────────────────────

export function notetakerWidget(body: HTMLElement): () => void {
  const box = h("div", { class: "jv-nt" });
  body.append(box);
  const draw = (title: string | null, at: Date | null) => {
    clear(box);
    box.append(
      h("p", { class: "cap" }, h("span", { class: "dot" }), h("span", { text: t("Next call") })),
      h("p", { class: "jv-wbig", text: at ? at.toLocaleTimeString(language(), { hour: "2-digit", minute: "2-digit" }) : "—" }),
      h("p", { class: "what", text: title ?? t("Nothing on your calendar today.") }));
  };
  const load = async () => {
    const now = new Date();
    let google: ReturnType<typeof eventsBetween> = [];
    try {
      if (await Bridge.gcalConnected()) google = eventsBetween(await Bridge.gcalFetch(), now, new Date(now.getTime() + 86_400_000));
    } catch { /* no calendar: your own events only */ }
    const next = nextUp(google, myEvents(), now);
    const sameDay = next && next.at.toDateString() === now.toDateString();
    draw(sameDay ? next.title : null, sameDay ? next.at : null);
  };
  draw(null, null);
  void load();
  const tick = window.setInterval(() => void load(), 5 * 60_000);
  return () => window.clearInterval(tick);
}

// ── 6. Mail: this month by day, today by hour ────────────────────────────────

export function renderMail(box: HTMLElement, m: MailMonth | null, now = new Date()) {
  clear(box);
  const year = now.getFullYear(), month = now.getMonth(), today = now.getDate();
  const days = new Date(year, month + 1, 0).getDate();
  const counts = Array.from({ length: days }, (_, i) => Number(m?.days?.[String(i + 1)] ?? 0));
  const top = Math.max(1, ...counts);
  const cal = h("div", { class: "jv-mcal" });
  for (const l of weekdayLetters()) cal.append(h("i", { class: "wd", text: l }));
  const lead = (new Date(year, month, 1).getDay() + 6) % 7; // Monday first
  for (let i = 0; i < lead; i++) cal.append(h("i"));
  counts.forEach((v, i) => {
    const d = i + 1;
    const cell = h("i", { text: String(d) });
    const bg = d === today ? "#ff453a" : v ? `rgba(10,132,255,${(0.18 + 0.7 * v / top).toFixed(2)})` : "#2c2c2e";
    cell.style.background = bg;
    cell.style.color = d === today || (v && v / top > 0.5) ? "#fff" : "#8e8e93";
    if (d > today) cell.style.opacity = ".45";
    cal.append(cell);
  });
  const hours = m?.hours ?? [];
  const arr = h("div", { class: "jv-arr" });
  for (let i = 0; i < 24; i++) {
    const v = Number(hours[i] ?? 0);
    const bar = h("i");
    bar.style.height = `${v ? Math.min(34, 6 + v * 4.5) : 3}px`;
    bar.style.background = i > now.getHours() ? "#3a3a3c" : v ? "#0a84ff" : "#2c2c2e";
    arr.append(bar);
  }
  const sub = h("p", { class: "jv-wsub" });
  if (!m) sub.textContent = t("Open Outlook, or connect Gmail in Connections, to see your mail here.");
  else {
    if (m.flagged) sub.append(h("span", { style: "color:#30d158", text: t("{n} waiting on you", { n: m.flagged }) }), document.createTextNode(" · "));
    sub.append(document.createTextNode(t("{n} files", { n: m.files })));
  }
  box.append(cal, h("div", { class: "x" }, big(m ? fmt(counts[today - 1] ?? 0) : "—", t("Today"), true), sub, arr));
}

export function mailWidget(body: HTMLElement): () => void {
  const box = h("div", { class: "jv-mail" });
  body.append(box);
  // The header says the month, as the demo's "Mail · November".
  const name = body.closest(".jv-w")?.querySelector(".jv-wh > span:nth-child(2)");
  if (name) name.textContent = `Mail · ${new Date().toLocaleDateString(language(), { month: "long" })}`;
  renderMail(box, null);
  const load = () => void Bridge.mailMonth().then((m) => renderMail(box, m ?? null)).catch(() => {});
  load();
  const tick = window.setInterval(load, 5 * 60_000);
  return () => window.clearInterval(tick);
}

// ── 7. Dictation: today's words, this week's bars ────────────────────────────

export function renderDictation(box: HTMLElement, s: FlowStats | null, now = new Date()) {
  clear(box);
  const daily = new Map(s?.daily ?? []);
  const words = daily.get(dayKey(now)) ?? 0;
  const week = s?.week;
  const saved = week && week.words > 0 ? Math.round((week.minutesSaved * words) / week.words) : 0;
  // This week, Monday to Sunday.
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const wk = Array.from({ length: 7 }, (_, i) => daily.get(dayKey(new Date(monday.getTime() + i * 86_400_000))) ?? 0);
  const todayIdx = (now.getDay() + 6) % 7;
  const max = Math.max(1, ...wk);
  const past = wk.slice(0, todayIdx + 1);
  const avg = past.reduce((a, b) => a + b, 0) / past.length;
  const chart = h("div", { class: "jv-dbars" });
  const letters = weekdayLetters();
  wk.forEach((v, i) => {
    const bar = h("i");
    bar.style.height = `${Math.round((v / max) * 70)}px`;
    bar.style.background = i === todayIdx ? "#ff9f0a" : "rgba(255,159,10,.35)";
    chart.append(h("div", { class: "col" }, bar, h("span", { class: "cap", text: letters[i] })));
  });
  if (avg > 0) {
    const line = h("span", { class: "avg" });
    line.style.bottom = `${Math.round((avg / max) * 70) + 20}px`;
    chart.append(line);
  }
  box.append(
    h("div", { class: "x" }, big(fmt(words), t("words today")),
      h("p", { class: "jv-wsub", text: t("{n} minutes saved", { n: saved }) })),
    chart);
}

export function dictationWidget(body: HTMLElement): () => void {
  const box = h("div", { class: "jv-dict" });
  body.append(box);
  renderDictation(box, null);
  const load = () => void FlowBridge.stats().then((s) => renderDictation(box, s ?? null)).catch(() => {});
  load();
  const tick = window.setInterval(load, 60_000);
  return () => window.clearInterval(tick);
}

// ── 8. His windows: how many today, the last ones ────────────────────────────

/** The form's name as he says it ("relationships", "table"…). */
const formName = (form: string) => form.replace(/[-_]/g, " ");

export function renderWindows(box: HTMLElement, w: HisWindows | null, now = new Date()) {
  clear(box);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const today = (w?.times ?? []).filter((at) => at >= start.getTime()).length;
  const last = w?.last ?? [];
  const thumbs = h("div", { class: "jv-thumbs" });
  for (let i = 0; i < 3; i++) {
    const d = last[i];
    const cell = h("div", { class: "th", title: d?.question ?? "" });
    if (d?.svg) {
      // As an image: whatever the drawing holds, nothing in it can run.
      const img = h("img", { alt: "" }) as HTMLImageElement;
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(d.svg)}`;
      cell.append(img);
    } else if (d) {
      cell.append(h("span", { class: "form", text: formName(d.form) }));
    }
    thumbs.append(cell);
  }
  box.append(
    h("div", { class: "x" }, big(String(today), t("drawn")),
      h("p", { class: "jv-wsub", text: last[0] ? t("Last: {form}", { form: formName(last[0].form) }) : t("None yet today") })),
    thumbs);
}

export function windowsWidget(body: HTMLElement): () => void {
  const box = h("div", { class: "jv-wins" });
  body.append(box);
  renderWindows(box, null);
  void Bridge.hisWindows().then((w) => renderWindows(box, w ?? null)).catch(() => {});
  const off = onEvent<HisWindows>("his-windows", (w) => renderWindows(box, w));
  return () => { void off.then((f) => f()); };
}

// ── 9. Connections: the service tiles, how many are live ─────────────────────

export function renderConnections(box: HTMLElement, rows: readonly ConnectionRow[]) {
  clear(box);
  const ranked = rankConnections(rows);
  const live = ranked.filter((r) => r.live).length;
  const tiles = h("div", { class: "jv-hometiles" });
  // With nothing set up, a sentence that says where to go, not "0 of 0 live" (#84).
  if (!ranked.length) {
    box.append(h("p", { class: "jv-wsub", text: t("No connections yet. Connect GitHub, Stripe, Spotify and more in Connections.") }));
    return;
  }
  for (const r of ranked.slice(0, 4)) {
    // One line each, with an ellipsis: a long name no longer pushes its status out of the tile (#84).
    tiles.append(h("div", { class: `jv-hometile${r.live ? "" : " off"}`, title: r.name },
      h("span", { class: "dot", style: `background:${r.live ? r.color : "#636366"}` }),
      h("span", { class: "tx" }, h("span", { class: "nm", text: r.name }),
        h("b", { class: r.live ? "" : "warn", text: r.live ? r.headline ?? t("On") : t("Off") }))));
  }
  box.append(tiles, h("div", { class: "n" }, big(String(live), t("of {n} live", { n: ranked.length }))));
}

export function connectionsWidget(body: HTMLElement): () => void {
  const box = h("div", { class: "jv-conn" });
  body.append(box);
  renderConnections(box, []);
  const off = onEvent<ConnectionRow[]>(CONNECTIONS_SNAPSHOT, (r) => renderConnections(box, Array.isArray(r) ? r : []));
  // Listening now: ask the island for its rows.
  void off.then(() => emitToWindow("island", AGENTS_WANTED));
  return () => { void off.then((f) => f()); };
}
