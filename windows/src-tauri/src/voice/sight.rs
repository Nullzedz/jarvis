// JARVIS: what he sees. A picture of the screen under the pointer, or of the part
// you circled (circle.rs), taken when you ask and sent with the question to the
// brain (brain.rs). Nothing is captured otherwise, and nothing is kept.
//
// - Whole screen: the monitor the pointer is on.
// - Circled: just that area, with your circle drawn on the picture in blue so he
//   knows exactly what you meant.
//
// Made for no lag, as Roamies and computer-use agents do it:
// - Only the copy of the screen happens when you let go (a few ms): GDI scales it
//   to its final size in the same step (StretchBlt, HALFTONE), so no pixel loop.
// - The JPEG is made on its own thread while you type or Parakeet reads your
//   words; the brain waits for it only if it isn't ready yet (`Pending::wait`).
// - Small pictures: the whole screen at most 1280 px wide (Anthropic's advice for
//   screenshots: fewer image tokens, a faster first word), a circled area at most
//   1568; JPEG at quality 80 is a few times smaller than PNG to upload.
//
// JARVIS's own windows (the pill, the ask box) are left out of every capture
// (`hide_from_capture`), so he never sees himself.

use std::time::Instant;

use super::circle::Pt;

/// The longest side of a picture of the whole screen, and of a circled area.
const WHOLE: u32 = 1280;
const AREA: u32 = 1568;
const QUALITY: u8 = 80;

/// One picture, ready for the brain.
#[derive(Clone)]
pub struct Shot {
    /// JPEG, base64.
    pub data: String,
    /// What it shows: "the whole screen" or "the part you circled".
    pub what: &'static str,
    /// The picture's size (px), and the part of the screen it shows (physical px):
    /// his pointing on the picture maps back to the screen through these.
    pub size: (u32, u32),
    pub screen: (i32, i32, i32, i32),
}

impl Shot {
    /// A point on the picture → the same point on the screen (physical px).
    pub fn to_screen(&self, x: f64, y: f64) -> (f64, f64) {
        let (sx, sy, sw, sh) = self.screen;
        (sx as f64 + x * sw as f64 / self.size.0 as f64, sy as f64 + y * sh as f64 / self.size.1 as f64)
    }
}

/// A picture being made (on its own thread).
pub struct Pending(std::thread::JoinHandle<Option<Shot>>);

impl Pending {
    pub fn wait(self) -> Option<Shot> {
        self.0.join().ok().flatten()
    }
}

/// The monitor under (x, y), as (x, y, w, h) in physical pixels, and its scale.
pub fn monitor_at(x: f64, y: f64) -> Option<((i32, i32, i32, i32), f64)> {
    os::monitor_at(x, y)
}

/// (w, h) shrunk to fit `longest` on its long side, never enlarged.
fn fit(w: i32, h: i32, longest: u32) -> (u32, u32) {
    let k = (longest as f64 / w.max(h) as f64).min(1.0);
    (((w as f64 * k).round() as u32).max(1), ((h as f64 * k).round() as u32).max(1))
}

/// The monitor the pointer is on.
pub fn whole_screen() -> Option<Pending> {
    let (cx, cy) = crate::platform::cursor_physical()?;
    let (rect, _) = monitor_at(cx, cy)?;
    let (tw, th) = fit(rect.2, rect.3, WHOLE);
    let took = Instant::now();
    let bgra = os::grab(rect, (tw, th))?;
    let grab_ms = took.elapsed().as_millis();
    Some(Pending(std::thread::spawn(move || encode(tw, th, bgra, "the whole screen", rect, grab_ms))))
}

/// The circled area (kept on the circle's monitor), the circle drawn on it.
pub fn circled(area: (i32, i32, i32, i32), circle: &[Pt]) -> Option<Pending> {
    let (x, y, w, h) = area;
    let (mon, scale) = monitor_at((x + w / 2) as f64, (y + h / 2) as f64)?;
    let (x0, y0) = (x.max(mon.0), y.max(mon.1));
    let (x1, y1) = ((x + w).min(mon.0 + mon.2), (y + h).min(mon.1 + mon.3));
    if x1 - x0 < 8 || y1 - y0 < 8 {
        return None;
    }
    let (tw, th) = fit(x1 - x0, y1 - y0, AREA);
    let k = tw as f64 / (x1 - x0) as f64;
    let took = Instant::now();
    let mut bgra = os::grab((x0, y0, x1 - x0, y1 - y0), (tw, th))?;
    let grab_ms = took.elapsed().as_millis();
    let local: Vec<Pt> = circle.iter().map(|&(px, py)| ((px - x0 as f64) * k, (py - y0 as f64) * k)).collect();
    Some(Pending(std::thread::spawn(move || {
        draw_loop(&mut bgra, tw, th, &local, (2.5 * scale * k).max(2.0));
        encode(tw, th, bgra, "the part you circled", (x0, y0, x1 - x0, y1 - y0), grab_ms)
    })))
}

fn encode(w: u32, h: u32, bgra: Vec<u8>, what: &'static str, screen: (i32, i32, i32, i32), grab_ms: u128) -> Option<Shot> {
    let took = Instant::now();
    let mut out = Vec::new();
    let made = jpeg_encoder::Encoder::new(&mut out, QUALITY).encode(&bgra, w as u16, h as u16, jpeg_encoder::ColorType::Bgra);
    if let Err(err) = made {
        crate::log::line(format!("sight: {what} could not be made: {err}"));
        return None;
    }
    crate::log::line(format!("sight: {what}, {w}×{h}, {} KB, copied in {grab_ms} ms, made in {} ms", out.len() / 1024, took.elapsed().as_millis()));
    Some(Shot { data: super::base64(&out), what, size: (w, h), screen })
}

/// The circle in JARVIS's blue, `thick` px wide, onto the picture (BGRA).
fn draw_loop(bgra: &mut [u8], w: u32, h: u32, pts: &[Pt], thick: f64) {
    const BLUE: [u8; 3] = [0xff, 0xa3, 0x4f]; // #4fa3ff as B, G, R
    let r = thick / 2.0;
    let mut dot = |cx: f64, cy: f64| {
        let (x0, x1) = ((cx - r).floor().max(0.0) as u32, (cx + r).ceil().min(w as f64 - 1.0).max(0.0) as u32);
        let (y0, y1) = ((cy - r).floor().max(0.0) as u32, (cy + r).ceil().min(h as f64 - 1.0).max(0.0) as u32);
        for y in y0..=y1 {
            for x in x0..=x1 {
                if (x as f64 - cx).hypot(y as f64 - cy) <= r {
                    let i = ((y * w + x) * 4) as usize;
                    bgra[i..i + 3].copy_from_slice(&BLUE);
                }
            }
        }
    };
    for pair in pts.windows(2).chain(std::iter::once(&[pts[pts.len() - 1], pts[0]][..]).filter(|_| pts.len() > 2)) {
        let (a, b) = (pair[0], pair[1]);
        let steps = ((b.0 - a.0).hypot(b.1 - a.1) / (r.max(1.0) * 0.5)).ceil().max(1.0) as usize;
        for s in 0..=steps {
            let t = s as f64 / steps as f64;
            dot(a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t);
        }
    }
}

/// Keeps a JARVIS window out of every screen capture (his own and anyone else's).
pub fn hide_from_capture(win: &tauri::WebviewWindow) {
    os::hide_from_capture(win);
}

#[cfg(windows)]
mod os {
    use windows::Win32::Foundation::{HWND, POINT, RECT};
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, GetMonitorInfoW,
        MonitorFromPoint, ReleaseDC, SelectObject, SetBrushOrgEx, SetStretchBltMode, StretchBlt, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS, HALFTONE, MONITORINFO, MONITOR_DEFAULTTONEAREST, SRCCOPY,
    };
    use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE};

    pub fn monitor_at(x: f64, y: f64) -> Option<((i32, i32, i32, i32), f64)> {
        unsafe {
            let mon = MonitorFromPoint(POINT { x: x as i32, y: y as i32 }, MONITOR_DEFAULTTONEAREST);
            let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
            if !GetMonitorInfoW(mon, &mut info).as_bool() {
                return None;
            }
            let RECT { left, top, right, bottom } = info.rcMonitor;
            let (mut dx, mut dy) = (96u32, 96u32);
            let scale = if GetDpiForMonitor(mon, MDT_EFFECTIVE_DPI, &mut dx, &mut dy).is_ok() { dx as f64 / 96.0 } else { 1.0 };
            Some(((left, top, right - left, bottom - top), scale))
        }
    }

    /// The screen's pixels in (x, y, w, h), scaled by GDI to (tw, th) as they're copied; BGRA.
    pub fn grab((x, y, w, h): (i32, i32, i32, i32), (tw, th): (u32, u32)) -> Option<Vec<u8>> {
        if w <= 0 || h <= 0 {
            return None;
        }
        let (tw, th) = (tw as i32, th as i32);
        unsafe {
            let screen = GetDC(None);
            if screen.is_invalid() {
                return None;
            }
            let mem = CreateCompatibleDC(Some(screen));
            let bmp = CreateCompatibleBitmap(screen, tw, th);
            let old = SelectObject(mem, bmp.into());
            // HALFTONE averages the pixels it drops, so small text stays readable.
            SetStretchBltMode(mem, HALFTONE);
            let _ = SetBrushOrgEx(mem, 0, 0, None);
            let copied = StretchBlt(mem, 0, 0, tw, th, Some(screen), x, y, w, h, SRCCOPY | CAPTUREBLT).as_bool();
            let mut info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: tw,
                    biHeight: -th, // top row first
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut bgra = vec![0u8; (tw * th * 4) as usize];
            let rows = if copied {
                GetDIBits(mem, bmp, 0, th as u32, Some(bgra.as_mut_ptr().cast()), &mut info, DIB_RGB_COLORS)
            } else {
                0
            };
            SelectObject(mem, old);
            let _ = DeleteObject(bmp.into());
            let _ = DeleteDC(mem);
            ReleaseDC(None, screen);
            (rows != 0).then_some(bgra)
        }
    }

    pub fn hide_from_capture(win: &tauri::WebviewWindow) {
        if let Ok(raw) = win.hwnd() {
            unsafe {
                let _ = SetWindowDisplayAffinity(HWND(raw.0 as _), WDA_EXCLUDEFROMCAPTURE);
            }
        }
    }
}

#[cfg(not(windows))]
mod os {
    pub fn monitor_at(_x: f64, _y: f64) -> Option<((i32, i32, i32, i32), f64)> {
        None
    }
    pub fn grab(_r: (i32, i32, i32, i32), _to: (u32, u32)) -> Option<Vec<u8>> {
        None
    }
    pub fn hide_from_capture(_win: &tauri::WebviewWindow) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_big_screen_is_shrunk_to_the_longest_side_and_keeps_its_shape() {
        assert_eq!(fit(3840, 2160, WHOLE), (1280, 720));
        assert_eq!(fit(1080, 1920, WHOLE), (720, 1280));
        assert_eq!(fit(300, 200, AREA), (300, 200));
    }

    #[test]
    fn the_circle_is_drawn_in_blue_and_nothing_else_is_touched() {
        let (w, h) = (100u32, 100u32);
        let mut bgra = vec![0u8; (w * h * 4) as usize];
        let ring: Vec<Pt> = (0..40).map(|i| {
            let a = std::f64::consts::TAU * i as f64 / 40.0;
            (50.0 + 30.0 * a.cos(), 50.0 + 30.0 * a.sin())
        }).collect();
        draw_loop(&mut bgra, w, h, &ring, 3.0);
        let at = |x: u32, y: u32| &bgra[((y * w + x) * 4) as usize..((y * w + x) * 4 + 3) as usize];
        assert_eq!(at(80, 50), [0xff, 0xa3, 0x4f]);
        assert_eq!(at(50, 50), [0, 0, 0]);
        assert_eq!(at(2, 2), [0, 0, 0]);
    }

    #[test]
    fn the_picture_is_a_jpeg() {
        let shot = encode(4, 3, vec![255u8; 4 * 3 * 4], "the whole screen", (0, 0, 8, 6), 0).unwrap();
        assert!(shot.data.starts_with("/9j/"));
        // Half the screen's size: a point on it is twice as far on the screen.
        assert_eq!(shot.to_screen(2.0, 1.5), (4.0, 3.0));
    }

    /// A real picture of the screen (run by hand: cargo test --lib real_capture -- --ignored --nocapture).
    #[test]
    #[ignore]
    fn real_capture() {
        let took = std::time::Instant::now();
        let pending = whole_screen().expect("a copy");
        println!("copied in {:?}", took.elapsed());
        let shot = pending.wait().expect("a picture");
        println!("ready in {:?}, {} KB", took.elapsed(), shot.data.len() * 3 / 4 / 1024);
        let ring: Vec<Pt> = (0..40).map(|i| {
            let a = std::f64::consts::TAU * i as f64 / 40.0;
            (300.0 + 60.0 * a.cos(), 300.0 + 60.0 * a.sin())
        }).collect();
        assert!(circled((210, 210, 180, 180), &ring).and_then(Pending::wait).is_some());
    }
}
