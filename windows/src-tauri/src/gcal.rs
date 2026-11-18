// JARVIS: Google Calendar, read-only, through the calendar's secret iCal address.
//
// The address is a password in all but name: whoever has it reads the calendar.
// It lives in the OS keystore (secrets::INTERNAL_KEYS) and never reaches the
// webview: the island asks Rust for the calendar's text and parses it itself
// (src/core/ics.ts).

use crate::{net, secrets};
use std::time::Duration;

const KEY: &str = "gcal-ics-url";
/// A year of a busy calendar is well under this.
const LIMIT: usize = 8 * 1024 * 1024;

/// Only https, and only Google's calendar host: the link is pasted by hand,
/// and this keeps a typo or a stray link from making JARVIS fetch elsewhere.
fn valid(url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url.trim()).map_err(|_| "That isn't a valid link.".to_string())?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("calendar.google.com") {
        return Err("Paste the « Secret address in iCal format » from Google Calendar (it starts with https://calendar.google.com).".into());
    }
    if !parsed.path().ends_with(".ics") {
        return Err("That link isn't an iCal address (it should end in .ics).".into());
    }
    Ok(parsed)
}

async fn download(url: &reqwest::Url) -> Result<String, String> {
    let client = net::client(url, Duration::from_secs(20))?;
    let response = client
        .get(url.clone())
        .header("User-Agent", "JARVIS")
        .send()
        .await
        .map_err(|e| format!("Couldn't reach Google Calendar: {}", e.without_url()))?;
    let status = response.status();
    if !status.is_success() {
        return Err(if status.as_u16() == 404 {
            "Google doesn't know this link any more (it may have been reset). Paste the new secret address.".into()
        } else {
            format!("Google Calendar answered {}.", status.as_u16())
        });
    }
    let bytes = net::read_capped(response, LIMIT).await?;
    let text = String::from_utf8_lossy(&bytes).into_owned();
    if !text.trim_start().starts_with("BEGIN:VCALENDAR") {
        return Err("That link didn't return a calendar.".into());
    }
    Ok(text)
}

/// Whether a calendar link is saved.
#[tauri::command]
pub fn gcal_connected() -> bool {
    secrets::get_internal(KEY).is_some()
}

/// Checks the link by fetching it once, then saves it.
#[tauri::command]
pub async fn gcal_connect(url: String) -> Result<(), String> {
    let parsed = valid(&url)?;
    download(&parsed).await?;
    secrets::set_internal(KEY, parsed.as_str())
}

/// Forgets the link.
#[tauri::command]
pub fn gcal_disconnect() -> Result<(), String> {
    secrets::set_internal(KEY, "")
}

/// The calendar's iCal text, fresh from Google.
#[tauri::command]
pub async fn gcal_fetch() -> Result<String, String> {
    let url = secrets::get_internal(KEY).ok_or_else(|| "No calendar connected.".to_string())?;
    download(&valid(&url)?).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_google_secret_ics_links_are_taken() {
        assert!(valid("https://calendar.google.com/calendar/ical/me%40gmail.com/private-abc/basic.ics").is_ok());
        assert!(valid("  https://calendar.google.com/calendar/ical/x/private-y/basic.ics  ").is_ok());
        assert!(valid("http://calendar.google.com/calendar/ical/x/private-y/basic.ics").is_err());
        assert!(valid("https://evil.example.com/basic.ics").is_err());
        assert!(valid("https://calendar.google.com/calendar/u/0/r").is_err());
        assert!(valid("not a link").is_err());
    }
}
