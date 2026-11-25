// JARVIS: the JARVIS section's first tab (#67), one to one with the demo's (prototypes/jarvis-home.html
// #jarvis): on the left the glowing listening panel (the listening chip, his visor, your voice's
// waveform, what he just heard; his voice and "Answer only my voice" below); on the right today's
// conversation as message bubbles, his drawing under the answer that drew one, and "Type to JARVIS".
// The conversation is kept in memory only (src-tauri/src/last_answer.rs).

import { h, clear } from "../../views/dom";
import { t } from "../../i18n/i18n";
import { Bridge, onEvent, type HisWindow } from "../../core/bridge";
import { visor } from "../../theme/theme";
import { listeningChip, voiceLine } from "../jarvis-widget";
import type { HubContext } from "../shell";
import { fillWindow } from "../fit";

export interface Turn { you: string; him: string; at: number }

const BARS = 16;

export function talkPage(page: HTMLElement, ctx: HubContext, start: Turn[] = []) {
  const status = ctx.status;

  // ── Left: the glowing panel ──
  const chip = listeningChip(status);
  const wave = h("div", { class: "jv-wv" });
  const bars: HTMLElement[] = Array.from({ length: BARS }, () => h("i"));
  wave.append(...bars);
  // What to do, said plainly: with the wake word off, "Hey JARVIS" isn't an option (#84).
  const idle = () => (status.prefs.voice ? t("Say “Hey JARVIS”, or type to him.") : t("Press the microphone, or type to him."));
  const heard = h("p", { class: "jv-heard", text: idle() });
  const name = h("p", { class: "nm" });
  const desc = h("p", { class: "cap" });
  const play = h("span", { class: "play", text: "▶︎", title: t("Play") });
  if (status.prefs.voiceOutput !== "jarvis") play.style.display = "none";
  const card = h("button", { class: "jv-voicecard", onclick: () => ctx.navigate("voice") },
    play, h("div", { class: "x" }, name, desc), h("span", { class: "cap", text: `${t("Change")} ›` }));
  void voiceLine(status).then((line) => {
    const [n, ...rest] = line.split(" · ");
    name.textContent = n;
    desc.textContent = rest.join(" · ");
  });
  // ▶ plays his voice (JARVIS's own voice only; the others are previewed on Hey JARVIS).
  play.addEventListener("click", (e) => {
    e.stopPropagation();
    if (status.prefs.voiceOutput !== "jarvis") return;
    void Bridge.voicePreview(status.prefs.voiceName || "george").then((bytes) => {
      const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
      const a = new Audio(url);
      a.onended = () => URL.revokeObjectURL(url);
      void a.play();
    }).catch(() => {});
  });
  const toggle = h("span", { class: `jv-switch${status.prefs.voiceOnlyMe ? " on" : ""}` }, h("i"));
  const onlyMe = h("button", { class: "jv-onlyme", role: "switch", "aria-checked": String(!!status.prefs.voiceOnlyMe) }, h("span", { text: t("Answer only my voice") }), toggle);
  const teach = h("p", { class: "jv-teach" }, document.createTextNode(`${t("He needs to learn your voice first.")} `),
    h("button", { class: "jv-link", text: `${t("Teach him in Settings")} ›`, onclick: () => ctx.navigate("voice") }));
  teach.style.display = "none";
  onlyMe.addEventListener("click", async () => {
    const print = await Bridge.voicePrintStatus();
    // Not trained yet: say so, with the way there (it used to jump to Settings without a word, #84).
    if (!print?.trained) { teach.style.display = ""; return; }
    const on = !toggle.classList.contains("on");
    toggle.classList.toggle("on", on);
    onlyMe.setAttribute("aria-checked", String(on));
    await ctx.setPrefs((p) => (p.voiceOnlyMe = on));
  });
  const chipDot = h("span", { class: "dot", style: `background:${chip.color}` });
  const chipText = h("span", { text: chip.text });
  const glow = h("div", { class: "jv-glow" },
    h("span", { class: "jv-chip" }, chipDot, chipText),
    h("div", { class: "mid" }, visor(84), wave, heard),
    h("div", { class: "foot" }, h("p", { class: "cap", text: t("His voice") }), card, onlyMe, teach));

  // ── Right: the conversation ──
  const convo = h("div", { class: "jv-convo" });
  let drawn: HisWindow[] = [];
  const turns: Turn[] = [...start];
  let waiting: HTMLElement | null = null;
  const bubble = (who: "you" | "him", text: string) => h("div", { class: `jv-bub ${who}`, text });
  function drawing(q: string): HTMLElement | null {
    const d = drawn.find((w) => w.question.trim() === q.trim());
    if (!d) return null;
    const box = h("div", { class: "jv-bub-draw" });
    if (d.svg) {
      // As an image: nothing in his drawing can run.
      const img = h("img", { alt: "" }) as HTMLImageElement;
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(d.svg)}`;
      box.append(img);
    } else box.append(h("span", { class: "cap", text: d.form }));
    return box;
  }
  function paint() {
    clear(convo);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const shown = turns.filter((x) => x.at >= today.getTime());
    if (!shown.length && !waiting) convo.append(h("p", { class: "jv-convo-empty", text: t("Nothing yet today. Ask him something.") }));
    for (const x of shown) {
      if (x.you) convo.append(bubble("you", x.you));
      const him = bubble("him", x.him);
      const d = drawing(x.you);
      if (d) { him.classList.add("wide"); him.append(d); }
      convo.append(him);
    }
    if (waiting) convo.append(waiting);
    convo.scrollTop = convo.scrollHeight;
  }

  const input = h("input", { class: "q", placeholder: t("Type to JARVIS"), "aria-label": t("Type to JARVIS") }) as HTMLInputElement;
  // His "…" doesn't wait forever (#84): no answer in 45 s, or a failure, says so with Try again.
  let giveUp = 0;
  const failed = (q: string) => {
    window.clearTimeout(giveUp);
    if (!waiting) return;
    const him = h("div", { class: "jv-bub him err" }, document.createTextNode(`${t("I couldn't answer that just now, sir.")} `),
      h("button", { class: "jv-link", text: t("Try again"), onclick: () => ask(q) }));
    waiting = h("div", { class: "jv-waiting" }, bubble("you", q), him);
    paint();
  };
  const ask = (q: string) => {
    heard.textContent = `“${q}”`;
    waiting = h("div", { class: "jv-waiting" }, bubble("you", q), h("div", { class: "jv-bub him typing", text: "…" }));
    paint();
    window.clearTimeout(giveUp);
    giveUp = window.setTimeout(() => failed(q), 45_000);
    void Promise.resolve(Bridge.askSend(q)).catch(() => failed(q));
  };
  const send = () => {
    const q = input.value.trim();
    if (!q) return;
    input.value = "";
    syncAction();
    ask(q);
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
  // The microphone: talk to him (a tap of the talk keys: he listens until you pause, then answers
  // out loud, and the exchange joins the conversation). Pressed again, he stops listening.
  const micIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  micIcon.setAttribute("viewBox", "0 0 24 24");
  micIcon.setAttribute("aria-hidden", "true");
  const micPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  micPath.setAttribute("d", "M12 2a3.5 3.5 0 0 1 3.5 3.5v6a3.5 3.5 0 0 1-7 0v-6A3.5 3.5 0 0 1 12 2zM5.5 10.5a1 1 0 0 1 1 1 5.5 5.5 0 0 0 11 0 1 1 0 1 1 2 0 7.5 7.5 0 0 1-6.5 7.4V21a1 1 0 1 1-2 0v-2.1a7.5 7.5 0 0 1-6.5-7.4 1 1 0 0 1 1-1z");
  micIcon.append(micPath);
  const mic = h("button", { class: "talk", title: t("Talk to JARVIS"), "aria-label": t("Talk to JARVIS"), "aria-pressed": "false" }, micIcon);
  // While there's text, the round button sends it (an arrow); empty, it's the microphone (#84).
  const sendBtn = h("button", { class: "talk send", title: t("Send"), "aria-label": t("Send"), text: "↑", onclick: send });
  const syncAction = () => {
    const typing = input.value.trim() !== "";
    sendBtn.style.display = typing ? "" : "none";
    mic.style.display = typing ? "none" : "";
  };
  input.addEventListener("input", syncAction);
  const listening = (on: boolean) => {
    mic.classList.toggle("on", on);
    mic.setAttribute("aria-pressed", String(on));
    if (on) heard.textContent = t("Listening…");
    // The chip says what the microphone does now (it said "Not listening" while it listened).
    chipText.textContent = on ? t("Listening…") : chip.text;
    chipDot.style.background = on ? "#ff453a" : chip.color;
  };
  mic.addEventListener("click", async () => {
    const was = mic.classList.contains("on");
    if ((await Bridge.voiceTap()) !== "ok") {
      heard.replaceChildren(document.createTextNode(`${t("He can't hear you yet: set up his voice in Settings › Voice.")} `),
        h("button", { class: "jv-link", text: `${t("Open")} ›`, onclick: () => ctx.navigate("voice") }));
      return;
    }
    listening(!was);
    // He stops on his own after a long silence: so does the button, and it says so.
    window.clearTimeout(quietAt);
    if (!was) quietAt = window.setTimeout(() => { if (mic.classList.contains("on")) { listening(false); heard.textContent = t("I didn't hear anything. Press the microphone to try again."); } }, 20_000);
  });
  let quietAt = 0;
  const askBox = h("div", { class: "jv-talkask" }, input, sendBtn, mic);
  syncAction();

  const talkEl = h("div", { class: "jv-talk" });
  const stopFit = fillWindow(talkEl, 420);
  page.append(talkEl);
  talkEl.append(glow,
    h("div", { class: "right" },
      h("div", { class: "top" }, h("p", { class: "jv-atitle", text: "JARVIS" }), h("span", { class: "cap", text: t("Today") })),
      convo, askBox));
  paint();

  // ── Live: the conversation, what he heard, your voice ──
  void Bridge.conversation().then((c) => { if (Array.isArray(c)) { turns.splice(0, turns.length, ...c); paint(); } });
  void Bridge.hisWindows().then((w) => { drawn = w?.last ?? []; paint(); });
  const offs = [
    onEvent<Turn>("jarvis-turn", (x) => { turns.push(x); waiting = null; window.clearTimeout(giveUp); listening(false); paint(); }),
    // What he heard: your bubble, and his "…" until he answers (the pill stays hidden for this).
    onEvent<string>("jarvis-heard", (q) => {
      listening(false);
      heard.textContent = `“${q}”`;
      waiting = h("div", { class: "jv-waiting" }, bubble("you", q), h("div", { class: "jv-bub him typing", text: "…" }));
      paint();
    }),
    onEvent<string>("jarvis-missed", (why) => {
      listening(false);
      heard.textContent = why === "unclear" ? t("I didn't catch that. Try again, a little closer to the microphone.") : idle();
    }),
    onEvent<{ last: HisWindow[] }>("his-windows", (w) => { drawn = w.last ?? []; paint(); }),
    onEvent<number>("voice-level", (level) => {
      const v = Math.max(0, Math.min(1, level));
      bars.forEach((b, i) => { b.style.transform = `scaleY(${(i > 11 ? 6 + v * 8 : 8 + v * (20 + Math.random() * 40)) / 8})`; });
    }),
  ];
  void Bridge.voiceLevelWatch(true);
  ctx.onLeave = () => {
    stopFit();
    window.clearTimeout(quietAt);
    window.clearTimeout(giveUp);
    void Bridge.voiceLevelWatch(false);
    for (const off of offs) void off.then((f) => f());
  };
}
