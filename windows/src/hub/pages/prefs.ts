// JARVIS: Settings (#70), the demo's layout (prototypes/jarvis-home.html, Settings: groups on the
// left, one row per setting with its control on the right), holding every setting of the old
// pages. The bigger ones (lists, pairing, keys) open as their own page with ‹ Settings (design B,
// prototypes/jarvis-settings-rows.html). The old pages' own code draws each part, so nothing is
// lost; here each part is put in its group and its rows are laid out as the demo's.

import { h, clear } from "../../views/dom";
import { t } from "../../i18n/i18n";
import { Bridge } from "../../core/bridge";
import type { HubContext, PageId } from "../shell";
import { voicePage } from "./voice";
import { flowSettingsPage } from "./flowsettings";

/** An old settings section (section > h2, .row with a label and its controls, .hint under it) as the demo's rows. */
export function demoRows(section: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  const kids = [...section.children] as HTMLElement[];
  let heading = "";
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    if (k.tagName === "H2") { heading = (k.textContent ?? "").trim(); continue; }
    if (!k.classList.contains("row")) { out.push(k); continue; }
    // #84: an empty <label> (a spacer the old rows use) is no name: the row folds into the one above.
    const labelEl = k.querySelector<HTMLElement>(":scope > label");
    const name = labelEl && (labelEl.textContent ?? "").trim() ? labelEl : null;
    const next = kids[i + 1];
    const hint = next?.classList.contains("hint") ? next : null;
    if (hint) i++;
    const prev = out[out.length - 1];
    // A row with no name (a button, a note) belongs to the setting above it: one setting, one row.
    if (!name && prev?.classList.contains("srow") && !prev.classList.contains("bare")) {
      prev.querySelector(":scope > .ctl")?.append(h("div", { class: "line" }, ...([...k.childNodes] as Node[])));
      if (hint) prev.querySelector(":scope > .lbl")?.append(h("span", { text: hint.textContent ?? "" }));
      continue;
    }
    const lbl = h("div", { class: "lbl" });
    if (name) {
      const said = (name.textContent ?? "").trim();
      lbl.append(h("b", { text: heading && said === t("API key") ? `${heading} ${said}` : said }));
      name.remove();
    }
    if (hint) lbl.append(h("span", { text: hint.textContent ?? "" }));
    const ctl = h("div", { class: "ctl" }, ...([...k.childNodes] as Node[]));
    const r = h("div", { class: `srow${name ? "" : " bare"}` }, lbl, ctl);
    if (k.dataset.anchor) r.dataset.anchor = k.dataset.anchor;
    out.push(r);
  }
  // Notes that sat beside a control read as the setting's description, under its name.
  for (const r of out) {
    const lbl = r.querySelector(":scope > .lbl");
    if (!lbl || r.classList.contains("bare")) continue;
    // Moved, not copied: a note that updates itself (the update status) keeps doing so.
    for (const note of r.querySelectorAll<HTMLElement>(":scope > .ctl .hint")) lbl.append(note);
  }
  return out;
}

const nameOf = (r: HTMLElement) => r.querySelector(":scope > .lbl > b")?.textContent ?? "";

interface Group { id: string; name: string; say: string; body: HTMLElement[] }

export async function prefsPage(page: HTMLElement, ctx: HubContext) {
  // Every old part, drawn once by its own code (settings/main.ts), then shared out below.
  const store = h("div");
  await ctx.notch("prefs" as PageId, store);
  const part = (k: string) => store.querySelector<HTMLElement>(`[data-part="${k}"]`);
  const rowsOf = (k: string) => { const p = part(k); return p ? demoRows(p) : []; };

  const content = h("div", { class: "jv-prefs-body" });
  let scrollBack = 0;
  const scroller = () => page.closest(".hub-scroll") as HTMLElement | null;

  /** A bigger item: a row with ›, opening its own page with ‹ Settings. */
  const drill = (title: string, say: string, nodes: () => HTMLElement[]) => {
    const r = h("button", { class: "srow drill" },
      h("div", { class: "lbl" }, h("b", { text: title }), h("span", { text: say })),
      h("div", { class: "ctl" }, h("span", { class: "go", text: "›" })));
    r.addEventListener("click", () => {
      scrollBack = scroller()?.scrollTop ?? 0;
      // The group it opened from stays lit on the left while you're on its page.
      const from = (r.closest<HTMLElement>(".jv-sgroup")?.dataset.anchor ?? "").replace("group-", "");
      if (from) light(from);
      clear(content);
      content.append(h("div", { class: "jv-sub" },
        h("button", { class: "back", text: `‹ ${t("Settings")}`, onclick: () => { drawGroups(); requestAnimationFrame(() => { const s = scroller(); if (s) s.scrollTop = scrollBack; }); } }),
        h("p", { class: "jv-ptitle", text: title }),
        h("p", { class: "jv-psay", text: say }),
        ...nodes()));
      const s = scroller();
      if (s) s.scrollTop = 0;
    });
    return r;
  };
  // A part shown on its own page: kept once, moved in and out of the page.
  const kept = new Map<string, HTMLElement[]>();
  const partNodes = (k: string) => () => {
    if (!kept.has(k)) kept.set(k, rowsOf(k));
    return kept.get(k)!;
  };

  // General's rows go to General, Island and Sound.
  const ISLAND = [t("Open on hover"), t("Open for every pill’s alerts"), t("Show clock in the island"), t("Closed island shows"), t("Auto-close"), t("Island lives on")];
  const general = rowsOf("general");
  const island: HTMLElement[] = [], sound: HTMLElement[] = [], gen: HTMLElement[] = [];
  // A row without a name (a button, a note) goes where the row above it went.
  const SOUND = [t("Sound"), t("Volume")];
  let into = gen;
  for (const r of general) {
    const n = nameOf(r);
    if (!r.classList.contains("bare")) into = ISLAND.includes(n) ? island : SOUND.includes(n) ? sound : gen;
    into.push(r);
  }

  // The old Hey JARVIS and Notes settings pages, drawn in their group; they redraw in place.
  const inPlace = (render: (box: HTMLElement, c: HubContext) => Promise<void> | void, self: PageId) => {
    const box = h("div", { class: "jv-flowpart" });
    const sub: HubContext = Object.create(ctx, {
      hero: { value: () => h("div") },
      navigate: { value: (p: PageId) => { if (p === self) draw(); else ctx.navigate(p); } },
    });
    const draw = () => { clear(box); void render(box, sub); };
    draw();
    return box;
  };

  const version = await Bridge.boot().then((b) => b?.version ?? "").catch(() => "");
  const groups: Group[] = [
    { id: "general", name: t("General"), say: t("How JARVIS starts, its language and its updates."), body: gen },
    // #80: everything you can customize about the notch, in one group and shown right here.
    { id: "island", name: t("Island"), say: t("Everything about the island at the top of your screen: its tabs, its pills and how it behaves."), body: [
      h("h4", { class: "jv-psub", text: t("Tabs in the island") }), ...partNodes("tabs")(),
      h("h4", { class: "jv-psub", text: t("Active pills") }), ...partNodes("pills")(),
      h("h4", { class: "jv-psub", text: t("Behavior") }), ...island,
    ] },
    // Its own note already says how shortcuts work.
    // Talk, Ask, Show more and Dictate have their keys on Voice: Shortcuts points there (#84: "ask" found nothing).
    { id: "shortcuts", name: t("Shortcuts"), say: "", body: [...rowsOf("shortcuts"), h("div", { class: "srow" },
      h("div", { class: "lbl" }, h("b", { text: `${t("Talk")} · ${t("Ask")} · ${t("Show more")} · ${t("Dictate")}` }),
        h("span", { text: t("Their keys are set under Voice.") })),
      h("div", { class: "ctl" }, h("button", { class: "jv-link", text: `${t("Voice")} ›`, onclick: () => content.querySelector('[data-anchor="group-voice"]')?.scrollIntoView({ block: "start" }) })))] },
    { id: "sound", name: t("Sound"), say: t("JARVIS's sounds and your own."), body: sound },
    { id: "voice", name: t("Voice"), say: t("How he hears you and how he answers."), body: [inPlace(voicePage, "voice")] },
    { id: "dictation", name: t("Dictation"), say: t("Your dictation keys, the microphone, the voice model and the Notetaker."), body: [inPlace(flowSettingsPage, "flowsettings")] },
    { id: "agents", name: t("Agents"), say: t("Claude Code, Codex and the other agents JARVIS follows."), body: [
      drill("Claude Code", t("Its hooks, so JARVIS sees what it does and can answer its questions."), partNodes("claude")),
      drill(t("Other agents"), t("Codex, Cursor and the rest: what JARVIS follows."), partNodes("agents")),
      drill(t("Plan usage"), t("The status line relay that reads your Claude plan's limits."), partNodes("plan")),
    ] },
    { id: "phone", name: t("Android phone"), say: t("Your agents and their approvals on your Android phone, over your Wi-Fi."), body: [
      drill(t("Your phone"), t("Pair it, and choose what it may see and answer."), partNodes("phone")),
    ] },
    { id: "accounts", name: t("Accounts and keys"), say: t("Keys stay in Windows Credential Manager. They never leave this PC except to the service they belong to."), body: [
      ...rowsOf("api"),
      drill(t("Your AI subscriptions"), t("Use the AI plans you already pay for."), partNodes("subs")),
      drill(t("Chat providers"), t("The AIs the island's chat can use, with your own keys."), partNodes("providers")),
      drill(t("Local models"), t("Ollama, LM Studio or your own server, on this PC."), partNodes("local")),
    ] },
    { id: "privacy", name: t("Privacy"), say: t("Everything stays on this PC unless you send it."), body: [
      h("p", { class: "jv-pnote", text: t("No telemetry. Network requests only go to the services you configure yourself.") }),
    ] },
    { id: "about", name: t("About"), say: "JARVIS", body: [
      h("div", { class: "srow" }, h("div", { class: "lbl" }, h("b", { text: t("Version") })), h("div", { class: "ctl" }, h("span", { class: "jv-pnote", text: version }))),
    ] },
  ];

  // ── The page: groups on the left, the groups on the right ──
  const search = h("input", { class: "q", placeholder: t("Search"), "aria-label": t("Search settings") }) as HTMLInputElement;
  const links = new Map<string, HTMLElement>();
  const nav = h("nav", { class: "jv-snav" }, h("label", { class: "search" }, h("span", { text: "⌕" }), search));
  const light = (id: string) => { for (const [k, a] of links) a.classList.toggle("on", k === id); };
  for (const g of groups) {
    const a = h("button", { class: "lnk", text: g.name, onclick: () => {
      clicked = g.id;
      window.setTimeout(() => { if (clicked === g.id) light(g.id); }, 450);
      if (!content.querySelector(".jv-sgroup")) drawGroups();
      content.querySelector(`[data-anchor="group-${g.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    } });
    links.set(g.id, a);
    nav.append(a);
  }
  const sections = new Map<string, HTMLElement>();
  for (const g of groups) {
    sections.set(g.id, h("section", { class: "jv-sgroup", "data-anchor": `group-${g.id}` },
      h("h3", { text: g.name }), ...(g.say ? [h("p", { class: "say", text: g.say })] : []), ...g.body));
  }
  function drawGroups() {
    clear(content);
    content.append(h("p", { class: "jv-ptitle", text: t("Settings") }), noMatch, ...sections.values());
    filter();
  }
  // Search (#84): each row shown only if it says it; a group whose name matches shows whole; the
  // blocks drawn by other pages (Voice, Dictation) filter their own rows; nothing found says so.
  const noMatch = h("p", { class: "jv-pnone" });
  const says = (el: Element, q: string) => (el.textContent ?? "").toLowerCase().includes(q);
  function filter() {
    const q = search.value.trim().toLowerCase();
    let anyAtAll = false;
    for (const [id, sec] of sections) {
      const whole = !q || (groups.find((g) => g.id === id)?.name.toLowerCase().includes(q) ?? false);
      let any = whole;
      for (const child of [...sec.children] as HTMLElement[]) {
        if (child.tagName === "H3" || child.classList.contains("say")) continue;
        if (whole) { child.style.display = ""; child.querySelectorAll<HTMLElement>(".hub-row").forEach((r) => (r.style.display = "")); continue; }
        if (child.classList.contains("jv-flowpart")) {
          let inner = false;
          child.querySelectorAll<HTMLElement>(".hub-row").forEach((r) => { const hit = says(r, q); r.style.display = hit ? "" : "none"; inner ||= hit; });
          child.style.display = inner ? "" : "none";
          any ||= inner;
          continue;
        }
        const hit = !child.classList.contains("jv-psub") && says(child, q);
        child.style.display = hit ? "" : "none";
        any ||= hit;
      }
      sec.style.display = any ? "" : "none";
      anyAtAll ||= any;
    }
    noMatch.textContent = anyAtAll ? "" : t("No setting matches “{0}”.", { 0: search.value.trim() });
    noMatch.style.display = anyAtAll ? "none" : "";
  }
  search.addEventListener("input", () => { if (!content.querySelector(".jv-sgroup")) drawGroups(); filter(); });

  // The group in view is the one lit on the left (#84): the last one whose top has passed the
  // top third; at the bottom, the one you clicked (short last groups never reach the top).
  let clicked: string | null = null;
  const onScroll = () => {
    const s = scroller();
    if (!s || !content.querySelector(".jv-sgroup")) return;
    const top = s.getBoundingClientRect().top + s.clientHeight / 3;
    let id = "general";
    for (const [k, sec] of sections) if (sec.style.display !== "none" && sec.getBoundingClientRect().top <= top) id = k;
    const atBottom = s.scrollTop + s.clientHeight >= s.scrollHeight - 4;
    if (atBottom && clicked) id = clicked;
    light(id);
  };
  const seen = { disconnect: () => scroller()?.removeEventListener("scroll", onScroll) };

  page.classList.add("jv-prefs");
  page.append(nav, content);
  drawGroups();
  links.get("general")?.classList.add("on");
  // The page is in the window now: follow its scroll; a wheel or drag forgets the clicked group.
  requestAnimationFrame(() => {
    const s = scroller();
    s?.addEventListener("scroll", onScroll, { passive: true });
    s?.addEventListener("wheel", () => { clicked = null; }, { passive: true });
  });
  const prev = ctx.onLeave;
  ctx.onLeave = () => { seen.disconnect(); prev?.(); };
}
