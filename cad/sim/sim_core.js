// Bead filtration physics: spheres vs. the STL triangle mesh, position-based
// dynamics with small substeps. Units: mm, seconds. World Z is up.
(function (root) {
  "use strict";

  // Device geometry (mirrors the Onshape variables) used for chamber bookkeeping.
  const DEV = {
    cavity: { x: 25, yFront: -13, yBack: -3 },
    fineShelf: [26, 29],    // #wall + #hBot .. + #gridT
    coarseShelf: [54, 57],  // + #hMid .. + #gridT
    top: 93,
    inlet: { x: 0, y: -8 },
  };

  const G_EFF = 9810 * (1 - 1.0 / 2.5); // glass beads in water (buoyancy-reduced)
  const CELL = 4;

  function parseSTL(buf) {
    const dv = new DataView(buf);
    const n = dv.getUint32(80, true);
    const tri = new Float32Array(n * 9);
    for (let i = 0; i < n; i++) {
      const o = 84 + i * 50 + 12;
      for (let k = 0; k < 9; k++) tri[i * 9 + k] = dv.getFloat32(o + k * 4, true);
    }
    return tri;
  }

  // Closest point on triangle abc to p (Ericson, Real-Time Collision Detection 5.1.5)
  function closestOnTri(px, py, pz, t, i, out) {
    const ax = t[i], ay = t[i + 1], az = t[i + 2];
    const bx = t[i + 3], by = t[i + 4], bz = t[i + 5];
    const cx = t[i + 6], cy = t[i + 7], cz = t[i + 8];
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
    if (d1 <= 0 && d2 <= 0) { out[0] = ax; out[1] = ay; out[2] = az; return; }
    const bpx = px - bx, bpy = py - by, bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { out[0] = bx; out[1] = by; out[2] = bz; return; }
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      const v = d1 / (d1 - d3);
      out[0] = ax + v * abx; out[1] = ay + v * aby; out[2] = az + v * abz; return;
    }
    const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
    const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
    if (d6 >= 0 && d5 <= d6) { out[0] = cx; out[1] = cy; out[2] = cz; return; }
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      const w = d2 / (d2 - d6);
      out[0] = ax + w * acx; out[1] = ay + w * acy; out[2] = az + w * acz; return;
    }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
      out[0] = bx + w * (cx - bx); out[1] = by + w * (cy - by); out[2] = bz + w * (cz - bz); return;
    }
    const denom = 1 / (va + vb + vc);
    const v = vb * denom, w = vc * denom;
    out[0] = ax + abx * v + acx * w; out[1] = ay + aby * v + acy * w; out[2] = az + abz * v + acz * w;
  }

  function buildGrid(tri, pad) {
    let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (let i = 0; i < tri.length; i += 3) for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], tri[i + k]); hi[k] = Math.max(hi[k], tri[i + k]);
    }
    lo = lo.map((v) => v - pad - CELL); hi = hi.map((v) => v + pad + CELL);
    const dims = [0, 1, 2].map((k) => Math.ceil((hi[k] - lo[k]) / CELL));
    const cells = new Map();
    const nTri = tri.length / 9;
    for (let t = 0; t < nTri; t++) {
      const b = t * 9;
      const mn = [0, 1, 2].map((k) => Math.min(tri[b + k], tri[b + 3 + k], tri[b + 6 + k]) - pad);
      const mx = [0, 1, 2].map((k) => Math.max(tri[b + k], tri[b + 3 + k], tri[b + 6 + k]) + pad);
      const c0 = mn.map((v, k) => Math.floor((v - lo[k]) / CELL));
      const c1 = mx.map((v, k) => Math.floor((v - lo[k]) / CELL));
      for (let x = c0[0]; x <= c1[0]; x++)
        for (let y = c0[1]; y <= c1[1]; y++)
          for (let z = c0[2]; z <= c1[2]; z++) {
            const key = (x * dims[1] + y) * dims[2] + z;
            let arr = cells.get(key);
            if (!arr) cells.set(key, (arr = []));
            arr.push(b);
          }
    }
    return { lo, dims, cells };
  }

  function cellTris(grid, x, y, z) {
    const cx = Math.floor((x - grid.lo[0]) / CELL), cy = Math.floor((y - grid.lo[1]) / CELL),
      cz = Math.floor((z - grid.lo[2]) / CELL);
    if (cx < 0 || cy < 0 || cz < 0 || cx >= grid.dims[0] || cy >= grid.dims[1] || cz >= grid.dims[2]) return null;
    return grid.cells.get((cx * grid.dims[1] + cy) * grid.dims[2] + cz) || null;
  }

  class Sim {
    constructor(stlBuffer, opts = {}) {
      this.tri = parseSTL(stlBuffer);
      this.grid = buildGrid(this.tri, 3.2);
      this.substeps = opts.substeps || 20;
      this.beads = [];
      this.queue = [];
      this.t = 0;
      this.shakeUntil = -1;
      this.offset = [0, 0, 0];
      this.spawnGap = 0;
      this._cp = new Float64Array(3);
      this.rinsing = false;
      this.flow = 60;
    }

    // Interleave large and small beads in a random order and feed them through the inlet.
    pour(nLarge, nSmall, seed = 7) {
      let s = seed;
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      const list = [];
      for (let i = 0; i < nLarge; i++) list.push(3);
      for (let i = 0; i < nSmall; i++) list.push(1.5);
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      this.queue.push(...list);
      this._rnd = rnd;
    }

    shake(seconds = 2.5) { this.shakeUntil = this.t + seconds; }

    rinse(on) { this.rinsing = on; }

    reset() { this.beads = []; this.queue = []; this.shakeUntil = -1; this.offset = [0, 0, 0]; }

    get shaking() { return this.t < this.shakeUntil; }

    _deviceOffset(t) {
      if (t >= this.shakeUntil) return [0, 0, 0];
      const w = 2 * Math.PI * 9;
      // Hand-shake: side-to-side, front-to-back and vertical taps at offset rates.
      return [1.6 * Math.sin(w * t), 0.9 * Math.sin(0.73 * w * t + 1.1), 1.2 * Math.sin(1.37 * w * t + 0.6)];
    }

    _trySpawn() {
      if (!this.queue.length) return;
      const r = this.queue[0];
      const sx = DEV.inlet.x, sy = DEV.inlet.y, sz = DEV.top + 18;
      for (const b of this.beads) {
        const dx = b.x - sx, dy = b.y - sy, dz = b.z - sz;
        if (dx * dx + dy * dy + dz * dz < (b.r + r + 0.5) ** 2) return;
      }
      this.queue.shift();
      const j = this._rnd ? (this._rnd() - 0.5) * 0.3 : 0;
      const b = { r, x: sx + j, y: sy, z: sz, vx: 0, vy: 0, vz: -120, px: 0, py: 0, pz: 0 };
      this.beads.push(b);
    }

    step(frameDt = 1 / 60) {
      const n = this.substeps, dt = frameDt / n;
      for (let s = 0; s < n; s++) this._substep(dt);
    }

    _substep(dt) {
      this.t += dt;
      this.spawnGap -= dt;
      if (this.spawnGap <= 0) { this._trySpawn(); this.spawnGap = 0.09; }
      const off = (this.offset = this._deviceOffset(this.t));
      const beads = this.beads;

      // Integrate: gravity + linear drag toward the local liquid velocity.
      // While rinsing, liquid moves down through the cavity at `this.flow` mm/s.
      for (const b of beads) {
        const k = b.r > 2 ? 22 : 34;
        const uz = this.rinsing && b.z - off[2] < DEV.top ? -this.flow : 0;
        b.vz -= G_EFF * dt;
        const damp = 1 / (1 + k * dt);
        b.vx *= damp; b.vy *= damp;
        b.vz = (b.vz + k * dt * uz) * damp;
        b.px = b.x; b.py = b.y; b.pz = b.z;
        b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      }

      // Resolve bead-bead and bead-wall contacts together, a few passes, so a
      // heavy pile can't shove a bead through a slot narrower than itself.
      for (let pass = 0; pass < 4; pass++) {
        this._pairs();
        for (const b of beads) this._walls(b, off, pass === 0);
      }
      this._finish(dt);
    }

    _pairs() {
      const beads = this.beads;
      for (let i = 0; i < beads.length; i++) {
        const a = beads[i];
        for (let j = i + 1; j < beads.length; j++) {
          const b = beads[j];
          const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
          const rr = a.r + b.r;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= rr * rr || d2 < 1e-12) continue;
          const d = Math.sqrt(d2), pen = rr - d;
          const ma = a.r ** 3, mb = b.r ** 3, wa = mb / (ma + mb), wb = ma / (ma + mb);
          const nx = dx / d, ny = dy / d, nz = dz / d;
          a.x -= nx * pen * wa; a.y -= ny * pen * wa; a.z -= nz * pen * wa;
          b.x += nx * pen * wb; b.y += ny * pen * wb; b.z += nz * pen * wb;
        }
      }
    }

    // Bead-wall contacts in the device's (possibly shaking) frame.
    _walls(b, off, friction) {
      const cp = this._cp, tri = this.tri;
      const list = cellTris(this.grid, b.x - off[0], b.y - off[1], b.z - off[2]);
      if (list) {
        for (const ti of list) {
          const qx = b.x - off[0], qy = b.y - off[1], qz = b.z - off[2];
          closestOnTri(qx, qy, qz, tri, ti, cp);
          const dx = qx - cp[0], dy = qy - cp[1], dz = qz - cp[2];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= b.r * b.r || d2 < 1e-12) continue;
          const d = Math.sqrt(d2), pen = b.r - d, nx = dx / d, ny = dy / d, nz = dz / d;
          b.x += nx * pen; b.y += ny * pen; b.z += nz * pen;
          if (friction) {
            // Trim tangential slip against the wall.
            const mx = b.x - b.px, my = b.y - b.py, mz = b.z - b.pz;
            const mn = mx * nx + my * ny + mz * nz;
            b.x -= 0.15 * (mx - mn * nx); b.y -= 0.15 * (my - mn * ny); b.z -= 0.15 * (mz - mn * nz);
          }
        }
      }
      // Feed tube above the inlet (the suppressed nipple), bore radius 3.5 mm.
      if (b.z - off[2] > DEV.top) {
        const rx = b.x - off[0] - DEV.inlet.x, ry = b.y - off[1] - DEV.inlet.y;
        const rad = Math.hypot(rx, ry), lim = 3.5 - b.r;
        if (rad > lim && rad > 1e-9) {
          b.x = off[0] + DEV.inlet.x + (rx * lim) / rad;
          b.y = off[1] + DEV.inlet.y + (ry * lim) / rad;
        }
      }
      // Clear front panel (suppressed in CAD, modelled here as the y = -13 plane).
      const panel = DEV.cavity.yFront + off[1];
      if (b.z - off[2] < DEV.top && b.y - b.r < panel) b.y = panel + b.r;
    }

    _finish(dt) {
      // Derive velocities, cap runaway speeds.
      for (const b of this.beads) {
        b.vx = (b.x - b.px) / dt; b.vy = (b.y - b.py) / dt; b.vz = (b.z - b.pz) / dt;
        const v2 = b.vx * b.vx + b.vy * b.vy + b.vz * b.vz;
        if (v2 > 1500 * 1500) { const k = 1500 / Math.sqrt(v2); b.vx *= k; b.vy *= k; b.vz *= k; }
      }
    }

    // Where each bead ended up, in device coordinates.
    census() {
      const c = { top: [0, 0], mid: [0, 0], res: [0, 0], feed: [0, 0], lost: [0, 0] };
      for (const b of this.beads) {
        const k = b.r > 2 ? 0 : 1;
        const z = b.z - this.offset[2], x = b.x - this.offset[0], y = b.y - this.offset[1];
        const inside = Math.abs(x) < 31 && y > -13.5 && y < 0.5;
        if (z < 0 || !inside) c.lost[k]++;
        else if (z > DEV.top) c.feed[k]++;
        else if (z > DEV.coarseShelf[1]) c.top[k]++;
        else if (z > DEV.fineShelf[1]) c.mid[k]++;
        else c.res[k]++;
      }
      return c;
    }

    get pending() { return this.queue.length; }

    get maxSpeed() {
      let m = 0;
      for (const b of this.beads) m = Math.max(m, Math.hypot(b.vx, b.vy, b.vz));
      return m;
    }
  }

  const api = { Sim, DEV, parseSTL };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BeadSim = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
