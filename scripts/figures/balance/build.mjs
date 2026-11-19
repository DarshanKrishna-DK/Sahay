// Fig 1, the bargaining balance: a shop's beam balance (tarazu) on a bench plate. The seller's
// ask sits on the left pan and Sahay's offer on the right, as stacked five-rupee weights; the
// beam tips toward the heavier side, and a dial on the plate reads the rupees on the seller's
// pan. When ask and offer are equal the beam hangs level and the dial reads the agreed price.
// Writes public/figures/balance/balance.svg (still pose: agreed) and geo.js.
import * as k from "../kit/iso-kit.mjs";
import * as G from "../kit/lathe.mjs";
import { geoModule, importBrowserModule, svgOf, writeOut } from "../common.mjs";

export async function build() {
  const M = await importBrowserModule("balance/model.js");
  const FINAL = M.ROUNDS[M.ROUNDS.length - 1];

  const WIDTH = 600;
  const HEIGHT = 470;

  // ---- world plan (units of about 1 px, z up; the viewer stands at +x +y) ----
  const PLATE = { x: -142, y: -50, w: 284, d: 100, r: 8 };
  const PLATE_H = 10;
  const FOOT_H = 5;
  const PIVOT = [0, 0, 168];
  const ARM = 100;                  // pivot to pan hook, along the beam
  const BOSS_R = 4;
  const RING = { r: 2.8, inner: 1.7 };
  const RING_Z = PIVOT[2] - BOSS_R - RING.r;           // hook ring centre
  const KNOT_Z = RING_Z - RING.r;                       // where the three strings meet
  const PAN_R = 28;
  const PAN_TOP = 92;
  const DISC = { r: 9.5, h: 2.6 };
  const STRING_ANGLES = [90, 210, 330];                 // degrees round the pan, from +x
  const DIAL_AT = [-64, 24];
  const DIAL = { r: 16, z: 9, h: 9 };
  const DIAL_TOP = DIAL.z + DIAL.h;
  const ARC = { r0: 27, r1: 36, half: 12 };             // pointer scale, degrees each side
  const POINTER = { r0: 7, r1: 34.5 };

  const P = k.fitProjection(
    [
      ...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0),
      [0, 0, PIVOT[2] + ARC.r1 + 1],
      [-ARM - PAN_R, 0, PAN_TOP - 20], [ARM + PAN_R, 0, PAN_TOP - 20],
      [-ARM, -PAN_R, PAN_TOP], [ARM, PAN_R, PAN_TOP],
    ],
    WIDTH, HEIGHT, { pad: 26, azimuth: 90 },
  );

  const at = (p) => k.iso(p, P);
  const S = (paths, style) => k.solidSvg(paths, style);
  const L = (d, style) => k.lineSvg(d, style);
  const D = (pts, style) => k.dotsSvg(pts, style);
  const depth2 = ([x, y]) => k.depthOf([x, y, 0], P);
  const byDepth = (pts) => [...pts].sort((a, b) => depth2(a) - depth2(b));
  const alongY = (o) => G.frameOf(o, [0, 1, 0], [1, 0, 0], [0, 0, 1]);   // u = x, v = z
  const rad = (deg) => (deg * Math.PI) / 180;

  // ---------------------------------------------------------------- base plate ----
  function base() {
    const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
    for (const [x, y] of byDepth(k.corners(PLATE, 20))) {
      out.push(S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
      out.push(S(k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
    }
    out.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: "mid", inner: L(k.sideSeam(PLATE, -PLATE_H + 3, P, 8), { tone: "faint" }) }));
    out.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
    const screws = k.corners(PLATE, 10);
    out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
    out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));

    // Soft shadows on the plate under the hanging pans.
    for (const x of [-ARM, ARM]) {
      out.push(`<path class="iso-halo" style="opacity:calc(var(--anatomy-halo-opacity) * .45)" d="${k.haloOf({ x: x - 20, y: -20, w: 40, d: 40, r: 20 }, 0, 0.1, P)}"/>`);
    }

    // Ruler strip along the front edge, ticks rooted on its back edge.
    const strip = { x: 12, y: 36, w: 118, d: 7, r: 1 };
    out.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
    const ticks = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 4, 5, strip.y, 0.6, [2.2, 3.8], P);
    out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
    out.push(D([at([strip.x + 2, strip.y + 5, 0.6]), at([strip.x + strip.w - 2, strip.y + 5, 0.6])], { size: 0.45 }));

    // Spirit level, front left of the pillar: a housing with a vial slot and its bubble centred.
    const level = { x: -36, y: 30, w: 26, d: 9, r: 2 };
    out.push(S(k.slabOf(level, 0, 3.2, P, 3, 0.4), { tone: "mid" }));
    const vial = { x: level.x + 6, y: level.y + 3, w: 14, d: 3, r: 1.5 };
    out.push(S(k.slabOf(vial, 3.2, 0.4, P, 4), { tone: "lo", crease: "none" }));
    out.push(L(k.lineOnTop([vial.x + 5, vial.y], [vial.x + 5, vial.y + vial.d], 3.6, P) + k.lineOnTop([vial.x + 9, vial.y], [vial.x + 9, vial.y + vial.d], 3.6, P), { tone: "mid" }));
    out.push(L(k.ring(vial.x + 7, vial.y + 1.5, 1.1, 3.6, P, 16), { tone: "hi" }));
    out.push(D([at([level.x + 2.6, level.y + 4.5, 3.2]), at([level.x + level.w - 2.6, level.y + 4.5, 3.2])], { size: 0.4 }));

    // Maker's plate, back right: three printed rule lines and two screws.
    const label = { x: 74, y: -43, w: 46, d: 17, r: 2 };
    out.push(S(k.slabOf(label, 0, 0.8, P, 4), { tone: "lo" }));
    out.push(L(k.planOutline(k.insetPlan(label, 1.6), 0.8, P), { tone: "faint" }));
    out.push(L([0, 1, 2].map((i) => k.lineOnTop([label.x + 8, label.y + 5 + i * 3.6], [label.x + 8 + [30, 22, 26][i], label.y + 5 + i * 3.6], 0.8, P)).join(""), { tone: "lo", free: true }));
    out.push(D([at([label.x + 4, label.y + 8.5, 0.8]), at([label.x + label.w - 4, label.y + 8.5, 0.8])], { size: 0.45 }));

    // Tray of spare weights, back left.
    const tray = { x: -134, y: -44, w: 44, d: 24, r: 4 };
    out.push(S(k.slabOf(tray, 0, 3, P, 5, 0.5), { tone: "mid" }));
    out.push(L(k.planOutline(k.insetPlan(tray, 2.2), 3, P, 5), { tone: "faint" }));
    for (const [x, y, n] of byDepth([[-122, -32, 2], [-102, -32, 1]])) {
      for (let i = 0; i < n; i++) out.push(S(k.cylinder(x, y, 6.5, 3 + i * 2.2, 2.2, P, 32, 0.3), { tone: "mid" }));
      out.push(L(k.ring(x, y, 2, 3 + n * 2.2, P, 16), { tone: "faint" }));
    }
    return out.join("");
  }

  // ---------------------------------------------------------------- price dial ----
  function dialStatic() {
    const [x, y] = DIAL_AT;
    const out = [];
    out.push(S(k.cylinder(x, y, 8, 0, 3, P, 32, 0.4), { tone: "mid" }));
    out.push(D(k.corners({ x: x - 5, y: y - 5, w: 10, d: 10 }, 0).map(([px, py]) => at([px, py, 3])), { size: 0.4 }));
    out.push(S(k.cylinder(x, y, 3.2, 3, DIAL.z - 3, P, 20), { tone: "mid", crease: "none" }));
    out.push(S(k.cylinder(x, y, DIAL.r, DIAL.z, DIAL.h, P, 64, 0.8), { tone: "hi", crease: "lo", inner: L(k.sideArc(x, y, DIAL.r, DIAL_TOP - 3.4, P, 40), { tone: "faint" }) }));
    out.push(L(k.knurl(x, y, DIAL.r, DIAL_TOP - 3.4, DIAL_TOP, 84, P, 0.3), { tone: "lo" }));
    out.push(L(k.ring(x, y, DIAL.r - 2.2, DIAL_TOP, P, 64), { tone: "lo" }));
    const t = k.radialTicks(x, y, DIAL.r - 2.2, M.DIAL.max - M.DIAL.min, 5, DIAL_TOP, [1.1, 2.4], P, M.DIAL.from, M.DIAL.span);
    out.push(L(t.minor, { tone: "lo" }), L(t.major, { tone: "mid" }));
    // The agreed-price mark: a short lit tick at the final price.
    const a = M.dialAngle(FINAL.ask);
    const r0 = DIAL.r - 2.2;
    out.push(L(k.lineOnTop([x + Math.sin(a) * (r0 - 3.4), y - Math.cos(a) * (r0 - 3.4)], [x + Math.sin(a) * r0, y - Math.cos(a) * r0], DIAL_TOP, P), { tone: "lit" }));
    // Crown on the +x side and the engraved unit.
    out.push(S(k.slabOf({ x: x + DIAL.r - 1, y: y - 2.4, w: 5, d: 4.8, r: 1.2 }, DIAL.z + 2, 5, P, 3), { tone: "mid" }));
    out.push(S(k.slabOf({ x: x + DIAL.r + 3.6, y: y - 3.2, w: 2.6, d: 6.4, r: 1.2 }, DIAL.z + 1.2, 6.6, P, 3), { tone: "mid" }));
    out.push(k.faceTextSvg(k.topMatrix([x, y + 6.5], DIAL_TOP, P, "x"), "₹ / kg", { size: 2.6, tone: "lo", anchor: "middle" }));
    return out.join("");
  }
  const needleAt = (price) => {
    const a = M.dialAngle(price);
    const [x, y] = DIAL_AT;
    return k.lineOnTop([x - Math.sin(a) * 3.2, y + Math.cos(a) * 3.2], [x + Math.sin(a) * (DIAL.r - 4), y - Math.cos(a) * (DIAL.r - 4)], DIAL_TOP + 0.2, P);
  };
  const dialHub = () => L(k.ring(DIAL_AT[0], DIAL_AT[1], 1.5, DIAL_TOP + 0.2, P, 16), { tone: "mid" }) + D([at([DIAL_AT[0], DIAL_AT[1], DIAL_TOP + 0.2])], { size: 0.55, tone: "hi" });

  // ---------------------------------------------------------------- pillar ----
  function pillarLow() {
    const out = [];
    out.push(S(k.cylinder(0, 0, 15, 0, 3, P, 48, 0.6), { tone: "lo" }));
    out.push(D([0, 90, 180, 270].map((d) => at([Math.cos(rad(d + 45)) * 12, Math.sin(rad(d + 45)) * 12, 3])), { size: 0.45 }));
    out.push(S(k.cylinder(0, 0, 10.5, 3, 5, P, 40, 0.5), { tone: "mid" }));
    out.push(S(k.cylinder(0, 0, 5, 8, 88, P, 28), { tone: "mid", crease: "none", inner: L([40, 70].map((z) => k.sideArc(0, 0, 5, z, P, 16)).join(""), { tone: "faint" }) }));
    // Height clamp with a thumb screw toward the viewer.
    out.push(S(k.cylinder(0, 0, 7.5, 96, 7, P, 32, 0.4), { tone: "mid" }));
    const ty = 7.5;
    out.push(S(k.slabOf({ x: -1.4, y: ty - 0.6, w: 2.8, d: 3.4, r: 0.8 }, 97.5, 4, P, 2), { tone: "mid", crease: "none" }));
    out.push(S(k.cylinder(0, ty + 4.2, 2.6, 96.5, 6, P, 20), { tone: "mid" }));
    out.push(L(k.knurl(0, ty + 4.2, 2.6, 96.5, 102.5, 18, P), { tone: "lo" }));
    out.push(S(k.cylinder(0, 0, 5, 103, 45, P, 28), { tone: "mid", crease: "none", inner: L(k.sideArc(0, 0, 5, 128, P, 16), { tone: "faint" }) }));
    out.push(S(k.slabOf({ x: -8, y: -8, w: 16, d: 16, r: 2 }, 148, 8, P, 3, 0.5), { tone: "mid" }));
    out.push(D([at([-5, -5, 156]), at([5, -5, 156]), at([-5, 5, 156]), at([5, 5, 156])], { size: 0.4 }));
    return out.join("");
  }

  function pillarBack() {
    const out = [];
    const backCheek = { x: -6, y: -7, w: 12, d: 3, r: 0.8 };
    out.push(S(k.slabOf(backCheek, 156, 26, P, 2, 0.3), { tone: "mid" }));
    // Stem from the back cheek up to the pointer scale.
    const plateLow = PIVOT[2] + ARC.r0 * Math.cos(rad(ARC.half));
    out.push(S(k.slabOf({ x: -2, y: -6.5, w: 4, d: 2, r: 0.5 }, 182, plateLow - 182, P, 2), { tone: "mid", crease: "none" }));
    // The pointer scale: a fan-shaped plate behind the pointer, ticks hanging from its arc.
    const F = alongY([PIVOT[0], -6.5, PIVOT[2]]);
    const fan = [];
    for (let d = -ARC.half; d <= ARC.half + 1e-9; d += 2) fan.push([ARC.r1 * Math.sin(rad(d)), ARC.r1 * Math.cos(rad(d))]);
    fan.push([ARC.r0 * Math.sin(rad(ARC.half)), ARC.r0 * Math.cos(rad(ARC.half))], [-ARC.r0 * Math.sin(rad(ARC.half)), ARC.r0 * Math.cos(rad(ARC.half))]);
    out.push(S(G.prismOf(F, fan, 0, 2, P), { tone: "hi", crease: "lo" }));
    const face = -4.5;
    const tick = (deg, len) => k.segment(
      [ARC.r1 * Math.sin(rad(deg)), face, PIVOT[2] + ARC.r1 * Math.cos(rad(deg))],
      [(ARC.r1 - len) * Math.sin(rad(deg)), face, PIVOT[2] + (ARC.r1 - len) * Math.cos(rad(deg))], P);
    const minor = [];
    const major = [];
    for (let d = -10; d <= 10; d += 2) (d % 10 === 0 && d !== 0 ? major : d === 0 ? [] : minor).push(tick(d, d % 10 === 0 ? 3.2 : 2));
    out.push(L(minor.join(""), { tone: "lo" }), L(major.join(""), { tone: "mid" }), L(tick(0, 3.4), { tone: "hi" }));
    out.push(D([at([-ARC.r0 * Math.sin(rad(ARC.half)) * 0.55, face, PIVOT[2] + ARC.r0 + 2.4]), at([ARC.r0 * Math.sin(rad(ARC.half)) * 0.55, face, PIVOT[2] + ARC.r0 + 2.4])], { size: 0.4 }));
    return out.join("");
  }

  // The beam with its hub, end bosses and pointer: drawn level, turned live about the pivot.
  function beam() {
    const F = alongY(PIVOT);
    const outline = [[-ARM - 4, -1.6], [-ARM - 4, 2], [-10, 4.6], [10, 4.6], [ARM + 4, 2], [ARM + 4, -1.6], [10, -4.2], [-10, -4.2]];
    const out = [];
    out.push(S(G.prismOf(F, outline, -2.4, 2.4, P), { tone: "hi", crease: "lo" }));
    // Brass inlay line along the beam's front face.
    out.push(L(k.segment([-ARM + 2, 2.4, PIVOT[2] + 0.2], [ARM - 2, 2.4, PIVOT[2] + 0.2], P), { tone: "faint" }));
    for (const x of [-ARM, ARM]) {
      const B = alongY([x, 0, PIVOT[2]]);
      out.push(S(G.disc(-3, 3, BOSS_R, B, P), { tone: "mid" }));
      out.push(L(G.circleOf(B, 3, 1.2, P), { tone: "lo" }));
    }
    out.push(S(G.disc(-3.4, 3.4, 6.5, F, P), { tone: "mid" }));
    out.push(S(G.prismOf(alongY(PIVOT), [[-1.3, POINTER.r0], [1.3, POINTER.r0], [0.45, POINTER.r1], [-0.45, POINTER.r1]], -0.8, 0.8, P), { tone: "hi", lit: true }));
    out.push(L(G.circleOf(F, 3.4, 3.6, P), { tone: "faint" }));
    return out.join("");
  }

  function pillarFront() {
    const out = [];
    out.push(S(k.slabOf({ x: -6, y: 4, w: 12, d: 3, r: 0.8 }, 156, 20, P, 2, 0.3), { tone: "mid" }));
    const pin = alongY([PIVOT[0], 0, PIVOT[2]]);
    out.push(S(G.disc(7, 8.2, 2.2, pin, P), { tone: "mid" }));
    out.push(D([at([0, 8.2, PIVOT[2]])], { size: 0.5, tone: "hi" }));
    out.push(D([at([-4, 7, 160]), at([4, 7, 160])], { size: 0.4 }));
    return out.join("");
  }

  // ---------------------------------------------------------------- pans ----
  // Built hanging level at x = side * ARM; the live code moves the whole group with the beam end.
  function pan(side, kind, count, shown) {
    const x = side * ARM;
    const lit = kind === "offer";
    const rim = (deg) => [x + PAN_R * 0.96 * Math.cos(rad(deg)), PAN_R * 0.96 * Math.sin(rad(deg)), PAN_TOP];
    const knot = [x, 0, KNOT_Z];
    const strings = STRING_ANGLES.map((deg) => ({ deg, front: k.depthOf([Math.cos(rad(deg)), Math.sin(rad(deg)), 0], P) > 0 }));
    const line = (deg) => k.segment(knot, rim(deg), P);
    const out = [];
    const R = alongY([x, 0, RING_Z]);
    out.push(S(G.ringBand(-0.7, 0.7, RING.inner, RING.r, R, P), { tone: "mid" }));
    out.push(L(strings.filter((s) => !s.front).map((s) => line(s.deg)).join(""), { tone: "mid" }));
    out.push(S(k.cylinder(x, 0, 21, PAN_TOP - 6, 3, P, 56), { tone: "lo" }));
    out.push(S(k.cylinder(x, 0, PAN_R, PAN_TOP - 3, 3, P, 72, 0.6), { tone: "mid", inner: L(k.sideArc(x, 0, PAN_R, PAN_TOP - 1.5, P, 48), { tone: "faint" }) }));
    out.push(L(k.ring(x, 0, PAN_R - 4, PAN_TOP, P, 64), { tone: "faint" }));
    out.push(D(STRING_ANGLES.map((deg) => at(rim(deg))), { size: 0.7, tone: "hi" }));
    const slots = [];
    for (let i = 0; i < count; i++) {
      const z = PAN_TOP + i * DISC.h;
      slots.push(`<g data-disc="${i}"${i < shown ? "" : ' opacity="0"'}>${S(k.cylinder(x, 0, DISC.r, z, DISC.h, P, 48, 0.3), { tone: lit ? "hi" : "mid", lit })}${L(k.ring(x, 0, 3.2, z + DISC.h, P, 24), { tone: "faint" })}</g>`);
    }
    out.push(`<g data-part="stack-${kind}">${slots.join("")}</g>`);
    out.push(L(strings.filter((s) => s.front).map((s) => line(s.deg)).join(""), { tone: "mid" }));
    out.push(D([at(knot)], { size: 0.8, tone: "mid" }));
    return `<g data-part="pan-${kind}">${out.join("")}</g>`;
  }

  // ---------------------------------------------------------------- assemble ----
  const askSlots = M.MAX_DISCS.ask;
  const offerSlots = M.MAX_DISCS.offer;
  const svg = svgOf({
    width: WIDTH,
    height: HEIGHT,
    className: "fig-balance",
    label: "A shop's beam balance on a bench plate. The left pan holds the seller's ask and the right pan Sahay's offer, as stacked five-rupee weights. The heavier side goes down; when the two are equal the beam hangs level and the dial reads the agreed price, 55 rupees a kilo in this example.",
    body: [
      base(),
      pan(-1, "ask", askSlots, M.discsFor(FINAL.ask)),
      dialStatic(),
      `<path data-part="needle" class="iso-line" data-tone="lit" data-free="start" style="stroke-width:1.2" d="${needleAt(FINAL.ask)}"/>`,
      dialHub(),
      pillarLow(),
      pillarBack(),
      `<g data-part="beam">${beam()}</g>`,
      pillarFront(),
      pan(1, "offer", offerSlots, M.discsFor(FINAL.offer)),
    ],
  });
  writeOut("balance/balance.svg", svg);

  // The still pose is the agreed state: hide the slots the final round does not use.
  geoModule("balance/geo.js", {
    P,
    pivot: PIVOT,
    arm: ARM,
    dial: { at: DIAL_AT, r: DIAL.r, top: DIAL_TOP },
    disc: DISC,
    slots: { ask: askSlots, offer: offerSlots },
    viewBox: [WIDTH, HEIGHT],
  });
}
