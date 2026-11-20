// « Hey JARVIS » (or « OK JARVIS »): hearing the wake phrase in what Parakeet wrote, and telling
// speech from silence on the microphone. Nothing here touches the OS.

/// Lower case, accents gone, everything but letters and digits a space.
pub fn normalize(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars().flat_map(char::to_lowercase) {
        let base = match c {
            'à' | 'á' | 'â' | 'ä' | 'ã' | 'å' => 'a',
            'ç' => 'c',
            'è' | 'é' | 'ê' | 'ë' => 'e',
            'ì' | 'í' | 'î' | 'ï' => 'i',
            'ò' | 'ó' | 'ô' | 'ö' | 'õ' => 'o',
            'ù' | 'ú' | 'û' | 'ü' => 'u',
            'ÿ' | 'ý' => 'y',
            'ñ' => 'n',
            c if c.is_alphanumeric() => c,
            _ => ' ',
        };
        out.push(base);
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// How Parakeet may write "OK" or "Hey" (JARVIS: "hi", "hay"… are how it hears a quick "hey").
fn is_ok(word: &str) -> bool {
    matches!(word, "ok" | "okay" | "oke" | "okey" | "hey" | "hi" | "hay" | "hei" | "heyy" | "ey" | "hiya" | "yo")
}

/// How Parakeet may write "Jarvis", in one word (the close spellings an
/// accent or a fast "Hey Jarvis" can produce).
fn is_coucou(word: &str) -> bool {
    matches!(
        word,
        "jarvis" | "jarviss" | "jarvus" | "jarvas" | "javis" | "jervis" | "jarves" | "jarvys" | "jarvise"
            | "jarvies" | "jarvi" | "jarbis" | "garvis" | "charvis" | "chavis" | "travis" | "jarvins" | "jarvish"
    ) || (word.len() <= 9 && word.starts_with("jarv"))
}

/// …or in two.
fn is_coucou_pair(a: &str, b: &str) -> bool {
    matches!((a, b), ("jar", "vis") | ("jar", "viss") | ("jar", "this") | ("jarv", "is"))
}

/// When `text` holds the wake phrase, what was said after it (maybe nothing).
/// The words keep their case and punctuation, as Parakeet wrote them.
pub fn after_wake(text: &str) -> Option<String> {
    let words: Vec<&str> = text.split_whitespace().collect();
    let norm: Vec<String> = words.iter().map(|w| normalize(w)).collect();
    // JARVIS: "Jarvis, what time is it?" — his name first, on its own.
    if norm.first().is_some_and(|w| is_coucou(w) && w != "travis") {
        return Some(words[1..].join(" ").trim_start_matches([',', '.', '!', ' ']).trim().to_string());
    }
    // "o.k." and "o k" become two tokens: glue them.
    let mut i = 0;
    while i < norm.len() {
        let mut ok_end = None;
        if is_ok(&norm[i]) {
            ok_end = Some(i + 1);
        } else if norm[i] == "o k" || (norm[i] == "o" && norm.get(i + 1).map(String::as_str) == Some("k")) {
            ok_end = Some(if norm[i] == "o" { i + 2 } else { i + 1 });
        }
        if let Some(j) = ok_end {
            // A word made of two ("ok coucou" written as one token is rare but happens).
            if let Some(w) = norm.get(j) {
                let parts: Vec<&str> = w.split(' ').collect();
                if parts.len() == 1 && is_coucou(parts[0]) {
                    return Some(words[j + 1..].join(" ").trim_start_matches([',', '.', '!', ' ']).trim().to_string());
                }
                if let Some(next) = norm.get(j + 1) {
                    if is_coucou_pair(w, next) {
                        return Some(words[j + 2..].join(" ").trim_start_matches([',', '.', '!', ' ']).trim().to_string());
                    }
                }
            }
        }
        // "okcoucou" in one piece.
        if let Some(rest) = norm[i].strip_prefix("okay").or_else(|| norm[i].strip_prefix("ok")) {
            if is_coucou(rest.trim()) {
                return Some(words[i + 1..].join(" ").trim().to_string());
            }
        }
        i += 1;
    }
    None
}

/// Speech or silence, 30 ms at a time, against a noise floor that follows the
/// room. A stretch of speech is handed out once followed by `hangover` frames
/// of silence, or when it gets too long.
pub struct Vad {
    floor: f32,
    in_speech: bool,
    speech_frames: usize,
    silent_frames: usize,
    frame: Vec<f32>,
    /// The current stretch, with a little audio from before it began.
    current: Vec<f32>,
    preroll: std::collections::VecDeque<f32>,
    /// Silence that ends a stretch, in frames.
    pub hangover: usize,
}

pub const FRAME: usize = 480; // 30 ms at 16 kHz
/// The quietest a frame may be and still count as speech (RMS). Some laptop
/// microphones give speech at 0.006–0.011 over a room at 0.002–0.003.
pub const MIN_SPEECH: f32 = 0.0035;

/// A stretch of quiet speech brought up to a normal level (peak about 0.5, at
/// most ×20) before Parakeet and the voiceprint hear it.
pub fn boost(samples: &[f32]) -> Vec<f32> {
    let peak = samples.iter().fold(0.0f32, |m, x| m.max(x.abs()));
    if peak <= 0.0 || peak >= 0.3 {
        return samples.to_vec();
    }
    let gain = (0.5 / peak).min(20.0);
    samples.iter().map(|x| (x * gain).clamp(-1.0, 1.0)).collect()
}
const PREROLL: usize = 16_000 * 3 / 10;
const MAX_SEGMENT: usize = 16_000 * 12;

impl Default for Vad {
    fn default() -> Self {
        Self {
            floor: 0.004,
            in_speech: false,
            speech_frames: 0,
            silent_frames: 0,
            frame: Vec::with_capacity(FRAME),
            current: Vec::new(),
            preroll: std::collections::VecDeque::with_capacity(PREROLL),
            hangover: 25,
        }
    }
}

impl Vad {
    /// How loud a frame must be to count as speech: three times the room's noise, at least MIN_SPEECH.
    pub fn threshold(&self) -> f32 {
        (self.floor * 3.0).max(MIN_SPEECH)
    }

    /// JARVIS: the room's steady noise level (RMS), for the talk keys' own measure of a voice.
    pub fn floor(&self) -> f32 {
        self.floor
    }

    #[cfg(test)]
    pub fn in_speech(&self) -> bool {
        self.in_speech
    }

    /// Feeds 16 kHz samples; the stretches of speech that ended.
    pub fn feed(&mut self, samples: &[f32]) -> Vec<Vec<f32>> {
        let mut done = Vec::new();
        for &s in samples {
            self.frame.push(s);
            if self.frame.len() < FRAME {
                continue;
            }
            let rms = (self.frame.iter().map(|x| x * x).sum::<f32>() / FRAME as f32).sqrt();
            // JARVIS: MIN_SPEECH rather than 0.012, so a quiet microphone still counts as speech.
            let speech = rms > self.threshold();
            if !speech && !self.in_speech {
                self.floor = self.floor * 0.97 + rms * 0.03;
            }
            if self.in_speech {
                self.current.extend_from_slice(&self.frame);
                if speech {
                    self.silent_frames = 0;
                } else {
                    self.silent_frames += 1;
                }
                if self.silent_frames >= self.hangover || self.current.len() >= MAX_SEGMENT {
                    done.push(std::mem::take(&mut self.current));
                    self.in_speech = false;
                    self.speech_frames = 0;
                    self.silent_frames = 0;
                }
            } else if speech {
                self.speech_frames += 1;
                if self.speech_frames >= 3 {
                    self.in_speech = true;
                    self.current = self.preroll.drain(..).collect();
                    self.current.extend_from_slice(&self.frame);
                }
            } else {
                self.speech_frames = 0;
            }
            if !self.in_speech {
                for &x in &self.frame {
                    if self.preroll.len() == PREROLL {
                        self.preroll.pop_front();
                    }
                    self.preroll.push_back(x);
                }
            }
            self.frame.clear();
        }
        done
    }

    /// Forgets what is being heard (Coucou speaks, or dictation starts).
    pub fn reset(&mut self) {
        self.in_speech = false;
        self.speech_frames = 0;
        self.silent_frames = 0;
        self.current.clear();
        self.preroll.clear();
        self.frame.clear();
    }
}

/// "fr-FR" for a French answer, else None (the system's language).
pub fn speech_lang(text: &str) -> Option<&'static str> {
    let n = normalize(text);
    let words: Vec<&str> = n.split(' ').collect();
    let french = ["le", "la", "les", "est", "tu", "vous", "je", "un", "une", "des", "pour", "pas", "c", "et", "sur", "avec", "ton", "ta"];
    let count = words.iter().filter(|w| french.contains(w)).count();
    (count * 6 >= words.len().max(1) && count >= 1).then_some("fr-FR")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_wake_phrase_however_parakeet_writes_it() {
        assert_eq!(after_wake("Hey Jarvis, play some music.").as_deref(), Some("play some music."));
        assert_eq!(after_wake("OK JARVIS what's the weather").as_deref(), Some("what's the weather"));
        assert_eq!(after_wake("Okay, Jarvis! Quelle heure est-il ?").as_deref(), Some("Quelle heure est-il ?"));
        assert_eq!(after_wake("hey jar vis open my mail").as_deref(), Some("open my mail"));
        assert_eq!(after_wake("Hey Jervis.").as_deref(), Some(""));
        assert_eq!(after_wake("O.K. Javis, status report").as_deref(), Some("status report"));
        // Other phrases and other assistants' wake words stay out.
        assert_eq!(after_wake("Okay, cool."), None);
        assert_eq!(after_wake("Okay, Google."), None);
        assert_eq!(after_wake("I told Jarvis about it"), None);
        // How Parakeet hears a quick "Hey JARVIS", and his name on its own first.
        assert_eq!(after_wake("Hi Jarvis, what time is it?").as_deref(), Some("what time is it?"));
        assert_eq!(after_wake("Hay, Jarvis.").as_deref(), Some(""));
        assert_eq!(after_wake("Hey Travis open my mail").as_deref(), Some("open my mail"));
        assert_eq!(after_wake("Jarvis, play some music").as_deref(), Some("play some music"));
        assert_eq!(after_wake("Jarvis's plan is good"), Some("plan is good".into()));
        assert_eq!(after_wake("Travis called me"), None, "Travis alone is a person");
        assert_eq!(after_wake("ok let's go"), None);
        assert_eq!(normalize("Ça VA, Élodie ?"), "ca va elodie");
    }

    #[test]
    fn speech_is_cut_after_a_pause() {
        let mut vad = Vad::default();
        let silence = vec![0.0f32; 16_000];
        let tone: Vec<f32> = (0..16_000).map(|i| (i as f32 * 0.1).sin() * 0.3).collect();
        assert!(vad.feed(&silence).is_empty());
        assert!(vad.feed(&tone).is_empty());
        assert!(vad.in_speech());
        let out = vad.feed(&silence);
        assert_eq!(out.len(), 1);
        // The tone, a pre-roll before it and the hangover after it.
        assert!(out[0].len() > 16_000 && out[0].len() <= 16_000 + 25 * FRAME + PREROLL + 2 * FRAME);
        assert!(!vad.in_speech());
    }

    #[test]
    fn french_answers_are_spoken_in_french() {
        assert_eq!(speech_lang("C'est fait, j'ai ajouté Stripe pour toi."), Some("fr-FR"));
        assert_eq!(speech_lang("Done, Stripe is in the island."), None);
    }
}

#[cfg(test)]
mod boost_tests {
    use super::*;

    #[test]
    fn quiet_speech_is_brought_up_and_loud_speech_left_alone() {
        let quiet = vec![0.01, -0.02, 0.015];
        let up = boost(&quiet);
        assert!((up[1] + 0.4).abs() < 1e-6, "×20 at most: {}", up[1]);
        let mid = vec![0.1, -0.05];
        assert!((boost(&mid)[0] - 0.5).abs() < 1e-6, "peak to 0.5");
        let loud = vec![0.6, -0.4];
        assert_eq!(boost(&loud), loud);
        assert_eq!(boost(&[0.0, 0.0]), vec![0.0, 0.0]);
    }
}
