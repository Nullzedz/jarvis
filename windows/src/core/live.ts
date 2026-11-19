// JARVIS: the live code view's memory — what a Claude Code session is doing,
// step by step, from its hooks (island/hooks.ts):
// - Read: the file and where (offset)
// - Edit / MultiEdit / Write: the file and the text before and after
// - Bash / PowerShell: the command, then the end of its output (the relay's
//   `jarvis_output`, hook/src/main.rs)
// - anything else: its label.
// Kept per pill, a handful of steps, forgotten when the session ends.

export type LiveKind = "read" | "edit" | "command" | "search" | "other";
export type LiveStatus = "running" | "done" | "failed";

export interface LiveAction {
  kind: LiveKind;
  tool: string;
  /** Short label for the step list: "Read", "Edit", "Bash"… */
  label: string;
  /** Absolute path of the file read or edited. */
  file?: string;
  /** Read: the first line asked for (1-based), when given. */
  line?: number;
  /** Edit: the first replaced text, and what replaced it (Write: only `newText`). */
  oldText?: string;
  newText?: string;
  /** Command: what ran, and the end of its output once finished. */
  command?: string;
  output?: string;
  /** Search: the pattern or query. */
  query?: string;
  status: LiveStatus;
  at: number;
}

export interface LiveSession {
  actions: LiveAction[];
  cwd: string;
  startedAt: number;
  /** Set by Stop: the turn is over. */
  done: boolean;
}

const MAX_ACTIONS = 30;
const sessions = new Map<string, LiveSession>();

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

function kindOf(tool: string): LiveKind {
  if (tool === "Read" || tool === "view_file") return "read";
  if (tool === "Edit" || tool === "MultiEdit" || tool === "Write" || tool === "NotebookEdit" || tool === "write_to_file" || tool === "replace_file_content") return "edit";
  if (tool === "Bash" || tool === "PowerShell" || tool === "run_command") return "command";
  if (tool === "Grep" || tool === "Glob" || tool === "WebSearch" || tool === "search_web" || tool === "LS") return "search";
  return "other";
}

const LABELS: Record<LiveKind, string> = { read: "Read", edit: "Edit", command: "Bash", search: "Search", other: "" };

/** The action a PreToolUse describes. */
export function actionFrom(tool: string, input: Record<string, unknown>, now = Date.now()): LiveAction {
  const kind = kindOf(tool);
  const a: LiveAction = { kind, tool, label: LABELS[kind] || tool, status: "running", at: now };
  const file = str(input.file_path) ?? str(input.path) ?? str(input.notebook_path);
  if (file && (kind === "read" || kind === "edit")) a.file = file;
  if (kind === "read" && typeof input.offset === "number" && input.offset > 0) a.line = Math.floor(input.offset);
  if (kind === "edit") {
    const edits = Array.isArray(input.edits) ? (input.edits as Record<string, unknown>[]) : null;
    const first = edits?.[0] ?? input;
    a.oldText = str(first.old_string);
    a.newText = str(first.new_string) ?? str(input.content);
  }
  if (kind === "command") a.command = str(input.command);
  if (kind === "search") a.query = str(input.pattern) ?? str(input.query) ?? str(input.path);
  return a;
}

export function get(id: string): LiveSession | undefined {
  return sessions.get(id);
}

/** The step the view shows: the running one, else the last. */
export function current(id: string): LiveAction | undefined {
  const s = sessions.get(id);
  if (!s) return undefined;
  for (let i = s.actions.length - 1; i >= 0; i--) if (s.actions[i].status === "running") return s.actions[i];
  return s.actions[s.actions.length - 1];
}

/** A new turn: the old steps go, the session stays. */
export function turn(id: string, cwd: string, now = Date.now()) {
  const s = sessions.get(id);
  if (s) {
    s.actions = [];
    s.done = false;
    if (cwd) s.cwd = cwd;
  } else sessions.set(id, { actions: [], cwd, startedAt: now, done: false });
}

export function pre(id: string, cwd: string, tool: string, input: Record<string, unknown>, now = Date.now()) {
  let s = sessions.get(id);
  if (!s) {
    s = { actions: [], cwd, startedAt: now, done: false };
    sessions.set(id, s);
  }
  if (cwd) s.cwd = cwd;
  s.done = false;
  // A step still marked running when the next starts has finished (its Post may have been skipped).
  for (const a of s.actions) if (a.status === "running") a.status = "done";
  s.actions.push(actionFrom(tool, input, now));
  if (s.actions.length > MAX_ACTIONS) s.actions.splice(0, s.actions.length - MAX_ACTIONS);
}

/** The matching step finished: its output (commands) and the final text of an edit. */
export function post(id: string, tool: string, input: Record<string, unknown>, output: string | undefined, failed = false) {
  const s = sessions.get(id);
  if (!s) return;
  const a = [...s.actions].reverse().find((x) => x.tool === tool && x.status === "running") ?? [...s.actions].reverse().find((x) => x.tool === tool);
  if (!a) return;
  a.status = failed ? "failed" : "done";
  if (output != null && a.kind === "command") a.output = output;
  if (a.kind === "edit") {
    const fresh = actionFrom(tool, input, a.at);
    a.oldText = fresh.oldText ?? a.oldText;
    a.newText = fresh.newText ?? a.newText;
  }
}

export function stop(id: string) {
  const s = sessions.get(id);
  if (!s) return;
  for (const a of s.actions) if (a.status === "running") a.status = "done";
  s.done = true;
}

export function clear(id: string) {
  sessions.delete(id);
}

/** Whether the live view has something to show for this pill. */
export function active(id: string): boolean {
  const s = sessions.get(id);
  return !!s && s.actions.length > 0;
}

/** Tests only. */
export function reset() {
  sessions.clear();
}
