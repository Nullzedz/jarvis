// JARVIS: the live code view reads a few lines of the file a Claude Code
// session is reading or editing, around where it works.
//
// The island asks with the session's own folder: only a text file inside that
// folder is read (no escaping it with `..` or a link), at most 2 MB, and only
// the lines shown come back.

use serde::Serialize;
use std::path::{Path, PathBuf};

const MAX_FILE: u64 = 2 * 1024 * 1024;
const MAX_LINES: usize = 40;
const MAX_LINE_LEN: usize = 400;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Window {
    /// The lines shown, without their line ending.
    pub lines: Vec<String>,
    /// 1-based number of the first line shown.
    pub start: usize,
    /// Lines in the whole file.
    pub total: usize,
    /// 1-based lines to highlight (the edit), inclusive; 0 when none.
    pub focus_start: usize,
    pub focus_end: usize,
}

fn inside(file: &Path, root: &Path) -> Result<PathBuf, String> {
    let file = file.canonicalize().map_err(|_| "File not found.".to_string())?;
    let root = root.canonicalize().map_err(|_| "Session folder not found.".to_string())?;
    if !file.starts_with(&root) {
        return Err("Outside the session's folder.".into());
    }
    Ok(file)
}

/// The lines around `find` (the text an edit wrote) or `line` (where a read
/// starts), `context` lines either side, from text already read.
pub fn window_of(text: &str, find: Option<&str>, line: Option<usize>, context: usize) -> Window {
    let all: Vec<&str> = text.lines().collect();
    let total = all.len();
    let (mut fs, mut fe) = (0usize, 0usize);
    if let Some(needle) = find.filter(|n| !n.trim().is_empty()) {
        if let Some(byte) = text.find(needle) {
            fs = text[..byte].matches('\n').count() + 1;
            fe = fs + needle.trim_end_matches('\n').matches('\n').count();
        }
    }
    let anchor = if fs > 0 { fs } else { line.unwrap_or(1).max(1) };
    let start = anchor.saturating_sub(context).max(1);
    let end = (if fe > 0 { fe } else { anchor } + context).min(total).min(start + MAX_LINES - 1);
    let lines = if total == 0 || start > total {
        Vec::new()
    } else {
        all[start - 1..end.max(start - 1)]
            .iter()
            .map(|l| {
                let l = l.trim_end_matches('\r');
                if l.len() > MAX_LINE_LEN {
                    let mut cut = MAX_LINE_LEN;
                    while !l.is_char_boundary(cut) {
                        cut -= 1;
                    }
                    format!("{}…", &l[..cut])
                } else {
                    l.to_string()
                }
            })
            .collect()
    };
    Window { lines, start, total, focus_start: fs, focus_end: fe }
}

/// A few lines of `path` (inside `cwd`) around `find` or `line`.
#[tauri::command]
pub fn live_read(path: String, cwd: String, find: Option<String>, line: Option<usize>) -> Result<Window, String> {
    if cwd.trim().is_empty() {
        return Err("No session folder.".into());
    }
    let file = inside(Path::new(&path), Path::new(&cwd))?;
    let meta = std::fs::metadata(&file).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("Not a file.".into());
    }
    if meta.len() > MAX_FILE {
        return Err("File too large to show.".into());
    }
    let bytes = std::fs::read(&file).map_err(|e| e.to_string())?;
    if bytes.iter().take(8192).any(|&b| b == 0) {
        return Err("Not a text file.".into());
    }
    let text = String::from_utf8_lossy(&bytes);
    Ok(window_of(&text, find.as_deref(), line, 14))
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEXT: &str = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\n";

    #[test]
    fn the_window_centres_on_the_edit_and_marks_it() {
        let w = window_of(TEXT, Some("f\ng"), None, 2);
        assert_eq!((w.focus_start, w.focus_end), (6, 7));
        assert_eq!(w.start, 4);
        assert_eq!(w.lines, vec!["d", "e", "f", "g", "h", "i"]);
        assert_eq!(w.total, 12);
    }

    #[test]
    fn a_read_starts_at_its_line_and_unknown_text_falls_back_to_the_top() {
        let w = window_of(TEXT, None, Some(10), 2);
        assert_eq!(w.start, 8);
        assert_eq!(w.lines.first().map(String::as_str), Some("h"));
        let w = window_of(TEXT, Some("zzz"), None, 2);
        assert_eq!((w.start, w.focus_start), (1, 0));
        assert_eq!(window_of("", None, None, 3).lines.len(), 0);
    }

    #[test]
    fn only_files_inside_the_session_folder_are_read() {
        let root = std::env::temp_dir().join(format!("jarvis-live-{}", std::process::id()));
        let sub = root.join("proj");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(sub.join("a.ts"), "one\ntwo\n").unwrap();
        std::fs::write(root.join("secret.txt"), "no").unwrap();
        let cwd = sub.to_string_lossy().to_string();
        let ok = live_read(sub.join("a.ts").to_string_lossy().into(), cwd.clone(), Some("two".into()), None).unwrap();
        assert_eq!(ok.focus_start, 2);
        assert!(live_read(root.join("secret.txt").to_string_lossy().into(), cwd.clone(), None, None).is_err());
        assert!(live_read(sub.join("..").join("secret.txt").to_string_lossy().into(), cwd.clone(), None, None).is_err());
        assert!(live_read(sub.join("a.ts").to_string_lossy().into(), "".into(), None, None).is_err());
        let _ = std::fs::remove_dir_all(root);
    }
}
