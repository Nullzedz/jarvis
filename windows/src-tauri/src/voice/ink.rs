// JARVIS: the trail you see while circling something (design C, the dashed
// lasso): a dashed blue line follows the pointer while the talk or ask keys are
// held; once it closes round something, the inside fills with a faint blue. Let
// go and it fades. Drawn on a clear window over the monitor (ink.html) that
// clicks pass through, never focused, and left out of the picture he's shown.

use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

use super::circle::{Ink, Pt};

pub const LABEL: &str = "ink";
/// Off every screen while nothing is drawn (shown windows that move don't take focus).
const PARKED: (i32, i32) = (-32000, -32000);

fn url(app: &AppHandle) -> WebviewUrl {
    #[cfg(dev)]
    if let Some(mut base) = app.config().build.dev_url.clone() {
        base.set_path("/ink.html");
        return WebviewUrl::External(base);
    }
    let _ = app;
    WebviewUrl::App("ink.html".into())
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
    match built {
        Ok(win) => {
            super::sight::hide_from_capture(&win);
            crate::platform::prepare_pill_window(&win, crate::platform::DesktopMode::Poll);
        }
        Err(err) => crate::log::line(format!("ink: no window: {err}")),
    }
}

/// Each circling gets a number: an older one's fade never parks a newer trail.
static DRAWING: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// One circling: the path and its trail on screen.
pub struct Trail {
    app: AppHandle,
    ink: Ink,
    origin: (f64, f64),
    scale: f64,
    shown: usize,
}

impl Trail {
    /// The keys went down: the trail's window covers the pointer's monitor.
    pub fn start(app: &AppHandle) -> Trail {
        DRAWING.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let at = crate::platform::cursor_physical().and_then(|(x, y)| super::sight::monitor_at(x, y));
        let ((x, y, w, h), scale) = at.unwrap_or(((0, 0, 0, 0), 1.0));
        if let Some(win) = app.get_webview_window(LABEL) {
            if w > 0 {
                let _ = win.set_size(PhysicalSize::new(w as u32, h as u32));
                let _ = win.set_position(PhysicalPosition::new(x, y));
            }
            let _ = win.emit("ink-start", ());
        }
        Trail { app: app.clone(), ink: Ink::new(scale), origin: (x as f64, y as f64), scale, shown: 0 }
    }

    /// The pointer moved: true when this closed the circle.
    pub fn feed(&mut self, p: Pt) -> bool {
        let closed = self.ink.feed(p);
        let path = self.ink.circle().unwrap_or(self.ink.path());
        if closed || (self.ink.circle().is_none() && path.len() != self.shown) {
            self.shown = path.len();
            let local: Vec<[f64; 2]> = path.iter().map(|&(x, y)| [(x - self.origin.0) / self.scale, (y - self.origin.1) / self.scale]).collect();
            let _ = self.app.emit_to(LABEL, "ink-path", json!({ "points": local, "closed": self.ink.circle().is_some() }));
        }
        closed
    }

    /// The keys were let go: the trail fades, then its window goes off screen.
    pub fn end(self) -> Ink {
        let _ = self.app.emit_to(LABEL, "ink-end", ());
        let app = self.app.clone();
        let me = DRAWING.load(std::sync::atomic::Ordering::Relaxed);
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(320));
            if DRAWING.load(std::sync::atomic::Ordering::Relaxed) != me {
                return;
            }
            if let Some(win) = app.get_webview_window(LABEL) {
                let _ = win.set_position(PhysicalPosition::new(PARKED.0, PARKED.1));
            }
        });
        self.ink
    }
}
