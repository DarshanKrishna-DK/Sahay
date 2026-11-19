// Fig 2, "Your yes": a bench receipt printer beside a rubber stamp on a spring carriage.
// The printer's feed is braked: a solenoid plunger rests on the platen wheel on its side. The
// stamp rides a column on two return springs; only when its die lands on the YES plate does the
// plate's switch (wired by the cable on the bench) lift the brake, and one invoice feeds out
// through the tear bar while the counter dial steps by one. A dip that stops short prints nothing.
// Writes public/figures/printer/printer.svg (still pose: one invoice out, stamp lifted) and geo.js.
// `node scripts/figures/build.mjs printer --audit` also proves the geometry with the anatomy
// skill's audit (kit/audit.mjs from the skill folder; set ANATOMY_DIR if it lives elsewhere).
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as k from "../kit/iso-kit.mjs";
import * as G from "../kit/lathe.mjs";
import { tubePieces, tubeSvg } from "./tube.mjs";
import { coilZ, geoModule, importBrowserModule, svgOf, writeOut } from "../common.mjs";


export async function build() {
  const M = await importBrowserModule("printer/model.js");
  const A = await loadAudit();

  const WIDTH = 600;
  const HEIGHT = 440;
  const AZIMUTH = 34;

  // ---- world plan (units of about 1 px, z up; the viewer stands at +x +y) ----
  const PLATE = { x: -52, y: -126, w: 104, d: 232, r: 8 };
  const PLATE_H = 10;
  const FOOT_H = 5;

  // Printer: body and lid, front face at x = 22, side face toward the stamp at y = -20.
  const PH = { x: -40, y: -116, w: 62, d: 96, r: 5 };
  const BODY_TOP = 38;
  const TOP = 42;
  const FRONT_X = PH.x + PH.w;
  const SIDE_Y = PH.y + PH.d;
  const SLOT = { x: 11.4, y: -93, w: 3.4, d: 42, r: 1.2 };
  const RSLOT = { x: -8.8, y: -93, w: 3.2, d: 42, r: 1.2 };
  const PAPER = { x: 12.6, y: -91, w: 0.8, d: 38, r: 0 };
  const FACE_X = PAPER.x + PAPER.w;
  const TEARBAR = { x: 15.2, y: -95, w: 2.6, d: 46, r: 0.8 };
  const ROLL = { x: -20, z: 58, r: 13, y0: -91, y1: -53, core: 4.6, bore: 2 };
  const WEB = { x: ROLL.x + ROLL.r, y: ROLL.y0, w: 0.6, d: ROLL.y1 - ROLL.y0, r: 0 };
  const ARM_FAR = { x: -26, y: -96, w: 12, d: 3, r: 1 };
  const ARM_NEAR = { x: -26, y: -51, w: 12, d: 3, r: 1 };
  const ARM_TOP = 62;
  const COUNTER = { x: 2, y: -34, r: 7, h: 3.5 };
  const COUNTER_TOP = TOP + COUNTER.h;
  const WHEEL = { o: [-6, SIDE_Y, 14], r: M.WHEEL_R, t: 3 };
  const SOL = { x: -10, y: SIDE_Y, w: 8, d: 6, r: 1 };
  const SOL_Z = [26, 34];
  const PLUNGER = { at: [-6, SIDE_Y + 1.5], r: 1.1, shoe: 1 };

  // Stamp tower.
  const TB = { x: -20, y: 40, w: 36, d: 42, r: 3 };
  const TB_H = 8;
  const ANVIL = { x: -5, y: 52, w: 18, d: 18, r: 1.5 };
  const ANVIL_TOP = TB_H + 2.5;
  const SPRINGS = [[-4, 48], [-4, 74]];
  const SEAT = { r: 3.4, h: 1.6 };
  const COIL_R = 2.8;
  const COLUMN = { x: -16, y: 47, w: 6, d: 28, r: 1 };
  const RAILS = [{ x: -10, y: 49, w: 1, d: 2.4, r: 0.3 }, { x: -10, y: 72.6, w: 1, d: 2.4, r: 0.3 }];
  const STOP = { x: -16, y: 47, w: 10, d: 28, r: 1.2 };
  const CAR = { x: -9, y: 44, w: 21, d: 34, r: 2 };
  const DIE_H = 3;
  const DIE_Z = ANVIL_TOP + M.STROKE;
  const MOUNT_Z = DIE_Z + DIE_H;
  const CAR_Z = 44;
  const CAR_TOP = 52;
  const STOP_TOP = 57;
  const MOUNT = { x: -4, y: 53, w: 16, d: 16, r: 1.5 };
  const DIE = { x: -3.5, y: 53.5, w: 15, d: 15, r: 1 };
  const KNOB = { x: 4, y: 61, r: 6.5, stem: 2 };
  const LABEL = { x: 18, y: 86, w: 20, d: 14, r: 1.5 };

  const STILL = M.still(1);
  const PAPER_STILL = TOP + M.LIP + M.FEED;

  const P = k.fitProjection(
    [
      ...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0),
      [FACE_X, PAPER.y, PAPER_STILL + 2], [FACE_X, PAPER.y + PAPER.d, PAPER_STILL + 2],
      [KNOB.x, KNOB.y, CAR_TOP + 9], [ROLL.x, ROLL.y1, ROLL.z + ROLL.r],
    ],
    WIDTH, HEIGHT, { pad: 22, azimuth: AZIMUTH },
  );
  const KS = G.scaleOf(P);
  const at = (p) => k.iso(p, P);
  const S = (paths, style) => k.solidSvg(paths, style);
  const L = (d, style) => k.lineSvg(d, style);
  const D = (pts, style) => k.dotsSvg(pts, style);
  const depth2 = ([x, y]) => k.depthOf([x, y, 0], P);
  const byDepth = (pts) => [...pts].sort((a, b) => depth2(a) - depth2(b));
  const alongY = (o) => G.frameOf(o, [0, 1, 0], [1, 0, 0], [0, 0, 1]);    // u = x, v = z
  const alongX = (o) => G.frameOf(o, [1, 0, 0], [0, -1, 0], [0, 0, 1]);   // u = -y, v = z
  const STAMP_MOVE = [0, 0, -M.STROKE];
  const BRAKE_MOVE = [0, 0, M.BRAKE_LIFT];

  // ---- items: every drawn part is recorded with its true shape, then depth-settled ----
  const R = A ? A.recorder(P, { order: ["stamp", "brake"], spring: { stagger: 0.035, stiffness: M.SPRING.stiffness, damping: M.SPRING.damping, substeps: 4 } }) : fakeRecorder(P);
  const rec = (shape) => R.solid(shape);
  const put = (name, ref, svg, shapes, { piece = "", move, bias = 0 } = {}) =>
    R.put({ name, at: ref, bias, svg, shapes, piece, ...(move ? { move } : {}) });
  const slabItem = (name, plan, z, h, style = {}, { steps = 4, bevel = 0, extra = "", inner = "", owner, piece, move, bias } = {}) => {
    const shape = rec(A_slab(plan, z, h, { name, owner }, steps));
    put(name, [plan.x + plan.w / 2, plan.y + plan.d / 2, z + h / 2], S(k.slabOf(plan, z, h, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [shape], { piece, move, bias });
    return shape;
  };
  const cylItem = (name, cx, cy, r, z, h, style = {}, { steps = 32, bevel = 0, extra = "", inner = "", owner, piece, move, bias } = {}) => {
    const shape = rec(A_cyl(cx, cy, r, z, h, { name, owner }));
    put(name, [cx, cy, z + h / 2], S(k.cylinder(cx, cy, r, z, h, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [shape], { piece, move, bias });
    return shape;
  };
  const discItem = (name, F, s0, s1, r, style = {}, { extra = "", inner = "", owner, piece, move, bias, bevel = 0 } = {}) => {
    const shape = rec(A_disc(F, s0, s1, r, { name, owner }));
    put(name, G.add3(F.o, G.mul3(F.a, (s0 + s1) / 2)), S(G.disc(s0, s1, r, F, P, { bevel }), { tone: "mid", ...style, inner }) + extra, [shape], { piece, move, bias });
    return shape;
  };
  function A_slab(plan, z, h, meta, steps) { return A ? A.slab(plan, z, h, meta, steps) : { meta }; }
  function A_cyl(cx, cy, r, z, h, meta) { return A ? A.cylinder(cx, cy, r, z, h, meta) : { meta }; }
  function A_disc(F, s0, s1, r, meta) { return A ? A.disc(F, s0, s1, r, meta) : { meta }; }
  function A_ring(F, s0, s1, rIn, rOut, meta) { return A ? A.ring(F, s0, s1, rIn, rOut, meta) : { meta }; }

  // ---------------------------------------------------------------- base plate (not sorted) ----
  const back = [];
  back.push(`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`);
  for (const [x, y] of byDepth(k.corners(PLATE, 20))) {
    back.push(S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
    back.push(S(k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
  }
  back.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: "mid", inner: L(k.sideSeam(PLATE, -PLATE_H + 3, P, 8), { tone: "faint" }) }));
  back.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
  const plateScrews = k.corners(PLATE, 10);
  back.push(L(plateScrews.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
  back.push(D(plateScrews.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
  if (A) rec(A.slab(PLATE, -PLATE_H, PLATE_H, { name: "stand.plate", ground: true }, 8));
  // Soft shadows where the printer and the tower stand.
  back.push(`<path class="iso-halo" style="opacity:calc(var(--anatomy-halo-opacity) * .5)" d="${k.haloOf(k.insetPlan(PH, 2), 0, 0.1, P)}"/>`);
  back.push(`<path class="iso-halo" style="opacity:calc(var(--anatomy-halo-opacity) * .5)" d="${k.haloOf(k.insetPlan(TB, 2), 0, 0.1, P)}"/>`);
  // Ruler strip along the front edge, ticks rooted on its back edge.
  const STRIP = { x: 42, y: -110, w: 6, d: 200, r: 1 };
  back.push(S(k.slabOf(STRIP, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(STRIP.y + 4, STRIP.y + STRIP.d - 4, 4, 5, STRIP.x, 0.6, [1.8, 3.4], P, "y");
  back.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  back.push(D([at([STRIP.x + 4.5, STRIP.y + 2, 0.6]), at([STRIP.x + 4.5, STRIP.y + STRIP.d - 2, 0.6])], { size: 0.45 }));
  // Maker's plate: three printed rule lines and two screws.
  back.push(S(k.slabOf(LABEL, 0, 0.8, P, 4), { tone: "lo" }));
  back.push(L(k.planOutline(k.insetPlan(LABEL, 1.6), 0.8, P), { tone: "faint" }));
  back.push(L([0, 1, 2].map((i) => k.lineOnTop([LABEL.x + 5 + i * 3.8, LABEL.y + LABEL.d - 4.5], [LABEL.x + 5 + i * 3.8, LABEL.y + LABEL.d - 4.5 - [8, 6, 7][i]], 0.8, P)).join(""), { tone: "lo", free: true }));
  back.push(D([at([LABEL.x + LABEL.w - 3.5, LABEL.y + 3.5, 0.8]), at([LABEL.x + 3.5, LABEL.y + 3.5, 0.8])], { size: 0.45 }));

  // ---------------------------------------------------------------- printer ----
  slabItem("printer.body", PH, 0, BODY_TOP, {}, { steps: 6, inner: L(k.sideSeam(PH, 5, P, 6), { tone: "faint" }), extra: frontFace() + sideFace() });
  const LID = k.insetPlan(PH, 0.8);
  slabItem("printer.lid", LID, BODY_TOP, TOP - BODY_TOP, {}, { steps: 6, bevel: 0.8, extra: lidTop() });

  function frontFace() {
    // Vents: five closed slots on the front face, a seam band, and four corner screws.
    const out = [];
    const m = k.sideMatrix([FRONT_X, -90], 30, P, "right");
    const slots = Array.from({ length: 5 }, (_, i) => roundRect(i * 4.4, 0, 2.2, 16, 1.1)).join("");
    out.push(`<path class="iso-line" data-tone="lo" transform="${m}" d="${slots}"/>`);
    const screws = [[PH.y + 4.5, 33], [SIDE_Y - 4.5, 33], [PH.y + 4.5, 9], [SIDE_Y - 4.5, 9]];
    out.push(D(screws.map(([y, z]) => at([FRONT_X, y, z])), { size: 0.45 }));
    return out.join("");
  }
  function sideFace() {
    const m = k.sideMatrix([PH.x + 8, SIDE_Y], 32, P, "left");
    return `<path class="iso-line" data-tone="faint" transform="${m}" d="${roundRect(0, 0, 14, 20, 1.6)}"/>` + D([at([PH.x + 4, SIDE_Y, 34]), at([PH.x + 4, SIDE_Y, 9])], { size: 0.4 });
  }
  function roundRect(x, y, w, h, r) {
    return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
  }
  function lidTop() {
    const out = [];
    for (const slot of [RSLOT, SLOT]) {
      out.push(`<path class="iso-shade" data-shade="0" d="${k.planOutline(slot, TOP, P, 4)}"/>`);
      out.push(L(k.planOutline(slot, TOP, P, 4), { tone: "lo" }));
    }
    out.push(L(k.planOutline(k.insetPlan(LID, 4), TOP, P, 6), { tone: "faint" }));
    const screws = k.corners(LID, 2.6);
    out.push(D(screws.map(([x, y]) => at([x, y, TOP])), { size: 0.45 }));
    return out.join("");
  }

  // Tear bar in front of the slot, its serrated edge a zigzag along its front top edge.
  {
    const zig = [];
    const n = 24;
    for (let i = 0; i <= n; i++) zig.push(at([TEARBAR.x + TEARBAR.w, TEARBAR.y + 0.8 + (i / n) * (TEARBAR.d - 1.6), TOP + (i % 2 ? 1.0 : 1.6)]));
    slabItem("printer.tearbar", TEARBAR, TOP, 1.6, {}, { steps: 3, extra: L(k.pathOf(zig), { tone: "lo" }) + D([at([TEARBAR.x + 1.3, TEARBAR.y + 2, TOP + 1.6]), at([TEARBAR.x + 1.3, TEARBAR.y + TEARBAR.d - 2, TOP + 1.6])], { size: 0.4 }) });
  }

  // The paper: rebuilt each frame from the slot up; the print rises with it, clipped at the slot.
  const PRINT_ROWS = printRows();
  function printRows() {
    // [depth below the paper's top edge, y from, y to, tone]: rule lines that stand for print.
    const y0 = PAPER.y + PAPER.d - 3;   // left margin (screen left is +y on this face)
    const y1 = PAPER.y + 3;             // right margin
    const rows = [
      [6, y0 - 9, y0 - 23, "hi"], [8.6, y0 - 12, y0 - 20, "lo"],
      [12, y0, y1, "faint"],
      [15, y0, y0 - 17, "lo"], [15, y1 + 6, y1, "lo"],
      [18, y0, y0 - 12, "lo"], [18, y1 + 7, y1, "lo"],
      [21, y0, y0 - 19, "lo"], [21, y1 + 5, y1, "lo"],
      [24, y0, y0 - 10, "lo"], [24, y1 + 6, y1, "lo"],
      [27.5, y0, y1, "faint"],
      [31, y0, y0 - 11, "hi"], [31, y1 + 9, y1, "hi"],
      [34.5, y0, y0 - 14, "lo"], [34.5, y1 + 5, y1, "lo"],
      [40, y0 - 8, y0 - 24, "faint"], [42.4, y0 - 12, y0 - 20, "faint"],
    ];
    return rows;
  }
  function paperSvg() {
    const paths = k.slabOf(PAPER, TOP, M.LIP + M.FEED, P, 2);
    // Paper is the brightest thing on the bench: its faces take the top tone, not the side shades.
    const shades = paths.shades.map((d, i) => `<path class="iso-top" data-paper="shade${i}" d="${d}"/>`).join("");
    const solid = `<g class="iso-solid"><path class="iso-fill" data-paper="fill" d="${paths.fill}"/>${shades}<path class="iso-top" data-paper="top" d="${paths.top}"/><path class="iso-line iso-crease" data-tone="lo" data-paper="crease" d="${paths.crease}"/><path class="iso-line iso-edge" data-tone="hi" data-paper="outline" d="${paths.outline}"/></g>`;
    const lines = PRINT_ROWS.map(([dz, ya, yb, tone]) => L(k.segment([FACE_X, ya, TOP + M.LIP - dz], [FACE_X, yb, TOP + M.LIP - dz], P), { tone, free: true })).join("");
    const clip = [[FACE_X, PAPER.y, TOP], [FACE_X, PAPER.y + PAPER.d, TOP], [FACE_X, PAPER.y + PAPER.d, TOP + 140], [FACE_X, PAPER.y, TOP + 140]].map(at);
    const move = k.translateAlong(P, [0, 0, M.FEED]);
    return `<g data-part="paper">${solid}<clipPath id="pr-print"><path d="${k.pathOf(clip, true)}"/></clipPath><g clip-path="url(#pr-print)"><g data-part="print" transform="${move}">${lines}</g></g></g>`;
  }
  put("paper", [FACE_X - 0.4, PAPER.y + PAPER.d / 2, TOP + 20], paperSvg(), [rec(A_slab(PAPER, TOP, M.LIP + M.FEED, { name: "paper" }, 2))], { bias: 0.2 });

  // Paper roll in an open cradle behind the slot, and the web from the roll into the rear slot.
  const RF = alongY([ROLL.x, ROLL.y0, ROLL.z]);
  for (const [name, plan] of [["cradle.far", ARM_FAR], ["cradle.near", ARM_NEAR]]) {
    slabItem(name, plan, TOP, ARM_TOP - TOP, {}, { steps: 4, bevel: 0.4, owner: "cradle", extra: name === "cradle.near" ? D([at([plan.x + 2.4, plan.y + plan.d, TOP + 3]), at([plan.x + plan.w - 2.4, plan.y + plan.d, TOP + 3])], { size: 0.4 }) : "" });
  }
  {
    const s1 = ROLL.y1 - ROLL.y0;
    const shape = rec(A_ring(RF, 0, s1, ROLL.core, ROLL.r, { name: "roll", owner: "cradle" }));
    const layers = [7.2, 9.6, 11.6].map((r) => G.circleOf(RF, s1, r, P)).join("");
    put("roll", [ROLL.x, (ROLL.y0 + ROLL.y1) / 2, ROLL.z], S(G.ringBand(0, s1, ROLL.core, ROLL.r, RF, P), { tone: "mid" }) + L(layers, { tone: "faint" }), [shape]);
    // The cardboard core shows only where it stands proud of the roll's near end.
    const core = rec(A_ring(RF, s1, s1 + 0.6, ROLL.bore, ROLL.core, { name: "roll.core", owner: "cradle" }));
    put("roll.core", [ROLL.x, ROLL.y1 + 0.3, ROLL.z], S(G.ringBand(s1, s1 + 0.6, ROLL.bore, ROLL.core, RF, P), { tone: "mid" }), [core]);
    const SF = alongY([ROLL.x, 0, ROLL.z]);
    discItem("spindle.gap", SF, ROLL.y1 + 0.6, ARM_NEAR.y, ROLL.bore, {}, { owner: "cradle" });
    discItem("spindle.stub", SF, ARM_NEAR.y + ARM_NEAR.d, ARM_NEAR.y + ARM_NEAR.d + 2, ROLL.bore, {}, { owner: "cradle" });
    const knobF = alongY([ROLL.x, ARM_NEAR.y + ARM_NEAR.d + 2, ROLL.z]);
    const ribs = G.ribsOf(knobF, 0, 4.4, 4.2, 28, P, { fade: [0.1, 0.55], seams: true });
    discItem("spindle.knob", knobF, 0, 4.4, 4.2, {}, { owner: "cradle", bevel: 0.3, extra: k.fadedSvg(ribs, { tone: "lo" }) });
    slabItem("web", WEB, TOP, ROLL.z - TOP, { tone: "mid" }, { steps: 2 });
  }

  // Counter dial on the lid: one division per invoice issued.
  cylItem("counter", COUNTER.x, COUNTER.y, COUNTER.r, TOP, COUNTER.h, { tone: "hi", crease: "lo" }, {
    steps: 56, bevel: 0.6,
    extra: (() => {
      const t = k.radialTicks(COUNTER.x, COUNTER.y, COUNTER.r - 1.4, M.COUNTER_STEPS, 5, COUNTER_TOP, [1.0, 2.0], P);
      return L(k.ring(COUNTER.x, COUNTER.y, COUNTER.r - 1.4, COUNTER_TOP, P, 56), { tone: "lo" }) + L(t.minor, { tone: "lo" }) + L(t.major, { tone: "mid" })
        + `<path data-part="needle" class="iso-line" data-tone="hi" data-free="start" style="stroke-width:1.1" d="${counterNeedle(M.counterAngle(STILL.count))}"/>`
        + L(k.ring(COUNTER.x, COUNTER.y, 1.2, COUNTER_TOP, P, 16), { tone: "mid" });
    })(),
  });
  function counterNeedle(a) {
    const { x, y } = COUNTER;
    return k.lineOnTop([x - Math.sin(a) * 1.2, y + Math.cos(a) * 1.2], [x + Math.sin(a) * (COUNTER.r - 2.6), y - Math.cos(a) * (COUNTER.r - 2.6)], COUNTER_TOP, P);
  }

  // Front face: feed button and ready lamp.
  discItem("printer.button", alongX([FRONT_X, -36, 24]), 0, 1.6, 3.2, {}, { bevel: 0.3, extra: L(G.circleOf(alongX([FRONT_X, -36, 24]), 1.6, 2, P), { tone: "faint" }) });
  discItem("printer.lamp", alongX([FRONT_X, -27, 24]), 0, 0.8, 1.3, { tone: "hi" });

  // Side face: the platen wheel the brake holds, the solenoid and its plunger.
  const WF = alongY(WHEEL.o);
  {
    const ribs = G.ribsOf(WF, 0, WHEEL.t, WHEEL.r, 40, P, { fade: [0.1, 0.55], seams: true });
    discItem("wheel", WF, 0, WHEEL.t, WHEEL.r, {}, { bevel: 0.4, extra: k.fadedSvg(ribs, { tone: "lo" }) + L(G.circleOf(WF, WHEEL.t, WHEEL.r - 1.6, P), { tone: "faint" }) + `<path data-part="wheel-mark" class="iso-line" data-tone="hi" data-free="end" d="${wheelMark(M.wheelAngle(STILL))}"/>` });
    discItem("wheel.hub", WF, WHEEL.t, WHEEL.t + 1.4, 2.6, {}, { bevel: 0.2, extra: D([at(G.pointOf(WF, WHEEL.t + 1.4, 0, 0))], { size: 0.5, tone: "hi" }) });
  }
  function wheelMark(angle) {
    const a = at(G.pointOf(WF, WHEEL.t, 2.6, angle));
    const b = at(G.pointOf(WF, WHEEL.t, WHEEL.r - 1.6, angle));
    return k.pathOf([a, b]);
  }
  slabItem("solenoid", SOL, SOL_Z[0], SOL_Z[1] - SOL_Z[0], {}, {
    steps: 3, bevel: 0.4,
    inner: L(k.sideSeam(SOL, SOL_Z[0] + 2.4, P, 3), { tone: "faint" }),
    extra: D([at([SOL.x + 1.6, SOL.y + SOL.d / 2, SOL_Z[1]]), at([SOL.x + SOL.w - 1.6, SOL.y + SOL.d / 2, SOL_Z[1]])], { size: 0.4 }),
  });
  const BOSS_F = alongY([PLUNGER.at[0], SOL.y + SOL.d, 30]);
  discItem("solenoid.boss", BOSS_F, 0, 1.6, 1.8, {}, { bevel: 0.2 });
  {
    const F = G.frameAlong([PLUNGER.at[0], PLUNGER.at[1], SOL_Z[0]], [0, 0, -1]);
    const reach = SOL_Z[0] - (WHEEL.o[2] + WHEEL.r + PLUNGER.shoe);
    const rod = G.rodOut(F, 0, reach, PLUNGER.r, P, { stroke: M.BRAKE_LIFT });
    const svg = `<clipPath id="pr-rod"><path d="${rod.clip}"/></clipPath><g clip-path="url(#pr-rod)"><g data-move="brake">${S(rod.paths, { tone: "mid", crease: "none" })}</g></g>`;
    put("plunger", [PLUNGER.at[0], PLUNGER.at[1], SOL_Z[0] - reach / 2], svg, [A ? A.slide(F, 0, reach, PLUNGER.r, { name: "plunger" }) : { meta: {} }], { piece: "brake", move: BRAKE_MOVE });
    const SHOE = { x: PLUNGER.at[0] - 2, y: PLUNGER.at[1] - 1.2, w: 4, d: 2.4, r: 0.5 };
    const z0 = WHEEL.o[2] + WHEEL.r;
    slabItem("plunger.shoe", SHOE, z0, PLUNGER.shoe, {}, { steps: 2, piece: "brake", move: BRAKE_MOVE, extra: "" });
  }

  // ---------------------------------------------------------------- stamp tower ----
  slabItem("tower.base", TB, 0, TB_H, {}, {
    steps: 5, bevel: 0.6,
    inner: L(k.sideSeam(TB, 3, P, 5), { tone: "faint" }),
    extra: D(k.corners(TB, 3.4).map(([x, y]) => at([x, y, TB_H])), { size: 0.45 }),
  });
  slabItem("anvil", ANVIL, TB_H, ANVIL_TOP - TB_H, { tone: "hi", crease: "lo" }, {
    steps: 4, bevel: 0.4,
    extra: L(k.planOutline(k.insetPlan(ANVIL, 1.6), ANVIL_TOP, P, 4), { tone: "faint" })
      + k.faceTextSvg(k.topMatrix([ANVIL.x + ANVIL.w / 2 + 2.6, ANVIL.y + ANVIL.d / 2], ANVIL_TOP, P, "y"), "YES", { size: 6.4, tone: "lo", anchor: "middle" }),
  });
  SPRINGS.forEach(([x, y], i) => {
    const name = `spring.${i ? "b" : "a"}`;
    const seat = rec(A_cyl(x, y, SEAT.r, TB_H, SEAT.h, { name: `${name}.seat` }));
    put(`${name}.seat`, [x, y, TB_H + SEAT.h / 2], S(k.cylinder(x, y, SEAT.r, TB_H, SEAT.h, P, 24, 0.3), { tone: "mid" }) + L(k.ring(x, y, COIL_R, TB_H + SEAT.h, P, 24), { tone: "faint" }), [seat]);
    const c = coilZ(k, x, y, TB_H + SEAT.h, CAR_Z, COIL_R, 7, P);
    const F = G.frameAlong([x, y, TB_H + SEAT.h], [0, 0, 1]);
    const coil = A ? A.slide(F, 0, CAR_Z - TB_H - SEAT.h, COIL_R, { name }) : { meta: {} };
    put(name, [x, y, (TB_H + CAR_Z) / 2], `<path class="iso-line" data-tone="lo" data-coil="${i}" data-half="back" d="${c.back}"/><path class="iso-line" data-tone="mid" data-coil="${i}" data-half="front" d="${c.front}"/>`, [coil], { piece: "stamp", move: STAMP_MOVE });
  });
  slabItem("column", COLUMN, TB_H, CAR_TOP - TB_H, {}, { steps: 3, bevel: 0.4, inner: L(k.sideSeam(COLUMN, 20, P, 3), { tone: "faint" }) });
  RAILS.forEach((plan, i) => slabItem(`rail.${i}`, plan, TB_H, CAR_TOP - TB_H, {}, { steps: 2 }));
  slabItem("stop", STOP, CAR_TOP, STOP_TOP - CAR_TOP, {}, { steps: 3, bevel: 0.5, extra: D([at([STOP.x + 3, STOP.y + 4, STOP_TOP]), at([STOP.x + 3, STOP.y + STOP.d - 4, STOP_TOP])], { size: 0.45 }) });

  // The stamp: carriage, mount and rubber die, stem and knurled knob. All move together.
  const stampOpts = { piece: "stamp", move: STAMP_MOVE };
  const wrapMove = (svg) => `<g data-move="stamp">${svg}</g>`;
  {
    const plan = CAR;
    const shape = rec(A_slab(plan, CAR_Z, CAR_TOP - CAR_Z, { name: "carriage" }, 4));
    const svg = S(k.slabOf(plan, CAR_Z, CAR_TOP - CAR_Z, P, 4, 0.6), { tone: "mid", inner: L(k.sideSeam(plan, CAR_Z + 4, P, 4), { tone: "faint" }) })
      + D([[CAR.x + CAR.w - 2.4, CAR.y + 3], [CAR.x + CAR.w - 2.4, CAR.y + CAR.d - 3], [CAR.x + 7.5, CAR.y + 3], [CAR.x + 7.5, CAR.y + CAR.d - 3]].map(([x, y]) => at([x, y, CAR_TOP])), { size: 0.45 });
    put("carriage", [plan.x + plan.w / 2, plan.y + plan.d / 2, (CAR_Z + CAR_TOP) / 2], wrapMove(svg), [shape], stampOpts);
  }
  {
    const shape = rec(A_slab(MOUNT, MOUNT_Z, CAR_Z - MOUNT_Z, { name: "stamp.mount" }, 4));
    put("stamp.mount", [MOUNT.x + MOUNT.w / 2, MOUNT.y + MOUNT.d / 2, (MOUNT_Z + CAR_Z) / 2], wrapMove(S(k.slabOf(MOUNT, MOUNT_Z, CAR_Z - MOUNT_Z, P, 4, 0.5), { tone: "hi", lit: true, inner: L(k.sideSeam(MOUNT, MOUNT_Z + 2, P, 4), { tone: "lo" }) })), [shape], stampOpts);
    const die = rec(A_slab(DIE, DIE_Z, DIE_H, { name: "stamp.die" }, 4));
    put("stamp.die", [DIE.x + DIE.w / 2, DIE.y + DIE.d / 2, DIE_Z + DIE_H / 2], wrapMove(S(k.slabOf(DIE, DIE_Z, DIE_H, P, 4), { tone: "hi", lit: true })), [die], stampOpts);
    const stem = rec(A_cyl(KNOB.x, KNOB.y, KNOB.stem, CAR_TOP, 3, { name: "stamp.stem" }));
    put("stamp.stem", [KNOB.x, KNOB.y, CAR_TOP + 1.5], wrapMove(S(k.cylinder(KNOB.x, KNOB.y, KNOB.stem, CAR_TOP, 3, P, 20), { tone: "mid", crease: "none" })), [stem], stampOpts);
    const kz = CAR_TOP + 3;
    const knob = rec(A_cyl(KNOB.x, KNOB.y, KNOB.r, kz, 5, { name: "stamp.knob" }));
    put("stamp.knob", [KNOB.x, KNOB.y, kz + 2.5], wrapMove(S(k.cylinder(KNOB.x, KNOB.y, KNOB.r, kz, 5, P, 44, 0.6), { tone: "hi", lit: true }) + L(k.knurl(KNOB.x, KNOB.y, KNOB.r, kz, kz + 5, 40, P, 0.3), { tone: "lo" }) + L(k.ring(KNOB.x, KNOB.y, 2.4, kz + 5, P, 20), { tone: "faint" })), [knob], stampOpts);
  }

  // ---------------------------------------------------------------- the cable ----
  // From the solenoid's connector, down to the bench and along it into the back of the tower base.
  const CABLE_R = 0.8;
  const SHELL = 2;
  {
    const start = G.add3(BOSS_F.o, [0, 1.6, 0]);
    const end = [PLUNGER.at[0], TB.y, 3];
    const route = G.fillet([start, [start[0], -7, start[2]], [start[0], -7, 3], end], 3.4, 10, { P, tube: CABLE_R });
    const total = G.pathLength(route);
    const gaps = [[0, SHELL], [total - SHELL, total]];
    if (A) R.route("cable", route, CABLE_R, { gaps, limp: true, rims: [CABLE_R * 1.9, CABLE_R * 1.9] });
    tubePieces(route, CABLE_R, P, { maxLength: 14, spacing: 0.8, gaps }).forEach((piece, i) =>
      put(`cable:${i}`, piece.mid, tubeSvg(piece, { tone: "mid" }), [A ? A.tube(piece.points, piece.radii, { name: "cable", owner: "cable", limp: true }) : { meta: {} }], { bias: 0.05 }));
    [0, 1].forEach((i) => {
      const end3 = i ? route[route.length - 1] : route[0];
      const tangent = G.tangentAlong(route, i ? total : 0);
      const F = G.frameAlong(end3, tangent);
      const [s0, s1] = i ? [-SHELL, 0] : [0, SHELL];
      const shape = rec(A_disc(F, s0, s1, CABLE_R * 1.9, { name: `cable.shell${i}`, owner: "cable" }));
      put(`cable.shell${i}`, G.add3(end3, G.mul3(tangent, (s0 + s1) / 2)), S(G.disc(s0, s1, CABLE_R * 1.9, F, P, { bevel: 0.2 }), { tone: "mid" }), [shape], { bias: 0.1 });
    });
  }

  // ---------------------------------------------------------------- order and output ----
  if (A) A.settle(R, P);
  R.items.sort((a, b) => a.key - b.key);
  const V = G.viewOf(P);
  const keyAt = (item, share) => item.key + G.dot3(item.move ?? [0, 0, 0], V) * share;
  const orderAt = (share) => [...R.items].sort((a, b) => keyAt(a, share) - keyAt(b, share)).map((i) => i.name).join("|");
  const swaps = orderAt(0) !== orderAt(1);
  // Each item is its own group carrying its settled key and its depth lift per share of its
  // piece's travel, so the live figure re-sorts (only when the order really changes).
  const groups = R.items.map((item) => {
    const lift = G.dot3(item.move ?? [0, 0, 0], V);
    const attrs = item.piece && lift ? ` data-k="${item.key.toFixed(3)}" data-piece="${item.piece}" data-lift="${lift.toFixed(3)}"` : ` data-k="${item.key.toFixed(3)}"`;
    return `<g class="it"${attrs}>${item.svg}</g>`;
  });
  const svg = svgOf({
    width: WIDTH,
    height: HEIGHT,
    className: "fig-printer",
    label: "A receipt printer on a bench plate beside a rubber stamp on a spring carriage. A brake on the printer's platen wheel holds the paper until the stamp lands on the YES plate; then one invoice feeds out past the tear bar and the counter dial steps by one. In this example one invoice has been issued and the stamp has lifted again.",
    body: [...back, `<g data-items="">${groups.join("")}</g>`],
  });
  writeOut("printer/printer.svg", svg);

  geoModule("printer/geo.js", {
    P,
    viewBox: [WIDTH, HEIGHT],
    top: TOP,
    paper: { plan: PAPER, face: FACE_X },
    coil: { springs: SPRINGS, z0: TB_H + SEAT.h, z1: CAR_Z, r: COIL_R, turns: 7 },
    counter: { x: COUNTER.x, y: COUNTER.y, r: COUNTER.r, top: COUNTER_TOP },
    wheel: { o: WHEEL.o, r: WHEEL.r, t: WHEEL.t, hub: 2.6 },
    still: { count: STILL.count },
    resort: swaps,
  });

  if (A) A.auditOrExit(R, P, { cover: [] });
}

/**
 * The audit lives in the anatomy skill (kit/audit.mjs). Every build uses its settle() to measure
 * the painter's order from the recorded shapes; --audit also prints the full report.
 */
async function loadAudit() {
  const dir = process.env.ANATOMY_DIR || join(homedir(), ".claude", "skills", "anatomy");
  return import(pathToFileURL(join(dir, "kit", "audit.mjs")).href);
}

/** Without --audit, items are only collected and ordered by their depth keys. */
function fakeRecorder(P) {
  const V = G.viewOf(P);
  const R = { items: [], solid: (s) => s };
  R.put = ({ at = null, bias = 0, name, piece = "", move = [0, 0, 0], shapes = [], ...rest }) => {
    const item = { ...rest, name, piece, move, shapes, key: (at ? G.dot3(at, V) : 0) + bias };
    R.items.push(item);
    return item;
  };
  return R;
}
