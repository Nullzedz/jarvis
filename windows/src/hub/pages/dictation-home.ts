// JARVIS: Notes · Dictation (#72), one to one with the demo's (prototypes/jarvis-home.html #notes):
// your key and the voice model's state at the top; this week's words, the change from last week
// and the time saved, with Day / Week / Month bars (today lit, the average dashed); where you
// dictate; At a glance (today, your streak, the style in use); your words; then Dictionary,
// Snippets and Styles, each opening its own page (‹ Dictation), and your dictation history.

import { h, clear } from "../../views/dom";
import { t, language } from "../../i18n/i18n";
import { FlowBridge, flowKeyId, type FlowEntry, type FlowStats, type Style } from "../../core/flow";
import { keyLabel } from "../ui";
import type { HubContext } from "../shell";
import { styleOptions } from "./styles";
import { wallPage, type WallKind } from "./walls";
import { dictationPage } from "./dictation";
import { whenShown } from "../fit";

const NS = "http://www.w3.org/2000/svg";
const DAY = 86_400_000;
type Range = "day" | "week" | "month";

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmt = (n: number) => Math.round(n).toLocaleString(language());
function saved(min: number): string {
  const m = Math.round(min);
  return m >= 60 ? t("{0} h {1}", { 0: Math.floor(m / 60), 1: String(m % 60).padStart(2, "0") }) : t("{0} min", { 0: m });
}
function monday(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

/** The bars for a range: values, labels, and which one is now. */
export function chartData(range: Range, stats: FlowStats | null, history: readonly FlowEntry[], now = new Date()): { v: number[]; labels: string[]; now: number } {
  const daily = new Map(stats?.daily ?? []);
  if (range === "day") {
    // Today, two hours a bar from 9:00 to 23:00.
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const v = Array(7).fill(0) as number[];
    for (const e of history) {
      if (e.date < start.getTime() || e.date >= start.getTime() + DAY) continue;
      const hr = new Date(e.date).getHours();
      const i = Math.min(6, Math.max(0, Math.floor((hr - 9) / 2)));
      v[i] += e.words;
    }
    return { v, labels: ["9", "11", "13", "15", "17", "19", "21"], now: Math.min(6, Math.max(0, Math.floor((now.getHours() - 9) / 2))) };
  }
  if (range === "week") {
    const m = monday(now);
    const v = Array.from({ length: 7 }, (_, i) => daily.get(dayKey(new Date(m.getTime() + i * DAY))) ?? 0);
    const labels = Array.from({ length: 7 }, (_, i) => new Date(m.getTime() + i * DAY).toLocaleDateString(language(), { weekday: "short" }));
    return { v, labels, now: (now.getDay() + 6) % 7 };
  }
  // The last seven weeks, this one last.
  const m = monday(now);
  const v = Array.from({ length: 7 }, (_, i) => {
    const from = m.getTime() - (6 - i) * 7 * DAY;
    let sum = 0;
    for (let d = 0; d < 7; d++) sum += daily.get(dayKey(new Date(from + d * DAY))) ?? 0;
    return sum;
  });
  const labels = Array.from({ length: 7 }, (_, i) => new Date(m.getTime() - (6 - i) * 7 * DAY).toLocaleDateString(language(), { day: "numeric", month: "short" }));
  return { v, labels, now: 6 };
}

function chart(svg: SVGSVGElement, d: { v: number[]; labels: string[]; now: number }) {
  while (svg.firstChild) svg.firstChild.remove();
  const el = (tag: string, a: Record<string, string | number>, text?: string) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(a)) n.setAttribute(k, String(v));
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const max = Math.max(1, ...d.v);
  const past = d.v.slice(0, d.now + 1);
  const avg = past.reduce((a, b) => a + b, 0) / Math.max(1, past.length);
  svg.append(el("line", { x1: 0, y1: 30, x2: 900, y2: 30, stroke: "#1c1c1e" }), el("line", { x1: 0, y1: 130, x2: 900, y2: 130, stroke: "#1c1c1e" }), el("line", { x1: 0, y1: 230, x2: 900, y2: 230, stroke: "#2c2c2e" }));
  if (avg > 0) {
    const y = 230 - (avg / max) * 200;
    svg.append(el("line", { x1: 0, y1: y.toFixed(1), x2: 800, y2: y.toFixed(1), stroke: "#30d158", "stroke-dasharray": "5 5" }),
      el("text", { x: 808, y: (y + 4).toFixed(1), fill: "#30d158", "font-size": 13 }, t("avg")));
  }
  d.v.forEach((w, i) => {
    const hgt = w > 0 ? Math.max(6, (w / max) * 200) : 0;
    const r = el("rect", { x: 26 + i * 114, y: 230 - hgt, width: 80, height: hgt, rx: 10, fill: i > d.now ? "#3a3a3c" : "#ff9f0a" });
    r.append(el("animate", { attributeName: "height", from: 0, to: hgt, dur: ".45s", fill: "freeze" }), el("animate", { attributeName: "y", from: 230, to: 230 - hgt, dur: ".45s", fill: "freeze" }));
    const tip = el("title", {}, `${d.labels[i]} · ${fmt(w)}`);
    r.append(tip);
    svg.append(r);
  });
  d.labels.forEach((l, i) => svg.append(el("text", { x: 66 + i * 114, y: 250, fill: i === d.now ? "#f5f5f7" : "#8e8e93", "font-size": 13, "text-anchor": "middle" }, l)));
}

const APP_COLORS = ["#0a84ff", "#30d158", "#bf5af2", "#8e8e93", "#ff9f0a", "#64d2ff", "#ff375f", "#5e5ce6"];

export async function dictationHomePage(page: HTMLElement, ctx: HubContext) {
  const status = ctx.status;
  const [stats, history, words, snippets, styles] = await Promise.all([
    FlowBridge.stats().catch(() => null), FlowBridge.history().catch(() => null), FlowBridge.words().catch(() => null),
    FlowBridge.snippets().catch(() => null), FlowBridge.styles().catch(() => null),
  ]);
  const entries = history ?? [];
  const main = h("div", { class: "jv-dict-main" });
  const full = h("div", { class: "jv-dict-full" });

  // ── Top: your key, the voice model ──
  const key = keyLabel(status.keys === "wayland" ? "wayland" : flowKeyId(status.prefs), status.platform);
  const ready = status.models.parakeet.state === "ready";
  const right = h("span", { class: "jv-dright" },
    h("span", { class: "cap", text: t("Hold") }), h("span", { class: "jv-kc", text: key }),
    h("span", { class: "jv-chip" }, h("span", { class: "dot", style: `background:${ready ? "#30d158" : "#ff9f0a"}` }),
      h("span", { text: ready ? t("Parakeet ready") : t("Voice model not downloaded") })));

  // ── This week, and the bars ──
  const now = new Date();
  const thisWeek = chartData("week", stats, entries, now).v.reduce((a, b) => a + b, 0);
  const lastWeekStart = monday(now).getTime() - 7 * DAY;
  const daily = new Map(stats?.daily ?? []);
  let lastWeek = 0;
  for (let i = 0; i < 7; i++) lastWeek += daily.get(dayKey(new Date(lastWeekStart + i * DAY))) ?? 0;
  const change = lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : null;
  const headCap = h("p", { class: "cap", text: t("This week") });
  const headNum = h("p", { class: "jv-dbig" }, document.createTextNode(`${fmt(thisWeek)} `), h("span", { text: t("words dictated") }));
  const headSub = h("p", { class: "cap" },
    ...(change != null ? [h("span", { style: `color:${change >= 0 ? "#30d158" : "#ff453a"}`, text: `${change >= 0 ? "▲" : "▼"} ${Math.abs(change)}%` }), document.createTextNode(` ${t("from last week")} · `)] : []),
    document.createTextNode(t("{time} saved", { time: saved(stats?.week.minutesSaved ?? 0) })));
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 900 260");
  svg.setAttribute("class", "jv-dchart");
  let range: Range = "week";
  const ranges = h("span", { class: "jv-tabs2" });
  for (const [r, label] of [["day", t("Day")], ["week", t("Week")], ["month", t("Month")]] as [Range, string][]) {
    ranges.append(h("button", { class: r === range ? "on" : "", text: label, onclick: (e: Event) => {
      range = r;
      for (const b of ranges.children) b.classList.toggle("on", b === e.currentTarget);
      const d = chartData(range, stats, entries);
      chart(svg, d);
      const total = d.v.reduce((a, b) => a + b, 0);
      headCap.textContent = r === "day" ? t("Today") : r === "week" ? t("This week") : t("Last 7 weeks");
      headNum.firstChild!.textContent = `${fmt(r === "week" ? thisWeek : total)} `;
    } }));
  }
  chart(svg, chartData(range, stats, entries));

  // ── Where you dictate ──
  const apps = Object.entries(stats?.apps ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const top = Math.max(1, ...apps.map(([, n]) => n));
  const where = h("div", { class: "jv-where" }, ...apps.map(([name, n], i) => h("div", { class: "r" },
    h("span", { class: "sq", style: `background:${APP_COLORS[i % APP_COLORS.length]}` }), h("span", { class: "nm", text: name }),
    h("div", { class: "bar" }, h("i", { style: `width:${Math.round((n / top) * 100)}%` })), h("span", { class: "cap n", text: fmt(n) }))));

  // ── At a glance ──
  const today = daily.get(dayKey(now)) ?? 0;
  const week = stats?.week;
  const todaySaved = week && week.words > 0 ? (week.minutesSaved * today) / week.words : 0;
  const streak = stats?.streak ?? 0;
  const ring = document.createElementNS(NS, "svg");
  ring.setAttribute("viewBox", "0 0 70 70");
  ring.setAttribute("width", "80");
  ring.setAttribute("height", "80");
  const c = 2 * Math.PI * 28;
  ring.innerHTML = `<circle cx="35" cy="35" r="28" fill="none" stroke="#3a2606" stroke-width="10"/><circle cx="35" cy="35" r="28" fill="none" stroke="#ff9f0a" stroke-width="10" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - Math.min(7, streak) / 7)).toFixed(1)}" transform="rotate(-90 35 35)"/>`;
  const styleSeg = h("span", { class: "jv-tabs2 wrap" });
  for (const [id, name] of styleOptions()) {
    styleSeg.append(h("button", { class: status.prefs.defaultStyle === id ? "on" : "", text: name, onclick: (e: Event) => {
      for (const b of styleSeg.children) b.classList.toggle("on", b === e.currentTarget);
      void ctx.setPrefs((p) => (p.defaultStyle = id as Style));
    } }));
  }
  // Styles only apply with Claude's clean-up on: its switch is right here, and says so (#84).
  const cleanSw = h("span", { class: `jv-switch${status.prefs.cleanup ? " on" : ""}` }, h("i"));
  const cleanNote = h("p", { class: "cap", text: t("Styles apply with Claude clean-up on.") });
  cleanNote.style.display = status.prefs.cleanup ? "none" : "";
  const cleanBtn = h("button", { class: "jv-sswitch", role: "switch", "aria-checked": String(status.prefs.cleanup), "aria-label": t("Clean up with Claude") }, cleanSw);
  cleanBtn.addEventListener("click", () => {
    const on = !cleanSw.classList.contains("on");
    cleanSw.classList.toggle("on", on);
    cleanBtn.setAttribute("aria-checked", String(on));
    cleanNote.style.display = on ? "none" : "";
    void ctx.setPrefs((pp) => (pp.cleanup = on));
  });
  const glance = h("div", { class: "jv-dglance" },
    h("div", { class: "jv-dtile" }, h("p", { class: "cap", text: t("Today") }), h("p", { class: "big", text: fmt(today) }),
      h("p", { class: "cap", text: `${t("words dictated")} · ${t("{time} saved", { time: saved(todaySaved) })}` })),
    h("div", { class: "jv-dtile row" }, ring, h("div", {}, h("p", { class: "cap", text: t("Streak") }),
      h("p", { class: "mid", text: t("{n} days", { n: streak }) }))),
    h("div", { class: "jv-dtile" }, h("p", { class: "cap", text: t("Style in use") }), styleSeg,
      h("div", { class: "jv-dclean" }, h("span", { text: t("Clean up with Claude") }), cleanBtn), cleanNote));

  // ── Your words ──
  const list = words?.words ?? [];
  const cloudColors = ["#f5f5f7", "#8e8e93", "#0a84ff", "#8e8e93", "#f5f5f7", "#ff9f0a", "#e5e5ea", "#bf5af2", "#f5f5f7"];
  const sizes = [34, 17, 27, 16, 23, 30, 17, 22, 24];
  const cloud = h("div", { class: "jv-dtile cloud" },
    h("div", { class: "row between" }, h("p", { class: "cap", text: t("Your words") }), h("p", { class: "cap", text: t("{n} in your Dictionary", { n: list.length }) })),
    list.length
      ? h("div", { class: "words" }, ...list.slice(0, 12).map((w, i) => h("span", { text: w, style: `font-size:${sizes[i % sizes.length]}px;color:${cloudColors[i % cloudColors.length]};font-weight:${i % 3 === 0 ? 600 : i % 3 === 1 ? 400 : 500}` })))
      : h("p", { class: "cap empty", text: t("Add the names and words you use, and Parakeet spells them right.") }));

  // ── Dictionary, Snippets, Styles: each opens its own page ──
  let subLeave: (() => void) | undefined;
  const leaveSub = () => { subLeave?.(); subLeave = undefined; };
  ctx.onLeave = leaveSub;
  const open = (title: string, render: (box: HTMLElement, c: HubContext) => Promise<void> | void) => () => {
    leaveSub();
    clear(full);
    const box = h("div", { class: "jv-flowpart jv-sub-own" });
    const sub: HubContext = Object.create(ctx, { hero: { value: () => h("div") }, navigate: { value: (p: Parameters<HubContext["navigate"]>[0]) => ctx.navigate(p) } });
    full.append(h("button", { class: "back", text: `‹ ${t("Dictation")}`, onclick: () => { leaveSub(); full.style.display = "none"; main.style.display = ""; right.style.visibility = ""; } }),
      h("p", { class: "jv-ptitle", text: title }), box);
    // Its leave hook (a live listener on History) runs on Back and when the page is left (#84).
    void Promise.resolve(render(box, sub)).then(() => {
      if (Object.prototype.hasOwnProperty.call(sub, "onLeave")) subLeave = sub.onLeave;
    });
    main.style.display = "none";
    full.style.display = "";
    right.style.visibility = "hidden";
    (page.closest(".hub-scroll") as HTMLElement | null)?.scrollTo({ top: 0 });
  };
  // Dictionary, Snippets and Styles: the demo's word walls (#78).
  const wall = (kind: WallKind) => () => {
    clear(full);
    const box = h("div", { class: "jv-wallpg" });
    const back = () => { full.style.display = "none"; main.style.display = ""; right.style.visibility = ""; };
    full.append(box);
    void wallPage(box, ctx, kind, back);
    main.style.display = "none";
    full.style.display = "";
    right.style.visibility = "hidden";
    (page.closest(".hub-scroll") as HTMLElement | null)?.scrollTo({ top: 0 });
  };
  const col = (title: string, items: HTMLElement[], go: () => void) => {
    const b = h("button", { class: "jv-dcol", onclick: go }, h("p", { class: "row between hd" }, h("span", { text: title }), h("span", { class: "plus", text: "›" })),
      ...(items.length ? items : [h("p", { class: "none", text: t("None yet") })]));
    return b;
  };
  const defaultName = styleOptions().find(([id]) => id === status.prefs.defaultStyle)?.[1] ?? "";
  const cols = h("div", { class: "jv-dcols" },
    col(t("Dictionary"), list.slice(0, 4).map((w) => h("p", { class: "it", text: w })), wall("dictionary")),
    col(t("Snippets"), (snippets ?? []).slice(0, 3).map((s) => h("p", { class: "it" }, document.createTextNode(`“${s.trigger}” `), h("span", { class: "cap", text: `→ ${s.text.slice(0, 24)}${s.text.length > 24 ? "…" : ""}` }))), wall("snippets")),
    col(t("Styles"), [
      h("p", { class: "it use" }, document.createTextNode(`${defaultName} `), h("span", { class: "cap", text: t("in use") })),
      ...(styles ?? []).slice(0, 2).map((s) => h("p", { class: "it" }, document.createTextNode(`${styleOptions().find(([id]) => id === s.style)?.[1] ?? s.style} `), h("span", { class: "cap", text: s.name }))),
    ], wall("styles")));
  const historyRow = h("button", { class: "jv-dhist", onclick: open(t("History"), dictationPage) },
    h("span", { text: t("History") }), h("span", { class: "cap", text: t("{n} dictations", { n: entries.length }) }), h("span", { class: "go", text: "›" }));

  // Off, or no voice model: say so first, with the way to set it up (#84: it hid inside History).
  const setupCard = !status.prefs.enabled || !ready
    ? [h("div", { class: "jv-dsetup" },
        h("div", {}, h("b", { text: !status.prefs.enabled ? t("Dictation is off") : t("The voice model isn't downloaded") }),
          h("p", { class: "cap", text: t("Turn dictation on and download the voice model (about 600 MB) in Settings › Dictation.") })),
        h("button", { class: "jv-btn blue", text: t("Set up"), onclick: () => ctx.navigate("flowsettings") }))]
    : [];
  main.append(
    ...setupCard,
    h("div", { class: "row between end" }, h("div", {}, headCap, headNum, headSub), ranges),
    svg,
    ...(apps.length ? [h("p", { class: "jv-dcap", text: t("Where you dictate") }), where] : []),
    h("p", { class: "jv-dcap", text: t("At a glance") }), glance, cloud, cols, historyRow);
  full.style.display = "none";
  page.classList.add("jv-dictpage");
  page.append(right, main, full);
  whenShown(page, (sc) => {
    const head = sc.querySelector(".jv-sechead");
    if (head) { right.classList.add("inhead"); head.append(right); }
  });
}
