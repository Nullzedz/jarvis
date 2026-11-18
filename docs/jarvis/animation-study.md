# Animation study: what makes coucou feel good

Notes for the JARVIS UI redesign ([issue #1](https://github.com/Nullzedz/jarvis/issues/1)).
We change the **look**; we keep the **motion**. Everything below is in `windows/src/`.

## The short version

Coucou's motion feels "proper" because of five habits:

1. **Fast in, soft out.** Most moves are a quick 50–150 ms push with `Ease.out`, then a slower 200–400 ms settle with `Ease.back` (a small overshoot). Nothing moves linearly except holds.
2. **Squash and stretch, always paired.** When height shrinks, width grows (`sy` 0.78 ↔ `sx` 1.16), so the volume looks constant. Every click, landing and greeting uses it.
3. **Springs for size, curves for leaving.** The island grows with a spring (response 0.5 s, damping 0.72) and shrinks with a fixed 340 ms ease curve. Opening feels alive and closing feels deliberate.
4. **Everything chases a target smoothly.** Look direction, tilt, scale and colour aren't set; each frame they move a fraction toward the target (`x += (target − x) · (1 − k^dt)`). That's why the character never snaps, even when the mouse jumps.
5. **Small random life.** Blinks every 2.2–5.4 s with a 22 % chance of a double blink, idle wandering for the minis, and gentle breathing while sleeping. It never looks frozen.

## 1. Easing curves (`core/anim.ts`)

| Name | Formula | Used for |
|---|---|---|
| `Ease.out` | cubic out, `1 − (1 − t)³` | the quick first push of almost every move |
| `Ease.inOut` | cubic in-out | middle keyframes, rolls, morphs, fades |
| `Ease.back` | overshoot, c1 = 1.7 | the final settle: the "boing" |
| `Ease.easeIn` | `t³` | leaving / falling (greeting) |
| `closeCurve` | `cubic-bezier(.45, 0, .2, 1)`, 340 ms | island shrinking |
| CSS "spring" | `cubic-bezier(0.3, 1.2, 0.4, 1)`, 0.2–0.3 s | buttons, pills, cards appearing (style.css) |

**Springs** (`Spring`, SwiftUI-style): ω₀ = 2π / response, ζ = damping, sub-stepped at 240 Hz so a dropped frame can't make it wobble.
- Island width/height/corner: response **0.5 s**, damping **0.72**
- Mouth slot: response **0.25 s**, damping **0.6**
- Soft parts (hats, pompoms): stiffness **60**, damping **9**, driven by head turns and hops

## 2. The tween engine (`mochi/engine.ts`)

`anim(prop, [[target, ms, ease], …])` plays keyframes in sequence on one property and **locks** it, so the chase-the-target smoothing leaves it alone until the tween ends. One tween per property; a new one replaces the old.

Animated properties: `yaw`/`pitch` (look direction), `roll`, `tilt`, `sx`/`sy` (squash), `ox`/`oy` (offset), `open` (eyelid), `es` (eye scale), `tint` (state colour strength), `morph` (body → box for file drops), `hands`, `badgeS`, `blush`.

Per-frame smoothing constants (fraction kept per second; smaller is faster):
- Look (`yaw`, `pitch`): `0.0025`, quick and responsive
- Tilt, scale, offset: `0.0008`, quicker still
- Colour: `0.002`, a soft cross-fade between states

Look range: yaw = mouse × 0.62, pitch = mouse × 0.5.

## 3. Signature moves (keyframes worth copying exactly)

| Move | Keyframes | Feel |
|---|---|---|
| **Blink** | open → 0.06 in 70 ms (inOut) → 1 in 130 ms (out) | crisp, never sleepy |
| **Squash (poke)** | sy 0.78/70 ms → 1.10/130 → 1/170; sx 1.16 → 0.95 → 1 | rubbery |
| **Approval hop** | oy −0.2 in 150 ms (out) → 0 in 300 ms (back) | "look at me" |
| **Error shake** | ox +0.08/50 → −0.08/70 → +0.05/70 → 0/90 | short, sharp "no" |
| **Finished** | full roll in 950 ms (inOut) + 5 sparks at 500 ms | celebratory |
| **Surprised** | oy −0.3/140 → 0/380 (back); eyes 1.25× then back over 500 ms | a jump |
| **Happy hop (minis)** | oy −0.3/120 → +0.03/200 → 0/160 (back), with a 4-step squash | bouncy |
| **Annoyed head shake** | yaw −0.65, +0.65, −0.5, +0.4, −0.2, 0 (50–140 ms each) | a decaying "no-no-no" |
| **Badge swap** | old badge scales to 0 in 90 ms, new one pops to 1 in 280 ms (back) | never a hard cut |
| **Dizzy** | 3 pokes within 1.7 s → 2 rolls in 1.3 s, spiral eyes | an easter egg |

State loops: **approval** bounces with `|sin(5.2t)|·0.07`; **searching** scans left and right with `sin(2.6t)·0.6`; **sleeping** breathes with `sin(1.8t)·0.035`.

**Dance** (music playing): 112 BPM, hop `|sin(π·beat)|·0.2R`, sway ±0.08R, tilt ±0.1 rad, landing squash `(1 − hop)⁶`. It fades in over 0.3 s and out over 0.5 s.

## 4. The greeting (`mochi/greeting.ts`)

A 4.6 s scripted timeline (seconds): drop and pop in at 1.3–1.45 → content at 2.4 → tuck in at 2.45–2.7 → badge at 2.72 → move down at 2.85–3.45 → second blink at 3.7 → tint in at 3.85–4.15 → end at 4.6 → auto-leave at 4.9. Each phase uses `seg(t, a, b)` (0→1 within its window) with an ease on top, so phases overlap slightly and never feel step-by-step.

The wave inside it (`engine.greet()`): starts 0.45 s in, hands rise over 280 ms, wave at 1.2 Hz on tilt, blinks at 550 ms and 1500 ms, hands drop over 200 ms at 1.55 s.

## 5. The island (`island/fsm.ts`, `island/island.ts`)

States: **hidden** (closed bar) → **petit** (compact peek on hover) → **home** (fully open on click), plus **coucou** (the launch greeting).

Timings:
- Folds back 15 s after the pointer leaves (setting); a countdown bar shows it
- Compact peek hides after 60 s
- Open on hover: 0.5 s rest to open, 0.6 s grace on leave
- Greeting collapses 0.6 s after it ends, or 10 s if hovered

Size changes: grow = spring (0.5 / 0.72); shrink = `closeCurve` 340 ms. Views cross-fade with opacity 0.16–0.3 s, with a 0.12–0.16 s delay on the incoming view so the old one leaves first.

## 6. Performance rules to keep

- The render loop stops when nothing moves (`busy` getter): 0 % CPU when idle.
- The audio context suspends 1.5 s after the last sound.
- Hidden views pause their infinite CSS animations.

## What this means for JARVIS

- **Keep:** the curves, springs, keyframe timings, chase-the-target smoothing, idle life and performance rules. They're why it feels premium.
- **Re-express for the Visor:** squash and stretch on a hard visor should be subtler (about half the amplitude), and the light bar can carry the emotion instead (width, brightness, colour).
- **Retire or rethink:** blush, hearts, wardrobe/outfits and hands are Mochi's personality, not JARVIS's. Candidates: light pulses, scan lines, and a short boot-up sweep of the light bar for the greeting.
