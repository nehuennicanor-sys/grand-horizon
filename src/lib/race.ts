import { makeRng } from "./prng";
import { type CarConfig } from "./car";
import { nearestTrack, type ClubCircuit } from "./club-circuit";
import { driveSetup, newDriveState, stepDrive, type DriveState } from "./driving";

// ─── Rivals ───────────────────────────────────────────────────────────────────
// Nineteen rivals built from the player's own car: same class and the same
// mechanicals, but never the same car — each one gets its own hull, paint,
// rims and wing. The field is driven by a kinematic controller that reads the
// circuit's corner radii, so the AI brakes, turns and slides on exactly the
// surface the player drives.

export const RIVAL_COUNT = 19;

/** Driver names, team codes and the paint each one runs. */
const FIELD: { name: string; short: string }[] = [
  { name: "M. Robles", short: "ROB" },
  { name: "K. Tanaka", short: "TAN" },
  { name: "L. Ferrari", short: "FER" },
  { name: "A. Novak", short: "NOV" },
  { name: "D. Sosa", short: "SOS" },
  { name: "J. Whitfield", short: "WHI" },
  { name: "P. Moreau", short: "MOR" },
  { name: "S. Bianchi", short: "BIA" },
  { name: "R. Vargas", short: "VAR" },
  { name: "T. Lindqvist", short: "LIN" },
  { name: "H. Sauer", short: "SAU" },
  { name: "N. Okoro", short: "OKO" },
  { name: "V. Petrov", short: "PET" },
  { name: "E. Duarte", short: "DUA" },
  { name: "C. Reyes", short: "REY" },
  { name: "B. Holm", short: "HOL" },
  { name: "F. Aguirre", short: "AGU" },
  { name: "Y. Kwon", short: "KWO" },
  { name: "G. Marchetti", short: "MAR" },
];

const PAINTS = [
  "#d7382e",
  "#1f6fd0",
  "#f2b705",
  "#17a86b",
  "#e56ab2",
  "#7a4fd0",
  "#f07819",
  "#12b5c9",
  "#c9d1da",
  "#8c1b1b",
  "#1a2a5e",
  "#4f5b66",
  "#dcd4c6",
  "#2b8a3e",
  "#b0316b",
  "#0f8f8f",
  "#c07f2a",
  "#5a5ad0",
  "#20242c",
];

export type RivalSpec = {
  name: string;
  short: string;
  color: string;
  accent: string;
  /** The car this rival runs: the player's build, jittered. */
  car: CarConfig;
  /** Which body variant to draw (shared hulls keep the frame budget). */
  variant: number;
};

export type AiCar = {
  spec: RivalSpec;
  state: DriveState;
  config: ReturnType<typeof driveSetup>;
  /** Path index the car is nearest to right now. */
  index: number;
  /** Metres travelled since the lights went out: the race's true progress. */
  odometer: number;
  laps: number;
  /** Race clock at the last counted line crossing. */
  crossedAt: number;
  lapStart: number;
  best: number | null;
  finishedAt: number | null;
  /** Preferred lane, -1 (left) … 1 (right); it shifts around traffic. */
  lane: number;
  laneWant: number;
  /** Steering actually on the wheel: the hands move at a human rate. */
  steerCmd: number;
  /** Seconds the car is committed to its lane: a pass, once started, is seen
   *  through instead of weaving back and forth. */
  laneHold: number;
  /** Per-car pace wobble around the difficulty setting. */
  pace: number;
  /** Seconds spent crawling: a nudge gets a stuck car going again. */
  stuck: number;
  /** Seconds left of the scripted recovery: back out, then rejoin. */
  recover: number;
  /** Seconds of calm pace after a recovery, so it does not dive back in. */
  rejoin: number;
  /** Recoveries this race: a car that cannot free itself is put back once. */
  rescues: number;
  /** 1 while another car sits right ahead in the same lane. */
  blocked: number;
};

/**
 * The player's car, nineteen times over: the mechanicals stay within a couple
 * of percent of the original so the race is decided by the driver, while the
 * body, the paint and the rims are never the same twice.
 */
export function buildRivals(car: CarConfig, topSpeed: number, seed = 0x51a7): RivalSpec[] {
  const rng = makeRng(seed);
  const specs: RivalSpec[] = [];
  for (let i = 0; i < FIELD.length; i++) {
    const entry = FIELD[i]!;
    const jitter = 0.94 + rng() * 0.12;
    const sculpt = { ...car.sculpt };
    const axes = ["length", "width", "height", "nose", "hood", "rake", "cabin", "tail", "wing", "arches", "curves"] as const;
    for (const axis of axes) {
      // A wide spread on purpose: nineteen machines that read as nineteen
      // different cars, not one moulding sprayed in nineteen colours.
      const delta = (rng() - 0.5) * 0.19;
      sculpt[axis] = Math.max(0.06, Math.min(0.94, sculpt[axis] + delta));
    }
    const variant = i % 4;
    specs.push({
      name: entry.name,
      short: entry.short,
      color: PAINTS[i % PAINTS.length]!,
      accent: i % 3 === 0 ? "#101318" : "#e9eef4",
      variant,
      car: {
        ...car,
        name: entry.name,
        color: PAINTS[i % PAINTS.length]!,
        accent: i % 3 === 0 ? "#101318" : "#e9eef4",
        wheelColor: rng() < 0.4 ? "#14171c" : rng() < 0.5 ? "#cfd6de" : "#8a7b3a",
        wheelSize: Math.round(car.wheelSize * (0.94 + rng() * 0.12)),
        stripes: rng() < 0.35,
        spoiler: true,
        wheelStyle: (["multirayo", "turbina", "malla", "disco", "estrella", "rayos"] as const)[
          Math.floor(rng() * 6)
        ]!,
        downforce: Math.max(0.05, Math.min(1, car.downforce * jitter)),
        displacement: car.displacement * (0.96 + rng() * 0.08),
        boost: Math.max(0, Math.min(1, car.boost * (0.95 + rng() * 0.1))),
        sculpt,
      },
    });
    // The hull jitter is stored per spec; the speed hint keeps the grid close.
    void topSpeed;
  }
  return specs;
}

// ─── AI bands ─────────────────────────────────────────────────────────────────
// The slider the player picks before the race: 0-100 in four bands, exactly
// the way the licence tests teach them.

export type AiBand = { key: string; label: string; min: number; max: number; note: string };

export const AI_BANDS: AiBand[] = [
  {
    key: "principiante",
    label: "Principiante",
    min: 0,
    max: 25,
    note: "Frenan antes de la curva, levantan en las rectas y dejan la puerta abierta.",
  },
  {
    key: "intermedio",
    label: "Intermedio",
    min: 25,
    max: 50,
    note: "Trazan razonable y se defienden, pero todavía cometen errores.",
  },
  {
    key: "avanzado",
    label: "Avanzado",
    min: 50,
    max: 75,
    note: "Frenan tarde y aguantan el auto al límite en la curva.",
  },
  {
    key: "profesional",
    label: "Profesional",
    min: 75,
    max: 100,
    note: "Ritmo de fábrica: pelean cada metro, cierran la puerta y no perdonan un error.",
  },
];

export function aiBand(level: number): AiBand {
  const clamped = Math.max(0, Math.min(100, level));
  return (
    AI_BANDS.find((band) => clamped >= band.min && clamped < band.max) ?? AI_BANDS[AI_BANDS.length - 1]!
  );
}

// ─── Circuit guide ────────────────────────────────────────────────────────────

export type TrackGuide = {
  step: number;
  /** Kinematic corner limit in m/s, per path point. */
  limit: Float32Array;
  /** Racing-line lean per path point: +1 hugs the right side of the road. */
  lean: Float32Array;
  /** Signed smoothed curvature per point, 1/m: positive turns the car right. */
  kappa: Float32Array;
  /** The racing line itself: metres to the right of the path centre. */
  offset: Float32Array;
  /** Fastest the tyres allow at each point, in m/s, after the braking and the
   *  traction pass. This is what the driver brakes for — not a flat minimum
   *  taken over the road ahead, which holds a hairpin's speed down the whole
   *  straight out of it. */
  profile: Float32Array;
};

/**
 * The corner-radius profile of a layout, turned into the racing line the AI
 * should hold and the fastest speed the car can carry at every point of it.
 * Derived from the same steering model the player drives, so the AI cannot do
 * more than the car allows — it just does it more consistently.
 */
export function guideFor(track: ClubCircuit): TrackGuide {
  const n = track.points.length;
  const step = track.length / n;
  const kappa = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p0 = track.points[(i + n - 1) % n]!;
    const p1 = track.points[i]!;
    const p2 = track.points[(i + 1) % n]!;
    const ax = p1.x - p0.x;
    const az = p1.z - p0.z;
    const bx = p2.x - p1.x;
    const bz = p2.z - p1.z;
    const cross = ax * bz - az * bx;
    const la = Math.hypot(ax, az) || 1e-6;
    const lb = Math.hypot(bx, bz) || 1e-6;
    kappa[i] = Math.asin(Math.max(-1, Math.min(1, cross / (la * lb)))) / ((la + lb) / 2);
  }
  const smooth = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let o = -4; o <= 4; o++) acc += kappa[(i + o + n) % n]!;
    smooth[i] = acc / 9;
  }
  // The steering model in `stepDrive` turns the car *right* for a positive
  // lock, and a positive yaw rate turns it right as well. The cross product
  // above reads the other way round, so the curvature handed to the driver is
  // its negative — get this backwards and every corner is taken the wrong way.
  const curv = new Float32Array(n);
  for (let i = 0; i < n; i++) curv[i] = -smooth[i]!;
  const limit = new Float32Array(n);
  const lean = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = Math.abs(smooth[i]!);
    const radius = k > 1e-5 ? 1 / k : 5000;
    // v(R) from the steering model: a tighter radius simply cannot be held as
    // fast, whatever the driver wants.
    limit[i] = Math.min(92, (Math.sqrt(0.346 + 0.0753 * Math.min(radius, 900)) - 0.588) / 0.0376);
    const strength = Math.max(0, Math.min(1, (300 - radius) / 220));
    lean[i] = smooth[i]! < 0 ? strength : -strength;
  }

  // ── The racing line. The apex lean on its own puts the car on the inside
  // only at the apex — which is where the barrier is closest — and the rest of
  // the time lets it run down the middle. What a driver actually does is start
  // moving in a corner early and be on the way out again by the apex. A
  // triangular average over ±16 m turns the pointwise lean into that line, and
  // the width it uses stays at seven tenths of the road, so coming back inside
  // is always possible.
  const hw = track.halfWidth;
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) raw[i] = lean[i]! * hw * 0.62;
  const offset = new Float32Array(n);
  const win = Math.max(2, Math.round(16 / step));
  for (let i = 0; i < n; i++) {
    let acc = 0;
    let sum = 0;
    for (let o = -win; o <= win; o++) {
      const w = 1 - Math.abs(o) / (win + 1);
      acc += raw[(i + o + n * 3) % n]! * w;
      sum += w;
    }
    offset[i] = Math.max(-hw * 0.72, Math.min(hw * 0.72, acc / sum));
  }

  // ── The speed profile: the corner limit, then the brakes run backwards and
  // the traction runs forwards, twice around the loop, until neither pass can
  // lower a point any further. Eleven metres per second squared of braking and
  // seven of drive are what a driver is willing to use; the car has more of
  // both, which is the margin a mistake eats into.
  const profile = Float32Array.from(limit);
  const BRAKE = 11;
  const DRIVE = 7;
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < n; k++) {
      const i = (n - 1 - k + n) % n;
      const next = profile[(i + 1) % n]!;
      profile[i] = Math.min(profile[i]!, Math.sqrt(next * next + 2 * BRAKE * step));
    }
    for (let i = 0; i < n; i++) {
      const prev = profile[(i + n - 1) % n]!;
      profile[i] = Math.min(profile[i]!, Math.sqrt(prev * prev + 2 * DRIVE * step));
    }
  }
  return { step, limit, lean, kappa: curv, offset, profile };
}

// ─── Starting grid ────────────────────────────────────────────────────────────

export type GridSlot = { x: number; z: number; yaw: number; index: number };

/**
 * A staggered two-wide grid behind the start line: pole closest to the line,
 * the rest stepping back in pairs, alternating sides like a real one.
 */
export function startGrid(track: ClubCircuit, count: number): GridSlot[] {
  const n = track.points.length;
  const step = track.length / n;
  const hw = track.halfWidth;
  const slots: GridSlot[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / 2);
    const col = i % 2;
    const back = 7 + row * 7.6 + col * 2.4;
    const index = (n - Math.round(back / step) + n * 4) % n;
    const point = track.points[index]!;
    const right = track.rights[index]!;
    const lateral = (col === 0 ? -1 : 1) * hw * 0.42;
    const tangent = track.curve.getTangentAt(index / n);
    slots.push({
      x: point.x + right.x * lateral,
      z: point.z + right.z * lateral,
      yaw: Math.atan2(tangent.x, tangent.z),
      index,
    });
  }
  return slots;
}

// ─── Contacts ─────────────────────────────────────────────────────────────────

export type ContactBody = {
  x: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;
  /** Half-width of the collision disc. */
  r: number;
  /** Longitudinal half-length between the two discs of the hull. */
  half: number;
  player?: boolean;
};

/**
 * Cars are two discs along their own axis, which reads as a car and not as a
 * magnet: nose-to-tail contact happens at bumper distance, side-by-side
 * contact only when the panels really touch. Returns the worst hit the player
 * took, so the collision can bend the bodywork.
 */
export function resolveContacts(bodies: ContactBody[]): number {
  let worst = 0;
  const forward = (b: ContactBody) => ({ x: Math.sin(b.yaw), z: Math.cos(b.yaw) });
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i]!;
      const b = bodies[j]!;
      const fa = forward(a);
      const fb = forward(b);
      for (const sa of [-1, 1]) {
        const ax = a.x + fa.x * a.half * sa;
        const az = a.z + fa.z * a.half * sa;
        for (const sb of [-1, 1]) {
          const bx = b.x + fb.x * b.half * sb;
          const bz = b.z + fb.z * b.half * sb;
          let dx = bx - ax;
          let dz = bz - az;
          const dist = Math.hypot(dx, dz);
          const reach = a.r + b.r;
          if (dist >= reach || dist < 1e-5) continue;
          const nx = dx / dist;
          const nz = dz / dist;
          const push = (reach - dist) * 0.5;
          a.x -= nx * push;
          a.z -= nz * push;
          b.x += nx * push;
          b.z += nz * push;
          const relX = b.vx - a.vx;
          const relZ = b.vz - a.vz;
          const closing = relX * nx + relZ * nz;
          if (closing < 0) {
            // Elastic-ish shove with a little restitution: contact slows both
            // cars down and throws the one hit off line, like real bodywork.
            const impulse = closing * 0.62;
            a.vx += nx * impulse;
            a.vz += nz * impulse;
            b.vx -= nx * impulse;
            b.vz -= nz * impulse;
            const severity = Math.abs(closing) * 3.6;
            if ((a.player || b.player) && severity > worst) worst = severity;
          }
        }
      }
    }
  }
  return worst;
}

// ─── AI driver ────────────────────────────────────────────────────────────────

export type AiInput = { throttle: number; steer: number; brake: boolean };

/** What the difficulty slider buys, band by band. A beginner leaves the
 *  throttle alone on the straights and brakes a hundred metres early; a
 *  professional uses every metre of road and every millimetre of pedal. */
export type AiStyle = {
  /** Cornering pace: the fraction of the kinematic limit the car dares. */
  pace: number;
  /** The fraction of the car's top speed the driver is willing to use. */
  top: number;
  /** How hard the driver is willing to brake: the reference, scaled. */
  brakes: number;
  /** Room left when following, in metres, scaled by speed. */
  polite: number;
};

export function aiStyle(level: number): AiStyle {
  const l = Math.max(0, Math.min(100, level)) / 100;
  return {
    pace: 0.84 + 0.24 * l,
    top: 0.78 + 0.28 * l,
    brakes: 0.66 + 0.38 * l,
    polite: 1.16 - 0.28 * l,
  };
}

/**
 * Lock the car needs to hold a path of curvature `kappa` at `speed`: the
 * steering model in `stepDrive` inverted, so the AI asks its front tyres for
 * exactly what the corner needs. This is the term that was missing — without
 * it the field reacted to every corner instead of turning into it, and the
 * reaction was to run wide until it found the barrier.
 */
function lockFor(kappa: number, speed: number) {
  const v = Math.max(0.5, speed);
  const bite = Math.min(1, v / 3.5);
  const rate = (1.7 * bite) / (1 + v * 0.032);
  return (kappa * v) / rate;
}

/**
 * One AI decision: hold the racing line, brake for the corner the profile
 * describes, find a way past slower traffic and get out of trouble on its own.
 */
export function aiDrive(
  car: AiCar,
  guide: TrackGuide,
  track: ClubCircuit,
  others: AiCar[],
  playerAt: { x: number; z: number; vx: number; vz: number; speed: number } | null,
  style: AiStyle,
  dt: number,
): AiInput {
  const s = car.state;
  const n = track.points.length;
  const hw = track.halfWidth;
  const ds = guide.step;
  const speed = Math.max(0.5, Math.hypot(s.vx, s.vz));
  const here = car.index;

  // ── Where the car sits, measured against the line it should be holding.
  const p0 = track.points[here]!;
  const r0 = track.rights[here]!;
  const latNow = (s.x - p0.x) * r0.x + (s.z - p0.z) * r0.z;
  const latVel = s.vx * r0.x + s.vz * r0.z;

  // ── Corner speed, read as a braking curve rather than a flat minimum over
  // the road ahead. The minimum held a hairpin's number for the whole straight
  // out of it — which is what made the field crawl out of corners and lift
  // where there was nothing to lift for — while a braking curve asks, for each
  // point in reach, what speed still leaves room to be at that point's own
  // speed on arrival. Late, sufficient, and no sooner.
  const profile = guide.profile;
  const brakeA = 11 * style.brakes;
  const horizon = Math.max(5, Math.min(n - 1, Math.round((speed * speed) / (2 * brakeA * ds)) + 4));
  let target = Math.min(profile[here]! * style.pace * car.pace, car.config.maxSpeed * style.top);
  for (let k = 1; k <= horizon; k++) {
    const p = profile[(here + k) % n]! * style.pace * car.pace;
    const allowed = Math.sqrt(p * p + 2 * brakeA * ds * k);
    if (allowed < target) target = allowed;
  }

  // ── Traffic. A racing driver follows at a couple of car lengths, matches the
  // speed of the car in front, looks for a wheel alongside before moving over
  // and only goes when there is room to go. The old rule lifted the throttle a
  // tenth and shoved its nose in, which is why nineteen cars spent the race
  // banging doors like a field of kids.
  const fx = Math.sin(s.yaw);
  const fz = Math.cos(s.yaw);
  const rx = Math.cos(s.yaw);
  const rz = -Math.sin(s.yaw);
  let gap = Infinity;
  let gapSpeed = 0;
  let besideLat = 0;
  let beside = false;
  let busyLeft = false;
  let busyRight = false;
  const inLane: { gap: number; speed: number }[] = [];
  const scan = (ox: number, oz: number, ovx: number, ovz: number) => {
    const dx = ox - s.x;
    const dz = oz - s.z;
    const ahead = dx * fx + dz * fz;
    if (ahead < -7 || ahead > 48) return;
    const lat = dx * rx + dz * rz;
    // Someone in my lane, in front of me: the car I have to follow, and — see
    // the follow plan below — one of the walls I have to plan against.
    if (Math.abs(lat) < 2.3 && ahead > 0.5) {
      inLane.push({ gap: ahead, speed: Math.max(0, ovx * fx + ovz * fz) });
      if (ahead < gap) {
        gap = ahead;
        gapSpeed = Math.max(0, ovx * fx + ovz * fz);
      }
    }
    // Wheel to wheel right now: hold my own side and never turn across it.
    if (Math.abs(ahead) < 6.5 && Math.abs(lat) < 2.6) {
      beside = true;
      if (besideLat === 0 || Math.abs(lat) < Math.abs(besideLat)) besideLat = lat;
    }
    // The neighbouring lane, ahead of me: is it clear to move into?
    if (ahead > 0 && ahead < 13) {
      if (lat > 1.7 && lat < 5.6) busyRight = true;
      if (lat < -1.7 && lat > -5.6) busyLeft = true;
    }
  };
  for (const other of others) {
    if (other === car) continue;
    scan(other.state.x, other.state.z, other.state.vx, other.state.vz);
  }
  if (playerAt) scan(playerAt.x, playerAt.z, playerAt.vx, playerAt.vz);

  // Hold station: match the car in front instead of driving through it. The
  // room left grows with speed and with the driver's manners — and the bare gap
  // is never enough on its own: a queue whose cars only watch the car directly
  // ahead rear-ends itself the moment that car brakes hard for something slower,
  // because by the time the brakes go on there is no room left to react. So the
  // plan is made against *every* car in the lane: for each of them, the speed
  // that still leaves room to be down to its speed by the time the gap closes.
  const safe = (3.4 + speed * 0.3) * style.polite;
  if (gap < safe * 1.6) {
    const follow = gapSpeed + (gap - safe) * 1.4;
    target = Math.min(target, Math.max(gapSpeed * 0.9, follow));
  }
  for (const other of inLane) {
    const room = Math.max(0.5, other.gap - (3.2 + speed * 0.05));
    const allowed = Math.sqrt(other.speed * other.speed + 2 * brakeA * room);
    if (allowed < target) target = allowed;
  }
  car.blocked =
    gap < safe * 1.6 ? Math.max(0, Math.min(1, (safe * 1.6 - gap) / Math.max(3, safe))) : 0;

  // Overtake: the car in front is slower than the road would let me be — that
  // is the whole test, and it has to be measured against what *I* could do clear
  // of traffic, not against my own current speed, which following has already
  // dragged down to theirs. That mistake is why nobody ever passed anybody.
  car.laneHold = Math.max(0, car.laneHold - dt);
  const clear = Math.min(profile[here]! * style.pace * car.pace, car.config.maxSpeed * style.top);
  const held = gapSpeed < clear * 0.94;
  const glued = gap < safe * 0.75 && car.blocked > 0.45;
  // A car wheel to wheel on the side I want blocks that move; the car I am
  // following does not, however close it is — that is the whole point.
  const freeSide = (dir: number) =>
    !(beside && Math.sign(besideLat) === dir && Math.abs(besideLat) > 0.8);
  if (
    car.blocked > 0.35 &&
    speed > 6 &&
    gap < safe * 1.25 &&
    (held || glued) &&
    car.laneHold === 0
  ) {
    if (busyRight && !busyLeft && freeSide(-1)) {
      car.laneWant = -1.35;
      car.laneHold = 1.2;
    } else if (busyLeft && !busyRight && freeSide(1)) {
      car.laneWant = 1.35;
      car.laneHold = 1.2;
    } else if (!busyLeft && freeSide(-1) && gapSpeed < speed * 0.99) {
      car.laneWant = -1.35;
      car.laneHold = 1;
    } else if (!busyRight && freeSide(1) && gapSpeed < speed * 0.99) {
      car.laneWant = 1.35;
      car.laneHold = 1;
    }
  } else if (car.blocked < 0.08 && car.laneHold === 0 && !beside) {
    // Only come back to the line once there is nobody alongside: the old code
    // pulled back in as soon as the move was clean, which put the car straight
    // back behind the one it was passing, and nobody ever completed a pass.
    car.laneWant *= 0.93;
  }
  // Wheel to wheel keeps a move that is already on: a driver does not steer
  // back into the car they are alongside of, they finish the job. Only a car
  // that has committed to a side holds its lane — otherwise a car merely
  // following closely would hold one for ever and never attack again.
  if (beside && car.laneWant !== 0) car.laneHold = Math.max(car.laneHold, 0.4);
  car.lane += (car.laneWant - car.lane) * Math.min(1, dt * 3.4);

  // ── The aim point: the line a little way down the road, never asking for
  // more than a couple of metres of sideways movement in one lookahead — a car
  // that has just been spun aims at the tarmac beside it, not across the
  // barrier — and never diving for the line before it is rolling, so the whole
  // field pulls away straight off the grid.
  const li = (here + Math.max(1, Math.round((5 + speed * 0.5) / ds))) % n;
  const lp = track.points[li]!;
  const lr = track.rights[li]!;
  const room = beside ? -Math.sign(besideLat) * hw * 0.12 : 0;
  const want = Math.max(
    -hw * 0.78,
    Math.min(hw * 0.78, guide.offset[li]! + car.lane * hw * 0.3 + room),
  );
  const commit = Math.min(1, speed / 20);
  const desired = latNow + (want - latNow) * commit;
  const reach = 2.4 + speed * 0.045;
  const aimOff = Math.max(latNow - reach, Math.min(latNow + reach, desired));
  const ax = lp.x + lr.x * aimOff - s.x;
  const az = lp.z + lr.z * aimOff - s.z;
  const dist = Math.max(3, Math.hypot(ax, az));
  const aimYaw = Math.atan2(ax, az);
  const headErr = Math.atan2(Math.sin(aimYaw - s.yaw), Math.cos(aimYaw - s.yaw));

  // ── Steering: the lock the corner itself asks for, taken from the car's own
  // model, plus the correction for where the car actually is. The first term
  // is what makes the field turn in with the corner instead of running wide
  // and finding the barrier; the second is what keeps it on the line it chose.
  const ahead = (here + Math.max(1, Math.round((3 + speed * 0.35) / ds))) % n;
  const kappaCmd = (2 * Math.sin(headErr)) / dist + guide.kappa[ahead]!;
  let steer = lockFor(kappaCmd, speed);

  // ── Keep off the paint. The barrier matters where the car will be in a
  // third of a second, not where it is now, so the correction comes from the
  // predicted path: early and small, rather than a shunt and a spin.
  const hard = hw * 0.86;
  const wander = latNow + latVel * 0.34;
  if (Math.abs(wander) > hard) {
    const over = Math.abs(wander) - hard;
    steer += -Math.sign(wander) * Math.min(0.6, 0.2 + over * 0.35);
    if (latVel * Math.sign(wander) > 1.6) target = Math.min(target, speed * 0.94);
  }

  // ── Hands: the wheel is wound on at a human rate and never snapped to full
  // lock; off the line only a slice of it is on offer, so the field pulls away
  // straight and turns in progressively. A car still settling back onto the
  // road after a recovery asks for less than one on a flying lap.
  const calm = car.rejoin > 0 ? 0.78 : 1;
  const grip = Math.min(1, 0.3 + speed * 0.085) * calm;
  const locked = Math.max(-grip, Math.min(grip, steer));
  const slew = (3.4 + speed * 0.12) * dt;
  car.steerCmd += Math.max(-slew, Math.min(slew, locked - car.steerCmd));

  // ── Pedals: on the power up to the limit, off it and onto the brakes only
  // when the corner is genuinely beyond what the car is doing. A racing driver
  // carries the throttle through a corner; the old rule cut it whenever the
  // wheel was turned, which is most of the lap, and that is what made the
  // field look like it was coasting from one brake zone to the next.
  let throttle = 0;
  let brake = false;
  if (speed < target - 0.5) {
    throttle = 1;
  } else if (speed < target + 0.8) {
    throttle = Math.max(0.22, 1 - (speed - target) * 0.5);
  } else {
    brake = speed > target + 1.5;
  }
  return { throttle, steer: car.steerCmd, brake };
}

/**
 * Last resort: a car that cannot free itself even with the reverse is lifted
 * back onto the road facing the right way. Rare by design — the recovery
 * sequence does the real work — but a race of twenty cars cannot afford one of
 * them parked for the afternoon.
 */
export function unstuck(car: AiCar, track: ClubCircuit): boolean {
  const near = nearestTrack(track, car.state.x, car.state.z, car.index);
  const point = near.point;
  const right = near.right;
  if (!point || !right) return false;
  const side = car.lane * 2.2;
  car.state.x = point.x + right.x * side;
  car.state.z = point.z + right.z * side;
  const tangent = track.curve.getTangentAt(
    Math.max(0, Math.min(1, near.index / Math.max(1, track.points.length))),
  );
  car.state.yaw = Math.atan2(tangent.x, tangent.z);
  car.state.vx = tangent.x * 9;
  car.state.vz = tangent.z * 9;
  car.state.speed = 9;
  car.state.gear = 1;
  car.stuck = 0;
  car.recover = 0;
  car.rejoin = 1.4;
  car.rescues = 0;
  car.steerCmd = 0;
  return true;
}

// ─── Standings ────────────────────────────────────────────────────────────────

export type RaceRow = {
  pos: number;
  name: string;
  short: string;
  color: string;
  laps: number;
  best: number | null;
  /** Seconds behind the leader; null for the winner of a finished car. */
  gap: number | null;
  /** Race time at the flag, once the car is home. */
  finishedAt: number | null;
  player: boolean;
};

export type Standings = {
  rows: RaceRow[];
  /** 1-based position of the player right now. */
  playerPos: number;
  /** Laps the leader has completed. */
  leaderLaps: number;
};

type Progress = {
  name: string;
  short: string;
  color: string;
  odometer: number;
  laps: number;
  best: number | null;
  finishedAt: number | null;
  speed: number;
  player: boolean;
};

/**
 * The classification: cars that are home rank by the time they crossed, the
 * rest by the ground they have covered, which is exactly what the tower shows.
 */
export function classify(field: Progress[], totalLaps: number): Standings {
  const sorted = [...field].sort((a, b) => {
    if (a.finishedAt !== null && b.finishedAt !== null) return a.finishedAt - b.finishedAt;
    if (a.finishedAt !== null) return -1;
    if (b.finishedAt !== null) return 1;
    return b.odometer - a.odometer;
  });
  const leader = sorted[0]!;
  const rows = sorted.map((entry, i): RaceRow => {
    const laps = Math.min(totalLaps, entry.laps);
    const behind = Math.max(0, leader.odometer - entry.odometer);
    return {
      pos: i + 1,
      name: entry.name,
      short: entry.short,
      color: entry.color,
      laps,
      best: entry.best,
      gap:
        entry.finishedAt !== null && i === 0
          ? 0
          : entry.finishedAt !== null
            ? entry.finishedAt - (leader.finishedAt ?? 0)
            : behind / Math.max(6, entry.speed),
      finishedAt: entry.finishedAt,
      player: entry.player,
    };
  });
  const playerIndex = rows.findIndex((row) => row.player);
  return { rows, playerPos: playerIndex < 0 ? sorted.length : playerIndex + 1, leaderLaps: leader.laps };
}

/** Formats a race time the way a timing tower does: 1:23.4. */
export function raceTime(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const total = Math.max(0, seconds);
  const minutes = Math.floor(total / 60);
  const rest = total - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
}

// ─── Field helpers ────────────────────────────────────────────────────────────

/** Creates the running field for a race: state, setup and a fresh grid slot. */
export function createField(
  specs: RivalSpec[],
  track: ClubCircuit,
  topSpeed: number,
  level: number,
): AiCar[] {
  const slots = startGrid(track, specs.length + 1);
  void level;
  return specs.map((spec, i) => {
    const rng = makeRng(0x2f1b + i * 977);
    const state = newDriveState();
    const slot = slots[i]!;
    state.x = slot.x;
    state.z = slot.z;
    state.yaw = slot.yaw;
    const jitter = (rng() - 0.5) * 0.05;
    return {
      spec,
      state,
      config: driveSetup(spec.car, topSpeed * (0.97 + rng() * 0.06)),
      index: slot.index,
      odometer: 0,
      laps: 0,
      crossedAt: 0,
      lapStart: 0,
      best: null,
      finishedAt: null,
      lane: (i % 3 - 1) * 0.5,
      laneWant: 0,
      steerCmd: 0,
      laneHold: 0,
      pace: 1 + jitter,
      stuck: 0,
      recover: 0,
      rejoin: 0,
      rescues: 0,
      blocked: 0,
    };
  });
}

/** The grid slot the player starts from: last, like every good comeback. */
export function playerSlot(track: ClubCircuit, count: number): GridSlot {
  return startGrid(track, count + 1)[count]!;
}

// ─── Race state ───────────────────────────────────────────────────────────────

export type RacePhase = "countdown" | "racing" | "finished";

export type PlayerRace = {
  x: number;
  z: number;
  vx: number;
  vz: number;
  yaw: number;
  speed: number;
  index: number;
  /** Metres travelled since the start line, like every rival's odometer. */
  odometer: number;
  laps: number;
  best: number | null;
  offTrack: boolean;
  finishedAt: number | null;
  /** Books a hit against another car: bends the player's bodywork. */
  bump: (severity: number) => void;
  /** The contact resolution pushes the player's own state back into the sim. */
  shove: (x: number, z: number, vx: number, vz: number) => void;
};

export type RaceState = {
  phase: RacePhase;
  /** Total laps of the event. */
  laps: number;
  level: number;
  /** Race clock in seconds since the lights went out. */
  time: number;
  /** Performance-clock second the grid is released. */
  startAt: number;
  /** Performance-clock second the lights went out. */
  t0: number;
  /** Countdown digit shown to the player, 0 once the race is on. */
  lights: number;
  guide: TrackGuide;
  cars: AiCar[];
  player: PlayerRace;
  /** Debug: touch events between cars, counted to tune the AI's manners. */
  bumps?: number;
};

/** Keeps a car on the island: the barrier clamps it and hands back a shove. */
export function clampWall(
  state: DriveState,
  point: { x: number; z: number } | undefined,
  right: { x: number; z: number } | undefined,
  lateral: number,
  halfWidth: number,
) {
  if (!point || !right) return;
  const abs = Math.abs(lateral);
  const limit = halfWidth + 1.25;
  if (abs <= limit) return;
  const push = lateral > 0 ? -1 : 1;
  const correction = (abs - limit) * push;
  state.x += right.x * correction;
  state.z += right.z * correction;
  const outX = -right.x * push;
  const outZ = -right.z * push;
  const outward = state.vx * outX + state.vz * outZ;
  if (outward <= 0) return;
  const square = Math.min(1, outward / Math.max(2, state.speed));
  const bounce = 1 + 0.4 * square;
  state.vx -= outX * outward * bounce;
  state.vz -= outZ * outward * bounce;
}

/** Corner-speed pace the difficulty slider buys, for the setup screen. */
export function paceFor(level: number) {
  return aiStyle(level).pace;
}

/**
 * One physics step for one rival: stay on the road, hold the corner speed and
 * bank the ground covered. It runs the same `stepDrive` the player uses, so a
 * rival that asks too much of its front tyres understeers and loses time on
 * the grass exactly like the player does.
 */
export function stepAiCar(
  car: AiCar,
  guide: TrackGuide,
  track: ClubCircuit,
  others: AiCar[],
  playerAt: { x: number; z: number; vx: number; vz: number; speed: number } | null,
  level: number,
  dt: number,
) {
  const s = car.state;
  const near = nearestTrack(track, s.x, s.z, car.index);
  car.index = near.index;
  const off = Math.abs(near.lateral) > track.halfWidth;
  clampWall(s, near.point, near.right, near.lateral, track.halfWidth);
  if (off) {
    const drag = Math.exp(-1.4 * dt);
    s.vx *= drag;
    s.vz *= drag;
  }
  const style = aiStyle(level);
  car.rejoin = Math.max(0, car.rejoin - dt);
  const beforeX = s.x;
  const beforeZ = s.z;

  // ── Recovery. A car that has stopped — in the gravel, nose to the barrier,
  // spun — backs out of it and rejoins on its own, and is only lifted back
  // onto the road if it cannot manage that. Standing still for three seconds
  // while the race went past is what used to happen, and it is why the pack
  // read as a field of children.
  if (car.recover > 0) {
    car.recover -= dt;
    if (car.recover > 0.5) {
      // Backing out, with the wheel turned so the nose swings toward the road
      // rather than the barrier: in reverse the car yaws the other way, so the
      // correction is asked for with the sign flipped.
      const point = track.points[car.index]!;
      const next = track.points[(car.index + 2) % track.points.length]!;
      const roadYaw = Math.atan2(next.x - point.x, next.z - point.z);
      const err = Math.atan2(Math.sin(roadYaw - s.yaw), Math.cos(roadYaw - s.yaw));
      const steer = Math.max(-0.6, Math.min(0.6, -err * 1.1));
      stepDrive(s, { throttle: 0, steer, brake: true, drift: false }, car.config, dt);
    } else {
      // Rolling again: throttle down, and only as much wheel as the line asks
      // for, which the calm window on `rejoin` keeps gentle.
      stepDrive(
        s,
        { ...aiDrive(car, guide, track, others, playerAt, style, dt), drift: false },
        car.config,
        dt,
      );
    }
    car.odometer += Math.hypot(s.x - beforeX, s.z - beforeZ);
    if (s.speed < 1.5) car.stuck += dt;
    return;
  }

  if (s.speed < 2.5) car.stuck += dt;
  else car.stuck = 0;
  if (car.stuck > 1.1) {
    car.stuck = 0;
    if (car.rescues >= 2) {
      unstuck(car, track);
    } else {
      car.rescues++;
      car.recover = 1.15;
      car.rejoin = 1.8;
      car.steerCmd = 0;
    }
    return;
  }

  stepDrive(
    s,
    { ...aiDrive(car, guide, track, others, playerAt, style, dt), drift: false },
    car.config,
    dt,
  );
  car.odometer += Math.hypot(s.x - beforeX, s.z - beforeZ);
}
