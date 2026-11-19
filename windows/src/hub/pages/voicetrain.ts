// JARVIS: voice training, iOS-style. Say « Hey JARVIS » five times; JARVIS
// keeps a voiceprint (src-tauri/src/voice/print.rs) and, with « Only answer my
// voice » on, ignores everyone else. Three screens: intro, the takes, done.

import { h, clear } from "../../views/dom";
import { N_, t } from "../../i18n/i18n";
import { Bridge, onEvent, type TrainEvent } from "../../core/bridge";

/** The prompts and messages the training receives from Rust (voice/print.rs), translated here. */
export const TRAIN_TEXTS = [
  N_("I didn't quite catch « Hey JARVIS ». Try again."),
  N_("That was a bit short. Try again."),
];

/** Opens the training over the window; `done` runs when it finished (trained or not). */
export function openVoiceTraining(done: (trained: boolean) => void) {
  const panel = h("div", { class: "vt-panel" });
  const overlay = h("div", { class: "vt-overlay" }, panel);
  document.body.append(overlay);
  let trained = false;
  let unlisten: (() => void) | null = null;
  let unlistenLevel: (() => void) | null = null;

  const close = () => {
    unlisten?.();
    unlistenLevel?.();
    if (!trained) void Bridge.voiceTrainCancel();
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
    done(trained);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener("keydown", onKey, true);

  const visor = (kind: "idle" | "listen" | "smile") =>
    h("div", { class: `vt-visor ${kind}` }, h("span", { class: "vt-eye" }), kind === "listen" ? h("span", { class: "vt-ring" }) : document.createTextNode(""));

  function intro(error = "") {
    clear(panel);
    const start = h("button", { class: "vt-primary", text: t("Start") });
    start.onclick = () => {
      Bridge.voiceTrainStart()
        .then(() => takes({ phase: "listening", count: 0, total: 5, prompt: "Hey JARVIS", message: "" }))
        .catch((err) => intro(String(err)));
    };
    panel.append(
      visor("idle"),
      h("h2", { text: t("Teach JARVIS your voice") }),
      h("p", { text: t("Say « Hey JARVIS » five times, so he answers you and nobody else. Your voice stays on this computer.") }),
      error ? h("p", { class: "vt-error", text: error }) : document.createTextNode(""),
      h("div", { class: "vt-actions" }, h("button", { class: "vt-secondary", text: t("Not now"), onclick: close }), start),
    );
  }

  function takes(e: TrainEvent) {
    clear(panel);
    const dots = h("div", { class: "vt-dots" });
    for (let i = 0; i < e.total; i++) dots.append(h("span", { class: i < e.count ? "on" : i === e.count ? "now" : "" }));
    const progress = h("div", { class: "vt-progress" });
    progress.style.setProperty("--p", String(e.count / e.total));
    panel.append(
      h("div", { class: "vt-stage" }, progress, visor("listen")),
      // The phrase to say this time: a different one each step, as with « Hey Siri ».
      h("p", { class: "vt-step", text: t("Say") }),
      h("h2", { class: "vt-phrase", text: `« ${e.prompt} »` }),
      h("p", { class: e.phase === "retry" ? "vt-error" : "", text: e.phase === "retry" ? t(e.message) : t("Listening…") }),
      dots,
      h("div", { class: "vt-actions" }, h("button", { class: "vt-secondary", text: t("Cancel"), onclick: close })),
    );
  }

  function finished() {
    trained = true;
    clear(panel);
    panel.append(
      visor("smile"),
      h("h2", { text: t("JARVIS knows your voice") }),
      h("p", { text: t("“Very good, sir. I'll listen for you.”") }),
      h("div", { class: "vt-actions" }, h("button", { class: "vt-primary", text: t("Done"), onclick: close })),
    );
  }

  // The eye follows your voice: you can see that JARVIS hears you.
  void onEvent<number>("voice-level", (level) => {
    const eye = panel.querySelector<HTMLElement>(".vt-visor.listen .vt-eye");
    if (eye) eye.style.setProperty("--level", String(Math.max(0, Math.min(1, level))));
  }).then((u) => {
    unlistenLevel = typeof u === "function" ? u : null;
  });

  void onEvent<TrainEvent>("voice-train", (e) => {
    if (!overlay.isConnected) return;
    if (e.phase === "done") finished();
    else if (e.phase === "error") intro(e.message);
    else takes(e);
  }).then((u) => {
    unlisten = typeof u === "function" ? u : null;
  });

  intro();
}
