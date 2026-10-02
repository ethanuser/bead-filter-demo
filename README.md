# Bead filter demo

A 3D-printable, scaled-up demo of the AxisMED membrane-based bacteria capture device. Two printed slot grids stand in for the device's filter layers, and glass beads stand in for what they catch:

| Demo | AxisMED device |
|---|---|
| Coarse grid, 4.5 mm slots | Layer 1 coarse debris filter, ~2–5 µm |
| Fine grid, 2 mm slots | Layer 2 bacterial capture membrane, 0.22–0.4 µm |
| 6 mm beads | Lysed cell debris and aggregates |
| 3 mm beads | Bacteria |

**Live simulation:** https://ethanuser.github.io/bead-filter-demo/

## Contents

- `cad/build_filter_demo.py`: builds the original model in Onshape as editable features (sketches, extrudes, patterns) driven by named variables such as `#coarseGap` and `#fineGap`. Kept as a record of the first build; the Onshape document is now the source of truth.
- `cad/onshape_client.py`: minimal Onshape REST client. It reads API keys from `~/.onshape_keys`; keys are never stored in this repo.
- `cad/fs_status.py`: prints Onshape's error code for a failing feature.
- `cad/exports/filter_body.stl`: current filter body exported from Onshape (mm).
- `cad/sim/`: the bead simulation.
  - `sim_core.js`: physics with no dependencies. Spheres collide with every triangle of the STL, using buoyancy-reduced gravity and liquid drag.
  - `page.src.html`: page template (Three.js rendering, controls, read-out).
  - `test_sim.js`: headless check that every bead ends up in the right chamber (`node cad/sim/test_sim.js`).
  - `build_page.py`: inlines the physics and STL into `docs/index.html` (GitHub Pages) and `cad/sim/bead_filter_bench.html`.
- `docs/`: the published GitHub Pages site (generated; don't edit by hand).

## Updating the demo after a CAD change

1. Export the filter body from Onshape as a binary STL in millimetres to `cad/exports/filter_body.stl`.
2. Run `node cad/sim/test_sim.js` and check the reservoir counts stay at 0.
3. Run `python3 cad/sim/build_page.py`, then commit and push. Pages redeploys from `main:/docs`.

## Printing

Print the body lying on its back, open side up, so the grid bars print as vertical walls with no overhangs. Cover the front with 3 mm clear acrylic (62 × 93 mm) on thin VHB tape along the 6 mm rim.
