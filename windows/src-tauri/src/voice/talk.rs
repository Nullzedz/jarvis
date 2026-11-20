// JARVIS: push-to-talk, after Roamies' design (its voice helper on Windows),
// written for JARVIS. It replaces « Hey JARVIS »: nothing listens for a phrase
// any more, the talk keys open the microphone.
//
// The talk keys are chosen in Settings (shortcut.rs); Left Ctrl + Win by default.
// - Hold them and talk; let go and the question is sent.
// - Tap them (down and up within TAP_LIMIT): hands-free — JARVIS listens until
//   you pause (mod.rs ends the take); pressing them again closes it.
// - Any other key with them (Ctrl+Win+D…) is another shortcut: the take is
//   dropped and nothing starts until every key is up.
// - While he thinks or speaks, pressing them stops him (mod.rs).
//
// `Talk` is a pure state machine fed the keys on every beat of the voice loop,
// so it is tested without a keyboard; `keys()` reads the real ones.

/// Down and up within this long is a tap (hands-free); held longer, it's push-to-talk.
pub const TAP_LIMIT: f64 = 0.25;
/// A release must last this long to count, so one glitchy read can't end a take.
pub const RELEASE_DEBOUNCE: f64 = 0.09;

#[derive(Clone, Copy, PartialEq, Debug)]
enum Phase {
    /// Nothing held, no take.
    Idle,
    /// The keys just went down: recording, not shown yet (it may be another shortcut).
    Pressing { since: f64 },
    /// Push-to-talk: recording until the keys are let go.
    Holding { released_at: Option<f64> },
    /// Hands-free: recording until mod.rs ends it (a pause, nothing said, too long).
    HandsFree,
    /// Another shortcut: nothing until every key is up.
    Blocked,
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Event {
    /// Start recording (the pre-roll included); show nothing yet.
    Begin,
    /// It's push-to-talk: show « listening ».
    Hold,
    /// It's hands-free: show « listening ».
    HandsFree,
    /// The keys were let go: send what was said.
    Send,
    /// Another shortcut: drop the take, show nothing.
    Cancel,
    /// Pressed again while hands-free: drop the take and fade out.
    Close,
}

pub struct Talk {
    phase: Phase,
    was_down: bool,
}

impl Default for Talk {
    fn default() -> Self {
        Talk { phase: Phase::Idle, was_down: false }
    }
}

impl Talk {
    /// One beat: the talk keys held (`chord`), any other key held (`other`), at `now` (s).
    pub fn step(&mut self, now: f64, chord: bool, other: bool) -> Option<Event> {
        let pressed = chord && !self.was_down;
        self.was_down = chord;
        match self.phase {
            Phase::Blocked => {
                if !chord && !other {
                    self.phase = Phase::Idle;
                }
                None
            }
            Phase::Idle => {
                if chord && other {
                    self.phase = Phase::Blocked;
                    None
                } else if pressed {
                    self.phase = Phase::Pressing { since: now };
                    Some(Event::Begin)
                } else {
                    None
                }
            }
            Phase::Pressing { since } => {
                if other {
                    self.phase = Phase::Blocked;
                    Some(Event::Cancel)
                } else if !chord {
                    self.phase = Phase::HandsFree;
                    Some(Event::HandsFree)
                } else if now - since > TAP_LIMIT {
                    self.phase = Phase::Holding { released_at: None };
                    Some(Event::Hold)
                } else {
                    None
                }
            }
            Phase::Holding { released_at } => {
                if other && chord {
                    self.phase = Phase::Blocked;
                    return Some(Event::Cancel);
                }
                if chord {
                    self.phase = Phase::Holding { released_at: None };
                    return None;
                }
                let at = released_at.unwrap_or(now);
                if now - at >= RELEASE_DEBOUNCE {
                    self.phase = Phase::Idle;
                    Some(Event::Send)
                } else {
                    self.phase = Phase::Holding { released_at: Some(at) };
                    None
                }
            }
            Phase::HandsFree => {
                // Pressing again: closed, and nothing more until the keys are up.
                if pressed && !other {
                    self.phase = Phase::Blocked;
                    return Some(Event::Close);
                }
                None
            }
        }
    }

    /// Starts a hands-free take without the keys: after each answer, so the
    /// conversation goes on without pressing them again (mod.rs).
    pub fn listen(&mut self) {
        self.phase = Phase::HandsFree;
    }

    /// The take ended (sent or dropped by the loop): back to waiting for the keys.
    pub fn end(&mut self) {
        self.phase = if self.was_down { Phase::Blocked } else { Phase::Idle };
    }

    /// The keys were used for something else (stopping him): nothing until they're up.
    pub fn block(&mut self) {
        self.was_down = true;
        self.phase = Phase::Blocked;
    }

    /// A take is being recorded.
    #[cfg(test)]
    pub fn recording(&self) -> bool {
        !matches!(self.phase, Phase::Idle | Phase::Blocked)
    }

    /// Hands-free (the loop decides when it ends).
    pub fn hands_free(&self) -> bool {
        self.phase == Phase::HandsFree
    }

    /// Shown to the user (no longer a press that may be another shortcut).
    pub fn shown(&self) -> bool {
        matches!(self.phase, Phase::Holding { .. } | Phase::HandsFree)
    }
}

/// The talk keys held, and whether any other key is.
pub fn keys() -> (bool, bool) {
    super::shortcut::keys(super::shortcut::Which::Talk)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Feeds (time, chord, other) beats; returns the events in order.
    fn run(t: &mut Talk, beats: &[(f64, bool, bool)]) -> Vec<Event> {
        beats.iter().filter_map(|&(now, c, o)| t.step(now, c, o)).collect()
    }

    #[test]
    fn holding_the_keys_is_push_to_talk_and_letting_go_sends() {
        let mut t = Talk::default();
        let ev = run(&mut t, &[(0.0, true, false), (0.1, true, false), (0.3, true, false), (2.0, true, false), (2.05, false, false), (2.2, false, false)]);
        assert_eq!(ev, vec![Event::Begin, Event::Hold, Event::Send]);
        assert!(!t.recording());
    }

    #[test]
    fn a_quick_tap_is_hands_free_until_the_loop_ends_it() {
        let mut t = Talk::default();
        let ev = run(&mut t, &[(0.0, true, false), (0.12, false, false), (1.0, false, false)]);
        assert_eq!(ev, vec![Event::Begin, Event::HandsFree]);
        assert!(t.hands_free() && t.recording());
        t.end();
        assert!(!t.recording());
    }

    #[test]
    fn pressing_again_while_hands_free_closes_it() {
        let mut t = Talk::default();
        run(&mut t, &[(0.0, true, false), (0.1, false, false)]);
        let ev = run(&mut t, &[(3.0, true, false), (3.5, true, false), (3.6, false, false), (3.8, false, false)]);
        assert_eq!(ev, vec![Event::Close]);
        assert!(!t.recording());
        // The next press starts afresh.
        assert_eq!(run(&mut t, &[(4.0, true, false)]), vec![Event::Begin]);
    }

    #[test]
    fn after_stopping_him_nothing_starts_until_the_keys_are_up() {
        let mut t = Talk::default();
        t.block();
        assert!(run(&mut t, &[(0.0, true, false), (0.3, true, false)]).is_empty());
        assert_eq!(run(&mut t, &[(0.4, false, false), (0.5, true, false)]), vec![Event::Begin]);
    }

    #[test]
    fn another_key_makes_it_a_shortcut_and_nothing_starts_until_all_are_up() {
        let mut t = Talk::default();
        // Ctrl+Alt+T: down, then T joins in.
        let ev = run(&mut t, &[(0.0, true, false), (0.05, true, true), (0.5, true, true), (0.6, true, false), (0.7, false, false)]);
        assert_eq!(ev, vec![Event::Begin, Event::Cancel]);
        assert!(!t.recording());
        // Then a clean press works again.
        assert_eq!(run(&mut t, &[(1.0, true, false)]), vec![Event::Begin]);
    }

    #[test]
    fn a_shortcut_pressed_with_another_key_first_never_begins() {
        let mut t = Talk::default();
        // Shift held, then Ctrl+Alt: Ctrl+Alt+Shift is someone else's shortcut.
        assert!(run(&mut t, &[(0.0, true, true), (0.5, true, false), (0.6, false, false)]).is_empty());
    }

    #[test]
    fn one_glitchy_release_does_not_end_a_hold() {
        let mut t = Talk::default();
        let ev = run(&mut t, &[(0.0, true, false), (0.3, true, false), (1.0, false, false), (1.03, true, false), (1.5, true, false)]);
        assert_eq!(ev, vec![Event::Begin, Event::Hold]);
        assert!(t.recording());
    }

    #[test]
    fn jarvis_can_open_the_mic_himself_after_a_question() {
        let mut t = Talk::default();
        t.listen();
        assert!(t.hands_free() && t.shown());
    }
}
