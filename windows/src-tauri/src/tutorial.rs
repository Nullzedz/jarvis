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
/// Each is logged ("tutorial: key …"), so a key that never arrives shows in coucou.log. The same
/// press seen twice (by the key watch and by the tour window) is sent once.
pub fn forward(action: &str, down: bool) {
    static LAST: std::sync::Mutex<Vec<(String, bool)>> = std::sync::Mutex::new(Vec::new());
    {
        let mut last = LAST.lock().unwrap();
        match last.iter_mut().find(|(a, _)| a == action) {
            Some((_, was)) if *was == down && matches!(action, "talk" | "ask" | "more") => return,
            Some((_, was)) => *was = down,
            None => last.push((action.to_string(), down)),
        }
    }
    crate::log::line(format!("tutorial: key {action} {}", if down { "down" } else { "up" }));
    // What you say while holding the talk keys is really heard (flow-dictated), not made up.
    if action == "talk" {
        crate::flow::key_from_tutorial(down);
    }
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

/// The dictation pill's phase while the tour is up, logged when it changes (listening, thinking…).
pub fn note_phase(phase: &str) {
    static LAST: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());
    let mut last = LAST.lock().unwrap();
    if *last != phase {
        crate::log::line(format!("tutorial: dictation {phase}"));
        *last = phase.to_string();
    }
}

/// While the tour is up: the talk, ask and « more » keys, read every 30 ms and sent to it when
/// they change (#90: the talk keys were read only by the voice loop, which may not be running).
fn watch_keys() {
    use crate::voice::shortcut::{held, Which};
    std::thread::spawn(|| {
        let mut was = [false; 3];
        while is_open() {
            for (n, (which, name)) in [(Which::Talk, "talk"), (Which::Ask, "ask"), (Which::More, "more")].into_iter().enumerate() {
                let down = held(which).0;
                if down != was[n] {
                    was[n] = down;
                    // A held Win, let go, would open the Start menu: masked as JARVIS does himself.
                    if down && crate::voice::shortcut::needs_mask(which) {
                        crate::voice::shortcut::mask();
                    }
                    forward(name, down);
                }
            }
            std::thread::sleep(Duration::from_millis(30));
        }
    });
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
    // A normal window of JARVIS's (#90: as a see-through layer over the screen, keys went astray).
    let built = WebviewWindowBuilder::new(app, LABEL, url(app))
        .additional_browser_args(crate::BROWSER_ARGS)
        .title("JARVIS")
        .inner_size(980.0, 640.0)
        .min_inner_size(860.0, 580.0)
        .center()
        .resizable(true)
        .focused(true)
        .disable_drag_drop_handler()
        .build();
    match built {
        // In front, so what you dictate lands in its practice mail.
        Ok(w) => {
            OPEN.store(true, Ordering::Relaxed);
            crate::log::line("tutorial: open");
            watch_keys();
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

/// A key pressed or let go in the tour's own window (KeyboardEvent.code). Windows doesn't always
/// hand JARVIS's key watch the keys typed into his own window (#90: Right Ctrl never arrived), so
/// the window says them itself: the dictation key starts and stops the real dictation, and the
/// talk, ask and « more » keys act in the tour.
#[tauri::command]
pub fn tutorial_key(app: AppHandle, code: String, down: bool) {
    static HELD: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());
    if !is_open() {
        return;
    }
    let (before, now) = {
        let mut held = HELD.lock().unwrap();
        let before = held.clone();
        if down {
            if !held.contains(&code) {
                held.push(code.clone());
            }
        } else {
            held.retain(|c| c != &code);
        }
        (before, held.clone())
    };
    let all = |set: &[String], keys: &[String]| !keys.is_empty() && keys.iter().all(|k| set.contains(k));
    let Some(flow) = crate::flow::get(&app) else { return };
    let (dictate, talk, ask, more) = {
        let store = flow.store.lock().unwrap();
        let p = &store.prefs;
        use crate::voice::shortcut::{codes, DEFAULT_ASK, DEFAULT_MORE, DEFAULT_TALK};
        (p.key.codes(&p.key_combo), codes(&p.talk_keys, &DEFAULT_TALK), codes(&p.ask_keys, &DEFAULT_ASK), codes(&p.more_keys, &DEFAULT_MORE))
    };
    if all(&before, &dictate) != all(&now, &dictate) {
        crate::log::line(format!("tutorial: window key dictation {}", if down { "down" } else { "up" }));
        crate::flow::key_from_tutorial(all(&now, &dictate));
    }
    for (name, keys) in [("talk", &talk), ("ask", &ask), ("more", &more)] {
        if all(&before, keys) != all(&now, keys) {
            forward(name, all(&now, keys));
        }
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
