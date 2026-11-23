# JARVIS UX principles

A checklist for auditing the JARVIS main window (rail, Home bento, dock, Ask box, section pages with tabs, Settings). Animation is out of scope. Each item gives the rule, why it matters, a threshold or example where one exists, and how to check it. Bracketed tags point to the sources at the end.

Severity hint for audits: **P1** blocks or misleads the user, **P2** slows them down, **P3** is polish.

---

## 1. Navigation and wayfinding

**N1. Primary navigation stays visible on desktop.**
- Why: hidden navigation is used about half as often and makes desktop tasks at least 39% slower; it also cuts content discoverability by more than 20%. [NNG-HAMB]
- Example: NN/g says plainly not to use hidden navigation in desktop UIs. Apple says to avoid hiding the sidebar by default. [HIG-SIDEBAR]
- How to check: with the pointer away from the rail, can a first-time user name every section? If the rail shows only icons, are they recognisable without hovering (see R1)?

**N2. The rail shows "you are here".**
- Why: a missing current-location indicator is "probably the single most common mistake" in menus. [NNG-MENU] [NNG-YAH]
- Example: the active section icon has a filled or contrasted background plus a second cue (weight, indicator bar), visible in both collapsed and expanded rail states.
- How to check: open each section. Is exactly one rail item marked, and is the mark visible at a glance in collapsed state?

**N3. Every page names itself.**
- Why: users arrive from many paths; the page title is the strongest location cue. [NNG-YAH]
- How to check: each section and Settings sub-page has a visible heading that matches the rail label and the window or document title.

**N4. A clear way back from every drill-in.**
- Why: user control and freedom: "clearly marked exits". [NNG-10]
- Example: Settings sub-pages show "‹ Settings" at top left; Connections setup pages show "‹ Connections". The link names the parent, not "Back".
- How to check: from every second-level page, can you return in one click, and does the label name the destination? Does Esc or Alt+Left also go back?

**N5. Back follows hierarchy, not history, for in-app links.**
- Why: breadcrumb-style links show structure; history belongs to a Back command. [NNG-BREAD]
- How to check: "‹ Settings" always returns to the Settings group the sub-page belongs to, even if the user arrived from search.

**N6. Settings sits last in the rail, pinned to the bottom.**
- Why: Windows convention for NavigationView layouts. [MS-SETTINGS] [MS-NAVVIEW]
- How to check: Settings is the bottom rail item, separated from section items.

**N7. Keep the rail to 5 to 10 equally important items.**
- Why: Microsoft recommends left navigation for 5 to 10 top-level categories (top nav for 5 or fewer). [MS-NAVVIEW]
- How to check: count rail items. More than 10, or items of unequal weight mixed together, means regroup.

**N8. Tabs: one row, short labels, selected tab marked with two cues.**
- Why: weak selected-tab indicators (thin 1px line, low contrast) are missed. [NNG-TABS]
- Example: selected tab = filled pill + bolder text; labels one or two words; sentence case.
- How to check: in Notes, Mail and Agents, is the selected tab obvious in a greyscale screenshot? Is there only one row?

**N9. Do not mix navigation tabs and in-page tabs in one control.**
- Why: in-page tabs switch views of the same content; navigation tabs go to different pages. Mixing breaks expectations. [NNG-TABS]
- Example: Notes "Notetaker / Dictation" (sections) vs their sub-views should be visually distinct levels (e.g. tabs vs a segmented control).
- How to check: wherever tabs are nested, are the two levels styled differently and is the lower one closer to its content?

**N10. No more than two levels of hierarchy in the sidebar.**
- Why: deeper hierarchies belong in a content list or page, not the sidebar. [HIG-SIDEBAR]
- How to check: the rail holds sections only; sub-views live in page tabs.

**N11. Do not put critical actions at the bottom of a sidebar alone.**
- Why: Apple notes window bottoms often end up off-screen. [HIG-SIDEBAR]
- How to check: anything at the rail bottom other than Settings is also reachable elsewhere.

---

## 2. Hover and pointer behaviour

**H1. Hover-to-open waits for intent.**
- Why: opening on mere pass-through causes accidental activation. [NNG-HOVER] [SMASH-MEGA]
- Threshold: open after the pointer has rested on the trigger **300 to 500 ms** (NN/g); Windows' default hover time is **400 ms** [MS-TRACKMOUSE]. Visual hover feedback on the item itself within **100 ms**.
- How to check: in code, the rail's expand timer starts on `pointerenter` and is cancelled on `pointerleave`; measure the value. Sweep the pointer across the rail to reach page content: the rail must not expand.

**H2. Hover-to-close has a grace period.**
- Why: users overshoot and wobble; instant close punishes small errors. [NNG-HOVER]
- Threshold: keep open until the pointer has been off both trigger and revealed content for **more than 500 ms** (NN/g). Smashing cites about 500 ms each way and warns not to stack fade time on top (total lag 0.8 to 0.9 s feels slow; keep fades at or under 300 ms).
- How to check: leave the expanded rail by 20px and come back within 0.4 s: it must stay open.

**H3. Revealed content is hoverable and persistent.**
- Why: WCAG 1.4.13: content shown on hover must stay while the pointer moves onto it, persist until dismissed, and be dismissible without moving the pointer (Esc). [WCAG-1413]
- How to check: expanded rail labels and window dots do not vanish as the pointer moves from trigger onto them; Esc collapses them.

**H4. Diagonal movement does not switch the wrong item.**
- Why: menu-aim (Kamens / Amazon): if the pointer moves inside the triangle toward an open panel, keep the current panel instead of opening the sibling under the pointer. [SMASH-MEGA] [KAMENS]
- How to check: any hover flyout from the rail (or a submenu) survives a diagonal move across neighbouring items.

**H5. Hover is never the only way in.**
- Why: keyboard and touch users cannot hover; NN/g recommends click-activated menus or a backup. [NNG-MENU] [NNG-ICON]
- Example: the rail also expands on keyboard focus and has a pin/expand button; window dots appear on focus too.
- How to check: Tab through the window with no mouse. Can you reach every section, see labels, and minimise or close the window?

**H6. Hover-revealed controls must not hide essential functions.**
- Why: content that appears only on hover is invisible until discovered (window dots on a logo, labels in the rail). [NNG-ICON] [NNG-TOOLTIP]
- How to check: list every element that is invisible at rest. Each one is either non-essential or has a visible alternative.

**H7. Hover does not shift layout under the pointer.**
- Why: if the expanding rail pushes content, the target the user was heading for moves away (Fitts). [LAWS-FITTS]
- How to check: the expanded rail overlays content (as LeftCompact does) rather than reflowing the page. [MS-NAVVIEW]

**H8. Pointer targets are at least 24×24 CSS px; aim for larger.**
- Why: WCAG 2.5.8 minimum is 24×24 CSS px (or 24px clear spacing); Apple recommends a 44×44 pt hit region. [WCAG-258] [HIG-BUTTONS]
- How to check: measure the window dots, rail icons, "›" rows, tab pills and dock icons in DevTools; hit area includes padding, not just the glyph.

---

## 3. Signifiers and clickability

**S1. Clickable things look clickable without hovering.**
- Why: weak signifiers made tasks about 22% slower with 25% more fixations; users looked at targets and moved on. [NNG-FLAT]
- How to check: take a static screenshot. Can a fresh viewer point to every clickable element? Never require "scrubbing the screen with the mouse". [NNG-CLICK]

**S2. Flat and minimal is fine only with strong contrast and familiar layout.**
- Why: flat UI performed equally only with low density, conventional layout and high-contrast targets. [NNG-FLAT]
- Example: on a black monochrome UI, buttons need a visible fill or outline, not text that is the same grey as labels.
- How to check: compare the contrast of buttons/links vs static text. Static text must not share the button or link style.

**S3. Non-clickable things do not look clickable.**
- Why: headings styled like buttons draw false clicks. [NNG-CLICK]
- How to check: bento widget headings, status chips and section labels that are not interactive have no button styling, hover effect or pointer cursor.

**S4. Cursor and hover state match behaviour.**
- Why: feedback within 0.1 s confirms the element is live. [NNG-HOVER] [NNG-RESP]
- How to check: `cursor: pointer` (or the platform's default arrow for app chrome, consistently) on every interactive element and on nothing else; each interactive element has rest, hover, pressed, focus and disabled states.

**S5. Whole-card click, with secondary actions clearly separated.**
- Why: entire-card targets are bigger (Fitts) but inner buttons must not be confused with the card's main action. [NNG-CARDS]
- Example: a bento widget opens its section; an inner "Play" or toggle does its own thing and is visually set apart.
- How to check: click every part of each widget. Does any spot do something unexpected? Do inner controls stop propagation?

**S6. Distinguish signifier from affordance.**
- Why: Norman: an affordance is what is possible; a signifier is the perceivable cue that tells you so. Invisible affordances go unused. [WIKI-DOET]
- How to check: for each hidden gesture (hover logo for window dots, drag to reorder widgets, right-click), is there a visible cue?

**S7. Arrows are weak clickability cues on their own.**
- Why: NN/g found arrow icons the least favourable clickability signal. [NNG-CLICK]
- How to check: a "›" row also has a full-row hover state and a label; the arrow is never the only target.

---

## 4. Mapping and direction (arrows, chevrons, where things appear)

**M1. › means drill in / go forward; ‹ means go back.**
- Why: Jakob's law: users bring direction meaning from every other app. [LAWS-JAKOB]
- How to check: every "›" opens a deeper page that slides or appears to the right; every "‹" returns to the parent. No "›" opens a popover or toggles content in place.

**M2. Disclosure chevrons point to where content is or will be.**
- Why: Apple: a disclosure triangle points to the leading edge when hidden and down when shown; a disclosure button points down when hidden and up when shown. [HIG-DISCLOSE]
- Example: collapsed group "›" (or "⌄" button), expanded "⌄" (or "⌃" button). Pick one model per control type and keep it.
- How to check: open and close every expandable. Does the icon flip, and does content appear on the side the icon pointed?

**M3. Use the caret (chevron) for accordions, not plus or arrow.**
- Why: in NN/g's test only the down caret beat having no icon. [NNG-ACCORD]
- How to check: expandable groups use a chevron; plus signs are reserved for "add".

**M4. One control, one behaviour.**
- Why: users clicked icon and label equally and did not expect different results. [NNG-ACCORD]
- How to check: on any row with label + chevron, both do the same thing.

**M5. Spatial mapping: things appear next to what triggered them.**
- Why: Norman's mapping: the relationship between control and effect should be obvious. [WIKI-DOET] [HIG-DISCLOSE]
- Example: the rail expands rightward from the rail; a menu from the dock opens upward from the dock; the Ask box answer appears near the Ask box or in the JARVIS page it says it will go to.
- How to check: for each popover, flyout, toast: does it emerge from or near its trigger?

**M6. Direction of transitions matches hierarchy.**
- Why: forward = content enters from the right; back = from the left. Inconsistent direction breaks the conceptual model. [WIKI-DOET]
- How to check: drill into a Settings sub-page and back; Connections tile into setup and back. Same direction rules everywhere.

**M7. Groups read as groups (Gestalt).**
- Why: proximity, common region and similarity tell users what belongs together. [LAWS]
- How to check: within each bento tile, related items share a bounded region; spacing between groups is clearly larger than within groups; identical-looking items behave identically.

---

## 5. Feedback and system status

**F1. Every action gets feedback within 100 ms.**
- Why: 0.1 s feels instant; 1 s keeps flow; 10 s loses attention. [NNG-RESP]
- How to check: press every button: pressed state appears immediately, even if the work takes longer.

**F2. Show progress past about 1 second; percent-done past about 10.**
- Why: beyond 1 s users need to see the system is working; beyond 10 s they need progress and a way to cancel. [NNG-RESP]
- Example: JARVIS thinking, mail sync, connection setup.
- How to check: throttle the network; is there a spinner or status by 1 s and a cancel for long jobs?

**F3. Aim for responses under 400 ms.**
- Why: Doherty threshold: productivity rises when neither side waits more than about 400 ms. [LAWS-DOHERTY]
- How to check: time section switches and tab changes; anything slower needs a skeleton or optimisation.

**F4. Status is visible in place, not only in a log.**
- Why: heuristic 1, visibility of system status. [NNG-10]
- Example: a Connections tile shows Connected / Needs attention / Off on its face; the mic state of Dictation is visible.
- How to check: for each section, can you tell its current state from the page without opening anything?

**F5. Toggles show their effect immediately.**
- Why: toggles should take effect immediately with visible feedback. [NNG-TOGGLE] [MS-SETTINGS]
- How to check: flip each toggle; something in the UI reflects the change at once.

**F6. Loading, empty and error are three different states.**
- Why: showing "No items" while still loading misleads. [NNG-EMPTY]
- How to check: load each list slowly, with no data and with a forced error; the three screens differ.

**F7. Window active vs inactive is visible.**
- Why: Windows title bars dim when the window is inactive. [MS-TITLEBAR]
- How to check: click another app; does the JARVIS chrome dim?

---

## 6. Consistency and standards (Windows conventions vs Mac look)

**C1. Same word, same thing, everywhere.**
- Why: heuristic 4: words and actions should mean the same thing throughout. [NNG-10]
- How to check: list section names in the rail, page headings, dock, Home tiles and Settings. Any differences (e.g. "Mail" vs "Inbox", "Connections" vs "Integrations")?

**C2. Same icon, same meaning, everywhere.**
- Why: icons with several meanings confuse users. [NNG-ICON]
- How to check: build an icon inventory; each glyph maps to one meaning across rail, dock, tiles and settings.

**C3. Same component, same behaviour.**
- Why: users generalise from one instance to all. [LAWS-JAKOB]
- How to check: all "›" rows, all tabs, all toggles, all cards behave identically across sections.

**C4. Window controls: keep Windows behaviour even with a Mac look.**
- Why: Windows users expect caption controls top right, a draggable title area, double-click to maximise, right-click for the system menu. [MS-TITLEBAR]
- Example: macOS-style dots at top left are a deliberate brand choice; they must still be discoverable (see H6), have tooltips (Close, Minimise, Maximise), support Snap Layouts if possible, and keyboard Alt+F4 / Win+Arrow must work.
- How to check: drag empty top area to move; double-click to maximise; right-click empty top area; can a Windows user find Close in under 5 s on first use?

**C5. Draggable region covers all empty chrome.**
- Why: Windows title bar guidance: all empty or non-interactive space should drag the window. [MS-TITLEBAR]
- How to check: in code, `data-tauri-drag-region` (or equivalent) is on empty top space and not on interactive elements.

**C6. Follow platform keyboard conventions.**
- Why: heuristic 4 and 7; Windows users expect Ctrl shortcuts, Tab order, Esc to dismiss, Enter to confirm. [NNG-10]
- How to check: Ctrl+F in Settings focuses search; Esc closes popovers; focus ring is visible on black.

**C7. Do not rely on colour alone for state.**
- Why: Apple: make toggle states obvious and do not rely only on colour. [HIG-TOGGLES]
- How to check: view in greyscale; on/off, selected/unselected, error/normal remain distinguishable.

**C8. Follow Windows theme and accessibility settings.**
- Why: title bars should adapt to light/dark and high contrast. [MS-TITLEBAR]
- How to check: turn on Windows high contrast and text scaling 150%; nothing clips or vanishes.

---

## 7. Error prevention and recovery

**E1. Prevent errors before messaging them.**
- Why: heuristic 5; good defaults and constraints beat error messages. [NNG-10]
- How to check: invalid choices are disabled with an explanation, not allowed and then rejected.

**E2. Confirm only serious, irreversible actions; prefer undo.**
- Why: frequent confirmations train people to click through; undo catches what confirmations miss. [NNG-CONFIRM]
- Example: deleting a sorting rule shows "Rule deleted · Undo"; disconnecting an account that deletes local data confirms.
- How to check: list every destructive action; each has undo or a specific confirmation.

**E3. Confirmations name the object and use outcome verbs.**
- Why: "Are you sure?" with Yes/No invites reflexive clicks. [NNG-CONFIRM]
- Example: "Delete 'Work' rule?" with "Delete rule" / "Keep rule".
- How to check: no Yes/No or OK/Cancel pairs on destructive dialogs.

**E4. Destructive buttons are never the primary/default button.**
- Why: people press the prominent button without reading. [HIG-BUTTONS]
- How to check: Enter in a destructive dialog does not destroy; destructive buttons are styled distinctly (red text on monochrome is acceptable as the single exception colour).

**E5. Error messages: near the problem, plain words, a fix, input kept.**
- Why: NN/g error message guidelines. [NNG-ERROR] [MS-WRITING]
- Example: "We couldn't reach Gmail. Check your connection, then try again." not "Error 0x80072EE7".
- How to check: force each error; the message sits by the field or tile, has no raw code up front, offers a next step, and the user's input is still there.

**E6. Do not blame the user.**
- Why: Microsoft voice: take responsibility, offer guidance. [MS-WRITING]
- How to check: no "invalid", "illegal" or "you failed" wording.

---

## 8. Recognition over recall and discoverability

**R1. Icons get visible text labels.**
- Why: few icons are universal (home, search, print); obscure icon = wasted feature. Hover-only labels add cost. [NNG-ICON]
- Example: the collapsed rail is an exception only if the icons are standard and the expanded labels are one hover or one click away; Home tiles and Settings rows always show text.
- How to check: cover the labels; ask someone to name each rail icon. Anything they miss needs a label or a better icon.

**R2. Unlabelled icons at least get a tooltip and accessible name.**
- Why: Microsoft: icon-only buttons need tooltips; keyboard focus must show them too. [MS-TOOLTIP] [NNG-TOOLTIP]
- How to check: every icon-only control has `aria-label` and a tooltip on hover and focus.

**R3. Tooltips are supplemental, never essential.**
- Why: tooltips disappear and are often never discovered. [NNG-TOOLTIP] [MS-TOOLTIP]
- How to check: remove all tooltips mentally; can every task still be done?

**R4. Keep options visible rather than remembered.**
- Why: heuristic 6: do not make users carry information between screens. [NNG-10]
- Example: Mail sorting rules show their conditions in the list, not only after opening.
- How to check: any screen where the user must remember something from a previous screen to act.

**R5. Empty states teach the next step.**
- Why: an empty state is a learning cue and should offer a direct action. [NNG-EMPTY]
- Example: Notes empty: "No notes yet. Start Dictation or press Ctrl+N." with a button.
- How to check: open every list with no data; each has a sentence explaining what goes here and a button to start.

**R6. Hidden gestures have a visible equivalent.**
- Why: Norman's discoverability: users should be able to work out what actions are possible. [WIKI-DOET]
- How to check: list every hover, right-click, drag and shortcut-only action; each has a visible control somewhere.

**R7. The conceptual model is consistent.**
- Why: Norman: users build a model from what they see; contradictions cause errors. [WIKI-DOET] [NNG-GULFS]
- Example: is "JARVIS" a section, a voice, or the Ask box? Decide and make the UI say the same thing everywhere.
- How to check: ask a new user to explain what Home, the dock and the Ask box each do; mismatches signal model problems.

---

## 9. Efficiency (Fitts, Hick, shortcuts)

**EF1. Frequent targets are big and close (Fitts).**
- Why: time to hit a target grows with distance and shrinks with size. [LAWS-FITTS]
- How to check: the Ask box and most-used widgets are large and near where the eye starts; screen-edge targets (rail) extend to the edge so overshoot still hits.

**EF2. Limit choices per decision (Hick).**
- Why: decision time grows with the number and complexity of options. [LAWS-HICK]
- Example: a bento with a dozen equally loud widgets is slower to scan than six with one highlighted.
- How to check: count equally weighted choices on Home and in the dock; mark the recommended or most-used one.

**EF3. Do not oversimplify into ambiguity.**
- Why: Hick's law warns against stripping a design until it becomes abstract; Tesler: complexity moves, it is not removed. [LAWS-HICK] [LAWS-TESLER]
- How to check: any monochrome icon-only cluster that saves space but costs a hover to understand.

**EF4. Shortcuts for experts, invisible to novices.**
- Why: heuristic 7, flexibility and efficiency. [NNG-10]
- Example: Ctrl+1..n for sections, Ctrl+K or a hotkey for Ask, Ctrl+, for Settings; shown in tooltips (Microsoft displays accelerators in tooltips). [MS-TOOLTIP]
- How to check: shortcuts exist for top actions and are discoverable in tooltips or a help sheet.

**EF5. Avoid hover delays stacking on every trip.**
- Why: a 400 ms open delay on a rail visited 50 times a day adds up; offer a pinned expanded mode. [MS-NAVVIEW] [SMASH-MEGA]
- How to check: Settings has "Keep sidebar expanded" or the window width auto-expands it (NavigationView expands the pane at 1008px+).

**EF6. Aesthetic polish does not excuse usability problems.**
- Why: aesthetic-usability effect: attractive UIs are perceived as easier and can mask issues in testing. [LAWS]
- How to check: in usability tests, measure task success and time, not only satisfaction.

---

## 10. Content and microcopy

**W1. Plain, familiar words.**
- Why: heuristic 2, match the real world. [NNG-10] [MS-WRITING]
- How to check: no internal jargon or code names in visible labels (e.g. "agents runtime", "IPC").

**W2. Sentence case for labels, titles and buttons on Windows.**
- Why: Microsoft capitalises only the first word and proper nouns. Apple suggests title case for button labels, so pick one and apply it everywhere; for a Windows app, sentence case. [MS-WRITING] [HIG-BUTTONS] [NNG-TABS]
- How to check: scan every label; flag any mixed casing and any ALL CAPS label.

**W3. Buttons are short verbs.**
- Why: every button is an action; a couple of short words at most. [MS-WRITING] [HIG-BUTTONS]
- Example: "Connect", "Add rule", "Start dictation", not "OK" or "Submit".
- How to check: every button label starts with a verb or is a standard command.

**W4. Lead with what matters; cut padding.**
- Why: users scan and skip long text. [MS-WRITING]
- How to check: descriptions under settings rows are one line; the key word comes first.

**W5. No periods on labels and buttons; periods on full sentences.**
- Why: Microsoft style convention. [MS-WRITING]
- How to check: grep UI strings for trailing periods on short labels.

**W6. Toggle labels describe the "on" state and are not questions.**
- Why: reading "label + on/off" aloud must make sense. [NNG-TOGGLE]
- Example: "Wake word" or "Listen for 'Jarvis'", not "Should JARVIS listen?".
- How to check: append "on"/"off" to each toggle label.

**W7. Tab and section labels are 1 to 2 descriptive words.**
- Why: strong information scent; no marketing terms. [NNG-TABS]
- How to check: no tab label longer than two words; no branded names a newcomer cannot decode.

---

## 11. Settings

**ST1. Group related settings under clear headers.**
- Why: Microsoft: group under section headers; Apple: succinct group labels. [MS-SETTINGS] [HIG-SIDEBAR]
- How to check: each Settings group has a one-word header ("Voice", "Accounts", not "Account settings").

**ST2. Settings apply immediately; no Save button.**
- Why: Microsoft: reflect the change immediately, no confirmation button; toggles need instant effect. [MS-SETTINGS] [NNG-TOGGLE]
- How to check: no Save/Apply on settings pages, and no toggles mixed into forms that need Submit. Where a change truly cannot apply now (e.g. needs restart), say so next to it.

**ST3. Smart defaults, few settings.**
- Why: Microsoft: define smart defaults and keep the number of settings minimal. [MS-SETTINGS] [NNG-TOGGLE]
- How to check: every setting has a sensible default; a fresh install works without visiting Settings.

**ST4. Settings hold configuration, not workflow.**
- Why: commands used during normal work belong in the work area, not Settings. [MS-SETTINGS]
- Example: creating a Mail sorting rule is workflow (Mail page); choosing the default mail account is a setting.
- How to check: anything users change daily lives in its section, not Settings.

**ST5. The right control for the job.**
- Why: toggle for on/off; radio buttons for up to about 5 exclusive options; dropdown beyond that; buttons for immediate actions. [MS-SETTINGS] [HIG-TOGGLES]
- How to check: no dropdown with two options; no toggle used for a choice that is not on/off.

**ST6. Disabled settings explain why.**
- Why: Microsoft: add a description when a control is disabled. [MS-SETTINGS]
- How to check: every greyed setting has a line of text saying what enables it.

**ST7. Settings search finds settings by synonyms and opens them in place.**
- Why: Apple: search as people type, default to the broad scope, placeholder says what can be searched. [HIG-SEARCH]
- Example: placeholder "Search settings"; typing "mic" finds "Microphone" and "Dictation input".
- How to check: results update per keystroke; selecting a result opens the sub-page and highlights the row; "‹ Settings" returns to the correct group.

**ST8. Drill-down rows look like drill-down rows.**
- Why: a "›" row promises a sub-page; a row with a toggle acts in place. Microsoft's SettingsCard makes the whole card clickable for navigation entries. [MS-SETTINGS] [NNG-CLICK]
- How to check: rows with "›" open a page; rows with controls never also carry "›"; the whole row is the hit area.

**ST9. Theme choice offers Light, Dark, Use system setting.**
- Why: Windows standard wording and options. [MS-SETTINGS]
- How to check: if JARVIS allows theme choice, the options and wording match.

**ST10. About lives at the bottom of Settings.**
- Why: Microsoft recommends app name, version, links and legal in an About section at the end. [MS-SETTINGS]
- How to check: version number is findable in Settings in under 10 s.

---

## Sources

- [NNG-10] NN/g, 10 Usability Heuristics for User Interface Design: https://www.nngroup.com/articles/ten-usability-heuristics/
- [NNG-HOVER] NN/g, Timing Guidelines for Exposing Hidden Content: https://www.nngroup.com/articles/timing-exposing-content/
- [NNG-HAMB] NN/g, Hamburger Menus and Hidden Navigation Hurt UX Metrics: https://www.nngroup.com/articles/hamburger-menus/
- [NNG-MENU] NN/g, Menu-Design Checklist: https://www.nngroup.com/articles/menu-design/
- [NNG-YAH] NN/g, Navigation: You Are Here: https://www.nngroup.com/articles/navigation-you-are-here/
- [NNG-BREAD] NN/g, Breadcrumbs: https://www.nngroup.com/articles/breadcrumbs/
- [NNG-TABS] NN/g, Tabs, Used Right: https://www.nngroup.com/articles/tabs-used-right/
- [NNG-ICON] NN/g, Icon Usability: https://www.nngroup.com/articles/icon-usability/
- [NNG-FLAT] NN/g, Flat UI Elements Attract Less Attention and Cause Uncertainty: https://www.nngroup.com/articles/flat-ui-less-attention-cause-uncertainty/
- [NNG-CLICK] NN/g, Beyond Blue Links: Making Clickable Elements Recognizable: https://www.nngroup.com/articles/clickable-elements/
- [NNG-CARDS] NN/g, Cards: UI-Component Definition: https://www.nngroup.com/articles/cards-component/
- [NNG-ACCORD] NN/g, Accordion Icons: Which Signifiers Work Best?: https://www.nngroup.com/articles/accordion-icons/
- [NNG-TOOLTIP] NN/g, Tooltip Guidelines: https://www.nngroup.com/articles/tooltip-guidelines/
- [NNG-TOGGLE] NN/g, Toggle-Switch Guidelines: https://www.nngroup.com/articles/toggle-switch-guidelines/
- [NNG-CONFIRM] NN/g, Confirmation Dialogs Can Prevent User Errors (If Not Overused): https://www.nngroup.com/articles/confirmation-dialog/
- [NNG-ERROR] NN/g, Error-Message Guidelines: https://www.nngroup.com/articles/error-message-guidelines/
- [NNG-EMPTY] NN/g, Designing Empty States in Complex Applications: https://www.nngroup.com/articles/empty-state-interface-design/
- [NNG-RESP] NN/g, Response Times: The 3 Important Limits: https://www.nngroup.com/articles/response-times-3-important-limits/
- [NNG-GULFS] NN/g, The Two UX Gulfs: Evaluation and Execution: https://www.nngroup.com/articles/two-ux-gulfs-evaluation-execution/
- [WIKI-DOET] The Design of Everyday Things (Don Norman), summary of principles: https://en.wikipedia.org/wiki/The_Design_of_Everyday_Things
- [LAWS] Laws of UX (index, incl. proximity, common region, similarity, aesthetic-usability): https://lawsofux.com/
- [LAWS-FITTS] Laws of UX, Fitts's Law: https://lawsofux.com/fittss-law/
- [LAWS-HICK] Laws of UX, Hick's Law: https://lawsofux.com/hicks-law/
- [LAWS-JAKOB] Laws of UX, Jakob's Law: https://lawsofux.com/jakobs-law/
- [LAWS-DOHERTY] Laws of UX, Doherty Threshold: https://lawsofux.com/doherty-threshold/
- [LAWS-TESLER] Laws of UX, Tesler's Law: https://lawsofux.com/teslers-law/
- [SMASH-MEGA] Smashing Magazine, User-Friendly Mega-Dropdowns: When Hover Menus Fail: https://www.smashingmagazine.com/2021/05/frustrating-design-patterns-mega-dropdown-hover-menus/
- [KAMENS] Ben Kamens, Breaking down Amazon's mega dropdown (2013), and the jQuery-menu-aim plugin: https://bjk5.com/post/44698559168/breaking-down-amazons-mega-dropdown ; https://github.com/kamens/jQuery-menu-aim
- [WCAG-1413] W3C, Understanding SC 1.4.13 Content on Hover or Focus: https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html
- [WCAG-258] W3C, Understanding SC 2.5.8 Target Size (Minimum): https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- [HIG-DISCLOSE] Apple HIG, Disclosure controls: https://developer.apple.com/design/human-interface-guidelines/disclosure-controls
- [HIG-SIDEBAR] Apple HIG, Sidebars: https://developer.apple.com/design/human-interface-guidelines/sidebars
- [HIG-TOGGLES] Apple HIG, Toggles: https://developer.apple.com/design/human-interface-guidelines/toggles
- [HIG-SEARCH] Apple HIG, Search fields: https://developer.apple.com/design/human-interface-guidelines/search-fields
- [HIG-BUTTONS] Apple HIG, Buttons: https://developer.apple.com/design/human-interface-guidelines/buttons
- [MS-NAVVIEW] Microsoft Learn, NavigationView: https://learn.microsoft.com/en-us/windows/apps/design/controls/navigationview
- [MS-TITLEBAR] Microsoft Learn, Windows app title bar: https://learn.microsoft.com/en-us/windows/apps/design/basics/titlebar-design
- [MS-SETTINGS] Microsoft Learn, Guidelines for app settings: https://learn.microsoft.com/en-us/windows/apps/design/app-settings/guidelines-for-app-settings
- [MS-TOOLTIP] Microsoft Learn, Tooltips: https://learn.microsoft.com/en-us/windows/apps/design/controls/tooltips
- [MS-WRITING] Microsoft Learn, Writing style: https://learn.microsoft.com/en-us/windows/apps/design/style/writing-style
- [MS-TRACKMOUSE] Microsoft Learn, TrackMouseEvent / TRACKMOUSEEVENT (HOVER_DEFAULT; 400 ms default per secondary references): https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-trackmouseevent
