// JARVIS (#92): what his voice knows of the island's reminders, notes and today's
// calendar. They're kept in the island's own storage; it sends a short summary here
// whenever they change (src/island/voicepocket.ts), and each question he's asked
// carries it, so he answers from your own lists (with a Claude key or with Claude Code).
// Kept in memory only.

use std::sync::Mutex;

static SNAPSHOT: Mutex<String> = Mutex::new(String::new());

/// The island's summary, as it was last sent.
#[tauri::command]
pub fn pocket_snapshot(text: String) {
    *SNAPSHOT.lock().unwrap() = text.chars().take(4000).collect();
}

/// What goes in front of a question: the island's summary in brackets, or nothing yet.
pub fn context() -> String {
    let s = SNAPSHOT.lock().unwrap();
    if s.is_empty() {
        String::new()
    } else {
        format!("[The user's island: {s}] ")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_summary_goes_in_brackets_in_front_of_a_question() {
        pocket_snapshot("Reminders (1 open): \"Buy milk\".".into());
        assert_eq!(context(), "[The user's island: Reminders (1 open): \"Buy milk\".] ");
    }
}
