// JARVIS: type to ask (Roamies' idea, written for JARVIS). The ask shortcut
// (Left Ctrl + Left Shift + Z unless changed in Settings, shortcut.rs), pressed
// with nothing else, opens a small box glued to the mouse (ask.html, design C): his white visor face, a
// field to type in, and his answer appearing right underneath as it's written.
// Enter sends, Shift+Enter adds a line, Esc or the shortcut again closes it.
//
// The answer comes from the same brain as the voice (brain.rs: your Claude key,
// or your own Claude Code kept warm), in its own conversation. It is shown, not
// spoken: typing is for when talking isn't.

use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

use super::brain::Brain;

pub const LABEL: &str = "ask";
/// The box's width, and its height before an answer (logical px; the page asks for more as it grows).
const WIDTH: f64 = 380.0;
const HEIGHT: f64 = 64.0;

/// The ask shortcut, fed the keys on every beat (tested without a keyboard):
/// true once when it's pressed with nothing else; again only after it's let go.
pub struct Press {
    armed: bool,
}

impl Default for Press {
    fn default() -> Self {
        Press { armed: true }
    }
}

impl Press {
    pub fn step(&mut self, chord: bool, other: bool) -> bool {
        if !chord {
            self.armed = true;
            return false;
        }
        let fire = self.armed && !other;
        self.armed = false;
        fire
    }
}

fn url(app: &AppHandle) -> WebviewUrl {
    #[cfg(dev)]
    if let Some(mut base) = app.config().build.dev_url.clone() {
        base.set_path("/ask.html");
        return WebviewUrl::External(base);
    }
    let _ = app;
    WebviewUrl::App("ask.html".into())
}

/// Creates the box's window, hidden, and starts watching for the tap.
pub fn setup(app: &AppHandle) {
    let built = WebviewWindowBuilder::new(app, LABEL, url(app))
        .additional_browser_args(crate::BROWSER_ARGS)
        .title("JARVIS")
        .inner_size(WIDTH, HEIGHT)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .maximizable(false)
        .minimizable(false)
        .build();
    if let Err(err) = built {
        crate::log::line(format!("ask: no window: {err}"));
        return;
    }
    let app = app.clone();
    std::thread::Builder::new()
        .name("jarvis-ask-keys".into())
        .spawn(move || {
            let mut press = Press::default();
            loop {
                std::thread::sleep(Duration::from_millis(30));
                let (chord, other) = super::shortcut::keys(super::shortcut::Which::Ask);
                if press.step(chord, other) {
                    if super::shortcut::needs_mask(super::shortcut::Which::Ask) {
                        super::shortcut::mask();
                    }
                    let app2 = app.clone();
                    let _ = app.run_on_main_thread(move || toggle(&app2));
                }
            }
        })
        .ok();
}

/// Where the box goes for the pointer at (cx, cy): below and right of it, kept
/// on its screen, and above it near the bottom.
fn place(win: &tauri::WebviewWindow, cx: f64, cy: f64) -> PhysicalPosition<i32> {
    let scale = win.scale_factor().unwrap_or(1.0);
    let w = win.outer_size().map(|s| s.width as i32).unwrap_or((WIDTH * scale) as i32);
    let h = win.outer_size().map(|s| s.height as i32).unwrap_or((HEIGHT * scale) as i32);
    let (mut x, mut y) = (cx as i32 + (14.0 * scale) as i32, cy as i32 + (18.0 * scale) as i32);
    if let Ok(Some(m)) = win.monitor_from_point(cx, cy) {
        let (mp, ms) = (m.position(), m.size());
        x = x.min(mp.x + ms.width as i32 - w - 8).max(mp.x + 8);
        if y + h > mp.y + ms.height as i32 - 8 {
            y = (cy as i32 - h - (12.0 * scale) as i32).max(mp.y + 8);
        }
    }
    PhysicalPosition::new(x, y)
}

/// Each opening gets a number: a follower from an older one stops.
static OPENED: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Opens the box beside the mouse, or closes it if it's open.
fn toggle(app: &AppHandle) {
    let Some(win) = app.get_webview_window(LABEL) else { return };
    if win.is_visible().unwrap_or(false) {
        let _ = win.hide();
        return;
    }
    let scale = win.scale_factor().unwrap_or(1.0);
    let _ = win.set_size(PhysicalSize::new((WIDTH * scale) as u32, (HEIGHT * scale) as u32));
    if let Some((cx, cy)) = crate::platform::cursor_physical() {
        let _ = win.set_position(place(&win, cx, cy));
    }
    let _ = win.show();
    let _ = win.set_focus();
    let _ = win.emit("ask-open", ());
    // Glued to the pointer while it's open (about 60 times a second).
    let me = OPENED.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
    std::thread::spawn(move || {
        let mut last = None;
        while OPENED.load(std::sync::atomic::Ordering::Relaxed) == me && win.is_visible().unwrap_or(false) {
            if let Some(p) = crate::platform::cursor_physical() {
                if last != Some(p) {
                    last = Some(p);
                    let _ = win.set_position(place(&win, p.0, p.1));
                }
            }
            std::thread::sleep(Duration::from_millis(16));
        }
    });
}

fn brain() -> &'static Mutex<Brain> {
    static B: OnceLock<Mutex<Brain>> = OnceLock::new();
    B.get_or_init(|| Mutex::new(Brain::default()))
}

/// The box sends a question: the answer comes back as `ask-delta` (text as it's
/// written), then `ask-done` with the whole answer cleaned of links and sources.
#[tauri::command]
pub fn ask_send(app: AppHandle, question: String) {
    let question = question.trim().to_string();
    if question.is_empty() {
        return;
    }
    std::thread::spawn(move || {
        let mut brain = brain().lock().unwrap();
        let mut said = String::new();
        let reply = brain.respond(&app, &question, &mut |delta| {
            said.push_str(delta);
            let _ = app.emit_to(LABEL, "ask-delta", delta.to_string());
        });
        let answer = clean(&said);
        let ok = reply.is_some() && !answer.is_empty();
        let text = if ok { answer } else { crate::i18n::t("I couldn't answer that just now, sir.") };
        let _ = app.emit_to(LABEL, "ask-done", text);
    });
}

/// What's shown: no « Sources: » list, no web addresses, no markdown.
fn clean(text: &str) -> String {
    let mut splitter = super::stream::Splitter::default();
    let mut out: Vec<String> = splitter.push(text);
    out.extend(splitter.finish());
    out.join(" ")
}

/// Esc, or a click elsewhere: the box goes away.
#[tauri::command]
pub fn ask_close(app: AppHandle) {
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.hide();
    }
}

/// The box grew (its answer): the window follows its height.
#[tauri::command]
pub fn ask_resize(app: AppHandle, height: f64) {
    if let Some(win) = app.get_webview_window(LABEL) {
        let scale = win.scale_factor().unwrap_or(1.0);
        let h = height.clamp(HEIGHT, 420.0);
        let _ = win.set_size(PhysicalSize::new((WIDTH * scale) as u32, (h * scale) as u32));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pressing_the_shortcut_opens_it_once() {
        let mut p = Press::default();
        let r: Vec<bool> = [(false, false), (true, false), (true, false), (false, false), (true, false)].iter().map(|&(c, o)| p.step(c, o)).collect();
        assert_eq!(r, vec![false, true, false, false, true]);
    }

    #[test]
    fn with_another_key_it_is_someone_elses_shortcut() {
        let mut p = Press::default();
        // Ctrl+Shift+Alt+Z, then Alt let go while the rest is still held.
        assert!(!p.step(true, true));
        assert!(!p.step(true, false));
    }

    #[test]
    fn links_and_sources_are_left_out_of_the_answer() {
        assert_eq!(clean("Brussels, sir. Sources: - (https://example.com)"), "Brussels, sir.");
    }
}
