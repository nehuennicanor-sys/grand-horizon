import {
  DIFF_GRIP,
  DRIVE_EFF,
  DRIVE_SHARE,
  SHIFT,
  TIRE_MU,
  gearRatios,
  specs,
  torqueAt,
  type CarConfig,
} from "./car";

export type DriveState = {
  x: number;
  z: number;
  vx: number;
  vz: number;
  yaw: number;
  speed: number;
  slip: number;
  /** Current gear, 0-based. */
  gear: number;
  /** Engine speed in rpm, derived from the wheel through the current ratio. */
  rpm: number;
  /** Seconds of torque cut left while a shift is in progress. */
  shifting: number;
  /** Smoothed steering, -1..1, so the cockpit wheel turns like a real one. */
  steer: number;
};

export type DriveInput = { throttle: number; steer: number; brake: boolean; drift: boolean };

export const newDriveState = (): DriveState => ({
  x: 0,
  z: 0,
  vx: 0,
  vz: 0,
  yaw: 0,
  speed: 0,
  slip: 0,
  gear: 0,
  rpm: 0,
  shifting: 0,
  steer: 0,
});

export function driveSetup(car: CarConfig, topSpeed: number) {
  const s = specs(car);
  const ratios = gearRatios(car);
  const brakeBase = car.brakes === "carbono" ? 15.5 : car.brakes === "ceramica" ? 14.5 : 12;
  return {
    car,
    spec: s,
    /** Gearbox. The number of ratios and the shift speed come from the build. */
    ratios,
    gearCount: ratios.length,
    finalDrive: car.finalDrive,
    maxRpm: car.maxRpm,
    idleRpm: Math.min(1100, car.maxRpm * 0.16),
    wheelRadius: (car.wheelSize * 0.0254) / 2 + 0.11,
    shiftTime: SHIFT[car.gearbox],
    efficiency: DRIVE_EFF[car.drive],
    traction: TIRE_MU[car.tires] * DIFF_GRIP[car.diff],
    driveShare: DRIVE_SHARE[car.drive],
    downforce: car.downforce,
    /** Safety ceiling only: drag and gearing set the real top end. */
    maxSpeed: Math.max(35, topSpeed) / 3.6,
    grip:
      car.tires === "slick"
        ? 11
        : car.tires === "semi-slick"
          ? 10
          : car.tires === "deportivo"
            ? 8
            : 6.5,
    // A heavier car sheds speed more slowly, exactly like a real one.
    braking: brakeBase * Math.max(0.72, Math.min(1.25, 1250 / s.mass)),
    reverse: 9,
  };
}

const G = 9.81;
const RHO = 1.2;

/**
 * Damage the car carries through the current run. Written by the collision code
 * and read by the renderer and the HUD; a module singleton keeps it out of the
 * per-frame React path, exactly like the cockpit telemetry.
 */
export const damageState = { value: 0, wrecked: false, hits: 0, lastImpact: 0 };

export function resetDamage() {
  damageState.value = 0;
  damageState.wrecked = false;
  damageState.hits = 0;
  damageState.lastImpact = 0;
}

/**
 * Books a hit and reports whether it was worth reporting. `severity` is the
 * closing speed into the barrier in km/h, scaled by how square the hit was, so
 * a long scrape along the wall barely counts and a nose-first impact at speed
 * ends the race.
 */
export function applyImpact(severity: number) {
  if (!Number.isFinite(severity) || severity < 4) return false;
  damageState.hits++;
  damageState.lastImpact = severity;
  damageState.value = Math.min(1, damageState.value + severity * severity * 0.00045);
  if (damageState.value >= 1) {
    damageState.value = 1;
    damageState.wrecked = true;
  }
  return true;
}

/**
 * Fixed-step driving model. All quantities are SI (metres, seconds, m/s); the
 * caller accumulates real time and runs this at a constant 1/120 s step so the
 * handling is identical regardless of framerate.
 *
 * Longitudinal forces use the same gearbox, torque curve and traction limit as
 * the dyno in `simulate()`, so the car you build is the car you drive: it bogs
 * off the line in first, pulls hardest in the mid gears and runs out of revs in
 * top instead of accelerating flatly like an arcade kart.
 */
export function stepDrive(
  s: DriveState,
  input: DriveInput,
  config: ReturnType<typeof driveSetup>,
  delta: number,
) {
  const dt = Math.min(delta, 0.05);
  const forwardX = Math.sin(s.yaw),
    forwardZ = Math.cos(s.yaw);
  const rightX = Math.cos(s.yaw),
    rightZ = -Math.sin(s.yaw);
  let longitudinal = s.vx * forwardX + s.vz * forwardZ;
  let lateral = s.vx * rightX + s.vz * rightZ;

  // Input smoothing: the cockpit wheel and the front wheels read this.
  s.steer += (input.steer - s.steer) * Math.min(1, dt * 7);

  // ── Gearbox ─────────────────────────────────────────────────────────────
  // Engine speed is a function of road speed and the selected ratio, so pulling
  // away in first bogs instead of teleporting to peak power.
  const wheelRpm = (Math.max(0, longitudinal) / (2 * Math.PI * config.wheelRadius)) * 60;
  let rpm = Math.max(config.idleRpm, wheelRpm * config.ratios[s.gear]! * config.finalDrive);
  if (s.shifting > 0) s.shifting -= dt;
  if (s.shifting <= 0) {
    if (rpm > config.maxRpm * 0.985 && s.gear < config.gearCount - 1) {
      s.gear++;
      s.shifting = config.shiftTime;
    } else if (
      s.gear > 0 &&
      rpm < config.maxRpm * 0.45 &&
      (input.brake || input.throttle <= 0)
    ) {
      s.gear--;
      s.shifting = config.shiftTime * 0.5;
    }
  }
  rpm = Math.max(
    config.idleRpm,
    Math.min(config.maxRpm, wheelRpm * config.ratios[s.gear]! * config.finalDrive),
  );
  s.rpm = s.shifting > 0 ? rpm * 0.93 : rpm;

  // ── Longitudinal forces ─────────────────────────────────────────────────
  const down =
    0.5 * RHO * Math.max(0, longitudinal) ** 2 * config.spec.area * config.downforce * 1.8;
  let driveForce = 0;
  if (input.throttle > 0 && s.shifting <= 0) {
    const torque = torqueAt(rpm, config.car, config.spec.torqueNm, config.spec.peakRpm);
    driveForce =
      (torque * config.ratios[s.gear]! * config.finalDrive * config.efficiency) /
      config.wheelRadius;
    if (rpm >= config.maxRpm) driveForce *= 0.2;
    // Traction circle: you can only put down what the tyres and diff will hold.
    const traction =
      config.traction * (config.spec.mass * G * config.driveShare + down * config.driveShare);
    driveForce = Math.min(driveForce, traction) * input.throttle;
  } else if (longitudinal > 0) {
    // Off the throttle the drivetrain drags the car down: no free coasting.
    driveForce = -config.spec.mass * 0.26 * Math.min(1, longitudinal / 22);
  }
  const drag = Math.sign(longitudinal) * 0.5 * RHO * config.spec.cd * config.spec.area * longitudinal * longitudinal;
  const rolling = Math.sign(longitudinal || 1) * 0.013 * (config.spec.mass * G + down);
  longitudinal += ((driveForce - drag - rolling) / (config.spec.mass * 1.05)) * dt;

  // ── Brakes and reverse ──────────────────────────────────────────────────
  if (input.brake) {
    if (longitudinal > 0.3) {
      // S first scrubs forward speed…
      longitudinal = Math.max(0, longitudinal - config.braking * dt);
    } else if (input.throttle <= 0) {
      // …then engages a limited reverse gear.
      longitudinal = Math.max(-config.reverse, longitudinal - 5.5 * dt);
    }
  }
  longitudinal = Math.max(-config.reverse, Math.min(config.maxSpeed * 1.25, longitudinal));

  // ── Steering ────────────────────────────────────────────────────────────
  // Needs a little rolling speed to bite, then tightens with velocity so the
  // car feels planted and heavy at speed instead of darty like a toy.
  const speedAbs = Math.abs(longitudinal);
  // Downforce buys steering authority as well as grip: the faster the car goes
  // the harder the wing presses the front axle onto the road, so the wheel can
  // be wound on where a road car would have to wait for the corner.
  const aeroG = down / (config.spec.mass * G);
  const steerRate =
    (s.steer * 1.7 * (1 + Math.min(0.32, aeroG * 0.55)) * Math.min(speedAbs / 3.5, 1)) /
    (1 + speedAbs * 0.032);
  s.yaw += steerRate * Math.sign(longitudinal || 1) * dt;

  // ── Lateral grip ────────────────────────────────────────────────────────
  // Recomposing with the previous heading keeps a subtle slip angle, and the
  // handbrake (space) retains more lateral momentum for drifting.
  // Grip grows with the wing's load: the same slip angle holds far more lateral
  // force at speed, so the car carries the fast corner the street car has to
  // brake for. The handbrake still lets the rear step out.
  lateral *= Math.exp(-(input.drift ? 1.2 : config.grip * (1 + aeroG * 2.2)) * dt);

  s.vx = forwardX * longitudinal + rightX * lateral;
  s.vz = forwardZ * longitudinal + rightZ * lateral;
  s.x += s.vx * dt;
  s.z += s.vz * dt;
  s.speed = Math.hypot(s.vx, s.vz);
  const angle = Math.atan2(s.vx, s.vz) - s.yaw;
  s.slip = s.speed > 0.1 ? Math.atan2(Math.sin(angle), Math.cos(angle)) : 0;
}
