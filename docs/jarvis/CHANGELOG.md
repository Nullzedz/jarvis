# JARVIS changelog

What JARVIS has changed since it was forked from [coucou](https://github.com/Louis-CFM/coucou)
(fork point `0d7fe58`, coucou for Windows 0.5.9). Everything here is in `windows/`, the
Windows app. Newest first.

Tracking issue: [#1 — Give JARVIS its own UI, while keeping coucou's animation quality](https://github.com/Nullzedz/jarvis/issues/1).

## Voice, file drop, live code card and plan usage — `06dedb2` ([#3](https://github.com/Nullzedz/jarvis/issues/3))

- **« Hey JARVIS »:** his own offline British voice (Kokoro, via sherpa-onnx, downloaded on
  click); voice training (say « Hey JARVIS » five times; « Only answer my voice » ignores
  anyone else); a microphone meter in Settings. Answers come faster: Claude Code is kept warm,
  thinking is off, and each sentence is spoken as soon as it is written. The pill lights up
  words as they are said and leaves after a reading time. Kokoro still takes about 7 s for
  the first sentence on a CPU.
- **File drop:** Mochi is replaced by JARVIS as a white folder. He follows the file, his front
  panel tips forward to take it, then snaps shut and smiles.
- **Live code view:** one file card instead of the step list. The header shows his eye, the
  action, the file or command and the lines changed so far. Removed lines are struck through
  one by one, new code types in at about 110 characters a second, and the next step waits for
  the edit to finish. When done, the island folds to fit the summary.
- **Claude plan usage without a terminal:** the limits come with every reply of JARVIS's own
  Claude Code (`rate_limit_event`). When the card's numbers are over 10 minutes old, one tiny
  Haiku question refreshes them (at most every 10 minutes, never while paused).

## Live code view — `218124e`

Watch a Claude Code session work, from the top bar. Opened with the new **`</>`** button on the
Claude Code card (never by itself); **‹** or **Esc** goes back.

- **Left:** the visor, the project, the session's age, and every step of the turn (up to 30,
  scrollable, clickable), then **Done**.
- **Reads and edits:** the file, with its badge, path, line numbers and syntax colours. Removed
  code sits in a **red outlined box** with a line drawn through it; new code in a **green
  outlined box** types itself in, letter by letter. Clicking a step replays it.
  **Open in VS Code ↗**.
- **Commands:** a small terminal with the command and the end of its output.
- **Done:** Claude's answer.
- The hook relay now forwards the last ~1.8 KB of a command's output (`jarvis_output`).
- `live_read` (Rust) reads at most 40 lines of a text file, only inside the session's own
  folder, up to 2 MB.

## Black-hole startup — `229e0a1`

The startup ring now works like a black hole: 90 specks of light drift across the bar, spiral
in and get swallowed as the ring spins (the core and ring brighten with each one), then
explode back out in a flash and two shockwaves as the visor forms.

## White Visor and the Reactor startup — `9774558`

- **The character:** a white visor whose eye carries the mood: blue at rest, a purple sweep
  while thinking, a wider amber eye and pulsing halo when it needs you, a green **smile** when
  done, a red **frown** on an error. A squash-and-hop replaces Mochi's roll. No hands.
- **The startup (Reactor):** a ring of light draws, spins, and bends point by point into the
  visor; a spark stretches into the eye, which holds centre and blinks. When the bar folds, it
  carries the visor down with it.

## Google Calendar tab — `7a1229e`

A calendar icon in the top row opens your Google Calendar (read-only, from its secret iCal
address, kept in the Windows Credential Manager). **Today** shows the day as a timeline;
**Week** shows seven columns. Recurring events, moved and cancelled instances are understood.
Refreshes every five minutes while open.

## Animation study — `e0b47e7`

[`animation-study.md`](animation-study.md): coucou's easing curves, springs, keyframe timings and
idle behaviour, kept as the rules for JARVIS's own motion.

## Rebrand — `295360f`

- **JARVIS** everywhere it shows (window titles, installer, translations), with "Hey JARVIS"
  as the wake word.
- The **Visor** replaces Mochi; a new app icon and 29 new sounds, all made in code, so none of
  coucou's artwork ships.
- A formal, butler-like persona in chat and voice.
- Internal identifiers (bundle id, `%LOCALAPPDATA%\Coucou`, `coucou-hook.exe`) are unchanged
  on purpose, so the Claude Code connection keeps working.
