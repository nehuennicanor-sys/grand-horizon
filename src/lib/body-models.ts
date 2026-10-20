import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const cache = new Map<string, Promise<THREE.Group>>();

/** Materials that hide a mesh completely: badges, grille stars, sticker sheets and display props. */
const LOGO_MATERIAL =
  /grille_logo|interior_stickers|windows_stickers|badges|emblem|decal|supportlogo|plate|carshadow|floor|lamborghini|frontbumper_hires|rim_blur|glow/i;

/**
 * Showpieces carry a full cabin, engine bay and suspension. None of it can be
 * seen through the dark glass at workshop distance, but it is over half of the
 * Mercedes mesh budget and the single biggest reason the lift view could not
 * hold 60 fps. The exterior, glass, wheels and lamps stay untouched.
 */
const HIDDEN_DETAIL_MATERIAL =
  /interior|engine_components|suspension|steering[_ ]?wheel|cockpit[_ ]?console|seat|pedal|net_share|screws?_share|stitches_share|cockpit[_ ]?screen|worldgrid/i;

/**
 * The source files were authored as showpieces and carry manufacturer marks in
 * their maps. The workshop only needs the bodywork, so the offending maps are
 * dropped here and the shell is painted with the project colour. This also
 * keeps the logos out of the screen without shipping a second copy of every
 * 52 MB source scene.
 */
function prepare(scene: THREE.Group, modelKey = "") {
  const hide = new Set<THREE.Object3D>();
  const isRacer = /racer-gt/i.test(modelKey);
  const lineage = (node: THREE.Object3D) => {
    const names: string[] = [];
    let current: THREE.Object3D | null = node;
    while (current) {
      if (current.name) names.push(current.name);
      current = current.parent;
    }
    return names.join(" ");
  };
  const stripMaps = (material: THREE.MeshStandardMaterial) => {
    material.map = null;
    material.normalMap = null;
    material.metalnessMap = null;
    material.roughnessMap = null;
    material.emissiveMap = null;
    material.aoMap = null;
    material.alphaMap = null;
    // glTF stores many painted parts with a white emissive factor while the
    // actual pattern lives in the emissive texture. Removing that texture but
    // keeping the white factor is what made whole cars glow like bare clay.
    material.emissive.set("#000000");
    material.emissiveIntensity = 0;
  };
  scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.castShadow = true;
    node.receiveShadow = false;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    // The labels on the source files are inconsistent: some name the material
    // (MI_..._Livery, Body), others only the parent node (4_interior,
    // Material__24). Joining the whole ancestry catches both without relying on
    // a manufacturer-specific name.
    const names = materials.map((material) => material?.name ?? "");
    const label = `${lineage(node)} ${names.join(" ")}`;
    // The Burnout shell reuses generic material names for its glass, engine and
    // wheels. These parts have no brand text of their own, but they must not be
    // painted with the body livery, and the engine is hidden under the rear glass.
    if (isRacer) {
      if (names.some((name) => /^ExtMaterial_(0023|0017)$/.test(name))) {
        hide.add(node);
        return;
      }
      if (names.some((name) => /^ExtMaterial_0000$/.test(name))) {
        for (const material of materials) {
          if (!(material instanceof THREE.MeshStandardMaterial)) continue;
          stripMaps(material);
          material.color.set("#17232a");
          material.metalness = 0.2;
          material.roughness = 0.1;
          material.transparent = true;
          material.opacity = 0.58;
          material.depthWrite = false;
          material.needsUpdate = true;
        }
        return;
      }
      if (names.some((name) => /^ExtMaterial_0042$/.test(name))) {
        for (const material of materials) {
          if (!(material instanceof THREE.MeshStandardMaterial)) continue;
          stripMaps(material);
          material.color.set("#17191b");
          material.metalness = 0;
          material.roughness = 0.86;
          material.needsUpdate = true;
        }
        return;
      }
      if (names.some((name) => /^(ExtMaterial_0045|Material_0011)$/.test(name))) {
        for (const material of materials) {
          if (!(material instanceof THREE.MeshStandardMaterial)) continue;
          stripMaps(material);
          material.color.set(/^ExtMaterial_0045$/.test(material.name) ? "#3b3e43" : "#282c31");
          material.metalness = 0.88;
          material.roughness = 0.28;
          material.needsUpdate = true;
        }
        return;
      }
    }
    // The Mercedes star is modelled as a separate exterior-detail mesh rather
    // than a texture, so stripping the badge map alone left it on the grille.
    if (
      node.name === "Object_110" &&
      names.some((name) => /MI_Mercedes_AMG_GT3_Evo_Exterior_Details/i.test(name))
    ) {
      hide.add(node);
      return;
    }
    if (HIDDEN_DETAIL_MATERIAL.test(label) || LOGO_MATERIAL.test(label)) {
      hide.add(node);
      return;
    }
    // The outer skin is always project paint. Dropping its atlas is what removes
    // baked rings, roundels, numbers and sponsor sheets from every supplied car.
    const paint =
      /bodyreflect|body|paint|carrocer|carpaint|livery|exterior_01|material__24/i.test(label) &&
      !/glass|window|tire|tyre|wheel|rim|interior|seat|engine|suspension|chassis|details|misc|skirt|light|lamp|brake|caliper|grille|plate/i.test(
        label,
      );
    if (paint) {
      for (const material of materials) {
        if (!(material instanceof THREE.MeshStandardMaterial)) continue;
        stripMaps(material);
        material.color.set("#ffffff");
        material.metalness = 0.9;
        material.roughness = 0.1;
        material.envMapIntensity = 1;
        material.transparent = false;
        material.opacity = 1;
        material.alphaTest = 0;
        material.depthWrite = true;
        material.userData["paint"] = true;
        if (material instanceof THREE.MeshPhysicalMaterial) {
          material.clearcoat = 0.7;
          material.clearcoatRoughness = 0.12;
        }
        material.needsUpdate = true;
      }
      return;
    }
    const glass = /glass|window/i.test(label) && !/light|lamp|screen|sticker|net|brake|caliper/i.test(label);
    if (glass) {
      for (const material of materials) {
        if (!(material instanceof THREE.MeshStandardMaterial)) continue;
        stripMaps(material);
        material.color.set("#17232a");
        material.metalness = 0.2;
        material.roughness = 0.1;
        material.transparent = true;
        material.opacity = 0.58;
        material.depthWrite = false;
        material.needsUpdate = true;
      }
      return;
    }
    const tire = /tire|tyre|rubber|material__48/i.test(label);
    const rim = /rim|wheel|material__47/i.test(label);
    const brake = /brake|caliper|roter|rotor/i.test(label);
    const light = /light|lamp|headlight|taillight|foglight|emissive/i.test(label);
    if (tire || rim || brake || light) {
      for (const material of materials) {
        if (!(material instanceof THREE.MeshStandardMaterial)) continue;
        stripMaps(material);
        if (tire) {
          material.color.set("#17191b");
          material.metalness = 0;
          material.roughness = 0.86;
        } else if (rim) {
          material.color.set("#282c31");
          material.metalness = 0.92;
          material.roughness = 0.24;
        } else if (brake) {
          material.color.set(/caliper/i.test(label) ? "#a11d2b" : "#3b3e43");
          material.metalness = /caliper/i.test(label) ? 0.35 : 0.8;
          material.roughness = /caliper/i.test(label) ? 0.34 : 0.35;
        } else {
          material.color.set("#1a1d22");
          material.metalness = 0.3;
          material.roughness = 0.22;
          material.emissive.set("#9fb4cc");
          material.emissiveIntensity = 0.18;
        }
        material.needsUpdate = true;
      }
      return;
    }
    // Everything else is trim, aero, chassis or a miscellaneous detail. Neutral
    // dark metal keeps the silhouette but cannot carry a manufacturer mark.
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      stripMaps(material);
      material.color.set("#2b2e33");
      material.metalness = 0.55;
      material.roughness = 0.38;
      material.envMapIntensity = 1;
      material.needsUpdate = true;
    }
  });
  // Normalization runs again when the scene is cloned, and some source files
  // name every part "Body...". Mark the non-paint materials so glass, chassis,
  // wheels and aero cannot be swept up by that second name-based pass.
  scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (material instanceof THREE.MeshStandardMaterial && material.userData["paint"] !== true) {
        material.userData["noPaint"] = true;
      }
    }
  });
  hide.forEach((node) => node.removeFromParent());
}

/**
 * Loads a bodywork once and shares the raw scene. Consumers clone it through
 * normalizeVehicle, so a single download/texture upload feeds the workshop and
 * the track.
 *
 * Some authors model the car along the X axis. `yaw` turns the source before
 * the bounds are measured, so normalization always leaves the nose on +Z.
 */
export function loadBodyModel(url: string, yaw = 0): Promise<THREE.Group> {
  const key = `${url}|${yaw}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const request = new GLTFLoader()
    .loadAsync(url)
    .then((gltf) => {
      if (yaw) {
        gltf.scene.rotation.y = yaw;
        gltf.scene.updateMatrixWorld(true);
      }
      prepare(gltf.scene, url);
      return gltf.scene;
    })
    .catch((error: unknown) => {
      cache.delete(key);
      throw error;
    });
  cache.set(key, request);
  return request;
}
