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
    limit: usize,
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
        let mut imap = Imap { s: BufReader::new(tls), tag: 0, read: 0, limit: LIMIT };
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
        if self.read > self.limit {
            return Err(crate::i18n::t("The server's answer is too large."));
        }
        Ok(buf)
    }

    /// Sends a command; its untagged answers, once the server says OK to it.
    async fn run(&mut self, command: &str) -> Result<Vec<Answer>, String> {
        self.tag += 1;
        self.read = 0;
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
                if self.read + n > self.limit {
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
        // The end is after « charset?B? » or « charset?Q? »: a Q text may itself start with « = »
        // (« =?UTF-8?Q?=F0=9F… », an emoji), whose « ?= » isn't the end.
        let text_at = rest[start + 2..].find('?').map(|q| start + 2 + q + 3).filter(|&t| t <= rest.len());
        let Some(end) = text_at.and_then(|t| rest[t..].find("?=").map(|e| t + e)) else { break };
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
    snippet_of(raw, 220)
}

fn snippet_of(raw: &[u8], most: usize) -> String {
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
    // Markup out: style and head blocks and comments (to the end when the cut came first), then
    // tags, then CSS rules left as text (« .mj-outlook-group-fix { width:100% } », #120).
    let mut decoded = decoded;
    for (open, close) in [("<style", "</style>"), ("<head", "</head>"), ("<!--", "-->")] {
        // ASCII lowercase keeps every byte where it is, so its positions fit `decoded`.
        while let Some(a) = decoded.to_ascii_lowercase().find(open) {
            let end = decoded.to_ascii_lowercase()[a..].find(close).map(|e| a + e + close.len()).unwrap_or(decoded.len());
            decoded.replace_range(a..end, " ");
        }
    }
    let mut text = String::new();
    let mut tag = false;
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
    while let Some(open) = text.find('{') {
        let Some(close) = text[open..].find('}').map(|c| open + c + 1) else {
            text.truncate(open);
            break;
        };
        // The selector before it, back to the last rule's end.
        let from = text[..open].rfind('}').map(|i| i + 1).unwrap_or(0);
        let from = if text[open..close].contains(':') { from } else { open };
        text.replace_range(from..close, " ");
    }
    let text = text.replace("&nbsp;", " ").replace("&amp;", "&").replace("&quot;", "\"").replace("&#39;", "'").replace("&lt;", "<").replace("&gt;", ">");
    text.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(most).collect()
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
    let days = days_from_civil(y, m as i64 + 1, d);
    ((days * 86400 + h * 3600 + mi * 60 + se) - off * 60) * 1000
}

/// Days from 1970-01-01 to y-m-d (`m` 1–12), and back.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + if m <= 2 { 1 } else { 0 }, m, d)
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

// ── The Mail page (#120): Gmail where Outlook isn't ──────────────────────────────────────
//
// The same shapes as Outlook's scripts (mail/outlook.rs), so the page draws Gmail as it draws
// Outlook. A Gmail message's `storeId` is « gmail » and its `entryId` « uid:thread ».

pub const STORE: &str = "gmail";

pub fn configured() -> bool {
    crate::secrets::present(ADDRESS) && crate::secrets::present(PASSWORD)
}

/// Minutes this computer's clock is ahead of UTC.
fn local_offset_min() -> i64 {
    let t = crate::platform::local_time();
    let local = days_from_civil(t.year as i64, t.month as i64, t.day as i64) * 86400 + t.hour as i64 * 3600 + t.minute as i64 * 60 + t.second as i64;
    let utc = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    ((local - utc) as f64 / 900.0).round() as i64 * 15
}

/// A time (ms) on this computer's calendar: (year, month, day, hour, minute).
fn local_parts(ms: i64, off: i64) -> (i64, i64, i64, i64, i64) {
    let s = ms.div_euclid(1000) + off * 60;
    let (y, m, d) = civil_from_days(s.div_euclid(86400));
    let r = s.rem_euclid(86400);
    (y, m, d, r / 3600, r % 3600 / 60)
}

/// « 1-Nov-2026 », as IMAP's SEARCH takes a date.
fn imap_date(days: i64) -> String {
    const M: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    let (y, m, d) = civil_from_days(days);
    format!("{d}-{}-{y}", M[(m - 1) as usize])
}

#[derive(Debug, Default, Clone)]
struct Item {
    uid: u64,
    date: i64,
    seen: bool,
    flagged: bool,
    thread: String,
    name: String,
    address: String,
    subject: String,
    files: Vec<String>,
}

const ITEM: &str = "(UID INTERNALDATE FLAGS X-GM-THRID BODYSTRUCTURE BODY.PEEK[HEADER.FIELDS (FROM SUBJECT)])";

fn item_of(a: &Answer) -> Option<Item> {
    a.text.strip_prefix("* ")?.split(' ').nth(1).filter(|w| *w == "FETCH")?;
    let after = |key: &str| a.text.split(key).nth(1);
    let uid = after("UID ")?.split([' ', ')']).next()?.parse().ok()?;
    let flags = after("FLAGS (").and_then(|r| r.split(')').next()).unwrap_or("");
    let head_at = a.text.find("BODY[HEADER.FIELDS (FROM SUBJECT)]").map(|i| &a.text[i..]);
    let head = head_at
        .and_then(|r| r.split("{#").nth(1))
        .and_then(|r| r.split('}').next())
        .and_then(|i| i.parse::<usize>().ok())
        .and_then(|i| a.lits.get(i))
        .map(|b| String::from_utf8_lossy(b).into_owned())
        .unwrap_or_default();
    let from = header(&head, "From");
    let address = from.rsplit('<').next().map(|r| r.trim_end_matches('>').trim().to_string()).filter(|s| s.contains('@')).unwrap_or_else(|| from.trim().to_string());
    // An attachment's name, as BODYSTRUCTURE gives it: « "FILENAME" "report.pdf" » (or "NAME").
    let lower = a.text.to_lowercase();
    let mut files = Vec::new();
    for key in ["\"filename\" \"", "\"name\" \""] {
        let mut at = 0;
        while let Some(i) = lower[at..].find(key) {
            let start = at + i + key.len();
            let Some(end) = a.text[start..].find('"') else { break };
            let name = header_text(&a.text[start..start + end]);
            if !name.is_empty() && !files.contains(&name) && lower.contains("\"attachment\"") {
                files.push(name);
            }
            at = start + end;
        }
    }
    Some(Item {
        uid,
        date: after("INTERNALDATE \"").and_then(|r| r.split('"').next()).map(internal_date).unwrap_or(0),
        seen: flags.contains("\\Seen"),
        flagged: flags.contains("\\Flagged"),
        thread: after("X-GM-THRID ").and_then(|r| r.split([' ', ')']).next()).and_then(|n| n.parse::<u64>().ok()).map(|n| format!("{n:x}")).unwrap_or_default(),
        name: sender(&from),
        address: address.to_lowercase(),
        subject: header(&head, "Subject"),
        files,
    })
}

/// The signed-in connection with the inbox open read-only, kept for the next call: a new one
/// costs a TLS handshake and a login, about a second (the Mail page asks several things at once).
struct Live {
    imap: Imap,
    address: String,
    password: String,
    used: std::time::Instant,
}

static LIVE: tokio::sync::Mutex<Option<Live>> = tokio::sync::Mutex::const_new(None);

type Job<'a, T> = std::pin::Pin<Box<dyn std::future::Future<Output = Result<T, String>> + Send + 'a>>;

/// `job` on the live connection (one call at a time); a fresh connection after 10 idle minutes,
/// a new address or app password, or once more when the old one has dropped.
async fn with_live<T>(limit: usize, job: impl for<'a> Fn(&'a mut Imap, &'a str) -> Job<'a, T>) -> Result<T, String> {
    let (Some(address), Some(password)) = (crate::secrets::get(ADDRESS), crate::secrets::get(PASSWORD)) else {
        return Err(crate::i18n::t("Not connected"));
    };
    let address = address.trim().to_string();
    // App passwords are shown in groups of four; Google takes them without the spaces.
    let password: String = password.chars().filter(|c| !c.is_whitespace()).collect();
    let mut g = LIVE.lock().await;
    for attempt in 0..2 {
        let reuse = attempt == 0 && g.as_ref().is_some_and(|l| l.address == address && l.password == password && l.used.elapsed() < Duration::from_secs(600));
        if !reuse {
            *g = None;
            let mut imap = Imap::connect().await?;
            imap.run(&format!("LOGIN {} {}", quote(&address), quote(&password))).await?;
            imap.run("EXAMINE INBOX").await?;
            *g = Some(Live { imap, address: address.clone(), password: password.clone(), used: std::time::Instant::now() });
        }
        let live = g.as_mut().expect("just opened");
        live.imap.limit = limit;
        match tokio::time::timeout(Duration::from_secs(40), job(&mut live.imap, &live.address)).await {
            Ok(Ok(v)) => {
                live.used = std::time::Instant::now();
                return Ok(v);
            }
            // A dropped connection fails here: once more on a new one.
            Ok(Err(e)) if reuse => crate::log::line(format!("gmail: connection reopened ({e})")),
            Ok(Err(e)) => {
                *g = None;
                return Err(e);
            }
            Err(_) => {
                *g = None;
                return Err(crate::i18n::t("No response text."));
            }
        }
    }
    Err(crate::i18n::t("Couldn't reach Gmail."))
}

/// The messages a SEARCH finds, newest last; `most` of the newest at most.
async fn items(imap: &mut Imap, search: &str, most: usize) -> Result<Vec<Item>, String> {
    let found = imap.run(&format!("SEARCH {search}")).await?;
    let mut seqs: Vec<u32> = found.iter().filter_map(|a| a.text.strip_prefix("* SEARCH")).flat_map(|r| r.split_whitespace().filter_map(|n| n.parse().ok())).collect();
    seqs.sort_unstable();
    let skip = seqs.len().saturating_sub(most);
    let mut out = Vec::new();
    for chunk in seqs[skip..].chunks(250) {
        let set = chunk.iter().map(|n| n.to_string()).collect::<Vec<_>>().join(",");
        out.extend(imap.run(&format!("FETCH {set} {ITEM}")).await?.iter().filter_map(item_of));
    }
    out.sort_by_key(|i| i.date);
    Ok(out)
}

fn message_json(i: &Item, account: &str, off: i64) -> Value {
    let (y, mo, d, h, mi) = local_parts(i.date, off);
    json!({
        "entryId": format!("{}:{}", i.uid, i.thread), "storeId": STORE, "account": account,
        "senderName": i.name, "address": i.address, "subject": i.subject, "date": i.date,
        "unread": !i.seen, "flagged": i.flagged, "local": format!("{y:04}-{mo:02}-{d:02} {h:02}:{mi:02}"),
        "files": i.files, "hour": h,
    })
}

/// A month (`y`, `m`) of `list`, as outlook::month_script gives it.
fn month_of(list: &[Item], y: i64, m: i64, off: i64) -> Value {
    let t = crate::platform::local_time();
    let first = days_from_civil(y, m, 1);
    let next = days_from_civil(y + (m == 12) as i64, if m == 12 { 1 } else { m + 1 }, 1);
    let today = if y == t.year as i64 && m == t.month as i64 { t.day as i64 } else { 0 };
    let mut days = serde_json::Map::new();
    let mut marks = serde_json::Map::new();
    let (mut hours, mut flagged, mut files) = (vec![0u32; 24], 0, 0);
    for i in list {
        let (iy, im, id, ih, _) = local_parts(i.date, off);
        if (iy, im) != (y, m) {
            continue;
        }
        let k = id.to_string();
        let count = days.get(&k).and_then(Value::as_i64).unwrap_or(0) + 1;
        days.insert(k.clone(), json!(count));
        let mark = marks.entry(k).or_insert_with(|| json!({ "flagged": 0, "files": 0, "senders": {} }));
        if i.flagged {
            flagged += 1;
            mark["flagged"] = json!(mark["flagged"].as_i64().unwrap_or(0) + 1);
        }
        if !i.files.is_empty() {
            mark["files"] = json!(mark["files"].as_i64().unwrap_or(0) + 1);
        }
        let n = mark["senders"][&i.address].as_i64().unwrap_or(0) + 1;
        mark["senders"][&i.address] = json!(n);
        if id == today {
            hours[ih as usize] += 1;
            if !i.files.is_empty() {
                files += 1;
            }
        }
    }
    json!({ "year": y, "month": m, "first": (first + 4).rem_euclid(7), "length": next - first, "today": today,
        "days": days, "marks": marks, "hours": hours, "flagged": flagged, "files": files })
}

/// The Mail page's month: from the synced copy when it holds the whole month, else from Gmail.
pub async fn month(offset: i32) -> Result<Value, String> {
    let off = local_offset_min();
    let t = crate::platform::local_time();
    let total = t.year as i64 * 12 + t.month as i64 - 1 + offset as i64;
    let (y, m) = (total.div_euclid(12), total.rem_euclid(12) + 1);
    let first = days_from_civil(y, m, 1);
    let next = days_from_civil(y + (m == 12) as i64, if m == 12 { 1 } else { m + 1 }, 1);
    ensure().await?;
    if let Some(v) = held(|c| (c.since < first).then(|| month_of(&c.items, y, m, off))).flatten() {
        return Ok(v);
    }
    let search = format!("SINCE {} BEFORE {}", imap_date(first - 1), imap_date(next + 1));
    let list = with_live(24 * 1024 * 1024, |imap, _| { let s = search.clone(); Box::pin(async move { items(imap, &s, 5000).await }) }).await?;
    Ok(month_of(&list, y, m, off))
}

/// One day's messages ("yyyy-MM-dd"), newest first, as outlook::day_script gives them: from the
/// synced copy, else from Gmail.
pub async fn day(date: &str) -> Result<Value, String> {
    let p: Vec<i64> = date.split('-').filter_map(|x| x.parse().ok()).collect();
    let [y, m, d] = p[..] else { return Err(crate::i18n::t("Unexpected API response.")) };
    let off = local_offset_min();
    let at = days_from_civil(y, m, d);
    let on_day = |i: &Item| { let (iy, im, id, _, _) = local_parts(i.date, off); (iy, im, id) == (y, m, d) };
    ensure().await?;
    if let Some(v) = held(|c| (c.since < at).then(|| json!({ "messages": c.items.iter().rev().filter(|i| on_day(i)).map(|i| message_json(i, &c.account, off)).collect::<Vec<_>>() }))).flatten() {
        return Ok(v);
    }
    let search = format!("SINCE {} BEFORE {}", imap_date(at - 1), imap_date(at + 2));
    let (list, account) = with_live(LIMIT * 4, |imap, a| { let (s, a) = (search.clone(), a.to_string()); Box::pin(async move { Ok((items(imap, &s, 1000).await?, a)) }) }).await?;
    Ok(json!({ "messages": list.iter().rev().filter(|i| on_day(i)).map(|i| message_json(i, &account, off)).collect::<Vec<_>>() }))
}

/// Starred mail (« waiting on you »), newest first, from the synced copy.
pub async fn starred(most: usize) -> Result<Vec<Value>, String> {
    let off = local_offset_min();
    ensure().await?;
    Ok(held(|c| c.starred.iter().rev().take(most).map(|i| message_json(i, &c.account, off)).collect()).unwrap_or_default())
}

// ── The synced copy (#120) ────────────────────────────────────────────────────────────────
//
// What makes mail apps feel instant: they answer from a copy they keep and sync only what
// changed, never waiting on the server while you look (Superhuman's « 100 ms rule »; IMAP's
// own incremental sync). JARVIS keeps the inbox's last WINDOW days and the starred mail, in
// memory only (never written to disk), synced a minute apart: new mail by UID, read and star
// marks for the rest, and what left the inbox dropped.

const WINDOW: i64 = 62;

#[derive(Default, Clone)]
struct Copy {
    account: String,
    /// The first day held (days since 1970): the copy is whole from the day after.
    since: i64,
    /// Oldest first.
    items: Vec<Item>,
    starred: Vec<Item>,
    unread: usize,
    /// The first words of the newest few, by UID.
    snippets: std::collections::HashMap<u64, String>,
}

static COPY: std::sync::Mutex<Option<Copy>> = std::sync::Mutex::new(None);

fn held<T>(f: impl FnOnce(&Copy) -> T) -> Option<T> {
    COPY.lock().ok()?.as_ref().map(f)
}

/// A first sync if there's no copy yet.
async fn ensure() -> Result<(), String> {
    if held(|_| ()).is_none() {
        sync().await?;
    }
    Ok(())
}

/// What one sync found.
#[derive(Default)]
struct Delta {
    present: Vec<u64>,
    new: Vec<Item>,
    flags: Vec<(u64, bool, bool)>,
    unread: usize,
    starred: Vec<u64>,
    starred_new: Vec<Item>,
}

fn uids_of(answers: &[Answer]) -> Vec<u64> {
    answers.iter().filter_map(|a| a.text.strip_prefix("* SEARCH")).flat_map(|r| r.split_whitespace().filter_map(|n| n.parse().ok())).collect()
}

/// « * 5 FETCH (UID 4401 FLAGS (\Seen)) » → (4401, seen, flagged).
fn flags_of(a: &Answer) -> Option<(u64, bool, bool)> {
    let uid = a.text.split("UID ").nth(1)?.split([' ', ')']).next()?.parse().ok()?;
    let flags = a.text.split("FLAGS (").nth(1)?.split(')').next()?;
    Some((uid, flags.contains("\\Seen"), flags.contains("\\Flagged")))
}

async fn fetch_uids(imap: &mut Imap, uids: &[u64]) -> Result<Vec<Item>, String> {
    let mut out = Vec::new();
    for chunk in uids.chunks(250) {
        let set = chunk.iter().map(|n| n.to_string()).collect::<Vec<_>>().join(",");
        out.extend(imap.run(&format!("UID FETCH {set} {ITEM}")).await?.iter().filter_map(item_of));
    }
    Ok(out)
}

async fn delta_on(imap: &mut Imap, since: i64, known: std::collections::HashSet<u64>, known_starred: std::collections::HashSet<u64>) -> Result<Delta, String> {
    let mut d = Delta { present: uids_of(&imap.run(&format!("UID SEARCH SINCE {}", imap_date(since))).await?), ..Delta::default() };
    let new: Vec<u64> = d.present.iter().copied().filter(|u| !known.contains(u)).collect();
    d.new = fetch_uids(imap, &new).await?;
    if let (Some(lo), Some(hi)) = (known.iter().min(), known.iter().max()) {
        d.flags = imap.run(&format!("UID FETCH {lo}:{hi} (UID FLAGS)")).await?.iter().filter_map(flags_of).collect();
    }
    d.unread = imap.run("SEARCH UNSEEN").await?.iter().filter_map(|a| a.text.strip_prefix("* SEARCH")).map(|r| r.split_whitespace().count()).sum();
    d.starred = uids_of(&imap.run("UID SEARCH FLAGGED").await?);
    let starred_new: Vec<u64> = d.starred.iter().rev().take(50).copied().filter(|u| !known_starred.contains(u)).collect();
    d.starred_new = fetch_uids(imap, &starred_new).await?;
    Ok(d)
}

/// One sync: what's new, what changed, what left. The first one fetches the whole window.
pub async fn sync() -> Result<(), String> {
    let address = crate::secrets::get(ADDRESS).map(|a| a.trim().to_string()).unwrap_or_default();
    let today = days_from_civil(crate::platform::local_time().year as i64, crate::platform::local_time().month as i64, crate::platform::local_time().day as i64);
    // Another account, or none yet: from scratch.
    let mut copy = held(|c| c.clone()).filter(|c| c.account == address).unwrap_or_else(|| Copy { account: address.clone(), since: today - WINDOW, ..Copy::default() });
    let since = copy.since;
    let known: std::collections::HashSet<u64> = copy.items.iter().map(|i| i.uid).collect();
    let known_starred: std::collections::HashSet<u64> = copy.starred.iter().map(|i| i.uid).collect();
    let d = with_live(24 * 1024 * 1024, |imap, _| {
        let (k, ks) = (known.clone(), known_starred.clone());
        Box::pin(async move { delta_on(imap, since, k, ks).await })
    })
    .await?;
    let present: std::collections::HashSet<u64> = d.present.iter().copied().collect();
    let flags: std::collections::HashMap<u64, (bool, bool)> = d.flags.iter().map(|&(u, s, f)| (u, (s, f))).collect();
    copy.items.retain(|i| present.contains(&i.uid));
    copy.items.extend(d.new);
    let starred: std::collections::HashSet<u64> = d.starred.iter().copied().collect();
    copy.starred.retain(|i| starred.contains(&i.uid));
    copy.starred.extend(d.starred_new);
    for i in copy.items.iter_mut().chain(copy.starred.iter_mut()) {
        if let Some(&(seen, flagged)) = flags.get(&i.uid) {
            i.seen = seen;
            i.flagged = flagged;
        }
        if starred.contains(&i.uid) {
            i.flagged = true;
        }
    }
    copy.items.sort_by_key(|i| i.date);
    copy.starred.sort_by_key(|i| i.date);
    copy.unread = d.unread;
    // The first words of the newest three, once each.
    let want: Vec<u64> = copy.items.iter().rev().take(3).map(|i| i.uid).filter(|u| !copy.snippets.contains_key(u)).collect();
    if !want.is_empty() {
        let set = want.iter().map(|n| n.to_string()).collect::<Vec<_>>().join(",");
        let answers = with_live(LIMIT, |imap, _| { let s = set.clone(); Box::pin(async move { imap.run(&format!("UID FETCH {s} (UID BODY.PEEK[1]<0.1500>)")).await }) }).await?;
        for a in &answers {
            let Some(uid) = a.text.split("UID ").nth(1).and_then(|r| r.split([' ', ')']).next()).and_then(|n| n.parse::<u64>().ok()) else { continue };
            let text = a.lits.first().map(|b| snippet(b)).unwrap_or_default();
            copy.snippets.insert(uid, text);
        }
    }
    let keep: std::collections::HashSet<u64> = copy.items.iter().rev().take(10).map(|i| i.uid).collect();
    copy.snippets.retain(|u, _| keep.contains(u));
    if let Ok(mut c) = COPY.lock() {
        *c = Some(copy);
    }
    Ok(())
}

/// The pill: the latest mail (read or not) with its first words, the next two, the unread count.
fn pill() -> Option<Value> {
    held(|c| {
        let mails: Vec<Value> = c.items.iter().rev().take(SHOWN).map(|i| json!({
            "from": i.name, "subject": i.subject, "snippet": c.snippets.get(&i.uid).cloned().unwrap_or_default(),
            "date": i.date, "thread": i.thread, "unread": !i.seen,
        })).collect();
        json!({ "email": c.account, "unread": c.unread, "mails": mails })
    })
}

/// Synced a minute apart while Gmail is connected (the Mail page reads the copy whether or not
/// the pill is on); the pill is told after each sync. Nothing while JARVIS is paused.
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(5)).await;
        loop {
            if configured() && !integrations::PAUSED.load(std::sync::atomic::Ordering::Relaxed) {
                poll(app.clone()).await;
            }
            tokio::time::sleep(Duration::from_secs(60)).await;
        }
    });
}

/// A message's first `most` characters and its files, for the page's card.
pub async fn detail(entry_id: &str, most: usize) -> Result<(String, Vec<String>), String> {
    let uid: u64 = entry_id.split(':').next().and_then(|u| u.parse().ok()).ok_or_else(|| crate::i18n::t("Unexpected API response."))?;
    let answers = with_live(LIMIT, |imap, _| Box::pin(async move { imap.run(&format!("UID FETCH {uid} (UID BODYSTRUCTURE BODY.PEEK[HEADER.FIELDS (FROM SUBJECT)] BODY.PEEK[1]<0.8000>)")).await })).await?;
    let a = answers.iter().find(|a| a.text.contains("FETCH")).ok_or_else(|| crate::i18n::t("Unexpected API response."))?;
    let files = item_of(a).map(|i| i.files).unwrap_or_default();
    let text = a.text.find("BODY[1]").and_then(|i| a.text[i..].split("{#").nth(1)).and_then(|r| r.split('}').next()).and_then(|i| i.parse::<usize>().ok()).and_then(|i| a.lits.get(i)).map(|b| snippet_of(b, most)).unwrap_or_default();
    Ok((text, files))
}

/// A Gmail message of the page opened in Gmail.
pub fn open_message(account: &str, entry_id: &str) {
    open(account, entry_id.split(':').nth(1).unwrap_or(""));
}

pub async fn poll(app: AppHandle) {
    if !configured() {
        return;
    }
    let result = sync().await.and_then(|_| pill().ok_or_else(|| crate::i18n::t("Not connected")));
    if !integrations::enabled(&app, ID) {
        return;
    }
    let (data, error) = match result {
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
        // A Q text that starts with « = » (an emoji first): not cut at « Q?= ».
        assert_eq!(header_text("=?UTF-8?Q?=F0=9F=8E=A8_New_shots?="), "🎨 New shots");
        assert_eq!(header_text("=?utf-8?B?8J+OqA==?= New"), "🎨 New");
        assert_eq!(header("From: \"Sam Example\"\r\n <sam@example.com>\r\nSubject: Hi\r\n", "From"), "\"Sam Example\" <sam@example.com>");
        assert_eq!(sender("\"Sam Example\" <sam@example.com>"), "Sam Example");
        assert_eq!(sender("<sam@example.com>"), "sam@example.com");
        assert_eq!(snippet(b"Hello =3D there,=\r\n see you"), "Hello = there, see you");
        assert_eq!(snippet(b"<html><style>p{}</style><p>Hi&nbsp;Sam</p></html>"), "Hi Sam");
        assert_eq!(snippet(b"SGVsbG8gdGhlcmUsIHRoaXMgaXMgYmFzZTY0IHRleHQ="), "Hello there, this is base64 text");
        // A newsletter's CSS isn't its first line (#120: « .mj-outlook-group-fix { width:100% } »).
        assert_eq!(snippet(b".mj-outlook-group-fix { width:100% !important; } <!--[if mso]><x></x><![endif]--><p>Someone mentioned you</p>"), "Someone mentioned you");
        assert_eq!(snippet(b"<html><head><title>x</title><style>p{color:red}"), "");
        assert_eq!(snippet("Caf\u{e9} <STYLE>a{}</STYLE>ouvert".as_bytes()), "Caf\u{e9} ouvert");
        assert_eq!(internal_date("01-Jan-1970 01:00:00 +0100"), 0);
        assert_eq!(internal_date("26-Nov-2026 09:42:00 +0000"), 1795686120000);
        assert_eq!(literal("* 3 FETCH (BODY[1]<0> {42}"), Some(42));
        for z in [-1, 0, 19000, 20783] {
            let (y, m, d) = civil_from_days(z);
            assert_eq!(days_from_civil(y, m, d), z);
        }
        assert_eq!(imap_date(days_from_civil(2026, 11, 1)), "1-Nov-2026");
        assert_eq!(local_parts(internal_date("26-Nov-2026 23:30:00 +0000"), 60), (2026, 11, 27, 0, 30));
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

    #[test]
    fn a_page_item_has_its_flags_sender_and_files() {
        let a = Answer {
            text: "* 12 FETCH (UID 4401 X-GM-THRID 255 INTERNALDATE \"26-Nov-2026 09:42:00 +0000\" FLAGS (\\Flagged) BODYSTRUCTURE ((\"TEXT\" \"PLAIN\") (\"APPLICATION\" \"PDF\" (\"NAME\" \"invoice.pdf\") NIL NIL \"BASE64\" 100 NIL (\"ATTACHMENT\" (\"FILENAME\" \"invoice.pdf\"))) \"MIXED\") BODY[HEADER.FIELDS (FROM SUBJECT)] {#0})".into(),
            lits: vec![b"From: Acme Billing <Billing@Acme.example>\r\nSubject: Invoice\r\n\r\n".to_vec()],
        };
        let i = item_of(&a).unwrap();
        assert_eq!((i.uid, i.seen, i.flagged), (4401, false, true));
        assert_eq!((i.name.as_str(), i.address.as_str(), i.thread.as_str()), ("Acme Billing", "billing@acme.example", "ff"));
        assert_eq!(i.files, vec!["invoice.pdf"]);
        let m = message_json(&i, "me@gmail.com", 0);
        assert_eq!(m["entryId"], "4401:ff");
        assert_eq!(m["storeId"], "gmail");
        assert_eq!(m["hour"], 9);
    }
}


