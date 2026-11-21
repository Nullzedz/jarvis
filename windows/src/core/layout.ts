// Island geometry — ported from IslandTypes.swift + IslandWindowController.islandSize
// + IslandRootView.botPosition. All values are logical pixels, identical to the
// macOS app's points.

export type IslandMode = "hidden" | "compact" | "expanded";

export type IslandViewName =
  | "overview"
  | "empty"
  | "approval"
  | "question"
  | "error"
  | "finished"
  | "confused"
  | "upload"
  | "uploading"
  | "choose"
  | "mail"
  | "prompt"
  | "searching"
  | "result"
  | "note"
  | "settings"
  | "greeting"
  | "recap"
  | "wardrobe"
  | "update"
  | "whatsNew"
  | "launch"
  // JARVIS: the calendar tab (src/views/gcal.ts).
  | "calendar"
  // JARVIS: the live code view of a Claude Code session (src/views/live.ts).
  | "live"
  // JARVIS: the bigger notch's Reminders and Notes tabs (src/views/pocket.ts).
  | "reminders"
  | "notes"
  | "clipboard"
  // JARVIS: the prototype's Overview, its widget tiles (src/views/widgets.ts).
  | "widgets"
  // JARVIS: the Focus tab, and focus mode while a session runs (src/views/focus.ts).
  | "focus"
  | "focusing";

export type BotStateName =
  | "idle"
  | "working"
  | "thinking"
  | "searching"
  | "approval"
  | "question"
  | "error"
  | "finished"
  | "ratelimit"
  | "sleeping"
  | "dizzy";

export type BotEmoteName = "love" | "surprised" | "proud" | "wink" | "yawn" | "happy" | "annoyed";

export type AgentLayoutMode = "none" | "grid" | "pills" | "column";

export interface ViewLayout {
  height: number;
  botX: number;
  botY: number | null; // null = auto-centred
  botDiameter: number;
  agentMode: AgentLayoutMode;
}

// The window is a fixed 720×320 (largest view) like the macOS panel; the island is
// drawn inside it, glued to the top edge and horizontally centred.
export const PANEL_W = 720;
export const PANEL_H = 480; // JARVIS: room for a tab to grow to its content (was 320)

// No notch on a PC: these are the hidden/compact sizes from docs/SPEC.md.
export const NOTCH_W = 184;
export const NOTCH_H = 32;
// JARVIS: closed, the island is the live demo's small pill with only his visor in it
// (docs/jarvis/design/prototypes/jarvis-notch.html: 132 × 32, bottom corners fully round).
export const COMPACT_W = 132;
// JARVIS: the notch prototype's open width (jarvis-notch.html: #notch.open { width: 700px }).
export const EXPANDED_W = 700;
/** The greeting and the drop sequence are drawn in a 640-wide space: centred in the notch. */
export const STAGE_W = 640;

export const ROUNDED_CORNER = 26; // hidden / compact: the live demo's closed pill, 0 0 26 26
export const EXPANDED_CORNER = 30; // the live demo's open notch

/** Invisible hover strip that wakes the island when hidden. */
export const WAKE_STRIP_W = 240;
export const WAKE_STRIP_H = 6;

export const VIEW_LAYOUTS: Record<IslandViewName, ViewLayout> = {
  // JARVIS: the prototype's Home: his big visor (108 wide) in the left card, its middle 78 in and 102 down.
  overview: { height: 172, botX: 78, botY: 102, botDiameter: 104, agentMode: "pills" },
  empty: { height: 160, botX: 70, botY: null, botDiameter: 62, agentMode: "none" },
  approval: { height: 160, botX: 62, botY: null, botDiameter: 56, agentMode: "column" },
  question: { height: 160, botX: 62, botY: null, botDiameter: 56, agentMode: "column" },
  error: { height: 160, botX: 62, botY: null, botDiameter: 58, agentMode: "column" },
  finished: { height: 160, botX: 62, botY: null, botDiameter: 58, agentMode: "column" },
  confused: { height: 160, botX: 76, botY: null, botDiameter: 66, agentMode: "column" },
  upload: { height: 176, botX: 140, botY: 104, botDiameter: 62, agentMode: "column" },
  // botY 103 = bar top (42 + 58) + 3, so the dot really rides the bar. The Swift
  // layout says 118 while its own comment says 103; the comment matches the spec.
  uploading: { height: 176, botX: 46, botY: 103, botDiameter: 20, agentMode: "none" },
  choose: { height: 176, botX: 60, botY: 101, botDiameter: 52, agentMode: "column" },
  mail: { height: 240, botX: 56, botY: null, botDiameter: 46, agentMode: "column" },
  prompt: { height: 160, botX: 52, botY: null, botDiameter: 44, agentMode: "column" },
  searching: { height: 160, botX: 52, botY: null, botDiameter: 44, agentMode: "column" },
  result: { height: 160, botX: 52, botY: null, botDiameter: 44, agentMode: "column" },
  note: { height: 160, botX: 60, botY: null, botDiameter: 50, agentMode: "column" },
  settings: { height: 160, botX: 54, botY: null, botDiameter: 46, agentMode: "none" },
  greeting: { height: 150, botX: 320, botY: 90, botDiameter: 0, agentMode: "none" },
  // Mac: 160. The extra 24 hold the two lines with top agent, project, busiest
  // day, longest session, permissions and questions, which the Mac card leaves
  // to the shared image.
  recap: { height: 184, botX: 62, botY: null, botDiameter: 58, agentMode: "column" },
  wardrobe: { height: 160, botX: 68, botY: null, botDiameter: 58, agentMode: "none" },
  // New version: Mochi on the left, the version and Update now (Mac: .update).
  update: { height: 160, botX: 62, botY: null, botDiameter: 58, agentMode: "none" },
  // After an update: what the new version brings, then "Your Coucou so far".
  // Taller than a card, for two rows of items with their line.
  whatsNew: { height: 222, botX: 62, botY: null, botDiameter: 58, agentMode: "none" },
  // A new Claude Code session: Mochi on the left, the project and the prompt (Mac: .launch).
  launch: { height: 160, botX: 58, botY: null, botDiameter: 52, agentMode: "none" },
  // JARVIS: the calendar tab. The character steps aside (botPosition) to leave the whole width to the day or week.
  calendar: { height: 214, botX: 46, botY: 16, botDiameter: 6, agentMode: "none" },
  // JARVIS: the live code view, one file card — his eye small in the card's header, top left.
  live: { height: 252, botX: 44, botY: 58, botDiameter: 22, agentMode: "none" },
  // JARVIS: Reminders and Notes. Like the calendar, he steps aside to leave them the width.
  reminders: { height: 214, botX: 46, botY: 16, botDiameter: 6, agentMode: "none" },
  notes: { height: 214, botX: 46, botY: 16, botDiameter: 6, agentMode: "none" },
  clipboard: { height: 214, botX: 46, botY: 16, botDiameter: 6, agentMode: "none" },
  widgets: { height: 214, botX: 46, botY: 16, botDiameter: 6, agentMode: "none" },
  focus: { height: 160, botX: 46, botY: 16, botDiameter: 6, agentMode: "none" },
  focusing: { height: 214, botX: 46, botY: 16, botDiameter: 6, agentMode: "none" },
};

// The upload views above are only the fallback geometry. Once a file is actually
// dropped the whole sequence — Mochi included — is drawn by src/upload, which
// owns its own constants (USC) straight from UploadSequenceEngine.swift.

/** JARVIS: the live code view folded to its summary once the session is done. */
export const LIVE_FOLDED_H = 128;

/** The question view with options to pick from: room for two rows of them. */
export const QUESTION_PICKER_H = 200;

/** Chat view grows with the conversation — IslandContainer.chatPromptHeight. */
export function chatPromptHeight(messageCount: number): number {
  return Math.min(300, 240 + messageCount * 40);
}

export function islandSize(
  mode: IslandMode,
  view: IslandViewName,
  chatCount = 0,
): { w: number; h: number } {
  switch (mode) {
    case "hidden":
      // No notch to hide inside on a PC: the island retracts to zero height and
      // slides into the top edge of the screen instead of sitting there as a bar.
      return { w: NOTCH_W, h: 0 };
    case "compact":
      return { w: COMPACT_W, h: NOTCH_H };
    case "expanded": {
      const h = view === "prompt" ? chatPromptHeight(chatCount) : VIEW_LAYOUTS[view].height;
      return { w: EXPANDED_W, h };
    }
  }
}

export interface BotPlacement {
  cx: number;
  cy: number;
  diameter: number;
  opacity: number;
}

/** IslandRootView.botPosition — cy is measured from the island's top edge. */
export function botPosition(
  mode: IslandMode,
  view: IslandViewName,
  islandH: number,
  uploadProgress = 0,
): BotPlacement {
  switch (mode) {
    case "hidden":
      return { cx: 46, cy: 16, diameter: 6, opacity: 0 };
    case "compact":
      // JARVIS: his visor alone, in the middle of the closed pill.
      return { cx: COMPACT_W / 2, cy: 16, diameter: 20, opacity: 1 };
    case "expanded": {
      const layout = VIEW_LAYOUTS[view];
      // The full-width tabs: he steps aside, out of sight.
      if (view === "calendar" || view === "reminders" || view === "notes" || view === "clipboard" || view === "widgets" || view === "focus" || view === "focusing") {
        return { cx: layout.botX, cy: layout.botY ?? 16, diameter: layout.botDiameter, opacity: 0 };
      }
      if (view === "uploading") {
        return {
          cx: (EXPANDED_W - STAGE_W) / 2 + 36 + uploadProgress * 526,
          cy: layout.botY ?? 103,
          diameter: layout.botDiameter,
          opacity: 1,
        };
      }
      if (layout.botY != null) {
        return { cx: layout.botX, cy: layout.botY, diameter: layout.botDiameter, opacity: 1 };
      }
      // Centre of the fixed 84 pt card (8 pt top inset + 34 pt header → content at y = 42)
      const headerBottom = 42;
      const cardH = 84;
      const cy = headerBottom + (islandH - headerBottom - cardH) / 2 + cardH / 2;
      return { cx: layout.botX, cy, diameter: layout.botDiameter, opacity: 1 };
    }
  }
}

export function botGlowColor(s: BotStateName): string {
  switch (s) {
    case "working":
      return "#3B9EFF";
    case "thinking":
      return "#A78BFA";
    case "searching":
      return "#6366F1";
    case "approval":
      return "#F5A524";
    case "error":
      return "#F4505E";
    case "finished":
      return "#34D399";
    case "ratelimit":
      return "#F59E0B";
    default:
      return "#FFFFFF";
  }
}

export function botGlowOpacity(s: BotStateName): number {
  switch (s) {
    case "idle":
    case "sleeping":
      return 0.15;
    case "dizzy":
      return 0;
    default:
      return 0.65;
  }
}

// Project colours (IslandConst.projectColors)
const PROJECT_COLORS: Record<string, string> = {
  korus: "#FF5A4E",
  "sbe hub": "#2EC4A0",
  "morning ai brief": "#F29B38",
  "publication ig": "#7C5CFF",
  "ig post": "#7C5CFF",
  "louisraille.fr": "#38BDF8",
  louisraille: "#38BDF8",
  "notch buddy": "#EC4899",
  "notch-buddy": "#EC4899",
  notchbuddy: "#EC4899",
};

const FALLBACK_COLORS = ["#22C55E", "#EAB308", "#60A5FA", "#E879F9"];

export function colorForProject(name: string): string {
  const key = name.toLowerCase().trim();
  const exact = PROJECT_COLORS[key];
  if (exact) return exact;
  for (const [k, c] of Object.entries(PROJECT_COLORS)) {
    if (key.startsWith(k) || key.includes(k)) return c;
  }
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length];
}

// Card wash colours (CardBackground.washColor)
export type Wash = "red" | "green" | "pink" | "amber" | "cyan" | "indigo" | "soft" | null;

export function washRGBA(wash: Wash): string {
  switch (wash) {
    case "red":
      return "rgba(244,80,94,0.55)";
    case "green":
      return "rgba(52,211,153,0.5)";
    case "pink":
      return "rgba(244,114,182,0.55)";
    case "amber":
      return "rgba(245,165,36,0.42)";
    case "cyan":
      return "rgba(34,211,238,0.38)";
    case "indigo":
      return "rgba(99,102,241,0.5)";
    case "soft":
      return "rgba(255,255,255,0.08)";
    default:
      return "rgba(0,0,0,0)";
  }
}
