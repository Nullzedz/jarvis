// JARVIS: the first-launch tutorial (issue #90), from the approved demo
// prototypes/jarvis-tutorial.html (design B, with its motion pass). A window
// over your desktop: the words and his visor below, a practice area above.
// Each step shows one thing he does and lets you try it. Dictation is the real
// thing: the dictation key types into the practice mail like any text box. The
// rest are played out here, since the real keys would act on your own screen.

import "./tutorial.css";
import { Bridge, onEvent } from "../core/bridge";
import { N_, resolveLanguage, setLanguage, systemLanguages, t } from "../i18n/i18n";

type Step = {
  id: string;
  title: string;
  say: string;
  next?: string;
  keys?: () => string;
  task?: string;
  build(p: HTMLElement): void;
  play?(p: HTMLElement, s: Run): void | Promise<void>;
};
/** `onKey`: one of JARVIS's shortcuts pressed or let go; while the tour is up, they come here only (#90). */
type Run = { alive: boolean; cleanup: (() => void)[]; done: () => void; onKey?: (action: string, down: boolean) => void };

const $ = <E extends Element = HTMLElement>(q: string, r: ParentNode = document) => r.querySelector(q) as E;
const $$ = <E extends Element = HTMLElement>(q: string, r: ParentNode = document) => [...r.querySelectorAll(q)] as E[];
const el = (tag: string, cls?: string, html?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jarvis = (small = false) =>
  `<div class="jarvis${small ? " small" : ""}"><div class="halo"></div><div class="halo h2"></div><div class="shell"></div><div class="slot"><div class="eye"></div></div><div class="badge"></div></div>`;
const K = (...ks: string[]) => `<span class="combo">${ks.map((k) => `<kbd>${k}</kbd>`).join(" + ")}</span>`;
const ctrl = () => t("Ctrl"), win = () => t("Win"), shift = () => t("Shift"), alt = () => t("Alt"), rctrl = () => t("Right Ctrl");

/* He says his lines out loud, with a voice of this computer. */
let voice: SpeechSynthesisVoice | null = null;
function pickVoice() {
  const lang = document.documentElement.lang || "en";
  const vs = window.speechSynthesis?.getVoices?.() ?? [];
  voice = vs.find((v) => v.lang.toLowerCase().startsWith(lang.toLowerCase()) && /male|george|ryan|daniel|guy/i.test(v.name))
    ?? vs.find((v) => v.lang.toLowerCase().startsWith(lang.toLowerCase())) ?? null;
}
function speak(text: string) {
  try {
    if (!("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.lang = document.documentElement.lang || "en";
    u.rate = 1.02;
    u.pitch = 0.92;
    speechSynthesis.speak(u);
  } catch { /* no voice: the words are on screen anyway */ }
}

/* Played speech: the example line, word by word, as if you had said it. */
function played(example: string, onText: (f: string) => void, onEnd: (f: string) => void) {
  const words = example.split(" ");
  let n = 0;
  const timer = window.setInterval(() => {
    n++;
    onText(words.slice(0, n).join(" "));
    if (n >= words.length) window.clearInterval(timer);
  }, 140);
  return { stop: () => { window.clearInterval(timer); onEnd(example); } };
}
/* A sound-wave that moves while you hold. */
function wave(host: HTMLElement) {
  host.innerHTML = Array.from({ length: 9 }, () => "<i></i>").join("");
  const bars = [...host.children] as HTMLElement[];
  const timer = window.setInterval(() => bars.forEach((b) => (b.style.height = `${4 + Math.random() * 14}px`)), 90);
  return () => { window.clearInterval(timer); bars.forEach((b) => (b.style.height = "4px")); };
}
/* The on-screen button held down, or the real keys (press / release): start on press, stop on release (once). */
function holdable(button: HTMLElement, { down, up }: { down: () => void; up: () => void }) {
  let held = false;
  const press = (e?: Event) => { if (held) return; held = true; button.classList.add("down"); mood("listen"); down(); e?.preventDefault(); };
  const release = () => { if (!held) return; held = false; button.classList.remove("down"); mood("think", 900); up(); };
  button.addEventListener("pointerdown", press);
  button.addEventListener("pointerup", release);
  button.addEventListener("pointerleave", release);
  return Object.assign(() => release(), { press: () => press(), release });
}

/* The keycaps light while those keys are really held (#90: they flashed on their own as a hint). */
function keysOf(action: string): string[] | null {
  switch (action) {
    case "talk": return [ctrl(), win()];
    case "ask": return [ctrl(), shift(), "Z"];
    case "more": return [shift(), win()];
    case "dictate": return [rctrl()];
    case "toggleIsland": return [ctrl(), alt(), "N"];
    case "goToAlert": return [ctrl(), alt(), "A"];
    case "sleepToggle": return [ctrl(), alt(), "Z"];
    default: return null;
  }
}
function light(action: string, on: boolean) {
  const want = keysOf(action);
  if (!want) return;
  for (const combo of $$("#keys .combo")) {
    const caps = $$("kbd", combo);
    if (caps.length === want.length && caps.every((k, n) => k.textContent === want[n])) caps.forEach((k) => k.classList.toggle("down", on));
  }
}

/* Real speech in a step (#90: it played a ready-made question whatever you said). While the talk
   keys are held JARVIS's own dictation listens; what it heard comes back here, never pasted. */
function realSpeech(s: Run, p: HTMLElement, onWords: (said: string) => void) {
  const pill = $(".flowpill", p);
  let stopWave: (() => void) | null = null, heardAny = false, miss = 0;
  const offPhase = onEvent<{ phase: string }>("pill-state", ({ phase }) => {
    if (phase === "listening" || phase === "locked") {
      heardAny = false;
      window.clearTimeout(miss);
      if (!stopWave) { pill.classList.add("on"); stopWave = wave($(".wave", pill)); mood("listen"); }
    } else {
      if (stopWave) { stopWave(); stopWave = null; pill.classList.remove("on"); }
      if (phase === "thinking") mood("think", 1200);
      // Nothing came back: say so, rather than make something up.
      if (phase === "idle") miss = window.setTimeout(() => { if (!heardAny && s.alive) onWords(""); }, 900);
    }
  });
  const offText = onEvent<string>("flow-dictated", (text) => { heardAny = true; window.clearTimeout(miss); onWords(text.trim()); });
  s.cleanup.push(() => { stopWave?.(); window.clearTimeout(miss); void offPhase.then((f) => f()); void offText.then((f) => f()); });
}

/* Did they say (about) the line to try? Most of its words, in any order (characters for CJK). */
function saidLike(said: string, line: string) {
  const norm = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
  const a = norm(said), b = norm(line);
  if (!a) return false;
  const spaced = /\s/.test(b);
  const parts = (x: string) => (spaced ? x.split(/\s+/) : [...x.replace(/\s+/g, "")]).filter((w) => w.length > (spaced ? 2 : 0));
  const want = parts(b), have = new Set(parts(a));
  return want.length > 0 && want.filter((w) => have.has(w)).length / want.length >= 0.4;
}

/* Tidy dictation: a capital and a full stop, as his model does. */
function tidy(text: string) {
  text = text.replace(/\s+/g, " ").trim();
  if (!text) return "";
  text = text[0].toUpperCase() + text.slice(1);
  return /[.!?。！？]$/.test(text) ? text : `${text}.`;
}

/* ── The island (a small copy of it, for practice) ── */
const TABNAME: Record<string, () => string> = { home: () => t("Home"), reminders: () => t("Reminders"), notes: () => t("Notes"), clipboard: () => t("Clipboard"), agents: () => t("Agents") };
const TABS: Record<string, () => string> = {
  home: () => `<div class="cards"><div class="card"><div class="muted">${t("Next")}</div><div style="font-weight:600;margin-top:2px">${t("13:30 · Lunch with Maya")}</div></div><div class="card"><div class="muted">${t("Focus")}</div><div style="font-weight:600;margin-top:2px">${t("25:00 · Deep work")}</div></div></div>`,
  reminders: () => `<div class="card">${[t("Call the bank"), t("Buy milk"), t("Send the report to Maya")].map((r) => `<div class="li"><span class="ck"></span>${r}</div>`).join("")}</div>`,
  notes: () => `<div class="card"><div style="font-weight:600;margin-bottom:4px">${t("Ideas")}</div><div class="muted">${t("Try the new focus timer · Ask JARVIS about the Q3 numbers")}</div></div>`,
  clipboard: () => `<div class="card"><div class="li">https://example.com/invoice/2291</div><div class="li">${t("Hi Sam, I'm running ten minutes late, see you at three.")}</div><div class="li">+32 470 12 34 56</div></div>`,
};
function island() {
  return `<div class="isl"><div class="closed">${jarvis(true)}</div><div class="open"><div class="tabs">
    <button class="tab on" data-t="home" title="${t("Home")}">⌂</button><button class="tab" data-t="reminders" title="${t("Reminders")}">✓</button><button class="tab" data-t="notes" title="${t("Notes")}">✎</button><button class="tab" data-t="clipboard" title="${t("Clipboard")}">⧉</button><span class="sp"></span><span class="lbl"></span></div><div class="body"></div></div></div>`;
}
function islandShow(isl: HTMLElement, tab: string, html: string) {
  const body = $(".body", isl);
  body.innerHTML = html;
  $$(".tab", isl).forEach((b) => b.classList.toggle("on", b.dataset.t === tab));
  $(".lbl", isl).textContent = TABNAME[tab]?.() ?? "";
  isl.classList.add("big");
  requestAnimationFrame(() => {
    const h = 12 + 32 + 12 + body.offsetHeight + 16;
    isl.style.height = `${h}px`;
    makeRoom(isl, h);
  });
}
function islandClose(isl: HTMLElement) {
  isl.classList.remove("big");
  isl.style.height = "";
  makeRoom(isl, 34);
}
/* The open island never covers what's under it: the practice window moves down out of its way. */
function makeRoom(isl: HTMLElement, h: number) {
  const pr = isl.parentElement?.querySelector<HTMLElement>(".practice");
  const box = pr?.querySelector<HTMLElement>(".win");
  if (!pr || !box) return;
  // Measured from the layout, not the screen, so a move still under way doesn't count.
  const need = h + 16 - (pr.offsetTop + box.offsetTop);
  pr.style.transform = need > 0 ? `translateY(${need}px)` : "";
}

/* ── His pointer: to the thing, round it; with a card, the card drawn out and his icon docked in it ── */
type Box = { x: number; y: number; w: number; h: number };
const rel = (p: HTMLElement, e: Element): Box => {
  const a = p.getBoundingClientRect(), b = e.getBoundingClientRect();
  return { x: b.left - a.left, y: b.top - a.top, w: b.width, h: b.height };
};
async function ringAt(p: HTMLElement, target: Element, rest = true) {
  mood("think", 1100);
  const ptr = $(".ptr", p), ink = $(".ink", p), r = rel(p, target);
  ptr.style.transition = "none";
  ptr.style.left = `${p.clientWidth / 2}px`;
  ptr.style.top = `${p.clientHeight - 60}px`;
  ptr.style.opacity = "1";
  await sleep(30);
  ptr.style.transition = "";
  ptr.style.left = `${r.x + r.w / 2 - 15}px`;
  ptr.style.top = `${r.y - 26}px`;
  await sleep(380);
  const e = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
  const attrs: Record<string, string | number> = { cx: r.x + r.w / 2, cy: r.y + r.h / 2, rx: r.w / 2 + 12, ry: r.h / 2 + 10, fill: "none", stroke: "#4fa3ff", "stroke-width": 2.5, pathLength: 1, "stroke-dasharray": 1, "stroke-dashoffset": 1 };
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  e.style.filter = "drop-shadow(0 0 4px rgba(79,163,255,.8))";
  ink.append(e);
  e.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 500, fill: "forwards", easing: "ease-in-out" });
  await sleep(520);
  // "Where is…?": he waits beside it while you look. With a card he goes on to draw it.
  if (rest) {
    ptr.style.left = `${r.x - 34}px`;
    ptr.style.top = `${r.y + r.h + 6}px`;
    window.setTimeout(() => (ptr.style.opacity = "0"), 3000);
  }
  window.setTimeout(() => e.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 500, fill: "forwards" }), 3000);
  return r;
}
/* Where his card goes: beside the thing, never on it nor his ring, never off the window (as place.ts). */
function spotFor(p: HTMLElement, r: Box, w: number, h: number) {
  const W = p.clientWidth, H = p.clientHeight, E = 12, G = 34;
  const clampY = (y: number) => Math.max(E, Math.min(y, H - h - E)), clampX = (x: number) => Math.max(E, Math.min(x, W - w - E));
  const tries = [
    { x: r.x + r.w + G, y: clampY(r.y), room: W - (r.x + r.w) - G - E >= w },
    { x: r.x - G - w, y: clampY(r.y), room: r.x - G - E >= w },
    { x: clampX(r.x + r.w / 2 - w / 2), y: r.y + r.h + G, room: H - (r.y + r.h) - G - E >= h },
    { x: clampX(r.x + r.w / 2 - w / 2), y: r.y - G - h, room: r.y - G - E >= h },
  ];
  return tries.find((s) => s.room) ?? null;
}
/* No room beside it: the practice window slides aside first. */
async function roomFor(p: HTMLElement, target: HTMLElement, w: number, h: number) {
  let r = rel(p, target);
  const at = spotFor(p, r, w, h);
  if (at) return at;
  const pr = target.closest<HTMLElement>(".practice")!;
  const need = r.x + r.w + 34 + w + 12 - p.clientWidth;
  pr.style.transform = `translateX(${-Math.min(need, r.x - 12)}px)`;
  await sleep(560);
  r = rel(p, target);
  return spotFor(p, r, w, h) ?? { x: Math.max(12, p.clientWidth - w - 12), y: Math.max(12, r.y) };
}
async function explain(p: HTMLElement, target: HTMLElement, card: HTMLElement, line: string) {
  const w = card.offsetWidth, h = card.offsetHeight;
  const at = await roomFor(p, target, w, h);
  await ringAt(p, target, false);
  const ptr = $(".ptr", p);
  card.style.left = `${at.x}px`;
  card.style.top = `${at.y}px`;
  ptr.style.left = `${at.x - 15}px`;
  ptr.style.top = `${at.y - 10}px`;
  await sleep(260);
  card.classList.add("on");
  card.animate([{ clipPath: "inset(0 100% 100% 0 round 10px)" }, { clipPath: "inset(0 0 0 0 round 10px)" }], { duration: 650, easing: "cubic-bezier(.4,.1,.2,1)", fill: "backwards" });
  ptr.style.transition = "left .65s cubic-bezier(.4,.1,.2,1), top .65s cubic-bezier(.4,.1,.2,1), opacity .2s";
  ptr.style.left = `${at.x + w - 15}px`;
  ptr.style.top = `${at.y + h - 10}px`;
  await sleep(660);
  const dock = $(".dock", card), s = rel(p, dock);
  ptr.style.transition = "left .3s cubic-bezier(.4,.1,.2,1), top .3s cubic-bezier(.4,.1,.2,1), opacity .2s";
  ptr.style.left = `${s.x}px`;
  ptr.style.top = `${s.y}px`;
  await sleep(310);
  ptr.style.transition = "";
  ptr.style.opacity = "0";
  dock.classList.add("home");
  dock.innerHTML = jarvis(true);
  $(".bd", card).animate([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], { duration: 400, easing: "ease-out" });
  speak(line);
}

const days = () => Array.from({ length: 7 }, (_, k) => new Date(2024, 0, 1 + k).toLocaleDateString(document.documentElement.lang || undefined, { weekday: "short" }));

/* ── The steps ── */
const STEPS: Step[] = [
  {
    id: "welcome",
    title: N_("Good evening, sir. I'm JARVIS."),
    say: N_("I live at the top of your screen, I listen when you hold a key, and I can see what you show me. Let me show you around: it takes about three minutes."),
    next: N_("Show me"),
    build(p) {
      p.innerHTML = `<div class="practice"><div class="boot">${jarvis()}<div class="hello"></div></div></div>`;
    },
    async play(p, s) {
      const boot = $(".boot", p), hello = $(".hello", p);
      boot.classList.remove("go");
      void boot.offsetWidth;
      boot.classList.add("go");
      await sleep(1900);
      if (!s.alive) return;
      const line = t("Systems online. Good to meet you, sir.");
      hello.innerHTML = line.split(" ").map((w, k) => `<span class="w" style="animation-delay:${k * 90}ms">${w} </span>`).join("");
      mood("happy");
      speak(line);
    },
  },
  {
    id: "dictate",
    title: N_("Speak, and I'll type."),
    say: N_("Hold the dictation key, say it, let go. Your words appear wherever your cursor is: any app, any text box. I take out the ums and fix the punctuation."),
    keys: () => t("Hold {keys}", { keys: K(rctrl()) }),
    task: N_("Click into the email, then hold <b>Right Ctrl</b> and say: <b>“Hi Sam, I'm running ten minutes late, see you at three.”</b>"),
    build(p) {
      p.innerHTML = `<div class="practice"><div class="win mail">
          <div class="bar"><i></i><i></i><i></i><b>${t("New message")}</b></div>
          <div class="row"><span>${t("To")}</span>sam@example.com</div>
          <div class="row"><span>${t("Subject")}</span>${t("Running late")}</div>
          <textarea class="body" spellcheck="false" aria-label="${t("Message")}"></textarea>
          <div class="foot"><button class="send">${t("Send")}</button><span style="font-size:12px;color:#86868b">${t("Send it when it's written")}</span></div>
        </div></div>
        <div class="flowpill"><div class="wave"></div>${t("Listening…")}</div>
        <div class="under"><button class="hold"><span class="dot"></span>${t("No microphone? Hold here")}</button></div>`;
    },
    play(p, s) {
      const area = $<HTMLTextAreaElement>("textarea", p), pill = $(".flowpill", p), send = $<HTMLButtonElement>(".send", p), mail = $(".mail", p);
      area.focus();
      send.disabled = true;
      const check = () => {
        if (area.value.trim().split(/\s+/).length >= 3) {
          s.done();
          send.disabled = false;
        }
      };
      // The real dictation types here like in any text box.
      area.addEventListener("input", check);
      // While the real key is held: the same "Listening…" and his visor listening (#90: nothing showed).
      let realWave: (() => void) | null = null;
      const offPhase = onEvent<{ phase: string }>("pill-state", ({ phase }) => {
        if (phase === "listening" || phase === "locked") {
          if (!realWave) { pill.classList.add("on"); realWave = wave($(".wave", pill)); mood("listen"); light("dictate", true); }
        } else {
          if (realWave) { realWave(); realWave = null; pill.classList.remove("on"); light("dictate", false); }
          if (phase === "thinking") mood("think", 1200);
        }
      });
      // What it wrote: if another window was in front and got it, it's put here too.
      const offText = onEvent<string>("flow-dictated", (text) => window.setTimeout(() => {
        const said = text.trim();
        if (said && !area.value.includes(said.slice(0, 16))) area.value = area.value ? `${area.value.trimEnd()} ${said}` : said;
        check();
      }, 450));
      s.cleanup.push(() => { realWave?.(); void offPhase.then((f) => f()); void offText.then((f) => f()); });
      send.onclick = async () => {
        mail.classList.add("sent");
        await sleep(650);
        const toast = el("div", "toast", `✓ ${t("Sent to Sam")}`);
        $(".practice", p).append(toast);
        requestAnimationFrame(() => toast.classList.add("on"));
        mood("happy");
      };
      // Without a microphone: the button plays the line in.
      let session: { stop(): void } | null = null, stopWave: (() => void) | null = null;
      s.cleanup.push(holdable($(".hold", p), {
        down: () => {
          pill.classList.add("on");
          stopWave = wave($(".wave", pill));
          const before = area.value ? `${area.value.trimEnd()} ` : "";
          session = played(t("Hi Sam, I'm running ten minutes late, see you at three."), (f) => (area.value = before + f), (f) => {
            area.value = before + tidy(f);
            check();
          });
        },
        up: () => { pill.classList.remove("on"); stopWave?.(); session?.stop(); },
      }));
    },
  },
  {
    id: "talk",
    title: N_("Talk to me."),
    say: N_("Hold the talk keys and ask me anything: your day, your mail, a quick sum, a note to remember. I answer out loud, and the island shows it."),
    keys: () => t("Hold {keys}", { keys: K(ctrl(), win()) }),
    task: N_("Hold <b>Ctrl + Win</b> and ask: <b>“What's on my calendar today?”</b>"),
    build(p) {
      p.innerHTML = `<div class="practice"></div>${island()}
        <div class="flowpill"><div class="wave"></div>${t("Listening…")}</div>
        <div class="under"><button class="hold"><span class="dot"></span>${t("No microphone? Hold here")}</button><span class="heard"></span></div>`;
    },
    play(p, s) {
      const isl = $(".isl", p), pill = $(".flowpill", p), heard = $(".heard", p);
      const line = t("What's on my calendar today?");
      // What you said, as you said it; the calendar if that's what you asked.
      const hear = (said: string) => {
        if (!said) { heard.textContent = t("I didn't catch that. Hold the keys while you speak."); return; }
        heard.textContent = `“${said}”`;
        if (saidLike(said, line)) void answer();
        else heard.textContent = t("I heard “{said}”. In the tour, try: “{try}”", { said, try: line });
      };
      realSpeech(s, p, hear);
      // Without a microphone, the button plays the line in.
      let session: { stop(): void } | null = null, stopWave: (() => void) | null = null;
      const hold = holdable($(".hold", p), {
        down: () => {
          pill.classList.add("on");
          stopWave = wave($(".wave", pill));
          heard.textContent = "";
          session = played(line, (f) => (heard.textContent = `“${f}”`), () => void answer());
        },
        up: () => { pill.classList.remove("on"); stopWave?.(); session?.stop(); },
      });
      s.cleanup.push(hold);
      async function answer() {
        islandShow(isl, "home", `<div class="card"><div class="muted" style="margin-bottom:6px">${t("Today")}</div>
          ${[t("10:00 · Stand-up"), t("13:30 · Lunch with Maya"), t("16:00 · Dentist")].map((x) => `<div class="li"><span class="ck"></span>${x}</div>`).join("")}</div>`);
        speak(t("Three things today, sir: stand-up at ten, lunch with Maya at half one, and the dentist at four."));
        await sleep(900);
        s.done();
      }
    },
  },
  {
    id: "ask",
    title: N_("Ask about what's on your screen."),
    say: N_("Press the ask keys and a box opens at your cursor. I look at what's under it and explain, in a card beside it, never on top of it."),
    keys: () => K(ctrl(), shift(), "Z"),
    task: N_("Press <b>Ctrl + Shift + Z</b> (or click the chart), then ask <b>“What does this chart show?”</b>"),
    build(p) {
      const d = days();
      p.innerHTML = `<div class="practice"><div class="win chartwin" style="width:min(460px,100%)">
          <div class="bar"><i></i><i></i><i></i><b>${t("Visitors · last 7 days")}</b></div>
          <div class="chart"><i style="height:60%"></i><i style="height:72%"></i><i style="height:68%"></i><i style="height:80%"></i><i style="height:76%"></i><i class="lo" style="height:30%"></i><i class="lo" style="height:26%"></i></div>
          <div class="axis">${d.map((x) => `<span>${x}</span>`).join("")}</div>
        </div></div>
        <div class="askbox"><input placeholder="${t("Ask about this…")}" value=""><button class="go">↑</button></div>
        <svg class="ink"></svg><div class="ptr">${jarvis(true)}</div>
        <div class="ex"><div class="hd"><span class="dock"></span><b>${t("What does this chart show?")}</b></div><div class="bd">${t("Visitors per day. Weekdays hold steady near 75%; the weekend drops by more than half.")}<div style="margin-top:8px"><div class="st"><i>1</i>${t("Mon–Fri: steady")}</div><div class="st"><i>2</i>${t("Sat–Sun: the dip")}</div><div class="st"><i>3</i>${t("Normal for an office app")}</div></div></div></div>
        <div class="under"><div class="chips"><button class="chip">${t("What does this chart show?")}</button></div></div>`;
    },
    play(p, s) {
      const box = $(".askbox", p), input = $<HTMLInputElement>("input", box), chart = $(".chartwin", p);
      let asked = false;
      const open = () => {
        const r = rel(p, chart);
        box.style.left = `${r.x + 40}px`;
        box.style.top = `${r.y + 70}px`;
        box.classList.add("on");
        input.focus();
      };
      chart.addEventListener("click", open);
      // The real ask keys open the tour's box, and only it (#90: JARVIS's own opened too).
      s.onKey = (action, down) => { if (action === "ask" && down && !asked) open(); };
      const go = () => {
        if (asked) return;
        asked = true;
        if (!input.value.trim()) input.value = t("What does this chart show?");
        box.classList.remove("on");
        void explain(p, chart, $(".ex", p), t("Visitors per day: steady on weekdays, half on the weekend.")).then(() => s.done());
      };
      $(".go", box).onclick = go;
      input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) go(); });
      $(".chip", p).onclick = () => { open(); input.value = t("What does this chart show?"); window.setTimeout(go, 500); };
    },
  },
  {
    id: "where",
    title: N_("Lost something? Ask where it is."),
    say: N_("When you ask where something is, I don't open anything: I fly to it, circle it, and tell you."),
    keys: () => t("Hold {keys}", { keys: K(ctrl(), win()) }),
    task: N_("Ask: <b>“Where's the export button?”</b>"),
    build(p) {
      p.innerHTML = `<div class="practice"><div class="win docwin">
          <div class="bar"><i></i><i></i><i></i><b>${t("Report")}</b></div>
          <div class="toolbar"><span>${t("File")}</span><span>${t("Edit")}</span><span>${t("Insert")}</span><span>${t("Share")}</span><span class="exp">${t("Export")}</span></div>
          <div class="doc"><i style="width:80%"></i><i></i><i style="width:92%"></i><i style="width:60%"></i><i></i><i style="width:85%"></i><i style="width:70%"></i></div>
        </div></div>
        <svg class="ink"></svg><div class="ptr">${jarvis(true)}</div><div class="spoken">${t("Top right, next to Share.")}</div>
        <div class="flowpill"><div class="wave"></div>${t("Listening…")}</div>
        <div class="under"><button class="hold"><span class="dot"></span>${t("No microphone? Hold here")}</button><span class="heard"></span></div>`;
    },
    play(p, s) {
      let ran = false;
      const run = async () => {
        if (ran) return;
        ran = true;
        const target = $(".exp", p);
        await ringAt(p, target);
        const sp = $(".spoken", p), r = rel(p, target);
        sp.style.left = `${Math.max(12, r.x - 120)}px`;
        sp.style.top = `${r.y + r.h + 22}px`;
        sp.classList.add("on");
        speak(t("Top right, next to Share."));
        await sleep(2600);
        sp.classList.remove("on");
        s.done();
      };
      const line = t("Where's the export button?"), heard = $(".heard", p);
      realSpeech(s, p, (said) => {
        if (!said) { heard.textContent = t("I didn't catch that. Hold the keys while you speak."); return; }
        heard.textContent = `“${said}”`;
        if (saidLike(said, line)) void run();
        else heard.textContent = t("I heard “{said}”. In the tour, try: “{try}”", { said, try: line });
      });
      let session: { stop(): void } | null = null;
      const hold = holdable($(".hold", p), { down: () => (session = played(line, () => {}, () => void run())), up: () => session?.stop() });
      s.cleanup.push(hold);
    },
  },
  {
    id: "circle",
    title: N_("Circle it to show me."),
    say: N_("Hold the keys and draw a circle round anything with your mouse: a picture, an error, a part of a page. Then ask about it."),
    keys: () => t("Hold {keys} and circle", { keys: K(shift(), win()) }),
    task: N_("Hold <b>Shift + Win</b> and move your mouse round <b>one of the devices</b>, then let go."),
    build(p) {
      p.innerHTML = `<div class="practice"><div class="win dark photowin" style="width:min(520px,100%)">
          <div class="bar"><i></i><i></i><i></i><b>${t("Network")}</b></div>
          <div class="photo"><div class="gadget" data-g="router" style="left:12%;top:38%;width:96px;height:52px">${t("Router")}</div><div class="gadget" data-g="laptop" style="left:44%;top:22%;width:86px;height:46px">${t("Laptop")}</div><div class="gadget" data-g="printer" style="left:70%;top:52%;width:84px;height:46px">${t("Printer")}</div></div>
        </div></div>
        <svg class="ink"><path class="trail" fill="none" stroke="#4fa3ff" stroke-width="1.8" stroke-dasharray="5 4" stroke-linecap="round"/></svg>
        <div class="ptr">${jarvis(true)}</div>
        <div class="ex"><div class="hd"><span class="dock"></span><b></b></div><div class="bd"></div></div>
        <div class="under"><span>${t("Hold Shift + Win, then move the mouse round it: no clicking.")}</span></div>`;
    },
    play(p, s) {
      const path = $(".trail", p);
      let pts: [number, number][] | null = null, used = false, last: [number, number] | null = null;
      const at = (e: PointerEvent): [number, number] => { const r = p.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
      // The pointer is followed only while Shift + Win is held, as in the app (#90: a plain drag drew).
      const move = (e: PointerEvent) => {
        last = at(e);
        if (!pts) return;
        pts.push(last);
        path.setAttribute("d", `M${pts.map((q) => q.join(" ")).join("L")}`);
      };
      p.addEventListener("pointermove", move);
      s.onKey = (action, down) => {
        if (action !== "more" || used) return;
        if (down) {
          pts = last ? [last] : [];
          path.setAttribute("fill", "none");
          mood("listen");
        } else void finish();
      };
      const finish = async () => {
        if (!pts) return;
        const done = pts;
        pts = null;
        const len = done.reduce((n, q, k) => (k ? n + Math.hypot(q[0] - done[k - 1][0], q[1] - done[k - 1][1]) : 0), 0);
        const end = done[done.length - 1];
        if (done.length < 3 || len < 120 || Math.hypot(done[0][0] - end[0], done[0][1] - end[1]) > 40) {
          const a = path.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400 });
          a.onfinish = () => path.setAttribute("d", "");
          return;
        }
        used = true;
        path.setAttribute("d", `${path.getAttribute("d")}Z`);
        path.setAttribute("fill", "rgba(79,163,255,.10)");
        // What did they circle? The device nearest the loop's middle.
        const cx = done.reduce((n, q) => n + q[0], 0) / done.length, cy = done.reduce((n, q) => n + q[1], 0) / done.length;
        const pick = $$(".gadget", p)
          .map((d) => ({ d, r: rel(p, d) }))
          .sort((a, b) => Math.hypot(a.r.x + a.r.w / 2 - cx, a.r.y + a.r.h / 2 - cy) - Math.hypot(b.r.x + b.r.w / 2 - cx, b.r.y + b.r.h / 2 - cy))[0];
        const g = pick.d.dataset.g!;
        const q = { router: t("What's this router?"), laptop: t("What's this laptop?"), printer: t("What's this printer?") }[g]!;
        const about = { router: t("Your router: everything else reaches the internet through it."), laptop: t("Your laptop, joined to the router over Wi-Fi."), printer: t("The printer, on the same network, so the laptop can print to it.") }[g]!;
        const card = $(".ex", p);
        $(".hd b", card).textContent = q;
        $(".bd", card).textContent = about;
        await explain(p, pick.d, card, about);
        window.setTimeout(() => path.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: "forwards" }), 1500);
        s.done();
      };
    },
  },
  {
    id: "island",
    title: N_("The island: everything, one move away."),
    say: N_("That black pill at the top of your screen is me. Hover it and I open: your day, reminders, notes, clipboard, music and focus. Move away and I tuck back in."),
    keys: () => t("Hover the top of the screen · {keys}", { keys: K(ctrl(), alt(), "N") }),
    task: N_("Hover the island, then open <b>Reminders</b> and tick one off."),
    build(p) {
      p.innerHTML = `<div class="practice"></div>${island()}`;
    },
    play(p, s) {
      const isl = $(".isl", p);
      let leave = 0;
      isl.addEventListener("mouseenter", () => { window.clearTimeout(leave); if (!isl.classList.contains("big")) islandShow(isl, "home", TABS.home()); });
      isl.addEventListener("mouseleave", () => { leave = window.setTimeout(() => islandClose(isl), 1600); });
      s.onKey = (action, down) => {
        if (action === "toggleIsland" && down) (isl.classList.contains("big") ? islandClose(isl) : islandShow(isl, "home", TABS.home()));
      };
      isl.addEventListener("click", (e) => {
        const target = e.target as HTMLElement;
        const tab = target.closest<HTMLElement>(".tab");
        if (tab) islandShow(isl, tab.dataset.t!, TABS[tab.dataset.t!]());
        const ck = target.closest<HTMLElement>(".ck");
        if (ck) {
          ck.classList.add("on");
          window.setTimeout(() => ck.classList.remove("on"), 300);
          Object.assign(ck.style, { background: "#30d158", borderColor: "#30d158" });
          Object.assign(ck.parentElement!.style, { color: "#8e8e93", textDecoration: "line-through" });
          s.done();
        }
      });
    },
  },
  {
    id: "agents",
    title: N_("Your coding agents, kept in check."),
    say: N_("When Claude Code or Codex wants to run something, I ask you first, right in the island: allow it, deny it, or answer in the terminal. You'll hear when they finish."),
    keys: () => t("{keys} jumps to what's waiting", { keys: K(ctrl(), alt(), "A") }),
    task: N_("Claude Code is asking to run the tests. <b>Allow</b> it."),
    build(p) {
      p.innerHTML = `<div class="practice"><div class="win dark" style="width:min(520px,100%)"><div class="bar"><i></i><i></i><i></i><b>${t("Terminal")} · my-app</b></div>
        <div class="term" style="padding:14px 16px;font:12.5px/1.6 var(--mono);color:#aeb4bd;min-height:150px">› claude<br>I'll run the tests to check the fix.<br><span class="wait" style="color:#ffb340">${t("Waiting for permission…")}</span></div></div></div>${island()}`;
    },
    play(p, s) {
      const isl = $(".isl", p), term = $(".term", p);
      const timer = window.setTimeout(() => {
        islandShow(isl, "agents", `<div class="card agent">${jarvis(true)}<div class="what"><div style="font-weight:600;margin-bottom:3px">${t("Claude Code wants to run")}</div><code>npm test</code></div><div class="acts"><button class="deny">${t("Deny")}</button><button class="allow">${t("Allow")}</button></div></div>`);
        speak(t("Claude Code would like to run the tests, sir."));
        $(".allow", isl).onclick = async () => {
          $(".acts", isl).innerHTML = `<span class="muted">${t("Running…")}</span>`;
          $(".wait", term).outerHTML = "$ npm test<br>…";
          await sleep(1400);
          term.insertAdjacentHTML("beforeend", `<br><span style="color:#30d158">✓ 42 tests passed</span>`);
          $(".acts", isl).innerHTML = `<span style="color:#30d158">✓ ${t("Tests passed")}</span>`;
          speak(t("The tests passed."));
          s.done();
        };
        $(".deny", isl).onclick = () => { $(".acts", isl).innerHTML = `<span class="muted">${t("Denied")}</span>`; s.done(); };
      }, 600);
      s.cleanup.push(() => window.clearTimeout(timer));
    },
  },
  {
    id: "done",
    title: N_("You're all set, sir."),
    say: N_("That's the tour. Everything here is in Settings when you want it, and you can run this again from Settings › General. The keys, once more:"),
    next: N_("Start using JARVIS"),
    build(p) {
      const row = (what: string, keys: string) => `<div><span>${what}</span>${keys}</div>`;
      p.innerHTML = `<div class="practice" style="flex-direction:column;gap:22px">${jarvis()}<div class="cheat">
        ${row(t("Dictate anywhere"), K(rctrl()))}
        ${row(t("Talk to JARVIS"), K(ctrl(), win()))}
        ${row(t("Ask about the screen"), K(ctrl(), shift(), "Z"))}
        ${row(t("Circle to show him"), K(shift(), win()))}
        ${row(t("Open the island"), K(ctrl(), alt(), "N"))}
        ${row(t("Put him to sleep"), K(ctrl(), alt(), "Z"))}
      </div></div>`;
    },
    play(p) {
      $(".practice", p).classList.add("boot", "go");
      mood("happy");
      speak(t("You're all set, sir. I'll be at the top of your screen."));
    },
  },
];

/* ── The narrator: his visor beside the words ── */
const nar = $("#narrator");
let moodT = 0;
function mood(m: "blink" | "listen" | "think" | "happy", ms?: number) {
  window.clearTimeout(moodT);
  nar.classList.remove("blink", "listen", "think", "happy");
  void nar.offsetWidth;
  nar.classList.add(m);
  if (m === "blink") moodT = window.setTimeout(() => nar.classList.remove("blink"), 260);
  if (m === "happy") moodT = window.setTimeout(() => nar.classList.remove("happy"), 2400);
  if (m === "think") moodT = window.setTimeout(() => nar.classList.remove("think"), ms ?? 1200);
}

/* ── The tour ── */
let i = 0;
let current: Run = { alive: false, cleanup: [], done: () => {} };
const stage = $("#stage");
const panes = STEPS.map((st) => {
  const p = el("div", `pane p-${st.id}`);
  stage.append(p);
  return p;
});

function label(text: string) {
  const l = $("#next .lbl");
  if (l.textContent === text) return;
  l.classList.remove("swap");
  void l.offsetWidth;
  l.classList.add("swap");
  window.setTimeout(() => (l.textContent = text), 140);
}

function go(n: number) {
  current.alive = false;
  current.cleanup.forEach((f) => f());
  try { speechSynthesis.cancel(); } catch { /* none */ }
  const from = i;
  i = Math.max(0, Math.min(STEPS.length - 1, n));
  const st = STEPS[i], p = panes[i];
  // Slide the way you're going.
  const fwd = i >= from;
  panes.forEach((x, k) => {
    x.classList.toggle("left", k < i);
    x.style.setProperty("--from", k > i || fwd ? "48px" : "-48px");
    x.classList.toggle("on", k === i);
  });
  st.build(p);
  ["#stepN", "#title", "#say", "#keys", "#task"].forEach((q, k) => {
    const e = $(q);
    e.classList.remove("in");
    void e.offsetWidth;
    e.style.animationDelay = `${120 + k * 70}ms`;
    e.classList.add("in");
  });
  mood("blink");
  const last = STEPS.length - 1;
  $("#stepN").textContent = i === 0 || i === last ? "" : t("Step {n} of {total}", { n: i, total: last - 1 });
  $("#title").textContent = t(st.title);
  $("#say").textContent = t(st.say);
  $("#keys").innerHTML = st.keys ? st.keys() : "";
  $("#keys").hidden = !st.keys;
  const task = $("#task");
  task.hidden = !st.task;
  task.classList.remove("ok");
  $("#taskText").innerHTML = st.task ? t(st.task) : "";
  $("#back").style.visibility = i === 0 ? "hidden" : "visible";
  label(st.next ? t(st.next) : st.task ? t("Skip") : t("Next"));
  $$("#dots i").forEach((d, k) => (d.className = k === i ? "on" : k < i ? "past" : ""));
  const run: Run = {
    alive: true,
    cleanup: [],
    done: () => {
      if (!run.alive || task.classList.contains("ok")) return;
      task.classList.add("ok");
      mood("happy");
      label(t("Next"));
      const nb = $("#next");
      nb.classList.remove("nudge");
      void nb.offsetWidth;
      nb.classList.add("nudge");
    },
  };
  current = run;
  window.setTimeout(() => run.alive && void st.play?.(p, run), 380);
}

async function main() {
  const boot = await Bridge.boot();
  setLanguage(resolveLanguage(boot?.settings.language, systemLanguages()));
  if ("speechSynthesis" in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  $("#back").textContent = t("Back");
  $("#taskDone").append(t("Nicely done."));
  $("#skipAll").textContent = t("Skip the tour");
  $("#dots").innerHTML = STEPS.map(() => "<i></i>").join("");
  // The last step's button, or skipping, ends the tour; it isn't shown on its own again.
  $("#next").onclick = () => (i === STEPS.length - 1 ? void Bridge.tutorialClose() : go(i + 1));
  $("#back").onclick = () => go(i - 1);
  $("#skipAll").onclick = () => void Bridge.tutorialClose();
  addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement).closest?.("input,textarea")) return;
    if (e.key === "ArrowRight" && !e.ctrlKey) go(i + 1);
    if (e.key === "ArrowLeft" && !e.ctrlKey) go(i - 1);
    if (e.key === "Escape") void Bridge.tutorialClose();
  });
  // He blinks now and then, and his eye follows your mouse when he isn't busy.
  const idle = () => window.setTimeout(() => { if (!/listen|think|happy/.test(nar.className)) mood("blink"); idle(); }, 2800 + Math.random() * 2600);
  idle();
  addEventListener("pointermove", (e) => {
    if (!/listen|think/.test(nar.className)) $(".eye", nar).style.transform = `translateX(${(e.clientX / innerWidth - 0.5) * 70}%)`;
  });
  // Keys typed in this window go to JARVIS from here (#90: his key watch didn't always get them).
  const held = new Set<string>();
  addEventListener("keydown", (e) => {
    if (e.repeat || held.has(e.code)) return;
    held.add(e.code);
    void Bridge.tutorialKey(e.code, true);
  }, true);
  addEventListener("keyup", (e) => {
    held.delete(e.code);
    void Bridge.tutorialKey(e.code, false);
  }, true);
  // Leaving the window lets go of everything held.
  addEventListener("blur", () => { held.forEach((c) => void Bridge.tutorialKey(c, false)); held.clear(); });
  // JARVIS's shortcuts, while the tour is up: they light their keycaps and act here only (#90).
  void onEvent<{ action: string; down: boolean }>("tutorial-key", ({ action, down }) => {
    light(action, down);
    // A one-press shortcut (the island's) lights for a moment.
    if (down && !["talk", "ask", "more"].includes(action)) window.setTimeout(() => light(action, false), 350);
    current.onKey?.(action, down);
  });
  go(0);
}

void main();
