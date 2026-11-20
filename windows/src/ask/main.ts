// JARVIS: the type-to-ask box (design C), opened beside the mouse by a quick
// tap of Left Ctrl + Left Shift (src-tauri/src/voice/ask.rs). His white visor
// face, a field to type in, and his answer right underneath as it's written.
// Enter sends, Shift+Enter adds a line, Esc closes, a click elsewhere too.

import "./ask.css";
import { Bridge, onEvent } from "../core/bridge";
import { resolveLanguage, setLanguage, systemLanguages, t } from "../i18n/i18n";

const root = document.getElementById("ask")!;
const card = document.createElement("div");
card.className = "card";
const head = document.createElement("div");
head.className = "head";
const face = document.createElement("div");
face.className = "face";
face.append(Object.assign(document.createElement("i"), { className: "eye" }));
const field = document.createElement("textarea");
field.rows = 1;
field.spellcheck = false;
const hint = document.createElement("span");
hint.className = "key";
hint.textContent = "Enter";
head.append(face, field, hint);
const answer = document.createElement("div");
answer.className = "answer";
card.append(head, answer);
root.append(card);

let busy = false;
let text = "";

/** The window follows the card's height. */
function fit() {
  requestAnimationFrame(() => void Bridge.askResize(Math.ceil(card.getBoundingClientRect().height) + 2));
}

/** The field grows with what's typed, up to a few lines. */
function grow() {
  field.style.height = "auto";
  field.style.height = `${Math.min(field.scrollHeight, 96)}px`;
  fit();
}

function reset() {
  busy = false;
  text = "";
  field.value = "";
  field.disabled = false;
  lock(false);
  answer.textContent = "";
  answer.classList.remove("on", "thinking");
  card.classList.remove("thinking");
  grow();
  field.focus();
}

/** Sent: the question can't be changed until his answer comes (issue #16). */
function lock(on: boolean) {
  field.readOnly = on;
  card.classList.toggle("locked", on);
}

function send() {
  const q = field.value.trim();
  if (!q || busy) return;
  busy = true;
  lock(true);
  text = "";
  answer.textContent = t("Thinking…");
  answer.classList.add("on", "thinking");
  card.classList.add("thinking");
  fit();
  void Bridge.askSend(q);
}

field.addEventListener("input", grow);
field.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  } else if (e.key === "Escape") {
    void Bridge.askClose();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") void Bridge.askClose();
});
// A click elsewhere: the box goes away (not while he's answering).
window.addEventListener("blur", () => {
  if (!busy) void Bridge.askClose();
});

async function main() {
  const boot = await Bridge.boot();
  setLanguage(resolveLanguage(boot?.settings.language, systemLanguages()));
  // What he's looking at: the part you circled, the whole screen, or nothing (no picture).
  void onEvent<string>("ask-open", (what) => {
    field.placeholder = what === "circled" ? t("Ask about what you circled") : what === "screen" ? t("Ask about your screen") : t("Ask JARVIS anything");
    reset();
  });
  field.placeholder = t("Ask JARVIS anything");
  // The answer so far, cleaned by Rust (ask.rs).
  void onEvent<string>("ask-delta", (sofar) => {
    if (answer.classList.contains("thinking")) {
      answer.classList.remove("thinking");
      card.classList.remove("thinking");
      answer.textContent = "";
    }
    text = sofar;
    answer.textContent = text;
    fit();
  });
  void onEvent<string>("ask-done", (final) => {
    busy = false;
    lock(false);
    answer.classList.remove("thinking");
    card.classList.remove("thinking");
    answer.textContent = final;
    // Ready for the next question in the same box.
    field.value = "";
    grow();
    field.focus();
  });
  reset();
}

void main();
