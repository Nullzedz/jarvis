// JARVIS: the first-launch tutorial (issue #90): a window over the desktop
// (tutorial.html, src/tutorial/) that shows what he does, one hands-on step at a
// time. It opens by itself once, on a fresh install, a moment after he has said
// hello; finished or skipped, it doesn't come back unless Settings › General
// asks for it again. An existing install never sees it on its own.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

pub const LABEL: &str = "tutorial";

/// The tour is on screen: JARVIS's shortcuts go to it only (#90: Ctrl+Shift+Z opened the real
/// ask box as well as the tour's, and dictation pasted into whatever was in front).
static OPEN: AtomicBool = AtomicBool::new(false);
static APP: OnceLock<AppHandle> = OnceLock::new();

pub fn is_open() -> bool {
    OPEN.load(Ordering::Relaxed)
}

/// A shortcut pressed (`down`) or let go while the tour is up: the tour acts on it instead.
pub fn forward(action: &str, down: bool) {
    if let Some(app) = APP.get() {
        let _ = app.emit_to(LABEL, "tutorial-key", serde_json::json!({ "action": action, "down": down }));
    }
}

/// There while a fresh install hasn't finished (or skipped) the tour.
fn pending() -> std::path::PathBuf {
    crate::settings::config_dir().join("tutorial-pending")
}

fn url(app: &AppHandle) -> WebviewUrl {
    #[cfg(dev)]
    if let Some(mut base) = app.config().build.dev_url.clone() {
        base.set_path("/tutorial.html");
        return WebviewUrl::External(base);
    }
    let _ = app;
    WebviewUrl::App("tutorial.html".into())
}

/// At start-up. `fresh`: there was no settings file yet, so this is a new install.
pub fn setup(app: &AppHandle, fresh: bool) {
    let _ = APP.set(app.clone());
    if fresh {
        let _ = crate::platform::ensure_private_dir(&crate::settings::config_dir());
        let _ = std::fs::write(pending(), b"");
    }
    if !pending().exists() {
        return;
    }
    // After his hello on the island, not on top of it.
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(3500));
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || open(&handle));
    });
}

/// The tour's window, centred on the main screen; brought forward if it's already up.
fn open(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    // 980 × 640 plus the room its shadow takes (the page keeps 20 px round its window).
    let built = WebviewWindowBuilder::new(app, LABEL, url(app))
        .additional_browser_args(crate::BROWSER_ARGS)
        .title("JARVIS")
        .inner_size(1020.0, 680.0)
        .center()
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .focused(true)
        .disable_drag_drop_handler()
        .build();
    match built {
        // In front, so what you dictate lands in its practice mail.
        Ok(w) => {
            OPEN.store(true, Ordering::Relaxed);
            w.on_window_event(|e| {
                if matches!(e, WindowEvent::Destroyed) {
                    OPEN.store(false, Ordering::Relaxed);
                }
            });
            let _ = w.set_focus();
        }
        Err(err) => crate::log::line(format!("tutorial: no window: {err}")),
    }
}

/// Settings › General › Show the tour again.
#[tauri::command]
pub async fn tutorial_open(app: AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || open(&handle));
}

/// Finished or skipped: the window goes, and it won't open on its own again.
#[tauri::command]
pub fn tutorial_close(app: AppHandle) {
    OPEN.store(false, Ordering::Relaxed);
    let _ = std::fs::remove_file(pending());
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.close();
    }
}
