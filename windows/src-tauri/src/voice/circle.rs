// JARVIS: circling something on screen while a shortcut is held (talk or ask),
// Roamies' idea written for JARVIS. The mouse isn't clicked: while the keys are
// held, the pointer's path is followed, and once it comes back round something
// — a loop with room inside — that loop is the circle. One circle per press;
// lines and scribbles that never close are ignored.
//
// Points are in physical screen pixels; `scale` is the monitor's (1.0 at 96 dpi),
// so the sizes below feel the same on every screen.

pub type Pt = (f64, f64);

/// A loop is closed when the pointer comes back this near an earlier point (px at 96 dpi).
const CLOSE_GAP: f64 = 30.0;
/// ...after travelling at least this far (a tiny wiggle isn't a circle).
const MIN_RUN: f64 = 120.0;
/// Each side of the loop's box at least this long.
const MIN_SIDE: f64 = 28.0;
/// The loop's area at least this share of its box (a closed zigzag or a sliver isn't round anything).
const MIN_FILL: f64 = 0.3;
/// Moves smaller than this aren't kept (jitter).
const STEP: f64 = 3.0;

#[derive(Default)]
pub struct Ink {
    pts: Vec<Pt>,
    closed: Option<Vec<Pt>>,
    scale: f64,
}

impl Ink {
    pub fn new(scale: f64) -> Self {
        Ink { pts: Vec::new(), closed: None, scale: if scale > 0.0 { scale } else { 1.0 } }
    }

    /// One position of the pointer. True when this one closed the circle.
    pub fn feed(&mut self, p: Pt) -> bool {
        if self.closed.is_some() {
            return false;
        }
        if let Some(&last) = self.pts.last() {
            if dist(last, p) < STEP * self.scale {
                return false;
            }
        }
        self.pts.push(p);
        if let Some(start) = closing(&self.pts, self.scale) {
            self.closed = Some(self.pts[start..].to_vec());
            return true;
        }
        false
    }

    /// The circle, once drawn.
    pub fn circle(&self) -> Option<&[Pt]> {
        self.closed.as_deref()
    }

    /// The path so far (for the trail on screen).
    pub fn path(&self) -> &[Pt] {
        &self.pts
    }

    /// The part of the screen to look at: the circle's box with some room round
    /// it (a quarter of its size, at least 24 px), as (x, y, w, h).
    pub fn area(&self) -> Option<(i32, i32, i32, i32)> {
        let c = self.closed.as_ref()?;
        let (x0, y0, x1, y1) = bounds(c);
        let pad = ((x1 - x0).max(y1 - y0) * 0.25).max(24.0 * self.scale);
        let (x, y) = ((x0 - pad).floor(), (y0 - pad).floor());
        Some((x as i32, y as i32, (x1 + pad - x).ceil() as i32, (y1 + pad - y).ceil() as i32))
    }
}

fn dist(a: Pt, b: Pt) -> f64 {
    (a.0 - b.0).hypot(a.1 - b.1)
}

fn bounds(q: &[Pt]) -> (f64, f64, f64, f64) {
    q.iter().fold((f64::MAX, f64::MAX, f64::MIN, f64::MIN), |b, p| (b.0.min(p.0), b.1.min(p.1), b.2.max(p.0), b.3.max(p.1)))
}

/// The area inside the loop (shoelace), closing it from its last point back to its first.
fn area(q: &[Pt]) -> f64 {
    let n = q.len();
    (0..n).map(|i| {
        let (a, b) = (q[i], q[(i + 1) % n]);
        a.0 * b.1 - b.0 * a.1
    }).sum::<f64>().abs() / 2.0
}

/// Where the loop the newest point just closed begins, if it did.
fn closing(p: &[Pt], scale: f64) -> Option<usize> {
    let end = *p.last()?;
    let mut run = 0.0;
    for i in (0..p.len() - 1).rev() {
        run += dist(p[i], p[i + 1]);
        if run < MIN_RUN * scale || dist(p[i], end) > CLOSE_GAP * scale {
            continue;
        }
        let q = &p[i..];
        let (x0, y0, x1, y1) = bounds(q);
        let (w, h) = (x1 - x0, y1 - y0);
        if w >= MIN_SIDE * scale && h >= MIN_SIDE * scale && area(q) >= MIN_FILL * w * h {
            return Some(i);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ring(cx: f64, cy: f64, r: f64, turns: f64, steps: usize) -> Vec<Pt> {
        (0..=steps).map(|i| {
            let a = turns * std::f64::consts::TAU * i as f64 / steps as f64;
            (cx + r * a.cos(), cy + r * a.sin())
        }).collect()
    }

    fn feed(ink: &mut Ink, pts: &[Pt]) -> bool {
        pts.iter().fold(false, |done, &p| ink.feed(p) || done)
    }

    #[test]
    fn going_round_a_button_is_a_circle_and_its_area_has_room() {
        let mut ink = Ink::new(1.0);
        assert!(feed(&mut ink, &ring(500.0, 300.0, 40.0, 1.05, 60)));
        let (x, y, w, h) = ink.area().unwrap();
        assert!(x < 460 && y < 260 && x + w > 540 && y + h > 340);
    }

    #[test]
    fn a_straight_line_or_a_line_drawn_back_is_not_a_circle() {
        let mut ink = Ink::new(1.0);
        let there: Vec<Pt> = (0..60).map(|i| (100.0 + i as f64 * 5.0, 200.0)).collect();
        let back: Vec<Pt> = there.iter().rev().map(|&(x, y)| (x, y + 4.0)).collect();
        assert!(!feed(&mut ink, &there));
        assert!(!feed(&mut ink, &back));
        assert!(ink.circle().is_none());
    }

    #[test]
    fn a_tiny_wiggle_is_not_a_circle() {
        let mut ink = Ink::new(1.0);
        assert!(!feed(&mut ink, &ring(500.0, 300.0, 8.0, 3.0, 90)));
    }

    #[test]
    fn only_the_first_circle_counts() {
        let mut ink = Ink::new(1.0);
        feed(&mut ink, &ring(500.0, 300.0, 40.0, 1.05, 60));
        let first = ink.area();
        feed(&mut ink, &ring(900.0, 600.0, 60.0, 1.05, 60));
        assert_eq!(ink.area(), first);
    }

    #[test]
    fn a_bigger_screen_scale_needs_a_bigger_loop() {
        let mut ink = Ink::new(2.0);
        // Big enough at 96 dpi, too small at 200 %.
        assert!(!feed(&mut ink, &ring(500.0, 300.0, 22.0, 1.05, 60)));
    }
}
