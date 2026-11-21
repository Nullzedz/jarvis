// « OK Coucou »: say it, then ask anything. Turning it on, how Coucou answers
// out loud, and what leaves the computer. Port of the Mac's Settings → Voice.

import { h, clear } from "../../views/dom";
import { t } from "../../i18n/i18n";
import { Bridge, onEvent, type VoiceModel, type VoiceModelState } from "../../core/bridge";
import type { VoiceOutput } from "../../core/flow";
import type { HubContext } from "../shell";
import { button, card, divider, label, row, segmented, select, toggle } from "../ui";
import { modelsControl } from "./flowsettings";
import { openVoiceTraining } from "./voicetrain";
import { shortcutTiles } from "./shortcuts";
import { drawModelCards } from "./drawmodel";

const ELEVEN = "elevenlabs-api-key";
const GEMINI = "gemini-api-key";
/** JARVIS: the Gemini voices offered (voice/gemini.rs VOICES), deeper and calmer first. */
const GEMINI_VOICES: [string, string][] = [
  ["Charon", "Charon"], ["Orus", "Orus"], ["Iapetus", "Iapetus"], ["Algenib", "Algenib"],
  ["Rasalgethi", "Rasalgethi"], ["Sadaltager", "Sadaltager"], ["Schedar", "Schedar"], ["Puck", "Puck"],
];
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

/** JARVIS: the Gemini key — paste and save, or saved with whether it works, and Remove. */
function geminiKey(onChange: () => void): HTMLElement {
  const box = h("div", { style: "display:flex;align-items:center;gap:8px" });
  const draw = async () => {
    const present = (await Bridge.secretPresent(GEMINI)) ?? false;
    clear(box);
    if (present) {
      const status = h("span", { class: "hub-note", text: t("Checking…") });
      box.append(status, button(t("Remove"), () => void Bridge.secretClear(GEMINI).then(draw).then(onChange), "", true));
      const state = await Bridge.geminiKeyCheck();
      const [text, color] =
        state === "ok" ? [`● ${t("Works")}`, "var(--hub-green)"]
        : state === "key" ? [`● ${t("Google refused this key")}`, "var(--hub-red, #f09595)"]
        : [`● ${t("Can't reach Google right now")}`, "var(--hub-dim, #8b8f97)"];
      status.textContent = text;
      status.style.color = color;
      return;
    }
    const input = h("input", { class: "hub-input", type: "password", placeholder: t("Gemini key"), autocomplete: "off", spellcheck: "false", style: "width:220px" }) as HTMLInputElement;
    const save = button(t("Save key"), () => {
      const value = input.value.trim();
      if (!value) return;
      void Bridge.secretSet(GEMINI, value).then(draw, () => input.classList.add("err")).then(onChange);
    }, "primary", true);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") save.click();
    });
    box.append(input, save);
  };
  void draw();
  return box;
}

/** JARVIS: the Gemini voice picker and ▶ Hear it (needs the key). */
function geminiVoice(ctx: HubContext, current: string): HTMLElement {
  let voice = current || "Charon";
  let playing: HTMLAudioElement | null = null;
  void Bridge.geminiWarmUp(voice);
  const pick = select(GEMINI_VOICES, voice, (v) => {
    voice = v;
    void Bridge.geminiWarmUp(v);
    void ctx.setPrefs((p) => (p.geminiVoice = v));
  });
  const why = h("span", { class: "hub-note", style: "color:var(--hub-red)" });
  const play = button(`▶ ${t("Hear it")}`, () => {
    playing?.pause();
    play.disabled = true;
    why.textContent = "";
    Bridge.geminiPreview(voice)
      .then((bytes) => {
        const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
        playing = new Audio(url);
        playing.onended = () => URL.revokeObjectURL(url);
        return playing.play();
      })
      .catch((err) => {
        // Gemini couldn't: say why (a refused key, the free allowance used up, Google unavailable).
        why.textContent = String(err).replace(/^Error:\s*/, "").slice(0, 120);
      })
      .finally(() => {
        play.disabled = false;
      });
  }, "", true);
  return h("div", { style: "display:flex;align-items:center;gap:8px;flex-wrap:wrap" }, pick, play, why);
}

/** JARVIS: Piper, the offline backup — Download (with progress), then ▶ and Remove. */
function piperVoice(): HTMLElement {
  const box = h("div", { style: "display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end" });
  let size = 0;
  let status: VoiceModelState | null = null;
  let playing: HTMLAudioElement | null = null;
  const mb = (n: number) => `${Math.round(n / 1_000_000)} MB`;
  const draw = () => {
    clear(box);
    if (!status) return;
    if (status.state === "ready") {
      const play = button("▶", () => {
        playing?.pause();
        play.disabled = true;
        Bridge.piperPreview()
          .then((bytes) => {
            const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
            playing = new Audio(url);
            playing.onended = () => URL.revokeObjectURL(url);
            return playing.play();
          })
          .catch(() => undefined)
          .finally(() => {
            play.disabled = false;
          });
      }, "", true);
      play.title = t("Hear this voice");
      box.append(
        h("span", { class: "hub-note", style: "color:var(--hub-green)", text: `✓ ${t("On this computer, offline.")}` }),
        play,
        button(t("Remove"), () => void Bridge.piperModelRemove(), "", true),
      );
    } else if (status.state === "downloading") {
      const pct = Math.round(status.fraction * 100);
      const fill = h("i", { style: `display:block;height:100%;width:${pct}%;background:var(--hub-accent, #378add)` });
      box.append(
        h("span", { class: "hub-note", text: t("Downloading… {pct}%", { pct }) }),
        h("span", { style: "display:block;width:120px;height:5px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden" }, fill),
      );
    } else {
      box.append(button(t("Download the voice ({size})", { size: mb(size) }), () => void Bridge.piperModelDownload(), "primary", true));
      if (status.state === "failed") box.append(h("span", { class: "hub-note", style: "color:var(--hub-red)", text: status.error }));
    }
  };
  void Bridge.piperModel().then((m) => {
    if (!m) return;
    size = m.size;
    status = m.status;
    draw();
  });
  void onEvent<VoiceModelState>("piper-model-status", (s) => {
    status = s;
    if (box.isConnected) draw();
  });
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

  // JARVIS: his shortcuts, as keycap tiles (design B).
  page.append(label(t("Shortcuts")));
  page.append(shortcutTiles(ctx, prefs, status.platform));

  // JARVIS: who draws his windows (issue #14).
  page.append(label(t("His windows")));
  page.append(drawModelCards(ctx, prefs));

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
  const outputs: [VoiceOutput, string][] = [["gemini", "Gemini"], ["jarvis", "JARVIS"], ["system", t("System voice")], ["elevenlabs", "ElevenLabs"], ["off", t("Text only")]];
  const answers = card(
    row(t("Coucou answers out loud"), null, segmented(outputs, prefs.voiceOutput, (v) => void ctx.setPrefs((p) => (p.voiceOutput = v)).then(() => ctx.navigate("voice")))),
  );
  if (prefs.voiceOutput === "gemini") {
    // JARVIS: Google's voice with your own AI Studio key; the key's row links to where to get one.
    const keyRow = row(t("Gemini key"), null, geminiKey(() => undefined));
    const get = h("button", { class: "hub-link", text: `${t("Get a free key at Google AI Studio")} ↗`, onclick: () => void Bridge.openUrl("https://aistudio.google.com/apikey") });
    keyRow.querySelector(".text")?.append(get);
    answers.append(
      divider(),
      row(t("Voice"), t("Charon is the JARVIS one"), geminiVoice(ctx, prefs.geminiVoice)),
      divider(),
      keyRow,
    );
  }
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

  // JARVIS: when Gemini can't speak (free allowance used up, Google down, no key).
  if (prefs.voiceOutput === "gemini") {
    page.append(label(t("When Gemini can't speak")));
    const fallback = card(
      row(t("Fall back to"), t("Free allowance used up, Google down, or no key"),
        segmented([["piper", t("Piper · offline")], ["text", t("Text only")]], prefs.geminiFallback ?? "piper",
          (v) => void ctx.setPrefs((p) => (p.geminiFallback = v)).then(() => ctx.navigate("voice")))),
    );
    if ((prefs.geminiFallback ?? "piper") === "piper") {
      const piperRow = row(t("Piper voice"), t("Alan, British · free and unlimited, on this computer"), piperVoice());
      fallback.append(divider(), piperRow);
    }
    page.append(fallback);
  }

  page.append(label(t("Privacy")));
  page.append(card(
    h("div", { class: "hub-note", text: t("Your voice never leaves this computer: Parakeet turns it into text here. Only the words after « OK Coucou » go to Anthropic with your Claude key, and to ElevenLabs if you picked it for the answers.") }),
    divider(),
    h("div", { class: "hub-note", text: t("An email is never sent by Coucou: your mail app opens with it written, and you send it.") }),
  ));
}
