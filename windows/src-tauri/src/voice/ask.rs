// JARVIS: type to ask (Roamies' idea, written for JARVIS). The ask shortcut
// (Left Ctrl + Left Shift + Z unless changed in Settings, shortcut.rs), pressed
// with nothing else and let go, opens a small box glued to the mouse. He sees
// what you ask about (sight.rs): move the pointer round something while the keys
// are held and he looks at just that; otherwise at the whole screen. The box
// opens (ask.html, design C): his white visor face, a
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
use super::ink::Trail;

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
    match built {
        // Never in a picture of the screen he's shown.
        Ok(win) => super::sight::hide_from_capture(&win),
        Err(err) => {
            crate::log::line(format!("ask: no window: {err}"));
            return;
        }
    }
    let app = app.clone();
    std::thread::Builder::new()
        .name("jarvis-ask-keys".into())
        .spawn(move || {
            use super::shortcut::{keys, mask, needs_mask, Which};
            let mut ask = Press::default();
            // While the keys are held after a press: the pointer's path (a circle, maybe), and
            // whether his cards were already up then (#92: « show him more » is this same shortcut now).
            // The trail shows only once the keys are held a moment and the mouse moves (#92: a tap
            // to ask about the whole screen drew a trail at once): (trail once started, cards up,
            // pressed at, the pointer then).
            let mut held: Option<(Option<Trail>, bool, std::time::Instant, Option<(f64, f64)>)> = None;
            loop {
                std::thread::sleep(Duration::from_millis(30));
                let a = keys(Which::Ask);
                if ask.step(a.0, a.1) {
                    if needs_mask(Which::Ask) {
                        mask();
                    }
                    let open = app.get_webview_window(LABEL).is_some_and(|w| w.is_visible().unwrap_or(false));
                    if open {
                        // Pressed again with the box up: everything goes, the box and his windows.
                        if let Some((Some(t), ..)) = held.take() {
                            t.end();
                        }
                        super::explain::close_all(&app);
                        let app2 = app.clone();
                        let _ = app.run_on_main_thread(move || close(&app2));
                    } else {
                        held = Some((None, super::explain::is_open(), std::time::Instant::now(), crate::platform::cursor_physical()));
                    }
                    continue;
                }
                let Some((trail, _, at, from)) = held.as_mut() else { continue };
                let (chord, other) = a;
                if other {
                    // Another shortcut after all.
                    if let Some((Some(t), ..)) = held.take() {
                        t.end();
                    }
                } else if chord {
                    if let Some(p) = crate::platform::cursor_physical() {
                        // Held a moment and the mouse moving: now it's circling, and the trail shows.
                        let moved = from.is_some_and(|f| (p.0 - f.0).hypot(p.1 - f.1) > 12.0);
                        if trail.is_none() && at.elapsed() > Duration::from_millis(200) && moved {
                            let mut t = Trail::start(&app);
                            if let Some(f) = *from {
                                t.feed(f);
                            }
                            *trail = Some(t);
                        }
                        if let Some(t) = trail.as_mut() {
                            if t.feed(p) {
                                crate::log::line("ask: something was circled");
                            }
                        }
                    }
                } else {
                    // Let go: the screen is copied now (a few ms), the box opens at once, and
                    // the picture is made while you type.
                    let (trail, cards_up, ..) = held.take().unwrap();
                    let ink = trail.map(Trail::end).unwrap_or_default();
                    // His cards were up and nothing was circled: pressed again, everything goes (as before).
                    if cards_up && ink.circle().is_none() {
                        super::explain::close_all(&app);
                        continue;
                    }
                    let (shot, what) = match (ink.area(), ink.circle()) {
                        (Some(area), Some(circle)) => (super::sight::circled(area, circle), "circled"),
                        _ => (super::sight::whole_screen(), "screen"),
                    };
                    let what = if shot.is_some() { what } else { "" };
                    *SEEN.lock().unwrap() = shot;
                    // Cards up and something new circled: its card joins them (what Shift + Win did).
                    ADD.store(cards_up, std::sync::atomic::Ordering::Relaxed);
                    let app2 = app.clone();
                    let _ = app.run_on_main_thread(move || open(&app2, what));
                }
            }
        })
        .ok();
}

/// The picture taken when the box opened: sent with its first question.
static SEEN: Mutex<Option<super::sight::Pending>> = Mutex::new(None);
/// The box was opened by circling something with his cards up: its window joins them.
static ADD: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

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

fn close(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.hide();
    }
    *SEEN.lock().unwrap() = None;
}

/// Opens the box beside the mouse; `what` it sees: "screen", "circled" or "" (nothing).
fn open(app: &AppHandle, what: &'static str) {
    let Some(win) = app.get_webview_window(LABEL) else { return };
    let scale = win.scale_factor().unwrap_or(1.0);
    let _ = win.set_size(PhysicalSize::new((WIDTH * scale) as u32, (HEIGHT * scale) as u32));
    if let Some((cx, cy)) = crate::platform::cursor_physical() {
        let _ = win.set_position(place(&win, cx, cy));
    }
    let _ = win.show();
    let _ = win.set_focus();
    let _ = win.emit("ask-open", what);
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

pub(super) fn brain() -> &'static Mutex<Brain> {
    static B: OnceLock<Mutex<Brain>> = OnceLock::new();
    B.get_or_init(|| Mutex::new(Brain::default()))
}

/// The box sends a question: the answer comes back as `ask-delta` (all of it so
/// far, cleaned, as it's written), then `ask-done` with the whole answer cleaned
/// of links and sources.
#[tauri::command]
pub fn ask_send(app: AppHandle, question: String) {
    let question = question.trim().to_string();
    if question.is_empty() {
        return;
    }
    // The picture taken when the box opened goes with its first question; each later question
    // gets a fresh one (#92: asked again in the same box, he had no picture and said he couldn't draw).
    let seen = SEEN.lock().unwrap().take().or_else(super::sight::whole_screen);
    let add = ADD.load(std::sync::atomic::Ordering::Relaxed);
    std::thread::spawn(move || {
        let mut brain = brain().lock().unwrap();
        let mut said = String::new();
        let seen = seen.and_then(super::sight::Pending::wait);
        let reply = brain.respond(&app, &question, seen.as_ref(), &mut |delta| {
            said.push_str(delta);
            // Cleaned as it streams: nothing in brackets (a date he copied), no links, no markdown ever flashes.
            let shown = super::brain::spoken_text(super::window::visible(&said));
            if !shown.is_empty() {
                let _ = app.emit_to(LABEL, "ask-delta", shown);
            }
        });
        // His window, if he drew one (window.rs): it takes over from the box.
        let (body, window) = super::window::split(&said);
        let window = window.map(|w| super::window::as_point(&question, w));
        crate::log::line(match (&window, super::window::starts_at(&said)) {
            (Some(w), _) => format!("ask: answer with a {} window", w["kind"].as_str().unwrap_or("?")),
            (None, Some(at)) => format!("ask: a window block that couldn't be read: {}", said[at..].chars().take(160).collect::<String>()),
            (None, None) => "ask: answer without a window".into(),
        });
        let answer = clean(&body);
        if answer.is_empty() {
            crate::log::line(format!("ask: no words in the answer: {:?}", said.chars().take(300).collect::<String>()));
        }
        // A window says it, even when he wrote no sentence before it.
        let ok = reply.is_some() && (!answer.is_empty() || window.is_some());
        let text = if ok { answer } else { crate::i18n::t("I couldn't answer that just now, sir.") };
        let _ = app.emit_to(LABEL, "ask-done", text.clone());
        if ok {
            crate::last_answer::set(&app, &question, &text);
        }
        if let (true, Some(w)) = (ok, window) {
            super::explain::show(&app, &question, &text, &w, seen.as_ref(), add);
            // "Where is…?" (#88): only a ring is drawn, so his line stays in the box.
            if !super::window::is_point(&w) {
                let app2 = app.clone();
                let _ = app.run_on_main_thread(move || close(&app2));
            }
        }
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
/// The front page's "Ask JARVIS anything" pill: the box opens without a picture of the screen.
#[tauri::command]
pub fn ask_open(app: AppHandle) {
    *SEEN.lock().unwrap() = None;
    ADD.store(false, std::sync::atomic::Ordering::Relaxed);
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || open(&app2, ""));
}

#[tauri::command]
pub fn ask_close(app: AppHandle) {
    close(&app);
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
    fn a_copied_date_never_shows_while_the_answer_streams() {
        let mut said = String::new();
        let shown: Vec<String> = ["[2026-11", "-20 13:12] Brus", "sels, sir."].iter().map(|d| {
            said.push_str(d);
            super::super::brain::spoken_text(&said)
        }).collect();
        assert_eq!(shown, vec!["", "Brus", "Brussels, sir."]);
    }

    #[test]
    fn links_and_sources_are_left_out_of_the_answer() {
        assert_eq!(clean("Brussels, sir. Sources: - (https://example.com)"), "Brussels, sir.");
    }
}
