import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";

/**
 * Each shell gets a hard-edged two-colour livery. It is computed in the
 * shader from a car-space coordinate baked once into the body geometry, so it
 * costs no texture memory and stays glued to the panel while the car moves.
 */
export function paintPatternIndex(bodyId: string | null | undefined) {
  switch (bodyId) {
    case "gt-v8":
      return 1;
    case "touring-gt":
      return 2;
    case "scafati-gt":
      return 3;
    case "lmp1-hybrid":
      return 4;
    case "racer-gt":
      return 5;
    default:
      return 0;
  }
}

const PAINT_PATTERN_GLSL = /* glsl */ `
float paintBand(float value, float center, float halfWidth) {
  return 1.0 - smoothstep(halfWidth * 0.62, halfWidth, abs(value - center));
}

// p: 0..1 across the whole normalized car (x left/right, y bottom/top, z rear/front).
float paintPattern(vec3 p, float id) {
  if (id < 0.5) {
    // Cupé V10: a wide centre spine plus a bright shoulder flash.
    float spine = paintBand(p.x, 0.5, 0.075);
    float shoulder = paintBand(p.x, 0.5, 0.21) * smoothstep(0.62, 0.78, p.y);
    return max(spine, shoulder * 0.92);
  }
  if (id < 1.5) {
    // GT V8: a crisp diagonal race split.
    float split = p.z * 0.82 + (p.x - 0.5) * 0.38;
    return smoothstep(0.49, 0.53, split);
  }
  if (id < 2.5) {
    // Turismo GT: offset twin stripes, with a rear-deck flash.
    float twin = paintBand(abs(p.x - 0.5), 0.18, 0.042);
    float deck = paintBand(p.x, 0.5, 0.055) * smoothstep(0.88, 1.0, p.y);
    return max(twin, deck);
  }
  if (id < 3.5) {
    // Scafati GT: an asymmetric wedge sweeping over the left flank.
    float wedge = p.x + (1.0 - p.z) * 0.28;
    return smoothstep(0.53, 0.57, wedge);
  }
  if (id < 4.5) {
    // LMP1: a forward arrow over the nose and a narrow centre fin.
    float centre = abs(p.x - 0.5);
    float arrow = 1.0 - smoothstep(0.028, 0.06, abs(centre - (1.0 - p.z) * 0.23));
    float nose = smoothstep(0.76, 0.82, p.z) * (1.0 - smoothstep(0.02, 0.14, centre));
    return max(arrow, nose * 0.9);
  }
  // Racer GT: a broad diagonal blade over the front flank, cut by a thin spine.
  float blade = (p.x - 0.5) * 1.55 + (p.z - 0.5) * 0.75;
  float spine = paintBand(p.x, 0.5, 0.02) * smoothstep(0.1, 0.25, p.z);
  return max(smoothstep(0.16, 0.2, blade), spine * 0.7);
}
`;

const paintShaderKey = "grand-horizon-two-tone-v1";

function setupPaintShader(material: THREE.MeshStandardMaterial) {
  if (material.userData["paintShader"]) return;
  const uniforms = {
    uAccent: { value: new THREE.Color("#ffffff") },
    uPattern: { value: 0 },
  };
  material.userData["paintShader"] = uniforms;
  material.onBeforeCompile = (shader) => {
    shader.uniforms["uAccent"] = uniforms.uAccent;
    shader.uniforms["uPattern"] = uniforms.uPattern;
    shader.vertexShader = /* glsl */ `
attribute vec3 paintCoord;
varying vec3 vPaintCoord;
${shader.vertexShader}
`.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
vPaintCoord = paintCoord;`,
    );
    shader.fragmentShader = /* glsl */ `
varying vec3 vPaintCoord;
uniform vec3 uAccent;
uniform float uPattern;
${PAINT_PATTERN_GLSL}
${shader.fragmentShader}
`.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
float paintMask = paintPattern(vPaintCoord, uPattern);
diffuseColor.rgb = mix(diffuseColor.rgb, uAccent, paintMask);`,
    );
  };
  material.customProgramCacheKey = () => paintShaderKey;
  material.needsUpdate = true;
}

export function normalizeVehicle(source: THREE.Group) {
  const object = clone(source);
  // Sample model includes a fabric display surface, not a car part.
  if (object.getObjectByName("ToyCar")) object.getObjectByName("Fabric")?.removeFromParent();
  const helpers: THREE.Object3D[] = [];
  object.traverse((node) => {
    if (node instanceof THREE.Camera || node instanceof THREE.Light) helpers.push(node);
  });
  helpers.forEach((node) => node.removeFromParent());
  object.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(object);
  const size = bounds.getSize(new THREE.Vector3());
  const length = Math.max(size.x, size.z);
  if (!Number.isFinite(length) || length <= 0)
    throw new Error("El archivo no contiene un auto visible.");
  const root = new THREE.Group();
  root.add(object);
  root.scale.setScalar(4.3 / length);
  root.updateWorldMatrix(true, true);
  const scaled = new THREE.Box3().setFromObject(root);
  const center = scaled.getCenter(new THREE.Vector3());
  root.position.set(-center.x, -scaled.min.y, -center.z);
  const centered = new THREE.Group();
  centered.add(root);
  centered.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    const converted = materials.map((source) => {
      // Clone instead of rebuilding: physical materials keep clearcoat, emissive
      // maps and alpha, which the real GT cars use for paint, lights and glass.
      const material = source.clone();
      material.name = source.name;
      const name = `${node.name} ${source.name}`;
      if (material instanceof THREE.MeshStandardMaterial) {
        const inheritedPaint = material.userData["paint"] === true;
        const preparedNoPaint = material.userData["noPaint"] === true;
        material.userData["paint"] =
          inheritedPaint ||
          (!preparedNoPaint &&
            /toycar|body|paint|carrocer|carpaint|livery/i.test(name) &&
            !/glass|window|tire|tyre|wheel|rubber|rim/i.test(name));
        if (material.userData["paint"]) {
          material.metalness = 0.9;
          material.roughness = 0.1;
          // The temporary toy model bakes a green racing livery into its atlas.
          if (node.name === "ToyCar") {
            material.map = null;
            material.metalnessMap = null;
            material.roughnessMap = null;
          }
          setupPaintShader(material);
        }
        // Real windows get the dark glass tune; headlight covers and cockpit
        // screens keep their authored look.
        if (/glass|window/i.test(name) && !/light|screen|sticker|net|brake/i.test(name)) {
          material.color.set("#17232a");
          material.transparent = true;
          material.opacity = 0.62;
          material.roughness = 0.1;
          material.metalness = 0.2;
        }
        material.envMapIntensity = 1;
      }
      return material;
    });
    const first = converted[0];
    if (first) node.material = Array.isArray(node.material) ? converted : first;
    node.castShadow = false;
    node.receiveShadow = false;
  });

  // Bake a car-space coordinate into the painted panels. A texture would need
  // to be UV-mapped per source file and would cost memory; three floats per
  // vertex is enough for a crisp livery on every body.
  centered.updateWorldMatrix(true, true);
  const carBounds = new THREE.Box3().setFromObject(centered);
  const carSize = carBounds.getSize(new THREE.Vector3());
  const inverseCar = new THREE.Matrix4().copy(centered.matrixWorld).invert();
  const vertex = new THREE.Vector3();
  centered.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    if (!materials.some((material) => material instanceof THREE.MeshStandardMaterial && material.userData["paint"]))
      return;
    const positions = node.geometry.getAttribute("position");
    if (!positions || node.geometry.getAttribute("paintCoord")) return;
    const coords = new Float32Array(positions.count * 3);
    for (let index = 0; index < positions.count; index++) {
      vertex.fromBufferAttribute(positions, index).applyMatrix4(node.matrixWorld).applyMatrix4(inverseCar);
      coords[index * 3] = (vertex.x - carBounds.min.x) / Math.max(0.001, carSize.x);
      coords[index * 3 + 1] = (vertex.y - carBounds.min.y) / Math.max(0.001, carSize.y);
      coords[index * 3 + 2] = (vertex.z - carBounds.min.z) / Math.max(0.001, carSize.z);
    }
    node.geometry.setAttribute("paintCoord", new THREE.BufferAttribute(coords, 3));
  });
  return centered;
}

export async function importVehicle(files: File[]) {
  const main = files.find((file) => /\.(glb|gltf)$/i.test(file.name));
  if (!main) throw new Error("Elegí un archivo .glb o .gltf.");
  if (files.reduce((total, file) => total + file.size, 0) > 80 * 1024 * 1024)
    throw new Error("El modelo y sus texturas no deben superar 80 MB.");
  const urls = new Map(files.map((file) => [file.name, URL.createObjectURL(file)]));
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (/^(data:|blob:)/.test(url)) return url;
    const file = urls.get(decodeURIComponent(url.split("/").at(-1) ?? url));
    if (!file)
      throw new Error(
        "Falta una textura o archivo .bin; seleccioná todos los archivos del modelo juntos.",
      );
    return file;
  });
  try {
    const loader = new GLTFLoader(manager);
    const model = await loader.parseAsync(await main.arrayBuffer(), "");
    if (!model.scene)
      throw new Error("El archivo no contiene una escena 3D visible. Elegí un modelo completo.");
    const normalized = normalizeVehicle(model.scene);
    // Normalization clones materials; uploaded geometry/textures are owned by the imported source.
    return { scene: model.scene, preview: normalized };
  } finally {
    urls.forEach((url) => URL.revokeObjectURL(url));
  }
}

export function disposeVehicle(source: THREE.Object3D, textures = false) {
  const maps = new Set<THREE.Texture>();
  source.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (textures)
        for (const value of Object.values(material))
          if (value instanceof THREE.Texture) maps.add(value);
      material.dispose();
    }
    if (textures) node.geometry.dispose();
  });
  maps.forEach((map) => map.dispose());
}
