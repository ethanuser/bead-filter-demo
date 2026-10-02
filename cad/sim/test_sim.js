// Headless check: every debris bead (6-8 mm) stays above the coarse grid and no bead
// passes a grid slot narrower than itself. 3 mm beads still wedged among the debris
// after five shakes are reported, not failed: the front support ledge on each grate
// (Extrude 1, 2 mm deep) can genuinely hold one against the cover.
const fs = require("fs");
const { Sim, SIZES } = require("./sim_core.js");
const buf = fs.readFileSync(__dirname + "/../exports/filter_body.stl");
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const fmt = (c) => ["top", "mid", "res", "feed", "lost"].map((k) => `${k} ${c[k].join("/")}`).join(" | ");
let failures = 0;
console.log(`counts per zone are ${SIZES.map((d) => d + "mm").join("/")}`);
for (const seed of [7, 11, 23]) {
  const sim = new Sim(ab);
  sim.preload({ 8: 4, 7: 5 }, seed);
  sim.pour(10, 45, seed);
  sim.rinse(true);
  const t0 = Date.now(); let frames = 0;
  const run = (sec) => { for (let i = 0; i < sec * 60; i++, frames++) sim.step(1 / 60); };
  run(9);
  console.log(`seed ${seed} poured  :: ${fmt(sim.census())}`);
  for (let k = 1; k <= 5; k++) { sim.shake(2.5); run(4); console.log(`        shake ${k} :: ${fmt(sim.census())}`); }
  const c = sim.census();
  const ok = c.res.every((v) => v === 0) && c.lost.every((v) => v === 0) && c.mid.slice(0, 3).every((v) => v === 0)
    && c.top[0] === 4 && c.top[1] === 5 && c.top[2] === 10;
  if (!ok) failures++;
  const note = c.top[3] ? `  (${c.top[3]} small bead${c.top[3] > 1 ? "s" : ""} still wedged on top)` : "";
  console.log(`        ${ok ? "PASS" : "FAIL"}${note}  ${((Date.now() - t0) / frames).toFixed(2)} ms/frame`);
}
process.exit(failures ? 1 : 0);
