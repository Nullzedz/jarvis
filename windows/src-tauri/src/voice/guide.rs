// JARVIS (#94): « where is…? » when it takes several clicks: one step at a time
// (design C of prototypes/jarvis-where-steps.html). His answer names the steps and
// circles the first click; a label by the ring says « 1 of 3 · Click the gear ».
// When you click what he circled, a fresh picture of the screen is taken and he finds
// the next thing to click, until you're there. A click elsewhere keeps the step; Esc,
// another question or closing his windows ends it.
//
// The lean way (#96, prototypes/jarvis-lean-guide.html): when the app tells Windows the names
// of its buttons (uia.rs), one text-only call plans the route by name; each next step is then
// found by name after your click, for free. Off the route he finds his place again by name, or
// plans again from the names; only if a name can't be found does he look at a picture. A route
// that got you there is remembered: the same question in the same app costs nothing next time.

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
    /// Followed by name (#96): the app (its process and exe name) whose buttons are read.
    named: Option<(u32, String)>,
}

static GUIDE: Mutex<Option<Guide>> = Mutex::new(None);
static NEXT: AtomicU64 = AtomicU64::new(1);
/// The next step is being looked for: clicks meanwhile don't count.
static BUSY: AtomicBool = AtomicBool::new(false);

/// Starts a guide (a new one replaces any other); the clicks are watched from here on.
pub fn start(app: &AppHandle, question: &str, steps: Vec<String>, rect: (f64, f64, f64, f64)) -> u64 {
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    *GUIDE.lock().unwrap() = Some(Guide { id, question: question.to_string(), steps, at: 0, rect: Some(rect), named: None });
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
    if GUIDE.lock().unwrap().as_ref().is_some_and(|g| g.named.is_some()) {
        return by_name(app);
    }
    by_picture(app);
}

fn by_picture(app: &AppHandle) {
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


// ---- The lean way (#96).

const ROUTE_SYSTEM: &str = "You guide someone to a place in the app on their screen, one click at a time. You get the app's name, their question and the names of the things they can click right now (buttons, menu items, tabs, links). Reply with JSON only, no other words: {\"say\": \"one short sentence, at most 12 words, naming the clicks\", \"route\": [\"names to click, in order\"]}. The first name must be copied exactly from the list. The later ones are what will appear after each click: your best guess at their exact label. The last one is the thing they asked for. If it is already in the list, the route is just that name. If you can't tell, the route is [].";

/// The route asked for by name: the sentence to show and the names to click. One text-only
/// call with no history: about a hundred short names in, a few names out.
fn plan(question: &str, app_name: &str, list: &[super::uia::Named], done: &[String]) -> Option<(String, Vec<String>)> {
    let names = super::uia::names(list, 150).join(" | ");
    let done = if done.is_empty() { String::new() } else { format!("Already clicked, in order: {}.\n", done.join(" › ")) };
    let user = format!("App: {app_name}\nQuestion: {question}\n{done}Clickable now: {names}");
    let cost = (ROUTE_SYSTEM.len() + user.len()) / 4;
    let started = std::time::Instant::now();
    let reply = tauri::async_runtime::block_on(crate::claude::complete(super::brain::FAST_MODEL, ROUTE_SYSTEM, &user, 300, Duration::from_secs(30)));
    let reply = match reply {
        Ok(r) => r,
        Err(err) => {
            crate::log::line(format!("guide: no route: {err}"));
            return None;
        }
    };
    let route = read_route(&reply);
    crate::log::line(format!("guide: route call, about {cost} tokens in, {} ms: {:?}", started.elapsed().as_millis(), route.as_ref().map(|r| &r.1)));
    route
}

/// {"say": …, "route": […]} from his reply, wherever it is in it.
fn read_route(reply: &str) -> Option<(String, Vec<String>)> {
    let (a, b) = (reply.find('{')?, reply.rfind('}')?);
    let v: serde_json::Value = serde_json::from_str(reply.get(a..=b)?).ok()?;
    let route: Vec<String> = v["route"].as_array()?.iter().filter_map(|s| s.as_str()).map(|s| s.trim().chars().take(60).collect::<String>()).filter(|s| !s.is_empty()).take(MOST).collect();
    Some((v["say"].as_str().unwrap_or("").trim().to_string(), route))
}

/// The question as remembered: lower case, the « where is » and « the » words left out.
fn question_key(q: &str) -> String {
    let q = q.to_lowercase();
    const SKIP: [&str; 17] = ["where", "is", "s", "are", "the", "my", "how", "do", "i", "get", "to", "find", "go", "can", "open", "a", "jarvis"];
    q.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty() && !SKIP.contains(w)).collect::<Vec<_>>().join(" ")
}

fn routes_file() -> std::path::PathBuf {
    crate::settings::config_dir().join("guide-routes.json")
}

fn remembered(app_name: &str, question: &str) -> Option<Vec<String>> {
    let all: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(routes_file()).ok()?).ok()?;
    let r: Vec<String> = all[format!("{app_name}|{question}")].as_array()?.iter().filter_map(|s| s.as_str().map(str::to_string)).collect();
    (!r.is_empty()).then_some(r)
}

/// A route that got you there: kept (the last 200) for the same question in the same app.
fn remember(app_name: &str, question: &str, route: &[String]) {
    if app_name.is_empty() || question.is_empty() || route.is_empty() {
        return;
    }
    let mut all: serde_json::Map<String, serde_json::Value> = std::fs::read_to_string(routes_file()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let k = format!("{app_name}|{question}");
    all.remove(&k);
    all.insert(k, json!(route));
    while all.len() > 200 {
        let first = all.keys().next().cloned().unwrap_or_default();
        all.remove(&first);
    }
    let _ = crate::platform::ensure_private_dir(&crate::settings::config_dir());
    let _ = std::fs::write(routes_file(), serde_json::Value::Object(all).to_string());
    crate::log::line("guide: route remembered");
}

/// What the app (and whatever is in front now, if another app opened) shows that you can click.
fn read_buttons(pid: u32) -> Vec<super::uia::Named> {
    let mut list = super::uia::clickable(pid);
    if let Some(front) = super::uia::user_app().filter(|p| *p != pid) {
        list.extend(super::uia::clickable(front));
    }
    list
}

/// « Where is…? » the lean way: the sentence he says, with the first click circled and the
/// guide started; None when the app shares no names or no route was found from them (then
/// the question goes the picture way, as before).
pub fn where_is(app: &AppHandle, question: &str) -> Option<String> {
    let pid = super::uia::user_app()?;
    let list = super::uia::clickable(pid);
    if list.len() < 3 {
        crate::log::line("guide: the app shares no button names: the picture way");
        return None;
    }
    let app_name = super::uia::app_name(pid);
    let qkey = question_key(question);
    let (said, route) = match remembered(&app_name, &qkey).filter(|r| super::uia::find(&list, &r[0]).is_some()) {
        Some(r) => {
            crate::log::line(format!("guide: remembered route, no AI: {r:?}"));
            (String::new(), r)
        }
        None => plan(question, &app_name, &list, &[])?,
    };
    let first = super::uia::find(&list, route.first()?)?.clone();
    let said = if said.is_empty() { format!("{}, sir.", route.join(", then ")) } else { said };
    if route.len() < 2 {
        cancel();
        super::explain::circle(app, first.rect, &[], None);
        return Some(said);
    }
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    *GUIDE.lock().unwrap() = Some(Guide { id, question: question.to_string(), steps: route.clone(), at: 0, rect: Some(first.rect), named: Some((pid, app_name)) });
    watch(app);
    crate::log::line(format!("guide: by name, step 1 of {}", route.len()));
    let shown: Vec<String> = route.iter().map(|s| step_text(s)).collect();
    super::explain::circle(app, first.rect, &shown, Some(id));
    Some(said)
}

/// The circled step was clicked: the next one found by name, for free.
fn by_name(app: &AppHandle) {
    let (id, question, steps, at, pid, app_name) = {
        let mut g = GUIDE.lock().unwrap();
        let Some(guide) = g.as_mut() else { return };
        guide.at += 1;
        guide.rect = None;
        let (pid, name) = guide.named.clone().unwrap_or_default();
        if guide.at >= guide.steps.len() {
            let id = guide.id;
            remember(&name, &question_key(&guide.question), &guide.steps);
            *g = None;
            drop(g);
            crate::log::line("guide: there");
            let _ = app.emit_to(super::explain::LABEL, "explain-guide", json!({ "id": id, "done": true }));
            return;
        }
        (guide.id, guide.question.clone(), guide.steps.clone(), guide.at, pid, name)
    };
    let _ = app.emit_to(super::explain::LABEL, "explain-guide", json!({ "id": id, "at": at, "total": steps.len(), "step": step_text(&steps[at]), "looking": true }));
    // What the click opened, settled (a menu sliding in, a page loading): looked at a few times.
    let mut list = Vec::new();
    let mut found = None;
    for wait in [350, 400, 600] {
        std::thread::sleep(Duration::from_millis(wait));
        if GUIDE.lock().unwrap().as_ref().map(|g| g.id) != Some(id) {
            return;
        }
        list = read_buttons(pid);
        found = super::uia::find(&list, &steps[at]).cloned();
        if found.is_some() {
            break;
        }
    }
    let (mut steps, mut at) = (steps, at);
    if found.is_some() {
        crate::log::line(format!("guide: step {} found by name", at + 1));
    } else if let Some(i) = (0..steps.len()).rev().find(|i| super::uia::find(&list, &steps[*i]).is_some()) {
        // Clicked off the route (or a menu closed): his place again, by name.
        at = i;
        found = super::uia::find(&list, &steps[i]).cloned();
        crate::log::line(format!("guide: found his place again at step {}", i + 1));
    } else if let Some((_, rest)) = plan(&question, &app_name, &list, &steps[..at]).filter(|(_, r)| r.first().is_some_and(|n| super::uia::find(&list, n).is_some())) {
        // His guess of the next label was wrong: planned again from what's there now.
        steps.truncate(at);
        steps.extend(rest);
        steps.truncate(MOST);
        found = super::uia::find(&list, &steps[at]).cloned();
    }
    let mut g = GUIDE.lock().unwrap();
    let Some(guide) = g.as_mut().filter(|g| g.id == id) else { return };
    let Some(found) = found else {
        // No name to go by: the picture way for this step.
        crate::log::line(format!("guide: \"{}\" not among the names: a picture", steps[at]));
        guide.named = None;
        guide.steps = steps;
        guide.at = at.saturating_sub(1);
        drop(g);
        return by_picture(app);
    };
    guide.steps = steps.clone();
    guide.at = at;
    guide.rect = Some(found.rect);
    drop(g);
    let _ = app.emit_to(super::explain::LABEL, "explain-guide", json!({ "id": id, "at": at, "total": steps.len(), "step": step_text(&steps[at]), "target": super::explain::to_page(found.rect) }));
}

/// The label's words for a step named « Settings »: « Click Settings ».
fn step_text(name: &str) -> String {
    let lower = name.to_lowercase();
    if ["click", "choose", "open", "select", "turn", "press"].iter().any(|v| lower.starts_with(v)) {
        name.to_string()
    } else {
        format!("Click {name}")
    }
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
    fn a_route_is_read_from_his_reply() {
        let r = read_route(r#"Here: {"say": "Profile, then Settings.", "route": ["Profile", " Settings "]}"#).unwrap();
        assert_eq!(r, ("Profile, then Settings.".to_string(), vec!["Profile".to_string(), "Settings".to_string()]));
        assert_eq!(read_route(r#"{"say": "", "route": []}"#).unwrap().1.len(), 0);
        assert!(read_route("no idea").is_none());
    }

    #[test]
    fn the_same_question_is_remembered_however_asked() {
        assert_eq!(question_key("Where is billing?"), "billing");
        assert_eq!(question_key("where's the Billing"), "billing");
        assert_eq!(question_key("How do I get to dark mode"), "dark mode");
        assert_eq!(step_text("Settings"), "Click Settings");
        assert_eq!(step_text("Open Appearance"), "Open Appearance");
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
