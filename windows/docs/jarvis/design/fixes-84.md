# Fixes for #84: what the stress test and the usability audit found

Working list for PR #85 (main window only; the island comes after). Ticked as they land. Demo: prototypes/jarvis-fixes.html.

## Stress test (UI and motion)
- [x] Old settings.css element rules (button grey hover/scale, section, inputs) weightless with :where; own hovers and focus rings for new controls; window dots keep colour, show symbols, out of Tab order when hidden. Symbols drawn as centred SVG; "Full screen" now says Maximize.
- [x] Pages dark only (theme.ts apply).
- [x] Settings search: per-row match, group-name match shows group, "No setting matches" empty state.
- [x] Settings mic meter only while the Voice group is on screen; restarts after a drill page.
- [x] Ctrl K / moved-page anchors: land on the row (anchor, then label text, then group), retry while async parts draw; soft highlight instead of the purple glow.
- [x] Settings at 820 px: nav stays left, controls stay right.
- [x] Settings nav highlight reaches Privacy/About; drill page lights its group.
- [x] demoRows: an empty <label> counts as no name (rows fold into the setting above).
- [x] Sidebar stuck open over the logo row (winctl hit box while dots hidden).
- [x] Listener/timer leaks: Dictation History onLeave on sub ctx; shell race (onLeave/listeners of a superseded render); phone page isConnected interval; Settings redraw listeners (notch-tabs storage, voice onEvent, flowsettings).
- [x] Mail full views scroll the right container (.hub-scroll) and Back restores.
- [x] Notetaker: don't pull back into the recording; red "Recording · back to it" pill.
- [x] Home "New session" Enter (card keydown only when target is the card); Space opens cards too.
- [x] Read-along: pieces of <= 2 sentences, timed by length, gap at pauses/speaker changes.
- [x] Home: orbit not rebuilt on every tick; Agents card fixed demo size; hero padding (greeting above dock); tile names ellipsis; empty Connections sentence; plan widget sizes/labels.
- [x] Pages: Agents card stack animates (no rebuild); Notetaker no flicker on notes-changed; fixed heights -> flex fill (Mail, Talk, Agents); word-wall search keeps focus; Mail stale day/month requests; waveforms scaleY; Dictation columns top-aligned; dright chip on the tabs line; talk "…" timeout + Try again; Connections "Checking…"; Sorting "Turn on" stays on the page.
- [x] Hidden rail on Home out of Tab order; reduced motion for orbit/stars/eye.

## Usability: signifiers and mapping
- [x] Home "Dictation" tab + widget open Notetaker: go() takes a page; one name for the section.
- [x] Mail Overview small "Waiting" card: ↩ ✓ ↗ spans look like buttons, do nothing.
- [x] Mail colours: non-VIP sender pills green = "waiting"; Home "waiting" orange = VIP; pick one.
- [x] Dictation columns "+" doesn't add (and on Styles can't): use "›" or focus the add field.
- [x] Connections setup: pill switch silently refuses at 4/4: say why, role=switch.
- [x] Connections setup: colour dot vs key-status dot look identical: label/words.
- [x] Talk "His voice": Change › teleports to Settings with no way back; ▶ navigates; onlyMe switch navigates.
- [ ] Status chips look like button chips; "In use" span styled as button.
- [x] One icon per section everywhere (Notes pencil vs mic; JARVIS pulse vs visor).
- [ ] "His windows" widget opens the conversation (no windows view).
- [x] Ask dock: cursor text but it's a button; pulse icon looks like a separate control.
- [ ] Rail status line collapsed looks like a switch.
- [x] Mail next-month › on current month: dead span looks enabled.
- [x] Notetaker Today: clickable notes and plain events look the same; red = failed and upcoming.
- [x] Rename note hidden (tooltip only); speaker rename too.
- [x] Help text paths that don't exist: "Hey JARVIS tab", "Notch → Chat", "Settings → Privacy" (history).
- [x] Plan widget: "42%" used or left? not clickable but looks like the others.
- [x] Voice card's permanent blue ring reads as selected.
- [x] Dictation column previews highlight unselected items (sel).
- [x] Settings General rows split from their setting (Clear history, "You have").

## Usability: tasks Home → Notes
- [x] Returning to Home lands at the top (restore scroll).
- [x] Three names for Notes (Notes / Dictation / Notetaker).
- [x] Plan widget dead end; reset line cut.
- [x] Empty widgets say what to do (Connections, Plan).
- [ ] Home top-right plug/gear unlabelled.
- [x] Only the first pending approval can be answered (one bar per request / 1 of 2).
- [x] Two agents in one folder indistinguishable (add the app).
- [x] No feedback after Allow/Deny.
- [ ] Home agent rows open Agents with that agent in front.
- [x] Agents approval bar under the fold.
- [x] No permanent "New session" on Agents page / Home header.
- [x] Agent vs session wording; "1 sessions" plural.
- [x] Talk: chip "Not listening" static and contradicts "Say Hey JARVIS"; no Send button (mic where send is); silent no-speech timeout.
- [x] Notetaker: older notes unreachable (Earlier slice 6) -> Show all + search; transcript can't be scrolled; export feedback orange and far; delete confirm without name/undo; raw error text; "1 to-dos".
- [x] Dictation: setup (turn on, download model) only in History -> top of Dictation tab; styles do nothing with clean-up off (say so / switch near); removals without undo; copy without feedback; replacement syntax hidden (two-field add); per-app styles wording; two tab levels look the same; History heading duplicated + promo.

## Usability: tasks Mail, Connections, Settings, wording
- [x] Ctrl K: raw keys (hub.mail.autosort...): index real English labels; test no dotted keys.
- [x] Ctrl K lands wrong (moved pages): land on row/group (shell landOn, done in part).
- [x] Ctrl K index out of date (Close after, Launch at Mac startup; "auto-close", "version", "microphone", "api key", "token" not found); breadcrumbs name gone pages: build from rendered rows/tiles.
- [x] Ctrl K has no visible way in; two searches with different indexes.
- [x] Connections: 4-pill limit silent (disable + WhatsApp sentence + which 4); "pill" undefined; tile "Off · turn on" suggests one-click.
- [x] Key Save feedback only a dot (use Accounts notices, label the status dot).
- [x] Tile "Connected" with no data (Checking…).
- [x] Claude key row doesn't say Claude (carry H2 into the label).
- [x] Ask shortcut: "ask" search blank, no empty state; list Ask/Talk keys in Shortcuts group.
- [x] Mail: day-view sender pills grey (green only flagged); small Waiting buttons wired; file filter resets selection + Open file; Done/rule delete/VIP ×/Clear journal/Clear history/Forget my voice/Remove key: undo or confirm; one "busiest" source; one time format; Sorting Add disabled until valid, rule reorder, "Opening in Outlook…"; calendar Today button, month change resets day, relative busy threshold, future days not buttons; Sent by JARVIS to Overview; VIP "marked important".
- [ ] History settings: one verb, in one place, synonyms in search.
- [x] Notch group: island vs notch wording (pick "island"); search hides tab/pill lists and scrolls to the hit.
- [x] Connection tiles: distinct marks (G/G/G), colour from pillColors.
- [ ] WhatsApp setup like the others; jargon under Advanced.
- [x] Wording: Mail hard-coded untranslatable; Mochi-era strings; ALL CAPS subheads; one verb per act; Save vs instant apply (keys lost unsaved); Back links one pattern + Esc/Alt+Left; empty states with an action.

## Usability: navigation and chrome
- [x] Rail opens on almost any entry: zero-speed bug (pointerenter seeds `last`, same timestamp => speed 0). Judge speed over >= 40 ms, ignore dt < 4 ms.
- [x] No real dwell: open after ~300 ms of rest/slow average inside the rail (keyboard focus stays instant).
- [x] Open rail covers page tabs/back links and catches clicks: close on a rightward exit past the collapsed edge.
- [x] No close grace: close after ~300-400 ms off rail and dots; cancel if the pointer comes back.
- [x] Home: rail buttons invisible but tabbable (inert on Home).
- [x] Window dots invisible but tabbable (done: visibility); open on focusin.
- [x] Rail focus ring invisible (done: focus-visible).
- [x] Ctrl K: arrows through results; visible search button with the shortcut.
- [x] Window chrome: drag on all empty top chrome; dots hit area >= 24 px; hovering the visor force-opens the rail (wc-open); "Full screen" tooltip says Maximise.
- [x] Esc closes rail/dots; Esc or Alt+Left = Back; Ctrl+, opens Settings.
- [x] Notes and Mail pages show their section name.
- [x] Settings back link >= 24 px tall.
- [ ] Option to keep the sidebar expanded.
- [x] Home: tabbed-to tiles hidden under the dock (scroll-padding).


Still open after parts 1-6: status chips vs buttons (32), His windows view (34), rail status line (36), Home top-right labels (51, controls no longer there), agent row opens that agent (55), one verb for History (74), WhatsApp setup (77), keep the sidebar expanded (93).