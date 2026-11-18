// JARVIS: the live code view. While a Claude Code session works, the open
// island shows the session on the left (the visor, drawn by the island, the
// project and its steps) and, on the right, what it is doing right now:
// - reading or editing a file: that file around the spot, the edit marked
//   (removed lines red, new ones green; about to change: highlighted);
// - running a command: a small terminal with the command and the end of its output;
// - done: Claude's answer.
// The steps come from core/live.ts (fed by the hooks); file lines from Rust (live.rs).

import { Bridge, type LiveWindow } from "../core/bridge";
import { State } from "../core/state";
import * as Live from "../core/live";
import { h, clear, svg } from "./dom";
import { ICONS } from "./icons";
import { t } from "../i18n/i18n";
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

/** Typing speed, and the longest the typing may take whatever the size of the edit. */
const CHARS_PER_SEC = 520;
const MAX_TYPE_MS = 1600;
/** The removed lines show alone for a beat before the new code starts typing. */
const TYPE_DELAY_MS = 380;

/**
 * Types the green (added) lines of `body` in: they start empty, then fill
 * character by character, highlighted as they grow, with a cursor at the end;
 * a soft flash when done. Red (removed) lines are there from the start.
 */
function typeIn(body: HTMLElement) {
  const rows = [...body.querySelectorAll<HTMLElement>(".lv-line.add")];
  if (!rows.length) return;
  const texts = rows.map((row) => row.querySelector(".lv-code")?.textContent ?? "");
  const total = texts.reduce((n, s) => n + s.length, 0);
  const duration = Math.min(MAX_TYPE_MS, Math.max(250, (total / CHARS_PER_SEC) * 1000));
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
  const t0 = performance.now() + TYPE_DELAY_MS;
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
}

function stepIcon(status: Live.LiveStatus | "todo"): HTMLElement {
  return h("span", { class: `lv-step-icon ${status}` });
}

export function buildLive(actions: ViewActions): ViewHost {
  const left = h("div", { class: "lv-left" });
  const right = h("div", { class: "lv-right" });
  // Back to the overview: the ‹ button, or Esc.
  const back = () => {
    actions.blip();
    actions.setView("overview");
  };
  const backBtn = h("button", { class: "icon-btn lv-back", title: t("Back"), onclick: back }, svg(ICONS.chevronLeft, 11, { stroke: 2.4 }));
  const el = h("div", { class: "view live" }, backBtn, left, right);
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
  /** The step clicked in the list (by its time), shown instead of the latest; null = follow live. */
  let selectedAt: number | null = null;
  /** Steps in the list at the last draw, to follow new ones. */
  let stepCount = 0;
  /** A step clicked again plays its edit again. */
  let replayAt: number | null = null;

  function select(at: number | null) {
    actions.blip();
    selectedAt = at;
    replayAt = at;
    shownKey = "";
    render();
  }
  let cache: { key: string; win: LiveWindow | null; error: string | null } = { key: "", win: null, error: null };

  function renderLeft(task: NonNullable<typeof State.focusTask>, s: Live.LiveSession) {
    // The list scrolls: keep where you were, unless you were at the bottom (then follow the new steps).
    const prev = left.querySelector<HTMLElement>(".lv-steps");
    const prevTop = prev?.scrollTop ?? 0;
    const atBottom = !prev || prev.scrollTop + prev.clientHeight >= prev.scrollHeight - 4;
    const prevCount = stepCount;
    stepCount = s.actions.length;
    clear(left);
    const mins = Math.max(0, Math.round((Date.now() - s.startedAt) / 60_000));
    left.append(
      h("div", { class: "lv-proj", text: task.name }),
      h("div", { class: "lv-sub", text: `Claude Code · ${mins < 1 ? t("just now") : t("{n} min", { n: mins })}` }),
    );
    const list = h("div", { class: "lv-steps" });
    for (const a of s.actions) {
      const target = a.file ? baseName(a.file) : a.command ? a.command.split(/\s+/)[0] : a.query ?? "";
      const picked = selectedAt === a.at ? " picked" : "";
      list.append(
        h("div", { class: `lv-step ${a.status}${picked}`, title: t("Show this step"), onclick: () => select(a.at) },
          stepIcon(a.status),
          h("span", { class: "lv-step-label", text: a.label }),
          h("span", { class: "lv-step-target", text: target }),
        ),
      );
    }
    list.append(
      h("div", { class: `lv-step ${s.done ? "done" : "todo"}${s.done && selectedAt == null ? " picked" : ""}`, onclick: () => select(null) },
        stepIcon(s.done ? "done" : "todo"), h("span", { class: "lv-step-label", text: t("Done") })),
    );
    left.append(list);
    list.scrollTop = atBottom || stepCount !== prevCount && selectedAt == null ? list.scrollHeight : prevTop;
  }

  function tab(file: string, cwd: string): HTMLElement {
    return panelBar(extBadge(file), baseName(file), relPath(file, cwd));
  }

  /** The bar on top of every panel: a tab (badge + name), a note on the right, room for ‹ back. */
  function panelBar(badge: string, name: string, note = "", badgeClass = ""): HTMLElement {
    return h("div", { class: "lv-tabbar" },
      h("div", { class: "lv-tab" }, h("span", { class: `lv-badge ${badgeClass}`, text: badge }), h("span", { text: name })),
      h("span", { class: "lv-path", text: note }),
    );
  }

  /** The session folder's name, for the bar of panels that are not a file. */
  function folderName(): string {
    const task = State.focusTask;
    const s = task ? Live.get(task.id) : undefined;
    return s?.cwd ? baseName(s.cwd.replace(/[\\/]+$/, "")) : "";
  }

  function codePanel(a: Live.LiveAction, cwd: string) {
    const file = a.file!;
    const editing = a.kind === "edit";
    const find = editing ? (a.status === "running" ? a.oldText : a.newText) ?? null : null;
    const key = JSON.stringify([file, a.status, find, a.line, a.at]);
    right.append(tab(file, cwd));
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
          for (const old of removed.slice(0, 6)) {
            delBlock.append(h("div", { class: "lv-line del" }, h("span", { class: "lv-num", text: "" }), h("span", { class: "lv-sign", text: "−" }), highlight(old)));
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
      // A finished edit seen for the first time (or clicked again): the new code types itself in.
      if (replayAt === a.at) {
        animated.delete(key);
        replayAt = null;
      }
      if (editing && a.status === "done" && !animated.has(key)) {
        animated.add(key);
        if (animated.size > 200) animated.delete(animated.values().next().value!);
        typeIn(body);
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

  function terminal(a: Live.LiveAction) {
    // The bar: a terminal badge and the command's name ("cd", "npm"…), the folder on the right.
    const name = (a.command ?? a.tool).trim().split(/\s+/)[0] || a.tool;
    right.append(panelBar(">_", name, folderName(), "term"));
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

  function note(text: string, sub = "", badge = "•") {
    right.append(panelBar(badge, text, folderName(), "note"));
    right.append(h("div", { class: "lv-plain" }, h("b", { text }), sub ? h("span", { text: sub }) : document.createTextNode("")));
  }

  function render() {
    const task = State.focusTask;
    const s = task ? Live.get(task.id) : undefined;
    if (!task || !s) {
      clear(left);
      clear(right);
      return;
    }
    if (selectedAt != null && !s.actions.some((x) => x.at === selectedAt)) selectedAt = null;
    const picked = selectedAt != null ? s.actions.find((x) => x.at === selectedAt) : undefined;
    const a = picked ?? Live.current(task.id);
    const key = JSON.stringify([task.id, task.name, selectedAt, s.actions.map((x) => [x.at, x.status, x.output?.length ?? 0]), s.done, task.finalLine, Math.floor(Date.now() / 60_000)]);
    if (key === shownKey) return;
    shownKey = key;
    renderLeft(task, s);
    clear(right);
    if (!picked && s.done && task.finalLine) {
      right.append(panelBar("✓", t("Done"), folderName(), "done"));
      right.append(h("div", { class: "lv-done" }, h("span", { class: "lv-done-check", text: "✓" }), h("span", { text: task.finalLine })));
      return;
    }
    if (!a) return note(t("Thinking…"));
    if ((a.kind === "read" || a.kind === "edit") && a.file) return codePanel(a, s.cwd);
    if (a.kind === "command") return terminal(a);
    if (a.kind === "search") return note(t("Searching"), a.query ?? "");
    return note(a.label);
  }

  return {
    el,
    sync() {
      if (State.view !== "live") return;
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
