// JARVIS: Mail (#74), one to one with the live demo's (prototypes/jarvis-live.html #mail,
// design A), on classic Outlook's real mail: the month on the left (a bar for how much came,
// dots for VIP mail, mail waiting on you, mail with files and the busiest days); on the right
// the chosen day in four parts, when today's mail arrived, what waits on you and today's
// files. Each of the last three opens its full view (‹ Mail). Nothing is ever sent from here:
// Reply opens Outlook's own reply window.

import { h, clear } from "../../views/dom";
import { t, tn, language, weekdayShort } from "../../i18n/i18n";
import { MailBridge, senderName, type MailMessage, type TriageView } from "../../core/mail";
import { Bridge, type MailMonth } from "../../core/bridge";
import type { HubContext } from "../shell";
import { fillWindow } from "../fit";

export interface DayMessage extends MailMessage {
  files: string[];
  hour: number;
  vip: boolean;
}

const VIP = "#ff9f0a", WAIT = "#30d158", FILES = "#636366", BUSY = "#bf5af2", BLUE = "#0a84ff";

const pad = (n: number) => String(n).padStart(2, "0");
const dateKey = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const clock = (hr: number) => `${pad(hr)}:00`;

/** Four parts of a day, as the demo's rows: morning, midday, afternoon, evening. */
export const PARTS: { from: number; to: number; at: string; name: () => string }[] = [
  { from: 0, to: 12, at: "09:00", name: () => t("Morning") },
  { from: 12, to: 15, at: "12:00", name: () => t("Midday") },
  { from: 15, to: 18, at: "15:00", name: () => t("Afternoon") },
  { from: 18, to: 24, at: "18:00", name: () => t("Evening") },
];

/** The senders of a part of the day, most mail first: one pill each. */
export function senders(list: readonly DayMessage[]): { name: string; n: number; vip: boolean; wait: boolean }[] {
  const by = new Map<string, { name: string; n: number; vip: boolean; wait: boolean }>();
  for (const m of list) {
    const key = (m.address || m.senderName).toLowerCase();
    const s = by.get(key) ?? { name: senderName(m), n: 0, vip: false, wait: false };
    s.n++;
    s.vip ||= m.vip;
    s.wait ||= m.flagged;
    by.set(key, s);
  }
  return [...by.values()].sort((a, b) => Number(b.vip) - Number(a.vip) || b.n - a.n);
}

/** Today's mail per hour, split VIP / waiting on you / the rest (the full view's stacks). */
export function hourStacks(list: readonly DayMessage[]): [number, number, number][] {
  const out = Array.from({ length: 24 }, () => [0, 0, 0] as [number, number, number]);
  for (const m of list) {
    const hr = Math.min(23, Math.max(0, m.hour | 0));
    out[hr][m.vip ? 0 : m.flagged ? 1 : 2]++;
  }
  return out;
}

export type FileKind = "PDF" | "Images" | "Sheets" | "Other";
const EXT: Record<string, [string, FileKind, string]> = {
  pdf: ["PDF", "PDF", "#ff453a"],
  png: ["IMG", "Images", BLUE], jpg: ["IMG", "Images", BLUE], jpeg: ["IMG", "Images", BLUE], gif: ["IMG", "Images", BLUE], webp: ["IMG", "Images", BLUE], heic: ["IMG", "Images", BLUE],
  xls: ["XLS", "Sheets", "#30d158"], xlsx: ["XLS", "Sheets", "#30d158"], csv: ["CSV", "Sheets", "#30d158"], numbers: ["XLS", "Sheets", "#30d158"],
  zip: ["ZIP", "Other", "#bf5af2"], rar: ["ZIP", "Other", "#bf5af2"], "7z": ["ZIP", "Other", "#bf5af2"],
  doc: ["DOC", "Other", "#636366"], docx: ["DOC", "Other", "#636366"], ppt: ["PPT", "Other", "#ff9f0a"], pptx: ["PPT", "Other", "#ff9f0a"],
};
/** A file's badge, its filter and the badge's colour, from its name. */
export function fileKind(name: string): [string, FileKind, string] {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return EXT[ext] ?? [(ext.slice(0, 3) || "FILE").toUpperCase(), "Other", "#48484a"];
}

/** Today's files, newest first: one tile per attachment. */
export function todaysFiles(list: readonly DayMessage[]): { name: string; m: DayMessage }[] {
  return list.flatMap((m) => m.files.map((name) => ({ name, m })));
}

function time(ms: number): string {
  try { return new Date(ms).toLocaleTimeString(language(), { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); }
  catch { return new Date(ms).toLocaleTimeString(); }
}

function rb(text: string, bg: string, color: string, label: string, onclick?: () => void, size = 0): HTMLElement {
  const b = h(onclick ? "button" : "span", { class: "jv-mrb", "aria-label": label, title: label, text });
  b.style.background = bg;
  b.style.color = color;
  if (size) { b.style.width = `${size}px`; b.style.height = `${size}px`; }
  if (onclick) b.addEventListener("click", (e) => { e.stopPropagation(); onclick(); });
  return b;
}

function dot(color: string): HTMLElement {
  const d = h("span", { class: "jv-mdot" });
  d.style.background = color;
  return d;
}

export async function mailHomePage(page: HTMLElement, ctx: HubContext) {
  const now = new Date();
  const todayKey = dateKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
  let offset = 0;
  let month: MailMonth | null = null;
  let sel = todayKey;
  let today: DayMessage[] = [];
  let waiting: DayMessage[] = [];
  let triage: TriageView | null = null;

  const main = h("div", { class: "jv-mailpg" });
  const full = h("div", { class: "jv-mfull" });
  full.style.display = "none";
  // Done says so, with Undo (#84).
  const toast = h("div", { class: "jv-toast", role: "status" });
  let toastAt = 0;
  const note = (text: string, undo?: () => void) => {
    clear(toast);
    toast.append(h("span", { text }));
    if (undo) toast.append(h("button", { class: "jv-link", text: t("Undo"), onclick: () => { toast.classList.remove("on"); undo(); } }));
    toast.classList.add("on");
    window.clearTimeout(toastAt);
    toastAt = window.setTimeout(() => toast.classList.remove("on"), 6000);
  };
  page.append(main, full, toast);
  // The month fills the window exactly (#84: a fixed height left a scrollbar).
  ctx.onLeave = fillWindow(main, 460);
  const done = (m: DayMessage) => {
    void MailBridge.act(m, "unflag").then(() => {
      const at = waiting.indexOf(m);
      waiting = waiting.filter((x) => x !== m);
      redrawWaiting();
      note(t("Marked done: {0}", { 0: m.subject || senderName(m) }), () => {
        void MailBridge.act(m, "flag").then(() => { waiting.splice(Math.max(0, at), 0, m); redrawWaiting(); });
      });
    });
  };
  let redrawWaiting = () => drawWaiting();
  // #120: Gmail is only read (no « Done », which would change it), and opens in Gmail.
  const gmail = (m: DayMessage) => m.storeId === "gmail";
  const openIn = (m: DayMessage) => (gmail(m) ? t("Open in Gmail") : t("Open in Outlook"));

  const mon = h("div", { class: "jv-mon" });
  const dayBox = h("div", { class: "jv-mp" });
  const arrBox = h("button", { class: "jv-mp", "aria-label": t("When mail arrives") });
  const waitBox = h("button", { class: "jv-mp", "aria-label": t("Waiting on you") });
  const fileBox = h("button", { class: "jv-mp", "aria-label": t("Files today") });
  main.append(mon, h("div", { class: "jv-mright" }, dayBox, arrBox, h("div", { class: "jv-pair2" }, waitBox, fileBox)));

  // ── The month ──
  const drawMonth = () => {
    clear(mon);
    const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const y = first.getFullYear(), m = first.getMonth() + 1;
    const length = new Date(y, m, 0).getDate();
    const todayDay = offset === 0 ? now.getDate() : 0;
    const counts = Array.from({ length }, (_, i) => Number(month?.days?.[String(i + 1)] ?? 0));
    const top = Math.max(1, ...counts);
    // Busy is relative to your month: among its five biggest days and well above its usual day (#84).
    const some = counts.filter((n) => n > 0);
    const usual = some.length ? some.reduce((a, b) => a + b, 0) / some.length : 0;
    const fifth = [...counts].sort((a, b) => b - a)[Math.min(4, length - 1)] || Infinity;
    const busy = Math.max(fifth, Math.ceil(usual * 1.5), 3);
    const name = first.toLocaleDateString(language(), { month: "long" });
    mon.append(h("div", { class: "jv-mrow sb" },
      h("p", { class: "title" }, `${name.charAt(0).toUpperCase()}${name.slice(1)} `, h("span", { class: "yr", text: String(y) })),
      h("span", { class: "jv-mrow" },
        offset < 0 || sel !== todayKey ? h("button", { class: "jv-chipbtn", text: t("Today"), onclick: () => { offset = 0; sel = todayKey; void loadMonth(); void loadDay(); } }) : null,
        rb("‹", "var(--jv-s2)", "var(--jv-t1)", t("Previous month"), () => moveMonth(-1)),
        offset < 0 ? rb("›", "var(--jv-s2)", "var(--jv-t1)", t("Next month"), () => moveMonth(1)) : nextOff(),
      )));
    const wd = h("div", { class: "jv-mwd" });
    for (let i = 1; i <= 7; i++) wd.append(h("span", { text: weekdayShort(i % 7) }));
    mon.append(wd);
    const grid = h("div", { class: "jv-mgrid" });
    const lead = (first.getDay() + 6) % 7;
    const prevLen = new Date(y, m - 1, 0).getDate();
    for (let i = 0; i < lead; i++) grid.append(h("div", { class: "jv-md mute", text: String(prevLen - lead + 1 + i) }));
    for (let d = 1; d <= length; d++) {
      const n = counts[d - 1];
      const key = dateKey(y, m, d);
      const fut = offset === 0 && d > todayDay;
      // Days still to come are just numbers, not buttons that do nothing (#84).
      const cell = fut
        ? h("div", { class: "jv-md fut" }, h("span", { class: "n", text: String(d) }))
        : h("button", {
          class: `jv-md${d === todayDay ? " today" : ""}${key === sel ? " sel" : ""}`,
          "aria-label": `${d} ${name}, ${tn("{count} mail", "{count} mails", n)}`,
          "aria-pressed": String(key === sel),
          onclick: () => { sel = key; drawMonth(); void loadDay(); },
        }, h("span", { class: "n", text: String(d) }));
      const mk = month?.marks?.[String(d)];
      if (n) {
        const dd = h("div", { class: "dd" });
        if (mk?.vip) dd.append(h("i", { style: `background:${VIP}` }));
        if (mk?.flagged) dd.append(h("i", { style: `background:${WAIT}` }));
        if (mk?.files) dd.append(h("i", { style: `background:${FILES}` }));
        if (n >= busy && n > 2) dd.append(h("i", { style: `background:${BUSY}` }));
        cell.append(dd, h("div", { class: "vb" }, h("i", { style: `width:${Math.round((n / top) * 100)}%` })));
      }
      grid.append(cell);
    }
    mon.append(grid);
    const legend = h("div", { class: "jv-mrow cap jv-mlegend" });
    for (const [c, l] of [[VIP, t("VIP")], [WAIT, t("Waiting on you")], [FILES, t("Files")], [BUSY, t("Busy day")]] as const) {
      legend.append(h("span", {}, dot(c), ` ${l}`));
    }
    legend.append(h("span", { class: "end", text: t("bar = how much mail") }));
    mon.append(legend);
    if (!month) mon.append(h("p", { class: "cap jv-mnote", text: t("Open Outlook, or connect Gmail in Connections, to see your mail here.") }));
  };

  // ── The chosen day ──
  let dayList: DayMessage[] = [];
  const drawDay = () => {
    clear(dayBox);
    if (!sel) { dayBox.append(h("div", { class: "cap jv-mempty", text: t("Choose a day in the month.") })); return; }
    const [y, m, d] = sel.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const wd = date.toLocaleDateString(language(), { weekday: "long" });
    const label = `${wd.charAt(0).toUpperCase()}${wd.slice(1)} ${d}`;
    const need = dayList.filter((x) => x.flagged).length;
    const head = h("div", { class: "jv-mrow sb" }, h("b", { class: "big", text: label }));
    if (!dayList.length) {
      head.append(h("span", { class: "cap", text: t("No mail yet") }));
      dayBox.append(head, h("div", { class: "cap jv-mempty", text: t("Nothing has arrived for this day.") }));
      return;
    }
    head.append(h("span", { class: "cap", text: tn("{count} mail", "{count} mails", dayList.length) + (need ? ` · ${t("{0} need you", { 0: need })}` : "") }));
    dayBox.append(head);
    for (const part of PARTS) {
      const inPart = dayList.filter((x) => x.hour >= part.from && x.hour < part.to);
      const row = h("div", { class: "jv-mdrow" }, h("span", { class: "cap", text: part.at }));
      const body = h("div");
      if (!inPart.length) {
        body.append(h("p", { class: "quiet", text: t("Quiet") }));
      } else {
        body.append(h("p", { text: part.name() }));
        const cap = h("span", { class: "jv-capsule" });
        const list = senders(inPart);
        for (const s of list.slice(0, 3)) {
          const pill = h("span", { class: "jv-gpill" }, s.name, h("span", { class: "c", text: String(s.n) }));
          if (s.vip || s.wait) pill.style.background = s.vip ? VIP : WAIT;
          else pill.classList.add("grey");
          cap.append(pill);
        }
        if (list.length > 3) {
          const more = list.slice(3).reduce((a, s) => a + s.n, 0);
          cap.append(h("span", { class: "jv-gpill grey" }, t("Others"), h("span", { class: "c", text: String(more) })));
        }
        body.append(cap);
      }
      row.append(body);
      dayBox.append(row);
    }
  };

  // ── When mail arrives (small) ──
  const busiest = (hours: number[]) => hours.reduce((bi, v, i, a) => (v > a[bi] ? i : bi), 0);
  const drawArrivals = () => {
    clear(arrBox);
    const hours = hourStacks(today).map((x) => x[0] + x[1] + x[2]);
    const peak = busiest(hours);
    const any = hours.some((v) => v > 0);
    arrBox.append(h("div", { class: "jv-mrow sb w" },
      h("b", { text: t("When mail arrives") }),
      h("span", { class: "cap" }, any ? h("span", {}, `${t("busiest")} `, h("span", { class: "blue", text: clock(peak) })) : t("Nothing yet today"))));
    const strip = h("div", { class: "jv-mstrip" });
    const top = Math.max(1, ...hours);
    for (let i = 0; i < 24; i++) {
      const v = hours[i] ?? 0;
      const bar = h("i");
      bar.style.height = `${Math.max(6, (v / top) * 100)}%`;
      bar.style.background = any && i === peak ? BLUE : i > now.getHours() ? "#2c2c2e" : "#48484a";
      strip.append(bar);
    }
    arrBox.append(strip, h("div", { class: "jv-mrow sb w cap" }, ...["0", "6", "12", "18", "24"].map((x) => h("span", { text: x }))));
  };

  // ── Waiting on you (small) ──
  const drawWaiting = () => {
    clear(waitBox);
    waitBox.append(h("p", { class: "cap", text: `${t("Waiting on you")} · ${waiting.length}` }));
    if (!waiting.length) { waitBox.append(h("div", { class: "cap jv-mempty", text: t("Nothing waiting on you.") })); return; }
    waiting.slice(0, 2).forEach((m, i) => {
      const card = h("div", { class: `jv-mwcard${i ? " b" : ""}` },
        h("div", { class: "jv-mrow sb" }, h("b", { text: `${senderName(m)} · ${m.subject || t("(no subject)")}` }),
          h("span", { class: "cap", style: m.vip ? `color:${VIP}` : "", text: m.vip ? t("VIP") : "" })),
        h("div", { class: "jv-mrow acts" },
          rb("↩", BLUE, "#fff", t("Reply"), () => void MailBridge.open(m, true)),
          ...(gmail(m) ? [] : [rb("✓", "#30d158", "#000", t("Done"), () => done(m))]),
          rb("↗", "#3a3a3c", "#fff", openIn(m), () => void MailBridge.open(m, false))));
      waitBox.append(card);
    });
  };

  // ── Files today (small) ──
  const drawFilesSmall = () => {
    clear(fileBox);
    const files = todaysFiles(today);
    fileBox.append(h("p", { class: "cap", text: `${t("Files today")} · ${files.length}` }));
    if (!files.length) { fileBox.append(h("div", { class: "cap jv-mempty", text: t("No files today.") })); return; }
    const grid = h("div", { class: "jv-mftiles" });
    for (const f of files.slice(0, 6)) {
      const [badge, , color] = fileKind(f.name);
      grid.append(h("span", { class: "jv-ftile" }, h("b", { style: `background:${color}`, text: badge }), h("span", { class: "nm", text: f.name.replace(/\.[^.]+$/, "") })));
    }
    fileBox.append(grid);
  };

  // ── Full views ──
  let backTo = 0;
  const scroller = () => page.closest<HTMLElement>(".hub-scroll");
  const back = () => {
    full.style.display = "none"; main.style.display = "";
    redrawWaiting = () => drawWaiting();
    const sc = scroller(); if (sc) sc.scrollTop = backTo;
  };
  const openFull = (title: string, count: number | null, tabs: HTMLElement | null, ...body: HTMLElement[]) => {
    clear(full);
    const ttl = h("p", { class: "title", text: title });
    if (count != null) ttl.append(" ", h("span", { text: String(count) }));
    full.append(h("div", { class: "jv-mrow sb" },
      h("div", { class: "jv-mrow g16" }, h("button", { class: "back", text: `‹ ${t("Mail")}`, onclick: back }), ttl), tabs ?? h("span")), ...body);
    const sc = scroller();
    if (main.style.display !== "none") backTo = sc?.scrollTop ?? 0;
    main.style.display = "none";
    full.style.display = "";
    if (sc) sc.scrollTop = 0;
  };
  const tabs2 = (names: string[], on: number, pick: (i: number) => void) => {
    const box = h("span", { class: "jv-tabs2 wrap" });
    names.forEach((n, i) => box.append(h("button", { class: i === on ? "on" : "", text: n, onclick: () => pick(i) })));
    return box;
  };

  const showArrivals = () => {
    const stacks = hourStacks(today);
    const totals = stacks.map((s) => s[0] + s[1] + s[2]);
    const peak = busiest(totals);
    const top = Math.max(1, ...totals);
    const big = h("div", { class: "jv-mbig" });
    const hourTitle = h("p", { class: "cap mb8" });
    const hourList = h("div");
    const cols = ["#ff9f0a", "#30d158", "#48484a"];
    const pickHour = (hr: number) => {
      hourTitle.textContent = `${t("At {0}", { 0: clock(hr) })} · ${tn("{count} mail", "{count} mails", totals[hr])}`;
      clear(hourList);
      const list = today.filter((m) => m.hour === hr);
      if (!list.length) hourList.append(h("p", { class: "cap", text: t("Nothing arrived at this hour.") }));
      for (const m of list) {
        hourList.append(h("div", { class: "jv-mrow jv-mline" }, dot(m.vip ? VIP : m.flagged ? WAIT : "#8e8e93"),
          h("span", { class: "grow", text: `${senderName(m)} · ${m.subject || t("(no subject)")}` }), h("span", { class: "cap", text: time(m.date) })));
      }
      big.querySelectorAll("button").forEach((b, i) => b.classList.toggle("on", i === hr));
    };
    stacks.forEach((s, i) => {
      const col = h("button", { "aria-label": clock(i), onclick: () => pickHour(i) });
      s.forEach((v, k) => { if (v) col.append(h("i", { style: `height:${(v / top) * 92}%;background:${cols[k]}` })); });
      big.append(col);
    });
    const sum = today.length;
    const legend = h("div", { class: "jv-mrow cap g12" });
    for (const [c, l] of [[VIP, t("VIP")], [WAIT, t("Waiting on you")], ["#48484a", t("Other")]] as const) legend.append(h("span", {}, dot(c), ` ${l}`));
    const sorted = h("div", { class: "jv-mtile col" }, h("p", { class: "b", text: t("Sorted by JARVIS today") }));
    if (triage) {
      sorted.append(h("div", { class: "jv-mrow g16" },
        ...[[triage.today.sorted, t("sorted today"), BLUE], [triage.today.junk, t("sent to Junk"), "#8e939c"], [triage.today.important, t("marked important"), VIP]].map(([v, l, c]) =>
          h("div", {}, h("p", { class: "num", style: `color:${c}`, text: String(v) }), h("p", { class: "cap", text: String(l) })))));
      sorted.append(h("p", { class: "cap", text: triage.settings.autoSort ? t("New mail is sorted as it arrives.") : t("Automatic sorting is off.") }));
    }
    sorted.append(h("div", { class: "jv-mrow end" }, h("button", { class: "jv-chipbtn", text: `${t("Sorting")} ›`, onclick: () => ctx.navigate("mailOverview") })));
    openFull(t("When mail arrives"), null, null,
      h("div", { class: "jv-mtile col grow" },
        h("div", { class: "jv-mrow sb" },
          h("div", {}, h("p", { class: "huge" }, String(sum), " ", h("span", { text: tn("mail today", "mails today", sum) })),
            h("p", { class: "cap" }, sum ? h("span", {}, `${t("Busiest at")} `, h("span", { class: "blue", text: clock(peak) }), ` · ${t("click an hour")}`) : t("Nothing yet today"))),
          legend),
        big,
        h("div", { class: "jv-mrow sb cap" }, ...["00", "03", "06", "09", "12", "15", "18", "21", "24"].map((x) => h("span", { text: x })))),
      h("div", { class: "jv-mpair" }, h("div", { class: "jv-mtile" }, hourTitle, hourList), sorted));
    pickHour(sum ? peak : now.getHours());
  };

  const showWaiting = (order = 0) => {
    const list = [...waiting].sort(order === 0
      ? (a, b) => Number(b.vip) - Number(a.vip) || b.date - a.date
      : (a, b) => a.date - b.date);
    const grid = h("div", { class: "jv-mwgrid" });
    if (!list.length) grid.append(h("p", { class: "cap", text: t("Nothing waiting on you.") }));
    for (const m of list) {
      const text = h("p", { class: "txt cap", text: "…" });
      const filesRow = h("div");
      const chip = h("span", { class: "jv-mchip", text: m.vip ? t("VIP") : m.account });
      if (m.vip) { chip.style.background = VIP; chip.style.color = "#000"; }
      const card = h("div", { class: `jv-mtile col${m.vip ? " raised" : ""}` },
        h("div", { class: "jv-mrow sb" }, h("span", { class: "cap", text: new Date(m.date).toLocaleString(language(), { weekday: "short", hour: "2-digit", minute: "2-digit" }) }), chip),
        h("div", { class: "jv-mrow who" }, rb((senderName(m)[0] ?? "?").toUpperCase(), m.vip ? VIP : BUSY, m.vip ? "#000" : "#fff", senderName(m), undefined, 34),
          h("div", {}, h("p", { class: "subj", text: m.subject || t("(no subject)") }), h("p", { class: "cap", text: `${senderName(m)} · ${m.address}` }))),
        text, filesRow,
        h("div", { class: "jv-mrow acts end-row" }, h("span", { class: "cap grow", text: gmail(m) ? `${t("Reply")} · ${openIn(m)}` : `${t("Reply")} · ${t("Done")} · ${openIn(m)}` }),
          rb("↩", BLUE, "#fff", t("Reply"), () => void MailBridge.open(m, true), 32),
          ...(gmail(m) ? [] : [rb("✓", "#30d158", "#000", t("Done"), () => done(m), 32)]),
          rb("↗", "#3a3a3c", "#fff", openIn(m), () => void MailBridge.open(m, false), 32)));
      grid.append(card);
      void MailBridge.detail(m).then((d) => {
        if (!d) return;
        text.textContent = d.text.trim().slice(0, 420) || "";
        text.classList.remove("cap");
        for (const f of d.attachments) {
          const [badge, , color] = fileKind(f);
          filesRow.append(h("div", { class: "jv-mrow jv-mfile" }, h("b", { style: `background:${color}`, text: badge }), h("span", { text: f })));
        }
      }).catch(() => { text.textContent = ""; });
    }
    openFull(t("Waiting on you"), list.length, tabs2([t("Most important"), t("Oldest")], order, (i) => showWaiting(i)), grid);
    redrawWaiting = () => { drawWaiting(); showWaiting(order); };
  };

  const showFiles = (filter = 0, selIdx = 0) => {
    const kinds: (FileKind | "All")[] = ["All", "PDF", "Images", "Sheets", "Other"];
    const all = todaysFiles(today);
    const grid = h("div", { class: "jv-mfgrid" });
    const shown = all.map((f, i) => ({ f, i })).filter(({ f }) => filter === 0 || fileKind(f.name)[1] === kinds[filter]);
    if (!shown.some(({ i }) => i === selIdx)) selIdx = shown[0]?.i ?? -1;
    if (!shown.length) grid.append(h("p", { class: "cap", text: t("No files today.") }));
    for (const { f, i } of shown) {
      const [badge, kind, color] = fileKind(f.name);
      grid.append(h("button", { class: `jv-mfcard${i === selIdx ? " on" : ""}`, onclick: () => showFiles(filter, i) },
        h("div", { class: `pv ${kind === "PDF" || badge === "DOC" ? "paper" : ""}` }, h("span", { text: f.name })),
        h("div", { class: "jv-mrow meta" }, h("b", { style: `background:${color}`, text: badge }),
          h("div", { class: "grow" }, h("p", { class: "nm", text: f.name }), h("p", { class: "cap", text: `${senderName(f.m)} · ${time(f.m.date)}` })))));
    }
    const chosen = selIdx >= 0 ? all[selIdx] : undefined;
    const bar = h("div", { class: "jv-mrow sb jv-mselbar" },
      h("span", { class: "cap", text: chosen ? t("{0} selected", { 0: chosen.name }) : "" }),
      chosen ? h("span", { class: "jv-mrow g6" },
        h("button", { class: "jv-chipbtn", text: t("Show the mail"), onclick: () => void MailBridge.open(chosen.m, false) }),
        h("button", { class: "jv-chipbtn", text: t("Reply"), onclick: () => void MailBridge.open(chosen.m, true) })) : h("span"));
    openFull(t("Files today"), all.length, tabs2([t("All"), "PDF", t("Images"), t("Sheets"), t("Other")], filter, (i) => showFiles(i, selIdx)), grid, bar);
  };

  arrBox.addEventListener("click", showArrivals);
  waitBox.addEventListener("click", () => showWaiting());
  fileBox.addEventListener("click", () => showFiles());

  // ── Loading ──
  let monthReq = 0, dayReq = 0;
  const loadMonth = async () => {
    const mine = ++monthReq, at = offset;
    const got = (await (at === 0 ? Bridge.mailMonth() : Bridge.mailMonthAt(at)).catch(() => null)) ?? null;
    if (mine !== monthReq) return;
    month = got;
    drawMonth();
  };
  const loadDay = async () => {
    const mine = ++dayReq, at = sel;
    const got = !at ? [] : at === todayKey ? today : ((await Bridge.mailDay(at).catch(() => null))?.messages ?? []);
    if (mine !== dayReq) return;
    dayList = got;
    drawDay();
  };
  // A new month clears the chosen day; back on this month it's today again (#84: the old day stayed chosen).
  const moveMonth = (by: number) => {
    offset = Math.min(0, offset + by);
    sel = offset === 0 ? todayKey : "";
    void loadMonth(); void loadDay();
  };
  const nextOff = () => {
    const b = h("button", { class: "jv-mrb", disabled: true, "aria-label": t("Next month"), title: t("Next month"), text: "›" });
    b.style.background = "var(--jv-s2)"; b.style.color = "var(--jv-t1)";
    return b;
  };
  drawMonth(); drawDay(); drawArrivals(); drawWaiting(); drawFilesSmall();
  const [, day, flagged, tri] = await Promise.all([
    loadMonth(),
    Bridge.mailDay(todayKey).catch(() => null),
    MailBridge.search("", "flagged").catch(() => [] as MailMessage[]),
    MailBridge.triage().catch(() => null),
  ]);
  triage = tri;
  today = day?.messages ?? [];
  dayList = today;
  const vipIds = new Set(today.filter((m) => m.vip).map((m) => m.entryId));
  waiting = (flagged ?? []).map((m) => ({ ...m, files: [], hour: new Date(m.date).getHours(), vip: vipIds.has(m.entryId) || isVip(m.address, tri?.settings.vip ?? []) }));
  drawDay(); drawArrivals(); drawWaiting(); drawFilesSmall();
}

/** The VIP list's test (triage.rs vip_hit): a whole address, or a domain. */
export function isVip(address: string, vip: readonly string[]): boolean {
  const a = address.trim().toLowerCase();
  return vip.some((raw) => {
    const e = raw.trim().toLowerCase();
    if (!e) return false;
    if (e.includes("@") && !e.startsWith("@")) return a === e;
    const d = e.replace(/^@/, "");
    const dom = a.split("@")[1] ?? "";
    return dom === d || dom.endsWith(`.${d}`);
  });
}
