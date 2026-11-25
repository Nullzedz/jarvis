// JARVIS: Peter, his live voice (issue #100). Kyutai's Pocket TTS, a 100M
// model built to start speaking within a fraction of a second on an ordinary
// CPU, so a spoken answer follows the question closely. It runs here, offline,
// on any PC: two CPU threads, no graphics card, no account.
//
// Two downloads on the user's click, each checked against its SHA-256:
// - the model, sherpa-onnx's int8 export of Pocket TTS (about 98 MB, CC-BY-4.0,
//   Kyutai), run by sherpa-onnx (already here for Parakeet, Kokoro and Piper);
// - the voice, « peter_yearsley » from Kyutai's tts-voices (Voice-Zero, from
//   LibriVox, CC0), a short recording the model speaks like.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use sherpa_onnx::{GenerationConfig, OfflineTts, OfflineTtsConfig, OfflineTtsModelConfig, OfflineTtsPocketModelConfig, Wave};
use tauri::{AppHandle, Emitter};

use crate::speech::{self, ModelState};

const ARCHIVE_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-pocket-tts-int8-2026-01-26.tar.bz2";
const ARCHIVE_SIZE: u64 = 98_337_865;
const ARCHIVE_SHA256: &str = "f4da7c7bd465f7b91e89191487fe90504396a51d6f0bcf94d0787633e2657293";
const DIR: &str = "sherpa-onnx-pocket-tts-int8-2026-01-26";

/// The voice, pinned to one revision of kyutai/tts-voices (not gated).
const VOICE_URL: &str = "https://huggingface.co/kyutai/tts-voices/resolve/323332d33f997de8394f24a193e1a76df720e01a/voice-zero/peter_yearsley.wav";
const VOICE_SIZE: u64 = 524_448;
const VOICE_SHA256: &str = "fbb3920fda7ae26a5a8b317ffcae1d55c0bd5d89d075205f5a52b1e924b83f51";
const VOICE_FILE: &str = "peter_yearsley.wav";

const FILES: &[&str] = &[
    "lm_flow.int8.onnx",
    "lm_main.int8.onnx",
    "encoder.onnx",
    "decoder.int8.onnx",
    "text_conditioner.onnx",
    "vocab.json",
    "token_scores.json",
];

/// Two threads: what the model is made for, and what a small laptop can spare.
const THREADS: i32 = 2;

pub fn dir() -> PathBuf {
    speech::models_dir().join(DIR)
}

/// Whether the model and the voice are on disk, whole.
pub fn is_ready() -> bool {
    let d = dir();
    FILES.iter().all(|f| d.join(f).is_file()) && d.join(VOICE_FILE).is_file()
}

// ── Download ──────────────────────────────────────────────────────────────────

fn state() -> &'static Mutex<Option<ModelState>> {
    static S: OnceLock<Mutex<Option<ModelState>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(None))
}

pub fn status() -> ModelState {
    if let Some(s) = state().lock().unwrap().clone() {
        if !matches!(s, ModelState::Ready) {
            return s;
        }
    }
    if is_ready() { ModelState::Ready } else { ModelState::Missing }
}

fn set(app: &AppHandle, s: ModelState) {
    *state().lock().unwrap() = Some(s);
    let _ = app.emit("pocket-model-status", status());
}

/// Settings → Download. Does nothing while one is under way.
pub fn download(app: AppHandle) {
    if matches!(status(), ModelState::Downloading { .. }) {
        return;
    }
    set(&app, ModelState::Downloading { fraction: 0.0 });
    tauri::async_runtime::spawn(async move {
        match fetch(&app).await {
            Ok(()) => {
                crate::log::line("voice: Pocket TTS downloaded");
                set(&app, ModelState::Ready);
            }
            Err(error) => {
                crate::log::line(format!("voice: Pocket TTS download failed: {error}"));
                set(&app, ModelState::Failed { error });
            }
        }
    });
}

/// Downloads `url` to `to`, checking its size and SHA-256; `progress` gets the fraction done.
async fn fetch_checked(client: &reqwest::Client, url: &str, size: u64, sha256: &str, to: &Path, mut progress: impl FnMut(f64)) -> Result<(), String> {
    let mut response = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status().as_u16()));
    }
    let mut out = std::fs::File::create(to).map_err(|e| e.to_string())?;
    let mut hash = ring::digest::Context::new(&ring::digest::SHA256);
    let mut got: u64 = 0;
    let mut last = Instant::now();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        out.write_all(&chunk).map_err(|e| e.to_string())?;
        hash.update(&chunk);
        got += chunk.len() as u64;
        if got > size {
            break;
        }
        if last.elapsed() > Duration::from_millis(250) {
            last = Instant::now();
            progress(got as f64 / size as f64);
        }
    }
    out.flush().map_err(|e| e.to_string())?;
    drop(out);
    let hex: String = hash.finish().as_ref().iter().map(|b| format!("{b:02x}")).collect();
    if got != size || hex != sha256 {
        let _ = std::fs::remove_file(to);
        return Err("the file that came in is not the expected one".into());
    }
    Ok(())
}

async fn fetch(app: &AppHandle) -> Result<(), String> {
    let root = speech::models_dir();
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(Duration::from_secs(60))
        .user_agent(concat!("JARVIS/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;
    // The model: 0–85 %, unpacking to 95 %, the voice last.
    let part = root.join(format!("{DIR}.tar.bz2.part"));
    fetch_checked(&client, ARCHIVE_URL, ARCHIVE_SIZE, ARCHIVE_SHA256, &part, |f| set(app, ModelState::Downloading { fraction: f * 0.85 })).await?;
    set(app, ModelState::Downloading { fraction: 0.87 });
    let (part2, root2) = (part.clone(), root.clone());
    tauri::async_runtime::spawn_blocking(move || crate::tts::unpack_folder(&part2, &root2, DIR))
        .await
        .map_err(|e| e.to_string())??;
    let _ = std::fs::remove_file(&part);
    set(app, ModelState::Downloading { fraction: 0.95 });
    let voice_part = dir().join(format!("{VOICE_FILE}.part"));
    fetch_checked(&client, VOICE_URL, VOICE_SIZE, VOICE_SHA256, &voice_part, |_| ()).await?;
    std::fs::rename(&voice_part, dir().join(VOICE_FILE)).map_err(|e| e.to_string())?;
    if !is_ready() {
        return Err("the archive did not hold the expected files".into());
    }
    Ok(())
}

/// Settings → Remove.
pub fn remove(app: &AppHandle) {
    *engine().lock().unwrap() = None;
    let _ = std::fs::remove_dir_all(dir());
    set(app, ModelState::Missing);
}

// ── Speaking ──────────────────────────────────────────────────────────────────

/// The model, and Peter's recording it speaks like (read once).
struct Engine {
    tts: OfflineTts,
    voice: Vec<f32>,
    rate: i32,
}
// sherpa-onnx's TTS object is used from one thread at a time, behind the mutex below.
unsafe impl Send for Engine {}

fn engine() -> &'static Mutex<Option<Engine>> {
    static E: OnceLock<Mutex<Option<Engine>>> = OnceLock::new();
    E.get_or_init(|| Mutex::new(None))
}

fn config(d: &Path, threads: i32) -> OfflineTtsConfig {
    let p = |name: &str| Some(d.join(name).to_string_lossy().into_owned());
    OfflineTtsConfig {
        model: OfflineTtsModelConfig {
            pocket: OfflineTtsPocketModelConfig {
                lm_flow: p("lm_flow.int8.onnx"),
                lm_main: p("lm_main.int8.onnx"),
                encoder: p("encoder.onnx"),
                decoder: p("decoder.int8.onnx"),
                text_conditioner: p("text_conditioner.onnx"),
                vocab_json: p("vocab.json"),
                token_scores_json: p("token_scores.json"),
                // Peter's recording is encoded once, then reused.
                voice_embedding_cache_capacity: 4,
            },
            num_threads: threads,
            ..Default::default()
        },
        ..Default::default()
    }
}

fn load(d: &Path, threads: i32) -> Option<Engine> {
    let started = Instant::now();
    let tts = OfflineTts::create(&config(d, threads))?;
    let wave = Wave::read(&d.join(VOICE_FILE).to_string_lossy())?;
    crate::log::line(format!("voice: Pocket TTS loaded in {:?}", started.elapsed()));
    Some(Engine { tts, voice: wave.samples().to_vec(), rate: wave.sample_rate() })
}

fn generate(e: &Engine, text: &str) -> Option<Vec<u8>> {
    let gen = GenerationConfig { reference_audio: Some(e.voice.clone()), reference_sample_rate: e.rate, ..Default::default() };
    let audio = e.tts.generate_with_config(text, &gen, None::<fn(&[f32], f32) -> bool>)?;
    let samples = audio.samples();
    if samples.is_empty() {
        return None;
    }
    Some(crate::tts::wav(samples, audio.sample_rate() as u32))
}

/// Loads the model ahead of need (off the caller's thread).
pub fn preload() {
    if !is_ready() || engine().lock().map(|g| g.is_some()).unwrap_or(true) {
        return;
    }
    std::thread::spawn(|| {
        let _ = speak("Ready.");
    });
}

/// `text` in Peter's voice, as a WAV; None when the voice isn't downloaded or fails.
pub fn speak(text: &str) -> Option<Vec<u8>> {
    let text = text.trim();
    if text.is_empty() || !is_ready() {
        return None;
    }
    let mut guard = engine().lock().ok()?;
    if guard.is_none() {
        *guard = Some(load(&dir(), THREADS)?);
    }
    generate(guard.as_ref()?, text)
}

// ── Starting sooner ───────────────────────────────────────────────────────────

/// The first piece of an answer longer than this is cut at its first pause.
const CUT_FROM: usize = 50;
/// Where that pause may be (characters): not a stub, not most of the sentence.
const PAUSE_FROM: usize = 12;
const PAUSE_UNTIL: usize = 90;

/// The answer's first piece, cut so Peter starts sooner (issue #100).
///
/// The model renders a whole piece before any of it can play (sherpa-onnx
/// hands Pocket's audio over only at the end), so a long first sentence kept
/// him silent for about 1.5 s. Its opening clause, up to the first comma,
/// semicolon or dash, is said on its own; the rest is rendered while that plays.
/// Pieces after the first need no cut: they render faster than he speaks.
pub fn first_cut(piece: &str) -> Vec<String> {
    let piece = piece.trim();
    if piece.chars().count() <= CUT_FROM {
        return vec![piece.to_string()];
    }
    let cut = piece.char_indices().enumerate().find_map(|(n, (i, c))| {
        let pause = matches!(c, ',' | ';' | '—' | '–') && piece[i + c.len_utf8()..].starts_with(' ');
        (pause && (PAUSE_FROM..=PAUSE_UNTIL).contains(&n)).then(|| i + c.len_utf8())
    });
    // No early pause: before the first « and », « but », « so »… where one breathes anyway.
    let cut = cut.filter(|&at| piece[..at].chars().count() <= JOIN_UNTIL).or_else(|| {
        piece.char_indices().enumerate().find_map(|(n, (i, _))| {
            let joins = JOINS.iter().any(|j| piece[i..].starts_with(j));
            (joins && (PAUSE_FROM..=JOIN_UNTIL).contains(&n)).then_some(i)
        })
    }).or(cut);
    match cut {
        Some(at) if !piece[at..].trim().is_empty() => vec![piece[..at].trim().to_string(), piece[at..].trim().to_string()],
        _ => vec![piece.to_string()],
    }
}

/// Words a sentence can be cut before, when no comma comes early enough.
const JOINS: &[&str] = &[" and ", " but ", " so ", " because ", " which ", " while ", " then "];
/// A pause later than this is passed over for an earlier join word, if there is one.
const JOIN_UNTIL: usize = 50;

// ── Commands ──────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PocketModel {
    pub status: ModelState,
    pub size: u64,
}

#[tauri::command]
pub fn pocket_model() -> PocketModel {
    PocketModel { status: status(), size: ARCHIVE_SIZE + VOICE_SIZE }
}

#[tauri::command]
pub fn pocket_model_download(app: AppHandle) {
    download(app);
}

#[tauri::command]
pub fn pocket_model_remove(app: AppHandle) {
    remove(&app);
}

/// Settings → ▶: a short line in Peter's voice (WAV).
#[tauri::command]
pub async fn pocket_preview() -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(|| speak("Good evening, sir. All systems are online, and your calendar is clear for the rest of the day."))
        .await
        .map_err(|e| e.to_string())?
        .map(tauri::ipc::Response::new)
        .ok_or_else(|| crate::i18n::t("The voice isn't downloaded yet."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_model_and_voice_are_pinned_and_checked() {
        assert!(ARCHIVE_URL.starts_with("https://github.com/k2-fsa/sherpa-onnx/releases/download/"));
        assert!(ARCHIVE_URL.ends_with(&format!("{DIR}.tar.bz2")));
        assert!(VOICE_URL.starts_with("https://huggingface.co/kyutai/tts-voices/resolve/"));
        assert!(VOICE_URL.ends_with(VOICE_FILE));
        assert_eq!(ARCHIVE_SHA256.len(), 64);
        assert_eq!(VOICE_SHA256.len(), 64);
    }

    #[test]
    fn a_long_first_sentence_starts_with_its_opening_clause() {
        assert_eq!(
            first_cut("I've drafted the reply to Martin, and I took the liberty of moving your four o'clock to Thursday."),
            vec!["I've drafted the reply to Martin,", "and I took the liberty of moving your four o'clock to Thursday."]
        );
    }

    #[test]
    fn a_short_sentence_or_one_without_a_pause_stays_whole() {
        assert_eq!(first_cut("Certainly, sir. It's ten past four."), vec!["Certainly, sir. It's ten past four."]);
        let none = "The meeting with the design team has been moved to Thursday afternoon at four o'clock.";
        assert_eq!(first_cut(none), vec![none]);
    }

    #[test]
    fn a_late_comma_gives_way_to_an_earlier_and() {
        assert_eq!(
            first_cut("I've drafted the reply to Martin and left it in your outbox, and I took the liberty of moving your four o'clock to Thursday."),
            vec!["I've drafted the reply to Martin", "and left it in your outbox, and I took the liberty of moving your four o'clock to Thursday."]
        );
    }

    #[test]
    fn a_stub_or_late_pause_is_not_a_cut() {
        // "Sir," is too short to say alone; a comma near the end saves nothing.
        let s = "Sir, the reply to Martin is drafted, waiting in your outbox for you to read";
        assert_eq!(first_cut(s), vec!["Sir, the reply to Martin is drafted,", "waiting in your outbox for you to read"]);
        let s = "Sir, the reply to Martin is drafted at last together with the notes from the meeting in your outbox";
        assert_eq!(first_cut(s), vec![s]);
        let late = "The reply to Martin is drafted for you in your outbox for you to read when you have a moment, sir.";
        assert_eq!(first_cut(late), vec![late]);
    }

    #[test]
    fn decimals_and_numbers_are_not_pauses() {
        let s = "Your balance is 1,250 pounds and the transfer of 3,400 pounds will arrive on Friday morning.";
        assert_eq!(first_cut(s), vec!["Your balance is 1,250 pounds", "and the transfer of 3,400 pounds will arrive on Friday morning."]);
    }

    /// First audio for a long first sentence, whole and cut; the cut one joined
    /// back for listening. JARVIS_POCKET_DIR=<…> [JARVIS_SAMPLES=<dir>]
    /// cargo test --release --lib pocket::tests::first_audio -- --ignored --nocapture
    #[test]
    #[ignore]
    fn first_audio() {
        let d = PathBuf::from(std::env::var("JARVIS_POCKET_DIR").unwrap());
        let out = std::env::var("JARVIS_SAMPLES").ok().map(PathBuf::from);
        let e = load(&d, THREADS).expect("model loads");
        let _ = generate(&e, "Warm up.");
        let lines = [
            "I've drafted the reply to Martin and left it in your outbox, and I took the liberty of moving your four o'clock to Thursday.",
            "Good evening, sir; the house is locked, the heating is set to twenty degrees and nothing needs your attention tonight.",
        ];
        for (i, line) in lines.iter().enumerate() {
            let t = Instant::now();
            let _ = generate(&e, line).unwrap();
            let whole = t.elapsed().as_millis();
            let parts = first_cut(line);
            let t = Instant::now();
            let first = generate(&e, &parts[0]).unwrap();
            let cut = t.elapsed().as_millis();
            println!("line {i}: whole {whole} ms, cut {cut} ms to first audio ({} parts)", parts.len());
            if let Some(o) = &out {
                let mut samples: Vec<u8> = first[44..].to_vec();
                for p in &parts[1..] {
                    samples.extend_from_slice(&generate(&e, p).unwrap()[44..]);
                }
                let mut wav = first[..44].to_vec();
                wav[4..8].copy_from_slice(&(36 + samples.len() as u32).to_le_bytes());
                wav[40..44].copy_from_slice(&(samples.len() as u32).to_le_bytes());
                wav.extend(samples);
                std::fs::write(o.join(format!("peter-cut-{i}.wav")), wav).unwrap();
            }
        }
    }

    /// How the model hands its audio over while it works: when each piece arrives.
    /// JARVIS_POCKET_DIR=<…> cargo test --release --lib pocket::tests::chunks -- --ignored --nocapture
    #[test]
    #[ignore]
    fn chunks() {
        let d = PathBuf::from(std::env::var("JARVIS_POCKET_DIR").unwrap());
        let e = load(&d, THREADS).expect("model loads");
        let _ = generate(&e, "Warm up.");
        let gen = GenerationConfig { reference_audio: Some(e.voice.clone()), reference_sample_rate: e.rate, ..Default::default() };
        let started = Instant::now();
        let mut n = 0usize;
        let audio = e
            .tts
            .generate_with_config(
                "I've drafted the reply to Martin and left it in your outbox, and I took the liberty of moving your four o'clock to Thursday.",
                &gen,
                Some(move |s: &[f32], p: f32| {
                    n += 1;
                    println!("piece {n}: {} samples at {} ms (progress {p:.2})", s.len(), started.elapsed().as_millis());
                    true
                }),
            )
            .expect("speaks");
        println!("all: {} samples in {} ms", audio.samples().len(), started.elapsed().as_millis());
    }

    /// With the model unpacked and the voice beside it: how fast Peter speaks,
    /// and how soon a sentence is ready, on 1, 2 and 4 threads.
    /// JARVIS_POCKET_DIR=<…/sherpa-onnx-pocket-tts-int8-2026-01-26> [JARVIS_SAMPLES=<dir>]
    /// cargo test --release --lib pocket::tests::speed -- --ignored --nocapture
    #[test]
    #[ignore]
    fn speed() {
        let d = PathBuf::from(std::env::var("JARVIS_POCKET_DIR").unwrap());
        let out = std::env::var("JARVIS_SAMPLES").ok().map(PathBuf::from);
        let lines = ["Certainly, sir.", "I've drafted the reply to Martin and left it in your outbox. Shall I send it, or would you like to read it first?"];
        for threads in [1, 2, 4] {
            let e = load(&d, threads).expect("model loads");
            let _ = generate(&e, "Warm up.");
            for (i, line) in lines.iter().enumerate() {
                let started = Instant::now();
                let wav = generate(&e, line).expect("speaks");
                let took = started.elapsed().as_secs_f64();
                let rate = u32::from_le_bytes(wav[24..28].try_into().unwrap()) as f64;
                let len = (wav.len() - 44) as f64 / 2.0 / rate;
                println!("threads {threads}: {took:.2} s for {len:.2} s of speech (x{:.2} real time)", len / took);
                if let Some(o) = &out {
                    std::fs::write(o.join(format!("peter-{threads}t-{i}.wav")), &wav).unwrap();
                }
            }
        }
    }
}
