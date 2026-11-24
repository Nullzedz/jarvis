// JARVIS: his shortcuts as three keycap tiles (design B) on the Voice page —
// talk, ask about the screen, show him more, dictate. Click a tile, press the new keys
// together, let go: they're kept. Esc cancels. Keys another tile already uses
// (or that contain its keys) are refused, so one press never does two things.

import { h, clear } from "../../views/dom";
import { t } from "../../i18n/i18n";
import type { FlowKey, FlowPrefs } from "../../core/flow";
import type { HubContext } from "../shell";
import { codeLabel, icon, keycap } from "../ui";
import { comboFromKeys } from "../keys";

// « Show more » (Shift + Win) went in #92: Ctrl + Shift + Z does it.
type Tile = "talk" | "ask" | "dictate";
const TILES: Tile[] = ["talk", "ask", "dictate"];

/** The keys of dictation's shortcut, by their KeyboardEvent.code names. */
export function dictationCodes(key: FlowKey, combo: string[]): string[] {
  const fixed: Record<Exclude<FlowKey, "custom">, string[]> = {
    right_ctrl: ["ControlRight"],
    right_alt: ["AltRight"],
    right_shift: ["ShiftRight"],
    left_ctrl_super: ["ControlLeft", "MetaLeft"],
    left_ctrl: ["ControlLeft"],
    left_alt: ["AltLeft"],
    left_shift: ["ShiftLeft"],
  };
  return key === "custom" ? (combo.length ? combo : ["ControlRight"]) : fixed[key];
}

/** Two shortcuts clash when one holds all the keys of the other. */
export function clashes(a: string[], b: string[]): boolean {
  return a.length > 0 && b.length > 0 && (a.every((k) => b.includes(k)) || b.every((k) => a.includes(k)));
}

function current(prefs: FlowPrefs): Record<Tile, string[]> {
  return {
    talk: prefs.talkKeys?.length ? prefs.talkKeys : ["ControlLeft", "MetaLeft"],
    ask: prefs.askKeys?.length ? prefs.askKeys : ["ControlLeft", "ShiftLeft", "KeyZ"],
    dictate: dictationCodes(prefs.key, prefs.keyCombo),
  };
}

export function shortcutTiles(ctx: HubContext, prefs: FlowPrefs, platform: "windows" | "linux"): HTMLElement {
  const names: Record<Tile, string> = { talk: t("Talk"), ask: t("Ask"), dictate: t("Dictate") };
  const icons: Record<Tile, string> = { talk: "mic", ask: "chat", dictate: "pencil" };
  const how: Record<Tile, string> = {
    talk: t("Hold · tap"),
    ask: t("Press · hold to circle"),
    dictate: prefs.oneTapHandsFree ? t("Hold · tap") : t("Hold · tap twice"),
  };
  const grid = h("div", { class: "jv-tiles" });
  let recording: Tile | null = null;
  let stopRecording: (() => void) | null = null;

  const save = (tile: Tile, combo: string[]) =>
    ctx.setPrefs((p) => {
      if (tile === "talk") p.talkKeys = combo;
      else if (tile === "ask") p.askKeys = combo;
      else {
        p.key = "custom";
        p.keyCombo = combo;
      }
    }).then(() => ctx.navigate("voice"));

  const caps = (codes: string[]) => h("div", { class: "jv-caps" }, ...codes.map((c) => keycap(codeLabel(c, platform))));

  const draw = () => {
    clear(grid);
    const keys = current(prefs);
    for (const tile of TILES) {
      const el = h("button", { class: `jv-tile${recording === tile ? " on" : ""}`, type: "button" });
      el.append(h("span", { class: "jv-icon" }, icon(icons[tile])), h("span", { class: "jv-name", text: names[tile] }));
      const keysEl = recording === tile ? h("div", { class: "jv-caps" }, keycap(t("Press the keys…"))) : caps(keys[tile]);
      const sub = h("span", { class: "jv-how", text: recording === tile ? t("Esc cancels") : how[tile] });
      el.append(keysEl, sub);
      el.addEventListener("click", () => {
        stopRecording?.();
        record(tile);
      });
      grid.append(el);
    }
  };

  function record(tile: Tile) {
    recording = tile;
    draw();
    // The tile was drawn again: its keycaps show what's pressed.
    const el = grid.children[TILES.indexOf(tile)] as HTMLElement;
    const keysEl = el.querySelector<HTMLElement>(".jv-caps")!;
    let held = new Set<string>();
    let seen: string[] = [];
    const stop = () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      recording = null;
      stopRecording = null;
    };
    const down = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") {
        stop();
        draw();
        return;
      }
      held.add(e.code);
      seen = comboFromKeys([...held]);
      keysEl.replaceChildren(...(seen.length ? seen.map((c) => keycap(codeLabel(c, platform))) : [keycap("…")]));
    };
    const up = (e: KeyboardEvent) => {
      e.preventDefault();
      held.delete(e.code);
      if (held.size > 0) return;
      stop();
      if (!seen.length) return draw();
      const keys = current(prefs);
      const taken = (Object.keys(keys) as Tile[]).find((o) => o !== tile && clashes(seen, keys[o]));
      if (taken) {
        draw();
        const again = grid.children[TILES.indexOf(tile)] as HTMLElement;
        const warn = again.querySelector(".jv-how")!;
        warn.textContent = t("Already used by {0}", { 0: names[taken] });
        warn.classList.add("warn");
        return;
      }
      void save(tile, seen);
    };
    stopRecording = () => {
      stop();
    };
    held = new Set();
    seen = [];
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
  }

  draw();
  return grid;
}
