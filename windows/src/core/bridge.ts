// Thin wrapper over the Tauri commands/events. Every call is a no-op when the
// page is opened in a plain browser, so the island can be iterated on with
// `npm run dev` alone.

import { invoke } from "@tauri-apps/api/core";
import type { DayMessage } from "../hub/pages/mail-home";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { Settings } from "./state";
import type { RecapHistory, RecapPrefs } from "../recap/summary";
import type { SpotifyState } from "./spotify";
import type { UpdateStatus } from "./update";
import type { WaIslandView, WaSettingsView, WaTestResult } from "./whatsapp";

/** JARVIS: a step of voice training (voice/print.rs TrainEvent). */
export interface TrainEvent {
  phase: "listening" | "retry" | "done" | "error";
  count: number;
  total: number;
  prompt: string;
  message: string;
}

/** JARVIS: the Kokoro voice model (tts.rs). */
export type VoiceModelState =
  | { state: "missing" }
  | { state: "downloading"; fraction: number }
  | { state: "ready" }
  | { state: "failed"; error: string };

export interface VoiceModel {
  status: VoiceModelState;
  voices: { id: string; name: string }[];
  size: number;
}

/** JARVIS: lines of a file around where Claude works (live.rs Window). */
export interface LiveWindow {
  lines: string[];
  start: number;
  total: number;
  focusStart: number;
  focusEnd: number;
}

export const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** JARVIS: one copy in the island's clipboard history (clipboard_history.rs). */
export interface ClipEntry {
  id: number;
  kind: "text" | "image";
  /** The text; for an image, its size ("1280 × 720"). */
  text: string;
  at: number;
  pinned: boolean;
  /** An image's small picture, a data: URL. */
  thumb: string | null;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!IS_TAURI) return null;
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    console.error(`[jarvis] ${cmd} failed`, err);
    return null;
  }
}

export interface BootInfo {
  settings: Settings;
  /** Logical screen rect of the monitor the island lives on. */
  screen: { x: number; y: number; width: number; height: number; scale: number };
  version: string;
  hookPath: string;
  /** False where the OS has no global cursor (Wayland): see Island.followPageCursor. */
  cursorPoll: boolean;
}

/** The phone link (src-tauri/src/phone_link): how it is, never its secrets. */
export interface PhoneLinkStatus {
  enabled: boolean;
  running: boolean;
  port: number;
  host: string;
  name: string;
  clients: number;
  error: string | null;
  /** The relay connection ("Away from home Wi-Fi"). */
  relayState: PhoneRelayState;
}

export type PhoneRelayState = "off" | "connecting" | "waiting" | "linked" | "accessRefused" | "unreachable" | "roomTaken" | "tooMany";

/** The relay switch and address. The access key is write-only: only whether one is stored comes back. */
export interface PhoneRelayStatus {
  enabled: boolean;
  url: string;
  hasAccess: boolean;
  state: PhoneRelayState;
  /** The relay settings are shown: for testers (JARVIS_RELAY_SETTINGS=1), or when a relay is already on. */
  shown: boolean;
}

/** Session details for the phone: the switch (off by default). */
export interface PhoneDetailsStatus {
  enabled: boolean;
}

/** Chat from the phone: the switch and the models the phone may use ("provider/model"). */
export interface PhoneChatStatus {
  enabled: boolean;
  models: string[];
}

/** What the settings window shows to pair a phone. Only the settings window may ask. */
export interface PhoneLinkPairing {
  link: string;
  qrSvg: string;
  host: string;
  port: number;
  name: string;
  /** The relay's host when this link also carries the relay fields. */
  relay: string | null;
}

/** One session as the phone sees it; Rust stamps `updatedAt`. */
export interface PhoneLinkSession {
  pillId: string;
  agent: string;
  state: string;
  statusText: string;
  stepIndex: number;
  stepCount: number;
  /** Details, for a phone that has the capability (the user's switch). */
  steps?: string[];
  finalLine?: string;
  /** A folder name, never a path. */
  project?: string;
  color?: string;
  /** The files this session changed, for a phone that has `diffs` (Rust cuts them to a name and a count). */
  files?: PhoneLinkFile[];
}

export interface PhoneLinkFile {
  id: number;
  /** A file name; Rust keeps only its last segment. */
  name: string;
  added: number;
  removed: number;
  tooLarge?: boolean;
  isNew?: boolean;
}

/** One file's diff for the phone that asked: lines as [kind, text], kind "+", "-", " " or "@" (a hunk's first line). */
export interface PhoneLinkDiff {
  pillId: string;
  fileId: number;
  name: string;
  added: number;
  removed: number;
  tooLarge: boolean;
  gone: boolean;
  lines: [string, string][];
}

/** One plan window for the phone: used percentage (as the island has it) and when it resets (epoch ms). */
export interface PhoneLinkWindow {
  usedPct: number;
  resetsAt: number;
}

export interface PhoneLinkPlan {
  fiveHour?: PhoneLinkWindow;
  sevenDay?: PhoneLinkWindow;
  resetCredits?: number;
  planType?: string;
  updatedAt: number;
}

export interface PhoneLinkUsage {
  claude: PhoneLinkPlan | null;
  codex: PhoneLinkPlan | null;
}

/**
 * Last week's recap as the phone gets it: counts, the week's Monday and the busiest agent's name (cap `recap`). The project is a folder name that
 * Rust sends only to a phone that also may see session details. A week with no session is not sent: all zero clears the phone's card.
 */
export interface PhoneLinkRecap {
  /** The Monday that starts the week, YYYY-MM-DD (local). */
  week: string;
  minutes: number;
  sessions: number;
  files: number;
  linesAdded: number;
  linesRemoved: number;
  commands: number;
  allowed: number;
  denied: number;
  topAgent?: string;
  topProject?: string;
}

/** What one service pill says, for a phone whose user allowed it (Rust cuts every text to size). */
export interface PhoneLinkService {
  id: string;
  title: string;
  headline: string;
  reason?: string;
  items: { label: string; detail: string }[];
}

export interface PhoneServicesStatus {
  /** The services allowed for the phone. */
  services: string[];
}

export interface PhoneUsageStatus {
  enabled: boolean;
}

export interface PhoneRecapStatus {
  enabled: boolean;
}

export interface PhoneDiffsStatus {
  enabled: boolean;
}

export interface PhoneLinkApproval {
  requestId: string;
  sessionId: string;
  pillId: string;
  tool: string;
  command: string;
}

/** The question Claude Code is waiting on, for a phone that may answer it (phone_link/hub.rs). */
export interface PhoneLinkQuestion {
  requestId: string;
  sessionId: string;
  pillId: string;
  questions: { question: string; options: { label: string; description: string }[]; multiSelect: boolean }[];
}

export interface PhoneAnswersStatus {
  enabled: boolean;
}

export const Bridge = {
  boot: () => call<BootInfo>("boot"),
  // JARVIS: Google Calendar, read-only (src-tauri/src/gcal.rs). The secret link never comes back here.
  gcalConnected: () => call<boolean>("gcal_connected"),
  gcalConnect: (url: string) => callOrThrow<void>("gcal_connect", { url }),
  gcalDisconnect: () => call<void>("gcal_disconnect"),
  gcalFetch: () => callOrThrow<string>("gcal_fetch"),
  // JARVIS: a few lines of the file a Claude Code session works on (src-tauri/src/live.rs).
  // JARVIS: his own voice, Kokoro on this computer (src-tauri/src/tts.rs).
  voiceModel: () => call<VoiceModel>("voice_model"),
  voiceModelDownload: () => call<void>("voice_model_download"),
  voiceModelRemove: () => call<void>("voice_model_remove"),
  /** Loads the voice and renders `voice`'s preview in the background, so ▶ is instant. */
  voiceWarmUp: (voice: string) => call<void>("voice_warm_up", { voice }),
  // JARVIS: voice training (src-tauri/src/voice/print.rs).
  voicePrintStatus: () => call<{ trained: boolean; takes: number; training: boolean }>("voice_print_status"),
  voiceTrainStart: () => callOrThrow<void>("voice_train_start"),
  voiceTrainCancel: () => call<void>("voice_train_cancel"),
  voicePrintForget: () => call<void>("voice_print_forget"),
  /** Starts (or keeps alive) the Settings loudness bar on `mic` ("" = automatic); stops 5 s after the last call. */
  micMeter: (mic: string) => call<void>("mic_meter", { mic }),
  micMeterStop: () => call<void>("mic_meter_stop"),
  /** A short line in `voice`, as WAV bytes. */
  voicePreview: (voice: string) => callOrThrow<ArrayBuffer>("voice_preview", { voice }),
  /** JARVIS: a short line in a Gemini voice (WAV), with the saved key. */
  geminiPreview: (voice: string) => callOrThrow<ArrayBuffer>("gemini_preview", { voice }),
  /** JARVIS: whether the saved Gemini key works: "ok", "none", "key" (refused) or "network". */
  geminiKeyCheck: () => call<string>("gemini_key_check"),
  /** JARVIS: fetch a Gemini voice's sample in the background, so ▶ is instant. */
  geminiWarmUp: (voice: string) => call<void>("gemini_warm_up", { voice }),
  /** JARVIS: Piper, the offline backup voice (voice/piper.rs): its download, and a sample. */
  /** JARVIS: the type-to-ask box (voice/ask.rs). */
  askSend: (question: string) => call<void>("ask_send", { question }),
  askClose: () => call<void>("ask_close"),
  /** Opens the box from the front page, without a picture of the screen. */
  askOpen: () => call<void>("ask_open"),
  /** The main window's own controls (it has no title bar). */
  hubWindow: (action: "minimize" | "maximize" | "close" | "drag") => call<void>("hub_window", { action }),
  /** JARVIS: the island's clipboard history, newest first (in memory only). */
  clipboardHistory: () => call<ClipEntry[]>("clipboard_history"),
  /** JARVIS: his last answer, in memory only (last_answer.rs); null until he has answered. */
  lastAnswer: () => call<string | null>("last_answer"),
  /** JARVIS: today's conversation, oldest first, in memory only (last_answer.rs). */
  conversation: () => call<{ you: string; him: string; at: number }[]>("conversation"),
  /** JARVIS: send your voice's level (`voice-level`) while the JARVIS page shows its waveform. */
  voiceLevelWatch: (on: boolean) => call<void>("voice_level_watch", { on }),
  /**
   * JARVIS: the JARVIS page's microphone: a tap of the talk keys (hands-free; again, it stops). It
   * opens the microphone while the page is open even with background listening off; "model" when
   * he can't hear you yet (no voice model, or no Claude).
   */
  voiceTap: () => call<"ok" | "model">("voice_tap"),
  /** JARVIS: the windows he drew (his_windows.rs), in memory only. */
  hisWindows: () => call<HisWindows>("his_windows"),
  /** JARVIS: this month's mail counts for Home (mail_month): per day, today per hour; null without Outlook. */
  mailMonth: () => call<MailMonth | null>("mail_month"),
  /** The Mail page's month, `offset` months from this one (-1: last month). */
  mailMonthAt: (offset: number) => call<MailMonth | null>("mail_month_at", { offset }),
  /** One day's messages ("yyyy-MM-dd"), newest first, with their files and whether a VIP sent them. */
  mailDay: (date: string) => call<{ messages: DayMessage[] } | null>("mail_day", { date }),
  clipboardUse: (id: number) => call<boolean>("clipboard_use", { id }),
  clipboardPin: (id: number, on: boolean) => call<void>("clipboard_pin", { id, on }),
  clipboardClear: () => call<void>("clipboard_clear"),
  /** Forgets one copy (swiped away in the island). */
  clipboardRemove: (id: number) => call<void>("clipboard_remove", { id }),
  /** The right press about to open the webview's menu was on this Home square (null: elsewhere). */
  contextZone: (slot: number | null) => call<void>("context_zone", { slot }),
  /** Seconds since the last keyboard or mouse input on the PC (src-tauri/src/presence.rs). */
  userIdleSeconds: () => call<number>("user_idle_seconds"),
  /** Whether anything plays music in Windows' media panel; "music-playing" says when it changes. */
  musicPlaying: () => call<boolean>("music_playing"),
  /** What a music app plays now (Apple Music, Spotify…; never a browser); "now-playing" says when it changes. */
  nowPlaying: () => call<NowPlaying | null>("now_playing"),
  /** ⏮ ⏯ ⏭ on that player. */
  mediaControl: (action: "previous" | "playPause" | "next") => call<boolean>("media_control", { action }),
  askResize: (height: number) => call<void>("ask_resize", { height }),
  /** JARVIS: where the explanation windows are (page px), so only they take the mouse. */
  explainHot: (rects: [number, number, number, number][]) => call<void>("explain_hot", { rects }),
  /** JARVIS: window `draw` drawn again: in a form not in `tried`, or the same one with `fix` (its text overlapped). Comes back as `explain-drawn`. */
  explainRedraw: (draw: number, tried: string[], fix: string | null) => call<void>("explain_redraw", { draw, tried, fix }),
  /** JARVIS: who can draw his windows (Settings → Voice → Windows), issue #14. */
  drawModels: () => call<DrawModel[]>("draw_models"),
  /** JARVIS: the explanation windows take typing only while their reply bar is used (issue #16). */
  explainFocus: (on: boolean) => call<void>("explain_focus", { on }),
  /** JARVIS: a follow-up typed in window `card`; the answer comes back as `explain-answer`. */
  explainAsk: (card: number, question: string) => call<void>("explain_ask", { card, question }),
  /** JARVIS: the first-launch tutorial (#90) ends, finished or skipped: its window closes and it isn't shown on its own again. */
  tutorialClose: () => call<void>("tutorial_close"),
  /** The tour's last steps (#102): your profile, your passkey (kept only as a salted hash), your AI. */
  profileSave: (name: string, address: string) => call<void>("profile_save", { name, address }),
  passkeySet: (pin: string) => call<void>("passkey_set", { pin }),
  /** "terminal": its sign-in opened in a terminal; "install": its install page opened. */
  subscriptionSignIn: (provider: string) => call<string>("subscription_sign_in", { provider }),
  /** JARVIS: shows the first-launch tutorial again (Settings › General). */
  tutorialOpen: () => call<void>("tutorial_open"),
  /** JARVIS (#92): the island's reminders, notes and today's calendar, in words, for his voice. */
  pocketSnapshot: (text: string) => call<void>("pocket_snapshot", { text }),
  /** JARVIS: a key pressed or let go in the tutorial's window (KeyboardEvent.code). */
  tutorialKey: (code: string, down: boolean) => call<void>("tutorial_key", { code, down }),
  piperModel: () => call<{ status: VoiceModelState; size: number }>("piper_model"),
  piperModelDownload: () => call<void>("piper_model_download"),
  piperModelRemove: () => call<void>("piper_model_remove"),
  piperPreview: () => callOrThrow<ArrayBuffer>("piper_preview"),
  liveRead: (path: string, cwd: string, find: string | null, line: number | null) =>
    callOrThrow<LiveWindow>("live_read", { path, cwd, find, line }),
  /** The system's languages as the webview sees them, for Rust's own texts (i18n.rs). */
  setSystemLanguages: (languages: string[]) => call<void>("set_system_languages", { languages }),

  saveSettings: (settings: Settings) => call<void>("save_settings", { settings }),

  /** Shrink the window down to the invisible wake strip (hidden) or back to full. */
  /** Folds the window to `width`×`height` (the closed island) or grows it back to the panel. */
  setCollapsed: (collapsed: boolean, width?: number, height?: number) =>
    call<void>("set_collapsed", { collapsed, width: width ?? null, height: height ?? null }),

  /**
   * Pushes the island shape in window coordinates. Rust flips click-through from
   * its own cursor poll, so the flag is never a frame behind a click.
   */
  setIslandRect: (x: number, y: number, width: number, height: number) =>
    call<void>("set_island_rect", { x, y, width, height }),

  /** Give the window keyboard focus (chat field) and take it away again. */
  focusWindow: (focused: boolean) => call<void>("focus_window", { focused }),

  reposition: () => call<void>("reposition"),
  fitZoom: (dpr: number) => call<boolean>("fit_zoom", { dpr }),

  /** Displays the island can be pinned to: `key` is what `settings.screen` stores. */
  listMonitors: () => call<{ key: string; label: string }[]>("list_monitors"),

  openUrl: (url: string) => call<void>("open_url", { url }),
  /** Opens a GitLab link only when it belongs to the configured instance. */
  openGitLabUrl: (url: string) => call<void>("open_gitlab_url", { url }),
  /** Opens the configured Gitea instance without exposing its URL to the page. */
  openGitea: () => call<void>("open_gitea"),
  /** Opens a Gitea link only if it belongs to the configured instance. */
  openGiteaUrl: (url: string) => call<void>("open_gitea_url", { url }),

  /** Which of these sounds have a file of the user's own in the sounds folder. */
  customSounds: (names: readonly string[]) => call<string[]>("custom_sounds", { names }),
  /** The user's file for one sound, as raw bytes. */
  customSound: (name: string) => call<ArrayBuffer>("custom_sound", { name }),
  revealSoundsFolder: () => call<void>("reveal_sounds_folder"),
  /** Tells the island to read the sounds folder again ("sounds-changed"). */
  reloadSounds: () => call<void>("reload_sounds"),

  /** "Open terminal" → opens the folder in VS Code when `code` is on PATH. */
  openInVSCode: (path: string | null) => call<boolean>("open_in_vscode", { path }),

  /**
   * "Open terminal": the window the session runs in when Rust found it
   * (Windows; Linux on X11 and KDE Plasma), else the folder in VS Code.
   */
  openSession: (sessionId: string | null, path: string | null) =>
    call<boolean>("open_session", { sessionId, path }),

  /** The Claude desktop app, for the Claude Desktop pill (Windows only). */
  openClaudeDesktop: () => call<boolean>("open_claude_desktop"),

  /**
   * A new Claude Code session: the user's terminal in `folder`, running
   * Claude Code with the prompt (src-tauri/src/launch.rs). False when it couldn't.
   */
  launchSession: (folder: string, prompt: string) => call<boolean>("launch_session", { folder, prompt }),

  /** The system's folder picker, `start` open in it; null when cancelled. */
  pickFolder: (start: string | null) => call<string | null>("pick_folder", { start }),

  /**
   * A file dropped on a session: its window comes forward and the paths are
   * pasted into it. "pasted", "copied" (on the clipboard only) or "failed".
   */
  dropIntoSession: (sessionId: string, path: string | null, paths: string[]) =>
    call<"pasted" | "copied" | "failed">("drop_into_session", { sessionId, path, paths }),

  /** The diff card's ↗: an existing file, in VS Code; never launched by its type. */
  openFileInVSCode: (path: string) => call<boolean>("open_file_in_vscode", { path }),

  quit: () => call<void>("quit_app"),

  openSettingsWindow: () => call<void>("open_settings_window"),

  /** Writes to %LOCALAPPDATA%\JARVIS\jarvis.log, next to the Rust lines. */
  log: (message: string) => call<void>("log_line", { message }),

  // ── Claude Code hooks ─────────────────────────────────────────────────────
  hooksStatus: () => call<HookStatus>("hooks_status"),
  /** Pill ID → whether that agent's hooks reach JARVIS (read-only, Mac #183). */
  agentHooksStatus: () => call<Record<string, boolean>>("agent_hooks_status"),
  /** Diff to show before anything is written. `install: false` previews removal. */
  hooksPreview: (install: boolean) => callOrThrow<HookPreview>("hooks_preview", { install }),
  /**
   * Writes ~/.claude/settings.json — only ever after an explicit click, and only
   * when the file still matches the preview the user looked at.
   */
  hooksApply: (install: boolean, fingerprint: string) =>
    callOrThrow<string>("hooks_apply", { install, fingerprint }),

  // ── Other agents (Gemini CLI, Codex, Cursor…) ─────────────────────────────
  agentHooksList: () => call<AgentHookStatus[]>("agent_hooks_list"),
  /** Diff to show before anything is written. `install: false` previews removal. */
  agentHooksPreview: (agent: string, install: boolean) =>
    callOrThrow<AgentHookPlan>("agent_hooks_preview", { agent, install }),
  /**
   * Writes the agent's config — only ever after an explicit click, and only when
   * it still matches the preview the user looked at. Returns the backups taken.
   */
  agentHooksApply: (agent: string, install: boolean, fingerprint: string) =>
    callOrThrow<string>("agent_hooks_apply", { agent, install, fingerprint }),
  /** Settings → Agents → Antigravity → Approve commands from the notch, and whether its hooks can wait. */
  agyApprovalsStatus: () => call<AgyApprovalsStatus>("agy_approvals_status"),
  /** Off by default; only from the switch in Settings. */
  agyApprovalsSetEnabled: (enabled: boolean) =>
    callOrThrow<AgyApprovalsStatus>("agy_approvals_set_enabled", { enabled }),
  // ── Plan usage: the status line relay, installed apart from the hooks ──────
  /** Diff of the status line change. `install: false` previews taking the relay out. */
  statusLinePreview: (install: boolean) => callOrThrow<HookPreview>("status_line_preview", { install }),
  /** Same rules as hooksApply: an explicit click, and only for the diff that was shown. */
  statusLineApply: (install: boolean, fingerprint: string) =>
    callOrThrow<string>("status_line_apply", { install, fingerprint }),
  /**
   * Asks the Codex CLI (`codex app-server`) for its plan limits, as Codex's
   * /status does. The raw `account/rateLimits/read` result, or null when Codex
   * is missing, not signed in or slow (15 s).
   */
  codexPlanUsage: () => call<unknown>("codex_plan_usage"),
  /** JARVIS: Claude's plan limits (the status line's `rate_limits` shape), from one tiny Claude Code question. */
  claudePlanUsage: () => call<unknown>("claude_plan_usage"),

  approvalDecision: (requestId: string, decision: "allow" | "deny") =>
    call<void>("approval_decision", { requestId, decision }),
  /** "The card is up" — until this lands the relay only waits a moment. */
  approvalAck: (requestId: string) => call<void>("approval_ack", { requestId }),
  /** Answers a question Claude Code asked: question text → chosen label. */
  approvalAnswer: (requestId: string, answers: Record<string, string | string[]>) =>
    call<void>("approval_answer", { requestId, answers }),

  /** "Nobody can act on this" — Claude Code asks in the terminal right away. */
  approvalDecline: (requestId: string) => call<void>("approval_decline", { requestId }),

  // ── Phone link (JARVIS for Android) ───────────────────────────────────────
  phoneLinkStatus: () => call<PhoneLinkStatus>("phone_link_status"),
  /** Only ever from the switch in Settings. Throws with the reason if it cannot start. */
  phoneLinkSetEnabled: (enabled: boolean) => callOrThrow<PhoneLinkStatus>("phone_link_set_enabled", { enabled }),
  phoneLinkPairing: () => callOrThrow<PhoneLinkPairing>("phone_link_pairing"),
  /** A new code: the phone that had the old one is disconnected. */
  phoneLinkNewPairing: () => callOrThrow<PhoneLinkPairing>("phone_link_new_pairing"),
  phoneDetailsStatus: () => call<PhoneDetailsStatus>("phone_details_status"),
  /** Off by default; only from the switch in Settings. Phones are reconnected so they learn about it. */
  phoneDetailsSetEnabled: (enabled: boolean) => callOrThrow<PhoneDetailsStatus>("phone_details_set_enabled", { enabled }),
  phoneAnswersStatus: () => call<PhoneAnswersStatus>("phone_answers_status"),
  /** Off by default; only from the switch in Settings. Phones are reconnected so they learn about it. */
  phoneAnswersSetEnabled: (enabled: boolean) => callOrThrow<PhoneAnswersStatus>("phone_answers_set_enabled", { enabled }),
  phoneDiffsStatus: () => call<PhoneDiffsStatus>("phone_diffs_status"),
  /** Off by default; only from the switch in Settings. Phones are reconnected so they learn about it. */
  phoneDiffsSetEnabled: (enabled: boolean) => callOrThrow<PhoneDiffsStatus>("phone_diffs_set_enabled", { enabled }),
  /** The answer to a phone's request for a file's diff (the "phone-link-getdiff" event); `conn` says which phone. */
  phoneLinkSendDiff: (conn: number, diff: PhoneLinkDiff) => call<void>("phone_link_send_diff", { conn, diff }),
  phoneServicesStatus: () => call<PhoneServicesStatus>("phone_services_status"),
  /** None by default; only from the ticks in Settings. Phones are reconnected so they learn about it. */
  phoneServicesSet: (services: string[]) => callOrThrow<PhoneServicesStatus>("phone_services_set", { services }),
  phoneLinkPublishServices: (services: PhoneLinkService[]) => call<void>("phone_link_publish_services", { services }),
  phoneRelayStatus: () => call<PhoneRelayStatus>("phone_relay_status"),
  /** Off by default; needs a valid wss:// address and a stored access key. */
  phoneRelaySet: (enabled: boolean, url: string) => callOrThrow<PhoneRelayStatus>("phone_relay_set", { enabled, url }),
  /** Write-only: stored in the OS keystore, never sent back. An empty value clears it. */
  phoneRelaySetAccess: (access: string) => callOrThrow<PhoneRelayStatus>("phone_relay_set_access", { access }),
  phoneUsageStatus: () => call<PhoneUsageStatus>("phone_usage_status"),
  /** Off by default; only from the switch in Settings. Phones are reconnected so they learn about it. */
  phoneUsageSetEnabled: (enabled: boolean) => callOrThrow<PhoneUsageStatus>("phone_usage_set_enabled", { enabled }),
  phoneLinkPublishUsage: (usage: PhoneLinkUsage) => call<void>("phone_link_publish_usage", { usage }),
  phoneRecapStatus: () => call<PhoneRecapStatus>("phone_recap_status"),
  phoneRecapSetEnabled: (enabled: boolean) => callOrThrow<PhoneRecapStatus>("phone_recap_set_enabled", { enabled }),
  phoneLinkPublishRecap: (recap: PhoneLinkRecap | null) => call<void>("phone_link_publish_recap", { recap: recap ?? {} }),
  phoneChatStatus: () => call<PhoneChatStatus>("phone_chat_status"),
  /** Off by default; only from the switch in Settings. Phones are reconnected so they learn about it. */
  phoneChatSetEnabled: (enabled: boolean) => callOrThrow<PhoneChatStatus>("phone_chat_set_enabled", { enabled }),
  phoneChatSetModels: (models: string[]) => callOrThrow<PhoneChatStatus>("phone_chat_set_models", { models }),
  phoneLinkPublish: (sessions: PhoneLinkSession[], approval: PhoneLinkApproval | null) =>
    call<void>("phone_link_publish", { sessions, approval }),
  phoneLinkPublishQuestion: (question: PhoneLinkQuestion | null) => call<void>("phone_link_publish_question", { question }),
  /** What Mochi wears ("auto" or an outfit), for phones that asked for it. */
  phoneLinkPublishPrefs: (outfit: string) => call<void>("phone_link_publish_prefs", { outfit }),

  // ── Chat, files, secrets ──────────────────────────────────────────────────
  /** One chat turn. The API key and any file bytes never leave Rust. */
  chatSend: (query: string, context: ChatContext | null, mail = false) =>
    callOrThrow<{ text: string }>("chat_send", { query, context, mail }),
  chatReset: () => call<void>("chat_reset"),
  /**
   * The models a provider offers, for the picker in the chat view. Rust asks
   * the provider only when it has a key (or a server address).
   */
  chatModels: (provider: string) => callOrThrow<ModelInfo[]>("chat_models", { provider }),
  claudeApiModels: () => callOrThrow<ModelInfo[]>("claude_api_models"),
  /** Settings → Local models → Connect: does the server answer, and with which models? */
  /** The custom server's key, bound to the address it is entered for. */
  localSetKey: (url: string, key: string) => call<void>("local_set_key", { url, key }),

  localConnect: (provider: "ollama" | "lmstudio" | "custom", url: string) =>
    callOrThrow<LocalServer>("local_connect", { provider, url }),
  /** Copies a dropped file into the inbox. */
  ingestFile: (path: string) => callOrThrow<DroppedFile>("ingest_file", { path }),
  /** Only ever tells you whether a key exists — never its value. */
  secretPresent: (key: string) => call<boolean>("secret_present", { key }),
  /** Whether Claude can answer: the API key, or else the user's own Claude Code. */
  claudeReady: () => call<boolean>("claude_ready"),
  /** Settings → Chat → Your AI subscriptions: each switch and whether its tool is installed. */
  subscriptionStatus: () => call<SubscriptionStatus[]>("subscription_status"),
  /** Moves a switch; returns the rows as they are now. */
  subscriptionSet: (provider: string, on: boolean) =>
    call<SubscriptionStatus[]>("subscription_set", { provider, on }),
  /** Whether a provider can answer with this key: Claude Code stands in for a missing Anthropic one. */
  keyReady: (key: string) =>
    key === "anthropic-api-key" ? call<boolean>("claude_ready") : call<boolean>("secret_present", { key }),
  secretSet: (key: string, value: string) => callOrThrow<void>("secret_set", { key, value }),
  secretClear: (key: string) => callOrThrow<void>("secret_clear", { key }),

  // ── Integrations ──────────────────────────────────────────────────────────
  refreshIntegration: (id: string) => call<void>("refresh_integration", { id }),
  /** The GitHub card is on screen: refetch that part if it is stale. */
  githubRefresh: (section: "pulse" | "activity") => call<void>("github_refresh", { section }),
  /** Opens the configured n8n instance in the browser. */
  openN8n: () => call<void>("open_n8n"),

  /** Tray → Pause. Stops the integration pollers, not just the island. */
  setPaused: (paused: boolean) => call<void>("set_paused", { paused }),

  // ── Global shortcuts ──────────────────────────────────────────────────────
  /** How each global shortcut went when Rust last registered them. */
  shortcutsStatus: () => call<ShortcutsReport>("shortcuts_status"),
  /** Lets go of every global shortcut while Settings records a new one. */
  shortcutsSuspend: (suspended: boolean) => call<void>("shortcuts_suspend", { suspended }),

  // ── Weekly recap ──────────────────────────────────────────────────────────
  /** Turns and decisions from `since` (Unix seconds) on, plus the recap prefs. */
  recapHistory: (since: number) => call<RecapHistory>("recap_history", { since: Math.floor(since) }),
  recapPrefs: () => call<RecapPrefs>("recap_prefs"),
  recapSetEnabled: (enabled: boolean) => call<void>("recap_set_enabled", { enabled }),
  recapSetHideProjects: (hide: boolean) => call<void>("recap_set_hide_projects", { hide }),
  /** `week` is the Monday (YYYY-MM-DD) the recap opened on its own for. */
  recapMarkShown: (week: string) => call<void>("recap_mark_shown", { week }),
  recapClear: () => call<void>("recap_clear"),
  /** Writes the PNG (a data URL) into Pictures or Downloads; returns its path. */
  recapSavePng: (data: string, week: string) => callOrThrow<string>("recap_save_png", { data, week }),
  /** Opens the folder of the image saved last. */
  recapRevealSaved: () => call<void>("recap_reveal_saved"),

  // ── Mochi on the desktop (src-tauri/src/desktop.rs) ───────────────────────
  desktopInfo: () => call<DesktopInfo>("desktop_mochi_info"),
  /** Dragged out of the island: (x, y) is the pointer in island-window coordinates. */
  desktopPickUp: (x: number, y: number) => call<boolean>("desktop_mochi_pick_up", { x, y }),
  /** Linux: the pointer moved during that drag (Windows carries him from Rust). */
  desktopCarry: (x: number, y: number) => call<void>("desktop_mochi_carry", { x, y }),
  desktopCarryEnd: (x: number, y: number) => call<void>("desktop_mochi_carry_end", { x, y }),
  /** A drag started on the desktop Mochi; resolves to his top-left corner. */
  desktopDragBegin: () => call<[number, number] | null>("desktop_mochi_drag_begin"),
  /** X11: top-left corner, physical pixels. */
  desktopDragMove: (x: number, y: number) => call<void>("desktop_mochi_drag_move", { x, y }),
  desktopDragEnd: (x: number, y: number) => call<void>("desktop_mochi_drag_end", { x, y }),
  /** From the island to his spot. False: no spot on any connected display.
   *  `anywhere`: the first-visit corner then, rather than staying home. */
  desktopFlyOut: (anywhere = false) => call<boolean>("desktop_mochi_fly_out", { anywhere }),
  /** To the island, then hidden. `forget`: he lives in the island again. */
  desktopFlyHome: (forget: boolean) => call<boolean>("desktop_mochi_fly_home", { forget }),
  /** Asleep, the cursor poll stops. */
  desktopSetAsleep: (asleep: boolean) => call<void>("desktop_mochi_set_asleep", { asleep }),

  // ── Spotify (src-tauri/src/spotify.rs) ────────────────────────────────────
  /** Reads the player again (the card came on screen) and reports it. */
  spotifyRefresh: () => call<SpotifyState | null>("spotify_refresh"),
  /** True when Spotify took it. `value`: seconds for seek, 0/1 for shuffle and repeat, 0…100 for volume. */
  spotifyControl: (action: SpotifyAction, value?: number) =>
    call<boolean>("spotify_control", { action, value: value ?? null }),
  /** Brings Spotify forward or starts it; without it, its download page. */
  spotifyOpen: () => call<boolean>("spotify_open"),
  /** Whether there is a Spotify to launch (Settings). */
  spotifyInstalled: () => call<boolean>("spotify_installed"),

  // ── WhatsApp (src-tauri/src/whatsapp) ─────────────────────────────────────
  /** The island's copy, asked once at start (then the "whatsapp" event). Island only. */
  whatsappIsland: () => call<WaIslandView>("whatsapp_island"),
  /** A conversation opened in the card: its latest messages, the receipt if Settings says so. */
  whatsappOpen: (chat: string) => call<void>("whatsapp_open", { chat }),
  whatsappClose: (chat: string) => call<void>("whatsapp_close", { chat }),
  /** The card's ↗: WhatsApp Desktop at the open conversation, or WhatsApp Web without it. */
  whatsappOpenApp: () => call<boolean>("whatsapp_open_app"),
  /** Enter or the send button only. True once the gateway took it. */
  whatsappSend: (chat: string, text: string) => call<boolean>("whatsapp_send", { chat, text }),
  /** A chat id, or (Settings) a phone number. */
  whatsappIgnore: (chat: string) => call<void>("whatsapp_ignore", { chat }),
  whatsappUnignore: (chat: string) => call<void>("whatsapp_unignore", { chat }),
  /** Settings only, from here down. */
  whatsappSettings: () => call<WaSettingsView>("whatsapp_settings"),
  whatsappSetOptions: (enabled: boolean, muteGroups: boolean, markReadOnOpen: boolean) =>
    callOrThrow<void>("whatsapp_set_options", { enabled, muteGroups, markReadOnOpen }),
  /** `credential`: null keeps the stored one, "" removes it. */
  whatsappSaveGateway: (g: {
    gateway: "gowa" | "openwa"; url: string; credential: string | null; port: number; autoStart: boolean; gowaPath: string;
  }) => callOrThrow<void>("whatsapp_save_gateway", g),
  whatsappTest: () => call<WaTestResult>("whatsapp_test"),
  /** "Install WhatsApp" / "Update": GOWA from its GitHub releases, on this click only. */
  whatsappInstall: () => call<void>("whatsapp_install"),

  // ── New versions (src-tauri/src/update.rs) ────────────────────────────────
  updateStatus: () => call<UpdateStatus>("update_status"),
  /** The island's question or Settings' toggle: may JARVIS look at GitHub on its own? */
  updateSetConsent: (allowed: boolean) => call<void>("update_set_consent", { allowed }),
  /** "Check now": one look at GitHub, the toggle on or off. */
  updateCheck: () => call<UpdateStatus>("update_check"),
  /** The island opened the card Rust offered ("ask" or "announce"). */
  updateShown: (kind: "ask" | "announce") => call<void>("update_shown", { kind }),
  /** Settings → Install X: opens the island's update card. */
  updateShow: () => call<void>("update_show"),
  updateLater: () => call<void>("update_later"),
  /** Blue Mochi in the tray while a new version waits (tray.rs). */
  trayUpdateHint: (on: boolean) => call<void>("tray_update_hint", { on }),
  updateDismiss: () => call<void>("update_dismiss"),
  /** "Update now" (Windows): download, check the SHA-256, run the installer, quit. */
  updateInstall: () => call<void>("update_install"),
  /** The release's page on github.com. */
  updateOpenPage: () => call<void>("update_open_page"),
};

/** JARVIS: what a music app plays now (src-tauri/src/presence.rs). */
export interface NowPlaying {
  /** "Apple Music", "Spotify", "TIDAL"… */
  app: string;
  title: string;
  artist: string;
  album: string;
  playing: boolean;
  /** The cover as a data URL. */
  art: string | null;
  /** Seconds into the song at `at` (Unix ms), and its length in seconds (0: unknown). */
  position: number;
  duration: number;
  at: number;
}

export type SpotifyAction = "playPause" | "next" | "previous" | "seek" | "shuffle" | "repeat" | "volume";

export type ShortcutStatus =
  | "active" | "off" | "inUse" | "duplicate" | "invalid"
  | "typesCharacter" | "unsupported" | "notPorted"
  /** Wayland: handed to the desktop's portal, no answer yet / left out by it. */
  | "pending" | "refused";

export interface ShortcutsReport {
  /** `trigger`: on Wayland, the keys the desktop says run it, in its words. */
  actions: { id: string; status: ShortcutStatus; typed?: string; trigger?: string }[];
  /** "wayland" or "no-display" when no key grab can be made. */
  blocked: string | null;
  /** `<executable> --shortcut`: append an action id for a desktop shortcut. */
  command: string;
  /** Wayland: the shortcuts went to the desktop's GlobalShortcuts portal. */
  portal?: "pending" | "active" | null;
}

/** How the desktop Mochi's window works here (platform::DesktopMode). */
export type DesktopMode = "poll" | "window" | "layer" | "off";

export interface DesktopInfo {
  mode: DesktopMode;
  /** He was on the desktop when the app last quit. */
  onDesktop: boolean;
}

/** An event for one window only (island ⇄ desktop Mochi). Never throws. */
export async function emitToWindow(label: string, event: string, payload?: unknown) {
  if (!IS_TAURI) return;
  try {
    await emitTo(label, event, payload);
  } catch (err) {
    console.error(`[jarvis] emit ${event} failed`, err);
  }
}

export interface IntegrationUpdate {
  id: string;
  data: Record<string, unknown>;
  error: string | null;
  event: { success: boolean; label: string; detail: string | null } | null;
}

export type ChatContext =
  | { kind: "file"; name: string; path: string }
  | { kind: "window"; appName: string; title: string; url?: string };

export interface ModelInfo {
  id: string;
  label: string;
}

/** One row of Settings → Chat → Your AI subscriptions (cli_relay.rs `Status`). */
export interface SubscriptionStatus {
  provider: string;
  /** The terminal tool that answers, or would once installed. */
  tool: string;
  installed: boolean;
  on: boolean;
  /** What to type once in a terminal to sign in. */
  signIn: string;
  installUrl: string;
  subscriptionOnly: boolean;
}

export interface LocalServer {
  /** The address as it is stored. */
  url: string;
  models: string[];
  /** The address is this machine. */
  loopback: boolean;
}

export interface DroppedFile {
  name: string;
  path: string;
  size: number;
}

export interface HookStatus {
  installed: boolean;
  /** JARVIS's status line relay (plan usage) is the status line in settings.json. */
  planRelayInstalled: boolean;
  settingsPath: string;
  hookPath: string;
  hookReady: boolean;
}

/** One agent other than Claude Code, as agents.rs reports it. */
export interface AgyApprovalsStatus {
  enabled: boolean;
  /** JARVIS's PreToolUse hook can wait for a click (120 s); older hooks (10 s) must be installed again. */
  hooksReady: boolean;
}

export interface AgentHookStatus {
  /** The `--agent` name; its pill is `agent_<id>`. */
  id: string;
  name: string;
  installed: boolean;
  /** The file (or files, one per line) JARVIS writes. */
  path: string;
  hookReady: boolean;
  /** The island can allow or deny this agent's permission requests. */
  approvals: boolean;
  /** What to do once it is written. */
  note: string;
}

export interface AgentHookPlan {
  diff: string;
  /** Where each existing file is copied first, one per line; "" when none. */
  backup: string;
  path: string;
  fingerprint: string;
}

export interface HookPreview {
  diff: string;
  backup: string;
  settingsPath: string;
  /** Hand back to hooksApply so only the reviewed diff is ever written. */
  fingerprint: string;
}

/** Same as `call`, but surfaces the error so the UI can show what went wrong. */
async function callOrThrow<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!IS_TAURI) throw new Error("not running inside JARVIS");
  return invoke<T>(cmd, args);
}

export type BridgeEvent =
  | { name: "cursor"; payload: { x: number; y: number } }
  | { name: "tray"; payload: string }
  | { name: "hook"; payload: Record<string, unknown> }
  | { name: "screen-changed"; payload: null };

export interface DragDropPayload {
  type: "enter" | "over" | "drop" | "leave";
  paths?: string[];
  /** Where the pointer is, in physical pixels of the webview (Tauri's own drag events, Linux). */
  position?: { x: number; y: number };
}

interface WebView2Bridge {
  postMessageWithAdditionalObjects(message: unknown, objects: ArrayLike<unknown>): void;
}

/**
 * Files dragged onto the island. Only reaches us when the window takes the mouse.
 *
 * On Windows WebView2 takes the drop itself, as in Edge — Tauri's drop handling
 * never sees drags from the classic Explorer folder view (see
 * src-tauri/src/webview_drop.rs). Enter/over/leave come straight from the page;
 * the drop hands the File objects to Rust, which answers with their real paths
 * as a `file-drag` event. Elsewhere (Linux) Tauri's own drag events still do it.
 */
export async function onDragDrop(handler: (e: DragDropPayload) => void) {
  if (!IS_TAURI) return () => {};
  const webview = (window as unknown as { chrome?: { webview?: WebView2Bridge } }).chrome?.webview;
  if (!webview) {
    return getCurrentWebview().onDragDropEvent((event) => {
      handler(event.payload as DragDropPayload);
    });
  }
  const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
  // dragenter/dragleave fire for every element crossed; only the outermost pair counts.
  let depth = 0;

  const onEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (depth++ === 0) handler({ type: "enter" });
  };
  const onOver = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    // Without this WebView2 refuses the drop — or navigates to the file.
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    handler({ type: "over" });
  };
  const onLeave = (e: DragEvent) => {
    if (!hasFiles(e) || depth === 0) return;
    if (--depth === 0) handler({ type: "leave" });
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    depth = 0;
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) {
      handler({ type: "drop", paths: [] });
      return;
    }
    webview.postMessageWithAdditionalObjects("jarvis-file-drop", files);
  };

  window.addEventListener("dragenter", onEnter);
  window.addEventListener("dragover", onOver);
  window.addEventListener("dragleave", onLeave);
  window.addEventListener("drop", onDrop);
  const unlisten = await listen<DragDropPayload>("file-drag", (e) => handler(e.payload));
  return () => {
    window.removeEventListener("dragenter", onEnter);
    window.removeEventListener("dragover", onOver);
    window.removeEventListener("dragleave", onLeave);
    window.removeEventListener("drop", onDrop);
    unlisten();
  };
}

export async function onEvent<T>(name: string, handler: (payload: T) => void) {
  if (!IS_TAURI) return () => {};
  return listen<T>(name, (e) => handler(e.payload));
}

/**
 * JARVIS (#84): `onEvent` for as long as `el` is on screen. Once it has been shown and is gone
 * (its page left, Settings redrawn), the listener stops instead of piling up.
 */
export function onEventWhileShown<T>(el: HTMLElement, name: string, handler: (payload: T) => void) {
  let seen = false;
  const off = onEvent<T>(name, (payload) => {
    if (el.isConnected) { seen = true; handler(payload); return; }
    if (seen) void off.then((f) => f());
  });
  return off;
}

/** JARVIS: a model that can draw his windows: "maker:model", installed and signed in or not. */
export interface DrawModel {
  id: string;
  name: string;
  maker: "claude" | "chatgpt" | "gemini";
  ready: boolean;
}

/** JARVIS: a window he drew (his_windows.rs). */
export interface HisWindow { question: string; form: string; svg: string | null; at: number }
export interface HisWindows { times: number[]; last: HisWindow[] }
/** JARVIS: this month's mail (mail/outlook.rs month_script): received per day ("1"…"31"), today's per hour. */
export interface MailMonth {
  days: Record<string, number>; hours: number[]; flagged: number; files: number;
  /** Per day: how many came from a VIP, are flagged, carry files. */
  marks?: Record<string, { vip: number; flagged: number; files: number }>;
}
