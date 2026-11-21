# JARVIS redesign: the agreed design

Everything agreed during the UI/UX phase (20–21 November 2026), in one place, ready to build into the Windows app (`jarvis-ui/windows`, Tauri 2 + TypeScript).

The working prototypes are the visual source of truth. Open them in Chrome:

| File | What it shows |
|---|---|
| `docs/jarvis/design/prototypes/jarvis-home.html` | The app window: front page, sidebar, every section, Settings, light mode |
| `docs/jarvis/design/prototypes/jarvis-notch.html` | The island: the bigger Cupola-style notch, the mini notch, all its tabs |
| `docs/jarvis/design/prototypes/jarvis-character.html` | JARVIS himself: anatomy, states, reactions, signature animations |
| `docs/jarvis/design/prototypes/design-board.html` | Every screen side by side, live (rebuild with `build-board.py`) |
| `design-references/STUDY.md` (in the project folder, not in the repo) | The Apple design study and the reference images 1–13 |

Where this spec and a prototype disagree, this spec wins. Two pieces were agreed but never built in a prototype: the Snippets page and the Styles page (section 6).

---

## 1. Principles

- Follow Apple's design: calm, few colours, generous space, type does the work.
- Pure black, minimal, matching the island the user already loves. No "tech bro" HUD: no blue brackets, no glowing edges, no glass, no gradients everywhere. Glow and glass versions were rejected as "way too AI".
- Colour only in small places: icon squares, rings, dots, a single bar.
- Life comes from behaviour (glances, blinks, gentle motion), not from effects.
- Every section gets its own window/page. Settings only holds look and feel.

## 2. Tokens

**Dark (default)**

| Token | Value | Use |
|---|---|---|
| `--bg` | `#000` | page |
| `--s0` | `#0e0f11` | sunken panels, sidebar |
| `--s1` | `#1c1c1e` | cards, widgets |
| `--s2` | `#2c2c2e` | raised controls, selected rows |
| `--t1` | `#f5f5f7` | text |
| `--t2` | `#8e8e93` | secondary text |
| `--t3` | `#636366` | tertiary, second half of greetings |

System colours (Apple dark): blue `#0a84ff` (act here), green `#30d158`, orange `#ff9f0a`, red `#ff453a`, purple `#bf5af2`, teal `#64d2ff`, pink `#ff375f`, indigo `#5e5ce6`.

**Light: palette A "Apple grouped"**: page `#f2f2f7`, white cards, text `#1c1c1e`, secondary `#6e6e73` / `#8e8e93`, separators `#e5e5ea`, graded greys `#e3e3e8` / `#eaeaef` / `#f0f0f5` for stacked layers. System colours switch to Apple light: `#007aff`, `#34c759`, `#ff9500`, `#ff3b30`, `#af52de`, `#32ade6`, `#ff2d55`, `#5856d6`. The island stays black in both modes, and JARVIS's look never changes.

**Type**: Segoe UI Variable (system UI). Serif (Georgia / Iowan Old Style) only for the Notetaker's writing and the transcript. Weights 400 and 600.

**Shape**: cards radius 18, widgets 26, pills 999, icon squares 26%. Motion easing `cubic-bezier(.32,.72,0,1)`.

**Dates**: 20 November 2026 is a Friday (watch weekday labels).

## 3. JARVIS himself: design A, "the object"

- A matte white squircle, 140×98, radius 34. Gradient `#f6f7f9 → #eceef1 → #dcdfe4`, lit from above, with a 1.5 px white top edge and only a faint contact shadow.
- A real eye slot cut in: 88×20, radius 10, `#0b0f17 → #1b2433`, with a 1 px `#c9cdd4` rim.
- The eye bar (64×10, radius 5) lives inside the slot. It glances, blinks, tilts and squashes.
- **Eye colour by state:**

  | State | Colour |
  |---|---|
  | idle, question | blue `#0a84ff` |
  | working | green `#30d158` |
  | thinking | purple `#bf5af2` |
  | searching | teal `#64d2ff` |
  | needs you | orange `#ff9f0a` |
  | error | red `#ff453a` |
  | love | pink `#ff375f` |
  | rate limit, sleep | grey |

- **Signature animations**, all in `jarvis-character.html`:
  - start-up;
  - the folder drop: his top half opens like an AirPods-case lid and the file drops in;
  - riding the island's fold;
  - dancing to music while folded;
  - mini visors per agent;
  - a desktop trip.

This visor replaces every JARVIS mark: app, sidebar, orbit, cards, island.

## 4. Navigation

- **Front page:** no sidebar. It has a dock of seven coloured squares: Voice `#bf5af2`, Agents `#30d158`, Windows `#5e5ce6`, Dictation `#ff9f0a`, Mail `#0a84ff`, Connections `#64d2ff`, Settings `#3a3a3c`.
  - On scroll, the squares glide up and shrink into a pinned top bar (design B): visor + "JARVIS" on the left, the squares in the centre, a small "Ask" pill with a blue mic on the right.
  - The squares return to full size at the top.
- **Every other screen:** a sidebar slides in from the left.
  - At rest (A): a slim dark pill, `#0e0f11`, radius 26, 68 px wide, with grey line icons.
  - On hover (C): it widens over the page to 208 px, showing coloured squares and names.
  - Six destinations: Home, JARVIS, Agents, Notes (Dictation + Notetaker as tabs), Mail, Connections. Settings and the avatar sit at the bottom.

## 5. Front page

- **First screen (design 3):**
  - centred "Good evening, **sir.**" with the second half grey;
  - a date/status line: "Friday 20 November · 3 agents working · plan at 42%";
  - a wide "Ask JARVIS anything" pill with a keycap and a blue mic;
  - the dock;
  - a bobbing chevron.
- **Scroll: "At a glance, sir."** This is the home of everything: a shallow look at each section, and pressing a widget opens its tab.
  - Layout: a 4-column Apple widget bento, 190 px rows, 16 px gaps, radius 26.
  - Each widget header: a coloured icon square, the name, and a › on the right.
  - The widgets:
    - **Agents, 2×2, the star:**
      - a live mini orbit, with planets on three rings slowly circling his visor;
      - the agent list with mini visors in their state colours;
      - the Deny / Allow approval bar, which works in place.
    - **JARVIS, 2×1:** visor, "Listening for 'Hey JARVIS'" chip, his last answer, the voice in use.
    - **Claude plan:** session and week rings, plus the reset time.
    - **Notetaker:** "Next call 16:30" in large type and the meeting in serif.
    - **Mail, 2×1:** a mini November calendar shaded by mail volume (today in red), "32 today", "2 waiting on you", the arrivals strip.
    - **Dictation, 2×1:** "1,240 words", minutes saved, the week's bars with a green dashed average.
    - **Windows, 2×1:** "4 drawn" with thumbnails of his drawings.
    - **Connections, 2×1:** Apple Home mini tiles (live = light, off = dark) and "7 of 10 live".

## 6. Sections

### Agents
- **First screen: the orbit.**
  - His visor sits in the centre, with agents as planets around it.
  - **Three rings mean something (design B):**

    | Ring | Look | What JARVIS does |
    |---|---|---|
    | inner, **Watch closely** | faint blue fill | tells you every step and asks before acting |
    | middle, **Normal** | plain | tells you when the agent needs you or finishes |
    | outer, **Quiet** | dashed | only speaks up when it's done or stuck |

  - **Dragging a planet:** it grows and follows the pointer. The nearest ring brightens and a hint line explains it. Drop it and it stays there, on that ring, with a toast. A click without a drag opens its card.
  - **Labels never overlap:** a label slides away, and a hairline ties it back to its planet.
  - Name + what it's doing beside each planet; green working, orange needs you, grey done.
  - The approval bar is pinned at the bottom (Deny / blue Allow), and a Claude plan chip sits top right.
- **Scroll: Wallet card stack (A).**
  - The other sessions peek as stacked card tops.
  - The front card is open: visor with a state-coloured eye, name, "Claude Code · editing file", a live code diff, a progress bar, "Open terminal".
  - Clicking a planet brings its card to the front.

### JARVIS (voice and vision), design B
- **Left:** a listening panel with a "Listening" chip, his visor, a live purple waveform, the voice card ("George · British, calm · Change ›" with a sample button), and an "Answer only my voice" toggle.
- **Right:** the conversation as Messages bubbles (you blue on the right, him grey on the left), with his drawings inline as thumbnails, grouped by day.
- "Mute other apps while you talk" is a wanted feature, not a bug.

### Notes · Dictation (top design 3 → scroll 6 → further 4)
- **Top: Screen Time style.**
  - "This week 8,420 words", the change vs last week, time saved;
  - a Day / Week / Month switch and an orange bar chart with a green dashed average;
  - "Where you dictate": per-app bars.
  - Header: the hold key as a keycap and a "Parakeet ready" chip.
- **Scroll:** widgets (words today, streak ring, style chips) and a word cloud of the Dictionary.
- **Further: Dictionary | Snippets | Styles columns.** Each opens its own full page with "‹ Dictation" and a switch between the three:
  - **Dictionary: word wall (B).**
    - A search-or-add pill with an orange +.
    - Every word is a chip, sized by how often you say it, biggest in the middle; the selected chip is orange.
    - A detail bar: how it gets misheard ("cloud", "clawed"), how many times, the last time you said it and in which app, and Edit / Remove.
  - **Snippets: live demo (C).** A list of snippets on the left. On the right, a panel: "You say: …thanks again, **sign off**" with the phrase in orange, then "Outlook gets" with the expansion typed out and highlighted. Edit / Remove, and + to add.
  - **Styles: tone slider (C).** A big preview sentence; a slider Casual · Natural · Formal that rewrites the sentence as you drag; Code, Notes and "+ New" presets as chips below.

### Notes · Notetaker
- **Home: "the blank page" (unique to this tab).**
  - A dark lined page with a red margin line.
  - Serif text: "Your next call is at 16:30. I'll write it down for you.", with a blinking blue caret.
  - A red Record dot in the margin.
  - Scrolling leads to the calendar day timeline (meetings with notes, the live one in red) and Journal cards (summary first, newest large).
- **Recording: its own page (B).**
  - "‹ Notetaker" and a pulsing red timer.
  - The call name and people, and a large red waveform.
  - The previous sentence small and dim; the current sentence big in serif, with the speaker's name in their colour.
  - A round stop button.
- **A call's note:** the summary first (a big two-tone sentence), then To-dos and Key points tiles, then "Show transcript ›".
- **Transcript: lyrics (B).**
  - The call in big serif lines like Apple Music lyrics. The spoken line is bright, with the speaker and time above it in their colour; its neighbours are grey and the rest dimmer and slightly blurred, fading at top and bottom.
  - To-do lines carry an orange "To-do" tag.
  - A pill player: play/pause, a scrubber with orange to-do marks, the time, 1× / 1.5× / 2×.
  - Click a line or the scrubber to jump; the scroll wheel steps line by line.

### Mail: final design A
- **Left:** a full month calendar (1–30, Monday first). Each day has mail-kind dots and a blue volume bar; today is a red circle and the selected day has a blue outline.
- **Right:**
  - a tall day panel: "Friday 20 · 32 mails · 2 need you", with hourly rows and senders grouped as pills in dashed capsules;
  - **When mail arrives** (the most important widget, wide): a 24-hour bar strip;
  - **Waiting on you:** cards with round ↩ ✓ ? buttons;
  - **Files today:** type-tagged file tiles.
- **Each widget expands into its own full view.** "‹ Mail" shrinks it back.
  - When mail arrives: a big 24-hour chart stacked by kind, a list for the chosen hour, and a "deliver twice a day" suggestion.
  - Waiting on you: large message cards with attachments, suggested-reply chips, and round Reply / Done / Later buttons.
  - Files today: large previews, type filter chips, and Open / Save to… / Forward / Show the mail.
- Style is from reference 13: dashed capsules, round action buttons, dot grids, bento.

### Connections: Apple Home style, its own section
- Room chips: All, Code, Money, Life. With "All" selected, rooms appear as headings.
- Square tiles: bright `#f2f2f7` when live, dark when off or needing attention. Each has a brand-colour round icon, its name, and one live value.
- GitHub is a wide tile listing PRs, and "+" adds a connection.
- Connections: GitHub, Stripe, Vercel, Notion, Cal.com, n8n, Resend, Spotify, WhatsApp, Google Calendar.

### Settings: look and feel only, following reference 12
- A grouped left sub-nav with scroll-spy, and Ctrl K search.
- Rows: label + grey description on the left, the control on the right. Prefixed inputs show a green check.
- **Groups:**
  - **General**
  - **Appearance:** theme, accent swatches, text size, motion, desktop JARVIS
  - **Island:** show, fold delay, tab chips, screen
  - **Shortcuts:** keycap recorders
  - **Sound:** including "quiet other apps while you talk"
  - **Accounts and keys**
  - **Privacy:** including a "Clear history" confirm
  - **About**
- The drawing-model setting (Haiku / Sonnet / Opus cards plus Other) stays where PR #15 put it.

## 7. The island (notch)

- **Look:** keep its look, with design A's visor.
- **Base features stay:** Home card, pills, Ask, Drop, New session, Calendar, and existing animations such as the folder opening.
- **Bigger Cupola-style state:** design A tabs, Overview C, Focus mode B. The tabs are:
  - Home, Ask, Drop, Launch;
  - Today (Today / Week);
  - Overview;
  - Reminders;
  - Notes;
  - Clipboard history;
  - Focus (timer + music);
  - Agents.
- **Music:** Apple Music and Spotify, both through the Windows media session.
- **Focus mode vs normal mode.** Plain-language quick add on Today.
- **Mini notch:** after 3 s idle it folds back to just the visor. The visor rides the fold, and dances to music while folded.
- **Agents tab:** a mini visor per agent, with its eye in that agent's state colour.
- **Drop tab:** the AirPods-lid folder drop.

## 8. Floating windows (explanation windows, ask box)

Agreed direction only, not yet designed: pure black, minimal, matching the island, and dropping the frame-B blue HUD styling.

## 9. Still open

- Mochi: keep or retire.
- The floating-window restyle (section 8) needs its three designs.
- Animations, beyond what the character sheet already defines.

## 10. Build order (proposal)

Each phase is its own issue and pull request, built on the one before.

1. **Foundation:** tokens (dark + light palette A), the theme switch, design A's visor component, and the state colours.
2. **Shell:** the front page (greeting, ask pill, dock, pinned-bar glide) and the sidebar on every other screen.
3. **At a glance:** the front-page widgets, fed by the data the app already has (agents, plan, dictation, mail, calendar).
4. **Agents:** the orbit with the three meaning rings, dragging, the approval bar, and the card stack. The ring is stored per session and changes how loudly JARVIS reports.
5. **Notes:** Dictation (chart, walls, Snippets demo, Styles slider) and Notetaker (blank page, recording page, note, lyrics transcript).
6. **Mail**, then **Connections**, then **JARVIS (voice)**.
7. **Settings** regrouped to reference 12.
8. **The island:** design A visor, the bigger notch and its tabs, the mini notch, the Focus mode.
