import * as THREE from "three";

// One metre per world unit; render geometry and boundaries share this curve.
// Twelve circuits inspired by the original Gran Turismo layouts, three per
// licence tier (beginner, intermediate, advanced, professional). The control
// polygons are corner-cut with Chaikin smoothing before the spline is built,
// so every corner ends up as a real arc instead of a kink.
export const TRACK_HALF_WIDTH = 8;

export type CircuitId =
  | "highspeedring"
  | "tokyoexpressway"
  | "bluemoonbay"
  | "deepforest"
  | "grandvalley"
  | "dragontrail"
  | "ssr5"
  | "trialmountain"
  | "autumnring"
  | "cotazur"
  | "eigernordwand"
  | "route246";

export type SceneryKind = "forest" | "city" | "speedway" | "valley" | "mountain" | "coast";

export type SceneryProfile = {
  kind: SceneryKind;
  /** Grandstands placed along the lap (each one carries its own crowd). */
  stands: number;
  /** Buildings scattered outside the barriers: the skyline while driving. */
  buildings: number;
  /** Distance range from the track edge to the first row of buildings. */
  near: number;
  far: number;
  neon: boolean;
  night: boolean;
  trees: number;
  /** Palms on the coastal layout. */
  palms: number;
  /** Sea plane colour, or null when the layout has no water. */
  water: string | null;
  /** Portals: rock arches on the mountain, expressway gantries in the city. */
  overpasses: number;
  grass: string;
  dirt: string;
  buildingTint: string;
  crowdSeed: number;
};

type CircuitSpec = {
  name: string;
  country: string;
  style: string;
  note: string;
  /** Printed length in km, used by the pit-wall readouts. */
  length: number;
  factor: number;
  /** 1 = easy … 4 = professional: how much the layout punishes a mistake. */
  difficulty: 1 | 2 | 3 | 4;
  /** Half width of the asphalt in metres: the tight circuits also run narrow. */
  halfWidth: number;
  /** Superellipse + harmonic shape: smooth by construction. */
  shape: {
    a: number;
    b: number;
    n: number;
    h1: number;
    k1: number;
    p1: number;
    h2: number;
    k2: number;
    p2: number;
    /** Optional third harmonic: extra corners for the technical layouts. */
    h3?: number;
    k3?: number;
    p3?: number;
  };
  profile: SceneryProfile;
};

const FOREST: SceneryProfile = {
  kind: "forest",
  stands: 13,
  buildings: 87,
  near: 42,
  far: 210,
  neon: false,
  night: false,
  trees: 2.2,
  palms: 0,
  water: null,
  overpasses: 0,
  grass: "#4e6b46",
  dirt: "#3d5335",
  buildingTint: "#6f7a86",
  crowdSeed: 11,
};

// Night street circuit: skyscrapers, signs and lamps instead of trees.
const CITY: SceneryProfile = {
  kind: "city",
  stands: 11,
  buildings: 126,
  near: 26,
  far: 300,
  neon: true,
  night: true,
  trees: 0,
  palms: 0,
  water: null,
  overpasses: 7,
  grass: "#33383e",
  dirt: "#2a2e33",
  buildingTint: "#6a7280",
  crowdSeed: 23,
};

const SPEEDWAY: SceneryProfile = {
  kind: "speedway",
  stands: 14,
  buildings: 59,
  near: 52,
  far: 250,
  neon: false,
  night: false,
  trees: 0.5,
  palms: 0,
  water: null,
  overpasses: 0,
  grass: "#577251",
  dirt: "#465c3e",
  buildingTint: "#77828e",
  crowdSeed: 37,
};

const VALLEY: SceneryProfile = {
  kind: "valley",
  stands: 11,
  buildings: 78,
  near: 50,
  far: 230,
  neon: false,
  night: false,
  trees: 1.8,
  palms: 0,
  water: "#3f7591",
  overpasses: 2,
  grass: "#557a4b",
  dirt: "#43633c",
  buildingTint: "#7a8590",
  crowdSeed: 53,
};

// Trial Mountain: forested mountain pass, boulders at the edge of the asphalt
// and rock portals where the road cuts through the hillside.
const MOUNTAIN: SceneryProfile = {
  kind: "mountain",
  stands: 7,
  buildings: 28,
  near: 62,
  far: 250,
  neon: false,
  night: false,
  trees: 2.8,
  palms: 0,
  water: null,
  overpasses: 4,
  grass: "#3f5b3a",
  dirt: "#5a5140",
  buildingTint: "#76818d",
  crowdSeed: 61,
};

// Tokyo Expressway: a night motorway through the city — concrete, gantries,
// signs and no green anywhere.
const EXPRESSWAY: SceneryProfile = {
  kind: "city",
  stands: 5,
  buildings: 182,
  near: 24,
  far: 340,
  neon: true,
  night: true,
  trees: 0,
  palms: 0,
  water: null,
  overpasses: 10,
  grass: "#2f343a",
  dirt: "#282c31",
  buildingTint: "#69727f",
  crowdSeed: 67,
};

// Dragon Trail Seaside: cliffs and water on one side, palms and stone walls on
// the other.
const COAST: SceneryProfile = {
  kind: "coast",
  stands: 11,
  buildings: 39,
  near: 58,
  far: 230,
  neon: false,
  night: false,
  trees: 0.7,
  palms: 72,
  water: "#2f6f9e",
  overpasses: 0,
  grass: "#5d7b45",
  dirt: "#7d7355",
  buildingTint: "#8a93a0",
  crowdSeed: 71,
};

// Blue Moon Bay: a banked oval, so almost everything is grandstand and crowd.
const OVAL: SceneryProfile = {
  kind: "speedway",
  stands: 20,
  buildings: 50,
  near: 66,
  far: 270,
  neon: false,
  night: false,
  trees: 0.4,
  palms: 25,
  water: "#2f6f9e",
  overpasses: 0,
  grass: "#4f6b4c",
  dirt: "#42573c",
  buildingTint: "#77828e",
  crowdSeed: 83,
};

// Autumn Ring: a small forest circuit late in the season — worn ground, low
// sun through the trees and almost no grandstands.
const AUTUMN: SceneryProfile = {
  kind: "forest",
  stands: 8,
  buildings: 34,
  near: 44,
  far: 210,
  neon: false,
  night: false,
  trees: 2.7,
  palms: 0,
  water: null,
  overpasses: 1,
  grass: "#6a6c3c",
  dirt: "#5d5636",
  buildingTint: "#857d6e",
  crowdSeed: 101,
};

// Côte d'Azur: a street circuit in the harbour city — painted kerbs, balconies
// over the walls, palms and the sea in the background.
const AZUR: SceneryProfile = {
  kind: "city",
  stands: 12,
  buildings: 168,
  near: 20,
  far: 250,
  neon: true,
  night: false,
  trees: 0.2,
  palms: 34,
  water: "#2f6f9e",
  overpasses: 2,
  grass: "#7e848d",
  dirt: "#6f757e",
  buildingTint: "#d6cfbf",
  crowdSeed: 103,
};

// Eiger Nordwand: an alpine pass cut into the rock. Almost no stands, rock
// portals over the road and bare stone either side of the tarmac.
const ALPINE: SceneryProfile = {
  kind: "mountain",
  stands: 4,
  buildings: 16,
  near: 56,
  far: 240,
  neon: false,
  night: false,
  trees: 2.3,
  palms: 0,
  water: null,
  overpasses: 5,
  grass: "#6b7454",
  dirt: "#8f8878",
  buildingTint: "#8d97a3",
  crowdSeed: 107,
};

// Tokyo Route 246: the night loop through the financial district — wide
// avenues, gantries every few hundred metres and walls of glass.
const MIDNIGHT: SceneryProfile = {
  kind: "city",
  stands: 9,
  buildings: 196,
  near: 23,
  far: 330,
  neon: true,
  night: true,
  trees: 0.15,
  palms: 0,
  water: null,
  overpasses: 6,
  grass: "#2f343a",
  dirt: "#282c31",
  buildingTint: "#6d7684",
  crowdSeed: 109,
};

export const CIRCUITS: Record<CircuitId, CircuitSpec> = {
  highspeedring: {
    name: "High Speed Ring",
    country: "Japón · original de GT",
    style: "Óvalo mixto de alta velocidad",
    note: "Inspirado en el anillo de velocidad: rectas enormes, curvas peraltadas y gradas a los dos lados. El circuito más rápido del club: se corre a fondo y perdona los errores.",
    length: 2.92,
    factor: 0.86,
    difficulty: 1,
    halfWidth: 9.5,
    shape: { a: 470, b: 386, n: 3.1, h1: 0.03, k1: 2, p1: 0.5, h2: 0.02, k2: 3, p2: 1.1 },
    profile: SPEEDWAY,
  },
  tokyoexpressway: {
    name: "Tokyo Expressway",
    country: "Japón · original de GT",
    style: "Autopista urbana nocturna",
    note: "Inspirado en la expressway: muros de hormigón, pasos a distinto nivel, neón y finales a fondo. Ancho y rapidísimo, ideal para empezar.",
    length: 2.96,
    factor: 0.9,
    difficulty: 1,
    halfWidth: 9.5,
    shape: { a: 448, b: 402, n: 3.6, h1: 0.05, k1: 4, p1: 0.4, h2: 0.035, k2: 2, p2: 1.2 },
    profile: EXPRESSWAY,
  },
  bluemoonbay: {
    name: "Blue Moon Bay Speedway",
    country: "EE. UU. · original de GT",
    style: "Óvalo peraltado",
    note: "Inspirado en el óvalo: dos rectas largas, curvas peraltadas y tribunas inmensas mirando la pista. Todo el mundo corre pegado, sin frenadas raras.",
    length: 2.89,
    factor: 0.8,
    difficulty: 1,
    halfWidth: 9.5,
    shape: { a: 482, b: 368, n: 3, h1: 0.03, k1: 2, p1: 0.5, h2: 0.025, k2: 4, p2: 1 },
    profile: OVAL,
  },
  deepforest: {
    name: "Deep Forest Raceway",
    country: "Japón · original de GT",
    style: "Bosque y curvas enlazadas",
    note: "Inspirado en el clásico bosque: enlazadas rápidas, árboles pegados al asfalto y una recta larga. Las curvas ya obligan a levantar el pie.",
    length: 2.47,
    factor: 1,
    difficulty: 2,
    halfWidth: 8,
    shape: { a: 362, b: 372, n: 2.42, h1: 0.075, k1: 3, p1: 0.6, h2: 0.045, k2: 5, p2: 1.9, h3: 0.03, k3: 7, p3: 0.4 },
    profile: FOREST,
  },
  grandvalley: {
    name: "Grand Valley Speedway",
    country: "Japón · original de GT",
    style: "Valle mixto con puente",
    note: "Inspirado en el valle: recta principal larga, sectores técnicos y el cruce junto al agua. Hay que frenar de verdad en las curvas lentas.",
    length: 2.54,
    factor: 1.02,
    difficulty: 2,
    halfWidth: 8,
    shape: { a: 390, b: 362, n: 2.45, h1: 0.09, k1: 3, p1: 0.5, h2: 0.06, k2: 4, p2: 1.8, h3: 0.035, k3: 6, p3: 0.9 },
    profile: VALLEY,
  },
  dragontrail: {
    name: "Dragon Trail · Seaside",
    country: "Croacia · original de GT",
    style: "Costero con curvas rápidas",
    note: "Inspirado en la costa: el mar a un lado, palmeras y muros de piedra al otro y una chicane final que se cobra los errores.",
    length: 2.63,
    factor: 1.04,
    difficulty: 2,
    halfWidth: 8,
    shape: { a: 410, b: 356, n: 2.5, h1: 0.095, k1: 3, p1: 0.2, h2: 0.05, k2: 6, p2: 1.6, h3: 0.025, k3: 6, p3: 1.5 },
    profile: COAST,
  },
  ssr5: {
    name: "Special Stage Route 5",
    country: "Japón · original de GT",
    style: "Circuito urbano nocturno",
    note: "Inspirado en la ruta nocturna: manzanas de rascacielos, neones y frenadas entre muros. Trazado estrecho y sucio: un error y estás contra el hormigón.",
    length: 2.67,
    factor: 1.08,
    difficulty: 3,
    halfWidth: 7,
    shape: { a: 372, b: 344, n: 2.9, h1: 0.155, k1: 3, p1: 0.3, h2: 0.07, k2: 5, p2: 1.5, h3: 0.05, k3: 7, p3: 1.1 },
    profile: CITY,
  },
  trialmountain: {
    name: "Trial Mountain",
    country: "Japón · original de GT",
    style: "Montaña, rocas y curvas ciegas",
    note: "Inspirado en la montaña: el bosque pegado al asfalto, peñascos en el borde y portales de roca sobre la pista. Curvas ciegas una detrás de otra.",
    length: 2.6,
    factor: 1.1,
    difficulty: 3,
    halfWidth: 7,
    shape: { a: 336, b: 378, n: 1.98, h1: 0.175, k1: 3, p1: 0.9, h2: 0.095, k2: 5, p2: 2.4, h3: 0.05, k3: 5, p3: 0.7 },
    profile: MOUNTAIN,
  },
  autumnring: {
    name: "Autumn Ring",
    country: "Japón · original de GT",
    style: "Trazado corto y trabado",
    note: "Inspirado en el anillo de otoño: un circuito chico y sin respiro, con curvas que se suceden una tras otra. Corto, pero cada falla se paga caro.",
    length: 2,
    factor: 1.12,
    difficulty: 3,
    halfWidth: 7,
    shape: { a: 292, b: 302, n: 1.9, h1: 0.125, k1: 3, p1: 0.7, h2: 0.075, k2: 5, p2: 1.4, h3: 0.04, k3: 7, p3: 2.1 },
    profile: AUTUMN,
  },
  cotazur: {
    name: "Côte d'Azur",
    country: "Mónaco · original de GT",
    style: "Urbano al borde del mar",
    note: "Inspirado en el puerto: muros sin margen, el túnel, la subida y la horquilla más lenta del club. Aquí no se perdona nada: es el circuito más difícil.",
    length: 2.06,
    factor: 1.22,
    difficulty: 4,
    halfWidth: 5.75,
    shape: { a: 302, b: 270, n: 1.82, h1: 0.14, k1: 4, p1: 0.4, h2: 0.085, k2: 6, p2: 1.7, h3: 0.045, k3: 9, p3: 0.8 },
    profile: AZUR,
  },
  eigernordwand: {
    name: "Eiger Nordwand",
    country: "Suiza · original de GT",
    style: "Paso alpino con horquillas",
    note: "Inspirado en los Alpes: nieve en los bordes, roca sobre la cabeza y horquillas ciegas de primera y segunda. Solo para pilotos de nivel profesional.",
    length: 2.42,
    factor: 1.26,
    difficulty: 4,
    halfWidth: 5.75,
    shape: { a: 298, b: 324, n: 1.82, h1: 0.15, k1: 5, p1: 1.1, h2: 0.095, k2: 8, p2: 0.6, h3: 0.04, k3: 12, p3: 1.9 },
    profile: ALPINE,
  },
  route246: {
    name: "Tokyo Route 246",
    country: "Japón · original de GT",
    style: "Urbano nocturno de alta exigencia",
    note: "Inspirado en la avenida 246: a fondo entre muros de vidrio, con frenadas traicioneras y cambios de rasante. Rápido y traicionero a la vez.",
    length: 2.43,
    factor: 1.18,
    difficulty: 4,
    halfWidth: 5.75,
    shape: { a: 358, b: 304, n: 1.88, h1: 0.145, k1: 4, p1: 0.2, h2: 0.08, k2: 8, p2: 1.3, h3: 0.035, k3: 10, p3: 2.4 },
    profile: MIDNIGHT,
  },
};

export const CIRCUIT_IDS = Object.keys(CIRCUITS) as CircuitId[];

/** Printed difficulty of a layout, from the picker to the race badge. */
export const DIFFICULTY_LABELS: Record<1 | 2 | 3 | 4, string> = {
  1: "Principiante",
  2: "Intermedio",
  3: "Avanzado",
  4: "Profesional",
};

export function circuitProfile(id: CircuitId) {
  return CIRCUITS[id].profile;
}

// Superellipse sampled with two harmonics: the exponent flattens the long
// sides (the main straight) and the harmonics add the character of each
// layout, while the curve stays smooth everywhere — no kinks, no hairpins.
export function loopPoints(shape: CircuitSpec["shape"], count = 180) {
  const { a, b, n, h1, k1, p1, h2, k2, p2, h3 = 0, k3 = 0, p3 = 0 } = shape;
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 2;
    const ct = Math.cos(t);
    const st = Math.sin(t);
    const sx = Math.sign(ct) * Math.abs(ct) ** (2 / n);
    const sz = Math.sign(st) * Math.abs(st) ** (2 / n);
    const m =
      1 + h1 * Math.cos(k1 * t + p1) + h2 * Math.sin(k2 * t + p2) + h3 * Math.cos(k3 * t + p3);
    points.push(new THREE.Vector3(a * sx * m, 0, b * sz * m));
  }
  return points;
}

export function createClubCircuit(id: CircuitId = "deepforest") {
  const spec = CIRCUITS[id] ?? CIRCUITS.deepforest;
  const curve = new THREE.CatmullRomCurve3(loopPoints(spec.shape), true, "centripetal");
  const points = curve.getSpacedPoints(600);
  const tangents = points.map((_, i) => curve.getTangentAt(i / 600).normalize());
  const rights = tangents.map((t) => new THREE.Vector3(t.z, 0, -t.x));
  const spawn = curve.getPointAt(0);
  const direction = curve.getTangentAt(0);
  return {
    id,
    spec,
    /** Half width of this layout's asphalt, in metres. */
    halfWidth: spec.halfWidth,
    curve,
    points,
    rights,
    spawn,
    yaw: Math.atan2(direction.x, direction.z),
    length: curve.getLength(),
  };
}
export type ClubCircuit = ReturnType<typeof createClubCircuit>;

export function trackRibbon(track: ClubCircuit, inner: number, outer: number, height: number) {
  const positions: number[] = [];
  const uv: number[] = [];
  const indices: number[] = [];
  track.points.forEach((p, i) => {
    const right = track.rights[i];
    if (!right) return;
    positions.push(
      p.x + right.x * inner,
      height,
      p.z + right.z * inner,
      p.x + right.x * outer,
      height,
      p.z + right.z * outer,
    );
    uv.push(0, (i * track.length) / 600 / 8, 1, (i * track.length) / 600 / 8);
    if (i < 600) {
      const n = i * 2;
      indices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function nearestTrack(track: ClubCircuit, x: number, z: number, previous: number) {
  let best = previous;
  let distance = Infinity;
  for (let offset = -24; offset <= 24; offset++) {
    const index = (previous + offset + 600) % 600;
    const point = track.points[index];
    if (!point) continue;
    const d = (x - point.x) ** 2 + (z - point.z) ** 2;
    if (d < distance) {
      distance = d;
      best = index;
    }
  }
  const point = track.points[best];
  const right = track.rights[best];
  const lateral = point && right ? (x - point.x) * right.x + (z - point.z) * right.z : 0;
  return { index: best, lateral, point, right };
}
