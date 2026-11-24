// JARVIS: the window he draws beside what he explains (issue #12). The brain
// ends its answer with one `<window>{json}</window>` block when a picture helps
// (window_prompt.txt): the kind of window, what's in it, and where on the
// picture the thing he points at is. The block is never said or shown as text
// (stream.rs stops there); it is taken out here and drawn by explain.rs.

use serde_json::Value;

pub const OPEN: &str = "<window";

/// Where the block starts in `text`, if it does (also while it's still being written).
pub fn starts_at(text: &str) -> Option<usize> {
    text.find(OPEN)
}

/// What can be shown of an answer still being written: up to the block, and
/// never the first letters of one (« <win… ») at its end.
pub fn visible(text: &str) -> &str {
    if let Some(at) = starts_at(text) {
        return &text[..at];
    }
    match text.rfind('<') {
        Some(at) if OPEN.starts_with(&text[at..]) => &text[..at],
        _ => text,
    }
}

/// The answer without the block, and the block's window if it is a usable one.
pub fn split(text: &str) -> (String, Option<Value>) {
    let Some(at) = starts_at(text) else { return (text.trim().to_string(), None) };
    let said = text[..at].trim().to_string();
    let rest = &text[at..];
    let body = rest.find('>').map(|i| &rest[i + 1..]).unwrap_or("");
    let body = body.find("</window>").map_or(body, |i| &body[..i]);
    let window = serde_json::from_str::<Value>(body.trim()).ok().filter(usable);
    (said, window)
}

/// A window to draw now (a kind with something in it), or a request for one
/// (`idea`: the drawing model makes it, voice/draw.rs).
fn usable(w: &Value) -> bool {
    ready(w) || is_request(w)
}

/// He asked for a window to be drawn for him (issue #14): what it should show.
pub fn is_request(w: &Value) -> bool {
    !ready(w) && w["idea"].as_str().is_some_and(|s| !s.trim().is_empty())
}

/// What his window shows under the question: his first sentence, at most 15 words (issue #14).
pub fn short_line(said: &str) -> String {
    let said = said.trim();
    let first = said
        .char_indices()
        .find(|&(i, c)| matches!(c, '.' | '!' | '?') && said[i + c.len_utf8()..].starts_with(char::is_whitespace))
        .map_or(said, |(i, c)| &said[..i + c.len_utf8()]);
    let words: Vec<&str> = first.split_whitespace().collect();
    if words.len() <= 15 {
        return first.to_string();
    }
    format!("{}…", words[..15].join(" ").trim_end_matches([',', ';', ':']))
}

/// A ready-made kind, or his own drawing, with something to draw in it.
pub fn ready(w: &Value) -> bool {
    let list = |k: &str| w[k].as_array().is_some_and(|a| !a.is_empty());
    match w["kind"].as_str() {
        Some("steps") => list("steps"),
        Some("diagram") => list("nodes"),
        Some("checklist") => list("checks"),
        Some("compare") => list("bars"),
        Some("breakdown") => list("parts"),
        Some("timeline") => list("points"),
        // His own picture: plain SVG, made safe where it's drawn (src/explain/draw.ts).
        Some("drawing") => w["svg"].as_str().is_some_and(|s| s.to_ascii_lowercase().contains("<svg")),
        // "Where is…?" (#88): only the place he circles; no card.
        Some("point") => is_point(w),
        // JARVIS #92: the island opens on reminders, notes or calendar, with what he added or ticked off.
        Some("island") => is_island(w),
        _ => false,
    }
}

/// JARVIS #92: the island block: a tab to open, and reminders or notes to add or tick off.
pub fn is_island(w: &Value) -> bool {
    let some = |k: &str| w[k].as_array().is_some_and(|a| !a.is_empty());
    w["kind"].as_str() == Some("island")
        && (matches!(w["tab"].as_str(), Some("reminders" | "notes" | "calendar")) || some("add_reminders") || some("done_reminders") || some("add_notes"))
}

/// "Where is…?" (#88): a window that is only a place to circle, with no card.
pub fn is_point(w: &Value) -> bool {
    w["kind"].as_str() == Some("point") && w["target"].as_array().is_some_and(|t| t.len() == 4)
}

/// The target box on the picture, if he gave a sensible one: [x, y, w, h], inside it.
pub fn target(w: &Value, size: (u32, u32)) -> Option<(f64, f64, f64, f64)> {
    picture_box(w, "target", size)
}

/// The area his explanation is about (the window goes beside it, never on it).
pub fn about(w: &Value, size: (u32, u32)) -> Option<(f64, f64, f64, f64)> {
    picture_box(w, "about", size)
}

fn picture_box(w: &Value, key: &str, size: (u32, u32)) -> Option<(f64, f64, f64, f64)> {
    let t = w[key].as_array()?;
    let n: Vec<f64> = t.iter().filter_map(Value::as_f64).collect();
    let [x, y, bw, bh] = n[..] else { return None };
    let fits = x >= 0.0 && y >= 0.0 && bw > 0.0 && bh > 0.0 && x + bw <= size.0 as f64 + 2.0 && y + bh <= size.1 as f64 + 2.0;
    fits.then_some((x, y, bw, bh))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_block_is_taken_out_of_the_answer() {
        let (said, w) = split(r#"Four steps, sir. <window>{"kind": "steps", "target": [10, 20, 60, 24], "steps": ["Click Export", "Choose PDF"]}</window>"#);
        assert_eq!(said, "Four steps, sir.");
        let w = w.unwrap();
        assert_eq!(w["steps"][1], "Choose PDF");
        assert_eq!(target(&w, (1280, 720)), Some((10.0, 20.0, 60.0, 24.0)));
    }

    #[test]
    fn the_start_of_a_block_never_shows_while_it_is_written() {
        assert_eq!(visible("Four steps, sir. <wi"), "Four steps, sir. ");
        assert_eq!(visible("Four steps, sir. <window>{\"kind\""), "Four steps, sir. ");
        assert_eq!(visible("2 < 3, sir."), "2 < 3, sir.");
    }

    #[test]
    fn an_answer_without_a_block_is_left_alone() {
        assert_eq!(split("Brussels, sir."), ("Brussels, sir.".to_string(), None));
    }

    #[test]
    fn a_broken_or_empty_window_is_not_drawn_but_never_said() {
        let (said, w) = split("Here, sir. <window>{\"kind\": \"steps\", \"steps\": []}</window>");
        assert_eq!((said.as_str(), w), ("Here, sir.", None));
        let (said, w) = split("Here, sir. <window>{not json");
        assert_eq!((said.as_str(), w), ("Here, sir.", None));
    }

    #[test]
    fn his_own_drawing_and_the_area_it_is_about_are_kept() {
        let (_, w) = split(r#"Here, sir. <window>{"kind": "drawing", "form": "table", "about": [0, 0, 400, 300], "svg": "<svg viewBox='0 0 300 100'><text x='4' y='20'>A</text></svg>"}</window>"#);
        let w = w.unwrap();
        assert_eq!(about(&w, (1280, 720)), Some((0.0, 0.0, 400.0, 300.0)));
        let (_, none) = split(r#"Here. <window>{"kind": "drawing", "svg": "no picture"}</window>"#);
        assert!(none.is_none());
    }

    #[test]
    fn a_request_for_a_drawing_is_kept_with_its_places() {
        let (said, w) = split(r#"Audit logs each change, sir. <window>{"idea": "how the tables link", "about": [0, 0, 400, 300]}</window>"#);
        assert_eq!(said, "Audit logs each change, sir.");
        let w = w.unwrap();
        assert!(is_request(&w));
        assert_eq!(about(&w, (1280, 720)), Some((0.0, 0.0, 400.0, 300.0)));
        let (_, none) = split(r#"Here. <window>{"idea": "  "}</window>"#);
        assert!(none.is_none());
    }

    #[test]
    fn his_line_in_the_window_is_one_sentence_of_at_most_15_words() {
        assert_eq!(short_line("Audit logs each change. HistoryEvent holds the details."), "Audit logs each change.");
        assert_eq!(short_line("Version 2.5 is out, sir."), "Version 2.5 is out, sir.");
        let long = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen, sixteen seventeen";
        assert_eq!(short_line(long), "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen…");
    }

    #[test]
    fn the_island_block_opens_a_tab_or_changes_the_lists() {
        let (said, w) = split(r#"You have two. <window>{"kind": "island", "tab": "reminders"}</window>"#);
        assert_eq!(said, "You have two.");
        assert!(is_island(&w.unwrap()));
        let (_, w) = split(r#"Added. <window>{"kind": "island", "add_reminders": ["Call Sam"]}</window>"#);
        assert!(is_island(&w.unwrap()));
        assert!(split(r#"Hm. <window>{"kind": "island", "tab": "mail"}</window>"#).1.is_none());
    }

    #[test]
    fn where_is_comes_as_a_point_with_only_its_target() {
        let (said, w) = split(r#"Top right, next to Share. <window>{"kind": "point", "target": [600, 10, 80, 24]}</window>"#);
        assert_eq!(said, "Top right, next to Share.");
        let w = w.unwrap();
        assert!(is_point(&w));
        assert_eq!(target(&w, (1280, 720)), Some((600.0, 10.0, 80.0, 24.0)));
        assert!(split(r#"Here. <window>{"kind": "point"}</window>"#).1.is_none());
    }

    #[test]
    fn a_target_outside_the_picture_is_ignored() {
        let w: Value = serde_json::json!({ "kind": "steps", "steps": ["a"], "target": [1200, 700, 200, 50] });
        assert_eq!(target(&w, (1280, 720)), None);
    }
}
