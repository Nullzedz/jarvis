// JARVIS (#84): the Notetaker's read-along, a sentence or two at a time. A call's lines are each
// everything a person said before a pause, often a whole paragraph: lit all at once they can't
// keep pace with the voice. Each line is cut into pieces of at most two sentences (a very long
// sentence breaks at a comma), each lit for its share of the line's time; the first piece of a
// line marks a gap (a pause, or the other person speaking).

export interface ReadLine { speaker: string; start: number; end: number; text: string }
export interface Piece { speaker: string; start: number; end: number; text: string; first: boolean; line: number }

const LONG = 140; // a sentence longer than this breaks at a comma
const PAIR = 150; // two sentences fit together up to this

/** One line's text in pieces of at most two sentences. */
export function splitPieces(text: string): string[] {
  const sentences = (text.match(/[^.!?…]+[.!?…]+["”’)\]]*\s*|[^.!?…]+$/g) ?? [text]).map((s) => s.trim()).filter(Boolean);
  const parts: string[] = [];
  for (const s of sentences) {
    let rest = s;
    while (rest.length > LONG) {
      const cut = rest.lastIndexOf(", ", LONG - 20);
      if (cut < 40) break;
      parts.push(rest.slice(0, cut + 1));
      rest = rest.slice(cut + 2);
    }
    parts.push(rest);
  }
  const out: string[] = [];
  for (let i = 0; i < parts.length;) {
    const two = parts[i + 1] ? `${parts[i]} ${parts[i + 1]}` : "";
    if (two && two.length <= PAIR) { out.push(two); i += 2; } else { out.push(parts[i]); i += 1; }
  }
  return out.length ? out : [text];
}

/** Every line's pieces, timed by their length within the line. */
export function readPieces(lines: readonly ReadLine[]): Piece[] {
  return lines.flatMap((l, k) => {
    const texts = splitPieces(l.text);
    const total = texts.reduce((a, s) => a + s.length, 0) || 1;
    const span = Math.max(0, l.end - l.start);
    let at = l.start;
    return texts.map((text, j) => {
      const len = span * (text.length / total);
      const p = { speaker: l.speaker, start: at, end: at + len, text, first: j === 0, line: k };
      at += len;
      return p;
    });
  });
}
