"use strict";
// Isometric voxel renderer: 2:1 pixel cubes (8 px wide), three-face shading with a cool night shadow,
// a lit back rim on the top face, darker bottom edges so the cube grid reads, tiny per-voxel noise and
// top-face contact shadows. Painter's order by x+y+z. Output is a transparent Canvas.
const { Canvas, hex, mix, mul, hash3 } = require("./pix");

const CW = 8; // cube width in pixels; top diamond is CW/2 tall, side is CW/2 tall
function template() {
  const t = []; const H = CW;
  for (let j = 0; j < H; j++) for (let i = 0; i < CW; i++) {
    const cx = i + 0.5 - CW / 2, cy = j + 0.5;
    const inHex = Math.abs(cx) / 2 <= cy + 1e-6 && cy <= H - Math.abs(cx) / 2 + 1e-6;
    if (!inHex) continue;
    const inTop = Math.abs(cx) / (CW / 2) + Math.abs(cy - CW / 4) / (CW / 4) <= 1 + 1e-6;
    t.push({ i, j, f: inTop ? "T" : cx < 0 ? "L" : "R" });
  }
  const at = new Map(t.map((p) => [p.i + "," + p.j, p.f]));
  for (const p of t) {
    const up = at.get(p.i + "," + (p.j - 1)), down = at.get(p.i + "," + (p.j + 1));
    p.edge = p.f === "T" ? (up !== "T" ? "hi" : "") : down === undefined ? "lo" : "";
    if (p.f === "L" && at.get(p.i - 1 + "," + p.j) === undefined) p.edge = p.edge || "rim";
  }
  return t;
}
const TPL = template();
// Small marks painted on one side face (eyes, a moustache) so faces read without a whole dark voxel.
const DOTS = {
  L: { eye: [[1, 4], [2, 5], [1, 5], [2, 6]], dash: [[0, 5], [1, 5], [2, 6], [3, 6]] },
  R: { eye: [[6, 4], [5, 5], [6, 5], [5, 6]], dash: [[7, 5], [6, 5], [5, 6], [4, 6]] },
};

class Vox {
  constructor() { this.m = new Map(); }
  static key(x, y, z) { return ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512); }
  /** c: "#rrggbb" | [r,g,b] | {c, glow:true, flat:true, noise:n} | null (delete) */
  set(x, y, z, c) {
    x = Math.round(x); y = Math.round(y); z = Math.round(z);
    const k = Vox.key(x, y, z);
    if (c == null) { this.m.delete(k); return; }
    const o = typeof c === "object" && !Array.isArray(c) ? c : { c };
    this.m.set(k, { x, y, z, c: hex(o.c), glow: !!o.glow, flat: !!o.flat, noise: o.noise ?? 1, dot: o.dot ? hex(o.dot) : null, dotFace: o.dotFace || "L", dotShape: o.dotShape || "eye" });
  }
  has(x, y, z) { return this.m.has(Vox.key(x, y, z)); }
  get(x, y, z) { return this.m.get(Vox.key(x, y, z)); }
  /** Fill a box; c may be a function (x,y,z) -> colour|null. */
  box(x0, y0, z0, w, d, h, c) { for (let x = x0; x < x0 + w; x++) for (let y = y0; y < y0 + d; y++) for (let z = z0; z < z0 + h; z++) { const v = typeof c === "function" ? c(x, y, z) : c; if (v !== undefined) this.set(x, y, z, v); } }
  /** Copy another Vox in at an offset (optionally mirrored on x or swapped x/y). */
  add(o, dx = 0, dy = 0, dz = 0, { mirrorX = false, swap = false } = {}) {
    for (const v of o.m.values()) {
      let x = v.x, y = v.y; if (mirrorX) x = -x; if (swap) [x, y] = [y, x];
      this.set(x + dx, y + dy, v.z + dz, { c: v.c, glow: v.glow, flat: v.flat, noise: v.noise, dot: v.dot, dotFace: swap ? (v.dotFace === "L" ? "R" : "L") : v.dotFace, dotShape: v.dotShape });
    }
    return this;
  }
  get size() { return this.m.size; }
}

const NIGHT = hex("#0B1F4B");
function faceColor(v, f, edge, n, ao) {
  if (v.glow) return f === "T" || f === "L" ? v.c : mul(v.c, 0.88);
  let c;
  if (f === "T") c = mix(mul(v.c, 1.04 * ao), NIGHT, ao < 1 ? 0.1 : 0);
  else if (f === "L") c = mix(mul(v.c, 0.8), NIGHT, 0.12);
  else c = mix(mul(v.c, 0.6), NIGHT, 0.26);
  if (!v.flat) {
    if (edge === "hi") c = mix(c, "#FFFFF0", 0.16);
    else if (edge === "lo") c = mul(c, 0.84);
    else if (edge === "rim") c = mix(c, "#FFFFF0", 0.05);
  }
  if (n) c = mul(c, 1 + n);
  return c;
}

/** Render to a Canvas. opts: {noise: 0.035, pad: 2}. Returns {cv, proj(x,y,z) -> [px,py] of the voxel's top centre}. */
function render(vox, opts = {}) {
  const noise = opts.noise ?? 0.035, pad = opts.pad ?? 2;
  const list = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const v of vox.m.values()) {
    if (vox.has(v.x + 1, v.y, v.z) && vox.has(v.x, v.y + 1, v.z) && vox.has(v.x, v.y, v.z + 1)) continue;
    const sx = (v.x - v.y) * (CW / 2), sy = (v.x + v.y) * (CW / 4) - v.z * (CW / 2);
    list.push([v, sx, sy]);
    if (sx < minX) minX = sx; if (sx > maxX) maxX = sx; if (sy < minY) minY = sy; if (sy > maxY) maxY = sy;
  }
  list.sort((a, b) => a[0].x + a[0].y + a[0].z - (b[0].x + b[0].y + b[0].z) || a[0].z - b[0].z || a[0].x - b[0].x);
  const ox = -minX + CW / 2 + pad, oy = -minY + pad;
  const cv = new Canvas(Math.ceil(maxX - minX + CW + pad * 2), Math.ceil(maxY - minY + CW + pad * 2));
  for (const [v, sx, sy] of list) {
    const h = hash3(v.x, v.y, v.z, 7);
    const n = v.flat ? 0 : (h < 0.33 ? -1 : h > 0.66 ? 1 : 0) * noise * v.noise;
    const ao = vox.has(v.x - 1, v.y, v.z + 1) || vox.has(v.x, v.y - 1, v.z + 1) || vox.has(v.x - 1, v.y - 1, v.z + 1) ? 0.86 : 1;
    const cache = {};
    for (const p of TPL) {
      const key = p.f + p.edge;
      const c = cache[key] || (cache[key] = faceColor(v, p.f, p.edge, n, ao));
      cv.set(ox + sx - CW / 2 + p.i, oy + sy + p.j, c);
    }
    if (v.dot) for (const [i, j] of DOTS[v.dotFace][v.dotShape]) cv.set(ox + sx - CW / 2 + i, oy + sy + j, v.dot);
  }
  const proj = (x, y, z) => [ox + (x - y) * (CW / 2), oy + (x + y) * (CW / 4) - z * (CW / 2) + CW / 4];
  return { cv, proj };
}
module.exports = { Vox, render, CW };
