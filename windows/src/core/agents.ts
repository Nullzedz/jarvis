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
