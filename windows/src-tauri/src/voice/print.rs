// JARVIS: voice training, as with « Hey Siri ». You say « Hey JARVIS » five
// times; from that JARVIS keeps, on this computer only:
// - a voiceprint: the average speaker embedding of the five takes (3D-Speaker
//   CAM++, the model the call notes already use to tell people apart), so with
//   « Only answer my voice » on he ignores anyone else, the TV, a video;
// - how Parakeet spelled the phrase in your voice, so those spellings wake him
//   too (an accent the built-in list does not know).
//
// The audio is never kept: each take becomes 192 numbers and a few words.

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use sherpa_onnx::{SpeakerEmbeddingExtractor, SpeakerEmbeddingExtractorConfig};
use tauri::{AppHandle, Emitter};

use super::wake;

pub const TAKES: usize = 5;
const SAMPLE_RATE: i32 = 16_000;

/// What each take asks you to say, in order: a different phrase each time, as
/// with « Hey Siri » (longer, varied takes also make a steadier voiceprint).
pub const PROMPTS: [&str; TAKES] = [
    "Hey JARVIS",
    "Hey JARVIS, what's the weather today?",
    "Hey JARVIS, play some music.",
    "Hey JARVIS, what time is it?",
    "Hey JARVIS, open my calendar.",
];

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct VoicePrint {
    /// The average embedding of the takes, normalised.
    pub embedding: Vec<f32>,
    pub takes: usize,
    /// How Parakeet wrote the phrase in this voice when the built-in list did not
    /// know it: normalised, one to three words ("hey jervis").
    pub spellings: Vec<String>,
}

fn path() -> PathBuf {
    crate::platform::config_dir().join("voiceprint.json")
}

fn cache() -> &'static Mutex<Option<Option<VoicePrint>>> {
    static C: OnceLock<Mutex<Option<Option<VoicePrint>>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(None))
}

/// The saved voiceprint, if any (read once, then kept).
pub fn load() -> Option<VoicePrint> {
    let mut c = cache().lock().unwrap();
    if c.is_none() {
        let read = std::fs::read_to_string(path()).ok().and_then(|s| serde_json::from_str::<VoicePrint>(&s).ok());
        *c = Some(read.filter(|p| !p.embedding.is_empty()));
    }
    c.clone().flatten()
}

fn save(print: &VoicePrint) -> Result<(), String> {
    let p = path();
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&p, serde_json::to_string(print).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    *cache().lock().unwrap() = Some(Some(print.clone()));
    Ok(())
}

/// Settings → Forget my voice.
pub fn forget() {
    let _ = std::fs::remove_file(path());
    *cache().lock().unwrap() = Some(None);
}

// ── Embeddings ────────────────────────────────────────────────────────────────

struct Extractor(SpeakerEmbeddingExtractor);
// Used from one thread at a time, behind the mutex below.
unsafe impl Send for Extractor {}

fn extractor() -> &'static Mutex<Option<Extractor>> {
    static E: OnceLock<Mutex<Option<Extractor>>> = OnceLock::new();
    E.get_or_init(|| Mutex::new(None))
}

/// The speaker embedding of 16 kHz `samples`, normalised; None when the model is
/// not downloaded or the audio is too short.
pub fn embed(samples: &[f32]) -> Option<Vec<f32>> {
    let model = crate::speech::DIARIZER.path("embedding.onnx");
    if !std::path::Path::new(&model).is_file() || samples.len() < SAMPLE_RATE as usize / 4 {
        return None;
    }
    let mut guard = extractor().lock().ok()?;
    if guard.is_none() {
        let config = SpeakerEmbeddingExtractorConfig { model: Some(model), num_threads: 2, ..Default::default() };
        *guard = Some(Extractor(SpeakerEmbeddingExtractor::create(&config)?));
    }
    let ex = &guard.as_ref()?.0;
    let stream = ex.create_stream()?;
    stream.accept_waveform(SAMPLE_RATE, samples);
    stream.input_finished();
    if !ex.is_ready(&stream) {
        return None;
    }
    ex.compute(&stream).map(normalised)
}

pub fn normalised(mut v: Vec<f32>) -> Vec<f32> {
    let n = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if n > 0.0 {
        v.iter_mut().for_each(|x| *x /= n);
    }
    v
}

/// Cosine similarity of two normalised vectors.
pub fn similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

/// The average of normalised embeddings, normalised again.
pub fn average(takes: &[Vec<f32>]) -> Vec<f32> {
    let Some(first) = takes.first() else { return Vec::new() };
    let dim = first.len();
    let mut sum = vec![0.0f32; dim];
    for t in takes.iter().filter(|t| t.len() == dim) {
        sum.iter_mut().zip(t).for_each(|(s, x)| *s += x);
    }
    normalised(sum)
}

/// How close a voice must be, by strictness. Calibrated on Kokoro's voices (the
/// `calibrate` test): the same voice on another line scores 0.85–0.88, other
/// voices 0.18–0.65 (two close British men at the top of that range).
pub fn threshold(strictness: &str) -> f32 {
    match strictness {
        "relaxed" => 0.40,
        "strict" => 0.70,
        _ => 0.55,
    }
}

/// Whether `samples` sound like the trained voice (and the score, for the log).
/// True when nothing is trained: nothing to compare with.
pub fn is_my_voice(samples: &[f32], strictness: &str) -> (bool, f32) {
    let Some(print) = load() else { return (true, 1.0) };
    let Some(e) = embed(samples) else { return (true, 1.0) };
    let score = similarity(&e, &print.embedding);
    (score >= threshold(strictness), score)
}

/// The wake phrase spelled as Parakeet spells it in the trained voice: what was
/// said after it, when `text` starts with one of the learned spellings.
pub fn learned_wake(text: &str) -> Option<String> {
    let print = load()?;
    learned_wake_in(text, &print.spellings)
}

pub fn learned_wake_in(text: &str, spellings: &[String]) -> Option<String> {
    let words: Vec<&str> = text.split_whitespace().collect();
    let norm: Vec<String> = words.iter().map(|w| wake::normalize(w)).collect();
    for spelling in spellings {
        let parts: Vec<&str> = spelling.split(' ').collect();
        if parts.is_empty() || parts.len() > norm.len() {
            continue;
        }
        if parts.iter().zip(&norm).all(|(a, b)| a == b) {
            return Some(words[parts.len()..].join(" ").trim_start_matches([',', '.', '!', ' ']).trim().to_string());
        }
    }
    None
}

// ── Training ──────────────────────────────────────────────────────────────────

struct Training {
    takes: Vec<Vec<f32>>,
    spellings: Vec<String>,
}

fn training() -> &'static Mutex<Option<Training>> {
    static T: OnceLock<Mutex<Option<Training>>> = OnceLock::new();
    T.get_or_init(|| Mutex::new(None))
}

pub fn training_active() -> bool {
    training().lock().map(|t| t.is_some()).unwrap_or(false)
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrainEvent {
    /// "listening" (waiting for a take), "retry" (that one didn't count), "done", "error".
    pub phase: &'static str,
    pub count: usize,
    pub total: usize,
    pub prompt: String,
    pub message: String,
}

fn emit(app: &AppHandle, phase: &'static str, count: usize, message: &str) {
    let prompt = PROMPTS.get(count).copied().unwrap_or("").to_string();
    let _ = app.emit("voice-train", TrainEvent { phase, count, total: TAKES, prompt, message: message.to_string() });
}

/// Settings → Teach JARVIS your voice → Start.
pub fn start(app: &AppHandle) -> Result<(), String> {
    if !crate::speech::is_ready() {
        return Err("Download the voice model (Parakeet) first.".into());
    }
    if !std::path::Path::new(&crate::speech::DIARIZER.path("embedding.onnx")).is_file() {
        return Err("Download the voice model first: it includes the one that recognises voices.".into());
    }
    *training().lock().unwrap() = Some(Training { takes: Vec::new(), spellings: Vec::new() });
    super::sync(app);
    emit(app, "listening", 0, "");
    Ok(())
}

pub fn cancel(app: &AppHandle) {
    *training().lock().unwrap() = None;
    super::sync(app);
}

/// One stretch of speech heard while training: a take, or a "try again".
pub fn take(app: &AppHandle, samples: &[f32], heard: &str) {
    let words = wake::normalize(heard);
    let count_words = words.split_whitespace().count();
    // A take starts with the wake phrase: a known spelling of it, or the first words of what was said.
    let known = wake::after_wake(heard).is_some();
    if !(1..=12).contains(&count_words) {
        let n = training().lock().unwrap().as_ref().map(|t| t.takes.len()).unwrap_or(0);
        emit(app, "retry", n, "I didn't quite catch « Hey JARVIS ». Try again.");
        return;
    }
    let Some(e) = embed(samples) else {
        let n = training().lock().unwrap().as_ref().map(|t| t.takes.len()).unwrap_or(0);
        emit(app, "retry", n, "That was a bit short. Try again.");
        return;
    };
    let finished = {
        let mut guard = training().lock().unwrap();
        let Some(t) = guard.as_mut() else { return };
        t.takes.push(e);
        // A spelling the built-in list does not know: learn its first two words ("hey jervis").
        if !known {
            let spelling: String = words.split_whitespace().take(2).collect::<Vec<_>>().join(" ");
            if !spelling.is_empty() && !t.spellings.contains(&spelling) {
                t.spellings.push(spelling);
            }
        }
        if t.takes.len() >= TAKES {
            guard.take()
        } else {
            let n = t.takes.len();
            drop(guard);
            emit(app, "listening", n, "");
            None
        }
    };
    if let Some(t) = finished {
        let print = VoicePrint { embedding: average(&t.takes), takes: t.takes.len(), spellings: t.spellings };
        match save(&print) {
            Ok(()) => {
                crate::log::line(format!("voice: voiceprint saved ({} takes, {} learned spellings)", print.takes, print.spellings.len()));
                emit(app, "done", TAKES, "");
            }
            Err(err) => emit(app, "error", TAKES, &err),
        }
        super::sync(app);
    }
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintStatus {
    pub trained: bool,
    pub takes: usize,
    pub training: bool,
}

#[tauri::command]
pub fn voice_print_status() -> PrintStatus {
    let p = load();
    PrintStatus { trained: p.is_some(), takes: p.map(|p| p.takes).unwrap_or(0), training: training_active() }
}

#[tauri::command]
pub fn voice_train_start(app: AppHandle) -> Result<(), String> {
    start(&app)
}

#[tauri::command]
pub fn voice_train_cancel(app: AppHandle) {
    cancel(&app);
}

#[tauri::command]
pub fn voice_print_forget() {
    forget();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn similarity_and_average() {
        let a = normalised(vec![1.0, 0.0]);
        let b = normalised(vec![0.0, 2.0]);
        assert!((similarity(&a, &a) - 1.0).abs() < 1e-6);
        assert!(similarity(&a, &b).abs() < 1e-6);
        let avg = average(&[a.clone(), b.clone()]);
        assert!((similarity(&avg, &a) - std::f32::consts::FRAC_1_SQRT_2).abs() < 1e-5);
        assert_eq!(similarity(&a, &[1.0]), 0.0, "mismatched sizes never match");
    }

    #[test]
    fn strictness_orders_the_thresholds() {
        assert!(threshold("relaxed") < threshold("balanced"));
        assert!(threshold("balanced") < threshold("strict"));
        assert_eq!(threshold("unknown"), threshold("balanced"));
    }

    #[test]
    fn learned_spellings_wake_him_and_pass_on_the_rest() {
        let learned = vec!["hey jervis".to_string(), "avis".to_string()];
        assert_eq!(learned_wake_in("Hey, Jervis! What time is it?", &learned).as_deref(), Some("What time is it?"));
        assert_eq!(learned_wake_in("Avis open my mail", &learned).as_deref(), Some("open my mail"));
        assert_eq!(learned_wake_in("hey there", &learned), None);
        assert_eq!(learned_wake_in("", &learned), None);
    }
}

#[cfg(test)]
mod calibrate {
    use super::*;

    fn read_wav_16k(path: &str) -> Vec<f32> {
        let b = std::fs::read(path).unwrap();
        let rate = u32::from_le_bytes(b[24..28].try_into().unwrap()) as f32;
        let s: Vec<f32> = b[44..].chunks(2).map(|c| i16::from_le_bytes([c[0], c[1]]) as f32 / 32768.0).collect();
        let n = (s.len() as f32 * 16_000.0 / rate) as usize;
        (0..n).map(|i| s[((i as f32 * rate / 16_000.0) as usize).min(s.len() - 1)]).collect()
    }

    /// Same voice (two different lines) vs different voices, on Kokoro's renders:
    /// JARVIS_WAVS=<dir with jarvis-voice-*.wav and jarvis-line2-*.wav> cargo test -p coucou --lib calibrate -- --ignored --nocapture
    #[test]
    #[ignore]
    fn same_voice_scores_high_other_voices_low() {
        let dir = std::env::var("JARVIS_WAVS").unwrap();
        let ids = ["george", "lewis", "daniel", "fable"];
        let a: Vec<Vec<f32>> = ids.iter().map(|v| embed(&read_wav_16k(&format!("{dir}/jarvis-voice-{v}.wav"))).unwrap()).collect();
        let b: Vec<Vec<f32>> = ids.iter().map(|v| embed(&read_wav_16k(&format!("{dir}/jarvis-line2-{v}.wav"))).unwrap()).collect();
        for i in 0..4 {
            let row: Vec<String> = (0..4).map(|j| format!("{:.2}", similarity(&a[i], &b[j]))).collect();
            println!("{:>7}: {}", ids[i], row.join("  "));
        }
    }
}
