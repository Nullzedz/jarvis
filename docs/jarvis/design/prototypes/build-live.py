# Builds jarvis-live.html: the notch page (jarvis-notch.html) with the live JARVIS
# app window (jarvis-home.html) under the notch, at the app's real 1100 x 720,
# scaled to fit. The app is embedded whole (srcdoc) so the page works on its own,
# opened from disk or in a preview. Run again after changing either prototype:
#   python build-live.py
import html
from pathlib import Path

here = Path(__file__).parent
notch = (here / "jarvis-notch.html").read_text(encoding="utf-8")
app = (here / "jarvis-home.html").read_text(encoding="utf-8")

FRAME_CSS = """
  /* The live JARVIS window under the notch: 1100 x 720 under a title bar, scaled to fit. */
  #appFrame { position: fixed; left: 50%; top: 64px; width: 1100px; height: 752px; transform-origin: top center; border-radius: 10px; overflow: hidden;
    box-shadow: 0 0 0 1px rgba(255,255,255,.08), 0 30px 80px rgba(0,0,0,.6); background: #000; z-index: 1; }
  #appFrame .tb { height: 32px; background: #1f1f1f; display: flex; align-items: center; font: 12px "Segoe UI", system-ui, sans-serif; color: #c8c8c8; padding-left: 12px; }
  #appFrame .tb span { flex: 1; } #appFrame .tb i { width: 46px; text-align: center; font-style: normal; }
  #appFrame iframe { display: block; width: 1100px; height: 720px; border: 0; background: #000; }
  #notch { z-index: 5; }
  .hint { display: none; }
</style>"""

FRAME = f"""<div id="appFrame"><div class="tb"><span>JARVIS</span><i>─</i><i>▢</i><i>✕</i></div><iframe title="JARVIS app" srcdoc="{html.escape(app, quote=True)}"></iframe></div>
<script>
function fitApp() {{
  const k = Math.min((innerWidth - 60) / 1100, (innerHeight - 84) / 752, 1);
  document.getElementById("appFrame").style.transform = `translateX(-50%) scale(${{k}})`;
}}
addEventListener("resize", fitApp); fitApp();
</script>
</body>"""

out = notch.replace("</style>", FRAME_CSS, 1).replace("<title>JARVIS notch prototype</title>", "<title>JARVIS live demo</title>", 1)
out = out[: out.rindex("</body>")] + FRAME + out[out.rindex("</body>") + len("</body>"):]
(here / "jarvis-live.html").write_text(out, encoding="utf-8")
print("wrote jarvis-live.html", len(out), "bytes")
