// "Your yes": a receipt printer whose feed is braked until a rubber stamp lands on the YES plate.
// A small pure model (no DOM). The build script, the live figure and the readout all read it, so
// the stamp, the brake, the paper and the counter can never disagree.
// Every number is illustrative (the card's caption says "Example"), not a real invoice.

/** Stamp travel from rest to the YES plate, world units (about 1 px each). */
export const STROKE = 18;
/** Paper fed for one invoice, and the blank lip that shows above the tear bar between invoices. */
export const FEED = 54;
export const LIP = 4;
/** How far the feed brake's plunger lifts off the platen wheel when the gate opens. */
export const BRAKE_LIFT = 3;
/** Radius of the platen wheel on the printer's side: it turns FEED / WHEEL_R radians per invoice. */
export const WHEEL_R = 8;
/** Divisions on the counter dial; the needle steps one division per invoice. */
export const COUNTER_STEPS = 20;

/** The carriage on its two return springs: a little under critical, so it lands with weight. */
export const SPRING = Object.freeze({ stiffness: 190, damping: 25 });
/** Hover is a "maybe": the stamp dips this share of its stroke and never reaches the plate. */
export const MAYBE = 0.42;
/** Share of the stroke that counts as the die on the plate. */
export const CONTACT = 0.995;
/** Seconds: the stamp rests on YES before it is let go; the brake lifts; feed speed in units/s. */
export const DWELL = 0.32;
export const BRAKE_SECONDS = 0.09;
export const FEED_RATE = 42;
/** Seconds the issued invoice stays out, the tear, and the fresh lip fading back in. */
export const HOLD = 1.8;
export const TEAR = 0.7;
export const FRESH = 0.4;

export const PHASES = Object.freeze(["waiting", "maybe", "yes", "printing", "issued", "tearing"]);

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** A resting printer: stamp up, brake down, a blank lip, nothing issued. */
export function initial(count = 0) {
  return { stamp: { x: 0, v: 0 }, queued: false, latch: false, held: 0, maybe: false, armed: true, gate: 0, feed: 0, count, phase: "waiting", age: 0, fresh: 1 };
}

/** The still pose that explains the idea: one invoice out after the yes, stamp lifted again. */
export function still(count = 1) {
  return { ...initial(count), feed: FEED, phase: "issued", armed: true };
}

/** A press of the stamp (click, tap, Space or Enter): it goes down to the plate, rests, lets go. */
export const press = (s) => ({ ...s, latch: true, held: 0 });
/** Hover in or out: the stamp dips toward the plate, or rises again. */
export const hover = (s, on) => ({ ...s, maybe: Boolean(on) });
/** Let go before the stamp lands: nothing is approved, nothing prints. */
export const release = (s) => ({ ...s, latch: false, held: 0, maybe: false });

/** Where the stamp is heading: all the way only on a press, a dip on a maybe, else home. */
export const stampTarget = (s) => (s.latch ? 1 : s.maybe ? MAYBE : 0);
export const onPlate = (s) => s.stamp.x >= CONTACT;
const busy = (phase) => phase === "yes" || phase === "printing";

/**
 * One time step (dt in seconds). Pure: returns a new state. With calm (reduced motion) every
 * moving part jumps to its target, but the order of events is the same: the paper never moves
 * before the die is on the plate.
 */
export function step(prev, dt, calm = false) {
  const s = { ...prev, stamp: { ...prev.stamp } };
  s.age += dt;
  const target = stampTarget(s);
  if (calm) {
    s.stamp.x = target;
    s.stamp.v = 0;
  } else {
    const n = 4;
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      s.stamp.v += ((target - s.stamp.x) * SPRING.stiffness - s.stamp.v * SPRING.damping) * h;
      s.stamp.x += s.stamp.v * h;
      if (s.stamp.x >= 1) { s.stamp.x = 1; s.stamp.v = Math.min(0, s.stamp.v); }
      if (s.stamp.x <= 0 && target === 0) { s.stamp.x = Math.max(0, s.stamp.x); }
    }
    if (Math.abs(target - s.stamp.x) < 5e-4 && Math.abs(s.stamp.v) < 5e-4) { s.stamp.x = target; s.stamp.v = 0; }
  }

  // The die rests on YES for a moment, then the hand lets go.
  if (s.latch && onPlate(s)) {
    s.held += dt;
    if (s.held >= DWELL || calm) { s.latch = false; s.held = 0; }
  }
  if (s.stamp.x < 0.2) s.armed = true;

  // The gate: only a die on the plate, once per press, and never while an invoice is feeding.
  // A yes given while the last invoice is still out tears it off first, then prints.
  if (onPlate(s) && s.armed && !busy(s.phase)) {
    s.armed = false;
    if (s.phase === "issued" || s.phase === "tearing") {
      s.queued = true;
      if (s.phase === "issued") { s.phase = "tearing"; s.age = 0; }
    } else {
      s.feed = 0;
      s.fresh = 1;
      s.phase = "yes";
      s.age = 0;
    }
  }

  const open = busy(s.phase) ? 1 : 0;
  s.gate = calm ? open : s.gate + (open - s.gate) * (1 - Math.exp(-dt / BRAKE_SECONDS));
  if (Math.abs(open - s.gate) < 1e-3) s.gate = open;

  if (s.phase === "yes" && s.gate >= 0.98) { s.phase = "printing"; s.age = 0; }
  if (s.phase === "printing") {
    s.feed = calm ? FEED : Math.min(FEED, s.feed + FEED_RATE * dt);
    if (s.feed >= FEED) { s.feed = FEED; s.count += 1; s.phase = "issued"; s.age = 0; }
  }
  if (s.phase === "issued" && s.age >= HOLD) { s.phase = "tearing"; s.age = 0; }
  if (s.phase === "tearing" && s.age >= TEAR) {
    s.age = 0;
    s.feed = 0;
    if (s.queued) { s.queued = false; s.phase = "yes"; s.fresh = 1; } else { s.phase = "waiting"; s.fresh = 0; }
  }
  if (s.phase === "waiting" || s.phase === "maybe") {
    s.fresh = calm ? 1 : Math.min(1, s.fresh + dt / FRESH);
    s.phase = s.maybe && !s.latch && s.stamp.x > 0.04 && !onPlate(s) ? "maybe" : "waiting";
  }
  return s;
}

/** Reduced motion has no loop: a press resolves at once to the next invoice issued. */
export function issueNow(s) {
  if (busy(s.phase)) return s;
  return { ...initial(s.count + 1), feed: FEED, phase: "issued", age: 0 };
}

/** True when nothing will change without input (the loop may sleep). */
export const settled = (s) =>
  !s.latch && s.stamp.x === stampTarget(s) && s.stamp.v === 0 && (s.phase === "waiting" || s.phase === "maybe") && s.fresh >= 1 && (s.gate === 0);

/** How the receipt looks while it is torn off and while the fresh lip comes back. */
export function paperOf(s) {
  if (s.phase === "tearing") {
    const t = clamp(s.age / TEAR, 0, 1);
    return { feed: s.feed, lift: 7 * smooth(0, 1, t), alpha: 1 - smooth(0.1, 0.9, t) };
  }
  return { feed: s.feed, lift: 0, alpha: smooth(0, 1, s.fresh) };
}

/** Platen wheel angle (radians): it turns with the paper it feeds, one invoice after another. */
export const wheelAngle = (s) => (s.count * FEED + (s.phase === "yes" || s.phase === "printing" ? s.feed : 0)) / WHEEL_R;
/** Counter needle angle (radians from the dial's zero), one division per invoice issued. */
export const counterAngle = (count) => ((count % COUNTER_STEPS) / COUNTER_STEPS) * Math.PI * 2;

/** The readout as data; the page words it in the reader's language. */
export const readoutOf = (s) => ({ phase: s.phase, count: s.count });

/**
 * The idle tour, a pure function of tour time (seconds): a maybe (the stamp dips, nothing prints),
 * then a real press. The cycle is long enough for the invoice to print, hold and tear.
 */
// The figure starts in the still pose (an invoice out): it is torn off by about 2.5 s, so each
// cycle opens with that hold, then the maybe, then the press; the next invoice is out by about
// 7 s and the cycle starts again on it.
export const TOUR = Object.freeze({ maybeAt: 3.0, maybeFor: 1.4, pressAt: 5.0, cycle: 7.5 });
export function tourAt(t) {
  const at = ((t % TOUR.cycle) + TOUR.cycle) % TOUR.cycle;
  return { maybe: at >= TOUR.maybeAt && at < TOUR.maybeAt + TOUR.maybeFor, press: at >= TOUR.pressAt && at < TOUR.pressAt + 0.05 };
}
