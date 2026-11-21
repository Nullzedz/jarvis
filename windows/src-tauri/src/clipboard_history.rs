//! JARVIS: the island's clipboard history (docs/jarvis/design/SPEC.md §7).
//!
//! The text you copy, newest first, the last 30. Kept in memory only, never written
//! to disk, and gone when JARVIS quits. Skipped, like Windows' own clipboard history
//! skips them: what a password manager marks as private, and what asks to be kept out
//! of the history (dictation's paste does).

use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

const KEEP: usize = 30;
const LONGEST: usize = 4_000; // characters kept of one copy

#[derive(Clone, Serialize)]
pub struct Clip {
    pub text: String,
    /// When it was copied, in milliseconds since 1970.
    pub at: u64,
}

static CLIPS: Mutex<VecDeque<Clip>> = Mutex::new(VecDeque::new());

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Adds a copy at the top; the same text again just moves up.
fn push(text: String) -> bool {
    let text: String = text.chars().take(LONGEST).collect();
    if text.trim().is_empty() {
        return false;
    }
    let mut clips = CLIPS.lock().unwrap();
    if clips.front().is_some_and(|c| c.text == text) {
        return false;
    }
    clips.retain(|c| c.text != text);
    clips.push_front(Clip { text, at: now_ms() });
    clips.truncate(KEEP);
    true
}

#[cfg(windows)]
fn private_or_excluded() -> bool {
    use windows::core::w;
    use windows::Win32::System::DataExchange::{IsClipboardFormatAvailable, RegisterClipboardFormatW};
    unsafe {
        [
            w!("ExcludeClipboardContentFromMonitorProcessing"),
            w!("CanIncludeInClipboardHistory"),
            w!("Clipboard Viewer Ignore"),
        ]
        .iter()
        .any(|name| {
            let f = RegisterClipboardFormatW(*name);
            f != 0 && IsClipboardFormatAvailable(f).is_ok()
        })
    }
}

#[cfg(windows)]
fn sequence() -> u32 {
    unsafe { windows::Win32::System::DataExchange::GetClipboardSequenceNumber() }
}

/// Watches the clipboard (its sequence number, a cheap check) and tells the island.
pub fn setup(app: &AppHandle) {
    #[cfg(windows)]
    {
        let app = app.clone();
        let _ = std::thread::Builder::new().name("jarvis-clipboard".into()).spawn(move || {
            let mut seen = sequence();
            let mut board = arboard::Clipboard::new().ok();
            loop {
                std::thread::sleep(Duration::from_millis(600));
                let now = sequence();
                if now == seen {
                    continue;
                }
                seen = now;
                if private_or_excluded() {
                    continue;
                }
                if board.is_none() {
                    board = arboard::Clipboard::new().ok();
                }
                let Some(text) = board.as_mut().and_then(|b| b.get_text().ok()) else { continue };
                if push(text) {
                    let _ = app.emit("clipboard-history", list());
                }
            }
        });
    }
    #[cfg(not(windows))]
    let _ = app;
}

fn list() -> Vec<Clip> {
    CLIPS.lock().unwrap().iter().cloned().collect()
}

/// The history, newest first.
#[tauri::command]
pub fn clipboard_history() -> Vec<Clip> {
    list()
}

/// Puts an old copy back on the clipboard (it moves to the top).
#[tauri::command]
pub fn clipboard_use(text: String) -> bool {
    let ok = arboard::Clipboard::new().and_then(|mut b| b.set_text(text.clone())).is_ok();
    if ok {
        push(text);
    }
    ok
}

/// Forgets the whole history.
#[tauri::command]
pub fn clipboard_clear(app: AppHandle) {
    CLIPS.lock().unwrap().clear();
    let _ = app.emit("clipboard-history", list());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newest_first_no_duplicates_capped() {
        CLIPS.lock().unwrap().clear();
        assert!(push("a".into()));
        assert!(push("b".into()));
        assert!(!push("b".into()), "the same text twice in a row is one copy");
        assert!(push("a".into()), "copied again, it moves to the top");
        let texts: Vec<_> = list().into_iter().map(|c| c.text).collect();
        assert_eq!(texts, ["a", "b"]);
        assert!(!push("   ".into()), "blank copies are skipped");
        for i in 0..40 {
            push(format!("x{i}"));
        }
        assert_eq!(list().len(), KEEP);
        CLIPS.lock().unwrap().clear();
    }
}
