// JARVIS: the island tells the JARVIS window about its agents (step 2 of #57), so Home's Agents
// widget shows them and its Deny / Allow answer as the notch's do. Rows are sent when they change
// and whenever the window asks (it just opened Home).

import { State } from "../core/state";
import { availablePills, pillDefinition } from "../core/pills";
import { serviceCards } from "./phone-services";
import { emitToWindow, onEvent } from "../core/bridge";
import {
  AGENTS_SNAPSHOT, AGENTS_WANTED, AGENT_DECIDE, AGENT_SHOW, CONNECTIONS_SNAPSHOT, agentDoing, agentTitle, hasSession,
  type AgentRow, type ConnectionRow,
} from "../core/agents";
import { stampSince } from "../views/agents";

const HUB = "settings";

export function shareAgents(host: { decide(d: "allow" | "deny"): void; show(view: "launch" | "question"): void }) {
  let last = "";
  const rows = (): AgentRow[] => {
    const now = Date.now();
    const req = State.pendingApproval;
    return State.tasks.filter(hasSession).map((task) => ({
      id: task.id,
      title: agentTitle(task),
      app: pillDefinition(task.id)?.name ?? task.name,
      state: task.state,
      doing: agentDoing(task),
      since: stampSince(task, now),
      ask: req && req.pillId === task.id
        ? { requestId: req.requestId, command: req.command || req.tool, question: !!req.questions }
        : null,
      steps: task.steps.slice(Math.max(0, task.stepIndex - 2), task.stepIndex + 1),
      sessionId: task.sessionId ?? null,
      cwd: task.sessionCwd ?? null,
    }));
  };
  // Home's Connections widget: every service pill, whether it's connected, and its headline.
  let lastConn = "";
  const connections = (): ConnectionRow[] => {
    const heads = new Map(serviceCards().map((c) => [c.id, c.headline]));
    return availablePills(State.os).filter((p) => p.category === "service" && p.support !== "soon").map((p) => {
      const info = State.integrations[p.id];
      return { id: p.id, name: p.name, color: p.color, headline: heads.get(p.id) ?? null, live: !!info?.configured && !info.error };
    });
  };
  const send = (force = false) => {
    const r = rows();
    const key = JSON.stringify(r);
    if (force || key !== last) {
      last = key;
      void emitToWindow(HUB, AGENTS_SNAPSHOT, r);
    }
    const c = connections();
    const ck = JSON.stringify(c);
    if (force || ck !== lastConn) {
      lastConn = ck;
      void emitToWindow(HUB, CONNECTIONS_SNAPSHOT, c);
    }
  };
  State.subscribe(() => send());
  void onEvent(AGENTS_WANTED, () => send(true));
  void onEvent<{ requestId: string; d: "allow" | "deny" }>(AGENT_DECIDE, ({ requestId, d }) => {
    // Only the request the window saw: never answer a newer one by mistake.
    if (State.pendingApproval?.requestId === requestId) host.decide(d);
  });
  void onEvent<string>(AGENT_SHOW, (view) => { if (view === "launch" || view === "question") host.show(view); });
}
