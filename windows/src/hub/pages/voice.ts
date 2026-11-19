// « OK Coucou »: say it, then ask anything. Turning it on, how Coucou answers
// out loud, and what leaves the computer. Port of the Mac's Settings → Voice.

import { h, clear } from "../../views/dom";
import { t } from "../../i18n/i18n";
import { Bridge, onEvent, type VoiceModel } from "../../core/bridge";
import type { VoiceOutput } from "../../core/flow";
import type { HubContext } from "../shell";
import { button, card, divider, label, row, segmented, select, toggle } from "../ui";
import { modelsControl } from "./flowsettings";
import { openVoiceTraining } from "./voicetrain";

const ELEVEN = "elevenlabs-api-key";
/** Where secrets.rs keeps the keys on this OS (same words as Notch → Chat). */
const KEY_STORE = navigator.userAgent.includes("Windows") ? "Windows Credential Manager" : "Secret Service (GNOME Keyring, KWallet)";

function elevenKey(): HTMLElement {
  const box = h("div", { style: "display:flex;align-items:center;gap:8px" });
  const draw = async () => {
    const present = (await Bridge.secretPresent(ELEVEN)) ?? false;
    clear(box);
    if (present) {
      box.append(
        h("span", { class: "hub-note", style: "color:var(--hub-green)", text: `✓ ${t("Key saved in the {store}.", { store: KEY_STORE })}` }),
        button(t("Remove"), () => void Bridge.secretClear(ELEVEN).then(draw), "", true),
      );
      return;
    }
    const input = h("input", { class: "hub-input", type: "password", placeholder: t("ElevenLabs key"), autocomplete: "off", spellcheck: "false", style: "width:220px" }) as HTMLInputElement;
    const save = button(t("Save key"), () => {
      const value = input.value.trim();
      if (!value) return;
      void Bridge.secretSet(ELEVEN, value).then(draw, () => input.classList.add("err"));
    }, "primary", true);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") save.click();
    });
    box.append(input, save);
  };
  void draw();
  return box;
}

/** A live loudness bar for `mic`; the mark is where JARVIS starts to hear speech. */
function micMeterBar(mic: string): HTMLElement {
  const fill = h("div", { class: "mic-fill" });
  const mark = h("div", { class: "mic-mark", title: t("Heard as speech from here") });
  // The quietest speech JARVIS hears (voice/wake.rs MIN_SPEECH, 0.0035 ≈ −49 dBFS) on the bar's −60…−10 dB scale.
  mark.style.left = `${((20 * Math.log10(0.0035) + 60) / 50) * 100}%`;
  const bar = h("div", { class: "mic-bar" }, fill, mark);
  let alive = true;
  const ping = () => {
    if (!bar.isConnected && document.readyState === "complete" && alive) {
      // The page is gone: stop the microphone.
      alive = false;
      void Bridge.micMeterStop();
      return;
    }
    void Bridge.micMeter(mic);
  };
  ping();
  const timer = window.setInterval(() => {
    if (!alive) return window.clearInterval(timer);
    ping();
  }, 2000);
  void onEvent<{ level: number; rms: number }>("mic-level", (e) => {
    if (!bar.isConnected) return;
    fill.style.width = `${Math.round(e.level * 100)}%`;
    bar.classList.toggle("speech", e.rms >= 0.0035);
  });
  return bar;
}

/** JARVIS's own voice: download it once (about 130 MB), then pick and hear one. */
function jarvisVoice(ctx: HubContext, voiceName: string): HTMLElement {
  const box = h("div", { style: "display:flex;flex-direction:column;gap:10px" });
  let model: VoiceModel | null = null;
  let playing: HTMLAudioElement | null = null;
  const mb = (n: number) => `${Math.round(n / 1_000_000)} MB`;

  const preview = (id: string, btn: HTMLButtonElement) => {
    playing?.pause();
    btn.disabled = true;
    btn.textContent = "…";
    Bridge.voicePreview(id)
      .then((bytes) => {
        const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
        playing = new Audio(url);
        playing.onended = () => URL.revokeObjectURL(url);
        return playing.play();
      })
      .catch(() => undefined)
      .finally(() => {
        btn.disabled = false;
        btn.textContent = "▶";
      });
  };

  const draw = () => {
    clear(box);
    if (!model) return;
    const st = model.status;
    if (st.state === "ready") {
      const picker = segmented(
        model.voices.map((v) => [v.id, v.name] as [string, string]),
        voiceName,
        (v) => {
          voiceName = v;
          void Bridge.voiceWarmUp(v);
          void ctx.setPrefs((p) => (p.voiceName = v));
        },
      );
      const play = button("▶", () => preview(voiceName, play), "", true);
      play.title = t("Hear this voice");
      box.append(
        h("div", { style: "display:flex;align-items:center;gap:8px" }, picker, play),
        h("div", { style: "display:flex;align-items:center;gap:8px" },
          h("span", { class: "hub-note", style: "color:var(--hub-green)", text: `✓ ${t("On this computer, offline.")}` }),
          button(t("Remove"), () => void Bridge.voiceModelRemove(), "", true),
        ),
      );
    } else if (st.state === "downloading") {
      box.append(h("span", { class: "hub-note", text: t("Downloading… {pct}%", { pct: Math.round(st.fraction * 100) }) }));
    } else {
      box.append(
        h("div", { style: "display:flex;align-items:center;gap:8px" },
          button(t("Download the voice ({size})", { size: mb(model.size) }), () => void Bridge.voiceModelDownload(), "primary", true),
        ),
      );
      if (st.state === "failed") box.append(h("span", { class: "hub-note", style: "color:var(--hub-red, #f4505e)", text: st.error }));
    }
  };

  const load = async () => {
    model = await Bridge.voiceModel();
    if (model?.status.state === "ready") void Bridge.voiceWarmUp(voiceName);
    draw();
  };
  void load();
  void onEvent<VoiceModel["status"]>("voice-model-status", (status) => {
    if (model) model.status = status;
    if (box.isConnected) draw();
  });
  return box;
}

export async function voicePage(page: HTMLElement, ctx: HubContext) {
  const status = await ctx.refresh();
  const prefs = status.prefs;
  page.append(ctx.hero("voice", "Hey JARVIS", t("Say « OK Coucou », then ask anything: add a pill, play music, the weather, an email to prepare.")));

  const ready = status.models.parakeet.state === "ready";
  page.append(label(t("Listening")));
  const main = card(
    row(t("Listen for « OK Coucou »"), t("The microphone stays open; only what follows « OK Coucou » goes further."),
      toggle(prefs.voice, (on) => void ctx.setPrefs((p) => (p.voice = on)).then(() => ctx.navigate("voice")))),
    divider(),
    row(t("Parakeet, on your computer"), t("Hears « OK Coucou » here, without the internet."), modelsControl(ctx, () => ctx.navigate("voice"))),
  );
  if (prefs.voice && !ready) {
    main.append(h("div", { class: "hub-warn", text: t("Download the voice model so Coucou can hear you.") }));
  }
  if (!status.hasClaudeKey) {
    // JARVIS: no key needed — your own Claude Code answers.
    main.append(divider(), h("div", { class: "hub-note", text: t("Without a Claude key, your own Claude Code answers (words and web search). With a key, JARVIS can also act: pills, music, apps, emails.") }));
  }
  page.append(main);

  // JARVIS: which microphone, and a bar that shows how loud you come through.
  page.append(label(t("Microphone")));
  const mics: [string, string][] = [["", t("Automatic")], ...status.mics.map((m): [string, string] => [m.name, m.name])];
  if (prefs.mic && !mics.some(([id]) => id === prefs.mic)) mics.push([prefs.mic, prefs.mic]);
  page.append(card(
    row(t("Microphone"), t("The one JARVIS listens to (dictation and calls use it too)."),
      select(mics, prefs.mic, (mic) => void ctx.setPrefs((p) => (p.mic = mic)).then(() => ctx.navigate("voice")))),
    divider(),
    row(t("Your voice level"), t("Speak: the bar should reach past the mark. If it stays low, pick another microphone or move closer."), micMeterBar(prefs.mic)),
  ));

  // JARVIS: your voice — training and « Only answer my voice ».
  const print = (await Bridge.voicePrintStatus()) ?? { trained: false, takes: 0, training: false };
  page.append(label(t("Your voice")));
  const train = () =>
    openVoiceTraining((trained) => {
      if (trained) void ctx.setPrefs((p) => (p.voiceOnlyMe = true)).then(() => ctx.navigate("voice"));
    });
  const yours = card(
    row(
      t("Only answer my voice"),
      print.trained ? t("Trained · {n} samples", { n: print.takes }) : t("Teach JARVIS your voice first."),
      print.trained
        ? toggle(prefs.voiceOnlyMe, (on) => void ctx.setPrefs((p) => (p.voiceOnlyMe = on)))
        : button(t("Teach JARVIS your voice"), train, "primary", true),
    ),
  );
  if (print.trained) {
    yours.append(
      divider(),
      row(
        t("Strictness"),
        t("Stricter ignores other voices more, but may miss yours in a noisy room."),
        segmented(
          [["relaxed", t("Relaxed")], ["balanced", t("Balanced")], ["strict", t("Strict")]] as [typeof prefs.voiceStrictness, string][],
          prefs.voiceStrictness || "balanced",
          (v) => void ctx.setPrefs((p) => (p.voiceStrictness = v)),
        ),
      ),
      divider(),
      h("div", { style: "display:flex;gap:8px;padding:2px 0" },
        button(t("Retrain"), train, "", true),
        button(t("Forget my voice"), () => void Bridge.voicePrintForget().then(() => ctx.setPrefs((p) => (p.voiceOnlyMe = false))).then(() => ctx.navigate("voice")), "danger", true),
      ),
    );
  }
  page.append(yours);

  page.append(label(t("Answers")));
  const outputs: [VoiceOutput, string][] = [["jarvis", "JARVIS"], ["system", t("System voice")], ["elevenlabs", "ElevenLabs"], ["off", t("Text only")]];
  const answers = card(
    row(t("Coucou answers out loud"), null, segmented(outputs, prefs.voiceOutput, (v) => void ctx.setPrefs((p) => (p.voiceOutput = v)).then(() => ctx.navigate("voice")))),
  );
  if (prefs.voiceOutput === "jarvis") {
    answers.append(divider(), row(t("JARVIS's voice"), t("British, on this computer: nothing leaves it."), jarvisVoice(ctx, prefs.voiceName || "george")));
  }
  if (prefs.voiceOutput === "elevenlabs") {
    answers.append(
      divider(),
      row(t("Voice"), null, segmented([["female", t("Female")], ["male", t("Male")]], prefs.voiceGender, (g) => void ctx.setPrefs((p) => (p.voiceGender = g)))),
      divider(),
      row(t("ElevenLabs key"), null, elevenKey()),
    );
  }
  page.append(answers);

  page.append(label(t("Privacy")));
  page.append(card(
    h("div", { class: "hub-note", text: t("Your voice never leaves this computer: Parakeet turns it into text here. Only the words after « OK Coucou » go to Anthropic with your Claude key, and to ElevenLabs if you picked it for the answers.") }),
    divider(),
    h("div", { class: "hub-note", text: t("An email is never sent by Coucou: your mail app opens with it written, and you send it.") }),
  ));
}
