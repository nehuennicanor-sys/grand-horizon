export type Category = "deportivo" | "superdeportivo" | "carreras";
export type Layout =
  | "I3"
  | "I4"
  | "I5"
  | "I6"
  | "V6"
  | "V8"
  | "V10"
  | "V12"
  | "V16"
  | "W16"
  | "H4"
  | "H6"
  | "R2"
  | "R3";
export type Aspiration =
  "atmosferico" | "turbo" | "biturbo" | "compresor" | "electrico" | "hibrido";
export type Gearbox = "manual" | "automatica" | "doble-embrague" | "secuencial" | "cvt";
export type Drive = "FWD" | "RWD" | "AWD";
export type Material = "acero" | "aluminio" | "carbono" | "titanio" | "magnesio";
export type Tires = "eco" | "deportivo" | "semi-slick" | "slick" | "lluvia" | "todo-terreno";
export type Diff = "abierto" | "autoblocante" | "electronico" | "torque-vectoring" | "activo";
export type Suspension = "confort" | "deportiva" | "competicion" | "adaptativa" | "hidraulica";
export type Brakes = "estandar" | "deportivos" | "carbono" | "ceramica" | "carbono-ceramica";
export type WheelStyle = "rayos" | "multirayo" | "disco" | "malla" | "turbina" | "estrella";
export type SeatStyle = "touring" | "bucket" | "carbono" | "racing" | "ergonomico";
export type InteriorTrim = "alcantara" | "cuero" | "competicion" | "carbono" | "mixto";

/**
 * The sculptor of the bodywork: the dials are the mould. Every value is 0..1
 * and the neutral moulding is 0.5, so the car the user shapes is their own
 * design instead of any preset silhouette.
 */
export interface Sculpt {
  length: number;
  width: number;
  height: number;
  /** Nose height and rake of the front end. */
  nose: number;
  /** Bonnet line: how high the hood rides over the engine bay. */
  hood: number;
  /** Windshield rake: how laid back the glass is over the cabin. */
  rake: number;
  cabin: number;
  /** Tail height and kick of the rear deck. */
  tail: number;
  wing: number;
  arches: number;
  /** Panel curvature: how round the shoulders and creases are. */
  curves: number;
}

export const NEUTRAL_SCULPT: Sculpt = {
  length: 0.5,
  width: 0.5,
  height: 0.5,
  nose: 0.5,
  hood: 0.5,
  rake: 0.5,
  cabin: 0.5,
  tail: 0.5,
  wing: 0.5,
  arches: 0.5,
  curves: 0.5,
};

export interface CarConfig {
  name: string;
  category: Category;
  /** Base bodywork chosen in the workshop. Absent means the sculpted shell. */
  bodyId?: string | undefined;
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
  interiorColor: string;
  seatStyle: SeatStyle;
  interiorTrim: InteriorTrim;
  rollCage: boolean;
  sculpt: Sculpt;
}

export const LAYOUTS: Record<Layout, { cyl: number; weight: number; factor: number }> = {
  I3: { cyl: 3, weight: 90, factor: 0.95 },
  I4: { cyl: 4, weight: 120, factor: 1 },
  I5: { cyl: 5, weight: 145, factor: 1.02 },
  I6: { cyl: 6, weight: 170, factor: 1.04 },
  V6: { cyl: 6, weight: 160, factor: 1.03 },
  V8: { cyl: 8, weight: 200, factor: 1.06 },
  V10: { cyl: 10, weight: 230, factor: 1.09 },
  V12: { cyl: 12, weight: 260, factor: 1.12 },
  V16: { cyl: 16, weight: 340, factor: 1.16 },
  W16: { cyl: 16, weight: 330, factor: 1.15 },
  H4: { cyl: 4, weight: 110, factor: 0.98 },
  H6: { cyl: 6, weight: 165, factor: 1.03 },
  R2: { cyl: 2, weight: 70, factor: 0.9 },
  R3: { cyl: 3, weight: 85, factor: 0.93 },
};

export const ASP = {
  atmosferico: { hpl: 78, flat: 0, w: 0 },
  turbo: { hpl: 105, flat: 0.5, w: 25 },
  biturbo: { hpl: 125, flat: 0.65, w: 45 },
  compresor: { hpl: 112, flat: 0.8, w: 35 },
  electrico: { hpl: 130, flat: 1, w: 50 },
  hibrido: { hpl: 115, flat: 0.9, w: 40 },
} as const;

// Baseline shell per class: the category sets the character, the moulding
// dials then move mass, drag and frontal area around that baseline.
const SHELL: Record<Category, { mass: number; cd: number; area: number }> = {
  deportivo: { mass: 1180, cd: 0.31, area: 2.06 },
  superdeportivo: { mass: 1010, cd: 0.35, area: 1.86 },
  carreras: { mass: 1130, cd: 0.32, area: 1.98 },
};

const MAT = { acero: 1, aluminio: 0.82, carbono: 0.66, titanio: 0.58, magnesio: 0.72 } as const;
export const TIRE_MU = {
  eco: 0.85,
  deportivo: 1.05,
  "semi-slick": 1.3,
  slick: 1.45,
  lluvia: 1.15,
  "todo-terreno": 0.75,
} as const;
export const SHIFT = {
  manual: 0.45,
  automatica: 0.25,
  "doble-embrague": 0.08,
  secuencial: 0.05,
  cvt: 0.18,
} as const;
export const DIFF_GRIP = {
  abierto: 0.94,
  autoblocante: 1.03,
  electronico: 1.06,
  "torque-vectoring": 1.1,
  activo: 1.08,
} as const;
export const SUSP = {
  confort: 0.94,
  deportiva: 1.03,
  competicion: 1.1,
  adaptativa: 1.06,
  hidraulica: 0.98,
} as const;
export const BRAKE = {
  estandar: 0.9,
  deportivos: 1.02,
  carbono: 1.12,
  ceramica: 1.08,
  "carbono-ceramica": 1.18,
} as const;
export const DRIVE_SHARE = { FWD: 0.58, RWD: 0.62, AWD: 1 } as const;
export const DRIVE_EFF = { FWD: 0.9, RWD: 0.88, AWD: 0.84 } as const;

export const PRESETS: Record<Category, Partial<CarConfig>> = {
  deportivo: {
    layout: "I6",
    displacement: 3.0,
    aspiration: "biturbo",
    maxRpm: 7200,
    boost: 0.5,
    gearbox: "doble-embrague",
    gears: 6,
    finalDrive: 5.0,
    drive: "RWD",
    material: "aluminio",
    tires: "deportivo",
    downforce: 0.3,
    spoiler: true,
    stripes: true,
    wheelSize: 19,
  },
  superdeportivo: {
    layout: "V12",
    displacement: 6.5,
    aspiration: "atmosferico",
    maxRpm: 9000,
    boost: 0.5,
    gearbox: "doble-embrague",
    gears: 8,
    finalDrive: 6.4,
    drive: "AWD",
    material: "carbono",
    tires: "semi-slick",
    downforce: 0.6,
    spoiler: true,
    stripes: false,
    wheelSize: 21,
  },
  carreras: {
    layout: "V8",
    displacement: 4.0,
    aspiration: "biturbo",
    maxRpm: 8500,
    boost: 0.65,
    // A sequential six-speed, a wing that presses the car down and a shell that
    // rides on its bump stops: the GT3 recipe.
    gearbox: "secuencial",
    gears: 6,
    finalDrive: 4.9,
    drive: "RWD",
    material: "carbono",
    tires: "semi-slick",
    downforce: 0.9,
    spoiler: true,
    stripes: true,
    wheelSize: 19,
    rideHeight: 0.08,
  },
};

export function defaultCar(cat: Category = "deportivo"): CarConfig {
  return {
    name: "Proyecto X",
    category: cat,
    color: cat === "superdeportivo" ? "#e9c22f" : cat === "carreras" ? "#1f56b4" : "#e8eef5",
    accent: "#111318",
    wheelColor: "#2a2d33",
    wheelStyle: "rayos",
    diff: cat === "deportivo" ? "autoblocante" : "electronico",
    suspension: cat === "deportivo" ? "deportiva" : "competicion",
    brakes: cat === "deportivo" ? "deportivos" : "carbono",
    rideHeight: cat === "deportivo" ? 0.35 : 0.12,
    roof: cat === "superdeportivo" ? 0.25 : 0.4,
    interiorColor: "#17191d",
    seatStyle: cat === "deportivo" ? "touring" : "carbono",
    interiorTrim: cat === "carreras" ? "competicion" : "alcantara",
    rollCage: cat === "carreras",
    // Each class starts from a different moulding, which is what keeps the three
    // categories apart before the user touches a single dial.
    sculpt: {
      length: cat === "deportivo" ? 0.55 : cat === "superdeportivo" ? 0.62 : 0.75,
      width: cat === "deportivo" ? 0.42 : cat === "superdeportivo" ? 0.62 : 0.68,
      height: cat === "deportivo" ? 0.6 : cat === "superdeportivo" ? 0.28 : 0.22,
      nose: cat === "deportivo" ? 0.45 : cat === "superdeportivo" ? 0.18 : 0.2,
      hood: cat === "deportivo" ? 0.55 : cat === "superdeportivo" ? 0.32 : 0.3,
      rake: cat === "deportivo" ? 0.45 : cat === "superdeportivo" ? 0.28 : 0.34,
      cabin: cat === "deportivo" ? 0.62 : cat === "superdeportivo" ? 0.26 : 0.24,
      tail: cat === "deportivo" ? 0.5 : cat === "superdeportivo" ? 0.75 : 0.56,
      wing: cat === "deportivo" ? 0.2 : cat === "superdeportivo" ? 0.55 : 0.88,
      arches: cat === "deportivo" ? 0.35 : cat === "superdeportivo" ? 0.6 : 0.82,
      curves: cat === "deportivo" ? 0.55 : cat === "superdeportivo" ? 0.35 : 0.3,
    },
    ...PRESETS[cat],
  } as CarConfig;
}

export function specs(c: CarConfig) {
  const L = LAYOUTS[c.layout];
  const a = ASP[c.aspiration];
  const boostMul =
    c.aspiration === "atmosferico"
      ? 1
      : c.aspiration === "electrico"
        ? 1.1
        : c.aspiration === "hibrido"
          ? 0.95 + c.boost * 0.3
          : 0.8 + c.boost * 0.5;
  const hp = c.displacement * a.hpl * boostMul * L.factor * (c.maxRpm / 6800);
  const peakRpm = c.maxRpm * (0.82 - a.flat * 0.12);
  const torqueNm = (hp * 745.7) / ((2 * Math.PI * peakRpm * 0.85) / 60);
  const engineMass = L.weight + c.displacement * 18 + a.w;
  const gbMass = c.gearbox === "manual" ? 45 : 70;
  const driveMass = c.drive === "AWD" ? 70 : 0;
  const shell = SHELL[c.category];
  // The moulding moves the numbers too: a longer, wider, taller body is heavier
  // and pushes more air, exactly like it does in the workshop.
  const sc = c.sculpt ?? NEUTRAL_SCULPT;
  const mass = Math.round(
    shell.mass * MAT[c.material] +
      engineMass +
      gbMass +
      driveMass +
      c.wheelSize * 4 +
      (c.spoiler ? 12 : 0) +
      (c.brakes === "carbono" ? -15 : 0) +
      (sc.width - 0.5) * 90 +
      (sc.length - 0.5) * 120 +
      (sc.height - 0.5) * 70,
  );
  const cd =
    shell.cd +
    c.downforce * 0.08 +
    (c.spoiler ? 0.015 : 0) +
    (c.roof - 0.5) * 0.04 +
    (c.rideHeight - 0.5) * 0.03 +
    (sc.wing - 0.5) * 0.035 +
    (sc.hood - 0.5) * 0.02;
  return {
    hp: Math.round(hp),
    torqueNm: Math.round(torqueNm),
    peakRpm,
    mass,
    cd,
    area: shell.area * (0.92 + c.roof * 0.16) * (0.94 + (sc.width - 0.5) * 0.18),
    cyl: L.cyl,
    hpPerTon: Math.round((hp / mass) * 1000),
  };
}

export function gearRatios(c: CarConfig) {
  // Real racing practice: a short first gear and a top gear that finally runs
  // out of revs. Top speed ends up geared, exactly like a real car.
  const first = 2.9,
    last = c.gears >= 8 ? 0.78 : c.gears >= 7 ? 0.8 : c.gears >= 6 ? 0.85 : 0.92;
  return Array.from(
    { length: c.gears },
    (_, i) => first * Math.pow(last / first, i / (c.gears - 1)),
  );
}

export function torqueAt(rpm: number, c: CarConfig, peakTq: number, peakRpm: number) {
  // The racing shell is mapped, not tuned for manners: its plateau is wider and
  // higher than the same aspiration in a road car, which is what makes the power
  // delivery linear out of a corner instead of a spike to be waited for.
  const race = c.category === "carreras";
  const flat = Math.min(1, ASP[c.aspiration].flat + (race ? 0.2 : 0));
  const x = rpm / peakRpm;
  let f =
    x < 1
      ? 0.55 + 0.45 * Math.pow(x, 0.8 - flat * 0.6)
      : 1 - Math.pow((rpm - peakRpm) / (c.maxRpm - peakRpm + 1), 2) * 0.35;
  if (flat > 0 && x > (race ? 0.3 : 0.35) && x < 1) f = Math.max(f, 0.9 + flat * 0.1);
  return peakTq * Math.max(0.3, Math.min(1, f));
}

export interface Sample {
  t: number;
  v: number;
  x: number;
  rpm: number;
  gear: number;
}
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
  const g = 9.81,
    rho = 1.2;
  const mu = TIRE_MU[c.tires];
  const shiftTime = SHIFT[c.gearbox];
  const eff = DRIVE_EFF[c.drive];
  const idle = 1000;
  let t = 0,
    v = 0,
    x = 0,
    gear = 0,
    shifting = 0,
    maxV = 0,
    flatTime = 0;
  let t100: number | null = null,
    t200: number | null = null,
    qmTime: number | null = null,
    qmSpeed: number | null = null;
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
      const grip =
        mu * DIFF_GRIP[c.diff] * (s.mass * g * DRIVE_SHARE[c.drive] + down * DRIVE_SHARE[c.drive]);
      drive = Math.min(drive, grip);
    } else shifting -= dt;
    const drag = 0.5 * rho * s.cd * s.area * v * v;
    const roll = 0.013 * (s.mass * g + down);
    const a = (drive - drag - roll) / (s.mass * 1.05);
    v = Math.max(0, v + a * dt);
    x += v * dt;
    t += dt;
    const kmh = v * 3.6;
    if (kmh > maxV + 0.05) {
      maxV = kmh;
      flatTime = 0;
    } else flatTime += dt;
    if (t100 === null && kmh >= 100) t100 = t;
    if (t200 === null && kmh >= 200) t200 = t;
    if (qmTime === null && x >= 402) {
      qmTime = t;
      qmSpeed = kmh;
    }
    if (t - lastSample >= 0.05) {
      samples.push({ t, v: kmh, x, rpm, gear: gear + 1 });
      lastSample = t;
    }
    if (flatTime > 3 && qmTime !== null) break;
  }
  const score = Math.round(
    Math.max(0, 1000 - (t100 ?? 20) * 60 - (qmTime ?? 30) * 15 + maxV * 1.5),
  );
  return { samples, t100, t200, qmTime, qmSpeed, topSpeed: Math.round(maxV), score };
}

export const RIVALS: { name: string; car: CarConfig }[] = [
  { name: "GT deportivo", car: { ...defaultCar("deportivo"), color: "#dfe6ee" } },
  { name: "Prototipo de carreras", car: { ...defaultCar("carreras"), color: "#1f56b4" } },
  { name: "Hiperauto V12", car: { ...defaultCar("superdeportivo"), color: "#e9c22f" } },
];

const CATEGORY_OF = (value: unknown): Category => {
  const s = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (s === "superdeportivo" || s === "super" || s === "supercar" || s === "hyper" || s === "hiper")
    return "superdeportivo";
  if (s === "carreras" || s === "normal" || s === "race" || s === "racing" || s === "gt3")
    return "carreras";
  return "deportivo";
};

// Every list the workshop can store. A configuration saved by an older build
// used to slip unknown keys past `defaultCar`, and a key the tables do not
// know reaches `specs()` as an undefined row — which took the whole station
// panel (and with it the options for the part) down with it.
const LAYOUT_IDS = Object.keys(LAYOUTS) as Layout[];
const ASPIRATION_IDS = Object.keys(ASP) as Aspiration[];
const GEARBOX_IDS = Object.keys(SHIFT) as Gearbox[];
const DRIVE_IDS: Drive[] = ["FWD", "RWD", "AWD"];
const MATERIAL_IDS: Material[] = ["acero", "aluminio", "carbono", "titanio", "magnesio"];
const TIRE_IDS = Object.keys(TIRE_MU) as Tires[];
const DIFF_IDS = Object.keys(DIFF_GRIP) as Diff[];
const SUSP_IDS = Object.keys(SUSP) as Suspension[];
const BRAKE_IDS = Object.keys(BRAKE) as Brakes[];
const WHEEL_IDS: WheelStyle[] = ["rayos", "multirayo", "disco", "malla", "turbina", "estrella"];
const SEAT_IDS: SeatStyle[] = ["touring", "bucket", "carbono", "racing", "ergonomico"];
const TRIM_IDS: InteriorTrim[] = ["alcantara", "cuero", "competicion", "carbono", "mixto"];

const pick = <T extends string>(value: unknown, ids: readonly T[], fallback: T): T =>
  typeof value === "string" && (ids as readonly string[]).includes(value) ? (value as T) : fallback;

const number = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const flag = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const paint = (value: unknown, fallback: string): string =>
  typeof value === "string" && /^#[0-9a-f]{3,8}$/i.test(value.trim()) ? value.trim() : fallback;

const label = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, 24) : fallback;

/**
 * Rebuilds a stored configuration field by field. Nothing from the raw object
 * is trusted: every enum is checked against the table it will be looked up in
 * and every number is clamped, so a car saved yesterday (or by another build)
 * can always be opened, edited and driven.
 */
export function normalizeCar(
  raw: Omit<Partial<CarConfig>, "category"> & { category?: unknown },
): CarConfig {
  const stored = raw as Omit<Partial<CarConfig>, "category"> & {
    category?: unknown;
    bodyId?: unknown;
    /** Old garage builds stored a factory-car id here. */
    gtId?: unknown;
  };
  const category = CATEGORY_OF(raw.category);
  const base = defaultCar(category);
  const legacyGt = typeof stored.gtId === "string" ? stored.gtId : undefined;
  const legacyBody =
    legacyGt === "porsche-carrera-gt"
      ? "coupe-v10"
      : legacyGt === "mercedes-amg-gt3-evo"
        ? "gt-v8"
        : undefined;
  const bodyId =
    typeof stored.bodyId === "string" && stored.bodyId
      ? stored.bodyId
      : legacyBody;
  const name =
    legacyBody === "coupe-v10"
      ? "Cupé V10"
      : legacyBody === "gt-v8"
        ? "GT V8"
        : label(raw.name, base.name);
  const sc = (raw as { sculpt?: unknown }).sculpt;
  const dial = (key: keyof Sculpt): number => {
    const source =
      typeof sc === "object" && sc !== null ? (sc as Record<string, unknown>)[key] : undefined;
    return number(source, base.sculpt[key], 0, 1);
  };
  return {
    name,
    category,
    bodyId,
    layout: pick(raw.layout, LAYOUT_IDS, base.layout),
    displacement: number(raw.displacement, base.displacement, 0.6, 9),
    aspiration: pick(raw.aspiration, ASPIRATION_IDS, base.aspiration),
    maxRpm: Math.round(number(raw.maxRpm, base.maxRpm, 2000, 17000) / 100) * 100,
    boost: number(raw.boost, base.boost, 0, 1),
    gearbox: pick(raw.gearbox, GEARBOX_IDS, base.gearbox),
    gears: Math.round(number(raw.gears, base.gears, 3, 8)),
    finalDrive: number(raw.finalDrive, base.finalDrive, 2, 8),
    drive: pick(raw.drive, DRIVE_IDS, base.drive),
    material: pick(raw.material, MATERIAL_IDS, base.material),
    tires: pick(raw.tires, TIRE_IDS, base.tires),
    downforce: number(raw.downforce, base.downforce, 0, 1),
    color: paint(raw.color, base.color),
    accent: paint(raw.accent, base.accent),
    wheelColor: paint(raw.wheelColor, base.wheelColor),
    spoiler: flag(raw.spoiler, base.spoiler),
    stripes: flag(raw.stripes, base.stripes),
    wheelSize: Math.round(number(raw.wheelSize, base.wheelSize, 13, 22)),
    wheelStyle: pick(raw.wheelStyle, WHEEL_IDS, base.wheelStyle),
    diff: pick(raw.diff, DIFF_IDS, base.diff),
    suspension: pick(raw.suspension, SUSP_IDS, base.suspension),
    brakes: pick(raw.brakes, BRAKE_IDS, base.brakes),
    rideHeight: number(raw.rideHeight, base.rideHeight, 0, 1),
    roof: number(raw.roof, base.roof, 0, 1),
    interiorColor: paint(raw.interiorColor, base.interiorColor),
    seatStyle: pick(raw.seatStyle, SEAT_IDS, base.seatStyle),
    interiorTrim: pick(raw.interiorTrim, TRIM_IDS, base.interiorTrim),
    rollCage: flag(raw.rollCage, base.rollCage),
    sculpt: {
      length: dial("length"),
      width: dial("width"),
      height: dial("height"),
      nose: dial("nose"),
      hood: dial("hood"),
      rake: dial("rake"),
      cabin: dial("cabin"),
      tail: dial("tail"),
      wing: dial("wing"),
      arches: dial("arches"),
      curves: dial("curves"),
    },
  };
}

export interface Handling {
  lateralG: number;
  braking: number;
  slalom: number;
  lapTime: number;
  rating: number;
}

export function handling(c: CarConfig, perf: Result): Handling {
  const s = specs(c);
  const mu = TIRE_MU[c.tires];
  const cg = 1 - c.rideHeight * 0.12; // lower = better
  const balance = c.drive === "AWD" ? 1.04 : c.drive === "RWD" ? 1.0 : 0.95;
  const massPen = Math.pow(1300 / s.mass, 0.12);
  const v = 160 / 3.6;
  const downG = (0.5 * 1.2 * v * v * s.area * c.downforce * 1.8) / (s.mass * 9.81);
  const lateralG =
    mu *
    cg *
    balance *
    massPen *
    SUSP[c.suspension] *
    (c.diff === "abierto" ? 0.98 : 1.02) *
    // The wing loads the tyres as well as the mass, and it is speed squared, so
    // the figure climbs from a road car's to a GT3's by the time the car is
    // quick. Same law `stepDrive` runs on, so the readout and the physics agree.
    (1 + downG * 2.2);
  const braking =
    Math.pow(100 / 3.6, 2) /
    (2 * 9.81 * Math.min(mu * BRAKE[c.brakes], mu * 1.05 + 0.1) * cg * massPen); // m 100-0
  const slalom = 52 + lateralG * 26 + (c.wheelSize - 15) * 0.4;
  // simple 3 km circuit: 1.8 km straights (use avg straight speed) + 1.2 km corners
  const vCorner = Math.sqrt(lateralG * 9.81 * 60) * 3.6;
  const vStraight = Math.min(perf.topSpeed, (perf.qmSpeed ?? 150) * 1.05);
  const lapTime = 1800 / ((vCorner + vStraight) / 2 / 3.6) + 1200 / (vCorner / 3.6);
  const rating = Math.round(
    Math.min(100, Math.max(0, (lateralG - 0.6) * 110 + (60 - braking) * 0.8 + 30)),
  );
  return { lateralG, braking, slalom, lapTime, rating };
}
