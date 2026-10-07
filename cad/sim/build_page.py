"""Inline the physics core and the exported STL into one self-contained page.

Writes two copies:
  cad/sim/bead_filter_bench.html  - body-only page for the Claude artifact
  docs/index.html                 - full HTML document served by GitHub Pages
"""
import base64
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
src = (HERE / "page.src.html").read_text()
core = (HERE / "sim_core.js").read_text()
exports = HERE.parent / "exports"
stl = base64.b64encode((exports / "filter_body.stl").read_bytes()).decode()
panel = base64.b64encode((exports / "clear_panel.stl").read_bytes()).decode()

out = src.replace("/*SIM_CORE*/", core).replace("__STL_B64__", stl).replace("__PANEL_B64__", panel)
(HERE / "bead_filter_bench.html").write_text(out)

# GitHub Pages needs a complete document: head tags before the first <div>, the rest in <body>.
split = out.index('<div class="wrap">')
page = (
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
    '<meta name="description" content="Live physics simulation of 6-8 mm debris beads and 3 mm '
    'bacteria beads separating through the coarse and fine grates of the AxisMED bead filter demo.">\n'
    "<style>body{margin:0}[hidden]{display:none!important}img{max-width:100%}</style>\n"
    + out[:split]
    + "</head>\n<body>\n"
    + out[split:]
    + "\n</body>\n</html>\n"
)
docs = ROOT / "docs"
docs.mkdir(exist_ok=True)
(docs / "index.html").write_text(page)
(docs / ".nojekyll").write_text("")
print(f"wrote bead_filter_bench.html and docs/index.html ({len(page) / 1024:.0f} KB)")
