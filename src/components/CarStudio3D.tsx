import { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import type { CarConfig, Sample } from "@/lib/car";
import toyCarAsset from "@/assets/models/toy-car.glb.asset.json";

const BODY_TRANSFORM: Record<CarConfig["body"], [number, number, number]> = {
  sedan: [1, 1.02, 1.02],
  coupe: [0.98, 0.94, 0.98],
  hiper: [0.96, 0.88, 0.96],
};

function useCarModel(car: CarConfig) {
  const { scene } = useGLTF(toyCarAsset.url);
  return useMemo(() => {
    const clone = scene.clone(true);
    // Normalizar: el modelo fuente viene en centímetros con escala 0.0001
    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const k = 4.3 / Math.max(size.x, size.z);
    const wrapper = new THREE.Group();
    clone.scale.multiplyScalar(k);
    clone.position.set(-center.x * k, -box.min.y * k, -center.z * k);
    wrapper.add(clone);
    wrapper.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      node.castShadow = true;
      node.receiveShadow = true;
      const source = (Array.isArray(node.material) ? node.material[0] : node.material) as THREE.MeshStandardMaterial;
      const mat = new THREE.MeshPhysicalMaterial({
        color: source.color ? source.color.clone() : new THREE.Color("#888888"),
        metalness: source.metalness ?? 0.4,
        roughness: source.roughness ?? 0.4,
        map: source.map ?? null,
      });
      if (node.name === "ToyCar") {
        // Carrocería: pintura con clearcoat teñida con el color elegido
        mat.color = new THREE.Color(car.color);
        mat.metalness = 0.55;
        mat.roughness = 0.24;
        mat.clearcoat = 1;
        mat.clearcoatRoughness = 0.08;
        mat.envMapIntensity = 1.4;
      }
      if (node.name === "Glass") {
        mat.transparent = true;
        mat.opacity = 0.55;
        mat.color = new THREE.Color("#0e1418");
        mat.metalness = 0.9;
        mat.roughness = 0.05;
        mat.envMapIntensity = 1.6;
      }
      node.material = mat;
    });
    return wrapper;
  }, [scene, car.color]);
}

function Wheel({ x, z, car, moving = false }: { x: number; z: number; car: CarConfig; moving?: boolean }) {
  const spin = useRef<THREE.Group>(null);
  useFrame((_, raw) => {
    if (spin.current && moving) spin.current.rotation.x -= Math.min(raw, 0.05) * 13;
  });
  const spokes = car.wheelStyle === "disco" ? 0 : car.wheelStyle === "malla" ? 12 : car.wheelStyle === "multirayo" ? 10 : 5;
  const radius = 0.28 + (car.wheelSize - 15) * 0.008;
  return <group position={[x, radius, z]} ref={spin}>
    <mesh rotation-z={Math.PI / 2} castShadow><cylinderGeometry args={[radius, radius, 0.19, 48]} /><meshStandardMaterial color="#101215" roughness={0.9} /></mesh>
    <mesh position={[x > 0 ? 0.11 : -0.11, 0, 0]} rotation-z={Math.PI / 2}>
      <cylinderGeometry args={[radius * 0.72, radius * 0.72, 0.012, 48]} />
      <meshStandardMaterial color={car.wheelColor} metalness={0.9} roughness={0.18} />
    </mesh>
    {spokes > 0 && Array.from({ length: spokes }, (_, i) => <mesh key={i} position={[x > 0 ? 0.122 : -0.122, 0, 0]} rotation-x={i * Math.PI / spokes}>
      <boxGeometry args={[0.018, radius * 1.33, spokes > 8 ? 0.016 : 0.034]} />
      <meshStandardMaterial color={car.wheelColor} metalness={0.95} roughness={0.15} />
    </mesh>)}
    <mesh position={[x > 0 ? 0.14 : -0.14, 0, 0]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.052, 0.052, 0.024, 24]} /><meshStandardMaterial color="#c8ced2" metalness={0.95} roughness={0.12} /></mesh>
  </group>;
}

function Engine({ car }: { car: CarConfig }) {
  const rows = car.layout.startsWith("V") || car.layout === "W16" ? 2 : 1;
  const count = Math.ceil(({ I3: 3, I4: 4, I6: 6, V6: 6, V8: 8, V10: 10, V12: 12, W16: 16 })[car.layout] / rows);
  return <group position={[0, 0.62, 0.55]}>
    <mesh castShadow><boxGeometry args={[0.65, 0.3, 0.62]} /><meshStandardMaterial color="#3a4045" metalness={0.9} roughness={0.25} /></mesh>
    {Array.from({ length: Math.min(count, 8) }, (_, i) => Array.from({ length: rows }, (_, j) => <mesh key={`${i}-${j}`} position={[(j - (rows - 1) / 2) * 0.32, 0.22, (i - (count - 1) / 2) * 0.085]} castShadow>
      <cylinderGeometry args={[0.07, 0.08, 0.22, 16]} /><meshStandardMaterial color="#98a1a8" metalness={0.95} roughness={0.18} />
    </mesh>))}
    <mesh position={[0, 0.4, 0]}><boxGeometry args={[0.48, 0.055, 0.57]} /><meshStandardMaterial color={car.accent} metalness={0.7} roughness={0.28} /></mesh>
  </group>;
}

function Vehicle({ car, installed, focus, moving = false }: { car: CarConfig; installed: boolean[]; focus: string; moving?: boolean }) {
  const model = useCarModel(car);
  useEffect(() => () => {
    model.traverse((node) => { if (node instanceof THREE.Mesh) (node.material as THREE.Material).dispose(); });
  }, [model]);
  const mounted = installed[7] || focus === "Carrocería" || moving;
  const lifted = (car.rideHeight - 0.5) * 0.16;
  const body = BODY_TRANSFORM[car.body];
  return <group scale={1.62}>
    {/* Bastidor visible antes de montar la carrocería */}
    {!mounted && <mesh position={[0, 0.3 + lifted, 0]} castShadow><boxGeometry args={[0.77, 0.12, 2.12]} /><meshStandardMaterial color="#4b5155" metalness={0.72} roughness={0.33} /></mesh>}
    {installed[3] && !mounted && <group><mesh position={[0, 0.32, -0.7]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.04, 0.04, 0.84, 12]} /><meshStandardMaterial color="#a9b0b5" metalness={0.95} roughness={0.2} /></mesh><mesh position={[0, 0.32, 0.66]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.04, 0.04, 0.84, 12]} /><meshStandardMaterial color="#a9b0b5" metalness={0.95} roughness={0.2} /></mesh></group>}
    {installed[1] && !mounted && <Engine car={car} />}
    {mounted
      ? <group position-y={lifted} scale={body} position-x={-0.02}><primitive object={model} /></group>
      : [-0.37, 0.37].flatMap((x) => [-0.7, 0.66].map((z) => <Wheel key={`${x}-${z}`} x={x} z={z} car={car} moving={moving} />))}
    {mounted && car.spoiler && <group position={[0, 0.78 + lifted, -1.02]}><mesh castShadow><boxGeometry args={[1.15, 0.04, 0.22]} /><meshPhysicalMaterial color={car.accent} metalness={0.7} roughness={0.25} clearcoat={0.8} /></mesh><mesh position={[-0.34, -0.12, 0]}><boxGeometry args={[0.035, 0.24, 0.05]} /><meshStandardMaterial color="#2c3033" metalness={0.6} /></mesh><mesh position={[0.34, -0.12, 0]}><boxGeometry args={[0.035, 0.24, 0.05]} /><meshStandardMaterial color="#2c3033" metalness={0.6} /></mesh></group>}
  </group>;
}

function StudioFloor() {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#23272a"; ctx.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 4000; i++) {
        const v = Math.round(30 + ((i * 37) % 22)); ctx.fillStyle = `rgb(${v},${v + 2},${v + 4})`;
        ctx.fillRect((i * 73) % 256, (i * 41) % 256, 1, 1);
      }
      ctx.strokeStyle = "#31373b"; ctx.lineWidth = 3; ctx.strokeRect(1, 1, 254, 254);
    }
    const t = new THREE.CanvasTexture(canvas); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(12, 12); return t;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return <mesh rotation-x={-Math.PI / 2} position-y={-0.018} receiveShadow><planeGeometry args={[40, 40]} /><meshStandardMaterial map={texture} roughness={0.42} metalness={0.35} envMapIntensity={0.7} /></mesh>;
}

function StudioLights() {
  return <>
    <color attach="background" args={["#14181b"]} />
    <fog attach="fog" args={["#14181b", 14, 34]} />
    <hemisphereLight args={["#dfe9f0", "#23262a", 1.1]} />
    <spotLight position={[5, 9, 4]} angle={0.5} penumbra={0.7} intensity={220} color="#fff4e0" castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} shadow-bias={-0.0002} />
    <spotLight position={[-6, 7, -3]} angle={0.6} penumbra={0.9} intensity={90} color="#bcd6ff" />
    <directionalLight position={[0, 6, -8]} intensity={0.8} color="#8fb4d8" />
    <Environment resolution={256}>
      <Lightformer intensity={4} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[12, 12, 1]} color="#fff6e8" />
      <Lightformer intensity={2.5} position={[-6, 2, 0]} rotation-y={Math.PI / 2} scale={[10, 2, 1]} color="#cfe4ff" />
      <Lightformer intensity={2} position={[6, 2, 0]} rotation-y={-Math.PI / 2} scale={[10, 2, 1]} color="#ffe9c8" />
      <Lightformer intensity={1.2} position={[0, 2, -7]} scale={[12, 2, 1]} color="#9fb8cc" />
    </Environment>
  </>;
}

function Stage({ car, installed, focus }: { car: CarConfig; installed: boolean[]; focus: string }) {
  return <>
    <StudioLights />
    <StudioFloor />
    <mesh position={[0, -0.12, 0]} receiveShadow><cylinderGeometry args={[3.1, 3.15, 0.22, 96]} /><meshStandardMaterial color="#15191c" metalness={0.7} roughness={0.3} envMapIntensity={0.9} /></mesh>
    <mesh position={[0, -0.02, 0]}><torusGeometry args={[3, 0.014, 8, 128]} /><meshBasicMaterial color="#d6a558" /></mesh>
    <ContactShadows position={[0, 0.005, 0]} opacity={0.75} scale={9} blur={2.2} far={3} resolution={512} color="#000000" />
    <Suspense fallback={null}><Vehicle car={car} installed={installed} focus={focus} /></Suspense>
    <OrbitControls makeDefault enablePan={false} minDistance={4.2} maxDistance={10} minPolarAngle={0.28} maxPolarAngle={1.5} target={[0, 0.6, 0]} autoRotate autoRotateSpeed={0.35} />
  </>;
}

export function CarStudio3D({ car, installed, focus }: { car: CarConfig; installed: boolean[]; focus: string }) {
  return <div className="relative h-[min(56vh,630px)] min-h-[340px] w-full bg-muted sm:min-h-[450px]" aria-label="Vista tridimensional del auto, arrastrá para girarlo y usá la rueda para acercar">
    <Canvas shadows dpr={[1, 2]} camera={{ position: [5.4, 2.7, 6.4], fov: 36 }} gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.15 }}>
      <Stage car={car} installed={installed} focus={focus} />
    </Canvas>
    <div className="pointer-events-none absolute bottom-4 left-4 border-l-2 border-primary bg-background/75 px-3 py-2 text-[11px] uppercase text-foreground backdrop-blur-sm">VISTA 3D · {focus}</div>
    <div className="pointer-events-none absolute bottom-4 right-4 hidden bg-background/60 px-2 py-1 font-mono text-[10px] text-muted-foreground sm:block">ARRASTRÁ PARA GIRAR · SCROLL PARA ZOOM</div>
  </div>;
}

function RaceCars({ car, rival, me, rv, running }: { car: CarConfig; rival: CarConfig; me: Sample | null; rv: Sample | null; running: boolean }) {
  const all = [true, true, true, true, true, true, true, true, true];
  return <>
    <group position={[-1.6, 0.12, 4 - Math.min((me?.x ?? 0) / 402, 1) * 16]}><Suspense fallback={null}><Vehicle car={car} installed={all} focus="Prueba" moving={running} /></Suspense></group>
    <group position={[1.6, 0.12, 4 - Math.min((rv?.x ?? 0) / 402, 1) * 16]}><Suspense fallback={null}><Vehicle car={rival} installed={all} focus="Prueba" moving={running} /></Suspense></group>
  </>;
}

export function Race3D({ car, rival, me, rv, running }: { car: CarConfig; rival: CarConfig; me: Sample | null; rv: Sample | null; running: boolean }) {
  return <div className="h-[370px] w-full overflow-hidden bg-muted sm:h-[450px]" aria-label="Carrera tridimensional de cuarto de milla">
    <Canvas shadows dpr={[1, 2]} camera={{ position: [10, 10, 15], fov: 46 }} gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1 }}>
      <color attach="background" args={["#2b3540"]} /><fog attach="fog" args={["#2b3540", 30, 80]} />
      <hemisphereLight args={["#e8f0f6", "#2c332e", 1.4]} />
      <directionalLight position={[10, 18, 6]} intensity={2.6} color="#fff2dd" castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} shadow-camera-left={-22} shadow-camera-right={22} shadow-camera-top={22} shadow-camera-bottom={-22} shadow-bias={-0.0002} />
      <Environment resolution={128}>
        <Lightformer intensity={2.5} position={[0, 10, 0]} rotation-x={Math.PI / 2} scale={[18, 18, 1]} color="#f4f8ff" />
        <Lightformer intensity={1.2} position={[-8, 3, -6]} scale={[12, 3, 1]} color="#ffd9a8" />
      </Environment>
      {/* Pasto y pianos */}
      <mesh rotation-x={-Math.PI / 2} position-y={-0.08} receiveShadow><planeGeometry args={[120, 120]} /><meshStandardMaterial color="#3d4a3c" roughness={1} /></mesh>
      <mesh rotation-x={-Math.PI / 2} receiveShadow><planeGeometry args={[7.6, 44]} /><meshStandardMaterial color="#2e3234" roughness={0.75} /></mesh>
      {Array.from({ length: 22 }, (_, i) => <mesh key={i} rotation-x={-Math.PI / 2} position={[-3.7, 0.005, 8 - i * 1.9]}><planeGeometry args={[0.5, 0.95]} /><meshBasicMaterial color={i % 2 ? "#c43b2e" : "#e8e6df"} /></mesh>)}
      {Array.from({ length: 22 }, (_, i) => <mesh key={i} rotation-x={-Math.PI / 2} position={[3.7, 0.005, 8 - i * 1.9]}><planeGeometry args={[0.5, 0.95]} /><meshBasicMaterial color={i % 2 ? "#c43b2e" : "#e8e6df"} /></mesh>)}
      {Array.from({ length: 11 }, (_, i) => <mesh key={i} rotation-x={-Math.PI / 2} position={[0, 0.012, 5 - i * 1.8]}><planeGeometry args={[0.08, 0.9]} /><meshBasicMaterial color="#d4d7d0" /></mesh>)}
      {/* Barreras */}
      {[-4.4, 4.4].map((x) => <mesh key={x} position={[x, 0.35, -6]}><boxGeometry args={[0.12, 0.7, 40]} /><meshStandardMaterial color="#5a6266" metalness={0.6} roughness={0.4} /></mesh>)}
      <ContactShadows position={[0, 0.02, 0]} opacity={0.6} scale={26} blur={2} far={4} resolution={512} />
      <RaceCars car={car} rival={rival} me={me} rv={rv} running={running} />
    </Canvas>
  </div>;
}
