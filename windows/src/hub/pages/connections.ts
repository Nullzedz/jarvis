// JARVIS: Connections (#76), one to one with the demo's (prototypes/jarvis-home.html
// #connections): Apple Home tiles in rooms (Code, Money, Life). A tile is light when its
// pill is on and connected, dark otherwise, and says the pill's headline or what it needs.
// Clicking a tile opens its setup (‹ Connections): the Integrations page's own block for it
// (its switch in the island, its colour, its keys, what they need), or WhatsApp's section.

import { h, clear } from "../../views/dom";
import { t } from "../../i18n/i18n";
import { emitToWindow, onEvent } from "../../core/bridge";
import { AGENTS_WANTED, CONNECTIONS_SNAPSHOT, type ConnectionRow } from "../../core/agents";
import type { HubContext, PageId } from "../shell";

/** Still being worked out (#108): a Beta tag after its name. */
const beta = (id: string) => (id === "integration_whatsapp" ? [h("span", { class: "jv-beta", text: t("Beta") })] : []);

export type Room = "code" | "money" | "life";
const ROOM_OF: Record<string, Room> = {
  integration_github: "code", integration_gitlab: "code", integration_gitea: "code", integration_vercel: "code", integration_n8n: "code",
  integration_stripe: "money", integration_resend: "money",
};
export const roomOf = (id: string): Room => ROOM_OF[id] ?? "life";
const ROOMS: [Room, () => string][] = [["code", () => t("Code")], ["money", () => t("Money")], ["life", () => t("Life")]];

export interface Tile { id: string; name: string; color: string; on: boolean; live: boolean; headline: string | null; checking?: boolean }

/** What a tile says under its name, and whether that is a call to act. */
export function tileLine(tile: Tile): [string, boolean] {
  // "Off", not "Off · turn on": it opens its setup, it doesn't switch on in one click (#84).
  if (!tile.on) return [t("Off"), true];
  // Until the island answers, it's not known yet (#84: it said "Connected" before it knew).
  if (tile.checking) return [t("Checking…"), false];
  if (!tile.live) return [t("Needs a key"), true];
  return [tile.headline || t("Connected"), false];
}

/** "9 live · 1 needs you · 1 off". */
export function summary(tiles: readonly Tile[]): string {
  const live = tiles.filter((x) => x.on && x.live).length;
  const need = tiles.filter((x) => x.on && !x.live).length;
  const off = tiles.filter((x) => !x.on).length;
  return [t("{0} live", { 0: live }), need ? t("{0} needs you", { 0: need }) : "", off ? t("{0} off", { 0: off }) : ""].filter(Boolean).join(" · ");
}

/** Each tile's mark: its first letter, or two when another tile starts the same (#84: G, G, G). */
export function marks(names: readonly string[]): string[] {
  const first = (n: string) => n.charAt(0).toUpperCase();
  const out = names.map(first);
  const taken = new Set<string>();
  names.forEach((n, i) => {
    if (names.filter((x) => first(x) === out[i]).length < 2) return;
    const word = n.replace(/[^\p{L}\p{N}]/gu, "");
    // Its capitals (GitHub → GH), else its first letter and the next one no other tile uses.
    const caps = word.replace(/[^\p{Lu}]/gu, "");
    const tries = [caps.length >= 2 ? caps.slice(0, 2) : "", ...[...word.slice(1)].map((c) => `${first(word)}${c.toLowerCase()}`)];
    const pick = tries.find((x) => x && !taken.has(x)) ?? `${first(word)}${word.charAt(1)}`;
    taken.add(pick);
    out[i] = pick;
  });
  return out;
}

export async function connectionsPage(page: HTMLElement, ctx: HubContext) {
  // The Integrations page, drawn once by its own code (settings/main.ts); each block is a setup.
  const store = h("div");
  await ctx.notch("integrations" as PageId, store);
  const blocks = [...store.querySelectorAll<HTMLElement>("[data-int]")].filter((b) => b.dataset.int !== "note");
  const note = store.querySelector<HTMLElement>('[data-int="note"]');

  let rows: ConnectionRow[] | null = null;
  let room: Room | "all" = "all";
  const root = h("div", { class: "jv-connpg" });
  page.append(root);
  const scroller = () => page.closest(".hub-scroll") as HTMLElement | null;
  let scrollBack = 0;

  const tiles = (): Tile[] => blocks.map((b) => {
    const id = b.dataset.int!;
    const row = rows?.find((r) => r.id === id);
    // Its first switch: the pill's for a service, WhatsApp's own for WhatsApp.
    const on = !!b.querySelector(".switch")?.classList.contains("on");
    // The colour you picked for its pill, not the catalog's (#84).
    const picked = b.querySelector<HTMLElement>(".color-dot")?.style.background;
    return { id, name: b.dataset.name ?? row?.name ?? id, color: picked || b.dataset.color || row?.color || "#3a3a3c", on, live: row ? row.live : false, headline: row?.headline ?? null, checking: on && !rows };
  });

  const setup = (tile: Tile) => {
    const block = blocks.find((b) => b.dataset.int === tile.id);
    if (!block) return;
    // Its first line: the pill's switch and colour, then its name, which the title already says.
    const label = block.querySelector<HTMLElement>(":scope > div:first-child > span:last-child");
    if (label && tile.id !== "integration_whatsapp") label.textContent = t("Its pill in the island");
    scrollBack = scroller()?.scrollTop ?? 0;
    clear(root);
    const all = tiles();
    const ic = h("span", { class: "ic", text: marks(all.map((x) => x.name))[all.findIndex((x) => x.id === tile.id)] ?? tile.name.charAt(0) });
    ic.style.background = tile.color;
    root.append(
      h("button", { class: "back", text: `‹ ${t("Connections")}`, onclick: () => { draw(); requestAnimationFrame(() => { const s = scroller(); if (s) s.scrollTop = scrollBack; }); } }),
      h("div", { class: "jv-chead" }, ic, h("p", { class: "jv-ptitle" }, tile.name, ...beta(tile.id))),
      h("div", { class: "jv-csetup" }, block),
    );
    if (note && tile.id !== "integration_whatsapp") root.append(h("p", { class: "jv-cnote", text: note.textContent ?? "" }));
    if (tile.id === "integration_whatsapp") root.append(h("p", { class: "jv-cnote", text: t("Still being worked out: messages may arrive late or not at all.") }));
    const s = scroller();
    if (s) s.scrollTop = 0;
  };

  const draw = () => {
    clear(root);
    const list = tiles();
    root.append(h("div", { class: "jv-ctop" }, h("div", {},
      h("p", { class: "title", text: t("Connections") }),
      h("p", { class: "cap", text: summary(list) }))));
    const chips = h("div", { class: "jv-rooms" });
    for (const [id, name] of [["all", () => t("All")] as const, ...ROOMS]) {
      chips.append(h("button", { class: room === id ? "on" : "", text: name(), onclick: () => { room = id; draw(); } }));
    }
    root.append(chips);
    const grid = h("div", { class: "jv-ctiles" });
    const shown = room === "all" ? ROOMS : ROOMS.filter(([r]) => r === room);
    const mk = marks(list.map((x) => x.name));
    for (const [r, name] of shown) {
      const inRoom = list.filter((x) => roomOf(x.id) === r);
      if (!inRoom.length) continue;
      if (room === "all") grid.append(h("p", { class: "jv-croom" }, `${name()} `, h("span", { class: "cap", text: String(inRoom.length) })));
      for (const tile of inRoom) {
        const [line, act] = tileLine(tile);
        const ic = h("span", { class: "ic", text: mk[list.indexOf(tile)] });
        ic.style.background = tile.color;
        grid.append(h("button", { class: `jv-ht${tile.on && tile.live ? "" : " off"}`, "aria-label": `${tile.name}: ${line}`, onclick: () => setup(tile) },
          ic, h("div", {}, h("p", { class: "n" }, tile.name, ...beta(tile.id)), h("p", { class: `v${act ? " act" : ""}`, text: line }))));
      }
    }
    if (!list.length) grid.append(h("p", { class: "cap", text: t("No connections on this computer.") }));
    root.append(grid);
  };

  draw();
  const off = onEvent<ConnectionRow[]>(CONNECTIONS_SNAPSHOT, (r) => {
    rows = Array.isArray(r) ? r : [];
    if (root.querySelector(".jv-ctiles")) draw();
  });
  void off.then(() => emitToWindow("island", AGENTS_WANTED));
  ctx.onLeave = () => void off.then((f) => f());
}
