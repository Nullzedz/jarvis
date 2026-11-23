//! JARVIS: the island's clipboard history (docs/jarvis/design/SPEC.md §7).
//!
//! What you copy, newest first, the last 30: text, and images too (a small picture for
//! the island, the full image kept so it can be copied again). Kept in memory only, never
//! written to disk, and gone when JARVIS quits. Pinned copies stay on top and aren't
//! pushed out. Skipped, like Windows' own clipboard history skips them: what a password
//! manager marks as private, and what asks to be kept out of the history (dictation's
//! paste does).

use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

const KEEP: usize = 30;
const LONGEST: usize = 4_000; // characters kept of one copy
/// Full images kept to copy again (the newest); older ones keep only their picture.
const KEEP_IMAGES: usize = 8;
/// An image bigger than this (RGBA bytes, about 8K × 4K) keeps only its picture.
const BIGGEST_IMAGE: usize = 128 * 1024 * 1024;
/// The island's picture of an image: at most this wide and high.
const THUMB_W: u32 = 160;
const THUMB_H: u32 = 96;

#[derive(Clone, Serialize)]
pub struct Clip {
    pub id: u64,
    /// "text" or "image". What kind of text (link, email, code) the island reads itself.
    pub kind: &'static str,
    /// The text; for an image, its size ("1280 × 720").
    pub text: String,
    /// When it was copied, in milliseconds since 1970.
    pub at: u64,
    pub pinned: bool,
    /// An image's small picture, as a data: URL (JPEG).
    pub thumb: Option<String>,
}

struct Entry {
    clip: Clip,
    /// An image's own pixels (RGBA), to put it back on the clipboard.
    image: Option<(usize, usize, Vec<u8>)>,
    /// Tells two images apart without comparing every byte twice.
    hash: u64,
}

static CLIPS: Mutex<VecDeque<Entry>> = Mutex::new(VecDeque::new());
static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn fnv(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

/// Puts an entry on top: the same copy again just moves up (keeping its pin); pinned
/// copies are never pushed out, the rest are cut to KEEP; only the newest images keep
/// their full pixels.
fn add(text: String, kind: &'static str, thumb: Option<String>, image: Option<(usize, usize, Vec<u8>)>) -> bool {
    let hash = match &image {
        Some((w, h, px)) => fnv(px) ^ ((*w as u64) << 32) ^ (*h as u64),
        None => fnv(text.as_bytes()),
    };
    let mut clips = CLIPS.lock().unwrap();
    if clips.front().is_some_and(|e| e.hash == hash && e.clip.kind == kind) {
        return false;
    }
    let mut pinned = false;
    clips.retain(|e| {
        let same = e.hash == hash && e.clip.kind == kind;
        if same {
            pinned |= e.clip.pinned;
        }
        !same
    });
    let id = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    clips.push_front(Entry { clip: Clip { id, kind, text, at: now_ms(), pinned, thumb }, image, hash });
    // Cut the unpinned ones past KEEP.
    let mut unpinned = 0;
    clips.retain(|e| {
        if e.clip.pinned {
            return true;
        }
        unpinned += 1;
        unpinned <= KEEP
    });
    let mut images = 0;
    for e in clips.iter_mut() {
        if e.image.is_some() {
            images += 1;
            if images > KEEP_IMAGES && !e.clip.pinned {
                e.image = None;
            }
        }
    }
    true
}

/// A copied text.
fn push(text: String) -> bool {
    let text: String = text.chars().take(LONGEST).collect();
    if text.trim().is_empty() {
        return false;
    }
    add(text, "text", None, None)
}

/// A copied image: its picture for the island, its pixels to copy it again.
fn push_image(w: usize, h: usize, rgba: Vec<u8>) -> bool {
    if w == 0 || h == 0 || rgba.len() < w * h * 4 {
        return false;
    }
    let thumb = thumbnail(w, h, &rgba);
    let keep = (rgba.len() <= BIGGEST_IMAGE).then_some((w, h, rgba));
    add(format!("{w} × {h}"), "image", thumb, keep)
}

/// A small JPEG of the image (at most THUMB_W × THUMB_H, nearest pixel), as a data: URL.
/// Transparent pixels show on the island's dark card colour.
fn thumbnail(w: usize, h: usize, rgba: &[u8]) -> Option<String> {
    let scale = (THUMB_W as f64 / w as f64).min(THUMB_H as f64 / h as f64).min(1.0);
    let tw = ((w as f64 * scale).round() as usize).max(1);
    let th = ((h as f64 * scale).round() as usize).max(1);
    let mut rgb = Vec::with_capacity(tw * th * 3);
    for y in 0..th {
        let sy = (y * h / th).min(h - 1);
        for x in 0..tw {
            let sx = (x * w / tw).min(w - 1);
            let i = (sy * w + sx) * 4;
            let a = rgba[i + 3] as u32;
            // Over #1c1c1e.
            let over = |c: u8, bg: u32| ((c as u32 * a + bg * (255 - a)) / 255) as u8;
            rgb.push(over(rgba[i], 0x1c));
            rgb.push(over(rgba[i + 1], 0x1c));
            rgb.push(over(rgba[i + 2], 0x1e));
        }
    }
    let mut out = Vec::new();
    jpeg_encoder::Encoder::new(&mut out, 80)
        .encode(&rgb, tw as u16, th as u16, jpeg_encoder::ColorType::Rgb)
        .ok()?;
    Some(format!("data:image/jpeg;base64,{}", base64(&out)))
}

fn base64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut s = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for c in bytes.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        s.push(T[(n >> 18) as usize & 63] as char);
        s.push(T[(n >> 12) as usize & 63] as char);
        s.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        s.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    s
}

#[cfg(windows)]
fn private_or_excluded() -> bool {
    use windows::core::w;
    use windows::Win32::System::DataExchange::{IsClipboardFormatAvailable, RegisterClipboardFormatW};
    unsafe {
        [
            w!("ExcludeClipboardContentFromMonitorProcessing"),
            w!("CanIncludeInClipboardHistory"),
            w!("Clipboard Viewer Ignore"),
        ]
        .iter()
        .any(|name| {
            let f = RegisterClipboardFormatW(*name);
            f != 0 && IsClipboardFormatAvailable(f).is_ok()
        })
    }
}

#[cfg(windows)]
fn sequence() -> u32 {
    unsafe { windows::Win32::System::DataExchange::GetClipboardSequenceNumber() }
}

/// Watches the clipboard (its sequence number, a cheap check) and tells the island.
pub fn setup(app: &AppHandle) {
    #[cfg(windows)]
    {
        let app = app.clone();
        let _ = std::thread::Builder::new().name("jarvis-clipboard".into()).spawn(move || {
            let mut seen = sequence();
            let mut board = arboard::Clipboard::new().ok();
            loop {
                std::thread::sleep(Duration::from_millis(600));
                let now = sequence();
                if now == seen {
                    continue;
                }
                seen = now;
                if private_or_excluded() {
                    continue;
                }
                if board.is_none() {
                    board = arboard::Clipboard::new().ok();
                }
                let Some(b) = board.as_mut() else { continue };
                // Text first (a link copied from a page is text, even with a picture beside it).
                let added = match b.get_text() {
                    Ok(text) => push(text),
                    Err(_) => match b.get_image() {
                        Ok(img) => push_image(img.width, img.height, img.bytes.into_owned()),
                        Err(_) => false,
                    },
                };
                if added {
                    let _ = app.emit("clipboard-history", list());
                }
            }
        });
    }
    #[cfg(not(windows))]
    let _ = app;
}

fn list() -> Vec<Clip> {
    CLIPS.lock().unwrap().iter().map(|e| e.clip.clone()).collect()
}

/// The history, newest first.
#[tauri::command]
pub fn clipboard_history() -> Vec<Clip> {
    list()
}

/// Puts an old copy back on the clipboard (it moves to the top). An image whose pixels
/// were let go (an older one) can't be.
#[tauri::command]
pub fn clipboard_use(app: AppHandle, id: u64) -> bool {
    let found = {
        let clips = CLIPS.lock().unwrap();
        clips.iter().find(|e| e.clip.id == id).map(|e| (e.clip.text.clone(), e.image.clone()))
    };
    let Some((text, image)) = found else { return false };
    let Ok(mut b) = arboard::Clipboard::new() else { return false };
    let ok = match image {
        Some((w, h, px)) => {
            let set = b.set_image(arboard::ImageData { width: w, height: h, bytes: px.clone().into() }).is_ok();
            if set {
                push_image(w, h, px);
            }
            set
        }
        None if CLIPS.lock().unwrap().iter().any(|e| e.clip.id == id && e.clip.kind == "image") => false,
        None => {
            let set = b.set_text(text.clone()).is_ok();
            if set {
                push(text);
            }
            set
        }
    };
    if ok {
        let _ = app.emit("clipboard-history", list());
    }
    ok
}

/// Pins a copy (it stays on top and is never pushed out) or lets it go again.
#[tauri::command]
pub fn clipboard_pin(app: AppHandle, id: u64, on: bool) {
    if let Some(e) = CLIPS.lock().unwrap().iter_mut().find(|e| e.clip.id == id) {
        e.clip.pinned = on;
    }
    let _ = app.emit("clipboard-history", list());
}

/// Forgets one copy (swiped away in the island), pinned or not: its text and its pixels.
#[tauri::command]
pub fn clipboard_remove(app: AppHandle, id: u64) {
    CLIPS.lock().unwrap().retain(|e| e.clip.id != id);
    let _ = app.emit("clipboard-history", list());
}

/// Forgets the history, all but what's pinned.
#[tauri::command]
pub fn clipboard_clear(app: AppHandle) {
    CLIPS.lock().unwrap().retain(|e| e.clip.pinned);
    let _ = app.emit("clipboard-history", list());
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The history is one for the whole app: the tests take turns with it.
    static TURN: Mutex<()> = Mutex::new(());

    fn texts() -> Vec<String> {
        list().into_iter().map(|c| c.text).collect()
    }

    #[test]
    fn newest_first_no_duplicates_capped_pins_kept() {
        let _turn = TURN.lock().unwrap_or_else(|e| e.into_inner());
        CLIPS.lock().unwrap().clear();
        assert!(push("a".into()));
        assert!(push("b".into()));
        assert!(!push("b".into()), "the same text twice in a row is one copy");
        assert!(push("a".into()), "copied again, it moves to the top");
        assert_eq!(texts(), ["a", "b"]);
        assert!(!push("   ".into()), "blank copies are skipped");
        let b = list()[1].id;
        CLIPS.lock().unwrap().iter_mut().find(|e| e.clip.id == b).unwrap().clip.pinned = true;
        for i in 0..40 {
            push(format!("x{i}"));
        }
        let all = list();
        assert_eq!(all.iter().filter(|c| !c.pinned).count(), KEEP);
        assert!(all.iter().any(|c| c.text == "b" && c.pinned), "a pinned copy is never pushed out");
        push("b".into());
        assert!(list()[0].pinned, "copied again, it keeps its pin");
        CLIPS.lock().unwrap().clear();
    }

    #[test]
    fn images_get_a_picture_and_only_the_newest_keep_pixels() {
        let _turn = TURN.lock().unwrap_or_else(|e| e.into_inner());
        CLIPS.lock().unwrap().clear();
        let img = |v: u8| vec![v; 400 * 300 * 4];
        assert!(push_image(400, 300, img(10)));
        assert!(!push_image(400, 300, img(10)), "the same image twice is one copy");
        let first = &list()[0];
        assert_eq!(first.kind, "image");
        assert_eq!(first.text, "400 × 300");
        assert!(first.thumb.as_deref().unwrap().starts_with("data:image/jpeg;base64,/9j/"));
        for v in 0..(KEEP_IMAGES as u8 + 2) {
            push_image(400, 300, img(20 + v));
        }
        let kept = CLIPS.lock().unwrap().iter().filter(|e| e.image.is_some()).count();
        assert_eq!(kept, KEEP_IMAGES);
        CLIPS.lock().unwrap().clear();
    }

    #[test]
    fn base64_matches_the_standard() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }
}
