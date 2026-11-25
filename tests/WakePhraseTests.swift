import Foundation

// MARK: - WakePhrase tests (pure functions, no concurrency)

@main
enum WakePhraseTests {

    static var failures = 0

    static func main() {
        // MARK: split — should match

        // Basic wake phrases (no command)
        checkMatch("hey jarvis",              WakePhrase.split("hey jarvis"),              cmd: "")
        checkMatch("HEY JARVIS",              WakePhrase.split("HEY JARVIS"),              cmd: "")
        checkMatch("okay jarvis",            WakePhrase.split("okay jarvis"),            cmd: "")
        checkMatch("ok kuku",                WakePhrase.split("ok kuku"),                cmd: "")
        checkMatch("ok cou cou",             WakePhrase.split("ok cou cou"),             cmd: "")
        checkMatch("hey jarvis",             WakePhrase.split("hey jarvis"),             cmd: "")
        checkMatch("Hey JARVIS",             WakePhrase.split("Hey JARVIS"),             cmd: "")

        // Command extracted from original text (casing/punctuation preserved)
        checkMatch("Okay, JARVIS, ajoute GitHub",
                   WakePhrase.split("Okay, JARVIS, ajoute GitHub"),             cmd: "ajoute GitHub")
        checkMatch("ok cuckoo add github",
                   WakePhrase.split("ok cuckoo add github"),                    cmd: "add github")
        checkMatch("hey jarvis ouvre figma",
                   WakePhrase.split("hey jarvis ouvre figma"),                   cmd: "ouvre figma")

        // Apostrophes, hyphens and accents preserved in command
        checkMatch("Hey JARVIS, mets l'album de Daft Punk",
                   WakePhrase.split("Hey JARVIS, mets l'album de Daft Punk"),   cmd: "mets l'album de Daft Punk")
        checkMatch("hey jarvis qu'est-ce que fait Claude ?",
                   WakePhrase.split("hey jarvis qu'est-ce que fait Claude ?"),  cmd: "qu'est-ce que fait Claude ?")

        // Wake anywhere in transcript (word-boundary search)
        checkMatch("euh hey jarvis mets de la musique",
                   WakePhrase.split("euh hey jarvis mets de la musique"),        cmd: "mets de la musique")
        checkMatch("la chanson dit hey jarvis",
                   WakePhrase.split("la chanson dit hey jarvis"),                cmd: "") // accepted false positive

        // LAST occurrence wins
        checkMatch("hey jarvis search hey jarvis play music",
                   WakePhrase.split("hey jarvis search hey jarvis play music"),   cmd: "play music")

        // Partial word-by-word delivery
        checkNoMatch("ok alone",             WakePhrase.split("ok"))
        checkMatch("hey jarvis partial",      WakePhrase.split("hey jarvis"),              cmd: "")
        checkMatch("hey jarvis with more",    WakePhrase.split("hey jarvis mets"),         cmd: "mets")

        // MARK: split — should NOT match
        checkNoMatch("standalone jarvis",    WakePhrase.split("jarvis"))
        checkNoMatch("standalone JARVIS",    WakePhrase.split("JARVIS"))
        checkNoMatch("partial jarvis ça va", WakePhrase.split("jarvis ça va"))
        checkNoMatch("jarvis comment",       WakePhrase.split("jarvis comment tu vas"))
        checkNoMatch("ok google",            WakePhrase.split("ok google"))
        checkNoMatch("hey siri",             WakePhrase.split("hey siri"))
        checkNoMatch("okkkk jarvis",         WakePhrase.split("okkkk jarvis"))
        checkNoMatch("empty",                WakePhrase.split(""))

        // Summary
        if failures == 0 { print("\n\(total)/\(total) tests passed.") }
        else { print("\n\(failures) test(s) FAILED."); exit(1) }
    }

    static var total = 0

    static func checkMatch(_ label: String, _ r: WakePhrase.SplitResult, cmd: String) {
        total += 1
        if !r.matched {
            print("✗  \(label) — expected match, got no match"); failures += 1; return
        }
        if r.command != cmd {
            print("✗  \(label) — matched ✓ but command \"\(r.command)\" ≠ \"\(cmd)\""); failures += 1; return
        }
        print("✓  \(label)")
    }

    static func checkNoMatch(_ label: String, _ r: WakePhrase.SplitResult) {
        total += 1
        if r.matched { print("✗  \(label) — expected no match, got matched (cmd: \"\(r.command)\")"); failures += 1 }
        else         { print("✓  \(label)") }
    }
}
