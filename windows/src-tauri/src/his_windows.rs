//! JARVIS: the windows he drew to explain, for Home's "His windows" widget (step 8 of #57).
//! In memory only, like his last answer: when each was drawn (the page counts today's) and
//! the last three (question, form, picture).

use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Drawn {
    pub question: String,
    /// "relationships", "table", "drawing"…
    pub form: String,
    /// The drawing, when there is one (the page shows it as an image, never as markup).
    pub svg: Option<String>,
    pub at: i64,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Windows {
    /// When each window was drawn (epoch ms), oldest first, the last 200.
    pub times: Vec<i64>,
    /// The latest first, three at most.
    pub last: Vec<Drawn>,
}

static LOG: Mutex<Option<Windows>> = Mutex::new(None);
const KEEP: usize = 3;
const TIMES: usize = 200;

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// A window he showed (`window` as the page gets it); a pending one is noted once drawn.
pub fn note(app: &AppHandle, question: &str, window: &Value) {
    let form = window["form"].as_str().or(window["kind"].as_str()).unwrap_or("").to_string();
    if form.is_empty() || form == "pending" {
        return;
    }
    let svg = window["svg"].as_str().map(str::to_string);
    let at = now_ms();
    let snapshot = {
        let Ok(mut guard) = LOG.lock() else { return };
        let log = guard.get_or_insert_with(Windows::default);
        log.times.push(at);
        let extra = log.times.len().saturating_sub(TIMES);
        log.times.drain(..extra);
        log.last.insert(0, Drawn { question: question.to_string(), form, svg, at });
        log.last.truncate(KEEP);
        log.clone()
    };
    let _ = app.emit_to("settings", "his-windows", snapshot);
}

#[tauri::command]
pub fn his_windows() -> Windows {
    LOG.lock().ok().and_then(|g| g.clone()).unwrap_or_default()
}
