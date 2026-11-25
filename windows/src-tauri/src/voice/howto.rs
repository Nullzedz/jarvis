// JARVIS (#96): his brain of how-tos: one Markdown note per app and question in
// Documents\JARVIS Brain\How to\<App>\, readable and editable in Obsidian. A
// « where is…? » with a note costs nothing: its route is followed by name. A
// note is written once a guide got you there (the steps, the button names, the
// page they came from) and rewritten when the app changed and it was looked up again.
//
// The route is in the note's front matter (`route: ["Sam Pro", "Settings", "Billing"]`):
// fix a name there and the next guide follows your fix.

use std::path::PathBuf;

/// What a note keeps: the names to click, the steps in words, and where they came from.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Note {
    pub route: Vec<String>,
    pub words: Vec<String>,
    pub source: String,
    /// You said it helped (#115): followed again without asking.
    pub approved: bool,
}

/// Documents\JARVIS Brain (where Windows keeps Documents, OneDrive included).
pub fn brain_dir() -> PathBuf {
    documents().join("JARVIS Brain")
}

#[cfg(windows)]
fn documents() -> PathBuf {
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::{FOLDERID_Documents, SHGetKnownFolderPath, KF_FLAG_DEFAULT};
    unsafe {
        if let Ok(p) = SHGetKnownFolderPath(&FOLDERID_Documents, KF_FLAG_DEFAULT, None) {
            let path = p.to_string().ok().map(PathBuf::from);
            CoTaskMemFree(Some(p.0 as *const _));
            if let Some(path) = path {
                return path;
            }
        }
    }
    std::env::var_os("USERPROFILE").map(PathBuf::from).unwrap_or_default().join("Documents")
}

#[cfg(not(windows))]
fn documents() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default().join("Documents")
}

/// A name fit for a file: letters, digits, spaces and dashes.
fn file_name(s: &str) -> String {
    let clean: String = s.chars().map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' { c } else { ' ' }).collect();
    let clean = clean.split_whitespace().collect::<Vec<_>>().join(" ");
    if clean.is_empty() { "untitled".into() } else { clean.chars().take(60).collect() }
}

/// « claude » → « Claude ».
fn title(app: &str) -> String {
    let mut c = app.chars();
    c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
}

fn path(app: &str, question: &str) -> PathBuf {
    brain_dir().join("How to").join(file_name(&title(app))).join(format!("{}.md", file_name(question)))
}

/// The note for `question` (its remembered words) in `app`, if he has one.
pub fn read(app: &str, question: &str) -> Option<Note> {
    if app.is_empty() || question.is_empty() {
        return None;
    }
    parse(&std::fs::read_to_string(path(app, question)).ok()?)
}

fn parse(text: &str) -> Option<Note> {
    let front = text.strip_prefix("---")?.split("\n---").next()?;
    let field = |k: &str| front.lines().find_map(|l| l.trim().strip_prefix(&format!("{k}:")).map(|v| v.trim().to_string()));
    let list = |k: &str| field(k).and_then(|v| serde_json::from_str::<Vec<String>>(&v).ok()).unwrap_or_default();
    let route: Vec<String> = list("route").into_iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
    if route.is_empty() {
        return None;
    }
    Some(Note { route, words: list("steps"), source: field("source").map(|s| s.trim_matches('"').to_string()).unwrap_or_default(), approved: field("approved").is_some_and(|v| v == "yes") })
}

/// The note as written: front matter for him, numbered steps for you.
fn render(app: &str, asked: &str, question: &str, note: &Note, day: &str) -> String {
    let q = |v: &str| serde_json::to_string(v).unwrap_or_default();
    let mut out = format!(
        "---\napp: {}\nquestion: {}\nasked: {}\nroute: {}\nsteps: {}\nsource: {}\nworked: {day}\napproved: {}\n---\n\n# {} in {}\n\n",
        q(app),
        q(question),
        q(asked),
        serde_json::to_string(&note.route).unwrap_or_default(),
        serde_json::to_string(&note.words).unwrap_or_default(),
        q(&note.source),
        if note.approved { "yes" } else { "no" },
        title(question),
        title(app),
    );
    for (i, name) in note.route.iter().enumerate() {
        match note.words.get(i).filter(|w| !w.trim().is_empty()) {
            Some(w) => out.push_str(&format!("{}. {} — **{name}**\n", i + 1, w.trim())),
            None => out.push_str(&format!("{}. Click **{name}**\n", i + 1)),
        }
    }
    if !note.source.is_empty() {
        out.push_str(&format!("\nFrom: {}\n", note.source));
    }
    out.push_str("\n#jarvis/how-to\n");
    out
}

/// A guide got you there: its note written (or rewritten).
pub fn write(app: &str, asked: &str, question: &str, note: &Note) {
    if app.is_empty() || question.is_empty() || note.route.is_empty() {
        return;
    }
    let t = crate::platform::local_time();
    let day = format!("{:04}-{:02}-{:02}", t.year, t.month, t.day);
    let p = path(app, question);
    if let Some(dir) = p.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    match std::fs::write(&p, render(app, asked, question, note, &day)) {
        Ok(()) => crate::log::line(format!("howto: note written for {app} · {question}")),
        Err(err) => crate::log::line(format!("howto: no note: {err}")),
    }
}

/// A note that didn't help (#115): deleted, so the way is looked up afresh next time.
pub fn forget(app: &str, question: &str) {
    if app.is_empty() || question.is_empty() {
        return;
    }
    match std::fs::remove_file(path(app, question)) {
        Ok(()) => crate::log::line(format!("howto: note forgotten for {app} · {question}")),
        Err(err) => crate::log::line(format!("howto: nothing forgotten: {err}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_note_reads_back_what_was_written() {
        let note = Note {
            route: vec!["Sam Pro".into(), "Settings".into(), "Billing".into()],
            words: vec!["Click your name at the bottom-left".into(), "Choose Settings".into()],
            source: "https://support.example.com/billing".into(),
            approved: true,
        };
        let text = render("claude", "Where is billing?", "billing", &note, "2026-11-25");
        assert!(text.contains("1. Click your name at the bottom-left — **Sam Pro**"));
        assert!(text.contains("3. Click **Billing**"));
        assert_eq!(parse(&text), Some(note));
    }

    #[test]
    fn an_edited_or_empty_note() {
        let edited = "---\nroute: [\"Account\", \"Billing\"]\n---\n# mine\n";
        assert_eq!(parse(edited).unwrap().route, vec!["Account", "Billing"]);
        assert!(!parse(edited).unwrap().approved);
        assert!(parse("---\nroute: []\n---\n").is_none());
        assert!(parse("no front matter").is_none());
        assert_eq!(file_name("billing / plans?"), "billing plans");
    }
}
