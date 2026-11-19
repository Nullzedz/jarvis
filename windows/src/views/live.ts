// JARVIS: the live code view, a file card. While a Claude Code session works,
// the open island is one card that shows what it is doing right now, under a
// header with JARVIS's eye (drawn by the island), what he is doing and to what,
// and the lines changed so far (+added −removed):
// - reading or editing a file: that file around the spot, the edit marked
//   (removed lines struck through in red, the new ones typing in in green;
//   about to change: highlighted);
// - running a command: a small terminal with the command and the end of its output;
// - done: the card folds into a short summary (island.ts asks liveFolded()).
// The steps come from core/live.ts (fed by the hooks); file lines from Rust (live.rs).

import { Bridge, type LiveWindow } from "../core/bridge";
import { State } from "../core/state";
import * as Live from "../core/live";
import { h, clear, svg } from "./dom";
import { ICONS } from "./icons";
import { t } from "../i18n/i18n";
import { LIVE_FOLDED_H, VIEW_LAYOUTS } from "../core/layout";
import type { ViewActions, ViewHost } from "./views";



function baseName(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

/** `file` relative to the session folder, with forward slashes. */
export function relPath(file: string, cwd: string): string {
  const norm = (s: string) => s.replace(/\\/g, "/").replace(/\/+$/, "");
  const f = norm(file);
  const c = norm(cwd);
  return c && f.toLowerCase().startsWith(c.toLowerCase() + "/") ? f.slice(c.length + 1) : f;
}

/** The file type badge: "TS", "RS", "PY"… */
export function extBadge(file: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(file);
  return (m ? m[1] : "TXT").slice(0, 3).toUpperCase();
}

const KEYWORDS = new Set(
  ("const let var function return if else for while do switch case break continue new class extends import export from default " +
    "async await try catch finally throw typeof instanceof in of interface type enum public private protected static readonly " +
    "fn pub mut impl struct trait use mod match loop where self Self crate def lambda pass yield with as None True False null undefined true false void")
    .split(" "),
);

/** A light highlighter: comments, strings, numbers, keywords, function names. */
export function highlight(line: string): HTMLElement {
  const el = h("span", { class: "lv-code" });
  const re = /(\/\/.*$|#(?!\[).*$|\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const push = (text: string, cls?: string) => {
    if (!text) return;
    el.append(cls ? h("span", { class: cls, text }) : document.createTextNode(text));
  };
  while ((m = re.exec(line))) {
    push(line.slice(last, m.index));
    if (m[1]) push(m[1], "tk-com");
    else if (m[2]) push(m[2], "tk-str");
    else if (m[3]) push(m[3], "tk-num");
    else if (m[4]) push(m[4], KEYWORDS.has(m[4]) ? "tk-kw" : "tk-fn");
    else if (m[5]) push(m[5], KEYWORDS.has(m[5]) ? "tk-kw" : undefined);
    last = re.lastIndex;
  }
  push(line.slice(last));
  return el;
}

/** Edits already animated (by their key): reopening the view shows them finished. */
const animated = new Set<string>();

/** Typing speed, and the shortest and longest the typing may take whatever the size of the edit. */
const CHARS_PER_SEC = 110;
const MIN_TYPE_MS = 600;
const MAX_TYPE_MS = 4500;
/** The removed lines are struck through one after another, this far apart (the whole run at most STRIKE_MAX_MS). */
const STRIKE_STEP_MS = 140;
const STRIKE_MAX_MS = 1400;
/** How long one line's strike takes (style.css lv-strike). */
const STRIKE_MS = 300;
/** After the edit has played, it stays this long before the next step shows. */
const LINGER_MS = 900;
/** Removed lines shown at most; the rest are counted. */
const MAX_REMOVED = 40;

/** When removed line `i` (of `n`) is struck through, from the start of the edit (ms). */
export function strikeAt(i: number, n: number): number {
  const step = n > 1 ? Math.min(STRIKE_STEP_MS, STRIKE_MAX_MS / (n - 1)) : 0;
  return 150 + i * step;
}

/** How long typing `chars` characters of new code takes (ms). */
export function typeDuration(chars: number): number {
  return Math.min(MAX_TYPE_MS, Math.max(MIN_TYPE_MS, (chars / CHARS_PER_SEC) * 1000));
}

/**
 * Types the green (added) lines of `body` in, `delay` ms from now (once the
 * removed lines are struck through): they start empty, then fill character by
 * character, highlighted as they grow, with a cursor at the end; a soft flash
 * when done. Returns how long the whole thing takes (ms).
 */
function typeIn(body: HTMLElement, delay: number): number {
  const rows = [...body.querySelectorAll<HTMLElement>(".lv-line.add")];
  if (!rows.length) return delay;
  const texts = rows.map((row) => row.querySelector(".lv-code")?.textContent ?? "");
  const total = texts.reduce((n, s) => n + s.length, 0);
  const duration = typeDuration(total);
  const caret = h("span", { class: "lv-typecaret" });
  const setText = (row: HTMLElement, text: string) => {
    const old = row.querySelector(".lv-code");
    const fresh = highlight(text);
    if (old) row.replaceChild(fresh, old);
    else row.append(fresh);
    return fresh;
  };
  rows.forEach((row) => {
    setText(row, "");
    row.classList.add("typing");
  });
  // Where each row's text starts in the whole typed run.
  const starts = texts.map((_, i) => texts.slice(0, i).reduce((n, s) => n + s.length, 0));
  const t0 = performance.now() + delay;
  const step = (now: number) => {
    if (!body.isConnected) return; // the view moved on: nothing to finish
    const shown = Math.max(0, Math.floor(((now - t0) / duration) * total));
    let caretPlaced = false;
    rows.forEach((row, i) => {
      // A row opens once typing reaches it (the first one right away).
      const reached = i === 0 || shown >= starts[i];
      row.classList.toggle("shown", reached);
      const n = Math.min(texts[i].length, Math.max(0, shown - starts[i]));
      const span = setText(row, texts[i].slice(0, n));
      if (reached && !caretPlaced && n < texts[i].length) {
        caretPlaced = true;
        span.append(caret);
      }
    });
    if (shown < total) {
      requestAnimationFrame(step);
      return;
    }
    caret.remove();
    rows.forEach((row) => {
      row.classList.remove("typing");
      row.classList.add("flash");
    });
  };
  requestAnimationFrame(step);
  return delay + duration;
}

/** The answer as plain words: markdown links become their text, ** and ` go. */
export function plainSummary(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .trim();
}

/** Lines in `text` (a trailing newline does not count). */
function lineCount(text: string | undefined): number {
  return text ? text.replace(/\n$/, "").split("\n").length : 0;
}

/** Lines added and removed by a session's edits so far. */
export function diffTotals(actions: Live.LiveAction[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const a of actions) {
    if (a.kind !== "edit" || a.status === "failed") continue;
    added += lineCount(a.newText);
    removed += lineCount(a.oldText);
  }
  return { added, removed };
}

/** The finished session's summary is showing: the island's height for it (fitted to the text), else 0. */
let folded = 0;
export function liveFolded(): number {
  return folded;
}

/** The island's height around a summary `textH` tall (at least LIVE_FOLDED_H, at most the full view). */
export function foldedHeight(textH: number): number {
  // 42: the island's tabs; 2 + 6: the view's padding; 2: the card's border; 28: its header; 10: the island's bottom edge.
  return Math.round(Math.min(VIEW_LAYOUTS.live.height, Math.max(LIVE_FOLDED_H, 42 + 2 + 2 + 28 + textH + 6 + 10)));
}

export function buildLive(actions: ViewActions, onResize: () => void = () => {}): ViewHost {
  const right = h("div", { class: "lv-right" });
  // Back to the overview: the ‹ button, or Esc.
  const back = () => {
    actions.blip();
    actions.setView("overview");
  };
  const backBtn = h("button", { class: "icon-btn lv-back", title: t("Back"), onclick: back }, svg(ICONS.chevronLeft, 11, { stroke: 2.4 }));
  const el = h("div", { class: "view live" }, backBtn, right);
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || State.view !== "live" || State.mode !== "expanded") return;
      e.stopImmediatePropagation();
      back();
    },
    true,
  );

  let shownKey = "";
  let fileToken = 0;
  let cache: { key: string; win: LiveWindow | null; error: string | null } = { key: "", win: null, error: null };

  /** `h`: the island's height that shows the whole summary; 0 unfolds. */
  function setFolded(h: number) {
    el.classList.toggle("folded", h > 0);
    if (h === folded) return;
    folded = h;
    onResize();
  }

  /** An edit playing (struck through, then typed in): it stays on screen until `until`, newer steps wait. */
  let held: { at: number; until: number } | null = null;
  let holdTimer = 0;
  function hold(at: number, ms: number) {
    held = { at, until: Date.now() + ms };
    clearTimeout(holdTimer);
    holdTimer = window.setTimeout(() => {
      shownKey = "";
      render();
    }, ms + 20);
  }

  /** The card's header: room for the eye, what he is doing and to what, the lines changed so far. */
  function head(verb: string, target: string, s?: Live.LiveSession, title = "") {
    const bar = h("div", { class: "lv-head", title },
      h("span", { class: "lv-verb", text: verb }),
      h("span", { class: "lv-target", text: target }),
    );
    const d = s ? diffTotals(s.actions) : { added: 0, removed: 0 };
    if (d.added || d.removed) {
      bar.append(h("span", { class: "lv-diff" },
        h("span", { class: "lv-plus", text: `+${d.added}` }),
        h("span", { class: "lv-minus", text: `−${d.removed}` }),
      ));
    }
    right.append(bar);
  }

  /** The session folder's name, for commands. */
  function folderName(): string {
    const task = State.focusTask;
    const s = task ? Live.get(task.id) : undefined;
    return s?.cwd ? baseName(s.cwd.replace(/[\\/]+$/, "")) : "";
  }

  function codePanel(a: Live.LiveAction, s: Live.LiveSession) {
    const file = a.file!;
    const cwd = s.cwd;
    const editing = a.kind === "edit";
    const find = editing ? (a.status === "running" ? a.oldText : a.newText) ?? null : null;
    const key = JSON.stringify([file, a.status, find, a.line, a.at]);
    head(editing ? (a.status === "running" ? t("Editing") : t("Edited")) : t("Reading"), relPath(file, cwd), s, file);
    const body = h("div", { class: "lv-codebody" });
    right.append(body);
    const paint = () => {
      clear(body);
      if (cache.key !== key || (!cache.win && !cache.error)) {
        body.append(h("div", { class: "lv-note", text: editing ? t("Editing…") : t("Reading…") }));
        return;
      }
      if (cache.error || !cache.win) {
        body.append(h("div", { class: "lv-note", text: cache.error ?? "" }));
        return;
      }
      const w = cache.win;
      const done = editing && a.status !== "running";
      const removed = done && a.oldText != null && w.focusStart > 0 ? a.oldText.replace(/\n$/, "").split("\n") : [];
      // Removed lines in a red outlined box (struck through), added ones in a green one.
      let addBlock: HTMLElement | null = null;
      w.lines.forEach((line, i) => {
        const n = w.start + i;
        const inFocus = w.focusStart > 0 && n >= w.focusStart && n <= w.focusEnd;
        if (n === w.focusStart && removed.length) {
          const delBlock = h("div", { class: "lv-block del" });
          const shownOld = removed.slice(0, MAX_REMOVED);
          shownOld.forEach((old, j) => {
            const row = h("div", { class: "lv-line del" }, h("span", { class: "lv-num", text: "" }), h("span", { class: "lv-sign", text: "−" }), highlight(old));
            // Each line is struck through in turn (style.css lv-strike reads --strike).
            row.style.setProperty("--strike", `${strikeAt(j, shownOld.length)}ms`);
            delBlock.append(row);
          });
          if (removed.length > shownOld.length) {
            delBlock.append(h("div", { class: "lv-line del more", text: `… ${removed.length - shownOld.length}` }));
          }
          body.append(delBlock);
        }
        const row = h("div", { class: inFocus ? (done ? "lv-line add" : "lv-line pending") : "lv-line" },
          h("span", { class: "lv-num", text: String(n) }),
          h("span", { class: "lv-sign", text: inFocus && done ? "+" : "" }),
          highlight(line),
        );
        if (inFocus && done) {
          if (!addBlock) {
            addBlock = h("div", { class: "lv-block add" });
            body.append(addBlock);
          }
          addBlock.append(row);
        } else body.append(row);
      });
      const focusEl = body.querySelector(".lv-block, .lv-line.pending");
      if (focusEl instanceof HTMLElement) body.scrollTop = Math.max(0, focusEl.offsetTop - body.clientHeight / 3);
      // A finished edit seen for the first time: the new code types itself in.
      if (editing && a.status === "done" && !animated.has(key)) {
        animated.add(key);
        if (animated.size > 200) animated.delete(animated.values().next().value!);
        const n = Math.min(removed.length, MAX_REMOVED);
        const struck = n ? strikeAt(n - 1, n) + STRIKE_MS + 250 : 250;
        hold(a.at, typeIn(body, struck) + LINGER_MS);
      }
    };
    paint();
    if (cache.key !== key) {
      const tok = ++fileToken;
      cache = { key, win: null, error: null };
      Bridge.liveRead(file, cwd, find, a.line ?? null)
        .then((win) => {
          if (tok !== fileToken) return;
          cache = { key, win, error: null };
          paint();
        })
        .catch((err) => {
          if (tok !== fileToken) return;
          cache = { key, win: null, error: String(err) };
          paint();
        });
    }
    right.append(
      h("button", { class: "lv-open", text: t("Open in VS Code ↗"), onclick: () => void Bridge.openFileInVSCode(file) }),
    );
  }

  function terminal(a: Live.LiveAction, s: Live.LiveSession) {
    head(a.status === "running" ? t("Running") : t("Ran"), a.command ?? a.tool, s, folderName());
    const term = h("div", { class: "lv-term" });
    term.append(h("div", { class: "lv-cmd" }, h("span", { class: "lv-prompt", text: "❯" }), h("span", { text: a.command ?? a.tool })));
    if (a.output) {
      // All of the tail the relay sends (about 1.8 KB): the panel scrolls.
      for (const line of a.output.split("\n")) {
        const cls = /\b(fail|error|✖)/i.test(line) ? "lv-out bad" : /\b(pass|ok|✔|success)/i.test(line) ? "lv-out good" : "lv-out";
        term.append(h("div", { class: cls, text: line }));
      }
    }
    if (a.status === "running") term.append(h("span", { class: "lv-caret" }));
    else if (!a.output) term.append(h("div", { class: "lv-out", text: a.status === "failed" ? t("⚠ failed") : "✓" }));
    right.append(term);
    term.scrollTop = term.scrollHeight;
  }

  function note(s: Live.LiveSession, verb: string, target = "") {
    head(verb, target, s);
    right.append(h("div", { class: "lv-plain" }, h("span", { class: "lv-caret" })));
  }

  function render() {
    const task = State.focusTask;
    const s = task ? Live.get(task.id) : undefined;
    if (!task || !s) {
      clear(right);
      setFolded(0);
      return;
    }
    // An edit still playing stays on screen; what came after it waits its turn.
    const playing = held && Date.now() < held.until ? s.actions.find((x) => x.at === held!.at) : undefined;
    if (!playing) held = null;
    const a = playing ?? Live.current(task.id);
    const key = JSON.stringify([task.id, playing?.at ?? null, s.actions.map((x) => [x.at, x.status, x.output?.length ?? 0]), s.done, task.finalLine]);
    if (key === shownKey) return;
    shownKey = key;
    clear(right);
    if (!playing && s.done && task.finalLine) {
      // Done: the summary under the eye, the lines changed on the right; the
      // island folds to just what the summary needs.
      head(t("Done"), "", s);
      const done = h("div", { class: "lv-done", text: plainSummary(task.finalLine) });
      right.append(done);
      el.classList.add("folded");
      setFolded(foldedHeight(done.scrollHeight));
      return;
    }
    setFolded(0);
    if (!a) return note(s, t("Thinking…"));
    if ((a.kind === "read" || a.kind === "edit") && a.file) return codePanel(a, s);
    if (a.kind === "command") return terminal(a, s);
    if (a.kind === "search") return note(s, t("Searching"), a.query ?? "");
    return note(s, a.label);
  }

  return {
    el,
    sync() {
      if (State.view !== "live") {
        if (folded) setFolded(0);
        return;
      }
      // Nothing to show any more (the session ended): back to the usual view.
      const task = State.focusTask;
      if (State.mode === "expanded" && (!task || !Live.get(task.id))) {
        actions.setView(State.defaultView());
        return;
      }
      render();
    },
  };
}
