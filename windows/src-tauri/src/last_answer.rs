//! JARVIS: his last answer, for Home's JARVIS widget (step 3 of #57). In memory only: it is
//! forgotten when JARVIS quits, like the island's clipboard history.

use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

static LAST: Mutex<Option<String>> = Mutex::new(None);

/// The window's label (lib.rs HUB_LABEL) and the event that tells it.
const HUB: &str = "settings";
const EVENT: &str = "jarvis-last-answer";

/// Keeps `text` as his last answer (blank answers are ignored) and tells the JARVIS window.
pub fn set(app: &AppHandle, text: &str) {
    let text = text.trim();
    if text.is_empty() {
        return;
    }
    if let Ok(mut last) = LAST.lock() {
        *last = Some(text.to_string());
    }
    let _ = app.emit_to(HUB, EVENT, text);
}

#[tauri::command]
pub fn last_answer() -> Option<String> {
    LAST.lock().ok().and_then(|l| l.clone())
}
