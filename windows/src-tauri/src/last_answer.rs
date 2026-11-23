//! JARVIS: his last answer and today's conversation, for Home's JARVIS widget (step 3 of #57) and
//! the JARVIS page (#67). In memory only: forgotten when JARVIS quits, like the island's clipboard.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// One exchange: what you asked (said or typed) and his answer.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Turn {
    pub you: String,
    pub him: String,
    /// Epoch ms.
    pub at: i64,
}

static TURNS: Mutex<Vec<Turn>> = Mutex::new(Vec::new());
/// The conversation keeps this many exchanges.
const KEEP: usize = 60;

/// The window's label (lib.rs HUB_LABEL).
const HUB: &str = "settings";

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Keeps `answer` (to `question`) and tells the JARVIS window. Blank answers are ignored.
pub fn set(app: &AppHandle, question: &str, answer: &str) {
    let answer = answer.trim();
    if answer.is_empty() {
        return;
    }
    let turn = Turn { you: question.trim().to_string(), him: answer.to_string(), at: now_ms() };
    if let Ok(mut turns) = TURNS.lock() {
        turns.push(turn.clone());
        let extra = turns.len().saturating_sub(KEEP);
        turns.drain(..extra);
    }
    let _ = app.emit_to(HUB, "jarvis-last-answer", answer);
    let _ = app.emit_to(HUB, "jarvis-turn", turn);
}

/// What he just heard you say (before he answers), for the JARVIS page's panel.
pub fn heard(app: &AppHandle, text: &str) {
    let text = text.trim();
    if !text.is_empty() {
        let _ = app.emit_to(HUB, "jarvis-heard", text);
    }
}

#[tauri::command]
pub fn last_answer() -> Option<String> {
    TURNS.lock().ok().and_then(|t| t.last().map(|x| x.him.clone()))
}

/// The conversation so far, oldest first.
#[tauri::command]
pub fn conversation() -> Vec<Turn> {
    TURNS.lock().map(|t| t.clone()).unwrap_or_default()
}
