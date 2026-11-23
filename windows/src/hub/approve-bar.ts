// JARVIS (#84): the bar that answers agents, shared by Home's Agents widget and the Agents page.
// Every waiting request can be answered, not only the first: "1 of 2" walks through them. Your
// answer shows at once (Allowed / Denied) until the island drops the request; a question opens
// the island's card. Two agents in one folder are told apart by their app.

import { h } from "../views/dom";
import { t } from "../i18n/i18n";
import { emitToWindow } from "../core/bridge";
import { AGENT_DECIDE, AGENT_SHOW, type AgentRow } from "../core/agents";

/** Requests answered here, by id: what was said, until the island drops them. */
const answered = new Map<string, "allow" | "deny">();
/** Which request each bar shows, by its place ("home", "page"). */
const shownAt = new Map<string, string>();

/** "korus" alone, "korus · Codex" when another agent shares the name. */
export function agentName(r: Pick<AgentRow, "title" | "app" | "id">, all: readonly Pick<AgentRow, "title" | "id">[]): string {
  return all.some((o) => o.id !== r.id && o.title === r.title) ? `${r.title} · ${r.app}` : r.title;
}

/**
 * The bar for `rows`' requests, or null when none waits. `place` keeps which one you were on
 * across redraws; `redraw` is called after an answer or a move.
 */
export function approveBar(rows: readonly AgentRow[], place: string, redraw: () => void): HTMLElement | null {
  const asks = rows.filter((r) => r.ask);
  // Forget answers the island has dropped.
  for (const id of [...answered.keys()]) if (!asks.some((r) => r.ask!.requestId === id)) answered.delete(id);
  if (!asks.length) return null;
  let i = Math.max(0, asks.findIndex((r) => r.ask!.requestId === shownAt.get(place)));
  // The one shown was answered and another waits: move on to it.
  if (answered.has(asks[i].ask!.requestId)) {
    const next = asks.findIndex((r) => !answered.has(r.ask!.requestId));
    if (next >= 0) i = next;
  }
  const r = asks[i], ask = r.ask!;
  shownAt.set(place, ask.requestId);
  const stop = (e: Event) => e.stopPropagation();
  const said = answered.get(ask.requestId);
  const send = (d: "allow" | "deny") => (e: Event) => {
    stop(e);
    answered.set(ask.requestId, d);
    void emitToWindow("island", AGENT_DECIDE, { requestId: ask.requestId, d });
    redraw();
  };
  const text = h("span", { class: "x" }, h("b", { text: agentName(r, rows) }), document.createTextNode(" "),
    h("span", { class: "d", text: ask.question ? t("has a question") : t("wants to run {command}", { command: ask.command }) }));
  const answer: HTMLElement[] = said
    ? [h("span", { class: "said", text: said === "allow" ? t("Allowed") : t("Denied") })]
    : ask.question
      ? [h("button", { class: "jv-btn blue", text: t("Answer"), onclick: (e: Event) => { stop(e); void emitToWindow("island", AGENT_SHOW, "question"); } })]
      : [h("button", { class: "jv-btn", text: t("Deny"), onclick: send("deny") }), h("button", { class: "jv-btn blue", text: t("Allow"), onclick: send("allow") })];
  const move = (by: number) => (e: Event) => {
    stop(e);
    shownAt.set(place, asks[(i + by + asks.length) % asks.length].ask!.requestId);
    redraw();
  };
  const pager = asks.length > 1
    ? [h("span", { class: "pg" },
        h("button", { class: "jv-pg", "aria-label": t("Previous request"), text: "‹", onclick: move(-1) }),
        h("span", { text: t("{0} of {1}", { 0: i + 1, 1: asks.length }) }),
        h("button", { class: "jv-pg", "aria-label": t("Next request"), text: "›", onclick: move(1) }))]
    : [];
  const bar = h("div", { class: "jv-wapprove" }, h("span", { class: "dot" }), text, ...answer, ...pager);
  // Keys on its buttons are theirs, never the card's around it.
  bar.addEventListener("keydown", stop);
  bar.addEventListener("click", stop);
  return bar;
}
