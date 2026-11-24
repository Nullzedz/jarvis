// « OK Coucou »'s brain: Claude with the user's key and Coucou's tools —
// pills, music, the user's own data, opening an app, preparing an email (the
// mail app opens with it filled in; the user sends it) and Anthropic's web
// search. The conversation lives in memory only and is forgotten 90 s after
// the last turn. Port of ClaudeVoiceBrain.swift.

use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

pub const FAST_MODEL: &str = "claude-haiku-4-5";
const FORGET_AFTER: Duration = Duration::from_secs(90);

pub struct Brain {
    messages: Vec<Value>,
    last: Instant,
}

impl Default for Brain {
    fn default() -> Self {
        Self { messages: Vec::new(), last: Instant::now() }
    }
}

pub struct Reply {
    pub acted: bool,
}

fn tools() -> Vec<Value> {
    vec![
        json!({
            "name": "pills",
            "description": "Add, remove, set as main or list the pills shown in the island at the top of the screen. At most 4 pills besides the main one: remove one first if needed.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["add", "remove", "set_main", "list"] },
                    "names": { "type": "array", "items": { "type": "string" }, "description": "Pill names as listed (e.g. Stripe, GitHub, Cursor). Empty for list." }
                },
                "required": ["action"]
            }
        }),
        json!({
            "name": "music",
            "description": "Control Spotify: play or pause, next, previous, set the volume, or search a song, an artist or a playlist in Spotify.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["play_pause", "next", "previous", "set_volume", "search"] },
                    "query": { "type": "string", "description": "What to search, for search." },
                    "volume": { "type": "integer", "description": "0-100 for set_volume." }
                },
                "required": ["action"]
            }
        }),
        json!({
            "name": "service_info",
            "description": "Read the user's real data that Coucou already has, as JSON: the active pills, the agent sessions (Claude Code, Codex…) and what they are doing, Claude or Codex plan usage, Spotify now playing, and the services' latest data (Stripe, GitHub, Vercel, Resend, n8n, Notion, Cal.com).",
            "input_schema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "open_app",
            "description": "Open an app on this computer by name (Firefox, VS Code, Notion, Spotify…).",
            "input_schema": { "type": "object", "properties": { "name": { "type": "string" } }, "required": ["name"] }
        }),
        json!({
            "name": "prepare_email",
            "description": "Open the user's mail app with an email filled in, for them to check and send (it is never sent automatically). The recipient must be an email address.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "recipient": { "type": "string", "description": "An email address." },
                    "subject": { "type": "string" },
                    "body": { "type": "string", "description": "The full email text, written for the user." }
                },
                "required": ["recipient", "subject", "body"]
            }
        }),
        json!({ "type": "web_search_20250305", "name": "web_search", "max_uses": 3 }),
    ]
}

fn system_prompt(pills: &str) -> String {
    let t = crate::platform::local_time();
    format!("{} It is {:04}-{:02}-{:02} {:02}:{:02}.\n{}\n{SIGHT}", persona(), t.year, t.month, t.day, t.hour, t.minute, instructions(pills))
}

fn persona() -> String {
    let os = if cfg!(windows) { "Windows" } else { "Linux" };
    format!(
        "You are JARVIS, the user's personal voice assistant living at the top of the screen of their {os} computer: \
formal, composed and courteous, like a refined British butler, quietly witty, never gushing. Address the user as \"sir\"."
    )
}

fn instructions(pills: &str) -> String {
    format!(
        "Everything you write is read aloud: answer in the language the user spoke, in one or two short sentences, \
no markdown, no lists, no emojis, no links.\n\
Act with the tools instead of describing: pills, music, service_info for the user's own data, open_app, \
prepare_email, and web_search for anything current (weather, news, scores, prices, facts you are not sure of). \
Never invent the user's data. Their reminders, notes and today's calendar come in brackets before \
each question: answer about them from there, never say you have no access to them.\n\
Email: gather the recipient's address, the subject and what to say (write the text yourself from what the user \
wants to say, in the language they used), asking for what is missing one short question at a time, then call \
prepare_email. The email is never sent by you: the user checks it in their mail app and sends it.\n\
When you need an answer from the user, end with one short question. Otherwise never end with a question.\n\
Pills: {pills}"
    )
}

/// JARVIS: what he's told about the pictures of the screen (sight.rs).
const SIGHT: &str = concat!(
    "Sometimes a picture of the user's screen comes with the question: it is what they are asking about. If they circled something, it is marked with a blue loop: that is what they mean. Answer about what you see, plainly and briefly; never describe the whole picture unless asked.
",
    include_str!("window_prompt.txt")
);

/// JARVIS: the prompt of the kept-warm Claude Code (warm.rs). It has no time in
/// it, so the same process serves every question: each question carries the time.
pub fn claude_code_system() -> String {
    format!(
        "{}\n{}\nHere you have no tools besides web search: answer in words only, and if you are asked to do something on the computer, say briefly that you can't from here, except the user's reminders, notes and calendar, which you handle with the island block below. After a web search, say which publication reported it, in words, as a person would (\"according to Reuters\", \"the Manila Bulletin reports\"); never add a Sources list, links or web addresses. Each message starts with the current date and time in brackets, for you to know: never repeat it in your answer. {}",
        persona(),
        instructions("(not available)"),
        SIGHT
    )
}

impl Brain {
    /// Answers `transcript`; `on_text` gets the answer's words as they come
    /// (all at once with the API, as they are written with Claude Code).
    pub fn respond(&mut self, app: &AppHandle, transcript: &str, sight: Option<&super::sight::Shot>, on_text: &mut dyn FnMut(&str)) -> Option<Reply> {
        if self.last.elapsed() > FORGET_AFTER {
            self.messages.clear();
        }
        self.last = Instant::now();
        // JARVIS #92: the island's reminders, notes and today's calendar, in front of the question.
        let with_island = format!("{}{transcript}", crate::pocket::context());
        let transcript = with_island.as_str();
        // JARVIS: no Claude key — your own Claude Code answers (words and web search, no tools).
        if !crate::secrets::present(crate::claude::KEY) {
            return self.respond_with_claude_code(transcript, sight, on_text);
        }
        match sight {
            Some(shot) => {
                // A new picture: the older ones aren't sent again (they'd only slow every answer).
                self.forget_pictures();
                self.messages.push(json!({ "role": "user", "content": with_picture(transcript, shot) }));
            }
            None => self.messages.push(json!({ "role": "user", "content": transcript })),
        }
        self.trim();
        let pills = super::ask_island(app, "pills", json!({ "action": "list" })).unwrap_or_default();
        let system = system_prompt(&pills);
        let tools = tools();
        let chat_model = app
            .try_state::<crate::Shared>()
            .map(|s| s.settings.lock().unwrap().model.clone())
            .unwrap_or_default();
        let mut acted = false;
        let mut spoken = String::new();
        for _ in 0..5 {
            let turn = tauri::async_runtime::block_on(async {
                match crate::claude::voice_turn(FAST_MODEL, &system, &self.messages, &tools).await {
                    Ok(v) => Ok(v),
                    Err(err) if !chat_model.is_empty() => {
                        crate::log::line(format!("voice: {err}; the chat's model instead"));
                        crate::claude::voice_turn(&chat_model, &system, &self.messages, &tools).await
                    }
                    Err(err) => Err(err),
                }
            });
            let turn = match turn {
                Ok(t) => t,
                Err(err) => {
                    crate::log::line(format!("voice: Claude turn failed: {err}"));
                    if self.messages.last().is_some_and(|m| m["role"] == "user" && !is_tool_results(m)) {
                        self.messages.pop();
                    }
                    return acted.then(|| Reply { acted });
                }
            };
            let content = turn["content"].as_array().cloned().unwrap_or_default();
            self.messages.push(json!({ "role": "assistant", "content": content.clone() }));
            let text: String = content.iter().filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).collect::<Vec<_>>().join(" ");
            if !text.trim().is_empty() {
                spoken = text;
            }
            let stop = turn["stop_reason"].as_str().unwrap_or("end_turn");
            if stop == "pause_turn" {
                continue;
            }
            let uses: Vec<&Value> = content.iter().filter(|b| b["type"] == "tool_use").collect();
            if stop != "tool_use" || uses.is_empty() {
                break;
            }
            let mut results = Vec::new();
            for u in uses {
                let (result, did) = super::run_tool(app, u["name"].as_str().unwrap_or(""), &u["input"]);
                acted |= did;
                results.push(json!({ "type": "tool_result", "tool_use_id": u["id"], "content": result }));
            }
            self.messages.push(json!({ "role": "user", "content": results }));
            spoken.clear();
        }
        self.repair();
        // Raw, as Claude Code's words are: whoever shows or says it cleans it, and
        // his window block (window.rs) must reach them whole (cleaning eats its [ ]).
        if !spoken_text(super::window::visible(&spoken)).is_empty() || super::window::starts_at(&spoken).is_some() {
            on_text(spoken.trim());
        }
        Some(Reply { acted })
    }

    /// JARVIS: the answer through the user's own Claude Code, kept running
    /// between questions (warm.rs) so its words come as they are written: web
    /// search allowed, nothing else — it cannot press pills or open apps, it
    /// answers. The conversation lives in that process.
    fn respond_with_claude_code(&mut self, transcript: &str, sight: Option<&super::sight::Shot>, on_text: &mut dyn FnMut(&str)) -> Option<Reply> {
        let t = crate::platform::local_time();
        let question = format!("[{:04}-{:02}-{:02} {:02}:{:02}] {transcript}", t.year, t.month, t.day, t.hour, t.minute);
        let content = match sight {
            Some(shot) => with_picture(&question, shot),
            None => json!([{ "type": "text", "text": question }]),
        };
        match super::warm::ask(FAST_MODEL, &claude_code_system(), content, on_text) {
            Ok(_) => Some(Reply { acted: false }),
            Err(err) => {
                crate::log::line(format!("voice: Claude Code failed: {err}"));
                None
            }
        }
    }

    /// Older pictures of the screen become a short note in the history.
    fn forget_pictures(&mut self) {
        for m in self.messages.iter_mut().filter(|m| m["role"] == "user") {
            if let Some(blocks) = m["content"].as_array_mut() {
                for b in blocks.iter_mut().filter(|b| b["type"] == "image") {
                    *b = json!({ "type": "text", "text": "[a picture of the screen was shown here]" });
                }
            }
        }
    }

    /// Keeps the last exchanges, never cutting between a tool call and its result.
    fn trim(&mut self) {
        if self.messages.len() <= 24 {
            return;
        }
        let mut cut = self.messages.len() - 24;
        while cut < self.messages.len() && !(self.messages[cut]["role"] == "user" && self.messages[cut]["content"].is_string()) {
            cut += 1;
        }
        self.messages.drain(..cut.min(self.messages.len() - 1));
    }

    /// The API refuses a history ending on a tool call with no result after it.
    fn repair(&mut self) {
        let Some(last) = self.messages.last() else { return };
        if last["role"] != "assistant" {
            return;
        }
        let calls = last["content"].as_array().is_some_and(|c| c.iter().any(|b| b["type"] == "tool_use"));
        if calls {
            self.messages.pop();
        }
    }
}

/// The question with the picture of the screen before it, and what the picture shows.
fn with_picture(question: &str, shot: &super::sight::Shot) -> Value {
    json!([
        { "type": "image", "source": { "type": "base64", "media_type": "image/jpeg", "data": shot.data } },
        { "type": "text", "text": format!("(The picture is {}, {}×{} pixels.) {question}", shot.what, shot.size.0, shot.size.1) }
    ])
}

fn is_tool_results(m: &Value) -> bool {
    m["content"].as_array().is_some_and(|c| c.iter().any(|b| b["type"] == "tool_result"))
}

/// What Claude wrote, ready to be said: citations and markdown left out.
pub fn spoken_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut skip = 0;
    for c in text.chars() {
        match c {
            '[' => skip += 1,
            ']' if skip > 0 => skip -= 1,
            '*' | '#' | '`' | '_' if skip == 0 => {}
            _ if skip == 0 => out.push(c),
            _ => {}
        }
    }
    // JARVIS: web addresses are never read out, nor the brackets left around them.
    let words: Vec<&str> = out
        .split_whitespace()
        .filter(|w| {
            let w = w.trim_matches(|c: char| "()<>.,;:".contains(c)).to_lowercase();
            !(w.starts_with("http") || w.starts_with("www.") || w.contains("://"))
        })
        .collect();
    words.join(" ").replace("( )", "").replace("()", "").split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn web_addresses_are_never_read_aloud() {
        assert_eq!(spoken_text("Headlines from Manila Bulletin (https://mb.com.ph/rss/articles) today."), "Headlines from Manila Bulletin today.");
        assert_eq!(spoken_text("See www.example.com for more."), "See for more.");
    }

    #[test]
    fn markdown_and_citations_are_not_read_aloud() {
        assert_eq!(spoken_text("**Done** — Stripe [1] is in the island."), "Done — Stripe is in the island.");
        assert_eq!(spoken_text("  Il fait  20 °C à Bordeaux. "), "Il fait 20 °C à Bordeaux.");
    }

    #[test]
    fn every_tool_has_a_schema() {
        for tool in tools() {
            assert!(tool["name"].is_string());
            assert!(tool.get("input_schema").is_some() || tool["type"] == "web_search_20250305");
        }
    }
}

#[cfg(test)]
mod real_answer {
    /// What his own Claude Code writes for a question about a picture (DRAW_TEST_PNG).
    #[test]
    #[ignore]
    fn raw_answer_with_a_picture() {
        let png = std::fs::read(std::env::var("DRAW_TEST_PNG").unwrap()).unwrap();
        let shot = super::super::sight::Shot { data: super::super::base64(&png), what: "the part you circled", size: (640, 360), screen: (0, 0, 640, 360) };
        let mut brain = super::Brain::default();
        for q in ["what is this, simply", "(A follow-up, typed in your window about \"what is this, simply\", where you said \"Orders link customers to products.\") what does PK mean?"] {
            let mut written = String::new();
            let r = brain.respond_with_claude_code(q, Some(&shot), &mut |d| written.push_str(d));
            eprintln!("---- {q}\nok={} RAW: {written:?}", r.is_some());
        }
    }
}
