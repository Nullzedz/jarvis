// JARVIS: his own voice — Kokoro, a small text-to-speech model run on this
// computer by sherpa-onnx (already here for Parakeet). Nothing leaves the PC.
//
// The model (kokoro-int8-multi-lang-v1_0, about 130 MB, Apache-2.0) is one
// archive from sherpa-onnx's releases, downloaded on the user's click, checked
// against its published SHA-256, then unpacked into the models folder. JARVIS
// speaks English with its British lexicon, in one of four British male voices.

use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use sherpa_onnx::{GenerationConfig, OfflineTts, OfflineTtsConfig, OfflineTtsKokoroModelConfig, OfflineTtsModelConfig};
use tauri::{AppHandle, Emitter};

use crate::speech::{self, ModelState};

const ARCHIVE_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_0.tar.bz2";
const ARCHIVE_SIZE: u64 = 132_353_410;
const ARCHIVE_SHA256: &str = "72c347230107ef8a31098ec4d468a605244beef5f1ed00db97efa13518800653";
const DIR: &str = "kokoro-int8-multi-lang-v1_0";

/// A voice JARVIS can speak with: its id in the settings, its name, its speaker number in the model.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct Voice {
    pub id: &'static str,
    pub name: &'static str,
    #[serde(skip)]
    pub sid: i32,
}

/// The model's British male voices (numbers read from the model's own speaker table).
pub const VOICES: &[Voice] = &[
    Voice { id: "george", name: "George", sid: 26 },
    Voice { id: "lewis", name: "Lewis", sid: 27 },
    Voice { id: "daniel", name: "Daniel", sid: 24 },
    Voice { id: "fable", name: "Fable", sid: 25 },
];

pub const DEFAULT_VOICE: &str = "george";

pub fn voice(id: &str) -> &'static Voice {
    VOICES.iter().find(|v| v.id == id).unwrap_or(&VOICES[0])
}

pub fn dir() -> PathBuf {
    speech::models_dir().join(DIR)
}

/// Whether the model is on disk, whole.
pub fn is_ready() -> bool {
    let d = dir();
    d.join("model.int8.onnx").is_file() && d.join("voices.bin").is_file() && d.join("tokens.txt").is_file() && d.join("espeak-ng-data").is_dir()
}

// ── Download ──────────────────────────────────────────────────────────────────

fn state() -> &'static Mutex<Option<ModelState>> {
    static S: OnceLock<Mutex<Option<ModelState>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(None))
}

/// What Settings shows: missing, downloading (and how far), ready, or failed.
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
    let _ = app.emit("voice-model-status", status());
}

/// Settings → Download the voice. Does nothing while one is under way.
pub fn download(app: AppHandle) {
    if matches!(status(), ModelState::Downloading { .. }) {
        return;
    }
    set(&app, ModelState::Downloading { fraction: 0.0 });
    tauri::async_runtime::spawn(async move {
        let result = fetch(&app).await;
        match result {
            Ok(()) => {
                crate::log::line("voice: Kokoro downloaded");
                set(&app, ModelState::Ready);
            }
            Err(error) => {
                crate::log::line(format!("voice: Kokoro download failed: {error}"));
                set(&app, ModelState::Failed { error });
            }
        }
    });
}

async fn fetch(app: &AppHandle) -> Result<(), String> {
    let root = speech::models_dir();
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let part = root.join(format!("{DIR}.tar.bz2.part"));
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(Duration::from_secs(60))
        .user_agent(concat!("JARVIS/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = client.get(ARCHIVE_URL).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status().as_u16()));
    }
    let mut out = std::fs::File::create(&part).map_err(|e| e.to_string())?;
    let mut hash = ring::digest::Context::new(&ring::digest::SHA256);
    let mut got: u64 = 0;
    let mut last = Instant::now();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        out.write_all(&chunk).map_err(|e| e.to_string())?;
        hash.update(&chunk);
        got += chunk.len() as u64;
        if got > ARCHIVE_SIZE {
            break;
        }
        if last.elapsed() > Duration::from_millis(250) {
            last = Instant::now();
            // The last 10 % is the unpacking.
            set(app, ModelState::Downloading { fraction: got as f64 / ARCHIVE_SIZE as f64 * 0.9 });
        }
    }
    out.flush().map_err(|e| e.to_string())?;
    drop(out);
    let hex: String = hash.finish().as_ref().iter().map(|b| format!("{b:02x}")).collect();
    if got != ARCHIVE_SIZE || hex != ARCHIVE_SHA256 {
        let _ = std::fs::remove_file(&part);
        return Err("the file that came in is not the expected one".into());
    }
    set(app, ModelState::Downloading { fraction: 0.92 });
    let part2 = part.clone();
    let root2 = root.clone();
    tauri::async_runtime::spawn_blocking(move || unpack(&part2, &root2))
        .await
        .map_err(|e| e.to_string())??;
    let _ = std::fs::remove_file(&part);
    if !is_ready() {
        return Err("the archive did not hold the expected files".into());
    }
    Ok(())
}

/// Unpacks the archive into `root`.
fn unpack(archive: &std::path::Path, root: &std::path::Path) -> Result<(), String> {
    unpack_folder(archive, root, DIR)
}

/// Where an archive entry goes under `root`: only plain relative paths inside
/// `folder` — no `..`, no drive or root, nothing else — or None to skip it.
pub(crate) fn entry_target(root: &std::path::Path, folder: &str, path: &std::path::Path) -> Option<std::path::PathBuf> {
    use std::path::Component;
    if !path.starts_with(folder) || !path.components().all(|c| matches!(c, Component::Normal(_))) {
        return None;
    }
    Some(root.join(path))
}

/// Unpacks only the archive's `folder` into `root` (JARVIS: Piper's archive too, voice/piper.rs).
///
/// JARVIS: checked here rather than by the tar crate's `unpack_in`, which
/// compares real (canonical) paths: where Windows redirects a packaged app's
/// AppData folders (MSIX), a folder just made inside `root` resolves elsewhere
/// and every file was refused as « outside of destination ». Only plain files
/// and folders are written; links and anything else are skipped.
pub(crate) fn unpack_folder(archive: &std::path::Path, root: &std::path::Path, folder: &str) -> Result<(), String> {
    let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    let mut tar = tar::Archive::new(bzip2::read::BzDecoder::new(std::io::BufReader::new(file)));
    for entry in tar.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().map_err(|e| e.to_string())?.into_owned();
        let Some(target) = entry_target(root, folder, &path) else { continue };
        let kind = entry.header().entry_type();
        if kind.is_dir() {
            std::fs::create_dir_all(&target).map_err(|e| format!("{e} ({})", path.display()))?;
        } else if kind.is_file() {
            let named = |e: std::io::Error| format!("{e} ({})", path.display());
            if let Some(dir) = target.parent() {
                std::fs::create_dir_all(dir).map_err(named)?;
            }
            let mut out = std::fs::File::create(&target).map_err(named)?;
            std::io::copy(&mut entry, &mut out).map_err(named)?;
        }
    }
    Ok(())
}

/// Settings → Remove the voice.
pub fn remove(app: &AppHandle) {
    *engine().lock().unwrap() = None;
    let _ = std::fs::remove_dir_all(dir());
    set(app, ModelState::Missing);
}

// ── Speaking ──────────────────────────────────────────────────────────────────

struct Engine(OfflineTts);
// sherpa-onnx's TTS object is used from one thread at a time, behind the mutex below.
unsafe impl Send for Engine {}

fn engine() -> &'static Mutex<Option<Engine>> {
    static E: OnceLock<Mutex<Option<Engine>>> = OnceLock::new();
    E.get_or_init(|| Mutex::new(None))
}

fn config(d: &std::path::Path) -> OfflineTtsConfig {
    let p = |name: &str| Some(d.join(name).to_string_lossy().into_owned());
    OfflineTtsConfig {
        model: OfflineTtsModelConfig {
            kokoro: OfflineTtsKokoroModelConfig {
                model: p("model.int8.onnx"),
                voices: p("voices.bin"),
                tokens: p("tokens.txt"),
                data_dir: p("espeak-ng-data"),
                // The multi-language model wants its lexicons together (British
                // English first, so its spellings win) and the dictionary folder.
                lexicon: Some(format!(
                    "{},{}",
                    d.join("lexicon-gb-en.txt").to_string_lossy(),
                    d.join("lexicon-zh.txt").to_string_lossy()
                )),
                dict_dir: p("dict"),
                ..Default::default()
            },
            num_threads: threads(),
            ..Default::default()
        },
        max_num_sentences: 2,
        ..Default::default()
    }
}

/// Up to 4 of the computer's cores (one left for everything else);
/// JARVIS_TTS_THREADS overrides it, to measure (the speed test below).
fn threads() -> i32 {
    if let Some(n) = std::env::var("JARVIS_TTS_THREADS").ok().and_then(|v| v.parse::<i32>().ok()) {
        return n.max(1);
    }
    std::thread::available_parallelism().map(|n| n.get().saturating_sub(1).clamp(1, 4) as i32).unwrap_or(2)
}

/// Loads the model ahead of the first sentence, off the caller's thread (the
/// load takes a second or two). Does nothing when it is loaded or missing.
pub fn preload() {
    if !is_ready() || engine().lock().map(|g| g.is_some()).unwrap_or(true) {
        return;
    }
    std::thread::spawn(|| {
        let _ = speak(".", DEFAULT_VOICE, 1.0);
    });
}

/// `text` spoken in `voice`, as a 16-bit mono WAV. None when the model is not
/// there or fails (the system voice speaks instead).
pub fn speak(text: &str, voice_id: &str, speed: f32) -> Option<Vec<u8>> {
    let text = text.trim();
    if text.is_empty() || !is_ready() {
        return None;
    }
    let mut guard = engine().lock().ok()?;
    if guard.is_none() {
        let started = Instant::now();
        let tts = OfflineTts::create(&config(&dir()))?;
        crate::log::line(format!("voice: Kokoro loaded in {:?}", started.elapsed()));
        *guard = Some(Engine(tts));
    }
    let tts = &guard.as_ref()?.0;
    let gen = GenerationConfig { sid: voice(voice_id).sid, speed, ..Default::default() };
    let audio = tts.generate_with_config(text, &gen, None::<fn(&[f32], f32) -> bool>)?;
    let samples = audio.samples();
    if samples.is_empty() {
        return None;
    }
    Some(wav(samples, audio.sample_rate() as u32))
}

/// 16-bit PCM mono WAV of `samples` (−1…1).
pub fn wav(samples: &[f32], rate: u32) -> Vec<u8> {
    let data_len = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for s in samples {
        let v = (s.clamp(-1.0, 1.0) * 32767.0).round() as i16;
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceModel {
    pub status: ModelState,
    pub voices: &'static [Voice],
    pub size: u64,
}

#[tauri::command]
pub fn voice_model() -> VoiceModel {
    VoiceModel { status: status(), voices: VOICES, size: ARCHIVE_SIZE }
}

#[tauri::command]
pub fn voice_model_download(app: AppHandle) {
    download(app);
}

#[tauri::command]
pub fn voice_model_remove(app: AppHandle) {
    remove(&app);
}

/// The previews already rendered, by voice: a second ▶ plays at once.
fn previews() -> &'static Mutex<std::collections::HashMap<String, Vec<u8>>> {
    static P: OnceLock<Mutex<std::collections::HashMap<String, Vec<u8>>>> = OnceLock::new();
    P.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

const PREVIEW_LINE: &str = "Good evening, sir. All systems are online, and your calendar is clear for the rest of the day.";

fn preview_wav(voice: &str) -> Option<Vec<u8>> {
    if let Some(w) = previews().lock().ok()?.get(voice).cloned() {
        return Some(w);
    }
    let w = speak(PREVIEW_LINE, voice, 1.0)?;
    previews().lock().ok()?.insert(voice.to_string(), w.clone());
    Some(w)
}

/// Settings → a voice's ▶: a short line in that voice, as WAV bytes.
#[tauri::command]
pub async fn voice_preview(voice: String) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || preview_wav(&voice))
        .await
        .map_err(|e| e.to_string())?
        .map(tauri::ipc::Response::new)
        .ok_or_else(|| "The voice isn't downloaded yet.".to_string())
}

/// Settings opened on JARVIS's voice: load the model and render the chosen
/// voice's preview in the background, so ▶ answers at once.
#[tauri::command]
pub fn voice_warm_up(voice: String) {
    if !is_ready() {
        return;
    }
    std::thread::spawn(move || {
        let _ = preview_wav(&voice);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_wav_header_and_its_samples() {
        let w = wav(&[0.0, 1.0, -1.0, 2.0], 24_000);
        assert_eq!(&w[0..4], b"RIFF");
        assert_eq!(&w[8..16], b"WAVEfmt ");
        assert_eq!(u32::from_le_bytes(w[24..28].try_into().unwrap()), 24_000);
        assert_eq!(u32::from_le_bytes(w[40..44].try_into().unwrap()), 8);
        let s: Vec<i16> = w[44..].chunks(2).map(|c| i16::from_le_bytes([c[0], c[1]])).collect();
        assert_eq!(s, vec![0, 32767, -32767, 32767], "clamped");
    }

    #[test]
    fn voices_are_the_british_men_and_unknown_ids_fall_back() {
        assert_eq!(voice("lewis").sid, 27);
        assert_eq!(voice("nobody").id, DEFAULT_VOICE);
        assert_eq!(VOICES.iter().map(|v| v.sid).collect::<Vec<_>>(), vec![26, 27, 24, 25]);
    }

    /// How fast JARVIS's voice renders: seconds of rendering per second of speech.
    /// JARVIS_KOKORO_DIR=<…> [JARVIS_TTS_THREADS=n] cargo test --lib tts::tests::speed -- --ignored --nocapture
    #[test]
    #[ignore]
    fn speed() {
        let d = PathBuf::from(std::env::var("JARVIS_KOKORO_DIR").unwrap());
        let tts = OfflineTts::create(&config(&d)).expect("model loads");
        let gen = GenerationConfig { sid: VOICES[0].sid, speed: 1.0, ..Default::default() };
        let _ = tts.generate_with_config("Warm up.", &gen, None::<fn(&[f32], f32) -> bool>);
        for line in ["Certainly, sir.", "I'm functioning quite adequately, sir, though I must note that as a voice assistant, I don't experience feelings."] {
            let started = Instant::now();
            let audio = tts.generate_with_config(line, &gen, None::<fn(&[f32], f32) -> bool>).expect("speaks");
            let took = started.elapsed().as_secs_f64();
            let len = audio.samples().len() as f64 / audio.sample_rate() as f64;
            println!("threads {}: {took:.2} s for {len:.2} s of speech (x{:.2})", threads(), took / len);
        }
    }

    #[test]
    fn only_plain_paths_inside_the_models_folder_are_unpacked() {
        let root = std::path::Path::new("models");
        let ok = |p: &str| entry_target(root, "vits-piper", std::path::Path::new(p)).is_some();
        assert!(ok("vits-piper/tokens.txt"));
        assert!(ok("vits-piper/espeak-ng-data/en_dict"));
        assert!(!ok("vits-piper/../../evil.exe"), "no climbing out");
        assert!(!ok("other/tokens.txt"), "only its own folder");
        assert!(!ok("/vits-piper/x"), "no absolute path");
    }

    /// Unpacks an archive the way the app does:
    /// JARVIS_ARCHIVE=<…tar.bz2> JARVIS_UNPACK_TO=<dir> JARVIS_FOLDER=<folder> cargo test --lib tts::tests::unpack_archive -- --ignored --nocapture
    #[test]
    #[ignore]
    fn unpack_archive() {
        let archive = PathBuf::from(std::env::var("JARVIS_ARCHIVE").unwrap());
        let to = PathBuf::from(std::env::var("JARVIS_UNPACK_TO").unwrap());
        std::fs::create_dir_all(&to).unwrap();
        let r = unpack_folder(&archive, &to, &std::env::var("JARVIS_FOLDER").unwrap());
        println!("unpack: {r:?}");
    }

    /// Renders a sample per voice from an unpacked model:
    /// JARVIS_KOKORO_DIR=<…/kokoro-int8-multi-lang-v1_0> JARVIS_SAMPLES=<out dir> cargo test -p coucou --lib tts::tests::render -- --ignored
    #[test]
    #[ignore]
    fn render_samples() {
        let d = PathBuf::from(std::env::var("JARVIS_KOKORO_DIR").unwrap());
        let out = PathBuf::from(std::env::var("JARVIS_SAMPLES").unwrap());
        let tts = OfflineTts::create(&config(&d)).expect("model loads");
        let line = std::env::var("JARVIS_LINE").unwrap_or_else(|_| "Good evening, sir. All systems are online, and your calendar is clear for the rest of the day.".into());
        let prefix = std::env::var("JARVIS_PREFIX").unwrap_or_else(|_| "jarvis-voice".into());
        for v in VOICES {
            let started = Instant::now();
            let gen = GenerationConfig { sid: v.sid, speed: 1.0, ..Default::default() };
            let audio = tts.generate_with_config(&line, &gen, None::<fn(&[f32], f32) -> bool>).expect("speaks");
            std::fs::write(out.join(format!("{prefix}-{}.wav", v.id)), wav(audio.samples(), audio.sample_rate() as u32)).unwrap();
            println!("{} in {:?}", v.name, started.elapsed());
        }
    }
}
