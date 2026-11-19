// The bargaining balance, as a small pure model (no DOM). The build script, the live figure and
// the tests all read it, so the beam, the weights, the dial and the readout can never disagree.
// Every number is an illustrative example (the figure is tagged "Example"), not a real deal.

/** One weight disc on a pan stands for this many rupees. */
export const DISC_RUPEES = 5;

/** The example haggle: the seller's ask comes down, Sahay's offer comes up, they meet. */
export const ROUNDS = Object.freeze([
  Object.freeze({ ask: 65, offer: 45 }),
  Object.freeze({ ask: 60, offer: 50 }),
  Object.freeze({ ask: 55, offer: 55 }),
]);

/** Slots built on each pan: enough for the largest ask and the largest offer. */
export const MAX_DISCS = Object.freeze({
  ask: Math.max(...ROUNDS.map((r) => r.ask)) / DISC_RUPEES,
  offer: Math.max(...ROUNDS.map((r) => r.offer)) / DISC_RUPEES,
});

const DEG = Math.PI / 180;
/** Beam tilt per rupee of difference between the pans, and the stop that limits it. */
export const TILT_PER_RUPEE = 0.32 * DEG;
export const MAX_TILT = 7 * DEG;

/** The beam swings like a real balance: an underdamped pendulum (period about 1.6 s). */
export const SWING = Object.freeze({ stiffness: 15.4, damping: 1.7 });

/** The dial reads rupees a kilo from 40 to 70 over 270 degrees, zero at the lower left. */
export const DIAL = Object.freeze({ min: 40, max: 70, from: -135 * DEG, span: 270 * DEG });

/** Tour timing: each round holds this long, the agreed price holds longer, then it starts over. */
export const ROUND_SECONDS = 3.4;
export const AGREED_SECONDS = 5;

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** How many discs a price puts on a pan. */
export function discsFor(rupees) {
  if (!Number.isFinite(rupees) || rupees < 0 || rupees % DISC_RUPEES !== 0) {
    throw new RangeError(`price must be a whole multiple of ${DISC_RUPEES}`);
  }
  return rupees / DISC_RUPEES;
}

/**
 * Beam angle in radians for the rupees resting on each pan. Positive tips the seller's pan
 * (left) down: the heavier side always goes down, equal loads hang level.
 */
export function tiltFor(askLoad, offerLoad) {
  return clamp((askLoad - offerLoad) * TILT_PER_RUPEE, -MAX_TILT, MAX_TILT);
}

/** Needle angle on the dial for a price (radians, 0 points away from the viewer's left). */
export function dialAngle(price) {
  const share = clamp((price - DIAL.min) / (DIAL.max - DIAL.min), 0, 1);
  return DIAL.from + share * DIAL.span;
}

export const isAgreed = (round) => round.ask === round.offer;

/** The round the idle tour shows at time t (seconds), looping forever. */
export function tourRound(t) {
  const last = ROUNDS.length - 1;
  const cycle = last * ROUND_SECONDS + AGREED_SECONDS;
  const at = ((t % cycle) + cycle) % cycle;
  return Math.min(last, Math.floor(at / ROUND_SECONDS));
}

/** What the readout says for a round, as data; the page words it in the reader's language. */
export function readoutOf(index) {
  const round = ROUNDS[clamp(index, 0, ROUNDS.length - 1)];
  return isAgreed(round)
    ? { kind: "agreed", price: round.ask }
    : { kind: "round", number: index + 1, of: ROUNDS.length, ask: round.ask, offer: round.offer };
}

/** One spring step of the beam toward its target angle (sub-stepped; returns true when settled). */
export function swingStep(state, target, dt, calm = false) {
  if (calm) { state.x = target; state.v = 0; return true; }
  const n = 4;
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    state.v += (-(state.x - target) * SWING.stiffness - state.v * SWING.damping) * h;
    state.x += state.v * h;
  }
  if (Math.abs(state.x - target) < 2e-4 && Math.abs(state.v) < 2e-4) { state.x = target; state.v = 0; return true; }
  return false;
}
