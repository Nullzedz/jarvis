# Builds design-board.html: every agreed JARVIS design, shown by the live prototypes
# themselves (jarvis-home.html, jarvis-notch.html, jarvis-character.html), each opened
# at the right view and scaled from the app's real 1100 x 720 window. Because the
# frames are the prototypes, the board can't fall behind them. Run again after a change:
#   python build-board.py
import html
from pathlib import Path

here = Path(__file__).parent


def frame(src, w=1100, h=720, title="JARVIS"):
    """One window: a prototype file opened at a view by its address."""
    tb = f'<div class="tb"><span>{html.escape(title)}</span><i>─</i><i>▢</i><i>✕</i></div>' if title else ""
    th = 32 if title else 0
    return (f'<div class="fit" data-w="{w}" data-h="{h + th}"><div class="win" style="width:{w}px;height:{h + th}px">{tb}'
            f'<iframe loading="lazy" scrolling="no" title="{html.escape(title or "JARVIS")}" style="width:{w}px;height:{h}px" src="{html.escape(src)}"></iframe></div></div>')


def app(view, title="JARVIS", light=False, **more):
    q = f"theme={'light' if light else 'dark'}&view={view}" + "".join(f"&{k}={v}" for k, v in more.items())
    return frame(f"jarvis-home.html#{q}", title=title)


def notch(q, h=420):
    return frame(f"jarvis-notch.html#nohint=1&{q}", h=h, title="")


S = []  # (id, heading, why, [ (label, frame) ], columns)
S.append(("home", "Front page", "The greeting, the ask bar and the dock (seven squares, Connections included). Scroll and the squares glide into the pinned bar; below, At a glance: one widget per section, press one to open it.", [
    ("First screen", app('home')),
    ("Scrolled · At a glance", app('home', scroll=700)),
    ("Further · Mail, Dictation, Windows, Connections", app('home', scroll=1150)),
], 1))
S.append(("nav", "Sidebar", "On every screen except the front page. Grey line icons at rest; on hover it widens over the page with coloured squares and names.", [
    ("At rest", app('agents', title="JARVIS · Agents")),
    ("On hover", app('agents', title="JARVIS · Agents", wide=1)),
], 2))
S.append(("agents", "Agents", "The orbit around his visor: three rings (Watch closely, Normal, Quiet), drag a planet between them to change how closely he watches it; the approval bar; scroll for the card stack, each card's eye in its session's colour.", [
    ("First screen · the orbit", app('agents', title="JARVIS · Agents")),
    ("Scrolled · the card stack", app('agents', title="JARVIS · Agents", scroll='stack')),
], 2))
S.append(("jarvis", "JARVIS · voice and vision", "The glowing listening panel beside the conversation as message bubbles.", [
    ("", app('jarvis')),
], 1))
S.append(("dictation", "Notes · Dictation", "Screen Time chart and where you dictate; scroll for the widgets and word cloud, then Dictionary, Snippets and Styles, each opening its own word wall.", [
    ("First screen", app('notes', title="JARVIS · Notes", ntab='dictation')),
    ("Dictionary · word wall", app('notes', title="JARVIS · Notes", ntab='dictation', wall='dictionary')),
    ("Styles · word wall", app('notes', title="JARVIS · Notes", ntab='dictation', wall='styles')),
    ("Scrolled", app('notes', title="JARVIS · Notes", ntab='dictation', scroll=560)),
], 2))
S.append(("notetaker", "Notes · Notetaker", "The blank page waits for your next call; Record opens its own page; a call's note leads with the summary; Show transcript plays the call back like lyrics.", [
    ("The blank page", app('notes', title="JARVIS · Notes", ntab='notetaker')),
    ("Recording", app('notes', title="JARVIS · Notes", ntab='notetaker', rec=1)),
    ("A call's note", app('notes', title="JARVIS · Notes", ntab='notetaker', note=1)),
    ("The transcript · lyrics", app('notes', title="JARVIS · Notes", ntab='notetaker', note=1, tx=3)),
], 3))
S.append(("connections", "Connections", "Apple Home style: rooms with headings, bright tiles when live, dark when off or needing you; GitHub lists its pull requests.", [
    ("", app('connections', title="JARVIS · Connections")),
], 1))
S.append(("mail", "Mail", "The month on the left (dots and a volume bar per day); the day, when mail arrives, waiting on you and files today on the right. Each widget opens its full view.", [
    ("Main view", app('mail', title="JARVIS · Mail")),
    ("When mail arrives · full view", app('mail', title="JARVIS · Mail", full='arrivals')),
    ("Waiting on you · full view", app('mail', title="JARVIS · Mail", full='waiting')),
    ("Files today · full view", app('mail', title="JARVIS · Mail", full='files')),
], 2))
S.append(("settings", "Settings", "Reference 12: groups on the left; each setting a row with its name and description, the control on the right.", [
    ("General and Appearance", app('settings', title="JARVIS · Settings")),
    ("Accounts and keys", app('settings', title="JARVIS · Settings", scroll='accounts')),
], 2))
S.append(("light", "Light mode", "Apple grouped: a light grey page, white cards, Apple's light-mode colours. Switched from Settings → Appearance → Theme. The notch stays black.", [
    ("Front page", app('home', light=True)),
    ("Mail", app('mail', title="JARVIS · Mail", light=True)),
    ("Agents", app('agents', title="JARVIS · Agents", light=True)),
    ("Settings", app('settings', title="JARVIS · Settings", light=True)),
], 2))
S.append(("notch", "The notch", "Hangs from the top of the screen. Your island's tabs first, then Cupola's, then Agents; Focus mode; idle for 3 s it folds back to his visor (he dances there while music plays).", [
    ("Open · Home", notch('open=1&tab=home')),
    ("Today", notch('open=1&tab=today')),
    ("Focus mode", notch('open=1&focus=1')),
    ("Folded", notch('', h=200)),
], 2))
S.append(("character", "JARVIS himself", "Design A, the object: matte white, a real eye slot, life from behaviour. The full character sheet, live: states, reactions and signature animations.", [
    ("Character sheet", frame('jarvis-character.html', title="Character sheet")),
    ("Signature animations", frame('jarvis-character.html#signature', title="Character sheet")),
], 2))

body = []
for sid, head, why, frames, cols in S:
    items = "".join(f'<div>{f"<p class=lab><b>{html.escape(l)}</b></p>" if l else ""}{f}</div>' for l, f in frames)
    body.append(f'<section id="{sid}"><h2>{html.escape(head)}</h2><p class="why">{html.escape(why)}</p><div class="cols c{cols}">{items}</div></section>')
toc = "".join(f'<a href="#{sid}">{html.escape(head)}</a>' for sid, head, *_ in S)

PAGE = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>JARVIS design board</title>
<style>
  :root {{ --s1:#1c1c1e; --t2:#8e8e93; --t3:#636366; --blue:#0a84ff; --font:"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif; }}
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; background: #0b0b0d; color: #f5f5f7; font: 14px/1.5 var(--font); -webkit-font-smoothing: antialiased; }}
  p {{ margin: 0; }}
  header, section, nav.toc, footer {{ max-width: 1240px; margin: 0 auto; padding-left: 32px; padding-right: 32px; }}
  header {{ padding-top: 48px; }}
  header h1 {{ font-size: 40px; font-weight: 600; margin: 0; letter-spacing: -.015em; }} header h1 span {{ color: var(--t3); }}
  header p {{ color: var(--t2); font-size: 15px; margin-top: 10px; max-width: 900px; }} header a {{ color: var(--blue); text-decoration: none; }}
  nav.toc {{ margin-top: 18px; display: flex; flex-wrap: wrap; gap: 8px; position: sticky; top: 0; z-index: 5; padding-top: 10px; padding-bottom: 10px; background: rgba(11,11,13,.92); }}
  nav.toc a {{ color: #aeaeb2; background: var(--s1); border-radius: 999px; padding: 6px 14px; text-decoration: none; font-size: 13px; }}
  nav.toc a:hover {{ color: #fff; background: #2c2c2e; }}
  section {{ padding-top: 50px; scroll-margin-top: 60px; }}
  h2 {{ font-size: 26px; font-weight: 600; margin: 0 0 4px; }}
  .why {{ color: var(--t2); margin: 0 0 16px; max-width: 880px; }}
  .lab {{ font-size: 12.5px; color: var(--t2); margin: 0 0 8px; }} .lab b {{ color: #f5f5f7; font-weight: 500; }}
  .cols {{ display: grid; gap: 22px 18px; }} .c1 {{ grid-template-columns: 1fr; }} .c2 {{ grid-template-columns: 1fr 1fr; }} .c3 {{ grid-template-columns: 1fr 1fr 1fr; }}
  .fit {{ position: relative; width: 100%; border-radius: 10px; overflow: hidden; box-shadow: 0 0 0 1px #2a2a2e, 0 24px 60px rgba(0,0,0,.55); background: #000; }}
  .win {{ position: absolute; left: 0; top: 0; transform-origin: 0 0; }}
  .tb {{ height: 32px; background: #1f1f1f; display: flex; align-items: center; font-size: 12px; color: #c8c8c8; padding-left: 12px; }}
  .tb span {{ flex: 1; }} .tb i {{ width: 46px; text-align: center; font-style: normal; }}
  iframe {{ display: block; border: 0; background: #000; pointer-events: none; }}
  footer {{ padding-top: 50px; padding-bottom: 70px; color: var(--t3); font-size: 12.5px; }}
</style></head><body>
<header><h1>JARVIS design board <span>· every agreed design</span></h1>
<p>Each frame is the live prototype itself, opened at that view and scaled from the app's real 1100 × 720 window, so this board always matches them. Click through everything in the <a href="jarvis-live.html">live demo</a> · <a href="jarvis-character.html">character sheet</a>.</p></header>
<nav class="toc">{toc}</nav>
{''.join(body)}
<footer>Built by build-board.py from jarvis-home.html, jarvis-notch.html and jarvis-character.html. Sample data throughout. Still to decide: Mochi.</footer>
<script>
function fit() {{
  document.querySelectorAll(".fit").forEach((f) => {{
    const w = +f.dataset.w, h = +f.dataset.h, k = f.clientWidth / w;
    f.querySelector(".win").style.transform = `scale(${{k}})`;
    f.style.height = `${{h * k}}px`;
  }});
}}
addEventListener("resize", fit); fit();
</script>
</body></html>"""
(here / "design-board.html").write_text(PAGE, encoding="utf-8")
print("wrote design-board.html", round(len(PAGE) / 1e6, 1), "MB,", sum(len(s[3]) for s in S), "frames")
