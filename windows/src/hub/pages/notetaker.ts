// JARVIS: Notes · Notetaker, one to one with the live demo (prototypes/jarvis-live.html, the
// Notetaker pane): a lined page waiting for your next call (today's notes written on it, Record
// in the margin), Today and Earlier below; Record opens its own page (the time, the voice, what's
// being said); a call's note leads with the summary (to-dos and key points beside each other);
// Show transcript reads the call back like lyrics. Everything the old page did stays: rename the
// call and its people, copy, export, delete, write the summary again, retry.

import { h, clear } from "../../views/dom";
import { t, tn, language } from "../../i18n/i18n";
import { Bridge, onEvent } from "../../core/bridge";
import { FlowBridge, clock, speakerColor, type Note, type NotesState } from "../../core/flow";
import { eventsBetween, type CalEvent } from "../../core/ics";
import type { HubContext } from "../shell";
import { readPieces } from "../../core/readalong";

type View = { kind: "home" } | { kind: "rec" } | { kind: "note"; id: string } | { kind: "tx"; id: string };

const hm = (ms: number) => new Date(ms).toLocaleTimeString(language(), { hour: "2-digit", minute: "2-digit" });
const sameDay = (a: number, b: Date) => new Date(a).toDateString() === b.toDateString();
const minutes = (n: Note) => (n.end ? Math.max(1, Math.round((n.end - n.start) / 60_000)) : 0);
/** The summary's first sentence, and the rest. */
export function splitSummary(s: string): [string, string] {
  const m = s.match(/^(.+?[.!?])(\s+|$)([\s\S]*)$/);
  return m ? [m[1], m[3].trim()] : [s, ""];
}
const people = (n: Note) => n.speakers.map((s) => s.name).join(", ");
const dayName = (ms: number) => new Date(ms).toLocaleDateString(language(), { weekday: "long" });

export async function notetakerPage(page: HTMLElement, ctx: HubContext) {
  let state: NotesState = (await FlowBridge.notes().catch(() => null)) ?? { notes: [], recording: null, working: [] };
  let events: CalEvent[] = [];
  let view: View = state.recording ? { kind: "rec" } : { kind: "home" };
  let timer = 0;
  /** Earlier: all of them (Show all), and what the search keeps. */
  let showAll = false, findText = "";
  /** What was drawn last (shownKey below): notes-changed redraws only when it changes. */
  let lastKey = "";
  page.classList.add("jv-ntpage");

  const noteOf = (id: string) => state.notes.find((n) => n.id === id) ?? null;
  const scrollTop = () => (page.closest(".hub-scroll") as HTMLElement | null)?.scrollTo({ top: 0 });
  const go = (v: View) => { view = v; window.clearInterval(timer); timer = 0; draw(); scrollTop(); };
  const back = (label: string, to: View) => h("button", { class: "jv-ntback", text: `‹ ${label}`, onclick: () => go(to) });

  function draw() {
    clear(page);
    lastKey = shownKey();
    if (view.kind === "home") drawHome();
    else if (view.kind === "rec") drawRec();
    else if (view.kind === "note") drawNote(view.id);
    else drawTx(view.id);
  }

  // ── The blank page ──
  function drawHome() {
    const now = new Date();
    const notes = [...state.notes].sort((a, b) => b.start - a.start);
    const today = notes.filter((n) => sameDay(n.start, now));
    const earlier = notes.filter((n) => !sameDay(n.start, now));
    const next = events.filter((e) => !e.allDay && e.start.getTime() > now.getTime() && sameDay(e.start.getTime(), now))
      .sort((a, b) => a.start.getTime() - b.start.getTime())[0];

    // Recording while you look elsewhere: a pill takes you back; nothing pulls you there (#84).
    if (state.recording) {
      const rec = noteOf(state.recording);
      page.append(h("button", { class: "jv-recpill", onclick: () => go({ kind: "rec" }) },
        h("span", { class: "dot" }), document.createTextNode(`${t("Recording")} · ${rec ? clock((Date.now() - rec.start) / 1000) : ""} · ${t("back to it")}`)));
    }
    const lined = h("div", { class: "jv-lined" }, h("div", { class: "margin" }),
      h("p", { class: "cap", text: now.toLocaleDateString(language(), { weekday: "long", day: "numeric", month: "long" }) }));
    // Only the two latest calls are written on the page, newest first, one short line each: a new one pushes the oldest off
    // (they're all in Today below).
    for (const n of today.slice(0, 2)) {
      const todos = n.todos.filter((x) => !x.done).length;
      const what = n.status === "ready" ? n.title : n.status === "failed" ? t("couldn't be written") : t("Writing the note…");
      lined.append(h("p", { class: "ln serif" },
        h("span", { class: "tm", text: hm(n.start) }), h("span", { class: "hi", text: what }),
        ...(todos ? [h("span", { class: "td", text: tn("{count} to-do.", "{count} to-dos.", todos) })] : []),
        h("button", { class: "open", text: `${t("Open note")} ›`, onclick: () => go({ kind: "note", id: n.id }) })));
    }
    lined.append(
      h("p", { class: "big serif first" }, ...(next
        ? [document.createTextNode(`${t("Your next call is at")} `), h("span", { class: "red", text: hm(next.start.getTime()) }), document.createTextNode(".")]
        : [document.createTextNode(state.recording ? t("I'm writing this call down.") : t("No more calls today."))])),
      h("p", { class: "big serif dim" }, document.createTextNode(next ? t("I'll write it down for you.") : t("Press Record when one starts.")), h("span", { class: "caret" })));
    const rec = h("button", { class: "jv-recbtn", onclick: async () => {
      if (state.recording) { go({ kind: "rec" }); return; }
      try { await FlowBridge.startNote(); state = (await FlowBridge.notes()) ?? state; go({ kind: "rec" }); }
      catch (err) { warn.textContent = t("Couldn't start recording: {0}", { 0: String(err).replace(/^Error:\s*/, "") }); }
    } }, h("span", { class: `recdot${state.recording ? " on" : ""}` }), h("span", { class: "cap", text: state.recording ? t("Recording") : t("Record") }));
    const warn = h("p", { class: "jv-ntwarn" });
    lined.append(rec);
    page.append(lined, warn);

    // Today: the calls written, and the ones still to come.
    const rows: HTMLElement[] = [];
    for (const n of today) {
      const ready = n.status === "ready";
      const todos = n.todos.filter((x) => !x.done).length;
      rows.push(h("button", { class: "jv-ntrow", onclick: () => go({ kind: "note", id: n.id }) },
        h("span", { class: "cap t", text: hm(n.start) }), h("span", { class: "dot", style: `background:${n.status === "failed" ? "#ff453a" : ready ? "#30d158" : "#0a84ff"}` }),
        h("span", { class: "x", text: n.title }),
        h("span", { class: "cap", text: n.status === "recording" ? t("recording now") : n.status === "processing" ? t("writing the note…") : n.status === "failed" ? t("couldn't be written") : todos ? `${t("notes ready")} · ${tn("{count} to-do", "{count} to-dos", todos)}` : t("notes ready") }),
        h("span", { class: "go", text: "›" })));
    }
    for (const e of events.filter((x) => !x.allDay && sameDay(x.start.getTime(), now) && x.start.getTime() > now.getTime())) {
      const mins = Math.round((e.start.getTime() - now.getTime()) / 60_000);
      rows.push(h("div", { class: "jv-ntrow event" }, h("span", { class: "cap t", text: hm(e.start.getTime()) }), h("span", { class: "dot ring" }),
        h("span", { class: "x", text: e.title }), h("span", { class: "cap", text: mins < 60 ? t("in {n} min", { n: mins }) : t("in {n} h", { n: Math.round(mins / 60) }) })));
    }
    if (rows.length) page.append(h("p", { class: "jv-ntcap", text: t("Today") }), h("div", { class: "jv-nttile list" }, ...rows));

    // Earlier: the last call large, then two by two.
    if (earlier.length) {
      page.append(h("p", { class: "jv-ntcap", text: t("Earlier") }));
      const [top, ...more] = earlier;
      const [s1, s2] = splitSummary(top.summary ?? top.title);
      page.append(h("button", { class: "jv-nttile big", onclick: () => go({ kind: "note", id: top.id }) },
        h("p", { class: "cap", text: [dayName(top.start), top.title, minutes(top) ? t("{n} min", { n: minutes(top) }) : ""].filter(Boolean).join(" · ") }),
        h("p", { class: "head", text: s1 }), ...(s2 ? [h("p", { class: "cap rest", text: s2 })] : [])));
      // Every call can be reached (#84: only six showed): Show all, then a search by name or summary.
      const tile = (n: Note) => h("button", { class: "jv-nttile", onclick: () => go({ kind: "note", id: n.id }) },
        h("p", { class: "cap", text: `${new Date(n.start).toLocaleDateString(language(), { weekday: "short", day: "numeric", month: "short" })} · ${n.title}` }),
        h("p", { class: "mid", text: splitSummary(n.summary ?? n.title)[0] }));
      if (!showAll) {
        if (more.length) page.append(h("div", { class: "jv-ntgrid" }, ...more.slice(0, 6).map(tile)));
        if (more.length > 6) page.append(h("button", { class: "jv-chipbtn jv-ntall", text: t("Show all {0} calls", { 0: earlier.length }), onclick: () => { showAll = true; draw(); } }));
      } else {
        const find = h("input", { class: "jv-sinput jv-ntfind", placeholder: t("Search your calls"), value: findText }) as HTMLInputElement;
        const grid = h("div", { class: "jv-ntgrid" });
        const fill = () => {
          const q = findText.trim().toLowerCase();
          clear(grid);
          const hits = more.filter((n) => !q || `${n.title} ${n.summary ?? ""} ${people(n)}`.toLowerCase().includes(q));
          grid.append(...hits.map(tile));
          if (!hits.length) grid.append(h("p", { class: "cap", text: t("No call matches “{0}”.", { 0: findText.trim() }) }));
        };
        find.addEventListener("input", () => { findText = find.value; fill(); });
        page.append(find, grid);
        fill();
      }
    }
    if (!state.notes.length) page.append(h("p", { class: "jv-ntcap", text: t("Your calls appear here once JARVIS has written them down, on this computer.") }));
  }

  // ── Recording ──
  function drawRec() {
    const n = state.recording ? noteOf(state.recording) : null;
    const recId = state.recording;
    // When the call ends (here or anywhere else), its note opens: the transcript as it's written.
    const ended = () => go(recId ? { kind: "note", id: recId } : { kind: "home" });
    const time = h("span", { text: "00:00" });
    const bars = Array.from({ length: 18 }, () => h("i"));
    const prev = h("p", { class: "prev serif" });
    const nowLine = h("p", { class: "now serif" });
    const who = h("p", { class: "cap who" });
    const fill = () => {
      const cur = state.recording ? noteOf(state.recording) : null;
      if (!cur) { ended(); return; }
      time.textContent = clock((Date.now() - cur.start) / 1000);
      const lines = cur.lines;
      const last = lines[lines.length - 1], before = lines[lines.length - 2];
      prev.textContent = before?.text ?? "";
      nowLine.textContent = last?.text ?? t("Listening…");
      const sp = last ? cur.speakers.find((s) => s.id === last.speaker) : null;
      who.textContent = sp?.name ?? "";
      bars.forEach((b, i) => { b.style.transform = `scaleY(${(i > 13 ? 10 + Math.random() * 8 : 20 + Math.random() * 115) / 135})`; });
    };
    page.append(h("div", { class: "jv-ntrec" },
      h("div", { class: "top" }, back(t("Notetaker"), { kind: "home" }), h("span", { class: "live" }, h("span", { class: "dot" }), time)),
      h("p", { class: "cap meta", text: [n?.title, n ? people(n) : ""].filter(Boolean).join(" · ") }),
      h("div", { class: "wv" }, ...bars), prev, nowLine, who,
      h("button", { class: "stop", "aria-label": t("Stop recording"), onclick: () => { void FlowBridge.stopNote(); ended(); } }, h("i"))));
    fill();
    timer = window.setInterval(fill, 140);
  }

  // ── A call's note ──
  function drawNote(id: string) {
    const n = noteOf(id);
    if (!n) { go({ kind: "home" }); return; }
    const status = h("span", { class: "jv-ntok", role: "status" });
    const confirm = h("span", { class: "confirm" });
    const tools = h("span", { class: "tools" },
      h("button", { class: "jv-chipbtn", text: t("Copy"), onclick: async () => {
        const md = await FlowBridge.markdown(n.id);
        if (md && (await FlowBridge.copy(md))) status.textContent = t("Copied");
        window.setTimeout(() => (status.textContent = ""), 2500);
      } }),
      h("button", { class: "jv-chipbtn", text: t("Export"), onclick: async () => {
        try { const path = await FlowBridge.exportNote(n.id); if (path) status.textContent = t("Saved as {name}", { name: path }); }
        catch (err) { status.textContent = t("Couldn't export: {0}", { 0: String(err).replace(/^Error:\s*/, "") }); status.classList.add("bad"); }
      } }),
      ...(n.status === "recording" ? [] : [h("button", { class: "jv-chipbtn danger", text: t("Delete"), onclick: () => {
        clear(confirm);
        // It names what goes, and the buttons say what they do (#84).
        confirm.append(document.createTextNode(`${t("Delete “{0}” and its notes? This can't be undone.", { 0: n.title })} `),
          h("button", { class: "jv-chipbtn danger", text: t("Delete call"), onclick: () => { void FlowBridge.deleteNote(n.id); go({ kind: "home" }); } }),
          h("button", { class: "jv-chipbtn", text: t("Keep"), onclick: () => clear(confirm) }));
      } })]));
    // The title as the page's heading, with a Rename button you can see (#84: a tooltip was the only cue).
    const title = h("h2", { class: "jv-ntheading", text: n.title });
    const rename = h("button", { class: "jv-chipbtn", text: t("Rename") });
    rename.addEventListener("click", () => {
      const input = h("input", { class: "jv-ntinput", value: n.title }) as HTMLInputElement;
      const done = () => { void FlowBridge.renameNote(n.id, input.value.trim() || n.title); };
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
      input.addEventListener("blur", done);
      title.replaceWith(input);
      rename.remove();
      input.focus();
      input.select();
    });
    const meta = [new Date(n.start).toLocaleDateString(language(), { day: "numeric", month: "short" }), hm(n.start), minutes(n) ? t("{n} min", { n: minutes(n) }) : "", people(n)].filter(Boolean).join(" · ");

    const busy = state.working.includes(n.id) || n.status === "processing";
    const [first, rest] = splitSummary(n.summary ?? "");
    const summary = h("p", { class: "jv-ntsum" },
      ...(n.summary ? [document.createTextNode(`${first} `), h("span", { text: rest })]
        : [h("span", { text: n.status === "failed" ? (n.error ?? t("This call couldn't be written down.")) : busy ? t("Writing the note…") : t("No summary yet.") })]));

    const todos = h("div", {});
    for (const todo of n.todos) {
      const box = h("input", { type: "checkbox" }) as HTMLInputElement;
      box.checked = todo.done;
      box.addEventListener("change", () => void FlowBridge.toggleTodo(n.id, todo.id));
      const extra = [todo.owner, todo.due].filter(Boolean).join(" · ");
      todos.append(h("label", { class: `todo${todo.done ? " done" : ""}` }, box, h("span", {}, h("span", { text: todo.text }), ...(extra ? [h("span", { class: "cap", text: ` ${extra}` })] : []))));
    }
    if (!n.todos.length) todos.append(h("p", { class: "cap", text: t("None") }));
    const keys = h("div", { class: "keys" }, ...(n.keyPoints.length ? n.keyPoints.map((k) => h("p", { text: `· ${k}` })) : [h("p", { class: "cap", text: t("None") })]));

    // The people, renamed with a click.
    const who = h("div", { class: "jv-ntpeople" });
    for (const s of n.speakers) {
      const chip = h("button", { class: "jv-chipbtn", title: t("Who is it?") }, h("span", { class: "av", style: `background:${speakerColor(s.color)}`, text: s.name.slice(0, 1).toUpperCase() }), h("span", { text: s.name }));
      chip.addEventListener("click", () => {
        const input = h("input", { class: "jv-ntinput small", value: s.name, placeholder: t("Name") }) as HTMLInputElement;
        const done = () => void FlowBridge.renameSpeaker(n.id, s.id, input.value);
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
        input.addEventListener("blur", done);
        chip.replaceWith(input);
        input.focus();
      });
      who.append(chip);
    }

    page.append(
      h("div", { class: "jv-nttop" }, back(t("Notetaker"), { kind: "home" }), h("span", { class: "jv-nttools" }, status, tools)),
      confirm,
      h("div", { class: "jv-nthead" }, title, rename),
      h("p", { class: "cap meta", text: meta }),
      summary,
      h("div", { class: "jv-ntpair" },
        h("div", { class: "jv-nttile" }, h("p", { class: "cap", text: t("To-dos") }), todos),
        h("div", { class: "jv-nttile" }, h("p", { class: "cap", text: t("Key points") }), keys)),
      ...(n.speakers.length ? [h("p", { class: "cap", text: t("People in the call · press a name to change it") }), who] : []),
      h("div", { class: "jv-ntfoot" },
        ...(n.lines.length ? [h("button", { class: "link", text: `${t("Show transcript")} ›`, onclick: () => go({ kind: "tx", id: n.id }) })] : []),
        ...(n.status === "failed" ? [h("button", { class: "jv-chipbtn", text: t("Try again"), onclick: () => void FlowBridge.retryNote(n.id) })]
          : n.status === "ready" ? [h("button", { class: "jv-chipbtn", text: busy ? t("Writing the summary…") : t("Write the summary again"), onclick: () => void FlowBridge.summarize(n.id) })] : [])));
  }

  // ── The transcript, read back like lyrics ──
  function drawTx(id: string) {
    const n = noteOf(id);
    if (!n || !n.lines.length) { go({ kind: "note", id }); return; }
    const len = Math.max(n.lines[n.lines.length - 1].end, n.lines[n.lines.length - 1].start + 1);
    // A sentence or two at a time, timed, with a gap where someone paused or the other spoke (#84).
    const pieces = readPieces(n.lines);
    let i = 0, at = pieces[0].start, rate = 1;
    const inner = h("div", { class: "in" });
    const box = h("div", { class: "jv-lyr" }, inner);
    const lines = pieces.map((piece, k) => {
      const s = n.speakers.find((x) => x.id === piece.speaker);
      const b = h("button", { class: `ly${piece.first ? " first" : ""}${piece.first && k > 0 ? " gap" : ""}`, onclick: () => seek(k) },
        ...(piece.first ? [h("span", { class: "who", style: `color:${s ? speakerColor(s.color) : "#8e8e93"}`, text: `${s?.name ?? ""} · ${clock(piece.start)}` })] : []),
        document.createTextNode(piece.text));
      inner.append(b);
      return b;
    });
    // The wheel reads on too, a piece at a time (it couldn't be scrolled: only played).
    let wheelAt = 0;
    box.addEventListener("wheel", (e) => {
      e.preventDefault();
      const now = performance.now();
      if (now - wheelAt < 90) return;
      wheelAt = now;
      seek(i + (e.deltaY > 0 ? 1 : -1));
    }, { passive: false });
    const nowT = h("span", { class: "cap t" });
    const fillBar = h("i");
    const scrub = h("div", { class: "scrub" }, fillBar);
    const play = h("button", { class: "play", "aria-label": t("Read along") });
    const speed = h("button", { class: "jv-chipbtn", text: "1×" });
    const clockIt = () => { nowT.textContent = clock(at); fillBar.style.width = `${Math.min(100, (at / len) * 100).toFixed(2)}%`; };
    function seek(k: number) {
      i = Math.max(0, Math.min(lines.length - 1, k));
      at = pieces[i].start;
      lines.forEach((el, j) => { el.classList.toggle("on", j === i); el.classList.toggle("near", Math.abs(j - i) === 1); });
      const on = lines[i];
      inner.style.transform = `translateY(${Math.round(box.clientHeight * 0.4 - on.offsetTop - on.offsetHeight / 2)}px)`;
      clockIt();
    }
    const pause = () => { window.clearInterval(timer); timer = 0; play.classList.remove("on"); };
    play.addEventListener("click", () => {
      if (timer) { pause(); return; }
      play.classList.add("on");
      timer = window.setInterval(() => {
        at += 0.1 * rate;
        const next = pieces[i + 1];
        if (next && at >= next.start) seek(i + 1);
        else if (!next && at >= len) pause();
        clockIt();
      }, 100);
    });
    speed.addEventListener("click", () => { rate = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1; speed.textContent = `${rate}×`; });
    scrub.addEventListener("click", (e) => {
      const r = scrub.getBoundingClientRect();
      const target = ((e.clientX - r.left) / r.width) * len;
      let k = 0;
      pieces.forEach((l, j) => { if (l.start <= target) k = j; });
      seek(k);
    });
    page.append(
      h("div", { class: "jv-nttop" }, back(t("Note"), { kind: "note", id }), h("span", { class: "jv-nttools" },
        h("span", { class: "cap", text: n.title }),
        h("button", { class: "jv-chipbtn", text: t("Copy"), onclick: async (e: Event) => {
          const md = await FlowBridge.markdown(n.id);
          if (md && (await FlowBridge.copy(md))) (e.target as HTMLElement).textContent = t("Copied");
        } }))),
      box,
      h("div", { class: "jv-txbar" }, play, nowT, scrub, h("span", { class: "cap t", text: clock(len) }), speed),
      h("p", { class: "cap jv-txnote", text: t("Reads the call along with its timing; the sound isn't kept.") }));
    requestAnimationFrame(() => seek(0));
  }

  draw();
  // The next calls, for the blank page and Today.
  void (async () => {
    try {
      if (await Bridge.gcalConnected()) {
        const now = new Date();
        events = eventsBetween(await Bridge.gcalFetch(), now, new Date(now.getTime() + 86_400_000));
        if (view.kind === "home") draw();
      }
    } catch { /* no calendar */ }
  })();
  /** What the home page and a note show: a redraw only when this changes. */
  function shownKey(): string {
    if (view.kind === "home") return JSON.stringify([state.recording, state.notes.map((n) => [n.id, n.title, n.status, n.todos.filter((x) => !x.done).length, n.summary?.length ?? 0])]);
    if (view.kind === "note") {
      const n = noteOf(view.id);
      return JSON.stringify([n?.title, n?.status, n?.summary, n?.todos, n?.keyPoints, n?.speakers, state.working.includes(view.id)]);
    }
    return "";
  }
  lastKey = shownKey();
  const off = onEvent<string>("notes-changed", async () => {
    state = (await FlowBridge.notes().catch(() => null)) ?? state;
    if (view.kind !== "home" && view.kind !== "note") return;
    const key = shownKey();
    // Something being typed or confirmed on the page stays as it is.
    const busy = !!page.querySelector("input:focus, .confirm:not(:empty)");
    if (key === lastKey || busy) return;
    lastKey = key;
    draw();
  });
  ctx.onLeave = () => { window.clearInterval(timer); void off.then((f) => f()); };
}
