// JARVIS (#120): Gmail, read-only, signed in with Google.
//
// Sign-in is Google's own page in the browser: a loopback redirect to 127.0.0.1 on a port
// picked for this sign-in, with PKCE and a state, as Google asks of desktop apps. Only the
// refresh token is kept, in the OS keystore (secrets::INTERNAL_KEYS): the webview never
// reads it. The scope is gmail.readonly: nothing in the inbox is ever changed.
//
// The OAuth client is the developer's (Google Cloud → Desktop app), given to the build as
// JARVIS_GOOGLE_CLIENT_ID / JARVIS_GOOGLE_CLIENT_SECRET, never committed. A desktop client's
// secret isn't one in Google's sense (it ships in every copy); PKCE is what protects the code.

use crate::integrations::{self, IntegrationUpdate};
use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub const ID: &str = "integration_gmail";
pub const KEY: &str = "gmail-refresh-token";
const SCOPE: &str = "https://www.googleapis.com/auth/gmail.readonly";
const AUTH: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN: &str = "https://oauth2.googleapis.com/token";
const API: &str = "https://gmail.googleapis.com/gmail/v1/users/me";
/// The newest unread shown: one as a card, three under it (design C).
const SHOWN: usize = 4;

fn client_id() -> Option<&'static str> {
    option_env!("JARVIS_GOOGLE_CLIENT_ID").filter(|s| !s.is_empty())
}
fn client_secret() -> &'static str {
    option_env!("JARVIS_GOOGLE_CLIENT_SECRET").unwrap_or("")
}

/// The access token and when it runs out; refreshed from the kept refresh token.
static ACCESS: Mutex<Option<(String, Instant)>> = Mutex::new(None);

pub fn connected() -> bool {
    crate::secrets::get_internal(KEY).is_some()
}

fn b64url(bytes: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    for c in bytes.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for i in 0..=c.len() {
            out.push(A[(n >> (18 - 6 * i) & 63) as usize] as char);
        }
    }
    out
}

fn random(n: usize) -> Result<String, String> {
    use ring::rand::SecureRandom;
    let mut bytes = vec![0u8; n];
    ring::rand::SystemRandom::new().fill(&mut bytes).map_err(|_| "no randomness".to_string())?;
    Ok(b64url(&bytes))
}

fn http(url: &str) -> Result<reqwest::Client, String> {
    let url = reqwest::Url::parse(url).map_err(|e| e.to_string())?;
    crate::net::client(&url, Duration::from_secs(20))
}

/// « Sign in with Google »: the browser opens Google's page; back here once you allow it.
pub async fn sign_in() -> Result<(), String> {
    let id = client_id().ok_or_else(|| crate::i18n::t("This copy of JARVIS has no Google sign-in."))?;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let redirect = format!("http://127.0.0.1:{}", listener.local_addr().map_err(|e| e.to_string())?.port());
    let verifier = random(48)?;
    let challenge = b64url(ring::digest::digest(&ring::digest::SHA256, verifier.as_bytes()).as_ref());
    let state = random(18)?;
    let mut url = reqwest::Url::parse(AUTH).map_err(|e| e.to_string())?;
    url.query_pairs_mut()
        .append_pair("client_id", id)
        .append_pair("redirect_uri", &redirect)
        .append_pair("response_type", "code")
        .append_pair("scope", SCOPE)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state)
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent");
    crate::platform::open_url(url.as_str());
    crate::log::line("gmail: sign-in page opened");

    // The browser comes back once; five minutes to sign in.
    let (mut stream, _) = tokio::time::timeout(Duration::from_secs(300), listener.accept())
        .await
        .map_err(|_| crate::i18n::t("Sign-in timed out. Try again."))?
        .map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; 8192];
    let n = tokio::time::timeout(Duration::from_secs(10), stream.read(&mut buf)).await.map_err(|_| "no request".to_string())?.map_err(|e| e.to_string())?;
    let (code, error) = read_redirect(&String::from_utf8_lossy(&buf[..n]), &state);
    let page = if code.is_some() { "You're signed in to Gmail. You can close this tab and go back to JARVIS." } else { "Gmail wasn't connected. You can close this tab." };
    let body = format!("<!doctype html><meta charset=utf-8><title>JARVIS</title><body style=\"font:16px system-ui;background:#000;color:#f5f5f7;display:grid;place-items:center;height:90vh\">{page}</body>");
    let _ = stream.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await;
    let code = code.ok_or_else(|| error.unwrap_or_else(|| crate::i18n::t("Gmail wasn't connected.")))?;

    let reply: Value = http(TOKEN)?
        .post(TOKEN)
        .form(&[("code", code.as_str()), ("client_id", id), ("client_secret", client_secret()), ("redirect_uri", &redirect), ("grant_type", "authorization_code"), ("code_verifier", &verifier)])
        .send()
        .await
        .map_err(|e| e.without_url().to_string())?
        .json()
        .await
        .map_err(|e| e.without_url().to_string())?;
    let refresh = reply["refresh_token"].as_str().ok_or_else(|| crate::i18n::t("Google didn't give access. Try again."))?;
    crate::secrets::set_internal(KEY, refresh)?;
    if let (Some(token), Some(secs)) = (reply["access_token"].as_str(), reply["expires_in"].as_u64()) {
        *ACCESS.lock().unwrap() = Some((token.to_string(), Instant::now() + Duration::from_secs(secs.saturating_sub(60))));
    }
    crate::log::line("gmail: signed in");
    Ok(())
}

/// The code from Google's redirect (`GET /?code=…&state=…`), if its state is ours; else what went wrong.
fn read_redirect(request: &str, state: &str) -> (Option<String>, Option<String>) {
    let path = request.lines().next().and_then(|l| l.split_whitespace().nth(1)).unwrap_or("");
    let Ok(url) = reqwest::Url::parse(&format!("http://127.0.0.1{path}")) else { return (None, None) };
    let get = |k: &str| url.query_pairs().find(|(n, _)| n == k).map(|(_, v)| v.into_owned());
    if get("state").as_deref() != Some(state) {
        return (None, Some(crate::i18n::t("Gmail wasn't connected.")));
    }
    match (get("code"), get("error")) {
        (Some(code), _) => (Some(code), None),
        (None, Some(e)) if e == "access_denied" => (None, Some(crate::i18n::t("You didn't allow access."))),
        _ => (None, Some(crate::i18n::t("Gmail wasn't connected."))),
    }
}

/// Signed out: Google forgets the access, and so does this computer.
pub async fn sign_out() {
    if let Some(token) = crate::secrets::get_internal(KEY) {
        if let Ok(c) = http(TOKEN) {
            let _ = c.post("https://oauth2.googleapis.com/revoke").form(&[("token", token.as_str())]).send().await;
        }
    }
    let _ = crate::secrets::set_internal(KEY, "");
    *ACCESS.lock().unwrap() = None;
    crate::log::line("gmail: signed out");
}

async fn access() -> Result<String, String> {
    if let Some((token, until)) = ACCESS.lock().unwrap().clone() {
        if Instant::now() < until {
            return Ok(token);
        }
    }
    let refresh = crate::secrets::get_internal(KEY).ok_or_else(|| crate::i18n::t("Not connected"))?;
    let id = client_id().ok_or_else(|| crate::i18n::t("This copy of JARVIS has no Google sign-in."))?;
    let reply: Value = http(TOKEN)?
        .post(TOKEN)
        .form(&[("refresh_token", refresh.as_str()), ("client_id", id), ("client_secret", client_secret()), ("grant_type", "refresh_token")])
        .send()
        .await
        .map_err(|_| crate::i18n::t("Not available"))?
        .json()
        .await
        .map_err(|_| crate::i18n::t("Unexpected API response."))?;
    if reply["error"].as_str() == Some("invalid_grant") {
        // Revoked from the Google account, or expired: sign in again.
        let _ = crate::secrets::set_internal(KEY, "");
        return Err(crate::i18n::t("Sign in to Gmail again."));
    }
    let token = reply["access_token"].as_str().ok_or_else(|| crate::i18n::t("Unexpected API response."))?.to_string();
    let secs = reply["expires_in"].as_u64().unwrap_or(3600);
    *ACCESS.lock().unwrap() = Some((token.clone(), Instant::now() + Duration::from_secs(secs.saturating_sub(60))));
    Ok(token)
}

async fn get(token: &str, path: &str) -> Result<Value, String> {
    let url = format!("{API}/{path}");
    let response = http(&url)?.get(&url).bearer_auth(token).header("User-Agent", "JARVIS").send().await.map_err(|_| crate::i18n::t("Not available"))?;
    if !response.status().is_success() {
        return Err(crate::i18n::tf("API error {code}", &[("code", &response.status().as_u16().to_string())]));
    }
    response.json().await.map_err(|_| crate::i18n::t("Unexpected API response."))
}

/// A sender as people read it: « Sam Example <sam@example.com> » → « Sam Example ».
fn sender(from: &str) -> String {
    let name = from.split('<').next().unwrap_or(from).trim().trim_matches('"').trim();
    if name.is_empty() { from.trim_matches(|c| c == '<' || c == '>').to_string() } else { name.to_string() }
}

async fn fetch() -> Result<Value, String> {
    let token = access().await?;
    let profile = get(&token, "profile").await?;
    let inbox = get(&token, "labels/INBOX").await?;
    let list = get(&token, &format!("messages?q={}&maxResults={SHOWN}", "in%3Ainbox%20is%3Aunread")).await?;
    let mut mails = Vec::new();
    for m in list["messages"].as_array().into_iter().flatten().take(SHOWN) {
        let Some(id) = m["id"].as_str() else { continue };
        let msg = get(&token, &format!("messages/{id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject")).await?;
        let header = |name: &str| {
            msg["payload"]["headers"].as_array().into_iter().flatten()
                .find(|h| h["name"].as_str().is_some_and(|n| n.eq_ignore_ascii_case(name)))
                .and_then(|h| h["value"].as_str()).unwrap_or("").to_string()
        };
        mails.push(json!({
            "from": sender(&header("From")),
            "subject": header("Subject"),
            "snippet": msg["snippet"].as_str().unwrap_or(""),
            "date": msg["internalDate"].as_str().and_then(|d| d.parse::<i64>().ok()).unwrap_or(0),
            "thread": msg["threadId"].as_str().unwrap_or(id),
        }));
    }
    Ok(json!({ "email": profile["emailAddress"], "unread": inbox["messagesUnread"].as_u64().unwrap_or(0), "mails": mails }))
}

pub async fn poll(app: AppHandle) {
    if !connected() {
        return;
    }
    let (data, error) = match tokio::time::timeout(Duration::from_secs(40), fetch()).await.unwrap_or_else(|_| Err(crate::i18n::t("No response text."))) {
        Ok(data) => (data, None),
        Err(error) => (json!({}), Some(error)),
    };
    integrations::emit(&app, IntegrationUpdate { id: ID, data, error, event: None });
}

/// A mail opened in Gmail, in the account it came from.
pub fn open(email: &str, thread: &str) {
    let ok = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "@._+-".contains(c));
    if !ok(email) || (!thread.is_empty() && !ok(thread)) {
        return;
    }
    let url = if thread.is_empty() { format!("https://mail.google.com/mail/?authuser={email}") } else { format!("https://mail.google.com/mail/?authuser={email}#all/{thread}") };
    crate::platform::open_url(&url);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64url_and_the_redirect() {
        assert_eq!(b64url(b"hello"), "aGVsbG8");
        assert_eq!(b64url(&[0xfb, 0xff]), "-_8");
        assert_eq!(read_redirect("GET /?state=abc&code=4%2F0X HTTP/1.1\r\n", "abc").0.as_deref(), Some("4/0X"));
        assert!(read_redirect("GET /?state=evil&code=x HTTP/1.1", "abc").0.is_none());
        assert!(read_redirect("GET /?state=abc&error=access_denied HTTP/1.1", "abc").0.is_none());
        assert_eq!(sender("\"Sam Example\" <sam@example.com>"), "Sam Example");
        assert_eq!(sender("<sam@example.com>"), "sam@example.com");
    }
}
