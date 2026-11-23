// JARVIS's voice: hold the talk keys (Left Ctrl + Win by default) and talk (or tap them, and talk
// hands-free), the way Roamies does it (talk.rs). « Hey JARVIS » is gone: no
// phrase is listened for, so nothing wakes him by mistake or cuts you off.
//
// While it is on, the microphone is open but only a take — from the keys going
// down to the question being sent — is read, by Parakeet on this computer;
// what you said goes to Claude (brain.rs, your key or your own Claude Code),
// never the audio. Mochi shows it all in the pill at the bottom of the screen —
// listening, thinking, then the answer, said out loud by the system's voice
// (the pill's speechSynthesis) or ElevenLabs with your key.
//
// It stops listening while you dictate, while a call is recorded and while it
// speaks itself.

pub mod ask;
pub mod brain;
pub mod circle;
pub mod draw;
pub mod explain;
pub mod ink;
pub mod gemini;
pub mod piper;
pub mod meter;
pub mod print;
pub mod shortcut;
pub mod sight;
pub mod stream;
pub mod talk;
pub mod wake;
pub mod warm;
pub mod window;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::flow::pill;
use crate::speech::{self, audio};

/// What the pill shows of a conversation.
#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct VoiceView {
    /// "listening", "thinking", "speaking".
    pub phase: String,
    /// What you said (after « OK Coucou »).
    pub heard: String,
    /// Coucou's answer.
    pub answer: String,
    /// JARVIS: how long each newly added word of `answer` takes to say (ms), so
    /// the pill lights the words up as he says them; 0 shows them at once.
    pub pace_ms: u64,
}

struct Running {
    stop: Arc<AtomicBool>,
}

static RUNNING: Mutex<Option<Running>> = Mutex::new(None);

/// Rust waits on these for the island's answers and the end of speech.
fn pending() -> &'static Mutex<HashMap<u64, mpsc::Sender<String>>> {
    static P: OnceLock<Mutex<HashMap<u64, mpsc::Sender<String>>>> = OnceLock::new();
    P.get_or_init(|| Mutex::new(HashMap::new()))
}
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

/// Whether « OK Coucou » can run: the voice model, and a Claude key or (JARVIS)
/// the user's own Claude Code to answer with.
pub fn requirements_met() -> bool {
    speech::is_ready() && (crate::secrets::present(crate::claude::KEY) || crate::claude_code::available())
}

/// Starts or stops listening to follow the preference.
pub fn sync(app: &AppHandle) {
    // JARVIS: voice training listens too, even with « Hey JARVIS » off.
    let wanted = crate::flow::get(app).is_some_and(|f| f.store.lock().unwrap().prefs.voice) || print::training_active();
    let mut running = RUNNING.lock().unwrap();
    match (wanted && requirements_met(), running.is_some()) {
        (true, false) => {
            let stop = Arc::new(AtomicBool::new(false));
            let app2 = app.clone();
            let stop2 = stop.clone();
            std::thread::Builder::new().name("coucou-voice".into()).spawn(move || run(app2, stop2)).ok();
            *running = Some(Running { stop });
            speech::preload();
            // JARVIS: his voice loaded before the first answer.
            crate::tts::preload();
            // JARVIS: the offline backup, ready before Gemini first needs it.
            piper::preload();
            crate::log::line("voice: push-to-talk ready");
        }
        (false, true) => {
            if let Some(r) = running.take() {
                r.stop.store(true, Ordering::Relaxed);
            }
            let dictation = crate::flow::get(app).is_some_and(|f| f.store.lock().unwrap().prefs.enabled);
            if !dictation && !crate::notes::is_recording(app) {
                speech::unload();
            }
            crate::log::line("voice: « OK Coucou » off");
        }
        _ => {}
    }
}

/// « OK Coucou » is listening (the voice model stays loaded).
pub fn is_listening() -> bool {
    RUNNING.lock().unwrap().is_some()
}

/// Starts again on another microphone.
pub fn restart(app: &AppHandle) {
    if let Some(r) = RUNNING.lock().unwrap().take() {
        r.stop.store(true, Ordering::Relaxed);
    }
    sync(app);
}

fn show(app: &AppHandle, view: Option<VoiceView>) {
    pill::update(app, |s| s.voice = view);
}

// ── JARVIS: push-to-talk (talk.rs) ─────────────────────────────────────────────

/// Audio kept from just before the keys went down, so the first word isn't clipped (s).
const PREROLL: f64 = 0.3;
/// After the keys are let go, the mic stays open this long for a word said while letting go (s).
const TAIL: f64 = 0.3;
/// While talking, what was said so far is read again this often, for the live text (s).
const READ_EVERY: f64 = 0.8;
/// Hands-free: this long with no voice and no new words ends the take (s).
const PAUSE_ENDS: f64 = 2.0;
/// Hands-free: nothing said this long and the take is dropped (s).
const NOTHING_WAIT: f64 = 6.0;
/// After each answer, how long JARVIS keeps listening for you to go on, no keys needed (s).
const FOLLOW_UP_WAIT: f64 = 8.0;
/// The longest take (s).
const MAX_TAKE: f64 = 60.0;
/// The longest the last reading may take before the take is given up (s).
const FINAL_TIMEOUT: Duration = Duration::from_secs(20);

/// One take: from the keys going down to the question being sent.
struct Take {
    id: u64,
    audio: Vec<f32>,
    started: f64,
    /// When a voice was last heard (above the room's noise); None while nobody spoke.
    voice_at: Option<f64>,
    /// When the live text last grew: words still coming keep a hands-free take open.
    grew_at: f64,
    /// How long to wait for a first word when hands-free.
    nothing_wait: f64,
    /// Opened by JARVIS after an answer: the answer stays on screen until you speak,
    /// and closes quietly if you don't.
    follow_up: bool,
    /// The live text so far.
    heard: String,
    read_at: f64,
    reading: bool,
    /// Keys let go: the take ends at this time (the tail).
    send_at: Option<f64>,
}

/// Reads takes on its own thread, so the keys are watched while Parakeet works.
/// In: (take, audio, last); out: (take, text, last).
fn reader() -> (mpsc::Sender<(u64, Vec<f32>, bool)>, mpsc::Receiver<(u64, String, bool)>) {
    let (jobs, job_rx) = mpsc::channel::<(u64, Vec<f32>, bool)>();
    let (out, results) = mpsc::channel();
    std::thread::Builder::new()
        .name("jarvis-talk-reader".into())
        .spawn(move || {
            for (id, audio, last) in job_rx {
                // As dictation reads it: the take as recorded, not amplified.
                let text = speech::transcribe(&audio).map(|t| t.text.trim().to_string()).unwrap_or_default();
                if out.send((id, text, last)).is_err() {
                    break;
                }
            }
        })
        .ok();
    (jobs, results)
}

fn run(app: AppHandle, stop: Arc<AtomicBool>) {
    let mic = crate::flow::get(&app).map(|f| f.store.lock().unwrap().prefs.mic.clone()).unwrap_or_default();
    let (tx, rx) = mpsc::channel::<Vec<f32>>();
    let capture = audio::Capture::start(audio::Source::Mic(if mic.is_empty() { None } else { Some(mic) }), move |s| {
        let _ = tx.send(s.to_vec());
    });
    let mut capture = match capture {
        Ok(c) => c,
        Err(err) => {
            crate::log::line(format!("voice: microphone: {err}"));
            *RUNNING.lock().unwrap() = None;
            return;
        }
    };
    // The room's noise level (what counts as a voice), and the training takes.
    let mut vad = wake::Vad::default();
    let mut talk = talk::Talk::default();
    let mut take: Option<Take> = None;
    let mut next_take = 0u64;
    let (jobs, results) = reader();
    let preroll_len = (PREROLL * speech::SAMPLE_RATE as f64) as usize;
    let mut preroll: std::collections::VecDeque<f32> = std::collections::VecDeque::with_capacity(preroll_len + 4096);
    let mut brain = brain::Brain::default();
    let mut hide_at: Option<Instant> = None;
    // What you circle while holding the talk keys (circle.rs): he looks at just that.
    let mut trail: Option<ink::Trail> = None;
    // The circle once the keys are let go (its trail fading), until the take ends.
    let mut drawn: Option<circle::Ink> = None;
    // Silence for the question while you talk (flow/hush.rs).
    let mut hush: Option<crate::flow::hush::Guard> = None;
    let quiet = || crate::flow::get(&app).is_some_and(|f| f.store.lock().unwrap().prefs.mute_others);
    let t0 = Instant::now();
    let mut level_peak = 0.0f32;
    let mut level_since = Instant::now();
    let mut level_emit = Instant::now();
    prewarm();
    while !stop.load(Ordering::Relaxed) {
        let recording = take.is_some();
        if recording && hush.is_none() {
            hush = crate::flow::hush::hush(quiet());
        } else if !recording {
            hush = None;
        }
        // A short beat: the keys are read about every 30 ms.
        let chunk = match rx.recv_timeout(Duration::from_millis(30)) {
            Ok(c) => Some(c),
            Err(mpsc::RecvTimeoutError::Timeout) => None,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        };
        let now = t0.elapsed().as_secs_f64();
        // The pill's last answer goes away after a while (not while the pointer is on it).
        if hide_at.is_some_and(|t| Instant::now() > t) {
            if pill::pointer_over() {
                hide_at = Some(Instant::now() + Duration::from_millis(800));
            } else {
                hide_at = None;
                show(&app, None);
            }
        }
        // Dictation and calls have the microphone: no talking meanwhile.
        if pill::dictating(&app) || crate::notes::is_recording(&app) {
            if take.take().is_some() {
                show(&app, None);
            }
            talk.end();
            vad.reset();
            preroll.clear();
            continue;
        }

        // The keys.
        let (chord, other) = talk::keys();
        match talk.step(now, chord, other) {
            Some(talk::Event::Begin) => {
                // A held Win or Alt, let go, would open the Start menu or the app's menu bar.
                if shortcut::needs_mask(shortcut::Which::Talk) {
                    shortcut::mask();
                }
                trail = Some(ink::Trail::start(&app));
                drawn = None;
                next_take += 1;
                take = Some(Take {
                    id: next_take,
                    audio: preroll.iter().copied().collect(),
                    started: now,
                    voice_at: None,
                    grew_at: now,
                    nothing_wait: NOTHING_WAIT,
                    follow_up: false,
                    heard: String::new(),
                    read_at: now,
                    reading: false,
                    send_at: None,
                });
            }
            Some(talk::Event::Hold) => {
                hide_at = None;
                show(&app, Some(VoiceView { phase: "listening".into(), ..Default::default() }));
            }
            Some(talk::Event::HandsFree) => {
                // A tap: nothing was circled.
                if let Some(t) = trail.take() {
                    t.end();
                }
                hide_at = None;
                show(&app, Some(VoiceView { phase: "listening".into(), ..Default::default() }));
            }
            Some(talk::Event::Send) => {
                drawn = trail.take().map(ink::Trail::end);
                if let Some(t) = take.as_mut() {
                    t.send_at = Some(now + TAIL);
                }
            }
            Some(talk::Event::Cancel) => {
                take = None;
                if let Some(t) = trail.take() {
                    t.end();
                }
                show(&app, None);
            }
            Some(talk::Event::Close) => {
                take = None;
                if let Some(t) = trail.take() {
                    t.end();
                }
                hide_at = None;
                fade_out(&app);
            }
            None => {}
        }

        // Circling something while the keys are held.
        if chord && take.is_some() && !talk.hands_free() {
            if let (Some(i), Some(p)) = (trail.as_mut(), crate::platform::cursor_physical()) {
                if i.feed(p) {
                    crate::log::line("voice: something was circled");
                }
            }
        }

        // The microphone.
        if let Some(chunk) = chunk {
            if !chunk.is_empty() {
                let rms = (chunk.iter().map(|x| x * x).sum::<f32>() / chunk.len() as f32).sqrt();
                level_peak = level_peak.max(rms);
                if let Some(t) = take.as_mut() {
                    if is_voice(rms, vad.floor()) {
                        t.voice_at = Some(now);
                    }
                }
                if print::training_active() && level_emit.elapsed() > Duration::from_millis(100) {
                    let level = (rms / (vad.threshold() * 4.0)).min(1.0);
                    let _ = app.emit("voice-level", level);
                    level_emit = Instant::now();
                }
            }
            // The room's noise floor follows along; training takes are its stretches of speech.
            for segment in vad.feed(&chunk) {
                if print::training_active() && segment.len() >= speech::SAMPLE_RATE as usize * 35 / 100 {
                    let segment = wake::boost(&segment);
                    if let Some(heard) = speech::transcribe(&segment).map(|t| t.text.trim().to_string()) {
                        if !heard.is_empty() {
                            print::take(&app, &segment, &heard);
                        }
                    }
                }
            }
            match take.as_mut() {
                Some(t) => t.audio.extend_from_slice(&chunk),
                None => {
                    preroll.extend(chunk.iter().copied());
                    while preroll.len() > preroll_len {
                        preroll.pop_front();
                    }
                }
            }
        }
        if level_since.elapsed() > Duration::from_secs(10) {
            // A fresh Claude Code once the conversation is forgotten, or if it stopped.
            prewarm();
            crate::log::line(format!("voice: mic level peak {level_peak:.4} (speech from {:.4})", vad.threshold()));
            level_peak = 0.0;
            level_since = Instant::now();
        }

        // Live text: what was said so far, read again about once a second.
        while let Ok((id, text, last)) = results.try_recv() {
            if let Some(t) = take.as_mut().filter(|t| t.id == id && !last) {
                t.reading = false;
                if !text.is_empty() && text != t.heard {
                    t.heard = text;
                    t.grew_at = now;
                    // You went on: no longer a quiet wait behind the answer.
                    t.follow_up = false;
                    if talk.shown() {
                        hide_at = None;
                        show(&app, Some(VoiceView { phase: "listening".into(), heard: t.heard.clone(), ..Default::default() }));
                    }
                }
            }
        }
        let Some(t) = take.as_mut() else { continue };
        if t.voice_at.is_some() && !t.reading && t.send_at.is_none() && now - t.read_at >= READ_EVERY {
            t.reading = true;
            t.read_at = now;
            let _ = jobs.send((t.id, t.audio.clone(), false));
        }

        // How the take ends.
        let end = if t.send_at.is_some_and(|at| now >= at) {
            Some(if t.voice_at.is_some() { "sent" } else { "nothing said" })
        } else if talk.hands_free() {
            match t.voice_at {
                Some(at) if now - at.max(t.grew_at) > PAUSE_ENDS => Some("pause"),
                None if now - t.started > t.nothing_wait => Some("nothing said"),
                _ => None,
            }
        } else {
            None
        };
        let end = end.or_else(|| (now - t.started > MAX_TAKE).then_some("too long"));
        let Some(why) = end else { continue };
        let done = take.take().unwrap();
        talk.end();
        // What was circled, copied now; its picture is made while Parakeet reads your words.
        let circled = drawn.take().or_else(|| trail.take().map(ink::Trail::end)).filter(|_| why != "nothing said").and_then(|i| {
            let area = i.area()?;
            sight::circled(area, i.circle()?)
        });
        if why == "nothing said" {
            // Parakeet makes words up from silence: a take with no voice in it is dropped.
            crate::log::line(if done.follow_up { "voice: no follow-up" } else { "voice: talk keys, nothing said" });
            // After an answer, the answer stays and fades on its own (hide_at).
            if !done.follow_up {
                show(&app, None);
            }
            continue;
        }
        show(&app, Some(VoiceView { phase: "thinking".into(), heard: done.heard.clone(), ..Default::default() }));
        let _ = jobs.send((done.id, done.audio, true));
        let question = loop {
            match results.recv_timeout(FINAL_TIMEOUT) {
                Ok((id, text, true)) if id == done.id => break Some(text),
                Ok(_) => continue,
                Err(_) => break None,
            }
        };
        let question = question.filter(|q| q.chars().any(char::is_alphanumeric));
        let Some(question) = question else {
            crate::log::line(format!("voice: talk keys ({why}), nothing understood"));
            show(&app, None);
            continue;
        };
        crate::log::line(format!("voice: talk keys ({why}), {} words", crate::flow::text::word_count(&question)));
        let circled = circled.and_then(sight::Pending::wait);
        let (_, stopped) = answer(&app, &mut brain, &question, circled.as_ref(), &mut hide_at);
        vad.reset();
        if stopped {
            // Stopped with the talk keys: no follow-up, and nothing starts until they're up.
            crate::log::line("voice: stopped with the talk keys");
            hide_at = None;
            talk.block();
            while rx.try_recv().is_ok() {}
            preroll.clear();
            continue;
        }
        // Drop what the microphone heard of JARVIS's own voice.
        while rx.try_recv().is_ok() {}
        preroll.clear();
        // The conversation goes on: JARVIS keeps listening, hands-free, for you to
        // reply or ask more — no keys. The answer stays on screen meanwhile (no
        // « Listening… » popping up); your words replace it once you speak.
        talk.listen();
        next_take += 1;
        let at = t0.elapsed().as_secs_f64();
        take = Some(Take {
            id: next_take,
            audio: Vec::new(),
            started: at,
            voice_at: None,
            grew_at: at,
            nothing_wait: FOLLOW_UP_WAIT,
            follow_up: true,
            heard: String::new(),
            read_at: at,
            reading: false,
            send_at: None,
        });
    }
    capture.stop();
    show(&app, None);
    warm::shutdown();
}

/// A voice in a take: clearly above the room's own noise (twice its level), with
/// a low bar of its own — a quiet microphone gives speech at 0.004–0.006, where
/// the wake detector's 0.0035 missed soft words and a breath ended the take.
fn is_voice(rms: f32, floor: f32) -> bool {
    rms > (floor * 2.0).max(0.0012)
}

/// Set when the talk keys are pressed while he thinks or speaks: the rest of the answer is dropped.
static STOPPED: AtomicBool = AtomicBool::new(false);

/// The pill fades his bubble and his voice out, then the voice view goes.
fn fade_out(app: &AppHandle) {
    let _ = app.emit_to(pill::LABEL, "voice-stop", ());
    std::thread::sleep(Duration::from_millis(320));
    show(app, None);
}

/// While he answers, the talk keys pressed again stop him (the loop is busy meanwhile).
fn watch_for_stop(app: &AppHandle) -> Arc<AtomicBool> {
    let done = Arc::new(AtomicBool::new(false));
    let (app, done2) = (app.clone(), done.clone());
    std::thread::spawn(move || {
        // Keys still held from asking don't count: only a fresh press.
        let mut was = talk::keys().0;
        while !done2.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_millis(30));
            let (chord, other) = talk::keys();
            if chord && !was && !other {
                if shortcut::needs_mask(shortcut::Which::Talk) {
                    shortcut::mask();
                }
                STOPPED.store(true, Ordering::Relaxed);
                fade_out(&app);
                return;
            }
            was = chord;
        }
    });
    done
}

/// Asks, and says the answer sentence by sentence as it is written; returns
/// what was said, and whether the talk keys stopped him.
fn answer(app: &AppHandle, brain: &mut brain::Brain, question: &str, seen: Option<&sight::Shot>, hide_at: &mut Option<Instant>) -> (String, bool) {
    STOPPED.store(false, Ordering::Relaxed);
    // A new question: his windows from the last one go.
    if explain::is_open() {
        explain::close_all(app);
    }
    show(app, Some(VoiceView { phase: "thinking".into(), heard: question.to_string(), ..Default::default() }));
    let watching = watch_for_stop(app);
    let asked = Instant::now();
    let speech = Speech::start(app, question, asked);
    let mut splitter = stream::Splitter::default();
    // All he wrote, his window block included (window.rs).
    let mut written = String::new();
    let reply = brain.respond(app, question, seen, &mut |delta| {
        written.push_str(delta);
        if STOPPED.load(Ordering::Relaxed) {
            return;
        }
        for piece in splitter.push(delta) {
            speech.say(piece);
        }
    });
    if let Some(rest) = splitter.finish().filter(|_| !STOPPED.load(Ordering::Relaxed)) {
        speech.say(rest);
    }
    crate::log::line(format!("voice: answer written in {} ms", asked.elapsed().as_millis()));
    // His window draws while he says his short line.
    if let (false, (line, Some(w))) = (STOPPED.load(Ordering::Relaxed), window::split(&written)) {
        explain::show(app, question, &brain::spoken_text(&line), &w, seen, false);
    }
    let said = speech.finish();
    crate::last_answer::set(app, &said);
    watching.store(true, Ordering::Relaxed);
    if STOPPED.load(Ordering::Relaxed) {
        return (said, true);
    }
    if said.is_empty() {
        let done = reply.is_some_and(|r| r.acted);
        show(app, Some(VoiceView {
            phase: "speaking".into(),
            heard: question.to_string(),
            answer: if done { "✓".into() } else { crate::i18n::t("Coucou couldn't answer: check your Claude key in Notch → Chat.") },
            pace_ms: 0,
        }));
        *hide_at = Some(Instant::now() + Duration::from_secs(5));
    } else {
        *hide_at = Some(Instant::now() + reading_time(&said));
    }
    (said, false)
}

/// JARVIS: keeps a Claude Code ready when it is the one answering (no API key).
fn prewarm() {
    if !crate::secrets::present(crate::claude::KEY) && crate::claude_code::available() {
        warm::prewarm(brain::FAST_MODEL, &brain::claude_code_system());
    }
}

/// JARVIS: how long the answer stays once said: time to read it (about a third
/// of a second a word), at least 3 s, at most 14 s.
fn reading_time(text: &str) -> Duration {
    let words = crate::flow::text::word_count(text) as u64;
    Duration::from_millis((words * 320).clamp(3000, 14_000))
}

// ── JARVIS: speaking as the answer is written ──────────────────────────────────

/// One piece of the answer, ready to play.
struct Rendered {
    text: String,
    /// The audio (base64) and its type; None for the system voice.
    audio: Option<String>,
    mime: &'static str,
    /// How long it lasts (ms), measured for JARVIS's voice, estimated otherwise.
    ms: u64,
    /// Answers as text only: nothing to play.
    silent: bool,
}

/// The pieces of one answer: rendered on one thread, played in order on another,
/// so the next sentence is ready while this one is said.
struct Speech {
    tx: Option<mpsc::Sender<String>>,
    player: Option<std::thread::JoinHandle<String>>,
}

impl Speech {
    fn start(app: &AppHandle, heard: &str, asked: Instant) -> Self {
        let (output, gender, voice_name) = crate::flow::get(app)
            .map(|f| {
                let p = &f.store.lock().unwrap().prefs;
                // JARVIS: the voice name is the Gemini one when Gemini speaks.
                // (and with "+text" when Gemini's fallback is text only, not Piper).
                let name = if p.voice_output == "gemini" {
                    format!("{}{}", p.gemini_voice, if p.gemini_fallback == "text" { "+text" } else { "" })
                } else {
                    p.voice_name.clone()
                };
                (p.voice_output.clone(), p.voice_gender.clone(), name)
            })
            .unwrap_or_else(|| ("jarvis".into(), "male".into(), crate::tts::DEFAULT_VOICE.into()));
        let (tx, rx) = mpsc::channel::<String>();
        // JARVIS: every piece is fetched at once, on its own thread, as soon as it
        // is written; the player takes them in the order they were said. A cloud
        // voice then has the next sentence ready before the last one ends.
        let (ready_tx, ready) = mpsc::channel::<mpsc::Receiver<Rendered>>();
        let render_gender = gender.clone();
        std::thread::spawn(move || {
            if output == "gemini" {
                // Gemini's free tier allows only a few requests a minute: one at a
                // time — the first sentence alone so he starts soon, then all that
                // was written meanwhile in one request (mod gemini).
                while let Ok(mut piece) = rx.recv() {
                    while let Ok(more) = rx.try_recv() {
                        piece.push(' ');
                        piece.push_str(&more);
                    }
                    let (one_tx, one) = mpsc::channel();
                    if ready_tx.send(one).is_err() {
                        break;
                    }
                    let _ = one_tx.send(render(piece, &output, &voice_name, &render_gender));
                }
                return;
            }
            for piece in rx {
                let (one_tx, one) = mpsc::channel();
                if ready_tx.send(one).is_err() {
                    break;
                }
                let (output, voice_name, gender) = (output.clone(), voice_name.clone(), render_gender.clone());
                std::thread::spawn(move || {
                    let _ = one_tx.send(render(piece, &output, &voice_name, &gender));
                });
            }
        });
        let (app, heard) = (app.clone(), heard.to_string());
        let player = std::thread::spawn(move || {
            let mut said = String::new();
            for one in ready {
                let Ok(r) = one.recv() else { continue };
                // Stopped with the talk keys: nothing more is shown or said.
                if STOPPED.load(Ordering::Relaxed) {
                    continue;
                }
                if said.is_empty() {
                    crate::log::line(format!("voice: first words after {} ms", asked.elapsed().as_millis()));
                } else {
                    said.push(' ');
                }
                said.push_str(&r.text);
                let words = crate::flow::text::word_count(&r.text).max(1) as u64;
                show(&app, Some(VoiceView { phase: "speaking".into(), heard: heard.clone(), answer: said.clone(), pace_ms: r.ms / words }));
                if r.silent {
                    std::thread::sleep(Duration::from_millis(r.ms));
                } else {
                    say_one(&app, &r.text, r.audio, r.mime, gender.clone(), Duration::from_millis(r.ms + 2500));
                }
            }
            said
        });
        Self { tx: Some(tx), player: Some(player) }
    }

    fn say(&self, piece: String) {
        if let Some(tx) = &self.tx {
            let _ = tx.send(piece);
        }
    }

    /// Waits until everything is said; returns what was said.
    fn finish(mut self) -> String {
        drop(self.tx.take());
        self.player.take().and_then(|h| h.join().ok()).unwrap_or_default()
    }
}

/// A piece in the chosen voice: JARVIS's own (Kokoro), ElevenLabs, the
/// system's, or none. JARVIS's voice falls back to the system's if it fails.
fn render(text: String, output: &str, voice: &str, gender: &str) -> Rendered {
    let words = crate::flow::text::word_count(&text).max(1) as u64;
    let estimate = words * 380;
    match output {
        "off" => Rendered { text, audio: None, mime: "audio/mpeg", ms: words * 320, silent: true },
        "jarvis" if crate::tts::is_ready() => match crate::tts::speak(&text, voice, 1.0) {
            Some(wav) => {
                let ms = wav_ms(&wav).unwrap_or(estimate);
                Rendered { text, audio: Some(base64(&wav)), mime: "audio/wav", ms, silent: false }
            }
            None => Rendered { text, audio: None, mime: "audio/mpeg", ms: estimate, silent: false },
        },
        // JARVIS: Gemini's voice (Charon), with the user's AI Studio key.
        "gemini" => match gemini::speak(&text, gemini::voice(voice.trim_end_matches("+text"))) {
            Some(wav) => {
                let ms = wav_ms(&wav).unwrap_or(estimate);
                Rendered { text, audio: Some(base64(&wav)), mime: "audio/wav", ms, silent: false }
            }
            // No free model could: Piper, the offline backup, says it; without
            // Piper it's shown, not spoken — never the robotic system voice.
            None => match piper::speak(&text).filter(|_| !voice.ends_with("+text")) {
                Some(wav) => {
                    crate::log::line("voice: Piper spoke for Gemini");
                    let ms = wav_ms(&wav).unwrap_or(estimate);
                    Rendered { text, audio: Some(base64(&wav)), mime: "audio/wav", ms, silent: false }
                }
                None => Rendered { text, audio: None, mime: "audio/mpeg", ms: words * 320, silent: true },
            },
        },
        "elevenlabs" => {
            let audio = elevenlabs(&text, gender).map(|mp3| base64(&mp3));
            Rendered { text, audio, mime: "audio/mpeg", ms: estimate, silent: false }
        }
        _ => Rendered { text, audio: None, mime: "audio/mpeg", ms: estimate, silent: false },
    }
}

/// The length of a 16-bit mono WAV made by tts::wav (ms).
fn wav_ms(wav: &[u8]) -> Option<u64> {
    let rate = u32::from_le_bytes(wav.get(24..28)?.try_into().ok()?) as u64;
    let data = wav.len().checked_sub(44)? as u64;
    (rate > 0).then(|| data / 2 * 1000 / rate)
}

// ── Speaking ──────────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Say {
    id: u64,
    text: String,
    lang: Option<&'static str>,
    /// ElevenLabs' MP3 or JARVIS's own voice (Kokoro, WAV), base64.
    audio: Option<String>,
    /// The audio's type: "audio/mpeg" or "audio/wav".
    mime: &'static str,
    gender: String,
}

/// Says one piece through the pill and returns once it is said (or after a sensible time).
fn say_one(app: &AppHandle, text: &str, audio: Option<String>, mime: &'static str, gender: String, longest: Duration) {
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = mpsc::channel();
    pending().lock().unwrap().insert(id, tx);
    let _ = app.emit_to(pill::LABEL, "voice-say", Say { id, text: text.into(), lang: wake::speech_lang(text), audio, mime, gender });
    let _ = rx.recv_timeout(longest);
    pending().lock().unwrap().remove(&id);
}

/// The pill says it has finished speaking (`id`), or the island answers a question.
#[tauri::command]
pub fn voice_done(id: u64, text: Option<String>) {
    if let Some(tx) = pending().lock().unwrap().remove(&id) {
        let _ = tx.send(text.unwrap_or_default());
    }
}

/// Where the webview has no voice (WebKitGTK often): speech-dispatcher or
/// espeak-ng, when installed.
#[tauri::command]
pub async fn voice_say_native(text: String, lang: Option<String>) -> bool {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "linux")]
        {
            let lang = lang.unwrap_or_default();
            let short = lang.split('-').next().unwrap_or("").to_string();
            if let Some(spd) = crate::platform::find_on_path("spd-say") {
                let mut cmd = std::process::Command::new(spd);
                cmd.arg("-w");
                if !short.is_empty() {
                    cmd.args(["-l", &short]);
                }
                return cmd.arg(&text).status().is_ok_and(|s| s.success());
            }
            if let Some(espeak) = crate::platform::find_on_path("espeak-ng") {
                let mut cmd = std::process::Command::new(espeak);
                if !short.is_empty() {
                    cmd.args(["-v", &short]);
                }
                return cmd.arg(&text).status().is_ok_and(|s| s.success());
            }
            false
        }
        #[cfg(windows)]
        {
            let _ = (text, lang);
            false
        }
    })
    .await
    .unwrap_or(false)
}

/// ElevenLabs' MP3 for `text`, with the user's key; None and the system voice speaks.
fn elevenlabs(text: &str, gender: &str) -> Option<Vec<u8>> {
    let key = crate::secrets::get("elevenlabs-api-key")?;
    tauri::async_runtime::block_on(async {
        let client = reqwest::Client::builder().timeout(Duration::from_secs(10)).build().ok()?;
        let voices: Value = client.get("https://api.elevenlabs.io/v1/voices").header("xi-api-key", &key).send().await.ok()?.json().await.ok()?;
        let voice = pick_voice(voices["voices"].as_array()?, gender)?;
        let response = client
            .post(format!("https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_128"))
            .header("xi-api-key", &key)
            .header("accept", "audio/mpeg")
            .json(&json!({ "text": text, "model_id": "eleven_flash_v2_5" }))
            .send()
            .await
            .ok()?;
        if !response.status().is_success() {
            crate::log::line(format!("voice: ElevenLabs {}", response.status()));
            return None;
        }
        Some(response.bytes().await.ok()?.to_vec())
    })
}

/// First English voice of the gender (a young one first for a man); else any
/// voice of the gender; else the first one. Same choice as the Mac.
pub fn pick_voice(voices: &[Value], gender: &str) -> Option<String> {
    let label = |v: &Value, k: &str| v["labels"][k].as_str().unwrap_or("").to_lowercase();
    let english = |v: &Value| {
        let lang = label(v, "language");
        if !lang.is_empty() {
            return lang.starts_with("en");
        }
        let accent = label(v, "accent");
        accent.is_empty() || ["american", "british", "australian", "irish", "english", "us", "uk"].iter().any(|a| accent.contains(a))
    };
    let of_gender: Vec<&Value> = voices.iter().filter(|v| label(v, "gender") == gender).collect();
    let english_ones: Vec<&&Value> = of_gender.iter().filter(|v| english(v)).collect();
    let young = if gender == "male" { english_ones.iter().find(|v| label(v, "age").contains("young")).copied() } else { None };
    let v = young.or_else(|| english_ones.first().copied()).copied().or_else(|| of_gender.first().copied()).or_else(|| voices.first())?;
    v["voice_id"].as_str().map(String::from)
}

fn base64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (b[0] as u32) << 16 | (b[1] as u32) << 8 | b[2] as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

// ── The tools ─────────────────────────────────────────────────────────────────

/// Asks the island (it knows the pills and the services' data) and waits for its answer.
pub fn ask_island(app: &AppHandle, kind: &str, input: Value) -> Option<String> {
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = mpsc::channel();
    pending().lock().unwrap().insert(id, tx);
    let _ = app.emit_to(crate::island::WINDOW_LABEL, "voice-ask", json!({ "id": id, "kind": kind, "input": input }));
    let answer = rx.recv_timeout(Duration::from_secs(5)).ok();
    pending().lock().unwrap().remove(&id);
    answer
}

/// Runs one of Claude's tools: what goes back to Claude, and whether something changed.
pub fn run_tool(app: &AppHandle, name: &str, input: &Value) -> (String, bool) {
    match name {
        "pills" => {
            let answer = ask_island(app, "pills", input.clone()).unwrap_or_else(|| "the island did not answer".into());
            let acted = input["action"].as_str() != Some("list") && !answer.contains("unknown");
            (answer, acted)
        }
        "service_info" => (ask_island(app, "info", json!({})).unwrap_or_else(|| "no data".into()), false),
        "music" => music(app, input),
        "open_app" => open_app(input["name"].as_str().unwrap_or("")),
        "prepare_email" => {
            let to = input["recipient"].as_str().unwrap_or("").trim().to_string();
            if !to.contains('@') {
                return ("No email address: ask the user to spell it.".into(), false);
            }
            let enc = |s: &str| -> String {
                s.bytes()
                    .map(|b| match b {
                        b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
                        _ => format!("%{b:02X}"),
                    })
                    .collect()
            };
            let url = format!(
                "mailto:{}?subject={}&body={}",
                enc(&to).replace("%40", "@"),
                enc(input["subject"].as_str().unwrap_or("")),
                enc(input["body"].as_str().unwrap_or(""))
            );
            crate::platform::open_url(&url);
            (format!("The mail app opened with the email to {to}. Nothing is sent until the user sends it."), true)
        }
        _ => (format!("unknown tool {name}"), false),
    }
}

fn music(app: &AppHandle, input: &Value) -> (String, bool) {
    let action = input["action"].as_str().unwrap_or("");
    let (control, value) = match action {
        "play_pause" => ("playPause", None),
        "next" => ("next", None),
        "previous" => ("previous", None),
        "set_volume" => ("volume", Some(input["volume"].as_f64().unwrap_or(50.0).clamp(0.0, 100.0))),
        "search" => {
            let q = input["query"].as_str().unwrap_or("").trim();
            if q.is_empty() {
                return ("missing query".into(), false);
            }
            let encoded: String = q.chars().map(|c| if c.is_alphanumeric() { c.to_string() } else { "%20".into() }).collect();
            crate::platform::open_url(&format!("spotify:search:{encoded}"));
            return (format!("Spotify opened on a search for {q}: the user picks what to play."), true);
        }
        _ => return ("unknown action".into(), false),
    };
    let app2 = app.clone();
    let done = tauri::async_runtime::block_on(crate::spotify::spotify_control(app2, control.into(), value));
    if done {
        ("done".into(), true)
    } else {
        ("Spotify is not running or not playing: tell the user to open it.".into(), false)
    }
}

/// Opens an app whose name matches: a Start menu shortcut on Windows, a
/// .desktop entry on Linux. Nothing else is ever run.
fn open_app(name: &str) -> (String, bool) {
    let wanted = wake::normalize(name);
    if wanted.is_empty() {
        return ("no name".into(), false);
    }
    match find_app(&wanted) {
        Some((label, launch)) => {
            launch();
            (format!("{label} opened"), true)
        }
        None => (format!("No app named {name} on this computer."), false),
    }
}

#[cfg(windows)]
fn find_app(wanted: &str) -> Option<(String, Box<dyn FnOnce()>)> {
    let mut roots = Vec::new();
    if let Some(p) = std::env::var_os("APPDATA") {
        roots.push(std::path::PathBuf::from(p).join("Microsoft\\Windows\\Start Menu\\Programs"));
    }
    if let Some(p) = std::env::var_os("ProgramData") {
        roots.push(std::path::PathBuf::from(p).join("Microsoft\\Windows\\Start Menu\\Programs"));
    }
    let mut best: Option<(usize, std::path::PathBuf)> = None;
    let mut stack = roots;
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for e in entries.flatten() {
            let path = e.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().is_some_and(|x| x.eq_ignore_ascii_case("lnk")) {
                let stem = wake::normalize(&path.file_stem().unwrap_or_default().to_string_lossy());
                let score = if stem == wanted { 0 } else if stem.starts_with(wanted) { 1 } else if stem.contains(wanted) { 2 } else { continue };
                if best.as_ref().is_none_or(|(s, p)| score < *s || (score == *s && path.as_os_str().len() < p.as_os_str().len())) {
                    best = Some((score, path));
                }
            }
        }
    }
    let (_, path) = best?;
    let label = path.file_stem()?.to_string_lossy().to_string();
    Some((label, Box::new(move || crate::platform::reveal_folder(&path.to_string_lossy()))))
}

#[cfg(target_os = "linux")]
fn find_app(wanted: &str) -> Option<(String, Box<dyn FnOnce()>)> {
    let mut dirs = vec![std::path::PathBuf::from("/usr/share/applications"), std::path::PathBuf::from("/var/lib/flatpak/exports/share/applications")];
    dirs.push(crate::platform::home_dir().join(".local/share/applications"));
    dirs.push(crate::platform::home_dir().join(".local/share/flatpak/exports/share/applications"));
    let mut best: Option<(usize, String, String)> = None;
    for dir in dirs {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for e in entries.flatten() {
            let path = e.path();
            if path.extension().is_none_or(|x| x != "desktop") {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(&path) else { continue };
            if text.lines().any(|l| l.trim() == "NoDisplay=true") {
                continue;
            }
            let Some(app_name) = text.lines().find_map(|l| l.strip_prefix("Name=")).map(str::trim) else { continue };
            let n = wake::normalize(app_name);
            let score = if n == wanted { 0 } else if n.starts_with(wanted) { 1 } else if n.contains(wanted) { 2 } else { continue };
            let id = path.file_stem().unwrap_or_default().to_string_lossy().to_string();
            if best.as_ref().is_none_or(|(s, _, _)| score < *s) {
                best = Some((score, app_name.to_string(), id));
            }
        }
    }
    let (_, label, id) = best?;
    Some((label, Box::new(move || {
        let mut cmd = std::process::Command::new("gtk-launch");
        cmd.arg(&id);
        let _ = crate::platform::no_console(&mut cmd).spawn();
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_quiet_voice_counts_against_the_rooms_own_noise() {
        // This microphone: a room at about 0.001, speech peaking around 0.005.
        assert!(is_voice(0.0025, 0.001), "a soft word");
        assert!(!is_voice(0.0015, 0.001), "the room itself");
        assert!(!is_voice(0.001, 0.0), "never below the low bar");
        // A noisy room needs a clearer voice.
        assert!(!is_voice(0.006, 0.004));
    }

    #[test]
    fn base64_matches_the_standard() {
        assert_eq!(base64(b"Man"), "TWFu");
        assert_eq!(base64(b"Ma"), "TWE=");
        assert_eq!(base64(b"M"), "TQ==");
        assert_eq!(base64(b""), "");
    }

    #[test]
    fn the_voice_is_picked_like_on_the_mac() {
        let voices: Vec<Value> = serde_json::from_str(r#"[
            {"voice_id":"a","labels":{"gender":"male","accent":"american","age":"middle aged"}},
            {"voice_id":"b","labels":{"gender":"male","accent":"british","age":"young"}},
            {"voice_id":"c","labels":{"gender":"female","accent":"american"}},
            {"voice_id":"d","labels":{"gender":"female","language":"fr"}}
        ]"#).unwrap();
        assert_eq!(pick_voice(&voices, "male").as_deref(), Some("b"));
        assert_eq!(pick_voice(&voices, "female").as_deref(), Some("c"));
        assert_eq!(pick_voice(&[], "female"), None);
    }
}

/// With the models downloaded: `COUCOU_TEST_WAKE_WAV=… cargo test -- --ignored wake_in`.
#[cfg(test)]
mod with_models {
    #[test]
    #[ignore]
    fn hears_the_wake_phrase_in_a_recording() {
        let path = std::env::var("COUCOU_TEST_WAKE_WAV").expect("COUCOU_TEST_WAKE_WAV");
        let bytes = std::fs::read(&path).unwrap();
        let rate = u32::from_le_bytes([bytes[24], bytes[25], bytes[26], bytes[27]]);
        let pcm: Vec<f32> = bytes[44..].chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0).collect();
        let mut r = crate::speech::audio::Resampler::new(rate);
        let mut samples = Vec::new();
        r.process(&pcm, &mut samples);
        let mut vad = super::wake::Vad::default();
        let mut heard = Vec::new();
        for chunk in samples.chunks(1600) {
            for segment in vad.feed(chunk) {
                let text = crate::speech::transcribe(&segment).expect("models").text;
                println!("segment {:.2} s: {text}", segment.len() as f32 / 16_000.0);
                heard.push(super::wake::after_wake(&text));
            }
        }
        println!("{heard:?}");
        assert!(heard.iter().any(|h| h.as_deref().is_some_and(|q| !q.is_empty())));
    }
}
