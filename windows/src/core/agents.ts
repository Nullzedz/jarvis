// JARVIS: the Agents tab's rows (step 11 of #22; the notch prototype's .ag rows), from the
// island's tasks. Pure; tested in tests/agents.test.mjs; drawn by src/views/agents.ts.

import type { BotStateName } from "./layout";

/** His eye's colour in the row, by the agent's state (the character sheet's colours). */
export function agentEye(state: BotStateName): string {
  switch (state) {
    case "working": return "#30d158";
    case "thinking": return "#bf5af2";
    case "searching": return "#64d2ff";
    case "approval":
    case "question": return "#ff9f0a";
    case "error": return "#ff453a";
    case "idle": return "#0a84ff";
    default: return "#636366"; // finished, rate limit, sleeping, dizzy
  }
}

export interface AgentLike {
  id: string;
  name: string;
  state: BotStateName;
  steps: string[];
  stepIndex: number;
  sessionCwd?: string | null;
}

/** An agent worth a row: it has (or had) a session, not a quiet integration. */
export function hasSession(t: AgentLike & { isIntegration: boolean }): boolean {
  return !t.isIntegration || t.state !== "idle" || t.steps.length > 0 || !!t.sessionCwd;
}

/** The project's folder name, else the agent's name. */
export function agentTitle(t: AgentLike): string {
  const cwd = (t.sessionCwd ?? "").replace(/[\\/]+$/, "");
  const folder = cwd.split(/[\\/]/).pop();
  return folder || t.name;
}

/** What it's doing now: its latest step, else nothing. */
export function agentDoing(t: AgentLike): string | null {
  return t.steps[t.stepIndex] ?? t.steps[t.steps.length - 1] ?? null;
}

/** Whole minutes between two times (ms), at least 0. */
export function minutesBetween(from: number, to: number): number {
  return Math.max(0, Math.floor((to - from) / 60_000));
}

// ── Shared with the JARVIS window's Home (step 2 of #57): the island sends its agents there ──

/** Island → window: the agents as rows (AgentRow[]). */
export const AGENTS_SNAPSHOT = "agents-snapshot";
/** Window → island: send the rows now (the window just opened Home). */
export const AGENTS_WANTED = "agents-wanted";
/** Window → island: Deny or Allow the request `requestId` ({ requestId, d }). */
export const AGENT_DECIDE = "agent-decide";
/** Window → island: open the notch on a view: "launch" (New Claude Code session) or "question" (answer it). */
export const AGENT_SHOW = "agent-show";

export interface AgentRow {
  id: string;
  /** The project's folder, else the agent's name. */
  title: string;
  /** Claude Code, Codex… */
  app: string;
  state: BotStateName;
  doing: string | null;
  /** When its current state began (ms). */
  since: number;
  /** What it asks you, if it does: a command to allow, or a question to answer in the notch. */
  ask: { requestId: string; command: string; question: boolean } | null;
}

/** Asking you first, then those at work, then the ones done; otherwise as they came. */
export function rankRows<T extends Pick<AgentRow, "state" | "ask">>(rows: readonly T[]): T[] {
  const rank = (r: T) => (r.ask ? 0 : r.state === "finished" || r.state === "idle" ? 2 : 1);
  return rows.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map(({ r }) => r);
}

/** The widget's one-line summary: how many ask you, work, and are done. */
export function rowCounts(rows: readonly Pick<AgentRow, "state" | "ask">[]): { asking: number; working: number; done: number } {
  let asking = 0, working = 0, done = 0;
  for (const r of rows) {
    if (r.ask) asking++;
    else if (r.state === "finished" || r.state === "idle") done++;
    else working++;
  }
  return { asking, working, done };
}

/**
 * Its ring in the widget's solar system (jarvis-home.html #gOrbit): 0, the inner one, for an
 * agent asking you (or stopped on an error); 1 for one at work; 2, the dashed outer one, for one
 * done or waiting. (The Agents page will let you move them later.)
 */
export function orbitRing(r: Pick<AgentRow, "state" | "ask">): 0 | 1 | 2 {
  if (r.ask || r.state === "approval" || r.state === "question" || r.state === "error") return 0;
  if (r.state === "finished" || r.state === "idle") return 2;
  return 1;
}

/** Where on its ring: spread evenly among that ring's planets, turned a little per ring. */
export function orbitAngle(index: number, count: number, ring: number): number {
  return -Math.PI / 2 + ring * 0.9 + (index * 2 * Math.PI) / Math.max(1, count);
}

/**
 * How big Home's Agents widget is: one row high (2 × 1) while two agents or fewer run and none
 * asks you, so there's no empty space; two rows high (2 × 2) for more, or for the approval bar.
 */
export function agentsSize(rows: readonly Pick<AgentRow, "ask">[]): "wide" | "big" {
  return rows.length <= 2 && !rows.some((r) => r.ask) ? "wide" : "big";
}

/** Island → window: the service pills for Home's Connections widget (ConnectionRow[]). */
export const CONNECTIONS_SNAPSHOT = "connections-snapshot";

export interface ConnectionRow {
  id: string;
  name: string;
  color: string;
  /** What its pill's header says ("1.2k Total stars", "412.00 EUR"…), when it has data. */
  headline: string | null;
  /** Connected and without an error. */
  live: boolean;
}

/** Live ones first (with something to say before those without), then the rest, as they came. */
export function rankConnections<T extends Pick<ConnectionRow, "live" | "headline">>(rows: readonly T[]): T[] {
  const rank = (r: T) => (r.live ? (r.headline ? 0 : 1) : 2);
  return rows.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map(({ r }) => r);
}
