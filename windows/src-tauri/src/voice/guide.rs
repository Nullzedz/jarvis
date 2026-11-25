// JARVIS (#94): « where is…? » when it takes several clicks: one step at a time
// (design C of prototypes/jarvis-where-steps.html). His answer names the steps and
// circles the first click; a label by the ring says « 1 of 3 · Click the gear ».
// When you click what he circled, a fresh picture of the screen is taken and he finds
// the next thing to click, until you're there. A click elsewhere keeps the step; Esc,
// another question or closing his windows ends it.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde_json::json;
use tauri::{AppHandle, Emitter};

/// The guide being followed: its question, its steps, the one now, and where to click for it
/// (physical px; None when he couldn't find it: then any click goes on).
struct Guide {
    id: u64,
    question: String,
    steps: Vec<String>,
    at: usize,
    rect: Option<(f64, f64, f64, f64)>,
}

static GUIDE: Mutex<Option<Guide>> = Mutex::new(None);
static NEXT: AtomicU64 = AtomicU64::new(1);
/// The next step is being looked for: clicks meanwhile don't count.
static BUSY: AtomicBool = AtomicBool::new(false);

/// Starts a guide (a new one replaces any other); the clicks are watched from here on.
pub fn start(app: &AppHandle, question: &str, steps: Vec<String>, rect: (f64, f64, f64, f64)) -> u64 {
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    *GUIDE.lock().unwrap() = Some(Guide { id, question: question.to_string(), steps, at: 0, rect: Some(rect) });
    watch(app);
    id
}

/// Ended: Esc, another question, his windows closed.
pub fn cancel() {
    *GUIDE.lock().unwrap() = None;
}

fn inside(r: (f64, f64, f64, f64), p: (f64, f64)) -> bool {
    // A little room round it: the ring is drawn round, not on, the thing.
    let pad = 14.0;
    p.0 >= r.0 - pad && p.1 >= r.1 - pad && p.0 <= r.0 + r.2 + pad && p.1 <= r.1 + r.3 + pad
}

#[cfg(windows)]
fn left_down() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
    (unsafe { GetAsyncKeyState(0x01) } as u16) & 0x8000 != 0
}

#[cfg(not(windows))]
fn left_down() -> bool {
    false
}

/// The mouse, watched once and for good (it only looks while a guide is up).
fn watch(app: &AppHandle) {
    static ONCE: std::sync::Once = std::sync::Once::new();
    let app = app.clone();
    ONCE.call_once(move || {
        std::thread::Builder::new()
            .name("jarvis-guide-clicks".into())
            .spawn(move || {
                let mut was = false;
                loop {
                    std::thread::sleep(Duration::from_millis(25));
                    let down = left_down();
                    let pressed = down && !was;
                    was = down;
                    if !pressed || BUSY.load(Ordering::Relaxed) {
                        continue;
                    }
                    let Some(p) = crate::platform::cursor_physical() else { continue };
                    let hit = GUIDE.lock().unwrap().as_ref().is_some_and(|g| g.rect.map_or(true, |r| inside(r, p)));
                    if hit {
                        BUSY.store(true, Ordering::Relaxed);
                        let app = app.clone();
                        std::thread::spawn(move || {
                            advance(&app);
                            BUSY.store(false, Ordering::Relaxed);
                        });
                    }
                }
            })
            .ok();
    });
}

/// At most this many clicks: past it, the guide ends rather than wander.
const MOST: usize = 8;

/// What he made of the fresh picture: the next click, or you're there.
#[derive(Debug, PartialEq)]
enum Next {
    There,
    Click(Option<String>, Option<(f64, f64, f64, f64)>),
}

/// His reply about the next step: « there », or a point block with the box and, maybe, the step.
fn read_next(written: &str, size: (u32, u32)) -> Next {
    let (said, w) = super::window::split(written);
    match w {
        Some(w) => Next::Click(
            w["step"].as_str().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
            super::window::target(&w, size),
        ),
        None if said.to_lowercase().contains("there") => Next::There,
        None => Next::Click(None, None),
    }
}

/// The step was clicked: he looks again and finds the next click, or sees you're there. The
/// steps planned at first are only a guess (#94: « Look for settings » then « done », though the
/// menu needed one more click): what is on the screen now decides.
fn advance(app: &AppHandle) {
    let (id, question, done, plan, at) = {
        let mut g = GUIDE.lock().unwrap();
        let Some(guide) = g.as_mut() else { return };
        guide.at += 1;
        guide.rect = None;
        (guide.id, guide.question.clone(), guide.steps[..guide.at].to_vec(), guide.steps.clone(), guide.at)
    };
    let guess = plan.get(at).cloned().unwrap_or_default();
    let total = plan.len().max(at + 1);
    crate::log::line(format!("guide: step {} clicked, looking", at));
    // The label moves on at once, his eye sweeping while he looks.
    let _ = app.emit_to(super::explain::LABEL, "explain-guide", json!({ "id": id, "at": at, "total": total, "step": guess, "looking": true }));
    // What the click opened, settled.
    std::thread::sleep(Duration::from_millis(600));
    let Some(shot) = super::sight::whole_screen().and_then(super::sight::Pending::wait) else { return };
    let ask = format!(
        "You are guiding the user, one click at a time, to: \"{question}\". They have clicked, in order: {}. The plan was: {}. Look at this picture of their screen as it is NOW. If what they asked for is now open or in plain sight, reply with just the word: there. Otherwise reply with nothing but this block, for the ONE next thing to click (it may differ from the plan: trust the picture): <window>{{\"kind\": \"point\", \"target\": [x, y, w, h], \"step\": \"Choose Settings\"}}</window> (the box round it, in the picture's pixels; the step in at most 5 words). Don't search the web.",
        done.join(" › "),
        plan.join(" › ")
    );
    let mut written = String::new();
    let _ = super::ask::brain().lock().unwrap().respond(app, &ask, Some(&shot), &mut |d| written.push_str(d));
    let next = read_next(&written, shot.size);
    let mut g = GUIDE.lock().unwrap();
    // Still this guide (not ended or replaced meanwhile)?
    let Some(guide) = g.as_mut().filter(|g| g.id == id && g.at == at) else { return };
    let (step, found) = match next {
        Next::Click(step, found) if at < MOST => (step.unwrap_or(guess), found),
        _ => {
            *g = None;
            crate::log::line("guide: there");
            let _ = app.emit_to(super::explain::LABEL, "explain-guide", json!({ "id": id, "done": true }));
            return;
        }
    };
    let found = found.map(|(x, y, w, h)| {
        let (x0, y0) = shot.to_screen(x, y);
        let (x1, y1) = shot.to_screen(x + w, y + h);
        (x0, y0, x1 - x0, y1 - y0)
    });
    // The plan follows what he saw: this step named as he found it, one more if it ran out.
    guide.steps.truncate(at);
    guide.steps.push(step.clone());
    guide.steps.extend(plan.into_iter().skip(at + 1));
    let total = guide.steps.len();
    guide.rect = found;
    drop(g);
    let target = found.map(super::explain::to_page);
    crate::log::line(format!("guide: step {} of {total} {}", at + 1, if target.is_some() { "found" } else { "not found: any click goes on" }));
    let _ = app.emit_to(super::explain::LABEL, "explain-guide", json!({ "id": id, "at": at, "total": total, "step": step, "target": target }));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_click_counts_on_the_thing_and_a_little_round_it() {
        let r = (100.0, 100.0, 40.0, 20.0);
        assert!(inside(r, (120.0, 110.0)));
        assert!(inside(r, (90.0, 95.0)));
        assert!(!inside(r, (200.0, 110.0)));
    }

    #[test]
    fn he_reads_there_or_the_next_click() {
        assert_eq!(read_next("there", (100, 100)), Next::There);
        assert_eq!(read_next("There, sir.", (100, 100)), Next::There);
        let n = read_next(r#"<window>{"kind": "point", "target": [10, 10, 20, 10], "step": "Choose Settings"}</window>"#, (100, 100));
        assert!(matches!(n, Next::Click(Some(ref s), Some(_)) if s == "Choose Settings"));
        assert_eq!(read_next("not found", (100, 100)), Next::Click(None, None));
    }
}
