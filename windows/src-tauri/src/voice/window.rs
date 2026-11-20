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

/// A kind we draw, with something to draw in it.
fn usable(w: &Value) -> bool {
    let list = |k: &str| w[k].as_array().is_some_and(|a| !a.is_empty());
    match w["kind"].as_str() {
        Some("steps") => list("steps"),
        Some("diagram") => list("nodes"),
        Some("checklist") => list("checks"),
        Some("compare") => list("bars"),
        Some("breakdown") => list("parts"),
        Some("timeline") => list("points"),
        // His own picture: plain SVG, made safe where it's drawn (src/explain/draw.ts).
        Some("drawing") => w["svg"].as_str().is_some_and(|s| s.contains("<svg")),
        _ => false,
    }
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
    fn a_target_outside_the_picture_is_ignored() {
        let w: Value = serde_json::json!({ "kind": "steps", "steps": ["a"], "target": [1200, 700, 200, 50] });
        assert_eq!(target(&w, (1280, 720)), None);
    }
}
