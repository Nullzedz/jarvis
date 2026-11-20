// JARVIS: his explanation windows (issue #12), drawn on one see-through layer
// over the monitor (explain.html) that belongs to JARVIS's own process: no
// taskbar entry, never focused, left out of his screen pictures, and gone when
// JARVIS quits. Clicks pass through everywhere except on the cards, so the ×
// and the resize corner work while the rest of the screen is yours.
//
// The page draws everything (src/explain/): his visor pointer, the circle, the
// card dragged out beside the target, the contents. Rust says where the target
// is, in the page's own pixels, and keeps the hot areas (the cards) clickable.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

use super::sight::Shot;

pub const LABEL: &str = "explain";
const PARKED: (i32, i32) = (-32000, -32000);

/// Cards are on screen.
static OPEN: AtomicBool = AtomicBool::new(false);
/// The layer's monitor: origin (physical px) and scale; and the cards' hot areas (page px).
static PLACE: Mutex<((f64, f64), f64)> = Mutex::new(((0.0, 0.0), 1.0));
static HOT: Mutex<Vec<(f64, f64, f64, f64)>> = Mutex::new(Vec::new());
/// Each window's drawing job (issue #14), kept for « Draw it differently » and the overlap fix.
static JOBS: Mutex<Vec<(u64, Arc<super::draw::Job>)>> = Mutex::new(Vec::new());
static NEXT: AtomicU64 = AtomicU64::new(1);

fn url(app: &AppHandle) -> WebviewUrl {
    #[cfg(dev)]
    if let Some(mut base) = app.config().build.dev_url.clone() {
        base.set_path("/explain.html");
        return WebviewUrl::External(base);
    }
    let _ = app;
    WebviewUrl::App("explain.html".into())
}

pub fn setup(app: &AppHandle) {
    let built = WebviewWindowBuilder::new(app, LABEL, url(app))
        .additional_browser_args(crate::BROWSER_ARGS)
        .title("JARVIS")
        .inner_size(10.0, 10.0)
        .position(PARKED.0 as f64, PARKED.1 as f64)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .focusable(false)
        .disable_drag_drop_handler()
        .visible(true)
        .build();
    let win = match built {
        Ok(w) => w,
        Err(err) => {
            crate::log::line(format!("explain: no window: {err}"));
            return;
        }
    };
    super::sight::hide_from_capture(&win);
    crate::platform::prepare_pill_window(&win, crate::platform::DesktopMode::Poll);
    // Clickable only over a card: the pointer is watched while cards are up. Esc closes them all.
    let app = app.clone();
    std::thread::Builder::new()
        .name("jarvis-explain".into())
        .spawn(move || {
            let mut over = false;
            loop {
                std::thread::sleep(Duration::from_millis(30));
                if !OPEN.load(Ordering::Relaxed) {
                    continue;
                }
                if escape_down() {
                    close_all(&app);
                    continue;
                }
                let now = crate::platform::cursor_physical().is_some_and(|(x, y)| {
                    let ((ox, oy), scale) = *PLACE.lock().unwrap();
                    let (px, py) = ((x - ox) / scale, (y - oy) / scale);
                    HOT.lock().unwrap().iter().any(|&(hx, hy, hw, hh)| px >= hx && py >= hy && px <= hx + hw && py <= hy + hh)
                });
                if now != over {
                    over = now;
                    if let Some(w) = app.get_webview_window(LABEL) {
                        let _ = w.set_ignore_cursor_events(!now);
                    }
                }
            }
        })
        .ok();
}

#[cfg(windows)]
fn escape_down() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
    (unsafe { GetAsyncKeyState(0x1B) } as u16) & 0x8000 != 0
}

#[cfg(not(windows))]
fn escape_down() -> bool {
    false
}

/// Windows are on screen.
pub fn is_open() -> bool {
    OPEN.load(Ordering::Relaxed)
}

/// Draws `window` (window.rs) for `question`, with his short answer `said`.
/// `add`: beside the ones already up ("show him more"); otherwise they're replaced.
pub fn show(app: &AppHandle, question: &str, said: &str, window: &Value, shot: Option<&Shot>, add: bool) {
    let Some(win) = app.get_webview_window(LABEL) else { return };
    let cursor = crate::platform::cursor_physical().unwrap_or((0.0, 0.0));
    // The target on the screen (physical px), from his box on the picture.
    let on_screen = |b: Option<(f64, f64, f64, f64)>, s: &Shot| {
        let (x, y, w, h) = b?;
        let (x0, y0) = s.to_screen(x, y);
        let (x1, y1) = s.to_screen(x + w, y + h);
        Some((x0, y0, x1 - x0, y1 - y0))
    };
    let target = shot.and_then(|s| on_screen(super::window::target(window, s.size), s));
    // What he explains, never covered: the area he marked, or else all you circled, or else the target.
    let about = shot
        .and_then(|s| {
            on_screen(super::window::about(window, s.size), s).or_else(|| {
                let (x, y, w, h) = s.screen;
                (s.what == "the part you circled").then_some((x as f64, y as f64, w as f64, h as f64))
            })
        })
        .or(target);
    let at = target.map_or(cursor, |t| (t.0 + t.2 / 2.0, t.1 + t.3 / 2.0));
    let Some(((mx, my, mw, mh), scale)) = super::sight::monitor_at(at.0, at.1) else { return };
    // shortcut: a "show him more" window on another monitor moves the layer there and the older cards with it, upgrade if that's ever needed.
    *PLACE.lock().unwrap() = ((mx as f64, my as f64), scale);
    let _ = win.set_size(PhysicalSize::new(mw as u32, mh as u32));
    let _ = win.set_position(PhysicalPosition::new(mx, my));
    let page = |(x, y): (f64, f64)| [(x - mx as f64) / scale, (y - my as f64) / scale];
    let in_page = |b: Option<(f64, f64, f64, f64)>| {
        b.map(|(x, y, w, h)| {
            let [px, py] = page((x, y));
            [px, py, w / scale, h / scale]
        })
    };
    let (target, about) = (in_page(target), in_page(about));
    OPEN.store(true, Ordering::Relaxed);
    // His line: one sentence, at most 15 words. A requested drawing opens empty (his eye
    // sweeping) and fills in when the drawing model is done (issue #14).
    let line = super::window::short_line(said);
    let (id, shown) = start(app, question, &line, window, shot.cloned());
    let _ = win.emit(
        "explain-show",
        json!({ "add": add, "draw": id, "question": question, "said": line, "window": shown, "target": target, "about": about, "cursor": page(cursor) }),
    );
}

/// Keeps `window`'s drawing job under a new id and, if he asked for a drawing,
/// starts it: the id, and what to show now (an empty « pending » one, or the window as it is).
fn start(app: &AppHandle, question: &str, said: &str, window: &Value, shot: Option<Shot>) -> (u64, Value) {
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    let asked = super::window::is_request(window);
    let idea = match window["idea"].as_str() {
        Some(i) => i.to_string(),
        None => format!("the same as this window: {}", window.to_string().chars().take(3000).collect::<String>()),
    };
    {
        let mut jobs = JOBS.lock().unwrap();
        jobs.push((id, Arc::new(super::draw::Job { question: question.into(), said: said.into(), idea, shot })));
        let extra = jobs.len().saturating_sub(16);
        jobs.drain(..extra);
    }
    if asked {
        let app = app.clone();
        std::thread::spawn(move || drawn(&app, id, &[], None));
    }
    (id, if asked { json!({ "kind": "pending" }) } else { window.clone() })
}

fn job(id: u64) -> Option<Arc<super::draw::Job>> {
    JOBS.lock().unwrap().iter().find(|(i, _)| *i == id).map(|(_, j)| j.clone())
}

/// Draws window `id`'s picture and sends it to the page (`explain-drawn`).
fn drawn(app: &AppHandle, id: u64, tried: &[String], fix: Option<&str>) {
    let got = job(id).ok_or_else(|| "gone".to_string()).and_then(|j| super::draw::draw(app, &j, tried, fix));
    let _ = match got {
        Ok(w) => {
            crate::log::line(format!("explain: drawn as {}", w["form"].as_str().or(w["kind"].as_str()).unwrap_or("?")));
            app.emit_to(LABEL, "explain-drawn", json!({ "draw": id, "window": w }))
        }
        Err(err) => {
            crate::log::line(format!("explain: no drawing: {err}"));
            app.emit_to(LABEL, "explain-drawn", json!({ "draw": id, "failed": true }))
        }
    };
}

/// Every window goes (Esc, the ask shortcut again, a new question).
pub fn close_all(app: &AppHandle) {
    OPEN.store(false, Ordering::Relaxed);
    HOT.lock().unwrap().clear();
    let _ = app.emit_to(LABEL, "explain-close", ());
}

/// The page says where its cards are (page px); none left: the layer goes off screen.
#[tauri::command]
pub fn explain_hot(app: AppHandle, rects: Vec<(f64, f64, f64, f64)>) {
    let empty = rects.is_empty();
    *HOT.lock().unwrap() = rects;
    if empty {
        OPEN.store(false, Ordering::Relaxed);
        if let Some(w) = app.get_webview_window(LABEL) {
            let _ = w.set_focusable(false);
            let _ = w.set_ignore_cursor_events(true);
            let _ = w.set_position(PhysicalPosition::new(PARKED.0, PARKED.1));
        }
    }
}

/// « Draw it differently » (`tried`: the forms shown so far), or the same form
/// again because its text overlapped (`fix`: what touched what). The page gets
/// `explain-drawn` back for window `draw`.
#[tauri::command]
pub fn explain_redraw(app: AppHandle, draw: u64, tried: Vec<String>, fix: Option<String>) {
    std::thread::spawn(move || drawn(&app, draw, &tried, fix.as_deref()));
}

/// The reply bar: the layer takes typing while it's used, and gives it back after
/// (otherwise it never takes focus, so the rest of the screen stays yours).
#[tauri::command]
pub fn explain_focus(app: AppHandle, on: bool) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.set_focusable(on);
        if on {
            let _ = w.set_focus();
        }
    }
}

/// A follow-up typed in window `card` (issue #16): answered with what that window
/// was about (its question, his answer, the same picture), and drawn when it helps.
/// The page gets `explain-answer` back: his words, and a drawing's id when there is one.
#[tauri::command]
pub fn explain_ask(app: AppHandle, card: u64, question: String) {
    std::thread::spawn(move || {
        let first = job(card);
        let shot = first.as_ref().and_then(|j| j.shot.clone());
        let ask = match &first {
            Some(j) => format!("(A follow-up, typed in your window about \"{}\", where you said \"{}\".) {question}", j.question, j.said),
            None => question.clone(),
        };
        let mut written = String::new();
        let reply = super::ask::brain().lock().unwrap().respond(&app, &ask, shot.as_ref(), &mut |d| written.push_str(d));
        let (line, window) = super::window::split(&written);
        let said = super::brain::spoken_text(&line).trim().to_string();
        crate::log::line(format!("explain: follow-up answered{}", if window.is_some() { ", with a window" } else { "" }));
        let answer = match (reply, said.is_empty(), window) {
            (None, _, _) | (_, true, None) => json!({ "card": card, "failed": true }),
            (_, _, Some(w)) => {
                let said = super::window::short_line(&said);
                let (id, shown) = start(&app, &question, &said, &w, shot);
                json!({ "card": card, "said": said, "draw": id, "window": shown })
            }
            (_, false, None) => json!({ "card": card, "said": said }),
        };
        let _ = app.emit_to(LABEL, "explain-answer", answer);
    });
}
