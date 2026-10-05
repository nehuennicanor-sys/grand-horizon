import { specs, type CarConfig } from './car';

export type DriveState = { x: number; z: number; vx: number; vz: number; yaw: number; speed: number; slip: number };
export type DriveInput = { throttle: number; steer: number; brake: boolean; drift: boolean };
export const newDriveState = (): DriveState => ({ x: 0, z: 0, vx: 0, vz: 0, yaw: 0, speed: 0, slip: 0 });
export function driveSetup(car: CarConfig, topSpeed: number) {
  const s = specs(car);
  return { acceleration: Math.min(15, Math.max(3, s.hpPerTon * .025)), maxSpeed: topSpeed / 3.6, grip: car.tires === 'semi-slick' ? 8 : 5.5, braking: car.brakes === 'carbono' ? 13 : 10 };
}
export function stepDrive(s: DriveState, input: DriveInput, config: ReturnType<typeof driveSetup>, delta: number) {
  const dt = Math.min(delta, .05);
  const forwardX = Math.sin(s.yaw), forwardZ = Math.cos(s.yaw);
  const rightX = Math.cos(s.yaw), rightZ = -Math.sin(s.yaw);
  let longitudinal = s.vx * forwardX + s.vz * forwardZ;
  let lateral = s.vx * rightX + s.vz * rightZ;
  longitudinal += input.throttle * config.acceleration * Math.max(.12, 1 - Math.max(0, longitudinal) / Math.max(1, config.maxSpeed)) * dt;
  if (input.brake) longitudinal = Math.sign(longitudinal) * Math.max(0, Math.abs(longitudinal) - config.braking * dt);
  longitudinal *= Math.exp(-.035 * dt);
  longitudinal = Math.max(-8, Math.min(config.maxSpeed, longitudinal));
  s.yaw += input.steer * 1.15 * Math.min(Math.abs(longitudinal) / 6, 1) / (1 + Math.abs(longitudinal) * .022) * Math.sign(longitudinal || 1) * dt;
  lateral *= Math.exp(-(input.drift ? 1.1 : config.grip) * dt);
  // Recompose using the previous heading: retaining lateral momentum creates subtle slip while steering.
  s.vx = forwardX * longitudinal + rightX * lateral;
  s.vz = forwardZ * longitudinal + rightZ * lateral;
  s.x += s.vx * dt; s.z += s.vz * dt;
  s.speed = Math.hypot(s.vx, s.vz);
  const angle = Math.atan2(s.vx, s.vz) - s.yaw;
  s.slip = s.speed > .1 ? Math.atan2(Math.sin(angle), Math.cos(angle)) : 0;
}