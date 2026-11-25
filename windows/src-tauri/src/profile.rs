// JARVIS (#102): who he works for, set at the end of the tour: your name and how he addresses
// you (sir, ma'am, or by name), a passkey only you know, and which AI you sign in to.
//
// The passkey is never kept as it is: only a salted PBKDF2-SHA256 hash, in the system's
// keychain beside JARVIS's other secrets. It can't be read back or recovered.

use std::num::NonZeroU32;
use std::sync::RwLock;

use ring::{pbkdf2, rand::SecureRandom};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::Shared;

/// How he addresses you, as last saved: (address, your name). Read by his prompts and the
/// strings shown, which say « sir » as written.
static NOW: RwLock<(String, String)> = RwLock::new((String::new(), String::new()));
/// What you wrote about yourself (#104).
static ABOUT: RwLock<String> = RwLock::new(String::new());

/// At start-up and after each save.
pub fn note(settings: &crate::settings::Settings) {
    *NOW.write().unwrap() = (settings.address.clone(), settings.profile_name.trim().to_string());
    *ABOUT.write().unwrap() = settings.profile_about.trim().to_string();
}

/// What he calls you: « sir » (also when nothing was chosen), « ma'am », or your first name.
pub fn title() -> String {
    let (address, name) = NOW.read().unwrap().clone();
    title_for(&address, &name)
}

fn title_for(address: &str, name: &str) -> String {
    match address {
        "maam" => "ma'am".into(),
        "name" if !name.is_empty() => name.split_whitespace().next().unwrap_or(name).to_string(),
        _ => "sir".into(),
    }
}

/// Your name from the tour, if you gave one.
pub fn name() -> Option<String> {
    let name = NOW.read().unwrap().1.clone();
    (!name.is_empty()).then_some(name)
}

/// The line his prompts end their persona with: how to address you, and what you told him
/// about yourself, if anything.
pub fn address_rule() -> String {
    format!("Address the user as \"{}\".{}", title(), about_line())
}

/// « What they told you about themselves: … », or nothing.
pub fn about_line() -> String {
    let about = ABOUT.read().unwrap().clone();
    if about.is_empty() {
        String::new()
    } else {
        format!(" What they told you about themselves, to keep in mind: {about}")
    }
}

/// A text written with « sir » in it, saying what you chose instead. English text only: other
/// languages have their own word for it in their catalogs.
pub fn addressed(text: &str) -> String {
    let t = title();
    if t == "sir" {
        return text.to_string();
    }
    let mut cap = t.clone();
    if let Some(f) = cap.get(0..1) {
        cap = f.to_uppercase() + &cap[1..];
    }
    replace_word(&replace_word(text, "sir", &t), "Sir", &cap)
}

fn replace_word(text: &str, word: &str, with: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(i) = rest.find(word) {
        let before = rest[..i].chars().next_back();
        let after = rest[i + word.len()..].chars().next();
        let whole = !before.is_some_and(char::is_alphanumeric) && !after.is_some_and(char::is_alphanumeric);
        out.push_str(&rest[..i]);
        out.push_str(if whole { with } else { word });
        rest = &rest[i + word.len()..];
    }
    out.push_str(rest);
    out
}

/// The tour's profile step and the profile page: your name, how he addresses you ("sir",
/// "maam" or "name") and, from the page, what you tell him about yourself.
#[tauri::command]
pub fn profile_save(app: AppHandle, shared: State<Shared>, name: String, address: String, about: Option<String>) -> Result<(), String> {
    let address = if ["sir", "maam", "name"].contains(&address.as_str()) { address } else { "sir".into() };
    let settings = {
        let mut s = shared.settings.lock().unwrap();
        s.profile_name = name.trim().chars().take(60).collect();
        s.address = address;
        if let Some(about) = about {
            s.profile_about = about.trim().chars().take(600).collect();
        }
        s.clone()
    };
    crate::settings::save(&settings).map_err(|e| e.to_string())?;
    note(&settings);
    crate::log::line("profile: saved");
    let _ = app.emit("settings-changed", settings);
    let _ = app.emit("profile-changed", ());
    Ok(())
}

/// Your profile, for the hub's page and its sidebar (#104).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    name: String,
    address: String,
    about: String,
    /// Your photo as a data: URL, or None for the default.
    photo: Option<String>,
    passkey: bool,
}

#[tauri::command]
pub fn profile_get(shared: State<Shared>) -> Profile {
    let s = shared.settings.lock().unwrap();
    Profile {
        name: s.profile_name.clone(),
        address: s.address.clone(),
        about: s.profile_about.clone(),
        photo: std::fs::read_to_string(photo_file()).ok().filter(|p| is_photo(p)),
        passkey: crate::secrets::get_internal(KEY).is_some(),
    }
}

fn photo_file() -> std::path::PathBuf {
    crate::settings::config_dir().join("profile-photo.txt")
}

/// A small picture, as the page sends it: a PNG, JPEG or WebP data: URL, under 400 KB.
fn is_photo(p: &str) -> bool {
    p.len() < 400_000 && ["data:image/png;base64,", "data:image/jpeg;base64,", "data:image/webp;base64,"].iter().any(|h| p.starts_with(h))
}

/// Your photo (the page shrinks it to 256 px first), or None: back to the default.
#[tauri::command]
pub fn profile_photo_set(app: AppHandle, photo: Option<String>) -> Result<(), String> {
    match photo {
        Some(p) if is_photo(&p) => {
            let _ = crate::platform::ensure_private_dir(&crate::settings::config_dir());
            std::fs::write(photo_file(), p).map_err(|e| e.to_string())?;
        }
        Some(_) => return Err("not a picture".into()),
        None => {
            let _ = std::fs::remove_file(photo_file());
        }
    }
    let _ = app.emit("profile-changed", ());
    Ok(())
}

// ── The passkey ──

const KEY: &str = "passkey";
const ROUNDS: u32 = 210_000;

/// Six digits, nothing else.
fn valid(pin: &str) -> bool {
    pin.len() == 6 && pin.bytes().all(|b| b.is_ascii_digit())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex(s: &str) -> Option<Vec<u8>> {
    (s.len() % 2 == 0).then(|| (0..s.len()).step_by(2).map(|i| u8::from_str_radix(s.get(i..i + 2)?, 16).ok()).collect())?
}

fn encode(salt: &[u8], hash: &[u8]) -> String {
    format!("pbkdf2-sha256${ROUNDS}${}${}", hex(salt), hex(hash))
}

fn hash(pin: &str, salt: &[u8], rounds: u32) -> [u8; 32] {
    let mut out = [0u8; 32];
    pbkdf2::derive(pbkdf2::PBKDF2_HMAC_SHA256, NonZeroU32::new(rounds).unwrap(), salt, pin.as_bytes(), &mut out);
    out
}

fn matches(stored: &str, pin: &str) -> bool {
    let parts: Vec<&str> = stored.split('$').collect();
    let [kind, rounds, salt, want] = parts[..] else { return false };
    let (Ok(rounds), Some(salt), Some(want)) = (rounds.parse::<u32>(), unhex(salt), unhex(want)) else { return false };
    if kind != "pbkdf2-sha256" || rounds == 0 {
        return false;
    }
    pbkdf2::verify(pbkdf2::PBKDF2_HMAC_SHA256, NonZeroU32::new(rounds).unwrap(), &salt, pin.as_bytes(), &want).is_ok()
}

fn make(pin: &str) -> Result<String, String> {
    let mut salt = [0u8; 16];
    ring::rand::SystemRandom::new().fill(&mut salt).map_err(|_| "no randomness".to_string())?;
    Ok(encode(&salt, &hash(pin, &salt, ROUNDS)))
}

/// The tour's passkey step: six digits, kept only as a salted hash.
#[tauri::command]
pub fn passkey_set(pin: String) -> Result<(), String> {
    if !valid(&pin) {
        return Err("six digits".into());
    }
    crate::secrets::set_internal(KEY, &make(&pin)?)?;
    crate::log::line("profile: passkey set");
    Ok(())
}

/// Whether `pin` is your passkey (false when none was set).
#[tauri::command]
pub fn passkey_check(pin: String) -> bool {
    crate::secrets::get_internal(KEY).is_some_and(|stored| matches(&stored, &pin))
}

/// Whether you've set one.
#[tauri::command]
pub fn passkey_present() -> bool {
    crate::secrets::get_internal(KEY).is_some()
}

// ── What he keeps an eye on (#106) ──

/// What the tour offers for the island: the connections it can show.
const PICKABLE: [&str; 11] = [
    "integration_github", "integration_gitlab", "integration_vercel", "integration_n8n", "integration_stripe", "integration_resend",
    "integration_spotify", "integration_calcom", "integration_notion", "integration_mail", "integration_whatsapp",
];

/// The tour's picks, at most four, in the order tapped: the island shows them (their keys come later).
fn picks(ids: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for id in ids {
        if PICKABLE.contains(&id.as_str()) && !out.contains(id) && out.len() < 4 {
            out.push(id.clone());
        }
    }
    out
}

#[tauri::command]
pub fn tour_pills(app: AppHandle, shared: State<Shared>, ids: Vec<String>) -> Result<(), String> {
    let settings = {
        let mut s = shared.settings.lock().unwrap();
        s.active_integrations = picks(&ids);
        s.clone()
    };
    crate::settings::save(&settings).map_err(|e| e.to_string())?;
    crate::log::line(format!("profile: the island shows {} connection(s)", settings.active_integrations.len()));
    let _ = app.emit("settings-changed", settings);
    Ok(())
}

// ── Your AI ──

/// The tour's « Sign in » for Gemini ("google"), ChatGPT ("openai") or Claude ("anthropic"):
/// its terminal tool opens in a terminal to sign in, and JARVIS uses that plan from now on; a
/// tool that isn't installed opens its install page instead. "terminal" or "install".
#[tauri::command]
pub fn subscription_sign_in(app: AppHandle, provider: String) -> Result<String, String> {
    let shared = app.state::<Shared>();
    let rows = {
        let mut s = shared.settings.lock().unwrap();
        let rows = crate::cli_relay::status(&s);
        let row = rows.iter().find(|r| r.provider == provider).ok_or("unknown provider")?.clone();
        if !row.installed {
            crate::platform::open_url(row.install_url);
            return Ok("install".into());
        }
        crate::cli_relay::set(&mut s, &provider, true);
        let _ = crate::settings::save(&s);
        row
    };
    open_terminal(rows.sign_in)?;
    crate::log::line(format!("profile: signing in to {provider}"));
    Ok("terminal".into())
}

/// A terminal window running `command` (a tool's own sign-in), left open.
#[cfg(windows)]
fn open_terminal(command: &str) -> Result<(), String> {
    std::process::Command::new("cmd")
        .args(["/c", "start", "", "powershell", "-NoExit", "-Command", command])
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(not(windows))]
fn open_terminal(command: &str) -> Result<(), String> {
    let term = crate::launch::linux_candidates(std::env::var("TERMINAL").ok().as_deref()).into_iter().next().ok_or("no terminal")?;
    std::process::Command::new(&term).args(["-e", "sh", "-c", &format!("{command}; exec $SHELL")]).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_passkey_is_only_ever_a_salted_hash() {
        let stored = make("482913").unwrap();
        assert!(!stored.contains("482913"));
        assert!(stored.starts_with("pbkdf2-sha256$210000$"));
        assert!(matches(&stored, "482913"));
        assert!(!matches(&stored, "482914"));
        assert_ne!(make("482913").unwrap(), stored, "a new salt each time");
        assert!(!matches("garbage", "482913"));
        assert!(valid("000000") && !valid("12345") && !valid("12345a") && !valid("1234567"));
    }

    #[test]
    fn the_tour_picks_at_most_four_known_connections() {
        let ids: Vec<String> = ["integration_github", "integration_bogus", "integration_github", "integration_spotify", "integration_stripe", "integration_notion", "integration_mail"]
            .iter().map(|s| s.to_string()).collect();
        assert_eq!(picks(&ids), ["integration_github", "integration_spotify", "integration_stripe", "integration_notion"]);
        assert!(picks(&[]).is_empty());
    }

    #[test]
    fn he_calls_you_what_you_chose() {
        assert_eq!(title_for("", ""), "sir");
        assert_eq!(title_for("maam", "Sam"), "ma'am");
        assert_eq!(title_for("name", "Sam Lee"), "Sam");
        assert_eq!(title_for("name", ""), "sir");
        assert!(is_photo("data:image/jpeg;base64,AAAA") && !is_photo("javascript:alert(1)") && !is_photo("data:text/html;base64,AA"));
        assert_eq!(replace_word("Good evening, sir. Sir? Desire, sirloin.", "sir", "ma'am"), "Good evening, ma'am. Sir? Desire, sirloin.");
    }
}
