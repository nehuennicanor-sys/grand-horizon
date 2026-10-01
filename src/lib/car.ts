export type Category = "normal" | "deportivo" | "super";
export type Layout = "I3" | "I4" | "I6" | "V6" | "V8" | "V10" | "V12" | "W16";
export type Aspiration = "atmosferico" | "turbo" | "biturbo" | "compresor";
export type Gearbox = "manual" | "automatica" | "doble-embrague";
export type Drive = "FWD" | "RWD" | "AWD";
export type Material = "acero" | "aluminio" | "carbono";
export type Tires = "eco" | "deportivo" | "semi-slick";
export type Diff = "abierto" | "autoblocante" | "electronico";
export type Suspension = "confort" | "deportiva" | "competicion";
export type Brakes = "estandar" | "deportivos" | "carbono";
export type WheelStyle = "rayos" | "multirayo" | "disco" | "malla";
export type Body = "sedan" | "coupe" | "hiper";

export interface CarConfig {
  name: string;
  category: Category;
  layout: Layout;
  displacement: number; // L
  aspiration: Aspiration;
  maxRpm: number;
  boost: number; // 0..1
  gearbox: Gearbox;
  gears: number;
  finalDrive: number;
  drive: Drive;
  material: Material;
  tires: Tires;
  downforce: number; // 0..1
  body: Body;
  color: string;
  accent: string;
  wheelColor: string;
  spoiler: boolean;
  stripes: boolean;
  wheelSize: number; // inches
  wheelStyle: WheelStyle;
  diff: Diff;
  suspension: Suspension;
  brakes: Brakes;
  rideHeight: number; // 0 (low) .. 1 (high)
  roof: number; // 0 (low) .. 1 (tall)
}

export const LAYOUTS: Record<Layout, { cyl: number; weight: number; factor: number }> = {
  I3: { cyl: 3, weight: 90, factor: 0.95 },
  I4: { cyl: 4, weight: 120, factor: 1 },
  I6: { cyl: 6, weight: 170, factor: 1.04 },
  V6: { cyl: 6, weight: 160, factor: 1.03 },
  V8: { cyl: 8, weight: 200, factor: 1.06 },
  V10: { cyl: 10, weight: 230, factor: 1.09 },
  V12: { cyl: 12, weight: 260, factor: 1.12 },
  W16: { cyl: 16, weight: 330, factor: 1.15 },
};

const ASP = {
  atmosferico: { hpl: 78, flat: 0, w: 0 },
  turbo: { hpl: 105, flat: 0.5, w: 25 },
  biturbo: { hpl: 125, flat: 0.65, w: 45 },
  compresor: { hpl: 112, flat: 0.8, w: 35 },
} as const;

const BODY = {
  sedan: { mass: 1250, cd: 0.31, area: 2.25 },
  coupe: { mass: 1150, cd: 0.32, area: 2.0 },
  hiper: { mass: 1000, cd: 0.36, area: 1.85 },
} as const;

const MAT = { acero: 1, aluminio: 0.82, carbono: 0.66 } as const;
const TIRE_MU = { eco: 0.85, deportivo: 1.05, "semi-slick": 1.3 } as const;
const SHIFT = { manual: 0.45, automatica: 0.25, "doble-embrague": 0.08 } as const;
const DIFF_GRIP = { abierto: 0.94, autoblocante: 1.03, electronico: 1.06 } as const;
const SUSP = { confort: 0.94, deportiva: 1.03, competicion: 1.1 } as const;
const BRAKE = { estandar: 0.9, deportivos: 1.02, carbono: 1.12 } as const;
const DRIVE_SHARE = { FWD: 0.58, RWD: 0.62, AWD: 1 } as const;
const DRIVE_EFF = { FWD: 0.9, RWD: 0.88, AWD: 0.84 } as const;

export const PRESETS: Record<Category, Partial<CarConfig>> = {
  normal: { layout: "I4", displacement: 1.6, aspiration: "atmosferico", maxRpm: 6200, boost: 0.3, gearbox: "manual", gears: 5, finalDrive: 4.1, drive: "FWD", material: "acero", tires: "eco", downforce: 0, body: "sedan", spoiler: false, stripes: false, wheelSize: 16 },
  deportivo: { layout: "I6", displacement: 3.0, aspiration: "biturbo", maxRpm: 7200, boost: 0.5, gearbox: "doble-embrague", gears: 7, finalDrive: 3.4, drive: "RWD", material: "aluminio", tires: "deportivo", downforce: 0.3, body: "coupe", spoiler: true, stripes: true, wheelSize: 19 },
  super: { layout: "V12", displacement: 6.5, aspiration: "atmosferico", maxRpm: 9000, boost: 0.5, gearbox: "doble-embrague", gears: 7, finalDrive: 3.0, drive: "AWD", material: "carbono", tires: "semi-slick", downforce: 0.6, body: "hiper", spoiler: true, stripes: false, wheelSize: 21 },
};

export function defaultCar(cat: Category = "deportivo"): CarConfig {
  return {
    name: "Proyecto X",
    category: cat,
    color: cat === "super" ? "#ff5a1f" : cat === "deportivo" ? "#e8eef5" : "#2f6fd6",
    accent: "#111318",
    wheelColor: "#2a2d33",
    wheelStyle: "rayos",
    diff: cat === "normal" ? "abierto" : cat === "deportivo" ? "autoblocante" : "electronico",
    suspension: cat === "normal" ? "confort" : cat === "deportivo" ? "deportiva" : "competicion",
    brakes: cat === "normal" ? "estandar" : cat === "deportivo" ? "deportivos" : "carbono",
    rideHeight: cat === "normal" ? 0.6 : cat === "deportivo" ? 0.35 : 0.1,
    roof: cat === "normal" ? 0.6 : 0.4,
    ...PRESETS[cat],
  } as CarConfig;
}

export function specs(c: CarConfig) {
  const L = LAYOUTS[c.layout];
  const a = ASP[c.aspiration];
  const boostMul = c.aspiration === "atmosferico" ? 1 : 0.8 + c.boost * 0.5;
  const hp = c.displacement * a.hpl * boostMul * L.factor * (c.maxRpm / 6800);
  const peakRpm = c.maxRpm * (0.82 - a.flat * 0.12);
  const torqueNm = (hp * 745.7) / ((2 * Math.PI * peakRpm * 0.85) / 60);
  const engineMass = L.weight + c.displacement * 18 + a.w;
  const gbMass = c.gearbox === "manual" ? 45 : 70;
  const driveMass = c.drive === "AWD" ? 70 : 0;
  const mass = Math.round(BODY[c.body].mass * MAT[c.material] + engineMass + gbMass + driveMass + c.wheelSize * 4 + (c.spoiler ? 12 : 0) + (c.brakes === "carbono" ? -15 : 0));
  const cd = BODY[c.body].cd + c.downforce * 0.08 + (c.spoiler ? 0.015 : 0) + (c.roof - 0.5) * 0.04 + (c.rideHeight - 0.5) * 0.03;
  return { hp: Math.round(hp), torqueNm: Math.round(torqueNm), peakRpm, mass, cd, area: BODY[c.body].area * (0.92 + c.roof * 0.16), cyl: L.cyl, hpPerTon: Math.round((hp / mass) * 1000) };
}

export function gearRatios(c: CarConfig) {
  const first = 3.6, last = c.gears >= 7 ? 0.62 : c.gears >= 6 ? 0.72 : 0.82;
  return Array.from({ length: c.gears }, (_, i) => first * Math.pow(last / first, i / (c.gears - 1)));
}

function torqueAt(rpm: number, c: CarConfig, peakTq: number, peakRpm: number) {
  const flat = ASP[c.aspiration].flat;
  const x = rpm / peakRpm;
  let f = x < 1 ? 0.55 + 0.45 * Math.pow(x, 0.8 - flat * 0.6) : 1 - Math.pow((rpm - peakRpm) / (c.maxRpm - peakRpm + 1), 2) * 0.35;
  if (flat > 0 && x > 0.35 && x < 1) f = Math.max(f, 0.9 + flat * 0.1);
  return peakTq * Math.max(0.3, Math.min(1, f));
}

export interface Sample { t: number; v: number; x: number; rpm: number; gear: number }
export interface Result {
  samples: Sample[];
  t100: number | null;
  t200: number | null;
  qmTime: number | null;
  qmSpeed: number | null;
  topSpeed: number;
  score: number;
}

export function simulate(c: CarConfig, maxTime = 60): Result {
  const s = specs(c);
  const ratios = gearRatios(c);
  const r = (c.wheelSize * 0.0254) / 2 + 0.11;
  const g = 9.81, rho = 1.2;
  const mu = TIRE_MU[c.tires];
  const shiftTime = SHIFT[c.gearbox];
  const eff = DRIVE_EFF[c.drive];
  const idle = 1000;
  let t = 0, v = 0, x = 0, gear = 0, shifting = 0, maxV = 0, flatTime = 0;
  let t100: number | null = null, t200: number | null = null, qmTime: number | null = null, qmSpeed: number | null = null;
  const samples: Sample[] = [];
  const dt = 0.01;
  let lastSample = -1;
  while (t < maxTime) {
    const wheelRpm = (v / (2 * Math.PI * r)) * 60;
    let rpm = Math.max(idle + (gear === 0 ? 2500 : 0), wheelRpm * ratios[gear]! * c.finalDrive);
    if (rpm > c.maxRpm * 0.985 && gear < ratios.length - 1 && shifting <= 0) {
      gear++;
      shifting = shiftTime;
      rpm = wheelRpm * ratios[gear]! * c.finalDrive;
    }
    rpm = Math.min(rpm, c.maxRpm);
    const down = 0.5 * rho * v * v * s.area * c.downforce * 1.8;
    let drive = 0;
    if (shifting <= 0) {
      const tq = torqueAt(rpm, c, s.torqueNm, s.peakRpm);
      drive = (tq * ratios[gear]! * c.finalDrive * eff) / r;
      if (rpm >= c.maxRpm) drive *= 0.2;
      const grip = mu * DIFF_GRIP[c.diff] * (s.mass * g * DRIVE_SHARE[c.drive] + down * DRIVE_SHARE[c.drive]);
      drive = Math.min(drive, grip);
    } else shifting -= dt;
    const drag = 0.5 * rho * s.cd * s.area * v * v;
    const roll = 0.013 * (s.mass * g + down);
    const a = (drive - drag - roll) / (s.mass * 1.05);
    v = Math.max(0, v + a * dt);
    x += v * dt;
    t += dt;
    const kmh = v * 3.6;
    if (kmh > maxV + 0.05) { maxV = kmh; flatTime = 0; } else flatTime += dt;
    if (t100 === null && kmh >= 100) t100 = t;
    if (t200 === null && kmh >= 200) t200 = t;
    if (qmTime === null && x >= 402) { qmTime = t; qmSpeed = kmh; }
    if (t - lastSample >= 0.05) { samples.push({ t, v: kmh, x, rpm, gear: gear + 1 }); lastSample = t; }
    if (flatTime > 3 && qmTime !== null) break;
  }
  const score = Math.round(Math.max(0, 1000 - (t100 ?? 20) * 60 - (qmTime ?? 30) * 15 + maxV * 1.5));
  return { samples, t100, t200, qmTime, qmSpeed, topSpeed: Math.round(maxV), score };
}

export const RIVALS: { name: string; car: CarConfig }[] = [
  { name: "Hatchback familiar", car: { ...defaultCar("normal"), color: "#9aa3ad" } },
  { name: "Coupé deportivo", car: { ...defaultCar("deportivo"), color: "#d8312b" } },
  { name: "Hiperauto V12", car: { ...defaultCar("super"), color: "#f5c518" } },
];

export interface Handling { lateralG: number; braking: number; slalom: number; lapTime: number; rating: number }

export function handling(c: CarConfig, perf: Result): Handling {
  const s = specs(c);
  const mu = TIRE_MU[c.tires];
  const cg = 1 - c.rideHeight * 0.12; // lower = better
  const balance = c.drive === "AWD" ? 1.04 : c.drive === "RWD" ? 1.0 : 0.95;
  const massPen = Math.pow(1300 / s.mass, 0.12);
  const v = 160 / 3.6;
  const downG = (0.5 * 1.2 * v * v * s.area * c.downforce * 1.8) / (s.mass * 9.81);
  const lateralG = mu * cg * balance * massPen * SUSP[c.suspension] * (c.diff === "abierto" ? 0.98 : 1.02) * (1 + downG * 0.6);
  const braking = Math.pow(100 / 3.6, 2) / (2 * 9.81 * Math.min(mu * BRAKE[c.brakes], mu * 1.05 + 0.1) * cg * massPen); // m 100-0
  const slalom = 52 + lateralG * 26 + (c.wheelSize - 15) * 0.4;
  // simple 3 km circuit: 1.8 km straights (use avg straight speed) + 1.2 km corners
  const vCorner = Math.sqrt(lateralG * 9.81 * 60) * 3.6;
  const vStraight = Math.min(perf.topSpeed, (perf.qmSpeed ?? 150) * 1.05);
  const lapTime = 1800 / (((vCorner + vStraight) / 2) / 3.6) + 1200 / (vCorner / 3.6);
  const rating = Math.round(Math.min(100, Math.max(0, (lateralG - 0.6) * 110 + (60 - braking) * 0.8 + 30)));
  return { lateralG, braking, slalom, lapTime, rating };
}
