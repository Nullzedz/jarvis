// JARVIS: his explanation windows (issue #12), drawn on one see-through layer
// over the monitor (explain.html) that belongs to JARVIS's own process: no
// taskbar entry, never focused, left out of his screen pictures, and gone when
// JARVIS quits. Clicks pass through everywhere except on the cards, so the ×
// and the resize corner work while the rest of the screen is yours.
//
// The page draws everything (src/explain/): his visor pointer, the circle, the
// card dragged out beside the target, the contents. Rust says where the target
// is, in the page's own pixels, and keeps the hot areas (the cards) clickable.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
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
    let target = shot.and_then(|s| {
        let (x, y, w, h) = super::window::target(window, s.size)?;
        let (x0, y0) = s.to_screen(x, y);
        let (x1, y1) = s.to_screen(x + w, y + h);
        Some((x0, y0, x1 - x0, y1 - y0))
    });
    let at = target.map_or(cursor, |t| (t.0 + t.2 / 2.0, t.1 + t.3 / 2.0));
    let Some(((mx, my, mw, mh), scale)) = super::sight::monitor_at(at.0, at.1) else { return };
    // shortcut: a "show him more" window on another monitor moves the layer there and the older cards with it, upgrade if that's ever needed.
    *PLACE.lock().unwrap() = ((mx as f64, my as f64), scale);
    let _ = win.set_size(PhysicalSize::new(mw as u32, mh as u32));
    let _ = win.set_position(PhysicalPosition::new(mx, my));
    let page = |(x, y): (f64, f64)| [(x - mx as f64) / scale, (y - my as f64) / scale];
    let target = target.map(|(x, y, w, h)| {
        let [px, py] = page((x, y));
        [px, py, w / scale, h / scale]
    });
    OPEN.store(true, Ordering::Relaxed);
    let _ = win.emit(
        "explain-show",
        json!({ "add": add, "question": question, "said": said, "window": window, "target": target, "cursor": page(cursor) }),
    );
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
            let _ = w.set_ignore_cursor_events(true);
            let _ = w.set_position(PhysicalPosition::new(PARKED.0, PARKED.1));
        }
    }
}
