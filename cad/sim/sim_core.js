// Bead filtration physics: spheres vs. the STL triangle mesh, position-based
// dynamics with small substeps. Units: mm, seconds. World Z is up.
(function (root) {
  "use strict";

  // Device geometry (mirrors the Onshape variables) used for chamber bookkeeping.
  const DEV = {
    cavity: { x: 25, yFront: -13, yBack: -3, zBottom: 6, zTop: 87 },
    fineShelf: [26, 29],    // #wall + #hBot .. + #gridT
    coarseShelf: [54, 57],  // + #hMid .. + #gridT
    // Slot widths (#fineGap, #coarseGap): a bead wider than a grid's slots can never have
    // its centre inside that grid's band, however hard the pile pushes.
    grids: [{ z: [26, 29], gap: 2 }, { z: [54, 57], gap: 4.5 }],
    top: 93,
    inlet: { x: 0, y: -8 },
  };

  // Bead diameters in mm: three debris sizes and the bacteria analog.
  const SIZES = [8, 7, 6, 3];
  const sizeIndex = (r) => SIZES.indexOf(Math.round(2 * r));

  const SLEEP_R = 0.35;  // mm: a bead that stays this close to one spot...
  const SLEEP_T = 0.4;   // ...for this many seconds goes to sleep (even if wedged and twitching)
  const WAKE_V = 40;     // mm/s: a neighbour moving faster than this wakes a sleeping bead
  const FEED_LEN = 22;   // mm of feed tube above the inlet

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
      // Device orientation, in device coordinates: gravity direction, angular velocity and
      // angular acceleration (rad/s, rad/s^2) about `pivot`. Upright and still by default.
      this.gDir = [0, 0, -1];
      this.omega = [0, 0, 0];
      this.alpha = [0, 0, 0];
      this.pivot = [0, -9.25, 46.5];
      this.agitation = 0;   // 0..1 vibration level, e.g. from rotating the device by hand
      this.lostTally = SIZES.map(() => 0);
    }

    // Orientation update from the viewer: gravity direction plus how fast the device turns.
    setFrame(gDir, omega, alpha) {
      this.gDir = gDir; this.omega = omega; this.alpha = alpha;
      if (Math.hypot(...omega) > 0.05) this.wakeAll();
    }

    agitate(level) {
      this.agitation = Math.max(this.agitation, Math.min(1, level));
      if (this.agitation > 0.02) this.wakeAll();
    }

    wakeAll() { for (const b of this.beads) { b.asleep = false; b.still = 0; b.anchor = null; } }

    _seed(seed) {
      let s = seed;
      this._rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      return this._rnd;
    }

    // Interleave 6 mm and 3 mm beads in a random order and feed them through the inlet.
    pour(nLarge, nSmall, seed = 7) {
      const rnd = this._seed(seed);
      const list = [];
      for (let i = 0; i < nLarge; i++) list.push(3);
      for (let i = 0; i < nSmall; i++) list.push(1.5);
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      this.queue.push(...list);
    }

    // Beads too big for the 7 mm inlet (e.g. {8: 4, 7: 5}) are placed straight into the
    // top chamber, as if dropped in before the cover is taped on.
    preload(counts, seed = 3) {
      const rnd = this._seed(seed);
      const c = DEV.cavity;
      for (const [d, n] of Object.entries(counts)) {
        const r = d / 2;
        for (let i = 0; i < n; i++) {
          for (let tries = 0; tries < 300; tries++) {
            const x = (rnd() * 2 - 1) * (c.x - r);
            const y = c.yFront + r + rnd() * (c.yBack - c.yFront - 2 * r);
            const z = DEV.coarseShelf[1] + r + 1 + rnd() * (DEV.top - 6 - DEV.coarseShelf[1] - 2 * r - 1);
            if (this.beads.every((b) => (b.x - x) ** 2 + (b.y - y) ** 2 + (b.z - z) ** 2 > (b.r + r + 0.2) ** 2)) {
              this.beads.push({ r, x, y, z, vx: 0, vy: 0, vz: 0, px: x, py: y, pz: z });
              break;
            }
          }
        }
      }
    }

    shake(seconds = 2.5) { this.shakeUntil = this.t + seconds; }

    rinse(on) { this.rinsing = on; this.wakeAll(); }

    reset() {
      this.beads = []; this.queue = []; this.shakeUntil = -1; this.offset = [0, 0, 0];
      this.agitation = 0; this.lostTally = SIZES.map(() => 0);
    }

    get shaking() { return this.t < this.shakeUntil; }

    _deviceOffset(t) {
      const level = t < this.shakeUntil ? 1 : this.agitation;
      if (level < 1e-3) return [0, 0, 0];
      const w = 2 * Math.PI * 9;
      // Hand-shake: side-to-side, front-to-back and vertical taps at offset rates.
      return [1.6 * level * Math.sin(w * t), 0.9 * level * Math.sin(0.73 * w * t + 1.1),
        1.2 * level * Math.sin(1.37 * w * t + 0.6)];
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
      this.agitation *= Math.exp(-dt / 0.25);
      const off = (this.offset = this._deviceOffset(this.t));
      const beads = this.beads;
      if (this.shaking || this.agitation > 0.02) this.wakeAll();

      // Integrate awake beads: gravity (in device coordinates), the inertial forces of a
      // turning device, and linear drag toward the local liquid velocity. While rinsing,
      // liquid moves through the cavity toward the outlet at `this.flow` mm/s.
      const [gx, gy, gz] = this.gDir, [wx, wy, wz] = this.omega, [ax, ay, az] = this.alpha;
      const turning = wx || wy || wz || ax || ay || az;
      for (const b of beads) {
        b.px = b.x; b.py = b.y; b.pz = b.z;
        if (b.asleep) continue;
        let fx = gx * G_EFF, fy = gy * G_EFF, fz = gz * G_EFF;
        if (turning) {
          const rx = b.x - off[0] - this.pivot[0], ry = b.y - off[1] - this.pivot[1], rz = b.z - off[2] - this.pivot[2];
          // -(alpha x r) - omega x (omega x r) - 2 omega x v
          const cx = wy * rz - wz * ry, cy = wz * rx - wx * rz, cz = wx * ry - wy * rx;
          let ix = -(ay * rz - az * ry) - (wy * cz - wz * cy) - 2 * (wy * b.vz - wz * b.vy);
          let iy = -(az * rx - ax * rz) - (wz * cx - wx * cz) - 2 * (wz * b.vx - wx * b.vz);
          let iz = -(ax * ry - ay * rx) - (wx * cy - wy * cx) - 2 * (wx * b.vy - wy * b.vx);
          const im = Math.hypot(ix, iy, iz), cap = 3 * 9810;
          if (im > cap) { ix *= cap / im; iy *= cap / im; iz *= cap / im; }
          fx += ix; fy += iy; fz += iz;
        }
        const k = b.r < 2 ? 34 : (22 * 3) / b.r; // drag per unit mass falls with size
        const uz = this.rinsing && b.z - off[2] < DEV.top ? -this.flow : 0;
        const damp = 1 / (1 + k * dt);
        b.vx = (b.vx + fx * dt) * damp;
        b.vy = (b.vy + fy * dt) * damp;
        b.vz = (b.vz + fz * dt + k * dt * uz) * damp;
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
          if (a.asleep && b.asleep) continue;
          const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
          const rr = a.r + b.r;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= (rr + 0.3) ** 2 || d2 < 1e-12) continue;
          // A moving bead touching (or just leaving) a sleeper wakes it, so a pile never
          // hangs in the air when the bead underneath rolls away.
          if (a.asleep !== b.asleep) {
            const w = a.asleep ? b : a, s = a.asleep ? a : b;
            if (Math.hypot(w.vx, w.vy, w.vz) > WAKE_V) { s.asleep = false; s.still = 0; }
          }
          if (d2 >= rr * rr) continue;
          const d = Math.sqrt(d2), pen = rr - d;
          const ma = a.asleep ? Infinity : a.r ** 3, mb = b.asleep ? Infinity : b.r ** 3;
          const wa = ma === Infinity ? 0 : mb === Infinity ? 1 : mb / (ma + mb), wb = 1 - wa;
          const nx = dx / d, ny = dy / d, nz = dz / d;
          a.x -= nx * pen * wa; a.y -= ny * pen * wa; a.z -= nz * pen * wa;
          b.x += nx * pen * wb; b.y += ny * pen * wb; b.z += nz * pen * wb;
        }
      }
    }

    // Bead-wall contacts in the device's (possibly shaking) frame.
    _walls(b, off, friction) {
      if (b.asleep) return;
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
      // Hard limits: the cavity is a box, so a bead shoved hard by the pile can never end up
      // inside the side or back walls, where the surface contacts would push it the wrong way.
      const cav = DEV.cavity, lz = b.z - off[2];
      if (lz >= cav.zBottom && lz <= cav.zTop) {
        const lx = b.x - off[0], ly = b.y - off[1];
        const cx = Math.max(-cav.x + b.r, Math.min(cav.x - b.r, lx));
        const cy = Math.max(cav.yFront + b.r, Math.min(cav.yBack - b.r, ly));
        b.x = off[0] + cx; b.y = off[1] + cy;
      }
      // Inlet and outlet bores, plus the capped feed tube above the inlet (the suppressed
      // nipple): radius 3.5 mm. Tilting the device can send beads back up into the tube.
      if (lz > cav.zTop || (lz < cav.zBottom && lz > 0)) {
        const rx = b.x - off[0] - DEV.inlet.x, ry = b.y - off[1] - DEV.inlet.y;
        const rad = Math.hypot(rx, ry), lim = Math.max(0, 3.5 - b.r);
        if (rad > lim && rad > 1e-9) {
          b.x = off[0] + DEV.inlet.x + (rx * lim) / rad;
          b.y = off[1] + DEV.inlet.y + (ry * lim) / rad;
        }
        const cap = DEV.top + FEED_LEN - b.r;
        if (lz > cap) b.z = off[2] + cap;
      }
      // Grid guard (see DEV.grids): keep the bead on the side it came from.
      for (const g of DEV.grids) {
        if (b.r <= g.gap / 2) continue;
        const h = Math.sqrt(b.r * b.r - (g.gap / 2) ** 2);
        const lo = g.z[0] - h, hi = g.z[1] + h, z = b.z - off[2];
        if (z > lo && z < hi) b.z = off[2] + (b.pz - off[2] >= (g.z[0] + g.z[1]) / 2 ? hi : lo);
      }
      // Clear panel's inner face: the y = -13 plane.
      const panel = DEV.cavity.yFront + off[1];
      if (b.z - off[2] < DEV.top && b.y - b.r < panel) b.y = panel + b.r;
    }

    _finish(dt) {
      // Derive velocities and cap runaway speeds. A bead that has stayed within SLEEP_R of
      // one spot for SLEEP_T seconds goes to sleep: it stays put (no resting jitter) until
      // disturbed. Using drift rather than speed also catches beads twitching in place.
      const calm = !this.shaking && this.agitation <= 0.02 && !Math.hypot(...this.omega);
      for (const b of this.beads) {
        if (b.asleep) { b.vx = b.vy = b.vz = 0; continue; }
        b.vx = (b.x - b.px) / dt; b.vy = (b.y - b.py) / dt; b.vz = (b.z - b.pz) / dt;
      }
      this._contactDamping();
      for (const b of this.beads) {
        if (b.asleep) continue;
        const v2 = b.vx * b.vx + b.vy * b.vy + b.vz * b.vz;
        if (v2 > 1500 * 1500) { const k = 1500 / Math.sqrt(v2); b.vx *= k; b.vy *= k; b.vz *= k; }
        const a = b.anchor;
        if (calm && a && (b.x - a[0]) ** 2 + (b.y - a[1]) ** 2 + (b.z - a[2]) ** 2 < SLEEP_R * SLEEP_R) {
          b.still = (b.still || 0) + dt;
        } else {
          b.anchor = [b.x, b.y, b.z]; b.still = 0;
        }
        if (b.still > SLEEP_T) { b.asleep = true; b.vx = b.vy = b.vz = 0; }
      }
      // Beads that fall out of the outlet leave the simulation (counted as lost).
      const off = this.offset;
      this.beads = this.beads.filter((b) => {
        if (b.z - off[2] > -30) return true;
        this.lostTally[sizeIndex(b.r)]++;
        return false;
      });
    }

    // Touching beads lose the speed at which they approach each other (no bounce) and a
    // little of their sliding speed (rolling friction). This is what stops piles of large
    // beads from jiggling instead of settling.
    _contactDamping() {
      const beads = this.beads;
      for (let i = 0; i < beads.length; i++) {
        const a = beads[i];
        for (let j = i + 1; j < beads.length; j++) {
          const b = beads[j];
          if (a.asleep && b.asleep) continue;
          const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, rr = a.r + b.r + 0.02;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= rr * rr || d2 < 1e-12) continue;
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, nz = dz / d;
          const ma = a.r ** 3, mb = b.r ** 3;
          const wa = a.asleep ? 0 : b.asleep ? 1 : mb / (ma + mb), wb = b.asleep ? 0 : 1 - wa;
          const rx = b.vx - a.vx, ry = b.vy - a.vy, rz = b.vz - a.vz;
          const vn = rx * nx + ry * ny + rz * nz;
          const tx = rx - vn * nx, ty = ry - vn * ny, tz = rz - vn * nz;
          const ix = (vn < 0 ? vn * nx : 0) + 0.08 * tx, iy = (vn < 0 ? vn * ny : 0) + 0.08 * ty,
            iz = (vn < 0 ? vn * nz : 0) + 0.08 * tz;
          a.vx += ix * wa; a.vy += iy * wa; a.vz += iz * wa;
          b.vx -= ix * wb; b.vy -= iy * wb; b.vz -= iz * wb;
        }
      }
    }

    // Where each bead ended up, in device coordinates; counts are indexed like SIZES.
    census() {
      const zero = () => SIZES.map(() => 0);
      const c = { top: zero(), mid: zero(), res: zero(), feed: zero(), lost: [...this.lostTally] };
      for (const b of this.beads) {
        const k = sizeIndex(b.r);
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

  const api = { Sim, DEV, SIZES, parseSTL };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BeadSim = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
