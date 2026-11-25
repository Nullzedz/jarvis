// JARVIS: Claude plan usage without a terminal.
//
// Claude Code reports the plan's limits in its stream-json output on every
// reply (`rate_limit_event`: the 5-hour and 7-day windows, used as a fraction,
// reset as epoch seconds). Two ways in, both through Claude Code itself, with
// its own sign-in — JARVIS reads no credential and calls no API of its own:
// - passively, from the Claude Code JARVIS already keeps warm (voice/warm.rs):
//   every reply carries fresh numbers, sent to the island as `claude-plan`;
// - on request (`read`), when the plan card shows numbers over 10 minutes old:
//   one tiny question ("Say ok.", Haiku, no tools) — a sliver of the plan.
// Both hand the island the status line's own shape (`rate_limits`), so
// core/plan.ts parses them like the terminal's numbers.

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, OnceLock};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

/// The longest a refresh may take.
const TIMEOUT: Duration = Duration::from_secs(45);
/// The cheapest model: the question only exists for the numbers that come with the answer.
const MODEL: &str = "claude-haiku-4-5";

static APP: OnceLock<AppHandle> = OnceLock::new();
static BUSY: AtomicBool = AtomicBool::new(false);

pub fn init(app: &AppHandle) {
    let _ = APP.set(app.clone());
}

/// A `rate_limit_event` line as the status line's `rate_limits`
/// (`{five_hour: {used_percentage, resets_at}, seven_day: …}`); None for any other line.
pub fn from_event(v: &Value) -> Option<Value> {
    if v["type"] != "rate_limit_event" {
        return None;
    }
    let info = &v["rate_limit_info"];
    let mut out = serde_json::Map::new();
    for key in ["five_hour", "seven_day"] {
        let w = &info["unifiedWindows"][key];
        let mut util = w["utilization"].as_f64();
        let mut resets = w["resetsAt"].as_f64();
        // Older versions only describe the window that is closest to its limit.
        if util.is_none() && info["rateLimitType"] == key {
            util = info["utilization"].as_f64();
            resets = info["resetsAt"].as_f64();
        }
        if let (Some(u), Some(r)) = (util, resets) {
            out.insert(key.into(), json!({ "used_percentage": u * 100.0, "resets_at": r }));
        }
    }
    (!out.is_empty()).then(|| Value::Object(out))
}

/// A line of JARVIS's own Claude Code output: its limits, if any, go to the island.
pub fn note(v: &Value) {
    if let (Some(limits), Some(app)) = (from_event(v), APP.get()) {
        let _ = app.emit("claude-plan", limits);
    }
}

/// Asks Claude Code one tiny question for the numbers that come with its answer.
/// None when Claude Code is missing, busy with another refresh, or says nothing.
pub fn read() -> Option<Value> {
    if BUSY.swap(true, Ordering::SeqCst) {
        return None;
    }
    let out = ask();
    BUSY.store(false, Ordering::SeqCst);
    if let Some(limits) = &out {
        crate::log::line(format!("claude plan: refreshed ({limits})"));
    }
    out
}

fn args() -> Vec<&'static str> {
    vec![
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--model",
        MODEL,
        "--tools",
        "",
        "--setting-sources",
        "",
        "--strict-mcp-config",
        "--no-session-persistence",
        "--disable-slash-commands",
    ]
}

fn ask() -> Option<Value> {
    let exe = crate::claude_code::exe()?;
    let workdir = crate::settings::local_dir().join("relay");
    std::fs::create_dir_all(&workdir).ok()?;
    let mut cmd = Command::new(&exe);
    cmd.args(args())
        .current_dir(&workdir)
        .env_remove("CLAUDECODE")
        .env("MAX_THINKING_TOKENS", "0")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
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
    let mut child = cmd.spawn().ok()?;
    let question = json!({ "type": "user", "message": { "role": "user", "content": [{ "type": "text", "text": "Say ok." }] } });
    if let Some(mut stdin) = child.stdin.take() {
        let _ = writeln!(stdin, "{question}");
        // Closed: one question, then Claude Code ends.
    }
    let stdout = child.stdout.take()?;
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut found = None;
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
            if let Some(limits) = from_event(&v) {
                found = Some(limits);
            }
            if v["type"] == "result" {
                break;
            }
        }
        let _ = tx.send(found);
    });
    let out = rx.recv_timeout(TIMEOUT).ok().flatten();
    let _ = child.kill();
    let _ = child.wait();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_rate_limit_event_becomes_the_status_lines_rate_limits() {
        let v = json!({
            "type": "rate_limit_event",
            "rate_limit_info": {
                "rateLimitType": "five_hour", "utilization": 0.95, "resetsAt": 1795075800,
                "unifiedWindows": {
                    "five_hour": { "utilization": 0.95, "resetsAt": 1795075800 },
                    "seven_day": { "utilization": 0.37, "resetsAt": 1795215600 }
                }
            }
        });
        let rl = from_event(&v).expect("limits");
        assert!((rl["five_hour"]["used_percentage"].as_f64().unwrap() - 95.0).abs() < 1e-9);
        assert_eq!(rl["five_hour"]["resets_at"], 1795075800.0);
        assert!((rl["seven_day"]["used_percentage"].as_f64().unwrap() - 37.0).abs() < 1e-9);
    }

    #[test]
    fn an_older_event_with_only_the_closest_window_still_counts() {
        let v = json!({ "type": "rate_limit_event", "rate_limit_info": { "rateLimitType": "seven_day", "utilization": 0.5, "resetsAt": 1795215600 } });
        let rl = from_event(&v).expect("limits");
        assert!(rl.get("five_hour").is_none());
        assert!((rl["seven_day"]["used_percentage"].as_f64().unwrap() - 50.0).abs() < 1e-9);
    }

    #[test]
    fn other_lines_carry_nothing() {
        assert!(from_event(&json!({ "type": "result" })).is_none());
        assert!(from_event(&json!({ "type": "rate_limit_event", "rate_limit_info": {} })).is_none());
    }

    #[test]
    fn the_refresh_asks_without_tools_settings_or_saved_session() {
        let a = args();
        let at = |flag: &str| a.iter().position(|x| *x == flag).expect(flag);
        assert_eq!(a[at("--tools") + 1], "");
        assert_eq!(a[at("--setting-sources") + 1], "");
        assert_eq!(a[at("--model") + 1], MODEL);
        assert!(a.contains(&"--no-session-persistence"));
    }
}
