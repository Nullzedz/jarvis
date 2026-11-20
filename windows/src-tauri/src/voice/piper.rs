// JARVIS: Piper, his offline backup voice. When Gemini can't speak (the free
// allowance used up, Google down, no key), Piper says the sentence instead —
// on this computer, free, unlimited. It's built for small machines: it renders
// many times faster than real time on a CPU, where Kokoro barely kept up.
//
// The voice is « Alan », a British man (vits-piper-en_GB-alan-medium, about
// 67 MB, from sherpa-onnx's own releases, MIT-licensed Piper model): downloaded
// on the user's click, checked against its published SHA-256, unpacked into the
// models folder, and run by sherpa-onnx (already here for Parakeet and Kokoro).

use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use sherpa_onnx::{GenerationConfig, OfflineTts, OfflineTtsConfig, OfflineTtsModelConfig, OfflineTtsVitsModelConfig};
use tauri::{AppHandle, Emitter};

use crate::speech::{self, ModelState};

const ARCHIVE_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_GB-alan-medium.tar.bz2";
const ARCHIVE_SIZE: u64 = 67_220_121;
const ARCHIVE_SHA256: &str = "a48d4017da0f77668b27bed63fe6e04dd64c6397e1fadad4f460efb0ef7c9012";
const DIR: &str = "vits-piper-en_GB-alan-medium";
const MODEL: &str = "en_GB-alan-medium.onnx";
/// A touch quicker than Piper's own pace, closer to Gemini's.
const LENGTH_SCALE: f32 = 0.92;

pub fn dir() -> PathBuf {
    speech::models_dir().join(DIR)
}

/// Whether the voice is on disk, whole.
pub fn is_ready() -> bool {
    let d = dir();
    d.join(MODEL).is_file() && d.join("tokens.txt").is_file() && d.join("espeak-ng-data").is_dir()
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
    let _ = app.emit("piper-model-status", status());
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
                crate::log::line("voice: Piper downloaded");
                set(&app, ModelState::Ready);
            }
            Err(error) => {
                crate::log::line(format!("voice: Piper download failed: {error}"));
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
    let (part2, root2) = (part.clone(), root.clone());
    tauri::async_runtime::spawn_blocking(move || crate::tts::unpack_folder(&part2, &root2, DIR))
        .await
        .map_err(|e| e.to_string())??;
    let _ = std::fs::remove_file(&part);
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
            vits: OfflineTtsVitsModelConfig {
                model: p(MODEL),
                tokens: p("tokens.txt"),
                data_dir: p("espeak-ng-data"),
                length_scale: LENGTH_SCALE,
                ..Default::default()
            },
            num_threads: 2,
            ..Default::default()
        },
        ..Default::default()
    }
}

/// Loads the voice ahead of need (off the caller's thread).
pub fn preload() {
    if !is_ready() || engine().lock().map(|g| g.is_some()).unwrap_or(true) {
        return;
    }
    std::thread::spawn(|| {
        let _ = speak(".");
    });
}

/// `text` in Alan's voice, as a WAV; None when the voice isn't downloaded or fails.
pub fn speak(text: &str) -> Option<Vec<u8>> {
    let text = text.trim();
    if text.is_empty() || !is_ready() {
        return None;
    }
    let mut guard = engine().lock().ok()?;
    if guard.is_none() {
        let started = Instant::now();
        let tts = OfflineTts::create(&config(&dir()))?;
        crate::log::line(format!("voice: Piper loaded in {:?}", started.elapsed()));
        *guard = Some(Engine(tts));
    }
    let tts = &guard.as_ref()?.0;
    let audio = tts.generate_with_config(text, &GenerationConfig::default(), None::<fn(&[f32], f32) -> bool>)?;
    let samples = audio.samples();
    if samples.is_empty() {
        return None;
    }
    Some(crate::tts::wav(samples, audio.sample_rate() as u32))
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiperModel {
    pub status: ModelState,
    pub size: u64,
}

#[tauri::command]
pub fn piper_model() -> PiperModel {
    PiperModel { status: status(), size: ARCHIVE_SIZE }
}

#[tauri::command]
pub fn piper_model_download(app: AppHandle) {
    download(app);
}

#[tauri::command]
pub fn piper_model_remove(app: AppHandle) {
    remove(&app);
}

/// Settings → ▶: a short line in Piper's voice (WAV).
#[tauri::command]
pub async fn piper_preview() -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(|| speak("Good evening, sir. Should Gemini be unavailable, I'll carry on in this voice."))
        .await
        .map_err(|e| e.to_string())?
        .map(tauri::ipc::Response::new)
        .ok_or_else(|| crate::i18n::t("The voice isn't downloaded yet."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_voice_is_alan_from_sherpa_onnx_and_checked() {
        assert!(ARCHIVE_URL.starts_with("https://github.com/k2-fsa/sherpa-onnx/releases/download/"));
        assert!(ARCHIVE_URL.ends_with(&format!("{DIR}.tar.bz2")));
        assert_eq!(ARCHIVE_SHA256.len(), 64);
        assert!(MODEL.starts_with("en_GB-alan"));
    }

    /// With the voice unpacked: how fast it renders.
    /// JARVIS_PIPER_DIR=<…/vits-piper-en_GB-alan-medium> cargo test --release --lib piper::tests::speed -- --ignored --nocapture
    #[test]
    #[ignore]
    fn speed() {
        let d = PathBuf::from(std::env::var("JARVIS_PIPER_DIR").unwrap());
        let tts = OfflineTts::create(&config(&d)).expect("model loads");
        let line = "I'm functioning quite adequately, sir, though I must note that as a voice assistant, I don't experience feelings.";
        let started = Instant::now();
        let audio = tts.generate_with_config(line, &GenerationConfig::default(), None::<fn(&[f32], f32) -> bool>).expect("speaks");
        let took = started.elapsed().as_secs_f64();
        let len = audio.samples().len() as f64 / audio.sample_rate() as f64;
        println!("{took:.2} s for {len:.2} s of speech (x{:.2})", took / len);
    }
}
