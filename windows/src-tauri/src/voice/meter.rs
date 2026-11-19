// JARVIS: the loudness bar in Settings → Hey JARVIS. A light capture of the
// chosen microphone that sends its level ten times a second, so you can see
// that JARVIS hears you (and how loud you come through) before training.
//
// It only runs while the page asks: the page pings every couple of seconds,
// and the capture stops by itself when the pings stop. Only a number leaves
// it: the audio is not kept.

use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

use crate::speech::audio;

struct Meter {
    /// Dropping it stops the microphone.
    _capture: audio::Capture,
    mic: String,
}

fn meter() -> &'static Mutex<Option<Meter>> {
    static M: OnceLock<Mutex<Option<Meter>>> = OnceLock::new();
    M.get_or_init(|| Mutex::new(None))
}

fn last_ping() -> &'static Mutex<Instant> {
    static P: OnceLock<Mutex<Instant>> = OnceLock::new();
    P.get_or_init(|| Mutex::new(Instant::now()))
}

/// A level from 0 to 1 for the bar: −60 dBFS is empty, −10 dBFS is full.
pub fn level(rms: f32) -> f32 {
    if rms <= 0.0 {
        return 0.0;
    }
    ((20.0 * rms.log10() + 60.0) / 50.0).clamp(0.0, 1.0)
}

/// Starts the meter on `mic` ("" for automatic), or keeps it going. Called
/// again every couple of seconds by the page.
#[tauri::command]
pub fn mic_meter(app: AppHandle, mic: String) -> Result<(), String> {
    *last_ping().lock().unwrap() = Instant::now();
    let mut guard = meter().lock().unwrap();
    if guard.as_ref().is_some_and(|m| m.mic == mic) {
        return Ok(());
    }
    *guard = None; // another microphone: the old capture goes first
    let emit_app = app.clone();
    let sink_state = Arc::new(Mutex::new((0.0f32, Instant::now())));
    let source = audio::Source::Mic(if mic.is_empty() { None } else { Some(mic.clone()) });
    let capture = audio::Capture::start(source, move |samples| {
        if samples.is_empty() {
            return;
        }
        let rms = (samples.iter().map(|x| x * x).sum::<f32>() / samples.len() as f32).sqrt();
        let mut s = sink_state.lock().unwrap();
        s.0 = s.0.max(rms);
        if s.1.elapsed() > Duration::from_millis(100) {
            let _ = emit_app.emit("mic-level", serde_json::json!({ "level": level(s.0), "rms": s.0 }));
            *s = (0.0, Instant::now());
        }
    })?;
    *guard = Some(Meter { _capture: capture, mic });
    drop(guard);
    // Stops by itself once the page stops asking.
    std::thread::spawn(|| loop {
        std::thread::sleep(Duration::from_secs(1));
        if last_ping().lock().unwrap().elapsed() > Duration::from_secs(5) {
            *meter().lock().unwrap() = None;
            break;
        }
        if meter().lock().unwrap().is_none() {
            break;
        }
    });
    Ok(())
}

/// The page is gone: stop now.
#[tauri::command]
pub fn mic_meter_stop() {
    *meter().lock().unwrap() = None;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn levels_map_decibels_onto_the_bar() {
        assert_eq!(level(0.0), 0.0);
        assert_eq!(level(0.0005), 0.0, "below −60 dBFS is empty");
        assert!((level(0.01) - 0.4).abs() < 0.01, "−40 dBFS is 40 %");
        assert_eq!(level(0.5), 1.0, "above −10 dBFS is full");
    }
}
