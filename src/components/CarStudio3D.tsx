import { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Lightformer, OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import type { CarConfig, Sample } from "@/lib/car";

const MODEL: Record<CarConfig["body"], string> = {
  sedan: "/models/sedan-sports.glb",
  coupe: "/models/race.glb",
  hiper: "/models/race-future.glb",
};

function Wheel({ x, z, car, moving = false }: { x: number; z: number; car: CarConfig; moving?: boolean }) {
  const spin = useRef<THREE.Group>(null);
  useFrame((_, raw) => {
    if (spin.current && moving) spin.current.rotation.x -= Math.min(raw, 0.05) * 13;
  });
  const spokes = car.wheelStyle === "disco" ? 0 : car.wheelStyle === "malla" ? 12 : car.wheelStyle === "multirayo" ? 10 : 5;
  const radius = 0.28 + (car.wheelSize - 15) * 0.008;
  return <group position={[x, radius, z]} ref={spin}>
    <mesh rotation-z={Math.PI / 2} castShadow><cylinderGeometry args={[radius, radius, 0.19, 32]} /><meshStandardMaterial color="#121418" roughness={0.85} /></mesh>
    <mesh position={[x > 0 ? 0.11 : -0.11, 0, 0]} rotation-z={Math.PI / 2}>
      <cylinderGeometry args={[radius * 0.72, radius * 0.72, 0.012, 32]} />
      <meshStandardMaterial color={car.wheelColor} metalness={0.85} roughness={0.23} />
    </mesh>
    {spokes > 0 && Array.from({ length: spokes }, (_, i) => <mesh key={i} position={[x > 0 ? 0.122 : -0.122, 0, 0]} rotation-x={i * Math.PI / spokes}>
      <boxGeometry args={[0.018, radius * 1.33, spokes > 8 ? 0.016 : 0.034]} />
      <meshStandardMaterial color={car.wheelColor} metalness={0.92} roughness={0.2} />
    </mesh>)}
    <mesh position={[x > 0 ? 0.14 : -0.14, 0, 0]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.052, 0.052, 0.024, 16]} /><meshStandardMaterial color="#aab0b4" metalness={0.9} roughness={0.15} /></mesh>
  </group>;
}

function Engine({ car }: { car: CarConfig }) {
  const rows = car.layout.startsWith("V") || car.layout === "W16" ? 2 : 1;
  const count = Math.ceil(({ I3: 3, I4: 4, I6: 6, V6: 6, V8: 8, V10: 10, V12: 12, W16: 16 })[car.layout] / rows);
  return <group position={[0, 0.62, 0.55]}>
    <mesh castShadow><boxGeometry args={[0.65, 0.3, 0.62]} /><meshStandardMaterial color="#454c51" metalness={0.85} roughness={0.28} /></mesh>
    {Array.from({ length: Math.min(count, 8) }, (_, i) => Array.from({ length: rows }, (_, j) => <mesh key={`${i}-${j}`} position={[(j - (rows - 1) / 2) * 0.32, 0.22, (i - (count - 1) / 2) * 0.085]} castShadow>
      <cylinderGeometry args={[0.07, 0.08, 0.22, 12]} /><meshStandardMaterial color="#8b949a" metalness={0.9} roughness={0.22} />
    </mesh>))}
    <mesh position={[0, 0.4, 0]}><boxGeometry args={[0.48, 0.055, 0.57]} /><meshStandardMaterial color={car.accent} metalness={0.6} roughness={0.32} /></mesh>
  </group>;
}

function Vehicle({ car, installed, focus, moving = false }: { car: CarConfig; installed: boolean[]; focus: string; moving?: boolean }) {
  const { scene } = useGLTF(MODEL[car.body]);
  const model = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      node.castShadow = true;
      node.receiveShadow = true;
      if (node.name.startsWith("wheel-")) node.visible = false;
      if (node.name === "spoiler") node.visible = car.spoiler;
      if (node.name === "body") {
        const original = Array.isArray(node.material) ? node.material[0] : node.material;
        const mat = (original as THREE.MeshStandardMaterial).clone();
        mat.color = new THREE.Color(car.color).lerp(new THREE.Color("#ffffff"), 0.38);
        mat.roughness = 0.27;
        mat.metalness = 0.48;
        node.material = mat;
      }
    });
    return clone;
  }, [scene, car.body, car.color, car.spoiler]);
  useEffect(() => () => {
    model.traverse((node) => { if (node instanceof THREE.Mesh && node.name === "body") (node.material as THREE.Material).dispose(); });
  }, [model]);
  const mounted = installed[1] || focus === "Carrocería" || moving;
  const lifted = (car.rideHeight - 0.5) * 0.16;
  return <group scale={1.62}>
    {/* Visible frame before the body is installed */}
    <mesh position={[0, 0.3 + lifted, 0]} castShadow><boxGeometry args={[0.77, 0.12, 2.12]} /><meshStandardMaterial color="#4b5155" metalness={0.72} roughness={0.33} /></mesh>
    {installed[3] && <group><mesh position={[0, 0.32, -0.7]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.04, 0.04, 0.84, 12]} /><meshStandardMaterial color="#a9b0b5" metalness={0.95} roughness={0.2} /></mesh><mesh position={[0, 0.32, 0.66]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.04, 0.04, 0.84, 12]} /><meshStandardMaterial color="#a9b0b5" metalness={0.95} roughness={0.2} /></mesh></group>}
    {installed[2] && <Engine car={car} />}
    {mounted && <group position-y={lifted} scale-y={0.92 + car.roof * 0.16}><primitive object={model} /></group>}
    {[-0.37, 0.37].flatMap((x) => [-0.7, 0.66].map((z) => <Wheel key={`${x}-${z}`} x={x} z={z} car={car} moving={moving} />))}
    {installed[7] && car.spoiler && car.body !== "sedan" && <group position={[0, 0.97 + lifted, -1.06]}><mesh castShadow><boxGeometry args={[1.2, 0.045, 0.24]} /><meshStandardMaterial color={car.accent} metalness={0.65} roughness={0.3} /></mesh><mesh position={[-0.37, -0.13, 0]}><boxGeometry args={[0.04, 0.25, 0.05]} /><meshStandardMaterial color="#34383b" /></mesh><mesh position={[0.37, -0.13, 0]}><boxGeometry args={[0.04, 0.25, 0.05]} /><meshStandardMaterial color="#34383b" /></mesh></group>}
  </group>;
}

function StudioFloor() {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#303539"; ctx.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 1000; i++) {
        const v = Math.round(45 + ((i * 37) % 20)); ctx.fillStyle = `rgb(${v},${v + 2},${v + 4})`;
        ctx.fillRect((i * 73) % 128, (i * 41) % 128, 1, 1);
      }
      ctx.strokeStyle = "#40474a"; ctx.lineWidth = 2; ctx.strokeRect(1, 1, 126, 126);
    }
    const t = new THREE.CanvasTexture(canvas); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(10, 10); return t;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return <mesh rotation-x={-Math.PI / 2} position-y={-0.018} receiveShadow><planeGeometry args={[30, 30]} /><meshStandardMaterial map={texture} roughness={0.57} metalness={0.2} /></mesh>;
}

function Stage({ car, installed, focus }: { car: CarConfig; installed: boolean[]; focus: string }) {
  return <>
    <color attach="background" args={["#23292c"]} />
    <fog attach="fog" args={["#23292c", 12, 30]} />
    <hemisphereLight args={["#e9f2f7", "#3d4140", 2]} />
    <directionalLight position={[4, 9, 6]} intensity={3.5} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={8} shadow-camera-bottom={-8} />
    <Environment resolution={128}><Lightformer intensity={3} position={[1, 6, 3]} scale={[10, 4, 1]} /><Lightformer intensity={2} position={[-5, 3, -2]} rotation-y={Math.PI / 2} scale={[8, 3, 1]} /><Lightformer intensity={1} position={[3, 2, -5]} scale={[7, 3, 1]} /></Environment>
    <StudioFloor />
    <mesh position={[0, -0.12, 0]} receiveShadow><cylinderGeometry args={[3.1, 3.15, 0.22, 64]} /><meshStandardMaterial color="#1b2022" metalness={0.6} roughness={0.37} /></mesh>
    <mesh position={[0, -0.02, 0]}><torusGeometry args={[3, 0.012, 6, 96]} /><meshBasicMaterial color="#d6a558" /></mesh>
    <Suspense fallback={null}><Vehicle car={car} installed={installed} focus={focus} /></Suspense>
    <OrbitControls makeDefault enablePan={false} minDistance={4.4} maxDistance={10} minPolarAngle={0.28} maxPolarAngle={1.5} target={[0, 0.65, 0]} autoRotate autoRotateSpeed={0.35} />
  </>;
}

export function CarStudio3D({ car, installed, focus }: { car: CarConfig; installed: boolean[]; focus: string }) {
  return <div className="relative h-[min(56vh,630px)] min-h-[340px] w-full bg-muted sm:min-h-[450px]" aria-label="Vista tridimensional del auto, arrastrá para girarlo y usá la rueda para acercar">
    <Canvas shadows dpr={[1, 1.5]} camera={{ position: [5.7, 3.1, 6.7], fov: 37 }} gl={{ antialias: true }}>
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
    <Canvas shadows dpr={[1, 1.5]} camera={{ position: [10, 11, 16], fov: 48 }}>
      <color attach="background" args={["#53656a"]} /><fog attach="fog" args={["#53656a", 25, 65]} />
      <hemisphereLight args={["#dfeaf0", "#353c36", 2]} /><directionalLight position={[8, 16, 5]} intensity={3} castShadow shadow-camera-left={-20} shadow-camera-right={20} shadow-camera-top={20} shadow-camera-bottom={-20} />
      <Environment resolution={64}><Lightformer intensity={2} position={[0, 8, 0]} scale={[15, 15, 1]} /></Environment>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.08} receiveShadow><planeGeometry args={[100, 100]} /><meshStandardMaterial color="#536559" roughness={1} /></mesh>
      <mesh rotation-x={-Math.PI / 2} receiveShadow><planeGeometry args={[7, 42]} /><meshStandardMaterial color="#303638" roughness={0.8} /></mesh>
      {Array.from({ length: 11 }, (_, i) => <mesh key={i} rotation-x={-Math.PI / 2} position={[0, 0.012, 5 - i * 1.8]}><planeGeometry args={[0.08, 0.9]} /><meshBasicMaterial color="#d4d7d0" /></mesh>)}
      {[-3.35, 3.35].map((x) => <mesh key={x} rotation-x={-Math.PI / 2} position={[x, 0.013, -5]}><planeGeometry args={[0.06, 24]} /><meshBasicMaterial color="#e3d5ae" /></mesh>)}
      <RaceCars car={car} rival={rival} me={me} rv={rv} running={running} />
    </Canvas>
  </div>;
}
