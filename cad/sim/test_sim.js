const fs = require("fs");
const { Sim } = require("./sim_core.js");
const buf = fs.readFileSync(__dirname + "/../exports/filter_body.stl");
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const fmt = (c) => Object.entries(c).map(([k, v]) => `${k} ${v[0]}L/${v[1]}S`).join(" | ");
for (const seed of [7, 11, 23]) {
  const sim = new Sim(ab);
  sim.pour(14, 45, seed);
  sim.rinse(true);
  const t0 = Date.now(); let frames = 0;
  const run = (sec) => { for (let i = 0; i < sec * 60; i++, frames++) sim.step(1 / 60); };
  run(9);
  const lines = [`seed ${seed} poured      :: ${fmt(sim.census())}`];
  for (let k = 1; k <= 4; k++) { sim.shake(2.5); run(4); lines.push(`        shake ${k}     :: ${fmt(sim.census())}`); }
  sim.rinse(false); run(2);
  lines.push(`        final       :: ${fmt(sim.census())}  vmax=${sim.maxSpeed.toFixed(0)}  ${((Date.now() - t0) / frames).toFixed(2)} ms/frame`);
  console.log(lines.join("\n"));
}
