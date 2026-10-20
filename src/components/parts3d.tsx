import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, OrbitControls, RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { LAYOUTS, type CarConfig } from "@/lib/car";
import { tyreTexture, tyreWallTexture } from "@/lib/carTextures";

/**
 * Collapses a subtree of static meshes into one draw per material. The cockpit
 * of the car is dozens of little boxes, and on an integrated chip every draw
 * call is real money: merging keeps the look and cuts the submissions to a
 * handful. Anything that has to move — the rim that turns with the steering —
 * stays outside the wrapper.
 */
export function Merged({ children }: { children: ReactNode }) {
  const root = useRef<THREE.Group>(null);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    node.updateWorldMatrix(true, true);
    const toLocal = new THREE.Matrix4().copy(node.matrixWorld).invert();
    const local = new THREE.Matrix4();
    const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const sources: THREE.Mesh[] = [];
    node.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh) return;
      if (Array.isArray(o.material) || !o.visible) return;
      const geometry = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      // Only the attributes every primitive shares survive a merge.
      for (const name of Object.keys(geometry.attributes)) {
        if (name !== "position" && name !== "normal" && name !== "uv") geometry.deleteAttribute(name);
      }
      local.multiplyMatrices(toLocal, o.matrixWorld);
      geometry.applyMatrix4(local);
      const bucket = buckets.get(o.material as THREE.Material);
      if (bucket) bucket.push(geometry);
      else buckets.set(o.material as THREE.Material, [geometry]);
      sources.push(o);
    });
    const added: THREE.Mesh[] = [];
    for (const [material, list] of buckets) {
      const geometry = list.length === 1 ? list[0]! : mergeGeometries(list, false);
      if (!geometry) continue;
      if (list.length > 1) list.forEach((g) => g.dispose());
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.matrixAutoUpdate = false;
      node.add(mesh);
      added.push(mesh);
    }
    sources.forEach((o) => {
      o.visible = false;
    });
    return () => {
      added.forEach((mesh) => {
        node.remove(mesh);
        mesh.geometry.dispose();
      });
      // The originals go back in the tree, ready for the next merge.
      sources.forEach((o) => {
        o.visible = true;
      });
    };
  }, [children]);
  return <group ref={root}>{children}</group>;
}

// Matches the mounting used by the workshop so a wheel never changes size.
function wheelRadius(inches: number) {
  return 0.3 + (inches - 15) * 0.008;
}

// ─── Detail parts ────────────────────────────────────────────────────────────
//
// Every station of the workshop gets a real, standalone component instead of a
// box: an engine with banks, heads, induction, exhaust and an accessory drive; a
// gearbox with a bellhousing and a gear stack; a tube-frame chassis; a coilover;
// a vented disc with a caliper; a tyre turned on a lathe with a real sidewall.
// The same components are dropped into the assembled car, so what you see while
// you edit a station is exactly what ends up on the vehicle.

type Mat = THREE.MeshStandardMaterial;

function makeMat(
  color: string,
  metalness: number,
  roughness: number,
  extra: THREE.MeshStandardMaterialParameters = {},
): Mat {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });
}

function useMats() {
  const mats = useMemo(
    () => ({
      alu: makeMat("#c6cdd6", 0.95, 0.26),
      aluDark: makeMat("#8b949f", 0.9, 0.36),
      cast: makeMat("#767e88", 0.55, 0.7),
      steel: makeMat("#b9c1cb", 1, 0.16),
      dark: makeMat("#2b3037", 0.8, 0.42),
      black: makeMat("#15181d", 0.35, 0.72),
      rubber: makeMat("#16191e", 0.05, 0.92),
      copper: makeMat("#c08a52", 0.9, 0.34),
      hose: makeMat("#23272d", 0.15, 0.85),
      carbon: makeMat("#191d23", 0.4, 0.42),
      red: makeMat("#c62828", 0.35, 0.42),
      blue: makeMat("#2a6ac6", 0.4, 0.4),
      yellow: makeMat("#e0b32a", 0.35, 0.45),
      titanium: makeMat("#a8a29a", 0.95, 0.3),
      ceramic: makeMat("#4a4f56", 0.5, 0.5),
      glass: makeMat("#a8c8ea", 0.2, 0.06),
      fabric: makeMat("#2e3a4a", 0.05, 0.95),
      painted: makeMat("#2f6fd0", 0.55, 0.24),
      warm: makeMat("#d8d2c8", 0.6, 0.5),
    }),
    [],
  );
  useEffect(
    () => () => {
      Object.values(mats).forEach((m) => m.dispose());
    },
    [mats],
  );
  return mats;
}

/** A tube swept along a poly-line: hoses, headers, roll cages and frame rails. */
function Tube({
  path,
  radius,
  material,
  segments = 26,
  radial = 8,
}: {
  path: readonly (readonly [number, number, number])[];
  radius: number;
  material: THREE.Material;
  segments?: number;
  radial?: number;
}) {
  const geometry = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3(path.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    const tube = new THREE.TubeGeometry(curve, segments, radius, radial, false);
    return tube;
  }, [path, radius, segments, radial]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} material={material} />;
}

/** A coil spring: a tube swept along a helix, so it reads as a real spring. */
function Spring({
  radius,
  height,
  turns,
  wire,
  material,
}: {
  radius: number;
  height: number;
  turns: number;
  wire: number;
  material: THREE.Material;
}) {
  const path = useMemo(() => {
    const points: [number, number, number][] = [];
    const steps = Math.round(turns * 22);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const angle = t * turns * Math.PI * 2;
      points.push([Math.cos(angle) * radius, height * (t - 0.5), Math.sin(angle) * radius]);
    }
    return points;
  }, [radius, height, turns]);
  return <Tube path={path} radius={wire} material={material} segments={path.length * 2} radial={6} />;
}

/** Revolve a 2D profile around the wheel axis: tyres, rims and brake discs. */
export function Lathe({
  profile,
  material,
  position,
  rotation,
  segments = 40,
}: {
  profile: readonly (readonly [number, number])[];
  material: THREE.Material;
  position?: [number, number, number];
  rotation?: [number, number, number];
  segments?: number;
}) {
  const geometry = useMemo(
    () => new THREE.LatheGeometry(profile.map((p) => new THREE.Vector2(p[0], p[1])), segments),
    [profile, segments],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} material={material} position={position ?? [0, 0, 0]} rotation={rotation ?? [0, 0, 0]} />;
}

/** Drilled, slotted face for a brake disc: cheaper than modelling every hole. */
function useDiscTexture(drilled: boolean, slotted: boolean) {
  return useMemo(() => {
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#b6bdc4";
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.fill();
      // Friction band: the outer two thirds are the working surface.
      ctx.strokeStyle = "#8d949b";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.4, 0, Math.PI * 2);
      ctx.stroke();
      if (slotted) {
        ctx.strokeStyle = "#8a9198";
        ctx.lineWidth = 4;
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(size / 2 + Math.cos(a) * size * 0.2, size / 2 + Math.sin(a) * size * 0.2);
          ctx.lineTo(size / 2 + Math.cos(a + 0.5) * size * 0.44, size / 2 + Math.sin(a + 0.5) * size * 0.44);
          ctx.stroke();
        }
      }
      if (drilled) {
        ctx.fillStyle = "#5f666d";
        for (let ring = 0; ring < 3; ring++) {
          const r = size * (0.22 + ring * 0.07);
          for (let i = 0; i < 14; i++) {
            const a = (i / 14) * Math.PI * 2 + ring * 0.22;
            ctx.beginPath();
            ctx.arc(size / 2 + Math.cos(a) * r, size / 2 + Math.sin(a) * r, 3.4, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }, [drilled, slotted]);
}

// ─── Engine ──────────────────────────────────────────────────────────────────

function cylinderCount(layout: CarConfig["layout"]) {
  return LAYOUTS[layout].cyl;
}

export function EngineModel({ car, scale = 1 }: { car: CarConfig; scale?: number }) {
  const m = useMats();
  const layout = car.layout;
  const cyl = cylinderCount(layout);
  const rotary = layout === "R2" || layout === "R3";
  const flat = layout === "H4" || layout === "H6";
  const w = layout === "W16";
  const inline = layout.startsWith("I") || flat || rotary;
  const perBank = w ? Math.ceil(cyl / 4) : flat ? cyl / 2 : cyl / 2;
  const banks = rotary ? 1 : w ? 4 : inline ? 1 : 2;
  const length = rotary ? 0.52 : 0.3 + Math.min(perBank, 8) * 0.088;
  const blockHeight = 0.24;
  const bankAngle = rotary ? 0 : w ? 0.24 : inline && !flat ? 0 : flat ? Math.PI / 2 - 0.22 : 0.5;
  const turbo = car.aspiration === "turbo" || car.aspiration === "biturbo";
  const blower = car.aspiration === "compresor";
  const electric = car.aspiration === "electrico";

  const bank = (index: number) => {
    const sign = index % 2 === 0 ? 1 : -1;
    const forward = index < 2 ? 1 : -1;
    const tilt = rotary ? 0 : (sign * bankAngle) / (w ? 2 : 1);
    const zOff = w ? forward * 0.11 : 0;
    return (
      <group key={`bank${index}`} rotation-z={tilt} position-z={zOff}>
        {/* Cylinder head and cam cover */}
        <RoundedBox args={[length * 0.94, 0.1, 0.19]} radius={0.02} smoothness={3} position={[0, blockHeight / 2 + 0.07, 0]} material={m.alu} />
        <RoundedBox args={[length * 0.86, 0.09, 0.16]} radius={0.028} smoothness={3} position={[0, blockHeight / 2 + 0.15, 0]} material={m.cast} />
        {Array.from({ length: 5 }, (_, i) => (
          <RoundedBox
            key={i}
            args={[0.012, 0.02, 0.14]}
            radius={0.004}
            smoothness={1}
            position={[-length * 0.34 + i * (length * 0.68) / 4, blockHeight / 2 + 0.2, 0]}
            material={m.cast}
          />
        ))}
        {/* Ignition coils / plug leads on the outside of the cover */}
        {Array.from({ length: Math.max(2, perBank) }, (_, i) => (
          <group key={`coil${i}`} position={[-length / 2 + 0.06 + (i * (length - 0.12)) / Math.max(1, perBank - 1), blockHeight / 2 + 0.15, 0.12]}>
            <mesh material={m.black}>
              <cylinderGeometry args={[0.022, 0.026, 0.09, 10]} />
            </mesh>
          </group>
        ))}
      </group>
    );
  };

  return (
    <group scale={scale}>
      {/* Crankcase */}
      <RoundedBox args={[length, blockHeight, 0.26]} radius={0.035} smoothness={3} material={m.cast} />
      {/* Cooling ribs along the block flank */}
      {Array.from({ length: 7 }, (_, i) => (
        <RoundedBox
          key={`rib${i}`}
          args={[0.02, blockHeight * 0.72, 0.27]}
          radius={0.006}
          smoothness={1}
          position={[-length / 2 + 0.05 + (i * (length - 0.1)) / 6, 0, 0]}
          material={m.aluDark}
        />
      ))}
      {/* Sump with a drain plug */}
      <RoundedBox args={[length * 0.86, 0.11, 0.22]} radius={0.03} smoothness={3} position={[0, -blockHeight / 2 - 0.05, 0]} material={m.dark} />
      <mesh position={[0, -blockHeight / 2 - 0.115, 0.06]} rotation-x={Math.PI / 2} material={m.steel}>
        <cylinderGeometry args={[0.022, 0.022, 0.03, 12]} />
      </mesh>

      {Array.from({ length: banks }, (_, i) => bank(i))}

      {/* Intake plenum in the valley, with a runner per cylinder */}
      {!rotary && (
        <group position={[0, blockHeight / 2 + 0.28, 0]}>
          <mesh rotation-z={Math.PI / 2} material={m.alu}>
            <cylinderGeometry args={[0.075, 0.075, length * 0.8, 18]} />
          </mesh>
          {Array.from({ length: Math.min(perBank, 6) }, (_, i) => (
            <mesh
              key={i}
              position={[-length * 0.3 + (i * (length * 0.6)) / Math.max(1, Math.min(perBank, 6) - 1), -0.09, 0]}
              material={m.aluDark}
            >
              <cylinderGeometry args={[0.026, 0.032, 0.16, 12]} />
            </mesh>
          ))}
          <RoundedBox args={[0.14, 0.11, 0.16]} radius={0.03} smoothness={3} position={[length * 0.44, -0.03, 0]} material={m.alu} />
          {/* Air box and inlet elbow */}
          <mesh position={[-length * 0.52, 0.02, 0]} material={m.black}>
            <cylinderGeometry args={[0.09, 0.09, 0.2, 16]} />
          </mesh>
          <Tube
            path={[
              [-length * 0.52, 0.06, 0],
              [-length * 0.66, 0.16, 0.06],
              [-length * 0.86, 0.12, 0.1],
            ]}
            radius={0.032}
            material={m.hose}
          />
        </group>
      )}

      {/* Exhaust headers: one curved primary per cylinder into a collector */}
      {!rotary &&
        (inline ? [0, 1] : [0, 1]).map((side) =>
          Array.from({ length: Math.max(3, perBank) }, (_, i) => {
            const x = -length / 2 + 0.08 + (i * (length - 0.16)) / Math.max(1, perBank - 1);
            const sign = side === 0 ? 1 : -1;
            return (
              <Tube
                key={`hdr${side}-${i}`}
                path={[
                  [x, -blockHeight / 2 + 0.02, sign * 0.13],
                  [x, -blockHeight / 2 - 0.1, sign * 0.24],
                  [x - 0.02, -blockHeight / 2 - 0.22, sign * 0.3],
                  [length / 2 + 0.16, -blockHeight / 2 - 0.2, sign * 0.22],
                ]}
                radius={0.022}
                material={m.titanium}
                segments={16}
                radial={7}
              />
            );
          }),
        )}
      {!rotary && (
        <mesh position={[length / 2 + 0.22, -blockHeight / 2 - 0.18, 0]} rotation-z={Math.PI / 2} material={m.titanium}>
          <cylinderGeometry args={[0.055, 0.07, 0.22, 14]} />
        </mesh>
      )}

      {/* Forced induction */}
      {turbo && (
        <group position={[length / 2 + 0.1, -0.02, 0]}>
          {[0, 1].slice(0, car.aspiration === "biturbo" ? 2 : 1).map((t) => {
            const sign = t === 0 ? 1 : -1;
            return (
              <group key={t} position-z={sign * 0.19}>
                <mesh rotation-z={Math.PI / 2} material={m.alu}>
                  <cylinderGeometry args={[0.07, 0.07, 0.11, 18]} />
                </mesh>
                <mesh position={[0, 0.02, 0]} rotation-y={Math.PI / 2} material={m.aluDark}>
                  <torusGeometry args={[0.055, 0.036, 10, 18, Math.PI * 1.5]} />
                </mesh>
                <mesh position={[0, 0.14, 0]} material={m.steel}>
                  <cylinderGeometry args={[0.03, 0.03, 0.08, 12]} />
                </mesh>
                <Tube
                  path={[
                    [0, 0.05, 0],
                    [-0.12, 0.24, 0.06 * sign],
                    [-0.3, 0.3, 0.12 * sign],
                  ]}
                  radius={0.026}
                  material={m.hose}
                />
              </group>
            );
          })}
          {/* Intercooler across the front of the engine */}
          <RoundedBox args={[0.34, 0.14, 0.1]} radius={0.02} smoothness={2} position={[0.16, 0.16, 0]} material={m.aluDark} />
        </group>
      )}
      {blower && (
        <group position={[0, blockHeight / 2 + 0.42, 0]}>
          <RoundedBox args={[length * 0.7, 0.16, 0.22]} radius={0.03} smoothness={3} material={m.aluDark} />
          <mesh position={[-length * 0.5, 0, 0]} rotation-z={Math.PI / 2} material={m.steel}>
            <cylinderGeometry args={[0.06, 0.06, 0.04, 16]} />
          </mesh>
        </group>
      )}
      {electric && (
        <group>
          <RoundedBox args={[length * 0.9, blockHeight * 1.1, 0.28]} radius={0.05} smoothness={3} material={m.blue} />
          <Tube
            path={[
              [-length * 0.4, 0.2, 0.1],
              [0, 0.3, 0.2],
              [length * 0.4, 0.2, 0.1],
            ]}
            radius={0.02}
            material={m.copper}
          />
        </group>
      )}

      {/* Accessory drive: crank pulley, water pump, alternator and the belt */}
      <group position={[length / 2 + 0.02, -0.04, 0]}>
        <mesh rotation-z={Math.PI / 2} material={m.steel}>
          <cylinderGeometry args={[0.075, 0.075, 0.03, 24]} />
        </mesh>
        <mesh position={[-0.03, 0.09, 0.13]} rotation-x={Math.PI / 2} material={m.aluDark}>
          <cylinderGeometry args={[0.05, 0.05, 0.04, 16]} />
        </mesh>
        <mesh position={[0, 0.17, 0]} rotation-z={Math.PI / 2} material={m.alu}>
          <cylinderGeometry args={[0.045, 0.05, 0.14, 14]} />
        </mesh>
      </group>
      <mesh position={[length / 2 + 0.02, 0.03, 0.07]} rotation-x={Math.PI / 2} material={m.hose}>
        <boxGeometry args={[0.02, 0.24, 0.012]} />
      </mesh>

      {/* Mounts and the wiring loom */}
      {[-1, 1].map((s) => (
        <RoundedBox
          key={s}
          args={[0.06, 0.09, 0.18]}
          radius={0.02}
          smoothness={2}
          position={[s * length * 0.32, -blockHeight / 2 - 0.02, s * 0.17]}
          rotation-z={s * 0.3}
          material={m.dark}
        />
      ))}
      <Tube
        path={[
          [-length / 2 - 0.04, 0.16, -0.14],
          [0, 0.24, -0.2],
          [length / 2 + 0.06, 0.1, -0.16],
        ]}
        radius={0.014}
        material={m.black}
      />
      <Tube
        path={[
          [-length / 2 - 0.06, -0.1, 0.14],
          [-length * 0.2, -0.24, 0.22],
          [length * 0.3, -0.22, 0.2],
        ]}
        radius={0.017}
        material={m.aluDark}
      />
    </group>
  );
}

// ─── Gearbox ─────────────────────────────────────────────────────────────────

function GearboxModel({ car, scale = 1 }: { car: CarConfig; scale?: number }) {
  const m = useMats();
  const gears = Math.max(4, Math.min(9, car.gears));
  const auto = car.gearbox === "automatica" || car.gearbox === "cvt";
  return (
    <group scale={scale}>
      {/* Bellhousing and clutch */}
      <mesh rotation-z={Math.PI / 2} material={m.aluDark}>
        <cylinderGeometry args={[0.17, 0.2, 0.22, 28]} />
      </mesh>
      <mesh rotation-z={Math.PI / 2} position-x={0.13} material={m.steel}>
        <cylinderGeometry args={[0.13, 0.13, 0.03, 24]} />
      </mesh>
      {/* Main casing with cooling ribs */}
      <RoundedBox args={[0.54, 0.26, 0.24]} radius={0.04} smoothness={3} position={[-0.36, 0, 0]} material={m.cast} />
      {Array.from({ length: 6 }, (_, i) => (
        <RoundedBox
          key={i}
          args={[0.02, 0.24, 0.25]}
          radius={0.006}
          smoothness={1}
          position={[-0.6 + i * 0.09, 0, 0]}
          material={m.aluDark}
        />
      ))}
      {/* Tail housing and output shaft */}
      <mesh rotation-z={Math.PI / 2} position-x={-0.7} material={m.alu}>
        <cylinderGeometry args={[0.09, 0.12, 0.16, 20]} />
      </mesh>
      <mesh rotation-z={Math.PI / 2} position-x={-0.82} material={m.steel}>
        <cylinderGeometry args={[0.035, 0.035, 0.14, 14]} />
      </mesh>
      {/* Gear stack, visible through the open side of the casing */}
      <group position={[-0.36, 0.16, 0]}>
        {Array.from({ length: gears }, (_, i) => (
          <mesh key={i} rotation-x={Math.PI / 2} position-x={-0.22 + i * 0.062} material={m.steel}>
            <cylinderGeometry args={[0.055 + (i % 3) * 0.012, 0.055 + (i % 3) * 0.012, 0.022, 22]} />
          </mesh>
        ))}
      </group>
      {/* Shifter tower: a lever for a manual, a selector for an automatic */}
      <RoundedBox args={[auto ? 0.16 : 0.1, 0.1, 0.16]} radius={0.025} smoothness={2} position={[-0.3, 0.18, 0.02]} material={m.alu} />
      <mesh position={[-0.3, 0.3, 0.02]} rotation-z={0.24} material={m.dark}>
        <cylinderGeometry args={[0.018, 0.022, auto ? 0.1 : 0.22, 12]} />
      </mesh>
      <mesh position={[-0.28, auto ? 0.36 : 0.42, 0.02]} material={m.black}>
        <sphereGeometry args={[0.032, 16, 12]} />
      </mesh>
      {/* Oil cooler lines */}
      <Tube
        path={[
          [-0.16, 0.1, 0.13],
          [-0.4, 0.26, 0.16],
          [-0.68, 0.14, 0.12],
        ]}
        radius={0.016}
        material={m.hose}
      />
      <Tube
        path={[
          [-0.16, -0.1, 0.13],
          [-0.42, -0.24, 0.15],
          [-0.68, -0.12, 0.12],
        ]}
        radius={0.016}
        material={m.hose}
      />
      <RoundedBox args={[0.12, 0.05, 0.2]} radius={0.02} smoothness={2} position={[-0.3, -0.16, 0]} material={m.dark} />
    </group>
  );
}

// ─── Chassis ─────────────────────────────────────────────────────────────────

export function ChassisModel({ car, scale = 1 }: { car: CarConfig; scale?: number }) {
  const m = useMats();
  const L = 4.3;
  const W = 1.5;
  const rail = 0.06;
  const corners: [number, number][] = [
    [W / 2, L / 2 - 0.5],
    [-W / 2, L / 2 - 0.5],
    [W / 2, -L / 2 + 0.5],
    [-W / 2, -L / 2 + 0.5],
  ];
  return (
    <group scale={scale}>
      {/* Floor pan */}
      <RoundedBox args={[W, 0.05, L * 0.82]} radius={0.02} smoothness={2} position={[0, 0.22, 0]} material={m.carbon} />
      {/* Main rails */}
      {corners.slice(0, 2).map(([x], i) => (
        <Tube
          key={`rail${i}`}
          path={[
            [x, 0.3, L / 2],
            [x * 1.02, 0.34, 0.6],
            [x * 0.98, 0.3, -0.9],
            [x, 0.34, -L / 2],
          ]}
          radius={rail}
          material={m.alu}
        />
      ))}
      {corners.slice(2).map(([x], i) => (
        <Tube
          key={`low${i}`}
          path={[
            [x, 0.2, L / 2 - 0.6],
            [x, 0.19, 0],
            [x, 0.22, -L / 2 + 0.4],
          ]}
          radius={rail * 0.9}
          material={m.alu}
        />
      ))}
      {/* Cross braces and diagonals: the frame has to read as a structure */}
      {[-1.4, -0.4, 0.6, 1.5].map((z, i) => (
        <Tube
          key={`cross${i}`}
          path={[
            [-W / 2, 0.3, z],
            [0, 0.34 + (i % 2) * 0.06, z + 0.05],
            [W / 2, 0.3, z],
          ]}
          radius={rail * 0.8}
          material={m.aluDark}
        />
      ))}
      {[-1, 1].map((s) =>
        [-1.1, -0.1, 1].map((z, i) => (
          <Tube
            key={`diag${s}${i}`}
            path={[
              [s * (W / 2), 0.2, z],
              [s * (W / 2 - 0.1), 0.33, z + 0.5],
            ]}
            radius={rail * 0.6}
            material={m.aluDark}
          />
        )),
      )}
      {/* Cockpit tub, seat rails and pedals */}
      <RoundedBox args={[0.86, 0.3, 1.4]} radius={0.05} smoothness={3} position={[0, 0.4, 0.15]} material={m.cast} />
      {[-1, 1].map((s) => (
        <Tube
          key={`seat${s}`}
          path={[
            [s * 0.34, 0.5, 0.7],
            [s * 0.34, 0.5, -0.3],
          ]}
          radius={0.025}
          material={m.steel}
        />
      ))}
      <RoundedBox args={[0.5, 0.04, 0.2]} radius={0.02} smoothness={2} position={[0, 0.42, 1.05]} rotation-x={-0.5} material={m.dark} />
      {/* Roll structure over the cockpit */}
      <Tube
        path={[
          [-0.62, 0.28, -0.2],
          [-0.56, 0.86, -0.1],
          [0, 0.96, -0.05],
          [0.56, 0.86, -0.1],
          [0.62, 0.28, -0.2],
        ]}
        radius={0.045}
        material={m.alu}
      />
      <Tube
        path={[
          [-0.62, 0.28, -0.2],
          [-0.3, 0.82, 0.3],
        ]}
        radius={0.03}
        material={m.aluDark}
      />
      <Tube
        path={[
          [0.62, 0.28, -0.2],
          [0.3, 0.82, 0.3],
        ]}
        radius={0.03}
        material={m.aluDark}
      />
      {/* Suspension pick-up points */}
      {[
        [0.78, 0.3, 1.4],
        [-0.78, 0.3, 1.4],
        [0.78, 0.3, -1.4],
        [-0.78, 0.3, -1.4],
      ].map((p, i) => (
        <group key={`pick${i}`} position={p as [number, number, number]}>
          <RoundedBox args={[0.08, 0.16, 0.1]} radius={0.02} smoothness={2} material={m.aluDark} />
          <mesh rotation-x={Math.PI / 2} material={m.steel}>
            <cylinderGeometry args={[0.02, 0.02, 0.12, 10]} />
          </mesh>
        </group>
      ))}
      {car.material === "carbono" && (
        <RoundedBox args={[W * 0.9, 0.02, L * 0.5]} radius={0.01} smoothness={1} position={[0, 0.26, 0]} material={m.carbon} />
      )}
    </group>
  );
}

// ─── Suspension ──────────────────────────────────────────────────────────────

function SuspensionModel({ car, scale = 1 }: { car: CarConfig; scale?: number }) {
  const m = useMats();
  const firm = car.suspension === "competicion" || car.suspension === "hidraulica";
  return (
    <group scale={scale} rotation-y={0.5}>
      {/* Coilover: body, rod, top mount and a real helical spring */}
      <mesh position={[0, 0.1, 0]} material={m.alu}>
        <cylinderGeometry args={[0.045, 0.045, 0.36, 20]} />
      </mesh>
      <mesh position={[0, 0.34, 0]} material={m.steel}>
        <cylinderGeometry args={[0.019, 0.019, 0.18, 14]} />
      </mesh>
      <Spring radius={0.062} height={0.3} turns={firm ? 7 : 6} wire={0.011} material={m.red} />
      <mesh position={[0, 0.26, 0]} material={m.aluDark}>
        <cylinderGeometry args={[0.075, 0.07, 0.02, 20]} />
      </mesh>
      <mesh position={[0, -0.08, 0]} material={m.aluDark}>
        <cylinderGeometry args={[0.08, 0.08, 0.03, 20]} />
      </mesh>
      <RoundedBox args={[0.14, 0.05, 0.14]} radius={0.02} smoothness={2} position={[0, 0.44, 0]} material={m.dark} />
      {/* Reservoir for a competition damper */}
      {firm && (
        <group position={[0.1, 0.1, 0.03]}>
          <mesh rotation-z={0.2} material={m.aluDark}>
            <cylinderGeometry args={[0.032, 0.032, 0.24, 16]} />
          </mesh>
          <Tube
            path={[
              [0.05, 0.06, 0],
              [0.16, 0.0, 0.02],
              [0.1, -0.06, 0.03],
            ]}
            radius={0.01}
            material={m.hose}
          />
        </group>
      )}
      {/* Double wishbones and the upright */}
      {[-1, 1].map((s) => (
        <group key={s} position={[0, 0, s * 0.22]}>
          <Tube
            path={[
              [-0.34, s * 0.02 + 0.24, 0],
              [0, s * 0.02 + 0.2, 0.02],
              [0.2, s * 0.02 + 0.16, 0],
            ]}
            radius={0.022}
            material={m.alu}
          />
          <Tube
            path={[
              [-0.36, s * 0.02 - 0.12, 0],
              [0, s * 0.02 - 0.06, 0.02],
              [0.2, s * 0.02 - 0.02, 0],
            ]}
            radius={0.024}
            material={m.aluDark}
          />
        </group>
      ))}
      <group position={[0.24, 0.1, 0]}>
        <RoundedBox args={[0.1, 0.3, 0.16]} radius={0.03} smoothness={3} material={m.aluDark} />
        <mesh rotation-z={Math.PI / 2} material={m.steel}>
          <cylinderGeometry args={[0.045, 0.045, 0.07, 18]} />
        </mesh>
        {/* Anti-roll bar drop link */}
        <Tube
          path={[
            [0, 0.16, 0.14],
            [0.1, 0.3, 0.24],
            [0.02, 0.4, 0.3],
          ]}
          radius={0.012}
          material={m.steel}
        />
      </group>
      <mesh position={[-0.38, 0.06, 0]} rotation-z={Math.PI / 2} material={m.steel}>
        <cylinderGeometry args={[0.026, 0.026, 0.62, 16]} />
      </mesh>
    </group>
  );
}

// ─── Brakes ──────────────────────────────────────────────────────────────────

function BrakeModel({ car, scale = 1 }: { car: CarConfig; scale?: number }) {
  const m = useMats();
  const carbon = car.brakes === "carbono" || car.brakes === "carbono-ceramica" || car.brakes === "ceramica";
  const texture = useDiscTexture(true, carbon);
  const face = useMemo(
    () => new THREE.MeshStandardMaterial({ map: texture, color: carbon ? "#8f949a" : "#c2c8ce", metalness: 0.75, roughness: 0.42 }),
    [texture, carbon],
  );
  useEffect(() => () => face.dispose(), [face]);
  const radius = 0.34;
  return (
    <group scale={scale} rotation-y={0.35}>
      {/* Ventilated disc: two friction faces with a vent band between them. The
          drill and slot pattern comes from the face texture, which is far
          cheaper than modelling every hole. */}
      <group rotation-z={Math.PI / 2}>
        <mesh material={face} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[radius, radius, 0.012, 40, 1, false]} />
        </mesh>
        <mesh material={face} position-y={0.032} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[radius, radius, 0.012, 40, 1, false]} />
        </mesh>
        <mesh material={m.dark} position-y={0.016}>
          <cylinderGeometry args={[radius * 0.97, radius * 0.97, 0.02, 26, 1, true]} />
        </mesh>
      </group>
      {/* Hub and lug nuts */}
      <mesh rotation-z={Math.PI / 2} material={m.aluDark}>
        <cylinderGeometry args={[0.09, 0.09, 0.075, 20]} />
      </mesh>
      <mesh rotation-z={Math.PI / 2} position-x={0.05} material={m.steel}>
        <cylinderGeometry args={[0.1, 0.1, 0.02, 20]} />
      </mesh>
      {Array.from({ length: 5 }, (_, i) => {
        const a = (i / 5) * Math.PI * 2;
        return (
          <mesh key={i} rotation-z={Math.PI / 2} position={[0.06, Math.cos(a) * 0.08, Math.sin(a) * 0.08]} material={m.steel}>
            <cylinderGeometry args={[0.014, 0.014, 0.02, 6]} />
          </mesh>
        );
      })}
      {/* Fixed caliper with two pads and the brake line */}
      <group position={[0.02, radius * 0.55, -0.16]}>
        <RoundedBox args={[0.09, 0.2, 0.11]} radius={0.025} smoothness={3} material={carbon ? m.dark : m.red} />
        <RoundedBox args={[0.03, 0.17, 0.1]} radius={0.01} smoothness={2} position={[-0.05, 0, 0]} material={m.dark} />
        <RoundedBox args={[0.03, 0.17, 0.1]} radius={0.01} smoothness={2} position={[0.05, 0, 0]} material={m.dark} />
        <mesh position={[0, 0.11, 0.02]} material={m.steel}>
          <cylinderGeometry args={[0.02, 0.02, 0.05, 10]} />
        </mesh>
        <Tube
          path={[
            [0, 0.12, 0.03],
            [0.07, 0.24, 0.06],
            [0.1, 0.32, 0.08],
          ]}
          radius={0.009}
          material={m.steel}
        />
      </group>
    </group>
  );
}

// ─── Wheel ───────────────────────────────────────────────────────────────────

export const TYRE_PROFILE = (outer: number, width: number): [number, number][] => [
  [outer * 0.72, -width / 2],
  [outer * 0.86, -width / 2 - 0.01],
  [outer * 0.97, -width * 0.42],
  [outer, -width * 0.3],
  [outer, width * 0.3],
  [outer * 0.97, width * 0.42],
  [outer * 0.86, width / 2 + 0.01],
  [outer * 0.72, width / 2],
];

export const RIM_PROFILE = (radius: number, width: number): [number, number][] => [
  [radius * 0.6, -width * 0.28],
  [radius * 0.72, -width * 0.42],
  [radius * 0.8, -width * 0.4],
  [radius * 0.8, width * 0.4],
  [radius * 0.72, width * 0.42],
  [radius * 0.6, width * 0.28],
];

export function WheelModel({ car, scale = 1 }: { car: CarConfig; scale?: number }) {
  const m = useMats();
  const radius = wheelRadius(car.wheelSize);
  const spokes =
    car.wheelStyle === "malla" ? 12 : car.wheelStyle === "multirayo" ? 10 : car.wheelStyle === "disco" ? 0 : car.wheelStyle === "turbina" ? 7 : 5;
  const rim = useMemo(
    () => makeMat(car.wheelColor, 0.92, 0.18),
    [car.wheelColor],
  );
  useEffect(() => () => rim.dispose(), [rim]);
  // The tyre carries its tread and its wall lettering, exactly like the wheels
  // that end up on the car, so the station preview matches the assembly.
  const tyre = useMemo(() => {
    const map = tyreTexture();
    return makeMat(map ? "#ffffff" : "#16191e", 0.05, 0.92, { map });
  }, []);
  const wall = useMemo(() => {
    const map = tyreWallTexture();
    return makeMat(map ? "#ffffff" : "#16191e", 0.05, 0.94, { map });
  }, []);
  useEffect(
    () => () => {
      tyre.dispose();
      wall.dispose();
    },
    [tyre, wall],
  );
  const width = 0.26;
  return (
    <group scale={scale}>
      <Lathe profile={TYRE_PROFILE(radius, width)} rotation={[0, 0, Math.PI / 2]} material={tyre} segments={48} />
      {/* Tread blocks: a ring of ribs so the tyre is not a smooth donut */}
      {Array.from({ length: 34 }, (_, i) => (
        <mesh key={i} rotation-z={(i / 34) * Math.PI * 2} material={wall}>
          <boxGeometry args={[radius * 0.06, width * 1.02, radius * 0.06]} />
        </mesh>
      ))}
      <Lathe profile={RIM_PROFILE(radius, width * 0.86)} rotation={[0, 0, Math.PI / 2]} material={rim} segments={40} />
      {/* Spokes tapering out from the hub */}
      {Array.from({ length: spokes }, (_, i) => (
        <group key={i} rotation-z={(i / Math.max(1, spokes)) * Math.PI * 2}>
          <RoundedBox
            args={[radius * 0.1, radius * 0.82, width * 0.34]}
            radius={0.012}
            smoothness={3}
            position={[radius * 0.46, 0, 0]}
            material={rim}
          />
        </group>
      ))}
      {spokes === 0 && (
        <Lathe
          profile={[
            [0.03, -width * 0.2],
            [radius * 0.78, -width * 0.28],
            [radius * 0.78, width * 0.28],
            [0.03, width * 0.2],
          ]}
          rotation={[0, 0, Math.PI / 2]}
          material={rim}
        />
      )}
      {/* Hub, centre cap and the five bolts */}
      <mesh rotation-z={Math.PI / 2} material={m.dark}>
        <cylinderGeometry args={[radius * 0.26, radius * 0.26, width * 0.36, 24]} />
      </mesh>
      <mesh rotation-z={Math.PI / 2} position-x={-width * 0.32} material={rim}>
        <cylinderGeometry args={[radius * 0.16, radius * 0.19, width * 0.06, 20]} />
      </mesh>
      {Array.from({ length: 5 }, (_, i) => {
        const a = (i / 5) * Math.PI * 2;
        return (
          <mesh key={i} rotation-z={Math.PI / 2} position={[-width * 0.3, Math.cos(a) * radius * 0.2, Math.sin(a) * radius * 0.2]} material={m.steel}>
            <cylinderGeometry args={[0.016, 0.016, 0.03, 6]} />
          </mesh>
        );
      })}
      {/* Brake disc and caliper seen through the spokes */}
      <mesh rotation-z={Math.PI / 2} position-x={width * 0.16} material={m.aluDark}>
        <cylinderGeometry args={[radius * 0.66, radius * 0.66, 0.02, 32]} />
      </mesh>
      <RoundedBox args={[0.06, 0.17, 0.1]} radius={0.02} smoothness={2} position={[width * 0.18, radius * 0.42, -radius * 0.1]} material={m.red} />
      <mesh rotation-z={Math.PI / 2} position-x={width * 0.16} material={m.dark}>
        <cylinderGeometry args={[radius * 0.24, radius * 0.24, 0.1, 18]} />
      </mesh>
    </group>
  );
}

// ─── Interior ────────────────────────────────────────────────────────────────

/**
 * Live cockpit telemetry: written every frame by the driving loop and read by
 * the dashboard, which saves threading a ref through three layers of props just
 * so a display can show a number.
 */
export const cockpitTelemetry = { speed: 0, rpm: 0, gear: 0 };

/** Paints the instrument cluster: rev strip, gear, road speed. */
function drawDash(ctx: CanvasRenderingContext2D, t: typeof cockpitTelemetry, maxRpm: number) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.fillStyle = "#070a0f";
  ctx.fillRect(0, 0, w, h);
  const x0 = 10;
  const barW = w - 20;
  const frac = Math.max(0, Math.min(1, t.rpm / Math.max(1, maxRpm)));
  ctx.fillStyle = "#141a22";
  ctx.fillRect(x0, 7, barW, 19);
  ctx.fillStyle = frac > 0.88 ? "#d33a2c" : frac > 0.72 ? "#e0b32a" : "#2a6ac6";
  ctx.fillRect(x0 + 2, 9, (barW - 4) * frac, 15);
  ctx.strokeStyle = "#0b0f15";
  ctx.lineWidth = 2;
  for (let i = 0; i <= 16; i++) {
    const x = x0 + (barW * i) / 16;
    ctx.beginPath();
    ctx.moveTo(x, 7);
    ctx.lineTo(x, 26);
    ctx.stroke();
  }
  ctx.textAlign = "left";
  ctx.fillStyle = "#7f8d9c";
  ctx.font = "bold 12px 'Segoe UI', system-ui, sans-serif";
  ctx.fillText("RPM", x0, 41);
  ctx.fillStyle = "#e7eef7";
  ctx.font = "bold 30px 'Segoe UI', system-ui, sans-serif";
  ctx.fillText(String(Math.round(t.speed)), x0, 76);
  ctx.fillStyle = "#7f8d9c";
  ctx.font = "bold 12px 'Segoe UI', system-ui, sans-serif";
  const kmh = ctx.measureText("000").width;
  ctx.fillText("km/h", x0 + kmh + 12, 76);
  ctx.textAlign = "right";
  ctx.fillStyle = "#7f8d9c";
  ctx.font = "bold 11px 'Segoe UI', system-ui, sans-serif";
  ctx.fillText("MARCHA", w - 10, 41);
  ctx.fillStyle = "#e7eef7";
  ctx.font = "bold 42px 'Segoe UI', system-ui, sans-serif";
  ctx.fillText(String(t.gear + 1), w - 12, 78);
}

export function InteriorModel({
  car,
  scale = 1,
  steerRef,
  cockpit = false,
  aligned = false,
  imported = false,
  podDrop = 0,
}: {
  car: CarConfig;
  scale?: number;
  /** Live steering angle from the physics, so the wheel turns with the input. */
  steerRef?: RefObject<number> | undefined;
  /** Cockpit mode faces straight ahead instead of the studio's three-quarter pose. */
  cockpit?: boolean;
  /**
   * The imported shell already supplies the bonnet, wings and roof line. In that
   * case the cockpit only draws the dark cabin trim, so the two bodies do not
   * z-fight and the pale procedural A-pillars do not float over the imported car.
   */
  imported?: boolean;
  /**
   * Faces the car's own axes with no cockpit frame: the same furniture seen
   * through the glass from outside, where the shell is already there.
   */
  aligned?: boolean;
  /** Metres the instrument pod drops, so an exterior cabin can tuck it under
      the screen instead of through the bonnet. */
  podDrop?: number;
}) {
  const m = useMats();
  // Instrument cluster: one small canvas, repainted a dozen times a second, so
  // the cockpit shows a live rev strip, the gear and the road speed instead of
  // a painted-on rectangle.
  const dash = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 288;
    canvas.height = 85;
    const ctx = canvas.getContext("2d");
    if (ctx) drawDash(ctx, cockpitTelemetry, car.maxRpm);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return { ctx, texture };
  }, [car.maxRpm]);
  const dashMat = useMemo(
    () => new THREE.MeshBasicMaterial({ map: dash.texture, toneMapped: false }),
    [dash],
  );
  useEffect(
    () => () => {
      dashMat.dispose();
      dash.texture.dispose();
    },
    [dash, dashMat],
  );
  const dashTick = useRef(0);
  useFrame((_, delta) => {
    if (!cockpit || !dash.ctx) return;
    dashTick.current += delta;
    if (dashTick.current < 0.08) return;
    dashTick.current = 0;
    drawDash(dash.ctx, cockpitTelemetry, car.maxRpm);
    dash.texture.needsUpdate = true;
  });
  const wheel = useRef<THREE.Group>(null);
  useFrame(() => {
    if (wheel.current) wheel.current.rotation.z = -(steerRef?.current ?? 0) * 1.4;
  });
  const racing = car.seatStyle === "racing" || car.seatStyle === "carbono";
  const shell = useMemo(
    () => makeMat(car.interiorColor, 0.35, racing ? 0.4 : 0.85),
    [car.interiorColor, racing],
  );
  useEffect(() => () => shell.dispose(), [shell]);
  const paint = useMemo(() => makeMat(car.color, 0.6, 0.22), [car.color]);
  useEffect(() => () => paint.dispose(), [paint]);
  return (
    <group scale={scale} rotation-y={cockpit || aligned ? 0 : -0.4}>
      {/* Bucket seat: shell, base cushion, backrest and side bolsters. Welded
          into one draw per material once mounted. It sits behind the driver's
          eye, so the cockpit skips it instead of paying for hidden geometry. */}
      {!cockpit && (
      <Merged>
        <group position={[0, 0, 0]}>
        <RoundedBox args={[0.56, 0.5, 0.5]} radius={0.09} smoothness={3} position={[0, 0.55, -0.3]} rotation-x={-0.18} material={shell} />
        <RoundedBox args={[0.5, 0.12, 0.48]} radius={0.05} smoothness={3} position={[0, 0.26, 0.02]} material={m.fabric} />
        <RoundedBox args={[0.46, 0.44, 0.1]} radius={0.045} smoothness={3} position={[0, 0.56, -0.5]} rotation-x={-0.18} material={m.fabric} />
        {[-1, 1].map((s) => (
          <RoundedBox
            key={s}
            args={[0.1, 0.42, 0.46]}
            radius={0.045}
            smoothness={3}
            position={[s * 0.25, 0.56, -0.28]}
            rotation-x={-0.18}
            material={shell}
          />
        ))}
        {/* Headrest and shoulder wings */}
        <RoundedBox args={[0.3, 0.16, 0.14]} radius={0.05} smoothness={3} position={[0, 0.88, -0.42]} material={m.fabric} />
        {[-1, 1].map((s) => (
          <RoundedBox key={`w${s}`} args={[0.09, 0.16, 0.3]} radius={0.04} smoothness={3} position={[s * 0.24, 0.82, -0.36]} material={shell} />
        ))}
        {/* Four-point harness */}
        {[-0.9, 0.9].map((s, i) => (
          <RoundedBox key={`h${i}`} args={[0.06, 0.5, 0.02]} radius={0.01} smoothness={1} position={[s * 0.18, 0.6, -0.34]} rotation-z={s * 0.16} material={m.red} />
        ))}
        <mesh position={[0, 0.3, -0.2]} material={m.steel}>
          <boxGeometry args={[0.12, 0.03, 0.06]} />
        </mesh>
        {/* Rails under the seat */}
        {[-1, 1].map((s) => (
          <RoundedBox key={`r${s}`} args={[0.05, 0.05, 0.5]} radius={0.012} smoothness={1} position={[s * 0.22, 0.14, -0.24]} material={m.aluDark} />
        ))}
        </group>
      </Merged>
      )}
      {/* Steering column and wheel. The rim faces the driver and the whole
          assembly turns with the live steering input. The wheel is a proper
          racing item: flattened carbon rim, leather grips at nine and three,
          paddle shifters, quick-release boss, a red top marker and gloved hands
          that grip the rim, so the cockpit moves with your hands. */}
      <group position={[0, 0.72, 0.62]} rotation-x={-0.3}>
        {/* Column between the wheel and the dash: thin, and its near end buried
            in the hub, so it never grows into a pipe in front of the eye. */}
        <mesh position={[0, 0, 0.3]} rotation-x={Math.PI / 2} material={m.aluDark}>
          <cylinderGeometry args={[0.028, 0.036, 0.24, 14]} />
        </mesh>
        <group ref={wheel} position={[0, 0, 0.16]}>
          <Merged>
          {/* Rim, a touch oval like a real wheel */}
          <mesh material={m.carbon} scale={[1, 0.94, 1]}>
            <torusGeometry args={[0.165, 0.021, 12, 40]} />
          </mesh>
          {/* Top marker at twelve o'clock */}
          <mesh position={[0, 0.156, 0]} material={m.red}>
            <boxGeometry args={[0.03, 0.012, 0.026]} />
          </mesh>
          {/* Leather grips where the hands go: the rim runs vertically here, so
              the grip follows it instead of sticking out sideways. */}
          {[-1, 1].map((s) => (
            <mesh key={`grip${s}`} position={[s * 0.163, 0, 0]} material={m.black}>
              <capsuleGeometry args={[0.026, 0.085, 6, 14]} />
            </mesh>
          ))}
          {/* Spokes: two horizontal blades and one low one */}
          {[-1, 0, 1].map((i) => (
            <mesh
              key={i}
              position={[i * 0.075, i === 0 ? -0.09 : 0, 0]}
              rotation-z={i === 0 ? Math.PI / 2 : i * 0.22}
              material={m.aluDark}
            >
              <boxGeometry args={[0.13, 0.03, 0.014]} />
            </mesh>
          ))}
          {/* Hub: quick-release boss, control pad and a pair of buttons — all on
              the driver's side of the rim, where the hands actually are. */}
          <mesh rotation-x={Math.PI / 2} material={m.dark}>
            <cylinderGeometry args={[0.05, 0.055, 0.05, 18]} />
          </mesh>
          <mesh rotation-x={Math.PI / 2} position={[0, 0, -0.035]} material={m.blue}>
            <cylinderGeometry args={[0.036, 0.036, 0.02, 16]} />
          </mesh>
          <RoundedBox args={[0.07, 0.045, 0.022]} radius={0.01} smoothness={1} position={[0, 0.03, -0.038]} material={m.black} />
          {[-1, 1].map((s) => (
            <mesh key={`btn${s}`} position={[s * 0.045, -0.03, -0.038]} material={s > 0 ? m.red : m.blue}>
              <sphereGeometry args={[0.012, 12, 10]} />
            </mesh>
          ))}
          {/* Paddle shifters behind the rim */}
          {[-1, 1].map((s) => (
            <mesh key={`pad${s}`} position={[s * 0.11, -0.02, -0.05]} rotation-z={s * 0.35} rotation-x={0.25} material={m.alu}>
              <boxGeometry args={[0.07, 0.028, 0.008]} />
            </mesh>
          ))}
          {/* Gloved hands: a fist closed round the grip, the four fingers
              stacked down the rim and curling towards the driver, the thumb
              hooked on the inside — then the cuff and the forearm running back
              to the seat, which is what makes the view read as a cockpit and
              not as a wheel floating in front of a camera. */}
          {[-1, 1].map((s) => (
            <group key={`hand${s}`} position={[s * 0.163, 0, 0.012]} rotation-z={s * 0.1}>
              <RoundedBox args={[0.078, 0.115, 0.1]} radius={0.03} smoothness={3} material={m.dark} />
              {[0, 1, 2, 3].map((f) => (
                <mesh
                  key={f}
                  position={[s * 0.006, 0.033 - f * 0.023, -0.07]}
                  rotation-x={-Math.PI / 2.2}
                  rotation-z={s * (0.14 - f * 0.07)}
                  material={f % 2 === 0 ? m.dark : m.cast}
                >
                  <capsuleGeometry args={[0.0115, 0.05, 4, 10]} />
                </mesh>
              ))}
              {/* Thumb, hooked on the inside of the rim */}
              <mesh position={[s * -0.042, 0.03, -0.03]} rotation-x={-1.15} rotation-z={s * 0.45} material={m.dark}>
                <capsuleGeometry args={[0.013, 0.045, 4, 10]} />
              </mesh>
              {/* Cuff, then the forearm running back and down to the seat */}
              <mesh position={[s * 0.015, -0.05, -0.1]} rotation-x={-1.75} material={m.black}>
                <cylinderGeometry args={[0.044, 0.048, 0.13, 12]} />
              </mesh>
              <mesh position={[s * 0.05, -0.075, -0.3]} rotation-x={-1.85} rotation-z={s * -0.14} material={m.fabric}>
                <capsuleGeometry args={[0.046, 0.22, 6, 14]} />
              </mesh>
            </group>
          ))}
          </Merged>
        </group>
      </group>
      {/* Dashboard: carbon brow, one instrument pod dead centre above the
          column, a live display turned to face the driver and the shift lights
          across the top. The car has a single central seat, so nothing here is
          offset to one side. */}
      <Merged>
        <group position={[0, 0.6, 1.0]}>
        <RoundedBox args={[1.06, 0.24, 0.3]} radius={0.05} smoothness={3} material={m.dark} />
        <RoundedBox args={[1.1, 0.05, 0.34]} radius={0.02} smoothness={2} position={[0, 0.165, -0.01]} material={m.carbon} />
        {/* Neck rising off the dash, and the pod it carries: high enough that
            the rim never hides the display, shallow enough to leave the road
            in view. */}
        <RoundedBox args={[0.13, 0.24, 0.1]} radius={0.025} smoothness={2} position={[0, 0.22, 0.09]} material={m.dark} />
        <RoundedBox args={[0.46, 0.15, 0.15]} radius={0.03} smoothness={2} position={[0, 0.35 - podDrop, 0.075]} material={m.dark} />
        {/* The display, proud of the pod's face and turned to the driver */}
        <mesh position={[0, 0.35 - podDrop, -0.008]} rotation-y={Math.PI} material={dashMat}>
          <planeGeometry args={[0.42, 0.125]} />
        </mesh>
        {/* Shift lights across the top of the pod */}
        {[-0.15, -0.075, 0, 0.075, 0.15].map((x, i) => (
          <mesh key={`sl${i}`} position={[x, 0.44 - podDrop, 0.03]} material={i < 2 ? m.blue : i < 4 ? m.yellow : m.red}>
            <sphereGeometry args={[0.011, 10, 8]} />
          </mesh>
        ))}
        {/* Vents, one per side */}
        {[-0.34, 0.34].map((x) => (
          <mesh key={x} position={[x, 0.02, -0.17]} material={m.black}>
            <torusGeometry args={[0.05, 0.018, 8, 16]} />
          </mesh>
        ))}
        <mesh position={[0, -0.1, -0.05]} rotation-x={0.4} material={m.aluDark}>
          <boxGeometry args={[0.6, 0.05, 0.2]} />
        </mesh>
        {/* Column shroud joining the dash to the wheel */}
        <mesh position={[0, 0.02, -0.14]} rotation-x={0.12} material={m.dark}>
          <boxGeometry args={[0.2, 0.14, 0.3]} />
        </mesh>
        </group>
      </Merged>
      {/* Cabin frame, drawn only from the driver's seat: bonnet line, A-pillars,
          header rail, headliner, door tops, rear bulkhead and the mirror.
          Without it the cockpit would float in open air once the outer shell is
          dropped, but in the studio the interior is shown on its own. */}
      {cockpit && (
        <Merged>
          {!imported && (
            <>
              {/* Bonnet and front wings in the car's own paint: they survive
                  the dropped procedural shell. An imported body already has
                  these panels, so drawing them again would double the nose. */}
              <group position={[0, 0.66, 1.55]} rotation-x={0.12}>
                <RoundedBox args={[1.3, 0.06, 1.5]} radius={0.03} smoothness={3} material={paint} />
                {[-0.26, 0.26].map((x) => (
                  <mesh key={`vent${x}`} position={[x, 0.042, 0.07]} material={m.black}>
                    <boxGeometry args={[0.24, 0.02, 0.46]} />
                  </mesh>
                ))}
                {[-0.5, 0.5].map((x) => (
                  <mesh key={`line${x}`} position={[x, 0.03, 0.35]} material={m.dark}>
                    <boxGeometry args={[0.012, 0.02, 1.1]} />
                  </mesh>
                ))}
              </group>
              <group position={[0, 0.48, 2.52]} rotation-x={0.32}>
                <RoundedBox args={[1.2, 0.05, 0.95]} radius={0.03} smoothness={3} material={paint} />
              </group>
              {[-1, 1].map((s) => (
                <group key={`wing${s}`} position={[s * 0.68, 0.6, 1.5]} rotation-x={0.12} rotation-z={s * -0.07}>
                  <RoundedBox args={[0.34, 0.05, 1.45]} radius={0.03} smoothness={3} material={paint} />
                </group>
              ))}
            </>
          )}
          {/* A single cabin lamp: outdoors the interior would sit in its own
              shade and read as one black mass from the driver's eye. */}
          <pointLight position={[0, 1.35, 0.2]} intensity={2.6} distance={3} decay={2} color="#e6ecf4" />
          {imported ? (
            <>
              {/* The outer shell is hidden in first person, so drawing its
                  header or A-pillars here would leave two loose bars floating
                  across the road. The dashboard, wheel and door tops are enough
                  to read the cabin. */}
            </>
          ) : (
            <>
              {/* Headliner and pillars in pale trim for the procedural cabin: a
                  black cabin reads as a hole punched in the frame. */}
              <mesh position={[0, 1.62, 0.1]} material={m.cast}>
                <boxGeometry args={[1.36, 0.04, 1.5]} />
              </mesh>
              {[-1, 1].map((s) => (
                <mesh
                  key={`ap${s}`}
                  position={[s * 0.62, 1.2, 1.46]}
                  rotation-x={-0.2}
                  rotation-z={-s * 0.06}
                  material={m.cast}
                >
                  <boxGeometry args={[0.055, 0.62, 0.08]} />
                </mesh>
              ))}
              <mesh position={[0, 1.56, 1.0]} rotation-x={0.1} material={m.cast}>
                <boxGeometry args={[1.36, 0.07, 0.18]} />
              </mesh>
              <mesh position={[0, 1.36, 1.02]} material={m.black}>
                <boxGeometry args={[0.34, 0.1, 0.04]} />
              </mesh>
              <mesh position={[0, 1.47, 1.05]} material={m.dark}>
                <boxGeometry args={[0.04, 0.14, 0.04]} />
              </mesh>
            </>
          )}
          <mesh position={[0, 1.05, -0.8]} material={m.dark}>
            <boxGeometry args={[1.26, 0.95, 0.08]} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={`door${s}`} position={[s * 0.68, 0.72, 0.2]} material={m.dark}>
              <boxGeometry args={[0.08, 0.45, 1.6]} />
            </mesh>
          ))}
        </Merged>
      )}
      {/* Centre tunnel, shifter, pedals and roll cage, welded into the same
          handful of draws as the rest of the standing interior. */}
      <Merged>
        {/* Centre tunnel and shifter */}
        <RoundedBox args={[0.22, 0.2, 1.2]} radius={0.04} smoothness={3} position={[0, 0.32, 0.3]} material={m.dark} />
      <mesh position={[0, 0.46, 0.5]} rotation-z={0.2} material={m.steel}>
        <cylinderGeometry args={[0.014, 0.018, 0.18, 10]} />
      </mesh>
      <mesh position={[0, 0.55, 0.52]} material={m.black}>
        <sphereGeometry args={[0.028, 14, 10]} />
      </mesh>
      {/* Pedals */}
      {[-1, 1].map((s) => (
        <RoundedBox key={s} args={[0.07, 0.12, 0.02]} radius={0.01} smoothness={1} position={[s * 0.16, 0.42, 0.95]} rotation-x={-0.5} material={m.alu} />
      ))}
      {/* Roll cage around the cabin */}
      {car.rollCage && (
        <group>
          <Tube
            path={[
              [-0.62, 0.2, -0.5],
              [-0.56, 1.02, -0.36],
              [0, 1.12, -0.32],
              [0.56, 1.02, -0.36],
              [0.62, 0.2, -0.5],
            ]}
            radius={0.038}
            material={m.steel}
          />
          <Tube
            path={[
              [-0.6, 0.3, -0.5],
              [-0.5, 0.9, 0.5],
            ]}
            radius={0.032}
            material={m.steel}
          />
          <Tube
            path={[
              [0.6, 0.3, -0.5],
              [0.5, 0.9, 0.5],
            ]}
            radius={0.032}
            material={m.steel}
          />
          <Tube
            path={[
              [-0.52, 1.0, -0.36],
              [0.52, 1.0, -0.36],
            ]}
            radius={0.028}
            material={m.steel}
          />
        </group>
      )}
      </Merged>
    </group>
  );
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

export const PART_STATIONS = [
  "Proyecto",
  "Motor",
  "Transmisión",
  "Chasis",
  "Suspensión",
  "Frenos",
  "Ruedas",
  "Carrocería",
  "Interior",
] as const;

export function PartModel({ station, car }: { station: number; car: CarConfig }) {
  switch (station) {
    case 1:
      return <EngineModel car={car} />;
    case 2:
      return <GearboxModel car={car} />;
    case 3:
      return <ChassisModel car={car} />;
    case 4:
      return <SuspensionModel car={car} />;
    case 5:
      return <BrakeModel car={car} />;
    case 6:
      return <WheelModel car={car} />;
    case 8:
      return <InteriorModel car={car} />;
    default:
      return null;
  }
}

// ─── Close-up studio ─────────────────────────────────────────────────────────

/** Frames whatever part is mounted: no hand-tuned camera per station. */
function Framer({ children, spin }: { children: ReactNode; spin: number }) {
  const group = useRef<THREE.Group>(null);
  const camera = useThree((state) => state.camera);
  const viewport = useThree((state) => state.size);
  const controls = useThree((state) => state.controls) as { target?: THREE.Vector3; update?: () => void } | null;
  useEffect(() => {
    const node = group.current;
    if (!node) return;
    const fit = () => {
      // Measured with the group cleared, then the group itself is moved: the
      // part ends up centred on the turntable's axis and clear of the floor, so
      // the spin turns it in place instead of orbiting the camera's view.
      node.position.set(0, 0, 0);
      const raw = new THREE.Box3().setFromObject(node);
      if (raw.isEmpty()) return;
      const rawCentre = raw.getCenter(new THREE.Vector3());
      node.position.set(-rawCentre.x, Math.max(0, 0.02 - raw.min.y), -rawCentre.z);
      node.traverse((o) => {
        if (o instanceof THREE.Mesh) o.castShadow = true;
      });
      const box = new THREE.Box3().setFromObject(node);
      const size = box.getSize(new THREE.Vector3());
      const centre = box.getCenter(new THREE.Vector3());
      const radius = 0.5 * Math.hypot(size.x, size.y, size.z) || 0.4;
      const cam = camera as THREE.PerspectiveCamera;
      const vTan = Math.tan((cam.fov * Math.PI) / 360);
      const hTan = vTan * Math.max(0.5, cam.aspect || 1.6);
      const dir = new THREE.Vector3(0.85, 0.45, 1.15).normalize();
      // Aimed a touch above the middle: the station label sits in the lower
      // left corner of the canvas and never has to sit on the part.
      const aim = centre.clone();
      aim.y += radius * 0.05;
      // The frame is fitted to the volume the part sweeps as the turntable
      // turns: every corner of the model, at its worst angle of the turn, is
      // pushed just inside the edges. A plain bounding sphere fits the same
      // worst case but leaves a long part swimming in empty frame.
      const zAxis = dir.clone();
      const xAxis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), zAxis).normalize();
      const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
      const offset = centre.clone().sub(aim);
      const half = size.clone().multiplyScalar(0.5);
      let distance = radius * 0.5;
      for (let turn = 0; turn < Math.PI * 2 - 1e-4; turn += Math.PI / 8) {
        const cos = Math.cos(turn);
        const sin = Math.sin(turn);
        for (let corner = 0; corner < 8; corner++) {
          const x = corner & 1 ? half.x : -half.x;
          const y = corner & 2 ? half.y : -half.y;
          const z = corner & 4 ? half.z : -half.z;
          // Rotated about the turntable's own axis, then measured from the aim.
          const px = x * cos + z * sin + offset.x;
          const py = y + offset.y;
          const pz = -x * sin + z * cos + offset.z;
          const along = px * dir.x + py * dir.y + pz * dir.z;
          const across = Math.abs(px * xAxis.x + py * xAxis.y + pz * xAxis.z) / hTan;
          const high = Math.abs(px * yAxis.x + py * yAxis.y + pz * yAxis.z) / vTan;
          const need = along + Math.max(across, high);
          if (need > distance) distance = need;
        }
      }
      distance *= 1.08;
      camera.position.copy(aim).add(dir.clone().multiplyScalar(distance));
      camera.lookAt(aim);
      if (controls?.target) {
        controls.target.copy(aim);
        controls.update?.();
      }
    };
    // Framed once the controls exist, then again a frame later so that nothing
    // mounted afterwards can pull the camera back to the default. A resize of
    // the panel re-frames too: the part must never end up clipped by the edges.
    fit();
    const id = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(id);
  }, [camera, controls, children, viewport.width, viewport.height]);
  useFrame((_, delta) => {
    if (group.current && spin > 0) group.current.rotation.y += delta * spin;
  });
  return <group ref={group}>{children}</group>;
}

function StudioLights() {
  return (
    <>
      <color attach="background" args={["#343434"]} />
      <hemisphereLight args={["#e9eaec", "#2d2d2d", 1.35]} />
      <directionalLight
        castShadow
        position={[3, 5, 4]}
        intensity={2.1}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={4}
        shadow-camera-bottom={-4}
        shadow-camera-near={0.5}
        shadow-camera-far={24}
        shadow-bias={-0.0012}
        shadow-normalBias={0.03}
      />
      <directionalLight position={[-4, 2, -3]} intensity={0.8} color="#d7d7d9" />
      {/* Rim light from behind: without it every black part reads as a hole */}
      <directionalLight position={[-1, 2, -5]} intensity={1.6} color="#e8e8ea" />
      <Environment resolution={96} frames={1}>
        <Lightformer intensity={3.2} position={[0, 4, 2]} scale={[6, 3, 1]} color="#ffffff" />
        <Lightformer intensity={2.4} position={[-4, 1, 0]} rotation-y={Math.PI / 2} scale={[5, 4, 1]} color="#e9eaec" />
        <Lightformer intensity={2.4} position={[4, 1, 0]} rotation-y={-Math.PI / 2} scale={[5, 4, 1]} color="#ffffff" />
        <Lightformer intensity={2} position={[0, 1, -5]} scale={[6, 3, 1]} color="#f0f0f2" />
      </Environment>
      {/* Turntable floor: grounds the part and catches the key light */}
      <mesh rotation-x={-Math.PI / 2} position-y={-0.02} receiveShadow>
        <circleGeometry args={[6, 48]} />
        <meshStandardMaterial color="#242424" metalness={0.35} roughness={0.6} />
      </mesh>
    </>
  );
}

/**
 * The close-up station view: one real component, lit like a display piece, so
 * every station is inspected the way it is edited.
 */
export function PartStudio({
  station,
  car,
  spin = true,
  className = "h-full",
}: {
  station: number;
  car: CarConfig;
  spin?: boolean;
  className?: string;
}) {
  const name = PART_STATIONS[station] ?? "Pieza";
  // The camera options are memoised: r3f re-applies them whenever their identity
  // changes, which would otherwise drag the view back to the default angle on
  // every re-render of the workshop.
  const camera = useMemo(
    () => ({ position: [1.5, 1.1, 2.1] as [number, number, number], fov: 34 }),
    [],
  );
  return (
    <div className={`relative w-full ${className}`} aria-label={`Vista de ${name}`}>
      <Canvas
        shadows
        camera={camera}
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: "high-performance", toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
        onCreated={({ gl }) => {
          gl.shadowMap.enabled = true;
          gl.shadowMap.type = THREE.PCFShadowMap;
        }}
      >
        <StudioLights />
        <Framer spin={spin ? 0.28 : 0}>
          <PartModel station={station} car={car} />
        </Framer>
        <OrbitControls makeDefault enablePan={false} minDistance={0.5} maxDistance={12} enableDamping />
      </Canvas>
      <div className="scene-vignette" aria-hidden />
      <div className="pointer-events-none absolute bottom-3 left-3 gloss rounded-lg border border-primary/40 bg-background/80 px-3 py-1.5 leading-tight">
        <p className="font-mono text-[9px] tracking-[0.2em] text-primary uppercase">Pieza en edición</p>
        <p className="mt-0.5 font-display text-lg tracking-wide text-foreground uppercase">{name}</p>
      </div>
    </div>
  );
}
