// JARVIS: the answer cut into pieces to say as it is written, so he starts
// speaking at the end of his first sentence instead of the end of his answer.
// A piece ends at a full stop, question or exclamation mark followed by a
// space; a very short one ("Sir.") waits for the next; a long run-on sentence
// is cut at a comma rather than waited for.

/// The shortest piece said on its own (characters).
const MIN_PIECE: usize = 16;
/// A sentence longer than this is said in parts, cut at a comma.
const LONG: usize = 160;

#[derive(Default)]
pub struct Splitter {
    buf: String,
}

impl Splitter {
    /// Adds what was just written; returns the pieces now ready to say.
    pub fn push(&mut self, text: &str) -> Vec<String> {
        self.buf.push_str(text);
        let mut out = Vec::new();
        while let Some(end) = self.next_end() {
            let piece: String = self.buf.drain(..end).collect();
            push_clean(&mut out, &piece);
        }
        out
    }

    /// The answer is complete: whatever is left.
    pub fn finish(&mut self) -> Option<String> {
        let rest = std::mem::take(&mut self.buf);
        let mut out = Vec::new();
        push_clean(&mut out, &rest);
        out.pop()
    }

    /// Where the next piece ends (byte index just after it), if one is ready.
    fn next_end(&self) -> Option<usize> {
        let b = &self.buf;
        let mut chars = b.char_indices().peekable();
        while let Some((i, c)) = chars.next() {
            if matches!(c, '.' | '!' | '?' | '…') {
                // Closing marks stay with their sentence.
                let mut end = i + c.len_utf8();
                while let Some(&(j, n)) = chars.peek() {
                    if matches!(n, '.' | '!' | '?' | '…' | '"' | '\'' | '”' | '’' | ')') {
                        end = j + n.len_utf8();
                        chars.next();
                    } else {
                        break;
                    }
                }
                match chars.peek() {
                    Some(&(_, n)) if n.is_whitespace() => {
                        if b[..end].trim().chars().count() >= MIN_PIECE {
                            return Some(end);
                        }
                    }
                    _ => {}
                }
            }
        }
        if b.chars().count() > LONG {
            // A run-on sentence: up to its last comma past the first third.
            let floor = b.char_indices().nth(LONG / 3).map(|(i, _)| i).unwrap_or(0);
            if let Some(at) = b[floor..].rfind(", ") {
                return Some(floor + at + 1);
            }
        }
        None
    }
}

fn push_clean(out: &mut Vec<String>, piece: &str) {
    let said = super::brain::spoken_text(piece);
    if said.chars().any(char::is_alphanumeric) {
        out.push(said);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(chunks: &[&str]) -> Vec<String> {
        let mut s = Splitter::default();
        let mut out: Vec<String> = chunks.iter().flat_map(|c| s.push(c)).collect();
        out.extend(s.finish());
        out
    }

    #[test]
    fn says_each_sentence_as_soon_as_it_is_written() {
        let mut s = Splitter::default();
        assert!(s.push("It's a quarter past").is_empty());
        assert_eq!(s.push(" twelve, sir. Shall I"), vec!["It's a quarter past twelve, sir."]);
        assert!(s.push(" set a reminder?").is_empty(), "the end of the answer may still grow");
        assert_eq!(s.finish().as_deref(), Some("Shall I set a reminder?"));
    }

    #[test]
    fn a_short_sentence_waits_for_the_next() {
        assert_eq!(feed(&["Certainly, sir. ", "Brussels is the capital of Belgium. "]), vec!["Certainly, sir. Brussels is the capital of Belgium."]);
    }

    #[test]
    fn decimals_and_markdown_do_not_break_it() {
        assert_eq!(feed(&["It is **20.5 degrees** in London today."]), vec!["It is 20.5 degrees in London today."]);
    }

    #[test]
    fn a_run_on_sentence_is_cut_at_a_comma() {
        let long = "The forecast for tomorrow shows light rain in the morning, clearing by midday, with a gentle westerly breeze, temperatures around fourteen degrees and sunshine for most of the afternoon, sir";
        let out = feed(&[long]);
        assert!(out.len() >= 2, "{out:?}");
        assert!(out[0].ends_with(','));
    }
}
