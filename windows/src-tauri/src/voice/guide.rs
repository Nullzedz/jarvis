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

/// The step was clicked: the next one is found on a fresh picture, or « you're there ».
fn advance(app: &AppHandle) {
    let (id, question, step, at, total) = {
        let mut g = GUIDE.lock().unwrap();
        let Some(guide) = g.as_mut() else { return };
        guide.at += 1;
        if guide.at >= guide.steps.len() {
            let id = guide.id;
            *g = None;
            crate::log::line("guide: there");
            let _ = app.emit_to(super::explain::LABEL, "explain-guide", json!({ "id": id, "done": true }));
            return;
        }
        guide.rect = None;
        (guide.id, guide.question.clone(), guide.steps[guide.at].clone(), guide.at, guide.steps.len())
    };
    crate::log::line(format!("guide: step {} of {total}", at + 1));
    // The label moves on at once, his eye sweeping while he looks.
    let _ = app.emit_to(super::explain::LABEL, "explain-guide", json!({ "id": id, "at": at, "total": total, "step": step, "looking": true }));
    // What the click opened, settled.
    std::thread::sleep(Duration::from_millis(450));
    let Some(shot) = super::sight::whole_screen().and_then(super::sight::Pending::wait) else { return };
    let ask = format!(
        "You are guiding the user, one click at a time, to: \"{question}\". They have just done step {at} of {total}. On this picture of their screen, find what to click for step {} of {total}: \"{step}\". Reply with nothing but this block: <window>{{\"kind\": \"point\", \"target\": [x, y, w, h]}}</window> (the box round it, in the picture's pixels). If it isn't on the screen, reply \"not found\".",
        at + 1
    );
    let mut written = String::new();
    let _ = super::ask::brain().lock().unwrap().respond(app, &ask, Some(&shot), &mut |d| written.push_str(d));
    let found = super::window::split(&written).1.and_then(|w| super::window::target(&w, shot.size)).map(|(x, y, w, h)| {
        let (x0, y0) = shot.to_screen(x, y);
        let (x1, y1) = shot.to_screen(x + w, y + h);
        (x0, y0, x1 - x0, y1 - y0)
    });
    // Still this guide (not ended or replaced meanwhile)?
    let mut g = GUIDE.lock().unwrap();
    let Some(guide) = g.as_mut().filter(|g| g.id == id && g.at == at) else { return };
    guide.rect = found;
    drop(g);
    let target = found.map(super::explain::to_page);
    crate::log::line(format!("guide: step {} {}", at + 1, if target.is_some() { "found" } else { "not found: any click goes on" }));
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
}
