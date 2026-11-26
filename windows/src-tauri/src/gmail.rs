// JARVIS (#120): Gmail, read-only, with an app password.
//
// Google's standard mail connection (IMAP over TLS, imap.gmail.com:993) with the address and an
// app password the user makes in their Google account (it needs 2-Step Verification). No Google
// Cloud project, no review: it works for anyone who downloads JARVIS. Both are kept in the OS
// keystore like every other key. Nothing in the inbox changes: the inbox is opened with EXAMINE
// (read-only) and mail is read with BODY.PEEK (it stays unread).

use crate::integrations::{self, IntegrationUpdate};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio_rustls::rustls::{crypto::ring as ring_provider, pki_types::ServerName, ClientConfig, RootCertStore};

pub const ID: &str = "integration_gmail";
pub const ADDRESS: &str = "gmail-address";
pub const PASSWORD: &str = "gmail-app-password";
const HOST: &str = "imap.gmail.com";
/// The newest unread shown: one as a card, three under it (design C).
const SHOWN: usize = 4;
/// A whole poll never reads more than this from the server.
const LIMIT: usize = 2 * 1024 * 1024;

type Stream = BufReader<tokio_rustls::client::TlsStream<tokio::net::TcpStream>>;

/// One untagged answer: its text, with each literal replaced by « {#i} », and the literals.
#[derive(Debug, Default)]
struct Answer {
    text: String,
    lits: Vec<Vec<u8>>,
}

struct Imap {
    s: Stream,
    tag: u32,
    read: usize,
}

impl Imap {
    async fn connect() -> Result<Self, String> {
        let roots = RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        let config = ClientConfig::builder_with_provider(Arc::new(ring_provider::default_provider()))
            .with_safe_default_protocol_versions()
            .map_err(|e| e.to_string())?
            .with_root_certificates(roots)
            .with_no_client_auth();
        let tcp = tokio::net::TcpStream::connect((HOST, 993)).await.map_err(|_| crate::i18n::t("Couldn't reach Gmail."))?;
        let name = ServerName::try_from(HOST).map_err(|e| e.to_string())?;
        let tls = tokio_rustls::TlsConnector::from(Arc::new(config)).connect(name, tcp).await.map_err(|_| crate::i18n::t("Couldn't reach Gmail."))?;
        let mut imap = Imap { s: BufReader::new(tls), tag: 0, read: 0 };
        imap.line().await?; // the greeting
        Ok(imap)
    }

    async fn line(&mut self) -> Result<Vec<u8>, String> {
        let mut buf = Vec::new();
        self.s.read_until(b'\n', &mut buf).await.map_err(|e| e.to_string())?;
        self.read += buf.len();
        if buf.is_empty() {
            return Err(crate::i18n::t("Gmail closed the connection."));
        }
        if self.read > LIMIT {
            return Err(crate::i18n::t("The server's answer is too large."));
        }
        Ok(buf)
    }

    /// Sends a command; its untagged answers, once the server says OK to it.
    async fn run(&mut self, command: &str) -> Result<Vec<Answer>, String> {
        self.tag += 1;
        let tag = format!("J{}", self.tag);
        self.s.get_mut().write_all(format!("{tag} {command}\r\n").as_bytes()).await.map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        let mut cur: Option<Answer> = None;
        loop {
            let raw = self.line().await?;
            let text = String::from_utf8_lossy(&raw).trim_end_matches(['\r', '\n']).to_string();
            if cur.is_none() && text.starts_with(&format!("{tag} ")) {
                let rest = &text[tag.len() + 1..];
                if rest.starts_with("OK") {
                    return Ok(out);
                }
                return Err(if rest.contains("AUTHENTICATIONFAILED") || command.starts_with("LOGIN") {
                    crate::i18n::t("Gmail refused this address or app password.")
                } else {
                    crate::i18n::tf("Gmail said: {0}", &[("0", rest)])
                });
            }
            let a = cur.get_or_insert_with(Answer::default);
            // A literal « {n} » ends the line: n bytes follow, then the rest of the answer.
            if let Some(n) = literal(&text) {
                let head = &text[..text.rfind('{').unwrap_or(text.len())];
                a.text.push_str(head);
                a.text.push_str(&format!("{{#{}}}", a.lits.len()));
                if self.read + n > LIMIT {
                    return Err(crate::i18n::t("The server's answer is too large."));
                }
                let mut lit = vec![0u8; n];
                self.s.read_exact(&mut lit).await.map_err(|e| e.to_string())?;
                self.read += n;
                a.lits.push(lit);
            } else {
                a.text.push_str(&text);
                out.push(cur.take().unwrap_or_default());
            }
        }
    }
}

fn literal(line: &str) -> Option<usize> {
    let inner = line.strip_suffix('}')?;
    inner[inner.rfind('{')? + 1..].parse().ok()
}

fn quote(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

// ── Decoding what mail headers and bodies hold ─────────────────────────────────

fn b64(s: &str) -> Vec<u8> {
    let v = |c: u8| match c {
        b'A'..=b'Z' => Some(c - b'A'),
        b'a'..=b'z' => Some(c - b'a' + 26),
        b'0'..=b'9' => Some(c - b'0' + 52),
        b'+' | b'-' => Some(62),
        b'/' | b'_' => Some(63),
        _ => None,
    };
    let (mut out, mut acc, mut bits) = (Vec::new(), 0u32, 0);
    for c in s.bytes().filter_map(v) {
        acc = acc << 6 | c as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    out
}

fn qp(s: &str, underscore_space: bool) -> Vec<u8> {
    let b = s.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'=' if b.get(i + 1) == Some(&b'\r') || b.get(i + 1) == Some(&b'\n') => {
                i += if b.get(i + 1) == Some(&b'\r') { 3 } else { 2 };
                continue;
            }
            b'=' if i + 2 < b.len() => {
                let hex = |c: u8| (c as char).to_digit(16);
                match (hex(b[i + 1]), hex(b[i + 2])) {
                    (Some(h), Some(l)) => {
                        out.push((h * 16 + l) as u8);
                        i += 3;
                        continue;
                    }
                    _ => out.push(b'='),
                }
            }
            b'_' if underscore_space => out.push(b' '),
            c => out.push(c),
        }
        i += 1;
    }
    out
}

fn text_of(bytes: Vec<u8>, charset: &str) -> String {
    if charset.eq_ignore_ascii_case("iso-8859-1") || charset.eq_ignore_ascii_case("latin1") || charset.eq_ignore_ascii_case("windows-1252") {
        bytes.iter().map(|&b| b as char).collect()
    } else {
        String::from_utf8_lossy(&bytes).into_owned()
    }
}

/// « =?UTF-8?B?…?= » and « =?utf-8?Q?…?= » words, as people read them.
fn header_text(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(start) = rest.find("=?") {
        let Some(end) = rest[start + 2..].find("?=").map(|e| start + 2 + e) else { break };
        let word = &rest[start + 2..end];
        let parts: Vec<&str> = word.splitn(3, '?').collect();
        let between = &rest[..start];
        // Whitespace between two encoded words isn't shown.
        if !(out.ends_with('\u{0}') && between.trim().is_empty()) {
            out.push_str(between);
        }
        out = out.trim_end_matches('\u{0}').to_string();
        if parts.len() == 3 {
            let bytes = if parts[1].eq_ignore_ascii_case("B") { b64(parts[2]) } else { qp(parts[2], true) };
            out.push_str(&text_of(bytes, parts[0]));
            out.push('\u{0}');
        } else {
            out.push_str(&rest[start..end + 2]);
        }
        rest = &rest[end + 2..];
    }
    out.push_str(rest);
    out.replace('\u{0}', "").split_whitespace().collect::<Vec<_>>().join(" ")
}

/// A header's value from « From: …\r\nSubject: … » (folded lines joined).
fn header(block: &str, name: &str) -> String {
    let mut value = String::new();
    let mut on = false;
    for line in block.lines() {
        if on && line.starts_with([' ', '\t']) {
            value.push(' ');
            value.push_str(line.trim());
            continue;
        }
        on = false;
        if let Some((k, v)) = line.split_once(':') {
            if k.trim().eq_ignore_ascii_case(name) {
                on = true;
                value = v.trim().to_string();
            }
        }
    }
    header_text(&value)
}

/// A sender as people read it: « Sam Example <sam@example.com> » → « Sam Example ».
fn sender(from: &str) -> String {
    let name = from.split('<').next().unwrap_or(from).trim().trim_matches('"').trim();
    if name.is_empty() { from.trim_matches(|c| c == '<' || c == '>' || c == ' ').to_string() } else { name.to_string() }
}

/// The first lines of a mail, best effort: its first part, decoded, without markup.
fn snippet(raw: &[u8]) -> String {
    let s = String::from_utf8_lossy(raw);
    // A part that is itself multipart: skip its boundaries and headers.
    let body: String = if s.trim_start().starts_with("--") {
        let mut lines = s.lines().skip_while(|l| l.starts_with("--") || l.contains(':') && !l.trim().is_empty()).peekable();
        while lines.peek().is_some_and(|l| l.trim().is_empty()) {
            lines.next();
        }
        lines.take_while(|l| !l.starts_with("--")).collect::<Vec<_>>().join("\n")
    } else {
        s.into_owned()
    };
    let compact: String = body.chars().filter(|c| !c.is_whitespace()).collect();
    let decoded = if compact.len() >= 24 && compact.bytes().all(|c| c.is_ascii_alphanumeric() || b"+/=".contains(&c)) {
        String::from_utf8_lossy(&b64(&compact)).into_owned()
    } else if body.contains("=\r\n") || body.contains("=\n") || body.contains("=3D") || body.contains("=20") || body.contains("=C3") {
        String::from_utf8_lossy(&qp(&body, false)).into_owned()
    } else {
        body
    };
    // Markup out: tags, styles, entities.
    let mut text = String::new();
    let mut tag = false;
    let lower = decoded.to_lowercase();
    let cut = ["<style", "<head"].iter().filter_map(|t| lower.find(t)).min();
    let decoded = match (cut, lower.find("</style>").or(lower.find("</head>"))) {
        (Some(a), Some(b)) if b > a => format!("{}{}", &decoded[..a], &decoded[b..]),
        _ => decoded,
    };
    for c in decoded.chars() {
        match c {
            '<' => tag = true,
            '>' if tag => {
                tag = false;
                text.push(' ');
            }
            _ if !tag => text.push(c),
            _ => {}
        }
    }
    let text = text.replace("&nbsp;", " ").replace("&amp;", "&").replace("&quot;", "\"").replace("&#39;", "'").replace("&lt;", "<").replace("&gt;", ">");
    text.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(220).collect()
}

/// « 26-Nov-2026 09:42:00 +0100 » → milliseconds since 1970.
fn internal_date(s: &str) -> i64 {
    let p: Vec<&str> = s.split([' ', '-', ':']).filter(|x| !x.is_empty()).collect();
    if p.len() < 7 {
        return 0;
    }
    const M: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    let (Ok(d), Some(m), Ok(y), Ok(h), Ok(mi), Ok(se)) = (p[0].parse::<i64>(), M.iter().position(|x| *x == p[1]), p[2].parse::<i64>(), p[3].parse::<i64>(), p[4].parse::<i64>(), p[5].parse::<i64>()) else { return 0 };
    let zone = p[6];
    let sign = if zone.starts_with('-') { -1 } else { 1 };
    let z = zone.trim_start_matches(['+', '-']);
    let off = sign * (z.get(..2).and_then(|x| x.parse::<i64>().ok()).unwrap_or(0) * 60 + z.get(2..4).and_then(|x| x.parse::<i64>().ok()).unwrap_or(0));
    // Days from 1970-01-01 to y-m-d (civil calendar).
    let (y2, m2) = if m < 2 { (y - 1, m as i64 + 13) } else { (y, m as i64 + 1) };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let doy = (153 * (m2 - 3) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    ((days * 86400 + h * 3600 + mi * 60 + se) - off * 60) * 1000
}

/// One « * n FETCH (…) » answer, as the pill shows it.
fn mail_of(a: &Answer) -> Option<(u32, Value)> {
    let seq: u32 = a.text.strip_prefix("* ")?.split(' ').next()?.parse().ok()?;
    let lit_after = |key: &str| -> Option<&Vec<u8>> {
        let at = a.text.find(key)? + key.len();
        let rest = a.text[at..].trim_start();
        let i: usize = rest.strip_prefix("{#")?.split('}').next()?.parse().ok()?;
        a.lits.get(i)
    };
    let head = String::from_utf8_lossy(lit_after("BODY[HEADER.FIELDS (FROM SUBJECT)]")?).into_owned();
    let body = lit_after("BODY[1]<0>").map(|b| snippet(b)).unwrap_or_default();
    let date = a.text.split("INTERNALDATE \"").nth(1).and_then(|r| r.split('"').next()).map(internal_date).unwrap_or(0);
    let thread = a.text.split("X-GM-THRID ").nth(1).and_then(|r| r.split([' ', ')']).next()).and_then(|n| n.parse::<u64>().ok()).map(|n| format!("{n:x}")).unwrap_or_default();
    Some((seq, json!({ "from": sender(&header(&head, "From")), "subject": header(&head, "Subject"), "snippet": body, "date": date, "thread": thread })))
}

async fn fetch(address: &str, password: &str) -> Result<Value, String> {
    let mut imap = Imap::connect().await?;
    // App passwords are shown in groups of four; Google takes them without the spaces.
    let password: String = password.chars().filter(|c| !c.is_whitespace()).collect();
    imap.run(&format!("LOGIN {} {}", quote(address), quote(&password))).await?;
    imap.run("EXAMINE INBOX").await?;
    let found = imap.run("SEARCH UNSEEN").await?;
    let mut unseen: Vec<u32> = found.iter().filter_map(|a| a.text.strip_prefix("* SEARCH")).flat_map(|r| r.split_whitespace().filter_map(|n| n.parse().ok())).collect();
    unseen.sort_unstable();
    let newest: Vec<u32> = unseen.iter().rev().take(SHOWN).copied().collect();
    let mut mails = Vec::new();
    if !newest.is_empty() {
        let set = newest.iter().map(|n| n.to_string()).collect::<Vec<_>>().join(",");
        let answers = imap.run(&format!("FETCH {set} (INTERNALDATE X-GM-THRID BODY.PEEK[HEADER.FIELDS (FROM SUBJECT)] BODY.PEEK[1]<0.1500>)")).await?;
        let mut got: Vec<(u32, Value)> = answers.iter().filter_map(mail_of).collect();
        got.sort_by(|a, b| b.0.cmp(&a.0));
        mails = got.into_iter().map(|(_, v)| v).collect();
    }
    let _ = imap.run("LOGOUT").await;
    Ok(json!({ "email": address, "unread": unseen.len(), "mails": mails }))
}

pub async fn poll(app: AppHandle) {
    let (Some(address), Some(password)) = (crate::secrets::get(ADDRESS), crate::secrets::get(PASSWORD)) else { return };
    let (data, error) = match tokio::time::timeout(Duration::from_secs(40), fetch(address.trim(), &password)).await.unwrap_or_else(|_| Err(crate::i18n::t("No response text."))) {
        Ok(data) => (data, None),
        Err(error) => {
            crate::log::line(format!("gmail: {error}"));
            (json!({}), Some(error))
        }
    };
    integrations::emit(&app, IntegrationUpdate { id: ID, data, error, event: None });
}

/// A mail opened in Gmail, in the account it came from; no thread: the inbox.
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
    fn headers_bodies_and_dates_read_as_people_read_them() {
        assert_eq!(header_text("=?UTF-8?B?Q2Fmw6k=?= ouvert"), "Café ouvert");
        assert_eq!(header_text("=?utf-8?Q?R=C3=A9union_demain?="), "Réunion demain");
        assert_eq!(header_text("=?UTF-8?Q?a?= =?UTF-8?Q?b?="), "ab");
        assert_eq!(header("From: \"Sam Example\"\r\n <sam@example.com>\r\nSubject: Hi\r\n", "From"), "\"Sam Example\" <sam@example.com>");
        assert_eq!(sender("\"Sam Example\" <sam@example.com>"), "Sam Example");
        assert_eq!(sender("<sam@example.com>"), "sam@example.com");
        assert_eq!(snippet(b"Hello =3D there,=\r\n see you"), "Hello = there, see you");
        assert_eq!(snippet(b"<html><style>p{}</style><p>Hi&nbsp;Sam</p></html>"), "Hi Sam");
        assert_eq!(snippet(b"SGVsbG8gdGhlcmUsIHRoaXMgaXMgYmFzZTY0IHRleHQ="), "Hello there, this is base64 text");
        assert_eq!(internal_date("01-Jan-1970 01:00:00 +0100"), 0);
        assert_eq!(internal_date("26-Nov-2026 09:42:00 +0000"), 1795686120000);
        assert_eq!(literal("* 3 FETCH (BODY[1]<0> {42}"), Some(42));
        assert_eq!(quote("a\"b\\c"), "\"a\\\"b\\\\c\"");
    }

    #[test]
    fn a_fetch_answer_becomes_a_mail() {
        let a = Answer {
            text: "* 7 FETCH (X-GM-THRID 1795686120000123 INTERNALDATE \"26-Nov-2026 09:42:00 +0000\" BODY[HEADER.FIELDS (FROM SUBJECT)] {#0} BODY[1]<0> {#1})".into(),
            lits: vec![b"From: Sam Example <sam@example.com>\r\nSubject: Contract draft\r\n\r\n".to_vec(), b"Two small changes.".to_vec()],
        };
        let (seq, m) = mail_of(&a).unwrap();
        assert_eq!(seq, 7);
        assert_eq!(m["from"], "Sam Example");
        assert_eq!(m["subject"], "Contract draft");
        assert_eq!(m["snippet"], "Two small changes.");
        assert_eq!(m["thread"], format!("{:x}", 1795686120000123u64));
    }
}
