# Bead filter demo

A 3D-printable, scaled-up demo of the AxisMED membrane-based bacteria capture device. Two printed slot grids stand in for the device's filter layers, and glass beads stand in for what they catch:

| Demo | AxisMED device |
|---|---|
| Coarse grid, 4.5 mm slots | Layer 1 coarse debris filter, ~2–5 µm |
| Fine grid, 2 mm slots | Layer 2 bacterial capture membrane, 0.22–0.4 µm |
| 6, 7 and 8 mm beads | Lysed cell debris and aggregates of different sizes |
| 3 mm beads | Bacteria |

7 and 8 mm beads are too big for the 7 mm inlet, so they go into the top chamber before the clear panel slides in. 6 mm and 3 mm beads are loaded through the inlet. To empty it between demos, pull the panel up by its tab.

**Live simulation:** https://ethanuser.github.io/bead-filter-demo/ (drag to tilt and shake the device; it runs the same physics as the tests).

## Contents

- `cad/build_filter_demo.py`: builds the original model in Onshape as editable features (sketches, extrudes, patterns) driven by named variables such as `#coarseGap` and `#fineGap`. Kept as a record of the first build; the Onshape document is now the source of truth.
- `cad/onshape_client.py`: minimal Onshape REST client. It reads API keys from `~/.onshape_keys`; keys are never stored in this repo.
- `cad/add_slide_panel.py`: adds the front groove, lip and slide-in clear panel (with finger tab) to the Onshape model.
- `cad/side_detents.py`: adds the two snap bumps on the hidden panel margins, the slits that let the lip flex over them, and the matching notches in the panel.
- `cad/fs_status.py`: prints Onshape's error code for a failing feature.
- `cad/exports/filter_body.stl`, `cad/exports/clear_panel.stl`: current body and panel exported from Onshape (mm).
- `cad/sim/`: the bead simulation.
  - `sim_core.js`: physics with no dependencies. Spheres collide with every triangle of the body STL, with buoyancy-reduced gravity, liquid drag, any device orientation and the forces of turning it by hand. Beads that stop moving sleep so they don't jitter at rest.
  - `page.src.html`: page template (Three.js rendering, controls, read-out).
  - `test_sim.js`: headless check that every bead ends up in the right chamber (`node cad/sim/test_sim.js`).
  - `build_page.py`: inlines the physics and both STLs into `docs/index.html` (GitHub Pages) and `cad/sim/bead_filter_bench.html`.
- `docs/`: the published GitHub Pages site (generated; don't edit by hand).

## Updating the demo after a CAD change

1. Export the filter body and clear panel from Onshape as binary STLs in millimetres to `cad/exports/filter_body.stl` and `cad/exports/clear_panel.stl`.
2. Run `node cad/sim/test_sim.js` and check the reservoir counts stay at 0.
3. Run `python3 cad/sim/build_page.py`, then commit and push. Pages redeploys from `main:/docs`.

## Printing

Print `filter_body.stl` standing upright, exactly as it imports, so the panel groove, snap bumps and slits form as vertical walls. Suggested Bambu Studio settings: 0.16 mm layers, 3 wall loops, 15% gyroid infill, supports off (support inside the groove could never be removed), seam at the back.

The panel is laser cut from 1/8 in (3 mm) clear acrylic: 56.2 × 98.5 mm, with a 2.4 mm wide U-notch in each side edge centred 57.5 mm up from the bottom edge, 2.75 mm deep. Measure the sheet and set `#panelT` in Onshape to its real thickness before printing; the groove and snap bumps follow it.
