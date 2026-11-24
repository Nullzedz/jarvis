// JARVIS: his window's picture, drawn by the model the user picked in Settings →
// Voice → Windows (issue #14). Haiku answers out loud at once and asks for a
// window (window.rs `idea`); this draws it with the full design guide
// (draw_guide.txt), by one of:
//   - Claude (Haiku, Sonnet, Opus): with the user's key, or else their Claude Code;
//   - ChatGPT: the Codex app's CLI, signed in with their ChatGPT plan;
//   - Gemini: the Gemini CLI, signed in with their Google account.
// The SVG comes as plain text (not squeezed into JSON) and is made safe where
// it's shown (src/explain/draw.ts).

use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use super::sight::Shot;

pub const DEFAULT: &str = "claude:claude-sonnet-5-5";
const GUIDE: &str = include_str!("draw_guide.txt");
const TIMEOUT: Duration = Duration::from_secs(150);

/// The Claude models offered as cards: id, name.
const CLAUDE: [(&str, &str); 3] = [(super::brain::FAST_MODEL, "Haiku"), ("claude-sonnet-5-5", "Sonnet"), ("claude-opus-5-5", "Opus")];

/// What to draw.
pub struct Job {
    pub question: String,
    pub said: String,
    pub idea: String,
    pub shot: Option<Shot>,
}

/// One model the settings offer.
#[derive(Serialize)]
pub struct Choice {
    /// "maker:model", as kept in the prefs.
    pub id: String,
    pub name: String,
    /// "claude", "chatgpt" or "gemini".
    pub maker: &'static str,
    /// Installed and signed in.
    pub ready: bool,
}

/// The model picked in the settings.
fn picked(app: &AppHandle) -> String {
    crate::flow::get(app)
        .map(|f| f.store.lock().unwrap().prefs.draw_model.clone())
        .filter(|m| m.contains(':'))
        .unwrap_or_else(|| DEFAULT.into())
}

/// Draws `job`. `tried`: forms not to use again (« Draw it differently »);
/// `fix`: what was wrong with the last one (its text overlapped).
pub fn draw(app: &AppHandle, job: &Job, tried: &[String], fix: Option<&str>) -> Result<Value, String> {
    let model = picked(app);
    let started = Instant::now();
    let (maker, name) = model.split_once(':').unwrap_or(("claude", ""));
    let ask = request(job, tried, fix);
    let reply = match maker {
        "chatgpt" => codex(name, &ask, job.shot.as_ref()),
        "gemini" => gemini(name, &ask, job.shot.as_ref()),
        _ => claude(if name.is_empty() { "claude-sonnet-5-5" } else { name }, &ask, job.shot.as_ref()),
    };
    crate::log::line(format!("draw: {model} answered in {} ms{}", started.elapsed().as_millis(), reply.as_ref().err().map(|e| format!(": {e}")).unwrap_or_default()));
    parse(&reply?).ok_or_else(|| "no drawing in the answer".into())
}

/// The question for the drawing model (the guide is its system prompt).
fn request(job: &Job, tried: &[String], fix: Option<&str>) -> String {
    let mut ask = String::new();
    if let Some(shot) = &job.shot {
        ask += &format!("The picture is {}, {}×{} pixels.\n", shot.what, shot.size.0, shot.size.1);
    }
    ask += &format!("The user asked: \"{}\"\nJARVIS answered: \"{}\"\nShow: {}\n", job.question, job.said, job.idea);
    if !tried.is_empty() {
        ask += &format!("It was already drawn as {}: draw it as a different form, the one that fits next best.\n", tried.join(", "));
    }
    if let Some(fix) = fix {
        ask += &format!("Your last drawing broke rule 6: {fix}. Draw it again in the same form, with more room so no text touches other text.\n");
    }
    ask + "Reply as the guide says: FORM, then the SVG or the JSON."
}

/// The reply: `FORM: x`, then an SVG (his own drawing) or a ready-made window's JSON.
pub fn parse(reply: &str) -> Option<Value> {
    let form = reply
        .lines()
        .find_map(|l| l.trim().trim_start_matches(['*', '#', ' ']).strip_prefix("FORM:"))
        .map(|f| f.trim().trim_matches(['*', '`', '"']).to_lowercase())
        .unwrap_or_default();
    // #88: "<SVG" counts too, and the drawing ends at its own "</svg>", not at the reply's last one.
    let lower = reply.to_ascii_lowercase();
    if let Some(a) = lower.find("<svg") {
        if let Some(b) = lower[a..].find("</svg>").map(|i| a + i) {
            let svg = &reply[a..b + "</svg>".len()];
            return Some(json!({ "kind": "drawing", "form": if form.is_empty() { "drawing".into() } else { form }, "svg": svg }));
        }
    }
    let (a, b) = (reply.find('{')?, reply.rfind('}')?);
    let w: Value = serde_json::from_str(reply.get(a..=b)?).ok()?;
    super::window::ready(&w).then_some(w)
}

fn claude(model: &str, ask: &str, shot: Option<&Shot>) -> Result<String, String> {
    let mut content = Vec::new();
    if let Some(shot) = shot {
        content.push(json!({ "type": "image", "source": { "type": "base64", "media_type": "image/jpeg", "data": shot.data } }));
    }
    content.push(json!({ "type": "text", "text": ask }));
    if crate::secrets::present(crate::claude::KEY) {
        return tauri::async_runtime::block_on(crate::claude::draw_turn(model, GUIDE, json!(content)));
    }
    super::warm::once(model, GUIDE, json!(content), TIMEOUT)
}

/// A folder of its own for one drawing, with the picture in it.
fn workdir(shot: Option<&Shot>) -> Result<(PathBuf, Option<PathBuf>), String> {
    let dir = crate::settings::local_dir().join("draw");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let picture = match shot {
        Some(s) => {
            let path = dir.join("picture.jpg");
            std::fs::write(&path, super::gemini::base64_decode(&s.data).ok_or("bad picture")?).map_err(|e| e.to_string())?;
            Some(path)
        }
        None => None,
    };
    Ok((dir, picture))
}

/// Runs `cmd` with `stdin`, at most TIMEOUT; its output.
fn run(mut cmd: Command, stdin: &str) -> Result<String, String> {
    crate::platform::no_console(&mut cmd);
    let mut child = cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|e| e.to_string())?;
    if let Some(mut input) = child.stdin.take() {
        let _ = input.write_all(stdin.as_bytes());
    }
    let out = child.stdout.take();
    let reader = std::thread::spawn(move || {
        let mut s = String::new();
        if let Some(mut o) = out {
            let _ = std::io::Read::read_to_string(&mut o, &mut s);
        }
        s
    });
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let text = reader.join().unwrap_or_default();
                return if status.success() { Ok(text) } else { Err(format!("exited with {status}")) };
            }
            Ok(None) if started.elapsed() > TIMEOUT => {
                let _ = child.kill();
                return Err("took too long".into());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(100)),
            Err(e) => return Err(e.to_string()),
        }
    }
}

/// The Codex CLI: on PATH, or the one the Codex app keeps (newest first).
fn codex_exe() -> Option<PathBuf> {
    if let Some(p) = crate::platform::cli_candidates("codex").into_iter().next() {
        return Some(p);
    }
    let bin = PathBuf::from(std::env::var_os("LOCALAPPDATA")?).join("OpenAI").join("Codex").join("bin");
    let mut found: Vec<(std::time::SystemTime, PathBuf)> = std::fs::read_dir(bin)
        .ok()?
        .flatten()
        .map(|e| e.path().join("codex.exe"))
        .filter(|p| p.is_file())
        .map(|p| (p.metadata().and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH), p))
        .collect();
    found.sort();
    found.pop().map(|(_, p)| p)
}

fn home() -> PathBuf {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from).unwrap_or_default()
}

fn codex(model: &str, ask: &str, shot: Option<&Shot>) -> Result<String, String> {
    let exe = codex_exe().ok_or("the Codex app is not installed")?;
    let (dir, picture) = workdir(shot)?;
    let answer = dir.join("answer.txt");
    let mut cmd = Command::new(exe);
    cmd.current_dir(&dir).args(["exec", "--skip-git-repo-check", "--ephemeral", "-s", "read-only", "-c", "model_reasoning_effort=\"low\""]);
    if !model.is_empty() {
        cmd.args(["-m", model]);
    }
    if let Some(p) = &picture {
        cmd.arg("-i").arg(p);
    }
    cmd.arg("-o").arg(&answer).arg("-");
    run(cmd, &format!("{GUIDE}\n\n{ask}"))?;
    std::fs::read_to_string(&answer).map_err(|_| "Codex gave no answer".to_string())
}

fn gemini(model: &str, ask: &str, shot: Option<&Shot>) -> Result<String, String> {
    let exe = crate::platform::cli_candidates("gemini").into_iter().next().ok_or("the Gemini CLI is not installed")?;
    let (dir, picture) = workdir(shot)?;
    let mut cmd = Command::new(exe);
    cmd.current_dir(&dir);
    if !model.is_empty() {
        cmd.args(["-m", model]);
    }
    // The picture is read in with @, from its own folder; the guide and the question come on stdin.
    let prompt = if picture.is_some() { "@picture.jpg Draw it as the instructions above say." } else { "Draw it as the instructions above say." };
    cmd.args(["-p", prompt]);
    run(cmd, &format!("{GUIDE}\n\n{ask}"))
}

/// The models offered in the settings: the Claude three, then what the Codex
/// app lists (signed in), then Gemini (its default model).
pub fn choices() -> Vec<Choice> {
    let claude_ready = crate::secrets::present(crate::claude::KEY) || crate::claude_code::available();
    let mut out: Vec<Choice> = CLAUDE.iter().map(|(id, name)| Choice { id: format!("claude:{id}"), name: (*name).into(), maker: "claude", ready: claude_ready }).collect();
    let codex_ready = codex_exe().is_some() && home().join(".codex").join("auth.json").is_file();
    let listed = codex_models();
    if listed.is_empty() {
        out.push(Choice { id: "chatgpt:".into(), name: "ChatGPT".into(), maker: "chatgpt", ready: codex_ready });
    }
    out.extend(listed.into_iter().map(|(id, name)| Choice { id: format!("chatgpt:{id}"), name, maker: "chatgpt", ready: codex_ready }));
    let gemini_ready = !crate::platform::cli_candidates("gemini").is_empty() && home().join(".gemini").join("oauth_creds.json").is_file();
    out.push(Choice { id: "gemini:".into(), name: "Gemini".into(), maker: "gemini", ready: gemini_ready });
    out
}

/// The models the Codex app lists that take pictures: slug, name.
fn codex_models() -> Vec<(String, String)> {
    let Ok(text) = std::fs::read_to_string(home().join(".codex").join("models_cache.json")) else { return Vec::new() };
    let Ok(v) = serde_json::from_str::<Value>(&text) else { return Vec::new() };
    v["models"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|m| m["visibility"] == "list" && m["input_modalities"].as_array().is_some_and(|a| a.iter().any(|x| x == "image")))
        .filter_map(|m| Some((m["slug"].as_str()?.to_string(), m["display_name"].as_str().unwrap_or(m["slug"].as_str()?).to_string())))
        .collect()
}

#[tauri::command]
pub fn draw_models() -> Vec<Choice> {
    choices()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_capital_svg_tag_counts_and_the_drawing_ends_at_its_own_close() {
        let w = parse("FORM: flow
<SVG viewBox='0 0 10 10'><rect/></SVG>
That's it. </svg>").unwrap();
        assert_eq!(w["svg"].as_str().unwrap(), "<SVG viewBox='0 0 10 10'><rect/></SVG>");
    }

    #[test]
    fn his_own_drawing_comes_with_its_form() {
        let w = parse("FORM: relationships\n<svg viewBox=\"0 0 400 200\">\n<text x=\"20\" y=\"30\">Audit</text>\n</svg>").unwrap();
        assert_eq!(w["kind"], "drawing");
        assert_eq!(w["form"], "relationships");
        assert!(w["svg"].as_str().unwrap().ends_with("</svg>"));
    }

    #[test]
    fn a_ready_made_window_comes_as_json() {
        let w = parse("FORM: steps\n{\"kind\": \"steps\", \"steps\": [\"Click Export\", \"Choose PDF\"]}").unwrap();
        assert_eq!(w["steps"][1], "Choose PDF");
    }

    #[test]
    fn markdown_around_the_reply_is_ignored() {
        let w = parse("**FORM: table**\n```svg\n<svg viewBox=\"0 0 300 100\"></svg>\n```").unwrap();
        assert_eq!(w["form"], "table");
    }

    #[test]
    fn an_answer_without_a_drawing_is_none() {
        assert!(parse("I can't draw that, sir.").is_none());
        assert!(parse("FORM: steps\n{\"kind\": \"steps\", \"steps\": []}").is_none());
    }

    #[test]
    fn the_request_names_the_forms_tried_and_what_to_fix() {
        let job = Job { question: "what is this".into(), said: "Audit logs changes.".into(), idea: "how tables link".into(), shot: None };
        let ask = request(&job, &["relationships".into()], Some("\"links to\" lies on \"id (PK)\""));
        assert!(ask.contains("already drawn as relationships"));
        assert!(ask.contains("broke rule 6"));
    }
}

#[cfg(test)]
mod real {
    /// A real drawing of a made-up diagram (DRAW_TEST_PNG), written to DRAW_TEST_OUT.
    #[test]
    #[ignore]
    fn real_drawing() {
        let png = std::fs::read(std::env::var("DRAW_TEST_PNG").unwrap()).unwrap();
        let shot = super::Shot { data: super::super::base64(&png), what: "the part you circled", size: (640, 360), screen: (0, 0, 640, 360) };
        let job = super::Job { question: "what is this, simply".into(), said: "Orders link one customer to their products.".into(), idea: "how Order, Customer and Product link, with one and many".into(), shot: Some(shot) };
        let model = std::env::var("DRAW_TEST_MODEL").unwrap_or("claude-sonnet-5-5".into());
        let t = std::time::Instant::now();
        let reply = super::claude(&model, &super::request(&job, &[], None), job.shot.as_ref()).unwrap();
        eprintln!("{model} in {} ms", t.elapsed().as_millis());
        let w = super::parse(&reply).expect("a drawing");
        std::fs::write(std::env::var("DRAW_TEST_OUT").unwrap(), w["svg"].as_str().unwrap_or(&w.to_string())).unwrap();
    }
}
