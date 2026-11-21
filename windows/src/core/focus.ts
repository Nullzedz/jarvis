// JARVIS: a focus session (step 10 of #22; the notch prototype's Focus). Kept in the island's
// storage so a reload doesn't end it. Pure helpers tested in tests/focus.test.mjs; drawn by
// src/views/focus.ts; ended on time by src/island/island.ts.

export interface FocusSession {
  /** Unix ms. */
  startedAt: number;
  minutes: number;
}

/** The prototype's lengths, in its order. */
export const FOCUS_LENGTHS = [25, 50, 15] as const;

const KEY = "jarvis.focus";
const LEN_KEY = "jarvis.focus.length";

export function focusLeftMs(f: FocusSession, now: number): number {
  return Math.max(0, f.startedAt + f.minutes * 60_000 - now);
}

/** How much of it is done, 0…1 (the ring's progress). */
export function focusDone(f: FocusSession, now: number): number {
  return 1 - focusLeftMs(f, now) / (f.minutes * 60_000);
}

/** "18:40" for 18 min 40 s; "1:05:00" past an hour. */
export function clockText(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function read(): FocusSession | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return v && typeof v.startedAt === "number" && typeof v.minutes === "number" ? v : null;
  } catch {
    return null;
  }
}

export const Focus = {
  /** The session running now, if any (one that ran out is still returned until it's ended). */
  get: (): FocusSession | null => read(),
  start(minutes: number, now = Date.now()): FocusSession {
    const f = { startedAt: now, minutes };
    try { localStorage.setItem(KEY, JSON.stringify(f)); } catch { /* kept for this run only */ }
    session = f;
    return f;
  },
  stop() {
    try { localStorage.removeItem(KEY); } catch { /* nothing kept */ }
    session = null;
  },
  /** The length picked last (the Focus tab remembers it). */
  get length(): number {
    try {
      const n = Number(localStorage.getItem(LEN_KEY));
      return (FOCUS_LENGTHS as readonly number[]).includes(n) ? n : 25;
    } catch {
      return 25;
    }
  },
  set length(n: number) {
    try { localStorage.setItem(LEN_KEY, String(n)); } catch { /* not remembered */ }
  },
};

// Without storage (a private profile), the session still lives for this run.
let session: FocusSession | null = null;
const readStored = Focus.get;
Focus.get = () => readStored() ?? session;
