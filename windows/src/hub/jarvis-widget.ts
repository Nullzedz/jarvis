// JARVIS: Home's JARVIS widget (step 3 of #57), one to one with the demo's (prototypes/jarvis-home.html):
// his visor; a chip saying whether he listens for "Hey JARVIS"; his last answer in quotes; under
// it the voice he speaks with. The last answer is kept in memory only (src-tauri/src/last_answer.rs).

import { h, clear } from "../views/dom";
import { t } from "../i18n/i18n";
import { Bridge, onEvent } from "../core/bridge";
import type { FlowStatus } from "../core/flow";
import { visor } from "../theme/theme";

/** The chip: listening (green), no voice model yet (orange), or not listening (grey). */
export function listeningChip(s: Pick<FlowStatus, "prefs" | "models">): { color: string; text: string } {
  if (!s.prefs.voice) return { color: "#636366", text: t("Not listening") };
  if (s.models.parakeet.state !== "ready") return { color: "#ff9f0a", text: t("Voice model not downloaded") };
  return { color: "#30d158", text: t("Listening for “Hey JARVIS”") };
}

/** The line under his answer: which voice he answers with. */
async function voiceLine(s: Pick<FlowStatus, "prefs">): Promise<string> {
  const p = s.prefs;
  switch (p.voiceOutput) {
    case "jarvis": {
      const id = p.voiceName || "george";
      const model = await Bridge.voiceModel().catch(() => null);
      const name = model?.voices.find((v) => v.id === id)?.name ?? id.charAt(0).toUpperCase() + id.slice(1);
      return `${name} · ${t("British")}`;
    }
    case "gemini": return `${p.geminiVoice || "Charon"} · Gemini`;
    case "elevenlabs": return "ElevenLabs";
    case "system": return t("System voice");
    default: return t("Text only");
  }
}

/** Fills `body`; returns a function that stops it. */
export function jarvisWidget(body: HTMLElement, status: FlowStatus): () => void {
  const chip = listeningChip(status);
  const answer = h("p", { class: "jv-jw-said" });
  const voice = h("p", { class: "jv-jw-voice" });
  const show = (text: string | null) => {
    clear(answer);
    answer.classList.toggle("none", !text);
    answer.textContent = text ? `“${text}”` : t("Ask him anything: his answer shows here.");
  };
  show(null);
  void voiceLine(status).then((v) => { voice.textContent = v; });
  body.append(h("div", { class: "jv-jw" },
    visor(96),
    h("div", { class: "x" },
      h("span", { class: "jv-chip" }, h("span", { class: "dot", style: `background:${chip.color}` }), h("span", { text: chip.text })),
      answer,
      voice)));
  void Bridge.lastAnswer().then((a) => { if (a) show(a); });
  const off = onEvent<string>("jarvis-last-answer", (a) => show(a));
  return () => { void off.then((f) => f()); };
}
