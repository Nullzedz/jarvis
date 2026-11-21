// JARVIS: his voice from Google Gemini's text-to-speech, with the user's own
// Google AI Studio key (kept in the system's key store as GEMINI_KEY). It
// replaces the offline Kokoro voice as the fast one: Kokoro renders at about
// real time on a PC, so the next sentence was never ready when the last one
// ended; Gemini sends a sentence's first audio in about a second.
//
// One request at a time (mod.rs): the first sentence alone, so he starts soon,
// then everything written meanwhile in one go — the free tier allows only a few
// requests a minute, and a request per sentence ran into it. The audio is 16-bit
// mono PCM at 24 kHz, gathered here into a WAV the pill plays.

use std::time::Duration;

use serde_json::{json, Value};

pub const GEMINI_KEY: &str = "gemini-api-key";
const API: &str = "https://generativelanguage.googleapis.com/v1beta";
/// The fast, cheaper of Gemini's speech models (it has a free allowance).
pub const MODEL: &str = "gemini-3.8-flash-lite-tts";
/// The voice: Charon, « informative », the JARVIS one.
pub const DEFAULT_VOICE: &str = "Charon";
/// The voices offered in Settings, deeper and calmer ones first: (id, how Google describes it).
pub const VOICES: &[(&str, &str)] = &[
    ("Charon", "Informative"),
    ("Orus", "Firm"),
    ("Iapetus", "Clear"),
    ("Algenib", "Gravelly"),
    ("Rasalgethi", "Informative"),
    ("Sadaltager", "Knowledgeable"),
    ("Schedar", "Even"),
    ("Puck", "Upbeat"),
];

/// A voice from Settings, or Charon for anything else.
pub fn voice(id: &str) -> &'static str {
    VOICES.iter().find(|(v, _)| v.eq_ignore_ascii_case(id)).map(|(v, _)| *v).unwrap_or(DEFAULT_VOICE)
}

/// Left alone Gemini talks slowly; this goes with every sentence.
const STYLE: &str = "a composed British butler, speaking quickly";
/// PCM rate Gemini sends.
const RATE: u32 = 24_000;
/// The longest a sentence may take to arrive.
const TIMEOUT: Duration = Duration::from_secs(15);

/// The request for one sentence.
pub fn request(text: &str, voice: &str) -> Value {
    json!({
        "model": MODEL,
        "input": [{ "type": "user_input", "content": [{ "type": "text", "text": text, "annotations": [{ "type": "speech_metadata", "style": STYLE }] }] }],
        "response_format": { "type": "audio" },
        "generation_config": { "speech_config": [{ "voice": voice }] },
        "stream": true,
    })
}

/// The audio in a stream of server-sent events: every `data:` line with an audio
/// delta, decoded and joined. Err with Gemini's message if it sent an error.
pub fn audio_from_events(body: &str) -> Result<Vec<u8>, String> {
    let mut pcm = Vec::new();
    for line in body.lines() {
        let s = line.trim().trim_start_matches("data:").trim();
        if !s.starts_with('{') {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(s) else { continue };
        if let Some(err) = v.get("error") {
            return Err(err["message"].as_str().unwrap_or("error").to_string());
        }
        if v["delta"]["type"] == "audio" {
            if let Some(data) = v["delta"]["data"].as_str() {
                pcm.extend(base64_decode(data).ok_or("bad audio data")?);
            }
        }
    }
    Ok(pcm)
}

/// Gemini's free speech models, in the order tried; each has its own free
/// allowance (per minute and per day), so when one is used up the next speaks,
/// in the same voice. The 3.8 ones take the Interactions API (with the style);
/// the older ones only `generateContent`.
pub const MODELS: &[(&str, Api)] = &[
    ("gemini-3.8-flash-lite-tts", Api::Interactions),
    ("gemini-3.8-flash-tts", Api::Interactions),
    ("gemini-3.1-flash-tts-preview", Api::GenerateContent),
    ("gemini-2.5-flash-preview-tts", Api::GenerateContent),
];

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Api {
    Interactions,
    GenerateContent,
}

/// A model that said its free allowance is used up rests this long before it's tried again.
const REST: Duration = Duration::from_secs(60);

/// Models resting after a 429, until when.
fn resting() -> &'static std::sync::Mutex<std::collections::HashMap<&'static str, std::time::Instant>> {
    static R: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<&'static str, std::time::Instant>>> = std::sync::OnceLock::new();
    R.get_or_init(Default::default)
}

/// The models to try now: the resting ones last (better late than silent).
fn order(now: std::time::Instant) -> Vec<(&'static str, Api)> {
    let rest = resting().lock().unwrap();
    let (ready, tired): (Vec<_>, Vec<_>) = MODELS.iter().copied().partition(|(m, _)| rest.get(m).is_none_or(|until| now >= *until));
    ready.into_iter().chain(tired).collect()
}

/// The `generateContent` request (older models): the style goes in the words.
fn content_request(text: &str, voice: &str) -> Value {
    json!({
        "contents": [{ "parts": [{ "text": format!("Say as {STYLE}: {text}") }] }],
        "generationConfig": { "responseModalities": ["AUDIO"], "speechConfig": { "voiceConfig": { "prebuiltVoiceConfig": { "voiceName": voice } } } }
    })
}

/// One piece from one model: the PCM, or (worth trying another model, why).
async fn fetch(client: &reqwest::Client, key: &str, text: &str, voice: &str, model: &'static str, api: Api) -> Result<Vec<u8>, (bool, String)> {
    let (url, body) = match api {
        Api::Interactions => {
            let mut body = request(text, voice);
            body["model"] = json!(model);
            (format!("{API}/interactions"), body)
        }
        Api::GenerateContent => (format!("{API}/models/{model}:generateContent"), content_request(text, voice)),
    };
    let response = client.post(url).header("x-goog-api-key", key).json(&body).send().await.map_err(|e| (true, e.to_string()))?;
    let status = response.status();
    let text = response.text().await.map_err(|e| (true, e.to_string()))?;
    if status.as_u16() == 429 {
        resting().lock().unwrap().insert(model, std::time::Instant::now() + REST);
        return Err((true, "free allowance used up for now".into()));
    }
    if !status.is_success() {
        let why = serde_json::from_str::<Value>(&text).ok().and_then(|v| v["error"]["message"].as_str().map(String::from));
        // Google's side (5xx): another model may answer. A refused key or request won't.
        return Err((status.is_server_error(), why.unwrap_or_else(|| format!("error {status}"))));
    }
    let pcm = match api {
        Api::Interactions => audio_from_events(&text).map_err(|e| (true, e))?,
        Api::GenerateContent => {
            let v: Value = serde_json::from_str(&text).map_err(|e| (true, e.to_string()))?;
            let data = v["candidates"][0]["content"]["parts"][0]["inlineData"]["data"].as_str().unwrap_or("");
            base64_decode(data).ok_or((true, "bad audio data".to_string()))?
        }
    };
    if pcm.len() < 2 {
        return Err((true, "no audio".into()));
    }
    Ok(pcm)
}

/// `text` in `voice`, as a WAV, or why not (logged): the free models in turn,
/// the ones resting after a 429 last.
pub fn speak_or_why(text: &str, voice: &str) -> Result<Vec<u8>, String> {
    let key = crate::secrets::get(GEMINI_KEY).ok_or_else(|| crate::i18n::t("Gemini couldn't speak: check the key."))?;
    let result = tauri::async_runtime::block_on(async {
        let client = reqwest::Client::builder().timeout(TIMEOUT).build().map_err(|e| e.to_string())?;
        let mut last = String::new();
        for (model, api) in order(std::time::Instant::now()) {
            match fetch(&client, &key, text, voice, model, api).await {
                Ok(pcm) => return Ok(pcm),
                Err((again, why)) => {
                    crate::log::line(format!("voice: Gemini {model}: {why}"));
                    last = why;
                    if !again {
                        break;
                    }
                }
            }
        }
        Err(last)
    });
    match result {
        Ok(mut pcm) => {
            pcm.truncate(pcm.len() / 2 * 2);
            let samples: Vec<f32> = pcm.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0).collect();
            Ok(crate::tts::wav(&samples, RATE))
        }
        Err(err) => Err(err),
    }
}

/// `text` in `voice`, as a WAV; None when no free model can (that piece is shown, not spoken).
pub fn speak(text: &str, voice: &str) -> Option<Vec<u8>> {
    speak_or_why(text, voice).ok()
}

/// The line each voice says in Settings.
const PREVIEW_LINE: &str = "Good evening, sir. All systems are online, and I'm at your service.";

/// Where a voice's sample is kept once heard: it never changes, so ▶ plays it at once.
fn preview_path(voice: &str) -> std::path::PathBuf {
    crate::speech::models_dir().join("gemini-samples").join(format!("{}.wav", self::voice(voice)))
}

/// A voice's sample: from disk, or fetched once and kept.
fn preview_wav(voice: &str) -> Result<Vec<u8>, String> {
    let path = preview_path(voice);
    if let Ok(wav) = std::fs::read(&path) {
        return Ok(wav);
    }
    let wav = speak_or_why(PREVIEW_LINE, self::voice(voice))?;
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(&path, &wav);
    Ok(wav)
}

/// Settings → ▶: a short line in that Gemini voice, as WAV bytes (kept after the
/// first time, so it plays at once); Err says why.
#[tauri::command]
pub async fn gemini_preview(voice: String) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || preview_wav(&voice))
        .await
        .map_err(|e| e.to_string())?
        .map(tauri::ipc::Response::new)
}

/// Settings opened on the Gemini voice: its sample fetched in the background,
/// so the first ▶ is instant too.
#[tauri::command]
pub fn gemini_warm_up(voice: String) {
    if crate::secrets::present(GEMINI_KEY) && !preview_path(&voice).exists() {
        std::thread::spawn(move || {
            let _ = preview_wav(&voice);
        });
    }
}

/// Settings: whether the saved key works — "ok", "none" (no key), "key" (refused) or "network".
#[tauri::command]
pub async fn gemini_key_check() -> String {
    let Some(key) = crate::secrets::get(GEMINI_KEY) else { return "none".into() };
    let Ok(client) = reqwest::Client::builder().timeout(Duration::from_secs(6)).build() else { return "network".into() };
    match client.get(format!("{API}/models?pageSize=1")).header("x-goog-api-key", &key).send().await {
        // A bad key is a 400 (API_KEY_INVALID), not a 401.
        Ok(r) if matches!(r.status().as_u16(), 400 | 401 | 403) => "key".into(),
        Ok(r) if r.status().is_success() => "ok".into(),
        _ => "network".into(),
    }
}

pub(super) fn base64_decode(s: &str) -> Option<Vec<u8>> {
    let val = |c: u8| -> Option<u32> {
        Some(match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            _ => return None,
        } as u32)
    };
    let bytes: Vec<u8> = s.bytes().filter(|c| !c.is_ascii_whitespace() && *c != b'=').collect();
    let mut out = Vec::with_capacity(bytes.len() * 3 / 4);
    for chunk in bytes.chunks(4) {
        let mut n = 0u32;
        for (i, &c) in chunk.iter().enumerate() {
            n |= val(c)? << (18 - 6 * i);
        }
        out.push((n >> 16) as u8);
        if chunk.len() > 2 {
            out.push((n >> 8) as u8);
        }
        if chunk.len() > 3 {
            out.push(n as u8);
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// With the key saved in Settings: which speech models and endpoints answer
    /// (status and Google's message; the key is never printed).
    /// `cargo test --lib gemini_endpoints -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn gemini_endpoints() {
        let key = crate::secrets::get(GEMINI_KEY).expect("a Gemini key saved in Settings");
        tauri::async_runtime::block_on(async move {
            let client = reqwest::Client::builder().timeout(Duration::from_secs(30)).build().unwrap();
            // The model list: which speech models this key sees.
            let models: Value = client.get(format!("{API}/models?pageSize=200")).header("x-goog-api-key", &key).send().await.unwrap().json().await.unwrap();
            let tts: Vec<String> = models["models"].as_array().into_iter().flatten().filter_map(|m| m["name"].as_str()).filter(|n| n.contains("tts")).map(String::from).collect();
            println!("speech models: {tts:?}");
            for model in ["gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts"] {
                let mut body = request("Good evening, sir.", DEFAULT_VOICE);
                body["model"] = json!(model);
                let r = client.post(format!("{API}/interactions")).header("x-goog-api-key", &key).json(&body).send().await.unwrap();
                let status = r.status();
                let text = r.text().await.unwrap_or_default();
                let audio = audio_from_events(&text).map(|a| a.len());
                println!("interactions {model}: {status} audio {audio:?} {}", text.chars().take(200).collect::<String>().replace('\n', " "));
            }
            for name in tts.iter().map(|n| n.trim_start_matches("models/").to_string()) {
                let body = json!({
                    "contents": [{ "parts": [{ "text": "Good evening, sir." }] }],
                    "generationConfig": { "responseModalities": ["AUDIO"], "speechConfig": { "voiceConfig": { "prebuiltVoiceConfig": { "voiceName": DEFAULT_VOICE } } } }
                });
                let r = client.post(format!("{API}/models/{name}:generateContent")).header("x-goog-api-key", &key).json(&body).send().await.unwrap();
                let status = r.status();
                let v: Value = r.json().await.unwrap_or_default();
                let bytes = v["candidates"][0]["content"]["parts"][0]["inlineData"]["data"].as_str().map(|d| d.len());
                println!("generateContent {name}: {status} audio(b64 len) {bytes:?} {}", v["error"]["message"]);
            }
        });
    }

    #[test]
    fn a_used_up_model_is_tried_last() {
        let now = std::time::Instant::now();
        assert_eq!(order(now)[0].0, "gemini-3.8-flash-lite-tts");
        resting().lock().unwrap().insert("gemini-3.8-flash-lite-tts", now + REST);
        let o = order(now);
        assert_eq!(o[0].0, "gemini-3.8-flash-tts");
        assert_eq!(o.last().unwrap().0, "gemini-3.8-flash-lite-tts");
        assert_eq!(order(now + REST)[0].0, "gemini-3.8-flash-lite-tts", "rested");
        resting().lock().unwrap().clear();
    }

    #[test]
    fn an_unknown_voice_is_charon() {
        assert_eq!(voice("orus"), "Orus");
        assert_eq!(voice("nobody"), "Charon");
    }

    #[test]
    fn asks_for_one_sentence_in_charon_streamed() {
        let r = request("Good evening, sir.", DEFAULT_VOICE);
        assert_eq!(r["model"], MODEL);
        assert_eq!(r["stream"], true);
        assert_eq!(r["generation_config"]["speech_config"][0]["voice"], "Charon");
        assert_eq!(r["input"][0]["content"][0]["text"], "Good evening, sir.");
    }

    #[test]
    fn the_audio_is_gathered_from_the_events() {
        // "AAEC" = [0, 1, 2], "AwQ=" = [3, 4]
        let body = "event: delta\ndata: {\"delta\":{\"type\":\"audio\",\"data\":\"AAEC\"}}\n\ndata: {\"delta\":{\"type\":\"text\"}}\ndata: {\"delta\":{\"type\":\"audio\",\"data\":\"AwQ=\"}}\ndata: [DONE]\n";
        assert_eq!(audio_from_events(body).unwrap(), vec![0, 1, 2, 3, 4]);
    }

    #[test]
    fn an_error_event_is_reported() {
        let body = "data: {\"error\":{\"message\":\"API key not valid\"}}\n";
        assert_eq!(audio_from_events(body).unwrap_err(), "API key not valid");
    }
}
