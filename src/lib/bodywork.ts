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
  credit: BodyCredit;
};

export const BODY_OPTIONS: BodyOption[] = [
  {
    id: "coupe-v10",
    name: "Cupé V10",
    tagline: "Motor central · atmosférico",
    description:
      "Silueta baja y ancha, cabina adelantada y gran toma de aire lateral. Una base ágil para proyectos de motor central.",
    color: "#c3c7ca",
    accent: "#d5001c",
    modelUrl: "/models/porsche-carrera-gt/scene.gltf",
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
    color: "#173d78",
    accent: "#d6001c",
    modelUrl: "/models/mercedes-amg-gt3-red-bull/scene.gltf",
    modelYaw: -Math.PI / 2,
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
    color: "#c7ccd2",
    accent: "#2d5f9a",
    modelUrl: "/models/touring-gt3/scene.gltf",
    credit: {
      author: "Alex Ka",
      source:
        "https://sketchfab.com/3d-models/bmw-m6-gt3-2018-1cee0ef3cad2441b9972b8ba84fe0865",
      license: "CC-BY-NC-ND-4.0",
      licenseUrl: "http://creativecommons.org/licenses/by-nc-nd/4.0/",
    },
  },
];

export function bodyById(id: string | null | undefined): BodyOption | undefined {
  return id ? BODY_OPTIONS.find((body) => body.id === id) : undefined;
}
