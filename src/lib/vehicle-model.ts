import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

export function normalizeVehicle(source: THREE.Group) {
  const object = clone(source);
  // Sample model includes a fabric display surface, not a car part.
  if (object.getObjectByName('ToyCar')) object.getObjectByName('Fabric')?.removeFromParent();
  object.traverse(node => { if (node instanceof THREE.Camera || node instanceof THREE.Light) node.removeFromParent(); });
  object.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(object);
  const size = bounds.getSize(new THREE.Vector3());
  const length = Math.max(size.x, size.z);
  if (!Number.isFinite(length) || length <= 0) throw new Error('El archivo no contiene un auto visible.');
  const root = new THREE.Group(); root.add(object);
  root.scale.setScalar(4.3 / length);
  root.updateWorldMatrix(true, true);
  const scaled = new THREE.Box3().setFromObject(root);
  const center = scaled.getCenter(new THREE.Vector3());
  root.position.set(-center.x, -scaled.min.y, -center.z);
  const centered = new THREE.Group(); centered.add(root);
  centered.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    node.material = materials.map(source => {
      const material = new THREE.MeshStandardMaterial();
      if (source instanceof THREE.MeshStandardMaterial) {
        material.color.copy(source.color);
        material.map = source.map; material.normalMap = source.normalMap;
        material.metalnessMap = source.metalnessMap; material.roughnessMap = source.roughnessMap;
        material.metalness = source.metalness; material.roughness = source.roughness;
        material.transparent = source.transparent; material.opacity = source.opacity;
        material.side = source.side;
      }
      material.name = source.name;
      const name = `${node.name} ${source.name}`;
      material.userData['paint'] = /toycar|body|paint|carrocer|carpaint/i.test(name) && !/glass|tire|tyre|wheel|rubber/i.test(name);
      if (material.userData['paint']) { material.metalness = .9; material.roughness = .1; }
      if (/glass/i.test(name)) { material.color.set('#17232a'); material.transparent = true; material.opacity = .65; material.roughness = .1; material.metalness = .2; }
      material.envMapIntensity = 1;
      return material;
    });
    node.castShadow = false; node.receiveShadow = false;
  });
  return centered;
}

export async function importVehicle(files: File[]) {
  const main = files.find(file => /\.(glb|gltf)$/i.test(file.name));
  if (!main) throw new Error('Elegí un archivo .glb o .gltf.');
  if (files.reduce((total, file) => total + file.size, 0) > 80 * 1024 * 1024) throw new Error('El modelo y sus texturas no deben superar 80 MB.');
  const urls = new Map(files.map(file => [file.name, URL.createObjectURL(file)]));
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(url => {
    if (/^(data:|blob:)/.test(url)) return url;
    const file = urls.get(decodeURIComponent(url.split('/').at(-1) ?? url));
    if (!file) throw new Error('Falta una textura o archivo .bin; seleccioná todos los archivos del modelo juntos.');
    return file;
  });
  try {
    const loader = new GLTFLoader(manager);
    const model = await loader.parseAsync(await main.arrayBuffer(), '');
    const normalized = normalizeVehicle(model.scene);
    // Normalization clones materials; uploaded geometry/textures are owned by the imported source.
    return { scene: model.scene, preview: normalized };
  } finally { urls.forEach(url => URL.revokeObjectURL(url)); }
}

export function disposeVehicle(source: THREE.Object3D, textures = false) {
  const maps = new Set<THREE.Texture>();
  source.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (textures) for (const value of Object.values(material)) if (value instanceof THREE.Texture) maps.add(value);
      material.dispose();
    }
    if (textures) node.geometry.dispose();
  });
  maps.forEach(map => map.dispose());
}