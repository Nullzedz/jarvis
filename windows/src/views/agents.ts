// JARVIS: the Agents tab (step 11 of #22), one to one with the notch prototype's Agents pane
// (docs/jarvis/design/prototypes/jarvis-notch.html, data-pane="agents"): one .ag row per agent
// with a session: his small visor with the eye in its state colour, the project, what it's
// doing, how long; Deny and Allow when it asks. A row opens that agent on Home.

import { State, type AgentTask } from "../core/state";
import { pillDefinition } from "../core/pills";
import { agentDoing, agentEye, agentTitle, hasSession, minutesBetween } from "../core/agents";
import type { BotStateName, IslandViewName } from "../core/layout";
import { contentHeight } from "./pocket";
import { h, clear } from "./dom";
import { t } from "../i18n/i18n";
import type { ViewHost } from "./views";
import "./pocket.css";

export interface AgentsHost {
  setView(v: IslandViewName): void;
  setFocus(id: string): void;
  decide(d: "allow" | "deny"): void;
  blip(): void;
  resize(): void;
}

/** When each agent's current state began, to say "4 min" or "done 12 min ago". */
const since = new Map<string, { state: BotStateName; at: number }>();

/** When this agent's current state began; stamped as it changes (shared with Home, island/share-agents.ts). */
export function stampSince(task: AgentTask, now: number): number {
  const s = since.get(task.id);
  if (!s || s.state !== task.state) {
    since.set(task.id, { state: task.state, at: now });
    return now;
  }
  return s.at;
}

export function buildAgents(host: AgentsHost): ViewHost {
  const list = h("div", { class: "ag-list" });
  const el = h("div", { class: "view pk agv" }, list);
  let key = "";

  function row(task: AgentTask, now: number): HTMLElement {
    const app = pillDefinition(task.id)?.name ?? task.name;
    const eye = h("b");
    const vis = h("span", { class: "vis" }, eye);
    vis.style.setProperty("--eye", agentEye(task.state));
    const asked = State.pendingApproval?.pillId === task.id ? State.pendingApproval : null;
    const done = task.state === "finished" || task.state === "idle";
    const mins = minutesBetween(stampSince(task, now), now);

    let line: HTMLElement;
    const side: HTMLElement[] = [];
    if (asked && !asked.questions) {
      line = h("p", { class: "cap ag-ask", text: t("{app} wants to run {command}", { app, command: asked.command || asked.tool }) });
      side.push(
        h("button", { class: "btn bs", text: t("Deny"), onclick: (e: Event) => { e.stopPropagation(); host.decide("deny"); } }),
        h("button", { class: "btn bp", text: t("Allow"), onclick: (e: Event) => { e.stopPropagation(); host.decide("allow"); } }),
      );
    } else if (asked) {
      line = h("p", { class: "cap ag-ask", text: t("{app} has a question", { app }) });
      side.push(h("button", { class: "btn bp", text: t("Answer"), onclick: (e: Event) => { e.stopPropagation(); host.setView("question"); } }));
    } else {
      const doing = agentDoing(task);
      const what = task.state === "finished"
        ? t("done {n} min ago", { n: mins })
        : doing ?? (task.state === "idle" ? t("Ready") : t("Working"));
      line = h("p", { class: "cap", text: `${app} · ${what}` });
      if (!done) side.push(h("span", { class: "cap ag-time", text: mins < 1 ? t("just now") : t("{n} min", { n: mins }) }));
    }

    const title = h("p", { class: "ag-name", text: agentTitle(task) });
    if (task.state === "finished") title.classList.add("quiet");
    const r = h("div", { class: "ag", role: "button", tabindex: "0" },
      vis, h("div", { class: "ag-who" }, title, line), ...side);
    const open = () => { host.blip(); host.setFocus(task.id); host.setView("overview"); };
    r.addEventListener("click", open);
    r.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
    return r;
  }

  function paint(force = false) {
    const now = Date.now();
    // Asking you first, then those at work, then the ones done.
    const rank = (a: AgentTask) => (State.pendingApproval?.pillId === a.id ? 0 : a.state === "finished" || a.state === "idle" ? 2 : 1);
    const agents = State.tasks.filter(hasSession).map((a, i) => ({ a, i }))
      .sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i).map(({ a }) => a);
    const k = JSON.stringify([
      Math.floor(now / 60_000),
      agents.map((a) => [a.id, a.state, a.stepIndex, a.steps[a.stepIndex], a.sessionCwd]),
      State.pendingApproval?.requestId,
    ]);
    if (!force && k === key) return;
    key = k;
    clear(list);
    if (agents.length === 0) {
      list.append(h("p", { class: "pk-empty", text: t("No agents running. Start one in your terminal or editor and it shows here.") }));
    }
    for (const a of agents) list.append(row(a, now));
    host.resize();
  }

  return {
    el,
    sync() {
      // Every agent's state is stamped as it changes, even while the tab isn't shown.
      const now = Date.now();
      for (const a of State.tasks) stampSince(a, now);
      if (State.mode === "expanded" && State.view === "agents") paint();
    },
    fitHeight: () => contentHeight(el),
  };
}
