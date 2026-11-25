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
//
// His brain (howto.rs, Documents\JARVIS Brain): a question he has a note for is followed from
// it, for free. One he hasn't is looked up on the web once (the app's own help pages), its
// steps matched to the button names on your screen; the note is written when you get there.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde_json::json;

use super::howto::Note;
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
    /// For his note (howto.rs): the steps in words, and the page they came from.
    words: Vec<String>,
    source: String,
    /// Planned from the names alone and short of the thing: it may go on past its end. A route
    /// from his note or the web ends where it ends (#96: in Word it went on to « Save as type »).
    open: bool,
    /// Started part-way (what was asked for, or a later step, already on screen): no note is
    /// written from it, the whole route isn't known.
    partial: bool,
}

static GUIDE: Mutex<Option<Guide>> = Mutex::new(None);
static NEXT: AtomicU64 = AtomicU64::new(1);
/// The next step is being looked for: clicks meanwhile don't count.
static BUSY: AtomicBool = AtomicBool::new(false);

/// Starts a guide (a new one replaces any other); the clicks are watched from here on.
pub fn start(app: &AppHandle, question: &str, steps: Vec<String>, rect: (f64, f64, f64, f64)) -> u64 {
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    *GUIDE.lock().unwrap() = Some(Guide { id, question: question.to_string(), steps, at: 0, rect: Some(rect), named: None, words: Vec::new(), source: String::new(), open: true, partial: false });
    watch(app);
    id
}

/// Ended: Esc, another question, his windows closed.
pub fn cancel() {
    *GUIDE.lock().unwrap() = None;
    // A « where is…? » still being looked up draws nothing when it's done (Esc, a new question).
    ASKED.fetch_add(1, Ordering::Relaxed);
}

/// Bumped by each « where is…? » and by `cancel`: a lookup that finishes after a newer
/// question, or after Esc, draws nothing.
static ASKED: AtomicU64 = AtomicU64::new(0);

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
                    // Safeguard (#96): only a click on the guided app counts (the same spot in
                    // another app, alt-tabbed to, doesn't move the guide on).
                    let hit = GUIDE.lock().unwrap().as_ref().is_some_and(|g| {
                        let on_app = g.named.as_ref().map_or(true, |(pid, _)| super::uia::pid_at(p.0, p.1).map_or(true, |at| at == *pid || at == std::process::id()));
                        on_app && g.rect.map_or(true, |r| inside(r, p))
                    });
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

const ROUTE_SYSTEM: &str = "You guide someone to a place in the app on their screen, one click at a time. You get the app's name, their question and the names of the things they can click right now (buttons, menu items, tabs, links), each with where it sits in the app's window. Reply with JSON only, no other words: {\"say\": \"one short sentence, at most 12 words, naming the clicks\", \"route\": [\"names to click, in order\"]}. The first name must be copied exactly from the list. The route always goes all the way: the later names are what will appear after each click (your best guess at their exact label, as this app usually names them), and the last one is the thing they asked for, e.g. [\"Menu\", \"Settings\", \"Billing\"]. Only if the thing itself is in the list is the route just that name. Think like someone who knows the app: settings, billing, plan and account things are usually under the account button, often named after the person or their plan (\"Sam Pro\", \"Account\"), at the bottom-left of a sidebar or the top-right; a title-bar \"Menu\" holds File, Edit, View and Help only. Copy names without the place in brackets. If you can't tell where to start, the route is [] (then the screen is looked at instead): an empty route is better than a wrong one.";

/// The route asked for by name: the sentence to show and the names to click. One text-only
/// call with no history: about a hundred short names in, a few names out.
fn plan(question: &str, app_name: &str, list: &[super::uia::Named], done: &[String]) -> Option<(String, Vec<String>)> {
    let names = super::uia::described(list, 150).join(" | ");
    let done = if done.is_empty() { String::new() } else { format!("Already clicked, in order: {}.\n", done.join(" › ")) };
    let user = format!("App: {app_name}\nQuestion: {question}\n{done}Clickable now: {names}");
    let cost = (ROUTE_SYSTEM.len() + user.len()) / 4;
    let started = std::time::Instant::now();
    let reply = tauri::async_runtime::block_on(crate::claude::complete_quick(super::brain::FAST_MODEL, ROUTE_SYSTEM, &user, 300, Duration::from_secs(30)));
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
    let route: Vec<String> = v["route"].as_array()?.iter().filter_map(|s| s.as_str()).map(|s| unplaced(s).chars().take(60).collect::<String>()).filter(|s| !s.is_empty()).take(MOST).collect();
    Some((v["say"].as_str().unwrap_or("").trim().to_string(), route))
}

/// « nullzeed Pro (bottom-left) » copied with its place: the name only.
fn unplaced(s: &str) -> &str {
    let s = s.trim();
    match s.rfind(" (") {
        Some(i) if s.ends_with(')') && ["top-", "middle-", "bottom-"].iter().any(|p| s[i + 2..].starts_with(p)) => s[..i].trim(),
        _ => s,
    }
}

/// The question as remembered: lower case, the « where is » and « the » words left out.
fn question_key(q: &str) -> String {
    let q = q.to_lowercase();
    const SKIP: [&str; 17] = ["where", "is", "s", "are", "the", "my", "how", "do", "i", "get", "to", "find", "go", "can", "open", "a", "jarvis"];
    q.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty() && !SKIP.contains(w)).collect::<Vec<_>>().join(" ")
}

const LOOKUP_SYSTEM: &str = "You help someone find a place in a Windows app. Search the web once for the official steps (the app's own help pages first), then match them to the things they can click in the app right now, listed with where each sits in its window. Reply with JSON only, no other words: {\"say\": \"one short sentence, at most 12 words, naming the clicks\", \"steps\": [{\"do\": \"the step as the help page puts it, short\", \"name\": \"the label to click\"}], \"source\": \"the help page's address\"}. The first step's name is copied exactly from the list, without the place in brackets: match the help's words to it (an account, profile or « your name » step is the button named after the person or their plan, like \"Sam Pro\" or \"Account\", usually at the bottom-left of a sidebar or the top-right: never a title-bar \"Menu\", which only holds File, Edit, View and Help). The later names are the labels the help page gives. Each step is something clicked (a button, a menu item, a tab, a sidebar entry): a heading that only groups items, like a section title in a settings sidebar, is never a step. Give the shortest way: the last step is the thing they asked for itself (to find Export, the route ends at Export, not at what you do inside it); never add steps that go on to do a task with it. If nothing in the list fits the first step, its name is \"\" (it will be found on the screen). If the help doesn't fit this app, steps is []. If the question isn't about finding or doing something in this app (a fact, an explanation, something about the content on screen), reply {\"say\": \"\", \"steps\": [], \"source\": \"\"} at once, without searching.";

/// What the web says (#96): the official steps for `question` in this app, matched to the names
/// on the screen. Once per question: his note keeps it after.
fn look_up(question: &str, app_name: &str, list: &[super::uia::Named]) -> Option<(String, Note)> {
    let names = super::uia::described(list, 150).join(" | ");
    let user = format!("App: {app_name} (its program is {app_name}.exe, on Windows)\nQuestion: {question}\nClickable now: {names}");
    let started = std::time::Instant::now();
    let reply = if crate::secrets::present(crate::claude::KEY) {
        tauri::async_runtime::block_on(async {
            let tools = [json!({ "type": "web_search_20250305", "name": "web_search", "max_uses": 2 })];
            let turn = crate::claude::voice_turn(super::brain::FAST_MODEL, LOOKUP_SYSTEM, &[json!({ "role": "user", "content": user })], &tools).await?;
            Ok::<String, String>(turn["content"].as_array().into_iter().flatten().filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).collect())
        })
    } else {
        let request = crate::claude_code::Request { model: super::brain::FAST_MODEL, system: LOOKUP_SYSTEM, prompt: &user, tools: &["WebSearch"], read_dir: None, timeout: Duration::from_secs(75), quick: true };
        tauri::async_runtime::block_on(crate::claude_code::ask(&request))
    };
    let reply = match reply {
        Ok(r) => r,
        Err(err) => {
            crate::log::line(format!("guide: no lookup: {err}"));
            return None;
        }
    };
    let found = read_lookup(&reply);
    crate::log::line(format!("guide: looked up on the web in {} ms: {:?}", started.elapsed().as_millis(), found.as_ref().map(|f| (&f.1.route, &f.1.source))));
    found.filter(|f| !f.1.route.is_empty() && (!f.1.route[0].is_empty() || f.1.words.first().is_some_and(|w| !w.is_empty())))
}

/// The first step, found on the picture from its words (#96: « Open the account menu » is the
/// button named « nullzeed Pro »), and its real name read at that spot: the note keeps the name,
/// so this picture is looked at once.
fn locate(app: &AppHandle, question: &str, words: &str, shot: &super::sight::Shot) -> Option<super::uia::Named> {
    let ask = format!(
        "On this picture of their screen, find what to click for this step: \"{words}\" (they want: \"{question}\"). Reply with nothing but this block: <window>{{\"kind\": \"point\", \"target\": [x, y, w, h]}}</window> (the box round it, in the picture's pixels), or \"not found\". Don't search the web."
    );
    let mut written = String::new();
    let _ = super::ask::brain().lock().unwrap().respond(app, &ask, Some(shot), &mut |d| written.push_str(d));
    let (x, y, w, h) = super::window::split(&written).1.and_then(|v| super::window::target(&v, shot.size))?;
    let (x0, y0) = shot.to_screen(x, y);
    let (x1, y1) = shot.to_screen(x + w, y + h);
    let rect = (x0, y0, x1 - x0, y1 - y0);
    let named = super::uia::at(rect.0 + rect.2 / 2.0, rect.1 + rect.3 / 2.0);
    crate::log::line(format!("guide: \"{words}\" found on the picture: {:?}", named.as_ref().map(|n| &n.name)));
    Some(named.unwrap_or(super::uia::Named { name: String::new(), rect }))
}

/// {"say", "steps": [{"do", "name"}], "source"} from his reply.
fn read_lookup(reply: &str) -> Option<(String, Note)> {
    let (a, b) = (reply.find('{')?, reply.rfind('}')?);
    let v: serde_json::Value = serde_json::from_str(reply.get(a..=b)?).ok()?;
    let mut note = Note { source: v["source"].as_str().unwrap_or("").trim().to_string(), ..Note::default() };
    for s in v["steps"].as_array()?.iter().take(MOST) {
        let name = unplaced(s["name"].as_str().unwrap_or("")).chars().take(60).collect::<String>();
        // Only the first may have no name yet: it's found on the screen from its words.
        if name.is_empty() && !note.route.is_empty() {
            continue;
        }
        note.route.push(name);
        note.words.push(s["do"].as_str().unwrap_or("").trim().chars().take(120).collect());
    }
    Some((v["say"].as_str().unwrap_or("").trim().to_string(), note))
}

/// The furthest step of `steps` from `from` on that's already on screen (#96: in Discord the
/// settings opened on Accessibility, but he waited for « App Settings »): by its button name,
/// else, for the step he's on and the last, anything called exactly that.
fn furthest(list: &[super::uia::Named], pid: u32, steps: &[String], from: usize) -> Option<(usize, super::uia::Named)> {
    if let Some(i) = (from..steps.len()).rev().find(|i| super::uia::find(list, &steps[*i]).is_some()) {
        return super::uia::find(list, &steps[i]).cloned().map(|n| (i, n));
    }
    let mut ends = vec![steps.len().saturating_sub(1), from];
    ends.dedup();
    ends.into_iter().filter(|i| *i < steps.len()).find_map(|i| super::uia::named(pid, &steps[i]).map(|n| (i, n)))
}

/// « Where is…? » the lean way: the sentence he says, with the first click circled and the
/// guide started; None when the app shares no names or no route was found from them (then
/// the question goes the picture way, as before).
pub fn where_is(app: &AppHandle, question: &str, seen: Option<&super::sight::Shot>) -> Option<String> {
    let asked = ASKED.fetch_add(1, Ordering::Relaxed) + 1;
    let Some((hwnd, pid)) = super::uia::user_window() else {
        crate::log::line("guide: no app found in front: the picture way");
        return None;
    };
    crate::log::line(format!("guide: where is…? in {}", super::uia::app_name(pid)));
    let list = super::uia::clickable(pid);
    if list.len() < 3 {
        crate::log::line("guide: the app shares no button names: the picture way");
        return None;
    }
    let app_name = super::uia::app_name(pid);
    let qkey = question_key(question);
    // His note first (free); else the web once; else the names alone; else the picture way.
    let note = super::howto::read(&app_name, &qkey).filter(|n| furthest(&list, pid, &n.route, 0).is_some());
    let (said, mut note, open) = match note {
        Some(n) => {
            crate::log::line(format!("guide: from his note, no AI: {:?}", n.route));
            (String::new(), n, false)
        }
        None => match look_up(question, &app_name, &list) {
            // The first step had no name to go by: found on the picture from its words.
            Some((said, mut n)) if furthest(&list, pid, &n.route, 0).is_none() => {
                let words = n.words.first().cloned().unwrap_or_else(|| n.route[0].clone());
                let spot = seen.and_then(|shot| locate(app, question, &words, shot)).filter(|s| !s.name.is_empty())?;
                n.route[0] = spot.name;
                (said, n, false)
            }
            Some((said, n)) => (said, n, false),
            None => {
                let (said, route) = plan(question, &app_name, &list, &[])?;
                (said, Note { route, ..Note::default() }, true)
            }
        },
    };
    // The shortest way: the route ends at the first click that is the thing asked for (#96: Export
    // was it, but the help page's recipe went on to Change File Type and Save As).
    let goal = goal_at(question, &app_name, &note.route);
    if let Some(i) = goal {
        if i + 1 < note.route.len() {
            crate::log::line(format!("guide: shortened to {} steps: {:?} is what was asked for", i + 1, note.route[i]));
        }
        note.route.truncate(i + 1);
        note.words.truncate(i + 1);
    }
    let open = open && goal.is_none();
    // Safeguards (#96): asked again or Esc'd meanwhile, nothing is drawn; alt-tabbed away while
    // he looked it up, the window it was asked from comes back first, and its buttons are read
    // again where they now are.
    if ASKED.load(Ordering::Relaxed) != asked {
        crate::log::line("guide: a newer question or Esc meanwhile: nothing drawn");
        return Some(said_or_route(&said, &note.route));
    }
    let mut list = list;
    if super::uia::elsewhere(pid) {
        let back = super::uia::bring_back(hwnd);
        crate::log::line(format!("guide: you went to another app meanwhile: {}", if back { "brought the first one back" } else { "couldn't bring it back" }));
        std::thread::sleep(Duration::from_millis(350));
        list = super::uia::clickable(pid);
    }
    let (start, first) = furthest(&list, pid, &note.route, 0)?;
    if start > 0 {
        crate::log::line(format!("guide: step {} already on screen, starting there", start + 1));
        note.route.drain(..start);
        note.words.drain(..start.min(note.words.len()));
    }
    let route = note.route.clone();
    let said = if said.is_empty() { format!("{}, sir.", route.join(", then ")) } else { said };
    if route.len() < 2 && goal.is_some() {
        cancel();
        super::explain::circle(app, first.rect, &[], None);
        return Some(said);
    }
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    *GUIDE.lock().unwrap() = Some(Guide { id, question: question.to_string(), steps: route.clone(), at: 0, rect: Some(first.rect), named: Some((pid, app_name)), words: note.words, source: note.source, open, partial: start > 0 });
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
        // There: the last click was the thing asked for (#96: a route that stopped at « Menu »
        // goes on: what to click next is planned from what the menu shows).
        let clicked_goal = goal_at(&guide.question, &name, &guide.steps[..guide.at.min(guide.steps.len())]).is_some();
        if clicked_goal || (guide.at >= guide.steps.len() && (!guide.open || reached(&guide.question, guide.steps.last()) || guide.at >= MOST)) {
            let id = guide.id;
            guide.steps.truncate(guide.at.min(guide.steps.len()));
            let mut words = guide.words.clone();
            words.truncate(guide.steps.len());
            if !guide.partial { super::howto::write(&name, &guide.question, &question_key(&guide.question), &Note { route: guide.steps.clone(), words, source: guide.source.clone() }); }
            *g = None;
            drop(g);
            crate::log::line("guide: there");
            let _ = app.emit_to(super::explain::LABEL, "explain-guide", json!({ "id": id, "done": true }));
            return;
        }
        (guide.id, guide.question.clone(), guide.steps.clone(), guide.at, pid, name)
    };
    // Past the planned route, short of the thing: the next click is planned from what's there.
    let open_end = at >= steps.len();
    let guess = steps.get(at).map(|s| step_text(s)).unwrap_or_else(|| "…".into());
    let _ = app.emit_to(super::explain::LABEL, "explain-guide", json!({ "id": id, "at": at, "total": steps.len().max(at + 1), "step": guess, "looking": true }));
    // What the click opened, settled (a menu sliding in, a page loading): looked at a few times.
    let mut list = Vec::new();
    let mut found = None;
    for wait in if open_end { &[700][..] } else { &[350, 400, 600][..] } {
        std::thread::sleep(Duration::from_millis(*wait));
        if GUIDE.lock().unwrap().as_ref().map(|g| g.id) != Some(id) {
            return;
        }
        // Safeguard (#96): the app was closed: the guide ends quietly, his ring gone.
        list = super::uia::clickable(pid);
        if list.is_empty() {
            crate::log::line("guide: the app is gone: ended");
            let app = app.clone();
            let _ = app.clone().run_on_main_thread(move || super::explain::close_all(&app));
            return;
        }
        if let Some(front) = super::uia::user_app().filter(|p| *p != pid) {
            list.extend(super::uia::clickable(front));
        }
        found = furthest(&list, pid, &steps, at);
        if found.is_some() {
            break;
        }
    }
    let (mut steps, mut at) = (steps, at);
    let mut found = match found {
        Some((i, n)) => {
            if i > at {
                crate::log::line(format!("guide: step {} already on screen, skipping ahead", i + 1));
            }
            at = i;
            Some(n)
        }
        None => None,
    };
    if found.is_some() {
        crate::log::line(format!("guide: step {} found by name", at + 1));
    } else if let Some(i) = (0..steps.len()).rev().filter(|_| !open_end).find(|i| super::uia::find(&list, &steps[*i]).is_some()) {
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
        crate::log::line(format!("guide: \"{}\" not among the names: a picture", steps.get(at).map_or("the next click", |s| s.as_str())));
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

/// The last click was the thing asked for: one of the question's words is in its name.
fn reached(question: &str, last: Option<&String>) -> bool {
    let Some(last) = last else { return false };
    let name = last.to_lowercase();
    question_key(question).split(' ').filter(|w| w.len() >= 3).any(|w| name.contains(w.trim_end_matches('s')))
}

/// Where the route reaches what was asked for: the first step whose name holds every word that
/// names it (« export » → « Export »; « dark mode » → « Dark mode », not « Settings »). Words
/// that only say where (« tab », « button »…) and the app's own name don't count.
fn goal_at(question: &str, app_name: &str, route: &[String]) -> Option<usize> {
    const WHERE: [&str; 12] = ["tab", "tabs", "button", "buttons", "page", "section", "option", "options", "screen", "menu", "app", "in"];
    let app = app_name.to_lowercase();
    let words: Vec<String> = question_key(question)
        .split(' ')
        .filter(|w| w.len() >= 3 && !WHERE.contains(w) && !app.contains(w))
        .map(|w| w.trim_end_matches('s').to_string())
        .collect();
    if words.is_empty() {
        return None;
    }
    route.iter().position(|name| {
        let name = name.to_lowercase();
        words.iter().all(|w| name.contains(w.as_str()))
    })
}

/// His line: what he said, or the route in words.
fn said_or_route(said: &str, route: &[String]) -> String {
    if said.is_empty() { format!("{}, sir.", route.join(", then ")) } else { said.to_string() }
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
        assert_eq!(read_route(r#"{"say": "", "route": ["nullzeed Pro (bottom-left)", "Settings"]}"#).unwrap().1[0], "nullzeed Pro");
    }

    #[test]
    fn the_web_steps_are_read_with_their_words() {
        let (said, note) = read_lookup(r#"{"say": "Your name, then Settings, then Billing.", "steps": [{"do": "Click your name at the bottom-left", "name": "nullzeed Pro (bottom-left)"}, {"do": "Choose Settings", "name": "Settings"}, {"do": "Open Billing", "name": "Billing"}], "source": "https://support.example.com/a"}"#).unwrap();
        assert_eq!(said, "Your name, then Settings, then Billing.");
        assert_eq!(note.route, vec!["nullzeed Pro", "Settings", "Billing"]);
        assert_eq!(note.words[0], "Click your name at the bottom-left");
        assert_eq!(note.source, "https://support.example.com/a");
        assert!(read_lookup(r#"{"say": "", "steps": [], "source": ""}"#).unwrap().1.route.is_empty());
    }

    #[test]
    fn the_same_question_is_remembered_however_asked() {
        assert_eq!(question_key("Where is billing?"), "billing");
        assert_eq!(question_key("where's the Billing"), "billing");
        assert_eq!(question_key("How do I get to dark mode"), "dark mode");
        assert_eq!(step_text("Settings"), "Click Settings");
        assert!(reached("where is billing?", Some(&"Billing & plans".to_string())));
        assert!(reached("where are the plugins", Some(&"Plugins".to_string())));
        assert!(!reached("where is billing?", Some(&"Menu".to_string())));
        let word: Vec<String> = ["File Tab", "Export", "Change File Type", "Save As"].iter().map(|s| s.to_string()).collect();
        assert_eq!(goal_at("where is the export tab in word", "winword", &word), Some(1));
        let dark: Vec<String> = ["nullzeed Pro", "Settings", "Appearance", "Dark mode"].iter().map(|s| s.to_string()).collect();
        assert_eq!(goal_at("where is dark mode", "claude", &dark), Some(3));
        assert_eq!(goal_at("where are the dark mode settings", "claude", &dark), None);
        assert_eq!(goal_at("where is it", "claude", &dark), None);
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

#[cfg(all(test, windows))]
mod live {
    /// By hand: UIA_PID=<an app's process id> GUIDE_Q="where is billing" cargo test --lib guide::live -- --ignored --nocapture
    #[test]
    #[ignore]
    fn plans_a_route_from_a_running_app() {
        let pid: u32 = std::env::var("UIA_PID").ok().and_then(|p| p.parse().ok()).expect("UIA_PID");
        let q = std::env::var("GUIDE_Q").unwrap_or_else(|_| "where is billing".into());
        let list = super::super::uia::clickable(pid);
        let found = super::look_up(&q, &super::super::uia::app_name(pid), &list);
        println!("LOOKUP {found:?} first found: {:?}", found.as_ref().and_then(|f| f.1.route.first()).and_then(|n| super::super::uia::find(&list, n)));
    }
}
