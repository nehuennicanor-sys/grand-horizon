/**
 * Base bodyworks for the from-scratch project.
 *
 * These are generic, de-branded shells: the player picks one as the starting
 * point and keeps full control over engine, chassis, paint and setup. Labels
 * stay descriptive instead of naming a manufacturer or a racing team.
 */
export type BodyCredit = {
  author: string;
  source: string;
  license: string;
  licenseUrl: string;
};

export type BodyOption = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  color: string;
  accent: string;
  /** glTF served from /public. */
  modelUrl: string;
  /** Yaw applied before normalization, to put the nose on +Z. */
  modelYaw?: number;
  /** Real-world top speed of the car this shell represents, in km/h. */
  topSpeed: number;
  credit: BodyCredit;
};

export const BODY_OPTIONS: BodyOption[] = [
  {
    id: "coupe-v10",
    name: "Cupé V10",
    tagline: "Motor central · atmosférico",
    description:
      "Silueta baja y ancha, cabina adelantada y gran toma de aire lateral. Una base ágil para proyectos de motor central.",
    color: "#7fb2d9",
    accent: "#f26b21",
    modelUrl: "/models/porsche-carrera-gt/scene.gltf",
    topSpeed: 330,
    credit: {
      author: "Ajay Gawde",
      source:
        "https://sketchfab.com/3d-models/porsche-carrera-gt-low-poly-68570726d7364f81a00d4bf0e448e642",
      license: "CC-BY-4.0",
      licenseUrl: "http://creativecommons.org/licenses/by/4.0/",
    },
  },
  {
    id: "gt-v8",
    name: "GT V8",
    tagline: "Turismo de competición",
    description:
      "Carrocería de GT con pasos de rueda anchos, splitter, difusor y alerón trasero. Pensada para circuitos y resistencia.",
    color: "#0b0b0d",
    accent: "#e10600",
    modelUrl: "/models/mercedes-amg-gt3-red-bull/scene.gltf",
    modelYaw: -Math.PI / 2,
    topSpeed: 300,
    credit: {
      author: "VTX",
      source:
        "https://sketchfab.com/3d-models/mercedes-amg-gt3-red-bull-racing-035f061cb6624effbc483d5f9b5ecaba",
      license: "CC-BY-NC-SA-4.0",
      licenseUrl: "http://creativecommons.org/licenses/by-nc-sa/4.0/",
    },
  },
  {
    id: "touring-gt",
    name: "Turismo GT",
    tagline: "Coupé de resistencia",
    description:
      "Coupé de turismo con capó largo, pasos ensanchados, splitter y alerón de circuito. Base robusta para proyectos de resistencia.",
    color: "#f2f4f6",
    accent: "#1f5fbf",
    modelUrl: "/models/touring-gt3/scene.gltf",
    topSpeed: 305,
    credit: {
      author: "Alex Ka",
      source:
        "https://sketchfab.com/3d-models/bmw-m6-gt3-2018-1cee0ef3cad2441b9972b8ba84fe0865",
      license: "CC-BY-NC-ND-4.0",
      licenseUrl: "http://creativecommons.org/licenses/by-nc-nd/4.0/",
    },
  },
  {
    id: "scafati-gt",
    name: "Scafati GT",
    tagline: "GT artesanal · V12",
    description:
      "GT de carrocería baja, capó largo y cabina retrasada. Una base de estilo artesanal para proyectos de gran turismo.",
    color: "#2f9e44",
    accent: "#111827",
    modelUrl: "/models/furnari-scafati-gt/scene.gltf",
    topSpeed: 290,
    credit: {
      author: "All-Wide",
      source:
        "https://sketchfab.com/3d-models/furnari-scafati-gt-0770b1eb9bdf420d8fa1202a46b552ec",
      license: "CC-BY-4.0",
      licenseUrl: "http://creativecommons.org/licenses/by/4.0/",
    },
  },
  {
    id: "lmp1-hybrid",
    name: "LMP1 Híbrido",
    tagline: "Resistencia · prototipo",
    description:
      "Prototipo de resistencia con cubierta cerrada, pasos de rueda carenados y aerodinámica de baja resistencia. Pensado para circuitos rápidos y tandas largas.",
    color: "#c9ced6",
    accent: "#d90429",
    modelUrl: "/models/audi-r18-tdi/scene.glb",
    topSpeed: 340,
    credit: {
      author: "amogusstrikesback2",
      source:
        "https://sketchfab.com/3d-models/audi-r18-tdi-5f61c5b9354b493e8b5fb463548dddcd",
      license: "CC-BY-4.0",
      licenseUrl: "http://creativecommons.org/licenses/by/4.0/",
    },
  },
  {
    id: "racer-gt",
    name: "Racer GT",
    tagline: "Prototipo de competición · extremo",
    description:
      "Prototipo ligero de cubierta cerrada, morro bajo y alerón de gran tamaño. Una base de competición pensada para velocidad punta y tandas explosivas.",
    color: "#1e50ff",
    accent: "#f4d000",
    modelUrl: "/models/racer-gt/scene.gltf",
    topSpeed: 336,
    credit: {
      author: "amogusstrikesback2",
      source:
        "https://sketchfab.com/3d-models/ea-racer-gt-burnout-revenge-c720d093e6fa4ee398a9b21d5d49f9d7",
      license: "CC-BY-4.0",
      licenseUrl: "http://creativecommons.org/licenses/by/4.0/",
    },
  },
];

export function bodyById(id: string | null | undefined): BodyOption | undefined {
  return id ? BODY_OPTIONS.find((body) => body.id === id) : undefined;
}

/** The shell's real-world speed ceiling in km/h; used by the simulator too. */
export function bodyTopSpeed(id: string | null | undefined) {
  return bodyById(id)?.topSpeed;
}
