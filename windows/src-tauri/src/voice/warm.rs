// JARVIS: a Claude Code kept running for « Hey JARVIS », so a question doesn't
// wait for one to start (about 3 s on Windows) and its words arrive as they are
// written (stream-json in and out). Thinking is off: a spoken answer is one or
// two sentences and thinking first cost 1–10 s.
//
// Kept apart from the user's sessions like claude_code.rs: no settings file (so
// no hooks), no MCP server, no slash command, nothing saved to resume, in
// Coucou's own empty folder. Its only tool is web search.
//
// The conversation lives in the process: after FORGET_AFTER without a question
// it is replaced by a fresh one (started straight away, so it is warm again
// before the next « Hey JARVIS »).

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

/// After this long without a question, the next one starts a new conversation.
pub const FORGET_AFTER: Duration = Duration::from_secs(90);
/// The longest an answer may take (a web search included).
const ANSWER_TIMEOUT: Duration = Duration::from_secs(60);

struct Warm {
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<Value>,
    model: String,
    system: String,
    /// When it last answered; None while it has never been asked.
    used: Option<Instant>,
}

impl Drop for Warm {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn slot() -> &'static Mutex<Option<Warm>> {
    static S: OnceLock<Mutex<Option<Warm>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(None))
}

fn args(model: &str, system: &str) -> Vec<String> {
    let out: Vec<String> = [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--model",
        model,
        "--system-prompt",
        system,
        "--tools",
        "WebSearch",
        "--allowedTools",
        "WebSearch",
        "--setting-sources",
        "",
        "--strict-mcp-config",
        "--no-session-persistence",
        "--disable-slash-commands",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    out
}

fn spawn(model: &str, system: &str) -> Result<Warm, String> {
    let exe = crate::claude_code::exe().ok_or_else(|| crate::i18n::t("Claude Code is not installed."))?;
    let workdir = crate::settings::local_dir().join("relay");
    std::fs::create_dir_all(&workdir).map_err(|e| e.to_string())?;
    let mut cmd = Command::new(&exe);
    cmd.args(args(model, system))
        .current_dir(&workdir)
        .env_remove("CLAUDECODE")
        .env("MAX_THINKING_TOKENS", "0")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    // An npm install is a `#!/usr/bin/env node` script: its own folder first on PATH.
    if let Some(dir) = exe.parent() {
        let mut dirs = vec![dir.to_path_buf()];
        if let Some(path) = std::env::var_os("PATH") {
            dirs.extend(std::env::split_paths(&path));
        }
        if let Ok(joined) = std::env::join_paths(dirs) {
            cmd.env("PATH", joined);
        }
    }
    crate::platform::no_console(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let stdin = child.stdin.take().ok_or("no stdin")?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let (tx, lines) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if let Ok(v) = serde_json::from_str::<Value>(&line) {
                // Every reply carries the plan's limits: the island's plan card gets them.
                crate::claude_plan::note(&v);
                if tx.send(v).is_err() {
                    break;
                }
            }
        }
    });
    Ok(Warm { child, stdin, lines, model: model.into(), system: system.into(), used: None })
}

/// Usable as it is: same model and prompt, still running, not forgotten.
fn fits(w: &mut Warm, model: &str, system: &str) -> bool {
    w.model == model
        && w.system == system
        && matches!(w.child.try_wait(), Ok(None))
        && w.used.is_none_or(|t| t.elapsed() < FORGET_AFTER)
}

/// Starts one now for the next question, unless a fitting one is waiting.
pub fn prewarm(model: &str, system: &str) {
    let (model, system) = (model.to_string(), system.to_string());
    std::thread::spawn(move || {
        let mut guard = slot().lock().unwrap();
        if guard.as_mut().is_some_and(|w| fits(w, &model, &system)) {
            return;
        }
        *guard = None;
        match spawn(&model, &system) {
            Ok(w) => *guard = Some(w),
            Err(err) => crate::log::line(format!("voice: could not start Claude Code: {err}")),
        }
    });
}

/// Lets it go (« Hey JARVIS » turned off).
pub fn shutdown() {
    *slot().lock().unwrap() = None;
}

/// Asks `question`; `on_text` gets the answer's words as they are written.
/// Returns the whole answer.
/// `content` is the message's blocks: the question, and a picture of the screen before it when there is one.
pub fn ask(model: &str, system: &str, content: Value, on_text: &mut dyn FnMut(&str)) -> Result<String, String> {
    let mut guard = slot().lock().unwrap();
    if !guard.as_mut().is_some_and(|w| fits(w, model, system)) {
        *guard = None;
        crate::log::line("voice: Claude Code was not warm, starting it");
        *guard = Some(spawn(model, system)?);
    }
    let w = guard.as_mut().unwrap();
    while w.lines.try_recv().is_ok() {}
    let message = json!({ "type": "user", "message": { "role": "user", "content": content } });
    let sent = writeln!(w.stdin, "{message}").and_then(|_| w.stdin.flush());
    if let Err(err) = sent {
        *guard = None;
        return Err(err.to_string());
    }
    let started = Instant::now();
    let mut text = String::new();
    // Text of the turn being written; a turn that ends in a tool call is not the answer.
    let mut turn = String::new();
    loop {
        let left = ANSWER_TIMEOUT.saturating_sub(started.elapsed());
        let line = match w.lines.recv_timeout(left) {
            Ok(v) => v,
            Err(RecvTimeoutError::Timeout) => {
                *guard = None;
                return Err(crate::i18n::t("Claude Code took too long to answer."));
            }
            Err(RecvTimeoutError::Disconnected) => {
                *guard = None;
                return Err(crate::i18n::t("Claude Code gave no answer."));
            }
        };
        match line["type"].as_str() {
            Some("stream_event") => {
                let event = &line["event"];
                match event["type"].as_str() {
                    Some("message_start") => turn.clear(),
                    Some("content_block_delta") if event["delta"]["type"] == "text_delta" => {
                        if let Some(delta) = event["delta"]["text"].as_str() {
                            // A later turn (after a web search) goes on from what was said.
                            if turn.is_empty() && !text.is_empty() && !delta.starts_with(char::is_whitespace) {
                                on_text(" ");
                                text.push(' ');
                            }
                            turn.push_str(delta);
                            text.push_str(delta);
                            on_text(delta);
                        }
                    }
                    _ => {}
                }
            }
            Some("result") => {
                w.used = Some(Instant::now());
                if line["is_error"].as_bool().unwrap_or(false) {
                    let why = line["result"].as_str().unwrap_or("").trim().to_string();
                    *guard = None;
                    return Err(if why.is_empty() { crate::i18n::t("Claude Code could not answer.") } else { why });
                }
                if text.trim().is_empty() {
                    let result = line["result"].as_str().unwrap_or("").trim().to_string();
                    if result.is_empty() {
                        return Err(crate::i18n::t("No response text."));
                    }
                    on_text(&result);
                    text = result;
                }
                return Ok(text);
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runs_apart_from_the_users_sessions_with_thinking_left_to_the_env() {
        let a = args("claude-haiku-4-5", "Be brief.");
        let at = |flag: &str| a.iter().position(|x| x == flag).expect(flag);
        assert_eq!(a[at("--setting-sources") + 1], "");
        assert_eq!(a[at("--tools") + 1], "WebSearch");
        assert_eq!(a[at("--input-format") + 1], "stream-json");
        assert!(a.contains(&"--no-session-persistence".to_string()));
        assert!(a.contains(&"--include-partial-messages".to_string()));
    }

    /// Times a real answer from the user's Claude Code, warm and streamed:
    /// `cargo test --lib warm_answer -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn warm_answer_timing() {
        let system = "You are JARVIS, a British butler. One or two short sentences.";
        prewarm("claude-haiku-4-5", system);
        std::thread::sleep(Duration::from_secs(6));
        for q in ["What is a good name for a cat?", "And the capital of Belgium?"] {
            let started = Instant::now();
            let mut first = None;
            let answer = ask("claude-haiku-4-5", system, json!([{ "type": "text", "text": q }]), &mut |_| {
                first.get_or_insert(started.elapsed());
            })
            .expect("an answer");
            println!("first words {:?}, whole {:?}: {answer}", first.unwrap(), started.elapsed());
        }
        shutdown();
    }
}
