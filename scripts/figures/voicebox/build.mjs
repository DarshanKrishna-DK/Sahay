// Sahay's agent figure: a small counter "voice box" (a shop radio / intercom) on a bench plate.
// Builds public/figures/voicebox/voicebox.svg (static art, no style, no script) and voicebox.css.
// The live code (public/js/app/voicebox.js) only toggles attributes and turns the needle in the
// dial's own face plane, so the browser never projects anything.
//
//   node scripts/figures/voicebox/build.mjs          (or node scripts/figures/build.mjs voicebox)
//
// World units: x along the cabinet, y toward the front, z up. The front face is the +y face.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as k from "../kit/iso-kit.mjs";
import * as G from "../kit/lathe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "..", "..", "public", "figures", "voicebox");

const SIZE = 300;

// Plan.
const PLATE = { x: -74, y: -38, w: 148, d: 88, r: 7 };
const PLATE_H = 7;
const FOOT_H = 4;
const PLINTH = { x: -60, y: -28, w: 120, d: 52, r: 5 };
const BODY = { x: -58, y: -26, w: 116, d: 48, r: 5 };
const BODY_Z = 4;
const BODY_TOP = 76;
const CAP = { x: -60, y: -28, w: 120, d: 52, r: 6 };
const CAP_TOP = 80;
const FY = BODY.y + BODY.d; // front face plane y = 22
const SX = BODY.x + BODY.w; // right side face plane x = 58

// Front face layout (x, z on the plane y = FY).
const GRILLE = { cx: -25, cz: 41, r: 21.5, bezel: 24, depth: 2.6 };
const DIAL = { x0: 5, z0: 45, x1: 49, z1: 66, r: 3, depth: 2 };
const PIVOT = { x: 27, z: 47.5 };
const NEEDLE_LEN = 15.5;
const SCALE_FROM = -52; // degrees from vertical, clockwise on the face
const SCALE_TO = 52;
const KNOB = { x: 17, z: 27, r: 8.5, h: 6 };
const LAMP = { x: 40.5, z: 32.5, r: 5.6, h: 1.8, lens: 3.9 };
const KEYS = [{ x: 33.5, w: 6 }, { x: 41.5, w: 6 }];
const KEY_Z = [13, 19.5];

const ANT = { x: 44, y: -16 };
const LABEL = { x: -23, y: 29, w: 46, d: 10, r: 1.4 };

const TOP_KEYS = [-48, -38, -28].map((x) => ({ x, y: 4, w: 8, d: 12, r: 1.2 }));

const P = k.fitProjection(
  [
    ...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0),
    ...k.boxCorners(CAP, CAP_TOP - 4, CAP_TOP),
    [ANT.x, ANT.y, 126],
    [KNOB.x, FY + KNOB.h + 1, KNOB.z - KNOB.r],
  ],
  SIZE,
  SIZE,
  { pad: 14, azimuth: 58 },
);

const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const path3 = (points, closed = true) => k.pathOf(points.map(at), closed);
const fine = (v) => Math.round(v * 100) / 100;

// Points on the front plane (y given) and on the right side plane (x = SX).
const front = (x, z, y = FY) => [x, y, z];
const circleFront = (cx, cz, r, y = FY, n = 72) => Array.from({ length: n }, (_, i) => {
  const t = (i / n) * Math.PI * 2;
  return front(cx + r * Math.cos(t), cz + r * Math.sin(t), y);
});
const rectFront = ({ x0, z0, x1, z1, r }, y = FY) => k.roundedPlan({ x: x0, y: z0, w: x1 - x0, d: z1 - z0, r }, 6).map(([x, z]) => front(x, z, y));
const rectSide = ({ y0, z0, y1, z1, r }) => k.roundedPlan({ x: y0, y: z0, w: y1 - y0, d: z1 - z0, r }, 6).map(([y, z]) => [SX, y, z]);
// A group in the front plane at y: local (u, w) = world (x = u, z = -w).
const faceGroup = (y, inner, attrs = "") => `<g transform="${k.sideMatrix([0, y], 0, P, "left")}"${attrs}>${inner}</g>`;
const Y = (axis) => G.frameAlong(axis, [0, 1, 0]);

function plate() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(PLATE, 14))) {
    out.push(S(k.cylinder(x, y, 6, -PLATE_H - FOOT_H, 1.4, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 4.6, -PLATE_H - FOOT_H + 1.4, FOOT_H - 1.4, P, 28), { tone: "mid" }));
  }
  out.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.4), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "faint" }));
  const screws = k.corners(PLATE, 10);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
  return out.join("");
}

function label() {
  const out = [S(k.slabOf(LABEL, 0, 0.9, P, 4, 0.3), { tone: "mid", crease: "lo" })];
  out.push(L(k.planOutline(k.insetPlan(LABEL, 1.4), 0.9, P, 4), { tone: "faint" }));
  out.push(k.faceTextSvg(k.topMatrix([0, LABEL.y + LABEL.d / 2 + 2], 0.9, P, "x"), "SAHAY", { size: 5.4, tone: "mid", anchor: "middle" }).replace("<text ", '<text class="iso-face-text vbx-engrave" ').replace('class="iso-face-text" ', ""));
  out.push(D([at([LABEL.x + 3.2, LABEL.y + LABEL.d / 2, 0.9]), at([LABEL.x + LABEL.w - 3.2, LABEL.y + LABEL.d / 2, 0.9])], { size: 0.5, tone: "mid" }));
  return out.join("");
}

function cabinet() {
  const out = [];
  out.push(`<path class="iso-halo vbx-halo-soft" d="${k.haloOf(k.insetPlan(PLINTH, 2), 0, 1, P)}"/>`);
  out.push(S(k.slabOf(PLINTH, 0, BODY_Z, P, 6, 0.6), { tone: "lo", crease: "faint" }));
  const seams = [BODY_Z + 9, BODY_TOP - 6].map((z) => L(k.sideSeam(BODY, z, P, 6), { tone: "faint" })).join("");
  out.push(S(k.slabOf(BODY, BODY_Z, BODY_TOP - BODY_Z, P, 6, 0.8), { tone: "mid", inner: seams }));
  return out.join("");
}

function sideFace() {
  // Five closed vent slots and two case screws on the right side (x = SX).
  const out = [];
  const slots = [];
  for (let i = 0; i < 5; i++) {
    const z0 = 24 + i * 7;
    slots.push(path3(rectSide({ y0: -16, z0, y1: 12, z1: z0 + 3, r: 1.5 })));
  }
  out.push(`<path class="vbx-slot" d="${slots.join("")}"/>`);
  out.push(L(slots.join(""), { tone: "lo" }));
  out.push(D([at([SX, -19, 66]), at([SX, 15, 66]), at([SX, -19, 18]), at([SX, 15, 18])], { size: 0.5, tone: "mid" }));
  return out.join("");
}

function recess(id, outline, depth, faceY = FY) {
  // An opening in a face at faceY: its outline, its inner wall, and a floor `depth` behind it.
  const faceD = path3(outline(faceY));
  const floorD = path3(outline(faceY - depth));
  return {
    clip: `<clipPath id="${id}"><path d="${faceD}"/></clipPath>`,
    wall: `<path class="vbx-wall" d="${faceD}"/>`,
    floor: `<path class="vbx-floor" data-floor="${id}" d="${floorD}"/>`,
    edge: L(faceD, { tone: "lo" }),
    floorY: faceY - depth,
  };
}

function frontFace() {
  const out = [];
  // Panel groove: one closed outline round the whole front.
  out.push(L(path3(rectFront({ x0: -51, z0: BODY_Z + 9 + 3, x1: 53, z1: BODY_TOP - 9, r: 3 })), { tone: "faint" }));

  // Speaker grille: a bezel standing 1.4 proud of the face with four screws, and a round opening
  // cut through it to a mesh floor with rings, a dust cap and three ripple rings.
  const BZ = 1.4;
  const bezelF = Y([GRILLE.cx, FY, GRILLE.cz]);
  out.push(S(G.disc(0, BZ, GRILLE.bezel, bezelF, P), { tone: "mid", crease: "lo" }));
  out.push(D([45, 135, 225, 315].map((a) => {
    const t = (a * Math.PI) / 180;
    const r = (GRILLE.r + GRILLE.bezel) / 2;
    return at(front(GRILLE.cx + r * Math.cos(t), GRILLE.cz + r * Math.sin(t), FY + BZ));
  }), { size: 0.5, tone: "mid" }));
  const g = recess("vbx-grille", (y) => circleFront(GRILLE.cx, GRILLE.cz, GRILLE.r, y), GRILLE.depth + BZ, FY + BZ);
  const fy = g.floorY;
  const rings = [5.5, 9.5, 13.5, 17.5].map((r) => path3(circleFront(GRILLE.cx, GRILLE.cz, r, fy)));
  const holes = [];
  for (const [r, n] of [[7.5, 14], [11.5, 22], [15.5, 30], [19.5, 38]]) {
    for (let i = 0; i < n; i++) {
      const t = ((i + (r % 2 ? 0.5 : 0)) / n) * Math.PI * 2;
      holes.push(at(front(GRILLE.cx + r * Math.cos(t), GRILLE.cz + r * Math.sin(t), fy)));
    }
  }
  const ripples = [0, 1, 2].map((i) => `<circle class="vbx-ripple" data-i="${i}" cx="${GRILLE.cx}" cy="${-GRILLE.cz}" r="${GRILLE.r - 2}"/>`).join("");
  const capF = Y([GRILLE.cx, fy, GRILLE.cz]);
  const cap = S(G.disc(0, 1.6, 3.4, capF, P), { tone: "mid", crease: "lo" });
  const capRing = L(G.circleOf(capF, 1.6, 2, P), { tone: "faint" });
  out.push(g.clip, g.wall);
  out.push(`<g clip-path="url(#vbx-grille)">${g.floor}<g class="vbx-mesh">${L(rings.join(""), { tone: "lo" })}${D(holes, { size: 0.55, tone: "lo" })}</g>${faceGroup(fy, ripples, ' class="vbx-ripples"')}<g class="vbx-cone">${cap}${capRing}</g></g>`);
  out.push(g.edge);

  // Dial window: a rounded opening with a scale arc, ticks, a stop pin and the needle on a hub.
  const d = recess("vbx-dial", (y) => rectFront(DIAL, y), DIAL.depth);
  const dy = d.floorY;
  const rad = (deg) => (deg * Math.PI) / 180;
  const onArc = (deg, r) => [PIVOT.x + r * Math.sin(rad(deg)), -(PIVOT.z + r * Math.cos(rad(deg)))];
  const local = (pts) => k.pathOf(pts);
  const minor = [];
  const major = [];
  const count = 20;
  for (let i = 0; i <= count; i++) {
    const deg = SCALE_FROM + ((SCALE_TO - SCALE_FROM) * i) / count;
    const big = i % 5 === 0;
    (big ? major : minor).push(local([onArc(deg, 12.6), onArc(deg, big ? 16.4 : 14.8)]));
  }
  const arcPts = [];
  for (let i = 0; i <= 40; i++) arcPts.push(onArc(SCALE_FROM + ((SCALE_TO - SCALE_FROM) * i) / 40, 12.6));
  const bandPts = [];
  for (let i = 0; i <= 20; i++) bandPts.push(onArc(SCALE_TO - 22 + (22 * i) / 20, 16.4));
  for (let i = 20; i >= 0; i--) bandPts.push(onArc(SCALE_TO - 22 + (22 * i) / 20, 15.1));
  const scale = [
    `<path class="vbx-band" d="${k.pathOf(bandPts, true)}"/>`,
    L(local(arcPts), { tone: "lo" }),
    L(minor.join(""), { tone: "lo" }),
    L(major.join(""), { tone: "mid" }),
    L(local([onArc(SCALE_FROM, 12.6), onArc(SCALE_FROM, 17.4)]), { tone: "hi" }),
  ].join("");
  const stop = onArc(SCALE_FROM - 9, 10.5);
  const needle = `<g class="vbx-needle" data-part="needle" transform="rotate(${SCALE_FROM} ${PIVOT.x} ${-PIVOT.z})">`
    + `<path class="iso-line vbx-needle-line" data-tone="hi" data-free="end" d="${local([[PIVOT.x, -PIVOT.z + 3.2], [PIVOT.x, -PIVOT.z - NEEDLE_LEN]])}"/>`
    + `</g>`;
  const hub = `<circle class="vbx-hub" cx="${PIVOT.x}" cy="${-PIVOT.z}" r="2.1"/><circle class="vbx-hub-dot" cx="${PIVOT.x}" cy="${-PIVOT.z}" r="0.7"/>`;
  out.push(d.clip, d.wall);
  out.push(`<g clip-path="url(#vbx-dial)">${d.floor}${faceGroup(dy, `${scale}<circle class="vbx-pin" cx="${fine(stop[0])}" cy="${fine(stop[1])}" r="0.9"/>${needle}${hub}`, ' class="vbx-dial-face"')}</g>`);
  out.push(d.edge);
  // Glass: a faint frame line just inside the opening, on the face plane.
  out.push(L(path3(rectFront({ x0: DIAL.x0 + 1.2, z0: DIAL.z0 + 1.2, x1: DIAL.x1 - 1.2, z1: DIAL.z1 - 1.2, r: 2 })), { tone: "faint" }));

  // Two screws holding the panel, left and right of the top seam.
  out.push(D([at(front(-47, 66)), at(front(51, 66)), at(front(-47, 17)), at(front(51, 17))], { size: 0.5, tone: "mid" }));
  return out.join("");
}

function frontParts() {
  // Proud parts on the front: the knurled knob, the pilot lamp, two push keys. Far to near.
  const items = [];
  // Knob: boss, knurled body, cap with a pointer.
  {
    const F = Y([KNOB.x, FY, KNOB.z]);
    const s = [];
    s.push(S(G.disc(0, 1.2, KNOB.r + 1.6, F, P), { tone: "lo" }));
    const ribs = G.ribsOf(F, 1.4, 1.2 + KNOB.h - 0.2, KNOB.r, 44, P, { fade: [0.05, 0.4] });
    s.push(S(G.disc(1.2, 1.2 + KNOB.h, KNOB.r, F, P), { tone: "mid", crease: "lo", inner: k.fadedSvg(ribs, { tone: "lo" }) }));
    const capS = 1.2 + KNOB.h;
    s.push(S(G.disc(capS, capS + 1, KNOB.r - 2.2, F, P), { tone: "hi", crease: "lo" }));
    const tip = 1.2 + KNOB.h + 1;
    s.push(L(k.pathOf([at(front(KNOB.x, KNOB.z, FY + tip)), at(front(KNOB.x - (KNOB.r - 2.2) * 0.6, KNOB.z + (KNOB.r - 2.2) * 0.8, FY + tip))]), { tone: "hi" }));
    s.push(D([at(front(KNOB.x, KNOB.z, FY + tip))], { size: 0.6, tone: "hi" }));
    // A printed scale round the knob on the face: short ticks rooted on a faint ring.
    const ticks = [];
    for (let i = 0; i <= 8; i++) {
      const t = ((-140 + (280 * i) / 8) * Math.PI) / 180;
      const r0 = KNOB.r + 2.6;
      ticks.push(k.pathOf([at(front(KNOB.x + r0 * Math.sin(t), KNOB.z + r0 * Math.cos(t))), at(front(KNOB.x + (r0 + (i % 4 ? 1.4 : 2.4)) * Math.sin(t), KNOB.z + (r0 + (i % 4 ? 1.4 : 2.4)) * Math.cos(t)))]));
    }
    const tickRing = [];
    for (let i = 0; i <= 40; i++) {
      const t = ((-140 + (280 * i) / 40) * Math.PI) / 180;
      tickRing.push(at(front(KNOB.x + (KNOB.r + 2.6) * Math.sin(t), KNOB.z + (KNOB.r + 2.6) * Math.cos(t))));
    }
    items.push({ depth: -1, svg: L(k.pathOf(tickRing) + ticks.join(""), { tone: "lo" }) });
    items.push({ depth: k.depthOf([KNOB.x, FY, KNOB.z], P), svg: s.join("") });
  }
  // Pilot lamp: bezel, dark glass dome, the lit dome over it (its opacity is the lamp's brightness).
  {
    const F = Y([LAMP.x, FY, LAMP.z]);
    const s = [];
    s.push(faceGroup(FY, `<circle class="vbx-lamp-ring" cx="${LAMP.x}" cy="${-LAMP.z}" r="${LAMP.r + 1.3}"/>`));
    s.push(S(G.disc(0, LAMP.h, LAMP.r, F, P), { tone: "mid", crease: "lo" }));
    s.push(L(G.circleOf(F, LAMP.h, LAMP.lens + 0.6, P), { tone: "lo" }));
    const centre = [LAMP.x, FY + LAMP.h - 0.4, LAMP.z];
    const dome = G.sphereOf(centre, LAMP.lens, P);
    s.push(S(dome, { tone: "lo", crease: "none", className: "vbx-lens" }));
    s.push(`<g class="vbx-lamp">${S(dome, { tone: "lit", crease: "none", lit: true, className: "vbx-lamp-lit" })}</g>`);
    const shine = at([LAMP.x - LAMP.lens * 0.3, FY + LAMP.h - 0.4 + LAMP.lens * 0.8, LAMP.z + LAMP.lens * 0.45]);
    s.push(D([shine], { size: 0.55, tone: "hi" }));
    items.push({ depth: k.depthOf([LAMP.x, FY, LAMP.z], P), svg: s.join("") });
  }
  // Two push keys under the lamp, standing 2.4 proud of the face.
  for (const key of KEYS) {
    const plan = { x: key.x, y: FY, w: key.w, d: 2.4, r: 0.8 };
    const svg = S(k.slabOf(plan, KEY_Z[0], KEY_Z[1] - KEY_Z[0], P, 3, 0.4), { tone: "mid", crease: "lo" })
      + L(k.planOutline(k.insetPlan(plan, 0.9), KEY_Z[1], P, 3), { tone: "faint" });
    items.push({ depth: k.depthOf([key.x + key.w / 2, FY, KEY_Z[0]], P), svg });
  }
  return items.sort((a, b) => a.depth - b.depth).map((i) => i.svg).join("");
}

function top() {
  const out = [];
  const capSeam = L(k.sideSeam(CAP, CAP_TOP - 2, P, 6), { tone: "faint" });
  out.push(S(k.slabOf(CAP, BODY_TOP, CAP_TOP - BODY_TOP, P, 6, 1), { tone: "mid", inner: capSeam }));
  out.push(L(k.planOutline(k.insetPlan(CAP, 4), CAP_TOP, P, 6), { tone: "faint" }));
  out.push(D(k.corners(CAP, 7.5).map(([x, y]) => at([x, y, CAP_TOP])), { size: 0.5, tone: "mid" }));
  // Antenna: a swivel collar on a pad, a ball, three telescoping sections and a ball tip.
  const pad = { x: ANT.x - 6, y: ANT.y - 6, w: 12, d: 12, r: 2 };
  out.push(S(k.slabOf(pad, CAP_TOP, 1.2, P, 3, 0.3), { tone: "lo" }));
  out.push(D(k.corners(pad, 2).map(([x, y]) => at([x, y, CAP_TOP + 1.2])), { size: 0.4, tone: "mid" }));
  const z0 = CAP_TOP + 1.2;
  out.push(S(k.cylinder(ANT.x, ANT.y, 3.6, z0, 3, P, 28, 0.4), { tone: "mid", crease: "lo" }));
  out.push(S(G.sphereOf([ANT.x, ANT.y, z0 + 4.6], 2.4, P), { tone: "mid", crease: "none" }));
  const sections = [[z0 + 6.2, 18, 1.5], [z0 + 24.2, 13, 1.15], [z0 + 37.2, 7, 0.85]];
  for (const [z, h, r] of sections) {
    out.push(S(k.cylinder(ANT.x, ANT.y, r, z, h, P, 16), { tone: "hi", crease: "none" }));
    out.push(S(k.cylinder(ANT.x, ANT.y, r + 0.35, z + h - 1, 1, P, 16), { tone: "mid", crease: "none" }));
  }
  const tipZ = z0 + 37.2 + 7 + 1.4;
  out.push(S(G.sphereOf([ANT.x, ANT.y, tipZ], 1.7, P), { tone: "hi", crease: "none" }));
  // Three preset keys at the front-left of the top, with a label groove behind them.
  for (const plan of TOP_KEYS) {
    out.push(S(k.slabOf(plan, CAP_TOP, 2.6, P, 3, 0.4), { tone: "mid", crease: "lo" }));
    out.push(L(k.planOutline(k.insetPlan(plan, 1.6), CAP_TOP + 2.6, P, 3), { tone: "faint" }));
  }
  return out.join("");
}

export function geometry() {
  return { P, SIZE, PIVOT, SCALE_FROM, SCALE_TO, NEEDLE_LEN, GRILLE, DIAL, LAMP };
}

export function svg() {
  const body = [plate(), label(), cabinet(), sideFace(), frontFace(), frontParts(), top()];
  return `<svg xmlns="http://www.w3.org/2000/svg" class="iso-svg vbx-svg" viewBox="0 0 ${SIZE} ${SIZE}" aria-hidden="true" focusable="false">${body.join("")}</svg>\n`;
}

const CSS = String.raw`/* Sahay agent figure: the counter voice box (built by scripts/figures/voicebox/build.mjs).
   Self-contained: the anatomy kit's classes are restyled here under .vbx, tinted for the v5 look
   (warm black, cream hairlines, one creamy-pink lamp). Every colour lives in these variables. */
.vbx {
  --anatomy-paper: #1C1719; --anatomy-face: #262022; --anatomy-top: #2E2628;
  --anatomy-shade-0: #141012; --anatomy-shade-1: #191416; --anatomy-shade-2: #1F191B; --anatomy-shade-3: #262022;
  --anatomy-lit-top: #3A2B2A; --anatomy-lit-shade: #2E2223;
  --anatomy-hi: #F8ECE8; --anatomy-mid: #CDB8B3; --anatomy-lo: #86726D; --anatomy-faint: #4E4240; --anatomy-lit: #F2CFC6;
  --anatomy-halo: #000; --anatomy-halo-opacity: .55; --anatomy-dot: #F8ECE8;
  --anatomy-weight: .8px;
  --vbx-lamp: #F7DDD6; --vbx-lamp-deep: #E6B3A6; --vbx-level: 0;
  --vbx-ease: cubic-bezier(.45, 0, .25, 1);
  position: relative; display: inline-block; flex: none; line-height: 0; color: var(--anatomy-hi);
}
.vbx[data-state="trouble"] { --vbx-lamp: #F5D59E; --vbx-lamp-deep: #E0AE5F; }
.vbx .vbx-svg { display: block; width: 100%; height: 100%; overflow: visible; }
.vbx path, .vbx circle { vector-effect: non-scaling-stroke; }
.vbx .iso-fill { fill: var(--anatomy-paper); stroke: none; }
.vbx .iso-shade, .vbx .iso-top { stroke: none; }
.vbx .iso-shade[data-shade="0"] { fill: var(--anatomy-shade-0); }
.vbx .iso-shade[data-shade="1"] { fill: var(--anatomy-shade-1); }
.vbx .iso-shade[data-shade="2"] { fill: var(--anatomy-shade-2); }
.vbx .iso-shade[data-shade="3"] { fill: var(--anatomy-shade-3); }
.vbx .iso-top { fill: var(--anatomy-top); }
.vbx .iso-solid[data-seamless] > .iso-shade, .vbx .iso-solid[data-seamless] > .iso-top { stroke-width: .4; stroke-linejoin: round; }
.vbx .iso-solid[data-seamless] > .iso-shade[data-shade="0"] { stroke: var(--anatomy-shade-0); }
.vbx .iso-solid[data-seamless] > .iso-shade[data-shade="1"] { stroke: var(--anatomy-shade-1); }
.vbx .iso-solid[data-seamless] > .iso-shade[data-shade="2"] { stroke: var(--anatomy-shade-2); }
.vbx .iso-solid[data-seamless] > .iso-shade[data-shade="3"] { stroke: var(--anatomy-shade-3); }
.vbx .iso-halo { fill: var(--anatomy-halo); stroke: none; filter: blur(7px); opacity: var(--anatomy-halo-opacity); transform: translateY(3px); }
.vbx .vbx-halo-soft { filter: blur(3px); opacity: .5; transform: none; }
.vbx .iso-line { fill: none; stroke: var(--anatomy-lo); stroke-width: var(--anatomy-weight); stroke-linecap: round; stroke-linejoin: round; }
.vbx .iso-line[data-tone="hi"] { stroke: var(--anatomy-hi); }
.vbx .iso-line[data-tone="mid"] { stroke: var(--anatomy-mid); }
.vbx .iso-line[data-tone="lo"] { stroke: var(--anatomy-lo); }
.vbx .iso-line[data-tone="faint"] { stroke: var(--anatomy-faint); }
.vbx .iso-line[data-tone="lit"] { stroke: var(--anatomy-lit); }
.vbx .iso-dots circle { fill: var(--anatomy-dot); stroke: none; opacity: .32; }
.vbx .iso-dots[data-tone="hi"] circle { opacity: .85; }
.vbx .iso-dots[data-tone="mid"] circle { opacity: .45; }
.vbx .iso-dots[data-tone="lo"] circle { opacity: .24; }
.vbx .iso-face-text { fill: var(--anatomy-mid); font-family: "Manrope", ui-sans-serif, system-ui, sans-serif; font-weight: 800; letter-spacing: .18em; }
.vbx .vbx-engrave { fill: var(--anatomy-shade-0); stroke: var(--anatomy-mid); stroke-width: .35px; paint-order: stroke; }

/* Recesses, slots and the dial face. */
.vbx .vbx-wall { fill: var(--anatomy-shade-0); }
.vbx .vbx-floor { fill: #141012; }
.vbx .vbx-slot { fill: var(--anatomy-shade-0); }
.vbx .vbx-dial-face .vbx-band { fill: var(--anatomy-faint); }
.vbx .vbx-floor[data-floor="vbx-dial"] { fill: #1E1819; }
.vbx .vbx-pin { fill: var(--anatomy-mid); }
.vbx .vbx-hub { fill: var(--anatomy-shade-3); stroke: var(--anatomy-mid); stroke-width: .7px; }
.vbx .vbx-hub-dot { fill: var(--anatomy-hi); }
.vbx .vbx-needle-line { stroke-width: 1.15px; }

/* The lamp: a dark glass dome under a lit dome whose opacity is the lamp's brightness. */
.vbx .vbx-lens > .iso-fill, .vbx .vbx-lens > .iso-shade { fill: #241B1D; stroke: #241B1D; }
.vbx .vbx-lens > .iso-shade[data-shade="0"] { fill: #191314; stroke: #191314; }
.vbx .vbx-lens > .iso-shade[data-shade="3"] { fill: #3A2E2F; stroke: #3A2E2F; }
.vbx .vbx-lamp-lit > .iso-fill, .vbx .vbx-lamp-lit > .iso-shade { fill: var(--vbx-lamp-deep); stroke: var(--vbx-lamp-deep); }
.vbx .vbx-lamp-lit > .iso-shade[data-shade="0"] { fill: color-mix(in srgb, var(--vbx-lamp-deep) 58%, #0F0D0E); stroke: color-mix(in srgb, var(--vbx-lamp-deep) 58%, #0F0D0E); }
.vbx .vbx-lamp-lit > .iso-shade[data-shade="1"] { fill: color-mix(in srgb, var(--vbx-lamp-deep) 78%, #0F0D0E); stroke: color-mix(in srgb, var(--vbx-lamp-deep) 78%, #0F0D0E); }
.vbx .vbx-lamp-lit > .iso-shade[data-shade="3"] { fill: var(--vbx-lamp); stroke: var(--vbx-lamp); }
.vbx .vbx-lamp-lit > .iso-edge { stroke: color-mix(in srgb, var(--vbx-lamp-deep) 70%, #0F0D0E); }
.vbx .vbx-lamp-ring { fill: none; stroke: var(--vbx-lamp); stroke-width: .9px; opacity: 0; transition: opacity .6s var(--vbx-ease); }
.vbx .vbx-lamp { opacity: .4; transition: opacity .6s var(--vbx-ease); }
.vbx[data-state="listening"] .vbx-lamp, .vbx[data-state="speaking"] .vbx-lamp { opacity: .85; }
.vbx[data-state="waiting"] .vbx-lamp, .vbx[data-state="trouble"] .vbx-lamp { opacity: 1; }
.vbx[data-state="waiting"] .vbx-lamp-ring, .vbx[data-state="trouble"] .vbx-lamp-ring { opacity: .75; }
.vbx[data-state="thinking"] .vbx-lamp { opacity: .6; }

/* Ripples in the grille, drawn in the grille's own plane: in for listening, out for speaking. */
.vbx .vbx-ripple { fill: none; stroke: var(--anatomy-hi); stroke-width: .8px; opacity: 0; transform-box: fill-box; transform-origin: center; }
.vbx .vbx-ripples { opacity: calc(.4 + .6 * var(--vbx-level)); }
.vbx .vbx-cone { transform-box: fill-box; transform-origin: center; transform: scale(calc(1 + .22 * var(--vbx-level))); }
.vbx[data-detail="low"] .iso-dots, .vbx[data-detail="low"] .iso-line[data-tone="faint"], .vbx[data-detail="low"] .vbx-mesh .iso-dots { display: none; }
.vbx[data-detail="low"] { --anatomy-weight: .8px; }

/* Motion runs only while data-motion="on" (the module sets it while visible and allowed). */
.vbx[data-motion="on"][data-state="idle"] .vbx-lamp { animation: vbx-breathe 6s var(--vbx-ease) infinite; }
.vbx[data-motion="on"][data-state="thinking"] .vbx-lamp { animation: vbx-blink 2.4s var(--vbx-ease) infinite; }
.vbx[data-motion="on"][data-state="listening"] .vbx-ripple { animation: vbx-in 2.7s var(--vbx-ease) infinite; }
.vbx[data-motion="on"][data-state="speaking"] .vbx-ripple { animation: vbx-out 2.1s cubic-bezier(.2, .6, .35, 1) infinite; }
.vbx[data-motion="on"] .vbx-ripple[data-i="1"] { animation-delay: -.9s; }
.vbx[data-motion="on"] .vbx-ripple[data-i="2"] { animation-delay: -1.8s; }
.vbx[data-motion="on"][data-state="speaking"] .vbx-ripple[data-i="1"] { animation-delay: -.7s; }
.vbx[data-motion="on"][data-state="speaking"] .vbx-ripple[data-i="2"] { animation-delay: -1.4s; }
@keyframes vbx-breathe { 0%, 100% { opacity: .28; } 50% { opacity: .6; } }
@keyframes vbx-blink { 0%, 100% { opacity: .18; } 45%, 55% { opacity: .95; } }
@keyframes vbx-in { 0% { transform: scale(1); opacity: 0; } 20% { opacity: .55; } 100% { transform: scale(.18); opacity: 0; } }
@keyframes vbx-out { 0% { transform: scale(.2); opacity: 0; } 25% { opacity: .6; } 100% { transform: scale(1); opacity: 0; } }

/* Still poses (reduced motion, off screen before the first frame): one ring shows the direction. */
.vbx:not([data-motion="on"])[data-state="listening"] .vbx-ripple[data-i="0"] { transform: scale(.55); opacity: .45; }
.vbx:not([data-motion="on"])[data-state="speaking"] .vbx-ripple[data-i="0"] { transform: scale(.8); opacity: .45; }
@media (prefers-reduced-motion: reduce) {
  .vbx .vbx-lamp { transition: none; }
  .vbx .vbx-lamp, .vbx .vbx-ripple { animation: none !important; }
}
`;

export function build() {
  mkdirSync(OUT, { recursive: true });
  const art = svg();
  writeFileSync(join(OUT, "voicebox.svg"), art);
  writeFileSync(join(OUT, "voicebox.css"), CSS);
  console.log("wrote public/figures/voicebox/voicebox.svg", `(${(Buffer.byteLength(art) / 1024).toFixed(1)} KB)`);
  console.log("wrote public/figures/voicebox/voicebox.css");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) build();
