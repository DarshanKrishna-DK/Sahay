// Pure geometry and routing for the v3 shell (no DOM, no imports, so node:test can load it).
//   sizeClass(w, h)                 -> "phone" | "phoneLand" | "tablet" | "laptop" | "wide"   (spec 6.1)
//   parseRoute(hash)                -> { id, sub, canonical }                                 (spec 1.1)
//   arcOffset(y, h, bulge)          -> how far the sidebar's convex edge bulges right at height y
//   arcItems(w, h, bulge, ys)       -> item centres that follow the bow (middle item furthest right)
//   arcSamples(w, h, bulge, y0, y1) -> points along the bow between two heights (the marker's path)
//   dockOutline(w, h, opts)         -> polygon points of the phone dock: upward-arcing top edge,
//                                      a round notch that cradles the raised orb, rounded corners
//   concaveOutline(w, h, opts)      -> polygon of the concave sidebar (narrowest at the vertical centre)
//   concaveInset / concaveX         -> how far the edge moved in at a height, and an item's centre there
//   hexLattice(w, h, pitch)         -> dot centres of a true hex (triangular) lattice + edge fade

export const SIZES = ["phone", "phoneLand", "tablet", "laptop", "wide"];

export function sizeClass(w, h) {
  if (h <= 500 && w >= 568 && w > h) return "phoneLand";
  if (w < 600) return "phone";
  if (w < 1024) return "tablet";
  if (w < 1600) return "laptop";
  return "wide";
}

export const SCREEN_IDS = ["sahay", "buy", "sell", "stock", "money", "me"];
export const ME_SECTIONS = ["teach", "voice", "shop", "history"];
const SPECIAL = ["waiting", "signup", "login"];
export const ROUTE_ALIASES = { "": "sahay", talk: "sahay", home: "sahay", work: "buy", orders: "buy", history: "me/history" };

export function parseRoute(hash) {
  const raw = String(hash || "").replace(/^#\/?/, "").split(/[?#]/)[0].toLowerCase();
  let parts = raw.split("/").filter(Boolean);
  const first = parts[0] || "";
  if (Object.prototype.hasOwnProperty.call(ROUTE_ALIASES, first)) {
    parts = ROUTE_ALIASES[first].split("/").concat(parts.slice(1));
  }
  let id = parts[0];
  let sub = null;
  if (!SCREEN_IDS.includes(id) && !SPECIAL.includes(id)) id = "sahay";
  if (id === "me" && ME_SECTIONS.includes(parts[1])) sub = parts[1];
  return { id, sub, canonical: `#/${id}${sub ? `/${sub}` : ""}` };
}

/** Convex bow of the sidebar's right edge: 0 at the top and bottom, `bulge` at mid height. */
export function arcOffset(y, h, bulge) {
  if (!(h > 0)) return 0;
  const t = (y - h / 2) / (h / 2);
  if (t <= -1 || t >= 1) return 0;
  return bulge * Math.sqrt(1 - t * t);
}

/** Centre of the free width at height y: the body (w - bulge) plus whatever the bow adds there. */
export function arcX(y, w, h, bulge) {
  return (w - bulge + arcOffset(y, h, bulge)) / 2;
}

export function arcItems(w, h, bulge, ys) {
  return ys.map((y) => ({ x: Math.round(arcX(y, w, h, bulge) * 10) / 10, y }));
}

/** Points along the bow from y0 to y1 (inclusive), about every `step` px, for the sliding marker. */
export function arcSamples(w, h, bulge, y0, y1, step = 8) {
  const n = Math.max(2, Math.ceil(Math.abs(y1 - y0) / step) + 1);
  const out = [];
  for (let i = 0; i < n; i++) {
    const y = y0 + ((y1 - y0) * i) / (n - 1);
    out.push({ x: Math.round(arcX(y, w, h, bulge) * 10) / 10, y: Math.round(y * 10) / 10 });
  }
  return out;
}

/**
 * The concave sidebar (v4): full width at the top and bottom, the right edge curving INWARD to its
 * narrowest at the vertical centre, smooth and symmetric (a raised cosine over the whole height).
 *   concaveInset(y, h, depth)     how far the edge has moved in at height y (0 at the ends, depth at h/2)
 *   concaveX(y, w, h, depth)      an item's centre: the middle of the width left at that height
 *   concaveOutline(w, h, opts)    polygon [[x, y], ...] (clockwise) with rounded corners
 */
export function concaveInset(y, h, depth) {
  if (!(h > 0) || !depth) return 0;
  const u = (y - h / 2) / (h / 2);
  if (u <= -1 || u >= 1) return 0;
  return depth * (1 + Math.cos(Math.PI * u)) / 2;
}

export function concaveX(y, w, h, depth) {
  return (w - concaveInset(y, h, depth)) / 2;
}

export function concaveOutline(w, h, { depth = 36, radius = 30, step = 4 } = {}) {
  const r = Math.min(radius, w / 2, h / 4);
  const pts = [];
  const arc = (cx, cy, a0, a1) => { for (let a = a0; a <= a1; a += 10) { const t = (a * Math.PI) / 180; pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); } };
  arc(r, r, 180, 270);                         // top-left
  arc(w - r, r, 270, 360);                     // top-right (full width)
  for (let y = r + step; y < h - r; y += step) pts.push([w - concaveInset(y, h, depth), y]);
  arc(w - r, h - r, 0, 90);                    // bottom-right (full width)
  arc(r, h - r, 90, 180);                      // bottom-left
  return pts.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
}

function smoothMax(a, b, k) {
  if (b === -Infinity) return a;
  return (a + b + Math.sqrt((a - b) * (a - b) + k * k)) / 2;
}

/**
 * Dock outline in px, origin top-left, y down. The top edge is a gentle upward arc (lowest at the
 * ends by `arc`, highest at the centre); a circular notch of radius orb/2 + gap is cut around the orb
 * centre (cx = w/2, cy = orbCy) with soft shoulders; corners are rounded by `radius` (top) and
 * `radiusBottom`. Returns [[x, y], ...] (clockwise, closed implicitly).
 */
export function dockOutline(w, h, { arc = 10, radius = 26, radiusBottom = 30, orb = 64, gap = 6, orbCy = 14, shoulder = 14, step = 3 } = {}) {
  const R = orb / 2 + gap;
  const cx = w / 2;
  const top = (x) => {
    const u = (2 * x) / w - 1;
    const base = arc * u * u;
    const dx = x - cx;
    const notch = Math.abs(dx) < R ? orbCy + Math.sqrt(R * R - dx * dx) : -Infinity;
    return smoothMax(base, notch, shoulder);
  };
  const pts = [];
  const r = Math.min(radius, w / 4, h / 3);
  const rb = Math.min(radiusBottom, w / 4, h / 2);
  // top-left corner: quarter circle from the left side up onto the top edge
  const yTL = top(r);
  for (let a = 180; a <= 270; a += 10) {
    const rad = (a * Math.PI) / 180;
    pts.push([r + r * Math.cos(rad), yTL + r + r * Math.sin(rad)]);
  }
  for (let x = r + step; x < w - r; x += step) pts.push([x, top(x)]);
  const yTR = top(w - r);
  for (let a = 270; a <= 360; a += 10) {
    const rad = (a * Math.PI) / 180;
    pts.push([w - r + r * Math.cos(rad), yTR + r + r * Math.sin(rad)]);
  }
  for (let a = 0; a <= 90; a += 10) {
    const rad = (a * Math.PI) / 180;
    pts.push([w - rb + rb * Math.cos(rad), h - rb + rb * Math.sin(rad)]);
  }
  for (let a = 90; a <= 180; a += 10) {
    const rad = (a * Math.PI) / 180;
    pts.push([rb + rb * Math.cos(rad), h - rb + rb * Math.sin(rad)]);
  }
  return pts.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
}

export function polygonCss(pts) {
  return `polygon(${pts.map(([x, y]) => `${x}px ${y}px`).join(", ")})`;
}

export function svgPath(pts) {
  return `M${pts.map(([x, y]) => `${x} ${y}`).join("L")}Z`;
}

/**
 * True hex lattice: rows `pitch * sqrt(3) / 2` apart, every other row shifted by pitch / 2, so each
 * dot has six equidistant neighbours. `a` is the edge fade (0 at the viewport edge, 1 inside `fade`
 * of the shorter side), smoothstepped; `edges` turns the fade off per side (the sidebar's side, so
 * the dots read through its glass). Starts half a pitch outside so the edges are covered.
 */
export function hexLattice(w, h, pitch = 22, fade = 0.2, edges = { l: true, r: true, t: true, b: true }) {
  const dy = (pitch * Math.sqrt(3)) / 2;
  const band = Math.max(1, Math.min(w, h) * fade);
  const pts = [];
  let row = 0;
  for (let y = dy / 2; y < h; y += dy, row++) {
    const shift = row % 2 ? pitch / 2 : 0;
    for (let x = shift + pitch / 2; x < w; x += pitch) {
      const d = Math.min(edges.l ? x : Infinity, edges.r ? w - x : Infinity, edges.t ? y : Infinity, edges.b ? h - y : Infinity) / band;
      const s = d >= 1 ? 1 : d <= 0 ? 0 : d * d * (3 - 2 * d);
      if (s > 0.02) pts.push({ x, y, a: s });
    }
  }
  return pts;
}

/** Badge text for counts: 1-9, then "9+"; 0 or less is no badge (""). */
export function badgeText(n) {
  const v = Number(n) || 0;
  if (v <= 0) return "";
  return v > 9 ? "9+" : String(Math.floor(v));
}
