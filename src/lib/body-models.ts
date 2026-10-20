import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const cache = new Map<string, Promise<THREE.Group>>();

/** Materials that hide a mesh completely: badges, grille stars, sticker sheets and display props. */
const LOGO_MATERIAL =
  /grille_logo|interior_stickers|windows_stickers|badges|emblem|decal|supportlogo|plate|carshadow|floor/i;

/**
 * Showpieces carry a full cabin, engine bay and suspension. None of it can be
 * seen through the dark glass at workshop distance, but it is over half of the
 * Mercedes mesh budget and the single biggest reason the lift view could not
 * hold 60 fps. The exterior, glass, wheels and lamps stay untouched.
 */
const HIDDEN_DETAIL_MATERIAL =
  /interior|engine_components|suspension|steering[_ ]?wheel|cockpit[_ ]?console|seat|pedal/i;

/**
 * The source files were authored as showpieces and carry manufacturer marks in
 * their maps. The workshop only needs the bodywork, so the offending maps are
 * dropped here and the shell is painted with the project colour. This also
 * keeps the logos out of the screen without shipping a second copy of every
 * 52 MB source scene.
 */
function prepare(scene: THREE.Group) {
  const hide = new Set<THREE.Object3D>();
  scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.castShadow = true;
    node.receiveShadow = false;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    if (HIDDEN_DETAIL_MATERIAL.test(materials.map((material) => material?.name ?? "").join(" "))) {
      hide.add(node);
      return;
    }
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      // The shells are viewed at grazing angles on the lift and in the chase
      // camera. Anisotropic filtering keeps the lamps, vents and tyre walls
      // from turning into soft smears without adding a single draw call.
      for (const map of [
        material.map,
        material.normalMap,
        material.roughnessMap,
        material.metalnessMap,
        material.emissiveMap,
        material.aoMap,
        material.alphaMap,
      ]) {
        if (map) map.anisotropy = 8;
      }
      const name = material.name;
      if (LOGO_MATERIAL.test(name)) {
        hide.add(node);
        continue;
      }
      if (/livery/i.test(name)) {
        // The livery atlas is a sheet of sponsor decals: drop it and let the
        // paint station own the body colour.
        material.map = null;
        material.normalMap = null;
        material.metalnessMap = null;
        material.roughnessMap = null;
        material.color.set("#ffffff");
        material.metalness = 0.18;
        material.roughness = 0.32;
        if (material instanceof THREE.MeshPhysicalMaterial) {
          material.clearcoat = 0.55;
          material.clearcoatRoughness = 0.18;
        }
        material.needsUpdate = true;
        continue;
      }
      if (/^body$/i.test(name)) {
        // Road-car paint is baked into a dark atlas; the workshop owns the
        // colour, so the maps (including the embossed badge in the normal) go.
        material.map = null;
        material.normalMap = null;
        material.metalnessMap = null;
        material.roughnessMap = null;
        material.color.set("#cfd3d6");
        material.metalness = 0.75;
        material.roughness = 0.24;
        material.needsUpdate = true;
        continue;
      }
      if (/^caliper$/i.test(name)) {
        material.map = null;
        material.normalMap = null;
        material.color.set("#d5001c");
        material.needsUpdate = true;
        continue;
      }
      if (/tyre|tire/i.test(name)) {
        // Rubber sidewalls carry tyre-brand lettering in both the colour and
        // the normal maps. A clean dark compound reads better than a smeared
        // logo once the model is scaled down in the workshop.
        material.map = null;
        material.normalMap = null;
        material.color.set("#17191b");
        material.metalness = 0;
        material.roughness = 0.86;
        material.needsUpdate = true;
        continue;
      }
      if (/rim/i.test(name)) {
        // Wheel faces repeat a manufacturer mark on the spoke and the centre
        // cap; the geometry still has the spokes, so plain metal is enough.
        material.map = null;
        material.normalMap = null;
        material.color.set("#282c31");
        material.metalness = 0.92;
        material.roughness = 0.24;
        material.needsUpdate = true;
        continue;
      }
      if (/caliper/i.test(name)) {
        material.map = null;
        material.normalMap = null;
        material.color.set("#d5001c");
        material.metalness = 0.35;
        material.roughness = 0.34;
        material.needsUpdate = true;
        continue;
      }
      if (/steering[_ ]?wheel/i.test(name)) {
        // The hub badge lives in the colour map; a dark rim keeps the shape
        // and removes every emblem in one step.
        material.map = null;
        material.normalMap = null;
        material.color.set("#1b1e22");
        material.metalness = 0.2;
        material.roughness = 0.62;
        material.needsUpdate = true;
        continue;
      }
      if (/^(details|headlight|fuelcap|radiatorfront)$/i.test(name)) {
        // This atlas mixes headlamp lenses with a roundel and a coloured side
        // badge. Plain dark trim keeps the lamps and removes every mark.
        material.map = null;
        material.emissiveMap = null;
        material.color.set(/^headlight$/i.test(name) ? "#16181b" : "#1d2024");
        material.metalness = 0.45;
        material.roughness = 0.3;
        material.needsUpdate = true;
        continue;
      }
      if (/windowrear/i.test(name)) {
        // Rear glass on the supplied shell doubles as a sponsor banner. Keep
        // the pane dark and translucent instead of printing the team name.
        material.map = null;
        material.emissiveMap = null;
        material.normalMap = null;
        material.color.set("#0f141a");
        material.transparent = true;
        material.opacity = 0.32;
        material.metalness = 0.1;
        material.roughness = 0.12;
        material.needsUpdate = true;
        continue;
      }
      if (/^interior$/i.test(name)) {
        // The dashboard and wheel carry stitched marks in the colour atlas;
        // a dark cabin reads cleanly through the glass.
        material.map = null;
        material.color.set("#1a1d21");
        material.metalness = 0.25;
        material.roughness = 0.65;
        material.needsUpdate = true;
        continue;
      }
      if (/brakedisc/i.test(name)) {
        material.map = null;
        material.color.set("#3b3e43");
        material.metalness = 0.8;
        material.roughness = 0.35;
        material.needsUpdate = true;
        continue;
      }
      if (/^(bluered|suport1|detailplastic|detailsmatte|exhausthole)$/i.test(name)) {
        // Shared brake/suspension atlas: plain metal parts instead of decals.
        material.map = null;
        material.color.set(name.toLowerCase() === "exhausthole" ? "#0a0b0c" : "#2b2e33");
        material.metalness = name.toLowerCase() === "detailplastic" ? 0.3 : 0.55;
        material.roughness = 0.5;
        material.needsUpdate = true;
        continue;
      }
      if (/engine_components|interior_details/i.test(name)) {
        // Engine covers and some interior trims share an atlas with stamped
        // marks that are only visible from close range.
        material.map = null;
        material.color.set("#23262a");
        material.metalness = 0.35;
        material.roughness = 0.5;
        material.needsUpdate = true;
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
      prepare(gltf.scene);
      return gltf.scene;
    })
    .catch((error: unknown) => {
      cache.delete(key);
      throw error;
    });
  cache.set(key, request);
  return request;
}
