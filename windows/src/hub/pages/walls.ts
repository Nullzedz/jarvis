// JARVIS: Dictation's word walls (#78), one to one with the demo's (prototypes/jarvis-home.html,
// design B): Dictionary, Snippets and Styles as tabs; every item a chip, bigger the more you say
// it (counted in your dictation history, on this computer), the biggest in the middle; the chosen
// one in a bar underneath with Edit and Remove. Everything the old pages (words.ts, styles.ts)
// did is here: words, replacements, snippets, the clean-up by Claude, the style per app.

import { h, clear } from "../../views/dom";
import { t, tn } from "../../i18n/i18n";
import { FlowBridge, type AppStyle, type FlowEntry, type Replacement, type Snippet, type Style } from "../../core/flow";
import type { HubContext } from "../shell";
import { pageSave } from "../save";
import { styleOptions } from "./styles";

export type WallKind = "dictionary" | "snippets" | "styles";

// ── Pure helpers (tested) ──

/** How many of the dictations hold `phrase` (whole words, any case). */
export function countIn(texts: readonly string[], phrase: string): number {
  const p = phrase.trim();
  if (!p) return 0;
  const esc = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${esc}($|[^\\p{L}\\p{N}])`, "iu");
  return texts.filter((x) => re.test(x)).length;
}

/** The chips' order: the most said in the middle, the others alternating out to both sides. */
export function cloudOrder(counts: readonly number[]): number[] {
  const order = counts.map((_, i) => i).sort((a, b) => counts[b] - counts[a] || a - b);
  const mid: number[] = [];
  order.forEach((i, j) => (j % 2 ? mid.push(i) : mid.unshift(i)));
  return mid;
}

/** A chip's font size: 14 px for the least said, up to 34 px for the most. */
export function chipSize(n: number, top: number): number {
  return Math.round(14 + 20 * Math.sqrt(Math.max(0, n) / Math.max(1, top)));
}

/** "cloud code → Claude Code" (or ->): a replacement to add; anything else is a word. */
export function parsePair(text: string): { from: string; to: string } | null {
  const m = text.match(/^(.+?)\s*(?:→|->|=>)\s*(.+)$/);
  return m && m[1].trim() && m[2].trim() ? { from: m[1].trim(), to: m[2].trim() } : null;
}

const newId = () => `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 8)}`;

/** What each style does to the same sentence. */
const EXAMPLE_SAID = "yeah so um the build passed i think we can ship";
const EXAMPLES: Record<Style, string> = {
  verbatim: "yeah so um the build passed i think we can ship",
  natural: "Yeah, the build passed. I think we can ship.",
  polished: "The build has passed, so we are ready to ship.",
};

interface Item { key: string; label: string; n: number; sub?: string }

export async function wallPage(box: HTMLElement, ctx: HubContext, first: WallKind, onBack: () => void) {
  const status = await ctx.refresh();
  const [wordsData, snips, styl, history] = await Promise.all([
    FlowBridge.words().catch(() => null), FlowBridge.snippets().catch(() => null),
    FlowBridge.styles().catch(() => null), FlowBridge.history().catch(() => null),
  ]);
  let words: string[] = wordsData?.words ?? [];
  let replacements: Replacement[] = wordsData?.replacements ?? [];
  let snippets: Snippet[] = snips ?? [];
  let styles: AppStyle[] = styl ?? [];
  const entries: FlowEntry[] = history ?? [];
  const texts = entries.map((e) => e.text);

  let kind: WallKind = first;
  let sel = "";
  let fresh = "";
  let editing = false;
  const write = pageSave(box);

  const top = h("div", { class: "jv-walltop" });
  const extra = h("div");
  const wall = h("div", { class: "jv-wall" });
  const detail = h("div", { class: "jv-wdetail" });
  box.append(top, extra, wall, detail);
  const q = h("input", { placeholder: "" }) as HTMLInputElement;
  const count = h("span", { class: "cap" });

  const placeholder = () => kind === "dictionary" ? t("Search or add a word (heard → written)")
    : kind === "snippets" ? t("Search or add a snippet") : t("Search a style");

  // ── Items ──
  const items = (): Item[] => {
    if (kind === "dictionary") {
      return [
        ...words.map((w) => ({ key: `w:${w}`, label: w, n: countIn(texts, w) })),
        ...replacements.map((r) => ({ key: `r:${r.id}`, label: r.to, n: countIn(texts, r.to), sub: r.from })),
      ];
    }
    if (kind === "snippets") return snippets.map((s) => ({ key: `s:${s.id}`, label: `“${s.trigger}”`, n: countIn(texts, s.text.split("\n")[0].slice(0, 40)) }));
    return styleOptions().map(([id, name]) => ({
      key: `y:${id}`, label: name,
      n: styles.filter((s) => s.style === id).length + (status.prefs.defaultStyle === id ? 1 : 0),
      sub: status.prefs.defaultStyle === id ? t("in use") : undefined,
    }));
  };

  // ── Saving ──
  const saveWords = async (next: { words: string[]; replacements: Replacement[] }) => {
    if (await write(() => FlowBridge.setWords(next)) !== "saved") return false;
    words = next.words; replacements = next.replacements;
    return true;
  };
  const saveSnippets = async (next: Snippet[]) => {
    if (await write(() => FlowBridge.setSnippets(next)) !== "saved") return false;
    snippets = next;
    return true;
  };
  const saveStyles = async (next: AppStyle[]) => {
    if (await write(() => FlowBridge.setStyles(next)) !== "saved") return false;
    styles = next;
    return true;
  };

  const add = async () => {
    const v = q.value.trim();
    if (!v) { q.focus(); return; }
    if (kind === "dictionary") {
      const pair = parsePair(v);
      if (pair) {
        const r = { id: newId(), ...pair };
        if (!await saveWords({ words, replacements: [...replacements.filter((x) => x.from.toLowerCase() !== pair.from.toLowerCase()), r] })) return;
        sel = fresh = `r:${r.id}`;
      } else {
        if (words.some((x) => x.toLowerCase() === v.toLowerCase())) { sel = `w:${words.find((x) => x.toLowerCase() === v.toLowerCase())}`; q.value = ""; draw(); return; }
        if (!await saveWords({ words: [...words, v], replacements })) return;
        sel = fresh = `w:${v}`;
      }
    } else if (kind === "snippets") {
      // A snippet needs its text: the bar opens on it, ready to write.
      const s = { id: newId(), trigger: v, text: "" };
      snippets = [...snippets, s];
      sel = fresh = `s:${s.id}`;
      editing = true;
    } else {
      return;
    }
    q.value = "";
    draw();
  };

  // ── Drawing ──
  const drawTop = () => {
    clear(top);
    const tabs = h("span", { class: "jv-tabs2" });
    for (const [k, name] of [["dictionary", t("Dictionary")], ["snippets", t("Snippets")], ["styles", t("Styles")]] as [WallKind, string][]) {
      tabs.append(h("button", { class: k === kind ? "on" : "", text: name, onclick: () => { kind = k; sel = ""; editing = false; q.value = ""; drawTop(); drawExtra(); draw(); } }));
    }
    q.placeholder = placeholder();
    const search = h("label", { class: "jv-wsearch" }, q);
    if (kind !== "styles") search.append(h("button", { class: "jv-wadd", "aria-label": t("Add"), title: t("Add"), text: "+", onclick: (e: Event) => { e.preventDefault(); void add(); } }));
    top.append(h("button", { class: "back", text: `‹ ${t("Dictation")}`, onclick: onBack }), tabs, search, count);
  };
  q.addEventListener("input", () => draw());
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") void add(); });

  const drawExtra = () => {
    clear(extra);
    wall.classList.remove("dim");
    if (kind !== "styles") return;
    // The clean-up by Claude: what decides whether any style applies.
    const sw = h("span", { class: `jv-switch${status.prefs.cleanup ? " on" : ""}` }, h("i"));
    const b = h("button", { class: "jv-sswitch", role: "switch", "aria-checked": String(status.prefs.cleanup), "aria-label": t("Clean up with Claude") }, sw);
    b.addEventListener("click", () => {
      const on = !sw.classList.contains("on");
      sw.classList.toggle("on", on);
      b.setAttribute("aria-checked", String(on));
      void ctx.setPrefs((p) => (p.cleanup = on));
      status.prefs.cleanup = on;
      wall.classList.toggle("dim", !on);
    });
    extra.append(h("div", { class: "jv-wclean" },
      h("div", { class: "grow" }, h("b", { text: t("Clean up with Claude") }),
        h("p", { class: "cap", text: t("Removes the “um”, the repeats and the corrections you made while speaking, and fixes the punctuation.") }),
        h("p", { class: "cap", text: t("With the clean-up on, the text (never your voice) goes to Anthropic with your Claude key. Off, everything stays on this computer.") }),
        status.hasClaudeKey ? null : h("p", { class: "warn" }, document.createTextNode(`${t("The clean-up uses your Claude key.")} `),
          h("button", { class: "jv-link", text: `${t("Add it in Settings › Accounts and keys")} ›`, onclick: () => ctx.navigate("chat") }))),
      b));
    wall.classList.toggle("dim", !status.prefs.cleanup);
  };

  const btn = (text: string, onclick: () => void, cls = "") => h("button", { class: `jv-chipbtn${cls ? ` ${cls}` : ""}`, text, onclick });
  // Removing says what went, with Undo for a few seconds (#84).
  const toast = h("div", { class: "jv-toast", role: "status" });
  box.append(toast);
  let toastAt = 0;
  const removed = (what: string, undo: () => Promise<unknown>) => {
    clear(toast);
    toast.append(h("span", { text: t("Removed “{0}”", { 0: what }) }),
      h("button", { class: "jv-link", text: t("Undo"), onclick: async () => { clear(toast); toast.classList.remove("on"); await undo(); draw(); } }));
    toast.classList.add("on");
    window.clearTimeout(toastAt);
    toastAt = window.setTimeout(() => toast.classList.remove("on"), 6000);
  };
  const times = (n: number) => tn("{count} time", "{count} times", n);

  const drawDetail = () => {
    clear(detail);
    const list = items();
    const it = list.find((x) => x.key === sel) ?? list[0];
    if (!it) { detail.style.display = "none"; return; }
    detail.style.display = "";
    sel = it.key;
    const name = (text: string) => h("span", { class: "big", text });
    const actions = h("span", { class: "acts" });

    if (it.key.startsWith("w:")) {
      const w = it.key.slice(2);
      const last = [...entries].sort((a, b) => b.date - a.date).find((e) => countIn([e.text], w));
      if (editing) {
        const inp = h("input", { class: "jv-sinput", value: w }) as HTMLInputElement;
        const done = async () => {
          const v = inp.value.trim();
          if (v && v !== w && await saveWords({ words: words.map((x) => (x === w ? v : x)), replacements })) sel = `w:${v}`;
          editing = false; draw();
        };
        inp.addEventListener("keydown", (e) => { if (e.key === "Enter") void done(); });
        detail.append(inp, actions);
        actions.append(btn(t("Save"), () => void done(), "primary"), btn(t("Cancel"), () => { editing = false; draw(); }));
        // Not while you're typing in the search (#84: it stole the cursor after one letter).
        if (document.activeElement !== q) inp.focus();
        return;
      }
      detail.append(name(w), h("div", { class: "grow" },
        h("p", { class: "cap", text: `${t("Always spelled this way")} · ${times(it.n)}` }),
        last ? h("p", { class: "line" }, `“${last.text.slice(0, 140)}${last.text.length > 140 ? "…" : ""}”`, last.app ? h("span", { class: "cap", text: ` · ${last.app}` }) : null) : null), actions);
      actions.append(btn(t("Edit"), () => { editing = true; drawDetail(); }),
        btn(t("Remove"), async () => {
          const before = { words: [...words], replacements: [...replacements] };
          if (await saveWords({ words: words.filter((x) => x !== w), replacements })) { sel = ""; draw(); removed(w, () => saveWords(before)); }
        }, "danger"));
    } else if (it.key.startsWith("r:")) {
      const r = replacements.find((x) => `r:${x.id}` === it.key)!;
      if (editing) {
        const from = h("input", { class: "jv-sinput", value: r.from }) as HTMLInputElement;
        const to = h("input", { class: "jv-sinput", value: r.to }) as HTMLInputElement;
        const done = async () => {
          const f = from.value.trim(), w = to.value.trim();
          if (f && w) await saveWords({ words, replacements: replacements.map((x) => (x.id === r.id ? { ...x, from: f, to: w } : x)) });
          editing = false; draw();
        };
        detail.append(h("span", { class: "cap", text: t("Heard") }), from, h("span", { class: "cap", text: "→" }), to, actions);
        actions.append(btn(t("Save"), () => void done(), "primary"), btn(t("Cancel"), () => { editing = false; draw(); }));
        return;
      }
      detail.append(name(r.to), h("div", { class: "grow" },
        h("p", { class: "cap", text: `${t("Heard as “{0}”", { 0: r.from })} · ${times(it.n)}` }),
        h("p", { class: "line", text: t("When JARVIS hears “{0}”, he writes “{1}”.", { 0: r.from, 1: r.to }) })), actions);
      actions.append(btn(t("Edit"), () => { editing = true; drawDetail(); }),
        btn(t("Remove"), async () => {
          const before = { words: [...words], replacements: [...replacements] };
          if (await saveWords({ words, replacements: replacements.filter((x) => x.id !== r.id) })) { sel = ""; draw(); removed(r.to, () => saveWords(before)); }
        }, "danger"));
    } else if (it.key.startsWith("s:")) {
      const s = snippets.find((x) => `s:${x.id}` === it.key)!;
      if (editing) {
        const tr = h("input", { class: "jv-sinput", value: s.trigger, placeholder: t("What you say, e.g. my signature") }) as HTMLInputElement;
        const tx = h("textarea", { class: "jv-sinput area", placeholder: t("The text Coucou pastes") }) as HTMLTextAreaElement;
        tx.value = s.text;
        const done = async () => {
          const a = tr.value.trim(), b = tx.value;
          if (!a || !b.trim()) return;
          const next = snippets.map((x) => (x.id === s.id ? { ...x, trigger: a, text: b } : x));
          if (await saveSnippets(next)) { editing = false; draw(); }
        };
        const cancel = () => {
          editing = false;
          // A new snippet that never got its text is not kept.
          if (!s.text) { snippets = snippets.filter((x) => x.id !== s.id); sel = ""; }
          draw();
        };
        detail.append(h("div", { class: "grow col" }, h("div", { class: "row" }, h("span", { class: "cap", text: t("You say") }), tr), tx), actions);
        actions.append(btn(t("Save"), () => void done(), "primary"), btn(t("Cancel"), cancel));
        if (document.activeElement !== q) (s.trigger ? tx : tr).focus();
        return;
      }
      detail.append(name(`“${s.trigger}”`), h("span", { class: "cap", text: t("types") }), h("pre", { class: "out", text: s.text }),
        h("span", { class: "cap", text: times(it.n) }), actions);
      actions.append(btn(t("Edit"), () => { editing = true; drawDetail(); }),
        btn(t("Remove"), async () => {
          const before = [...snippets];
          if (await saveSnippets(snippets.filter((x) => x.id !== s.id))) { sel = ""; draw(); removed(`“${s.trigger}”`, () => saveSnippets(before)); }
        }, "danger"));
    } else {
      const id = it.key.slice(2) as Style;
      const apps = styles.filter((s) => s.style === id);
      const inUse = status.prefs.defaultStyle === id;
      const appChips = h("div", { class: "apps" });
      for (const a of apps) {
        appChips.append(h("span", { class: "jv-schip" }, h("span", { text: a.name }),
          h("button", { "aria-label": t("Delete"), title: t("Delete"), text: "×", onclick: async () => { if (await saveStyles(styles.filter((x) => x.id !== a.id))) draw(); } })));
      }
      const addApp = h("select", { class: "jv-sselect" }) as HTMLSelectElement;
      const fill = async () => {
        clear(addApp);
        addApp.append(h("option", { value: "", text: `+ ${t("Add an app")}` }));
        const running = ((await FlowBridge.runningApps().catch(() => null)) ?? []).filter((a) => !styles.some((s) => s.id === a.id));
        if (!running.length) addApp.append(h("option", { value: "-", text: t("No other open app"), disabled: true }));
        for (const a of running) addApp.append(h("option", { value: `${a.id}\n${a.name}`, text: a.name }));
        addApp.value = "";
      };
      addApp.addEventListener("focus", () => void fill());
      addApp.addEventListener("change", async () => {
        const [aid, aname] = addApp.value.split("\n");
        if (!aid || aid === "-") return;
        if (await saveStyles([...styles.filter((x) => x.id !== aid), { id: aid, name: aname ?? aid, style: id }])) draw();
      });
      void fill();
      appChips.append(addApp);
      detail.append(name(it.label), h("div", { class: "grow" },
        h("p", { class: "cap", text: t("You say: “{0}”", { 0: EXAMPLE_SAID }) }),
        h("p", { class: "line big2", text: EXAMPLES[id] }),
        h("p", { class: "cap", text: inUse ? t("Used in every other app") : apps.length ? t("Used in") : t("No app uses it yet") }),
        appChips), actions);
      actions.append(inUse
        ? h("span", { class: "jv-chipbtn inuse" }, h("i", { class: "dot" }), t("In use"))
        : btn(t("Use this style"), async () => {
          await ctx.setPrefs((p) => (p.defaultStyle = id));
          status.prefs.defaultStyle = id;
          draw();
        }, "primary"));
    }
  };

  const draw = () => {
    clear(wall);
    const list = items();
    const filter = q.value.trim().toLowerCase();
    const ns = list.map((x) => x.n);
    const topN = Math.max(1, ...ns);
    const shown = cloudOrder(ns).filter((i) => !filter || list[i].label.toLowerCase().includes(filter) || (list[i].sub ?? "").toLowerCase().includes(filter));
    if (!sel && list.length) sel = list[cloudOrder(ns)[Math.floor(list.length / 2)] ?? 0]?.key ?? "";
    for (const i of shown) {
      const it = list[i];
      const chip = h("button", { class: `jv-wchip${it.key === sel ? " on" : ""}${it.key === fresh ? " new" : ""}`, onclick: () => { sel = it.key; editing = false; draw(); } }, it.label);
      if (it.sub) chip.append(h("span", { class: "sub", text: kind === "dictionary" ? `← ${it.sub}` : it.sub }));
      chip.style.fontSize = `${chipSize(it.n, topN)}px`;
      chip.style.fontWeight = it.n / topN > 0.5 ? "600" : "400";
      wall.append(chip);
    }
    fresh = "";
    if (!shown.length) {
      wall.append(h("p", { class: "cap", text: filter && kind !== "styles" ? t("No match. Press + to add “{0}”.", { 0: q.value.trim() })
        : kind === "dictionary" ? t("No word yet. Add the names, brands and jargon Coucou gets wrong.")
        : kind === "snippets" ? t("No snippet yet. Your booking link, your signature, your address: say a few words, get the whole text.") : "" }));
    }
    count.textContent = kind === "dictionary" ? tn("{count} word", "{count} words", list.length)
      : kind === "snippets" ? tn("{count} snippet", "{count} snippets", list.length) : tn("{count} style", "{count} styles", list.length);
    drawDetail();
  };

  drawTop();
  drawExtra();
  draw();
}
