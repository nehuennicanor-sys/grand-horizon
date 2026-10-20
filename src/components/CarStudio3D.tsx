import {
  Suspense,
  Component,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Environment,
  Html,
  Lightformer,
  OrbitControls,
  RoundedBox,
  useGLTF,
} from "@react-three/drei";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  Pause,
  Play,
  RotateCcw,
  Camera,
  Lightbulb,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { NEUTRAL_SCULPT, specs, simulate, type CarConfig, type Sample } from "@/lib/car";
import { normalizeVehicle, disposeVehicle, paintPatternIndex } from "@/lib/vehicle-model";
import {
  applyImpact,
  damageState,
  driveSetup,
  newDriveState,
  resetDamage,
  stepDrive,
} from "@/lib/driving";
import { drawGrain, makeRng } from "@/lib/prng";
import {
  carbonTexture,
  flakeNormalTexture,
  grilleTexture,
  tyreTexture,
  tyreWallTexture,
} from "@/lib/carTextures";
import { Circuit3D } from "@/components/Circuit3D";
import { ChunkedInstances, cullForReflection, markChunksDirty, type ChunkItem } from "@/components/chunked";
import {
  ChassisModel,
  EngineModel,
  InteriorModel,
  Merged,
  cockpitTelemetry,
  TYRE_PROFILE,
  RIM_PROFILE,
  Lathe,
} from "@/components/parts3d";
import {
  createClubCircuit,
  type CircuitId,
  nearestTrack,
  type ClubCircuit,
} from "@/lib/club-circuit";
import {
  RIVAL_COUNT,
  aiBand,
  buildRivals,
  classify,
  createField,
  guideFor,
  playerSlot,
  resolveContacts,
  stepAiCar,
  raceTime,
  type ContactBody,
  type RaceRow,
  type RaceState,
  type RivalSpec,
} from "@/lib/race";

function palette() {
  const css = getComputedStyle(document.documentElement);
  const get = (name: string) => css.getPropertyValue(`--scene-${name}`).trim();
  return {
    studio: get("studio"),
    floor: get("floor"),
    metal: get("metal"),
    rubber: get("rubber"),
    glass: get("glass"),
    sky: get("sky"),
    grass: get("grass"),
    asphalt: get("asphalt"),
    line: get("line"),
    curb: get("curb"),
    warm: get("warm"),
    cool: get("cool"),
    shadow: get("shadow"),
  };
}

import { PerfContext, type Perf } from "@/components/perf-context";
export { PerfContext, type Perf };

// ─── Procedural car bodies per category ───────────────────────────────────────

// Canonical mounting points shared by every body and by the wheels, so the
// bodywork and the wheels can never drift apart or intersect incorrectly.
export const WHEEL_X = 0.88;
export const AXLE_FRONT = 1.42;
export const AXLE_REAR = -1.45;
export function wheelRadius(inches: number) {
  return 0.3 + (inches - 15) * 0.008;
}

// Materials are rebuilt whenever the user changes a colour, so every hook
// releases the previous instance instead of leaking GPU memory in the workshop.
function useDispose<T extends THREE.Material>(material: T): T {
  useEffect(() => () => material.dispose(), [material]);
  return material;
}

function useCarPaint(car: CarConfig) {
  return useDispose(
    useMemo(() => {
      const material = new THREE.MeshPhysicalMaterial({
        color: car.color,
        metalness: 0.62,
        roughness: 0.3,
        clearcoat: 1,
        clearcoatRoughness: 0.08,
        envMapIntensity: 1.35,
      });
      // Metallic flake under the clearcoat: a shallow normal map, so the
      // highlights break up as the car turns instead of sliding across the panel
      // like a mirror. Every class wears the same finish.
      const flake = flakeNormalTexture();
      if (flake) {
        material.normalMap = flake;
        material.normalScale = new THREE.Vector2(0.22, 0.22);
        material.clearcoatNormalMap = flake;
        material.clearcoatNormalScale = new THREE.Vector2(0.32, 0.32);
      }
      return material;
    }, [car.color]),
  );
}

function useCarAccent(car: CarConfig) {
  return useDispose(
    useMemo(
      () =>
        new THREE.MeshPhysicalMaterial({
          color: car.accent,
          metalness: 0.7,
          roughness: 0.24,
          clearcoat: 0.85,
          clearcoatRoughness: 0.12,
        }),
      [car.accent],
    ),
  );
}

// Carbon fibre for the aero kit. The weave is a real twill texture instead of a
// flat black, and it carries a clearcoat of its own, so a splitter or a wing
// catches the light the way a laid-up part does.
function useCarbonMaterial() {
  return useDispose(
    useMemo(() => {
      const map = carbonTexture();
      return new THREE.MeshPhysicalMaterial({
        color: map ? "#ffffff" : "#22272e",
        map,
        metalness: 0.34,
        roughness: 0.24,
        clearcoat: 0.7,
        clearcoatRoughness: 0.16,
        envMapIntensity: 1.3,
      });
    }, []),
  );
}

// The open mesh behind every intake: a dark honeycomb with bright edges, so the
// grille reads as a hole punched in the bumper instead of a black box.
function useGrilleMaterial() {
  return useDispose(
    useMemo(() => {
      const map = grilleTexture();
      return new THREE.MeshStandardMaterial({
        color: map ? "#ffffff" : "#0e1116",
        map,
        metalness: 0.7,
        roughness: 0.42,
      });
    }, []),
  );
}

function useGlassMaterial() {
  return useDispose(
    useMemo(
      () =>
        new THREE.MeshPhysicalMaterial({
          color: "#16222f",
          metalness: 0.25,
          roughness: 0.05,
          transparent: true,
          opacity: 0.74,
          envMapIntensity: 1.8,
          clearcoat: 1,
          clearcoatRoughness: 0.03,
        }),
      [],
    ),
  );
}

function useTrimMaterial() {
  return useDispose(
    useMemo(
      () =>
        new THREE.MeshStandardMaterial({
          color: "#14161b",
          metalness: 0.45,
          roughness: 0.55,
        }),
      [],
    ),
  );
}

function useChromeMaterial() {
  return useDispose(
    useMemo(
      () =>
        new THREE.MeshStandardMaterial({
          color: "#cfd4da",
          metalness: 1,
          roughness: 0.14,
          envMapIntensity: 1.4,
        }),
      [],
    ),
  );
}

function useLampMaterial(color: string, intensity: number, tag?: string) {
  return useDispose(
    useMemo(() => {
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: intensity,
        roughness: 0.25,
        metalness: 0.1,
        toneMapped: true,
      });
      // Tagged so the headlight switch can find the lenses at runtime without
      // rebuilding the car. A name costs nothing and survives the material
      // cache inside the model.
      if (tag) material.name = tag;
      return material;
    }, [color, intensity, tag]),
  );
}

// ─── Lofted bodywork ─────────────────────────────────────────────────────────
//
// Boxes never read as a car, and neither do separate shells stacked on each
// other: the whole body is one continuous surface. It is built as a loft — a
// list of cross-section stations runs the length of the car, and the skin
// between consecutive sections is stitched into strips. Nose, bonnet, roof,
// deck, tail, floor and the wheel-arch openings are all stations of that same
// surface, so there is nothing to come apart: no floating roof, no gaps at the
// pillars. As the strips are stitched they are tagged paint / smoked glass /
// dark trim, which is what draws the canopy into the one uninterrupted skin.

type Point2 = readonly [number, number];

/** Hermite (Catmull-Rom) curve through (z, value) anchors, sorted ascending. */
function crSpline(anchors: [number, number][]) {
  return (z: number) => {
    const n = anchors.length;
    const first = anchors[0]!;
    const last = anchors[n - 1]!;
    if (z <= first[0]) return first[1];
    if (z >= last[0]) return last[1];
    let i = 0;
    while (i < n - 2 && z > anchors[i + 1]![0]) i++;
    const [z0, y0] = anchors[i]!;
    const [z1, y1] = anchors[i + 1]!;
    const prev = anchors[i - 1];
    const next = anchors[i + 2];
    const m0 = prev ? (y1 - prev[1]) / (z1 - prev[0]) : (y1 - y0) / (z1 - z0);
    const m1 = next ? (next[1] - y0) / (next[0] - z0) : (y1 - y0) / (z1 - z0);
    const h = z1 - z0;
    const t = (z - z0) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * y0 +
      (t3 - 2 * t2 + t) * h * m0 +
      (-2 * t3 + 3 * t2) * y1 +
      (t3 - t2) * h * m1
    );
  };
}

function smoothstep(e0: number, e1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// Keyed so restyling rebuilds the hull exactly once, never once per frame.
function useHull(key: string, make: () => THREE.BufferGeometry) {
  const held = useRef<{ key: string; geometry: THREE.BufferGeometry } | null>(null);
  if (held.current === null || held.current.key !== key) {
    held.current?.geometry.dispose();
    held.current = { key, geometry: make() };
  }
  const geometry = held.current.geometry;
  useEffect(() => () => geometry.dispose(), [geometry]);
  return geometry;
}

// The canopy: lightly smoked glass, not paint. It is kept properly transparent
// so the cabin behind it can be seen from any angle, and it leans on the
// environment map instead of on opacity for the reflections that make a window
// read as glass.
function useCanopyMaterial() {
  return useDispose(
    useMemo(
      () =>
        new THREE.MeshPhysicalMaterial({
          color: "#0d1a27",
          metalness: 0.22,
          roughness: 0.04,
          transparent: true,
          opacity: 0.44,
          envMapIntensity: 2.4,
          clearcoat: 1,
          clearcoatRoughness: 0.02,
          depthWrite: false,
        }),
      [],
    ),
  );
}

// Lays a flat panel along one slope of the silhouette, pushed clear of the
// surface by `lift` so glazing, lamps and trim read as fitted pieces instead of
// decals sinking inside the shell.
function SlopePanel({
  from,
  to,
  inward,
  x = 0,
  width,
  thickness = 0.06,
  lift = 0.05,
  material,
}: {
  from: Point2;
  to: Point2;
  inward: Point2;
  x?: number;
  width: number;
  thickness?: number;
  lift?: number;
  material: THREE.Material;
}) {
  const dz = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dz, dy);
  let nz = dy / length;
  let ny = -dz / length;
  const midZ = (from[0] + to[0]) / 2;
  const midY = (from[1] + to[1]) / 2;
  // Flip the normal so it always points away from the cabin's interior.
  if ((midZ - inward[0]) * nz + (midY - inward[1]) * ny < 0) {
    nz = -nz;
    ny = -ny;
  }
  return (
    <RoundedBox
      args={[width, length, thickness]}
      radius={Math.min(0.016, thickness * 0.35)}
      bevelSegments={1}
      smoothness={2}
      position={[x, midY + ny * lift, midZ + nz * lift]}
      rotation-x={Math.atan2(dz, dy)}
      material={material}
    />
  );
}

// ─── Wheel arches ─────────────────────────────────────────────────────────────
//
// The loft cuts a real circular opening over each axle so the tyres actually
// show through — the single biggest reason a procedural car reads as a car.
// The cut is a circle of radius ARCH_CUT whose centre rides on the sill line at
// the axle, so the wheel sits dead centre of its arch whatever the dials do.

const SILL_Y = 0.25;
const ARCH_CUT = 0.52;

/** Height of the sill line at z: it rises into the arch cut over each axle. */
function archEdgeY(z: number) {
  let y = SILL_Y;
  for (const axle of [AXLE_REAR, AXLE_FRONT]) {
    const d = z - axle;
    if (Math.abs(d) < ARCH_CUT) y = Math.max(y, SILL_Y + Math.sqrt(ARCH_CUT * ARCH_CUT - d * d));
  }
  return y;
}

/** The mould widens the whole footprint: body, fenders and the wheel track. */
export function widthFactor(car: CarConfig) {
  const s = car.sculpt ?? NEUTRAL_SCULPT;
  return 1 + (s.width - 0.5) * 0.16;
}

/** Half the distance between the tyres: the wheels follow the mould. */
export function trackX(car: CarConfig) {
  const base = car.category === "deportivo" ? 0.88 : car.category === "superdeportivo" ? 0.96 : 0.92;
  return base * widthFactor(car);
}

// The arch opening: the loft already cuts the real circular hole, and the hull
// carries the body-coloured fender lip now, so all that is left to add is the
// dark liner just inside the opening — the shadow between tyre and fender.
function ArchBands({ car }: { car: CarConfig }) {
  const trim = useTrimMaterial();
  const s = car.sculpt ?? NEUTRAL_SCULPT;
  const m = useMemo(() => mould(car), [car]);
  const side = m.width / 2 + m.bulge * 0.6 - 0.07;
  const tube = 0.04 + s.arches * 0.04;
  return (
    <>
      {[AXLE_FRONT, AXLE_REAR].map((z) =>
        [-1, 1].map((sd) => (
          <group key={`${z}-${sd}`} position={[sd * side, SILL_Y, z]} rotation-y={Math.PI / 2}>
            <mesh position={[0, 0, -sd * 0.05]} material={trim}>
              <torusGeometry args={[ARCH_CUT - 0.02, tube, 6, 36, Math.PI]} />
            </mesh>
          </group>
        )),
      )}
    </>
  );
}

function Mirrors({
  car,
  x = 0.84,
  y = 0.96,
  z = 0.52,
}: {
  car: CarConfig;
  x?: number;
  y?: number;
  z?: number;
}) {
  const paint = useCarPaint(car);
  const trim = useTrimMaterial();
  return (
    <>
      {[-1, 1].map((s) => (
        <group key={s} position={[s * x, y, z]}>
          <RoundedBox
            args={[0.2, 0.035, 0.055]}
            radius={0.014}
            bevelSegments={1}
            smoothness={2}
            position={[s * 0.06, -0.05, -0.02]}
            rotation-z={s * 0.42}
            material={trim}
          />
          <RoundedBox
            args={[0.11, 0.1, 0.2]}
            radius={0.036}
            bevelSegments={2}
            smoothness={2}
            position={[s * 0.15, 0.01, 0.01]}
            rotation-y={s * 0.22}
            material={paint}
          />
        </group>
      ))}
    </>
  );
}

function Exhausts({
  xs,
  y,
  z,
  chrome,
  size = 0.055,
}: {
  xs: number[];
  y: number;
  z: number;
  chrome: THREE.Material;
  size?: number;
}) {
  return (
    <>
      {xs.map((x) => (
        <mesh key={x} position={[x, y, z]} rotation-x={Math.PI / 2} material={chrome}>
          <cylinderGeometry args={[size, size * 1.12, 0.26, 14, 1, true]} />
        </mesh>
      ))}
    </>
  );
}

// The bright moulding under the side glass. It is the line that says where the
// greenhouse ends and the door begins, and it is what turns the blacked-out
// posts into a frame instead of a shadow — so every class wears it, from the
// street coupé to the touring car.
function WindowBelt({ mould, material }: { mould: Mould; material: THREE.Material }) {
  const skin = useMemo(() => makeSkin(mould), [mould]);
  const from = mould.roofX1 + 0.05;
  const to = mould.cowlX + 0.02;
  const y = mould.beltY - 0.015;
  const segments = 5;
  return (
    <>
      {[-1, 1].map((s) => (
        <group key={s}>
          {Array.from({ length: segments }, (_, i) => {
            const z0 = from + ((to - from) * i) / segments;
            const z1 = from + ((to - from) * (i + 1)) / segments;
            const x0 = skin.xAt(z0, y);
            const x1 = skin.xAt(z1, y);
            return (
              <RoundedBox
                key={i}
                args={[0.022, 0.026, Math.hypot(z1 - z0, x1 - x0) + 0.012]}
                radius={0.007}
                bevelSegments={1}
                smoothness={1}
                position={[s * ((x0 + x1) / 2 + 0.006), y, (z0 + z1) / 2]}
                rotation-y={Math.atan2(s * (x1 - x0), z1 - z0)}
                material={material}
              />
            );
          })}
        </group>
      ))}
    </>
  );
}

// Two blades parked on the cowl panel, laid on the rake of the bonnet line the
// hull is built from — so however the moulding dials are moved they stay on the
// paint at the base of the screen instead of lying as bars across the bonnet.
function Wipers({ mould, material }: { mould: Mould; material: THREE.Material }) {
  const top = useMemo(() => topLine(mould), [mould]);
  const z = mould.cowlX + 0.2;
  const tilt = Math.atan((top(z + 0.14) - top(z - 0.14)) / 0.28);
  const y = top(z) + 0.022;
  return (
    <>
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 0.29, y, z]} rotation={[tilt, s * 0.24, 0]}>
          <RoundedBox
            args={[0.38, 0.014, 0.022]}
            radius={0.006}
            bevelSegments={1}
            smoothness={1}
            material={material}
          />
          {/* Arm running back to the pivot, tucked under the blade */}
          <RoundedBox
            args={[0.24, 0.01, 0.018]}
            radius={0.004}
            bevelSegments={1}
            smoothness={1}
            position={[-s * 0.18, -0.007, -0.022]}
            material={material}
          />
        </group>
      ))}
    </>
  );
}

// ─── Cabin ───────────────────────────────────────────────────────────────────
//
// What the glass reveals. The car has a single central seat, and InteriorModel
// already draws the furniture — bucket, wheel, dash and cage. What was missing
// was the room around it: through transparent panes the old slab and two seat
// backs showed the inside of the bodywork. This closes the tub — floor pan and
// tunnel, firewall, dash top, door cards, rear bulkhead, parcel shelf, headliner
// and screen pillars — and the shell merges into one draw per material.
function Cabin({ car, mould, beltHalf }: { car: CarConfig; mould: Mould; beltHalf: number }) {
  const skin = useMemo(() => makeSkin(mould), [mould]);
  const trim = useTrimMaterial();
  const carpet = useDispose(
    useMemo(
      () => new THREE.MeshStandardMaterial({ color: "#242830", roughness: 0.96, metalness: 0.02 }),
      [],
    ),
  );
  const pale = useDispose(
    useMemo(
      () => new THREE.MeshStandardMaterial({ color: "#b6bcc4", roughness: 0.9, metalness: 0.02 }),
      [],
    ),
  );

  // Stations of the tub, all read off the mould so the shell fits whatever the
  // dials produced: floor, firewall, bulkhead, shelf and dash sit where the
  // seats and pedals they serve sit.
  const floorY = 0.205;
  const firewallZ = mould.cowlX + 0.42;
  const bulkheadZ = mould.roofX1 - 0.05;
  const shelfZ = mould.deckX + 0.12;
  const midZ = (firewallZ + bulkheadZ) / 2;
  /** Half-width of the room at a station, a hand's width inside the skin. */
  const room = (z: number, y: number) => Math.max(0.3, skin.xAt(z, y) - 0.035);
  const roomW = (z: number, y: number) => room(z, y) * 2;
  // A low canopy gets a shrunken cockpit: the seat has to tuck under the roof,
  // never through it.
  const seatScale = Math.min(1, Math.max(0.72, (mould.roofY - 0.07) / 1.08));
  const bulkheadY = Math.min(mould.roofY - 0.28, mould.beltY - floorY + 0.3);
  const shelfY = Math.min(mould.deckY - 0.08, floorY + 0.6);
  const doorY0 = floorY + 0.08;
  const doorY1 = mould.beltY - 0.05;
  const doorFrom = bulkheadZ + 0.12;
  const doorTo = firewallZ - 0.22;
  // Door cards follow the flank in three bays, exactly like the belt moulding.
  const doors = [-1, 1].flatMap((s) =>
    Array.from({ length: 3 }, (_, i) => {
      const z0 = doorFrom + ((doorTo - doorFrom) * i) / 3;
      const z1 = doorFrom + ((doorTo - doorFrom) * (i + 1)) / 3;
      const x0 = room(z0, doorY1);
      const x1 = room(z1, doorY1);
      return (
        <RoundedBox
          key={`door${s}${i}`}
          args={[0.05, doorY1 - doorY0, Math.hypot(z1 - z0, x1 - x0) + 0.04]}
          radius={0.02}
          bevelSegments={1}
          smoothness={2}
          position={[s * ((x0 + x1) / 2 - 0.02), (doorY0 + doorY1) / 2, (z0 + z1) / 2]}
          rotation-y={Math.atan2(s * (x1 - x0), z1 - z0)}
          material={trim}
        />
      );
    }),
  );
  // Screen pillars: bars laid on the windscreen's own rake, from the corners of
  // the dash top up to the headliner.
  const pillarY0 = mould.beltY + 0.03;
  const pillarY1 = mould.roofY - 0.1;
  const pillarZ0 = mould.cowlX - 0.02;
  const pillarZ1 = mould.roofX0 + 0.06;
  const pillarDz = pillarZ0 - pillarZ1;
  const pillarDy = pillarY1 - pillarY0;
  const pillars = [-1, 1].map((s) => (
    <RoundedBox
      key={`ap${s}`}
      args={[0.06, 0.04, Math.hypot(pillarDz, pillarDy) + 0.14]}
      radius={0.015}
      bevelSegments={1}
      smoothness={2}
      position={[
        s * (room((pillarZ0 + pillarZ1) / 2, (pillarY0 + pillarY1) / 2) - 0.03),
        (pillarY0 + pillarY1) / 2,
        (pillarZ0 + pillarZ1) / 2,
      ]}
      rotation-x={-Math.atan2(pillarDy, pillarDz)}
      material={pale}
    />
  ));
  return (
    <group>
      {/* Seat, wheel, dash and cage: the furniture the cockpit camera is built
          around, turned to the car's own axes and settled on the floor pan. */}
      <group position={[0, floorY - 0.115 * seatScale, -0.2]} scale={seatScale}>
        <InteriorModel car={car} aligned podDrop={0.14} />
      </group>
      <Merged>
        {/* Floor pan and the tunnel over the driveline */}
        <RoundedBox
          args={[roomW(midZ, floorY), 0.05, firewallZ - bulkheadZ]}
          radius={0.03}
          bevelSegments={1}
          smoothness={2}
          position={[0, floorY - 0.025, midZ]}
          material={carpet}
        />
        <RoundedBox
          args={[Math.min(0.34, roomW(midZ, floorY + 0.1)), 0.24, firewallZ - bulkheadZ - 0.08]}
          radius={0.05}
          bevelSegments={2}
          smoothness={2}
          position={[0, floorY + 0.1, midZ + 0.02]}
          material={trim}
        />
        {/* Firewall ahead of the pedals, bulkhead behind the seat */}
        <RoundedBox
          args={[roomW(firewallZ, floorY + 0.45), 0.72, 0.06]}
          radius={0.03}
          bevelSegments={1}
          smoothness={2}
          position={[0, floorY + 0.3, firewallZ]}
          rotation-x={0.16}
          material={trim}
        />
        <RoundedBox
          args={[roomW(bulkheadZ, mould.beltY), bulkheadY, 0.06]}
          radius={0.03}
          bevelSegments={1}
          smoothness={2}
          position={[0, floorY + bulkheadY / 2, bulkheadZ]}
          material={trim}
        />
        {/* Parcel shelf under the rear glass, with a pair of ribs */}
        <RoundedBox
          args={[roomW((bulkheadZ + shelfZ) / 2, shelfY), 0.05, bulkheadZ - shelfZ]}
          radius={0.025}
          bevelSegments={1}
          smoothness={2}
          position={[0, shelfY, (bulkheadZ + shelfZ) / 2]}
          material={carpet}
        />
        {[-0.42, 0.42].map((x) => (
          <RoundedBox
            key={`rib${x}`}
            args={[0.05, 0.06, bulkheadZ - shelfZ - 0.08]}
            radius={0.015}
            bevelSegments={1}
            smoothness={2}
            position={[x * (mould.width / 1.98), shelfY + 0.05, (bulkheadZ + shelfZ) / 2]}
            material={trim}
          />
        ))}
        {/* Dash top: meets the screen base and spans the full width, so no gap
            is left between the dash unit and the flanks */}
        <RoundedBox
          args={[roomW(mould.cowlX - 0.115, mould.beltY - 0.02), 0.055, 0.26]}
          radius={0.02}
          bevelSegments={1}
          smoothness={2}
          position={[0, mould.beltY - 0.055, mould.cowlX - 0.115]}
          rotation-x={-0.24}
          material={trim}
        />
        {doors}
        {/* Headliner, paler than the rest: every real roof lining is light */}
        <RoundedBox
          args={[
            Math.min(
              roomW((mould.roofX0 + mould.roofX1) / 2, mould.roofY - 0.05),
              beltHalf * 2 - 0.12,
            ),
            0.035,
            mould.roofX0 - mould.roofX1 - 0.12,
          ]}
          radius={0.015}
          bevelSegments={1}
          smoothness={2}
          position={[0, mould.roofY - 0.05, (mould.roofX0 + mould.roofX1) / 2]}
          material={pale}
        />
        {pillars}
      </Merged>
    </group>
  );
}

// Racing roundel: a single 128² canvas, drawn once per number.
function useNumberTexture(number: number) {
  const texture = useMemo(() => {
    if (typeof document === "undefined") return null;
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#f4f6f8";
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.47, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillStyle = "#12161c";
    ctx.font = `bold ${Math.round(size * 0.6)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(number), size / 2, size * 0.53);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }, [number]);
  useEffect(() => () => texture?.dispose(), [texture]);
  return texture;
}

// ─── Moulding ─────────────────────────────────────────────────────────────────
//
// There are no preset silhouettes: the whole body is computed from the moulding
// dials. Every anchor of the side profile — nose, bonnet, cowl, roof, deck,
// tail — is a base value for the class moved by its dial, and the wheel
// openings are always cut from the real axle positions, so however the user
// reshapes the body the tyres stay dead centre in their arches. That is what
// makes the result their own design instead of a copy of a known car.

type Mould = {
  width: number;
  flare: number;
  /** Fender bulge over each axle: the wide-body kit, keyed to the class. */
  bulge: number;
  noseX: number;
  noseY: number;
  hoodX: number;
  hoodY: number;
  cowlX: number;
  cowlY: number;
  beltY: number;
  roofX0: number;
  roofX1: number;
  roofY: number;
  deckX: number;
  deckY: number;
  tailX: number;
  tailY: number;
  tailBot: number;
};

function mould(car: CarConfig): Mould {
  const s = car.sculpt ?? NEUTRAL_SCULPT;
  const o = (v: number) => v - 0.5;
  // The class only sets the *starting point*: the dials move it from there.
  const base: Omit<Mould, "bulge"> =
    car.category === "deportivo"
      ? {
          width: 1.9, flare: 0.27,
          noseX: 2.24, noseY: 0.62, hoodX: 1.66, hoodY: 0.88,
          cowlX: 1.02, cowlY: 0.9, beltY: 0.92,
          roofX0: 0.08, roofX1: -0.78, roofY: 1.24,
          deckX: -1.52, deckY: 0.9, tailX: -2.2, tailY: 0.84, tailBot: 0.3,
        }
      : car.category === "superdeportivo"
        ? {
            width: 2.06, flare: 0.25,
            noseX: 2.34, noseY: 0.47, hoodX: 1.62, hoodY: 0.76,
            cowlX: 0.74, cowlY: 0.79, beltY: 0.84,
            roofX0: -0.12, roofX1: -0.9, roofY: 1.06,
            deckX: -1.44, deckY: 0.95, tailX: -2.26, tailY: 0.95, tailBot: 0.32,
          }
        : {
            // The racing class is a touring car, not a prototype: a tall cabin
            // with a real roof, an upright windscreen and glass you can see
            // through — the silhouette the pit lane would recognise. The
            // supercar above is the low one; this one sits on its wheels like a
            // saloon with a cage in it.
            width: 1.98, flare: 0.22,
            noseX: 2.26, noseY: 0.56, hoodX: 1.6, hoodY: 0.85,
            cowlX: 0.96, cowlY: 0.92, beltY: 0.93,
            roofX0: 0.5, roofX1: -0.74, roofY: 1.32,
            deckX: -1.48, deckY: 0.9, tailX: -2.22, tailY: 0.87, tailBot: 0.3,
          };

  // Overhangs stretch around the axles: nothing between them ever moves.
  const lenF = o(s.length) * 0.6;
  const lenR = o(s.length) * 0.56;
  const noseX = base.noseX + lenF;
  const hoodX = base.hoodX + lenF * 0.55;
  const cowlX = base.cowlX + lenF * 0.22 + o(s.rake) * 0.55;
  const deckX = Math.min(base.deckX + lenR * 0.3, AXLE_REAR - 0.04);
  const tailX = base.tailX + lenR;
  // The cabin slider slides the whole greenhouse fore and aft; the roof slider
  // raises or chops the roofline. Both are clamped so the anchors the loft
  // interpolates can never cross, however far the dials are pushed.
  const slide = o(s.cabin) * 0.75;
  const roofX0 = Math.min(base.roofX0 + o(s.rake) * 0.12 + slide, cowlX - 0.42);
  const roofX1 = Math.max(
    Math.min(base.roofX1 + lenR * 0.1 + slide, roofX0 - 0.5),
    deckX + 0.42,
  );

  // Height: the sheet metal above the sill scales as one piece, arches fixed.
  const h = 1 + o(s.height) * 0.34;
  const lift = (y: number) => SILL_Y + (y - SILL_Y) * h;
  const noseY = Math.min(Math.max(lift(base.noseY) + o(s.nose) * 0.4, 0.34), lift(base.hoodY) - 0.06);
  const hoodY = Math.max(lift(base.noseY) + 0.08, lift(base.hoodY) + o(s.nose) * 0.12 + o(s.hood) * 0.26);
  const cowlY = Math.max(hoodY - 0.06, Math.min(lift(base.cowlY) + o(s.hood) * 0.08, lift(base.beltY)));
  const beltY = lift(base.beltY) + (o(s.hood) + o(s.tail)) * 0.03;
  const roofY = Math.max(cowlY + 0.1, lift(base.roofY) + (car.roof - 0.5) * 0.28);
  const deckY = Math.max(beltY - 0.12, lift(base.deckY) + o(s.tail) * 0.16);
  const tailY = Math.min(Math.max(lift(base.tailY) + o(s.tail) * 0.34, SILL_Y + 0.1), deckY + 0.16);
  // Curvature: how round the shoulders roll over the flanks.
  const flare = base.flare + o(s.curves) * 0.34;

  return {
    width: base.width * widthFactor(car),
    flare,
    // The racing body gets a proper wide-body kit, the hyper a mild flare and
    // the street car almost none — the first thing that tells them apart.
    bulge: Math.max(
      0.006,
      (car.category === "carreras" ? 0.13 : car.category === "superdeportivo" ? 0.075 : 0.025) +
        o(s.curves) * 0.05,
    ),
    noseX, noseY, hoodX, hoodY, cowlX, cowlY, beltY, roofX0, roofX1, roofY,
    deckX, deckY, tailX, tailY,
    tailBot: base.tailBot + o(s.tail) * 0.1,
  };
}

/** Point on the quad that rises from the splitter to the tip of the nose. */
function noseFace(m: Mould, t: number): Point2 {
  const u = 1 - t;
  return [
    u * u * (m.noseX - 0.12) + 2 * u * t * (m.noseX + 0.04) + t * t * m.noseX,
    u * u * SILL_Y + 2 * u * t * 0.34 + t * t * m.noseY,
  ];
}

/** Point on the quad that drops from the tail into the diffuser. */
function tailFace(m: Mould, t: number): Point2 {
  const u = 1 - t;
  return [
    u * u * m.tailX + 2 * u * t * (m.tailX - 0.02) + t * t * (m.tailX + 0.16),
    u * u * m.tailY + 2 * u * t * (m.tailBot + 0.14) + t * t * m.tailBot,
  ];
}

/** Upper silhouette of the body: tail → deck → roof → bonnet → nose. */
function topLine(m: Mould) {
  return crSpline([
    [m.tailX, m.tailY],
    [m.deckX, m.deckY],
    [m.roofX1, m.roofY],
    [m.roofX0, m.roofY],
    [m.cowlX, m.cowlY],
    [m.hoodX, m.hoodY],
    [m.noseX, m.noseY],
  ]);
}

// ─── The hull ────────────────────────────────────────────────────────────────
//
// A section is twelve points: floor centre, floor edge, sill/arch edge, flank,
// shoulder, top edge, crown — and the same six mirrored. Strips are stitched
// between consecutive sections; each strip keeps its own copies of the ring
// points so the creases stay crisp, while the strip itself stays smooth along
// the length of the car.

const FLOOR_BASE = 0.155;

// ─── One skin, measured once ────────────────────────────────────────────────
//
// The hull and everything bolted to its flanks are computed from the same
// section curve, so a shut line, a handle or an intake can be laid at the exact
// half-width of the sheet metal at its own height. Nothing can float off the
// body however the moulding dials are moved.

type Skin = {
  /** The twelve-point section at z. */
  ring: (z: number) => [number, number][];
  /** Half-width of the skin at (z, y) — read straight off the section. */
  xAt: (z: number, y: number) => number;
};

function makeSkin(m: Mould): Skin {
  const half = m.width / 2;
  const dome = 0.012 + m.flare * 0.1; // crown arch across the top
  const tumble = 0.075 + m.flare * 0.1; // greenhouse tuck above the belt
  const tuck = 0.03 + m.flare * 0.1; // rocker tuck under the flank
  const inset = 0.1 + m.flare * 0.3; // corner rounding at the two ends
  const depth = inset * 2.2;

  const top = topLine(m);
  const plan = crSpline([
    [m.tailX, 0.8],
    [m.deckX, 0.9],
    [AXLE_REAR, 0.985],
    [m.roofX1, 1],
    [m.cowlX, 0.98],
    [AXLE_FRONT, 0.96],
    [m.hoodX, 0.9],
    [m.noseX, 0.84],
  ]);
  const topFrac = crSpline([
    [m.tailX, 0.6],
    [m.deckX, 0.82],
    [m.roofX1, 0.68],
    [m.roofX0, 0.68],
    [m.cowlX, 0.8],
    [m.hoodX, 0.76],
    [m.noseX, 0.64],
  ]);
  const floorLine = crSpline([
    [m.tailX, m.tailBot],
    [m.deckX, 0.165],
    [0, FLOOR_BASE],
    [m.cowlX, 0.165],
    [m.hoodX, 0.185],
    [m.noseX, 0.26],
  ]);

  const z0 = m.tailX;
  const z1 = m.noseX;

  // Fender bulge: the sheet metal swells over each axle and blends back to the
  // door skin between them. Because it is part of the loft it can never come
  // away from the body, whatever the moulding dials are set to.
  const fender = (z: number) => {
    const t = Math.min(
      1,
      Math.max(0, 1 - Math.min(Math.abs(z - AXLE_FRONT), Math.abs(z - AXLE_REAR)) / 0.72),
    );
    return m.bulge * t * t * (3 - 2 * t);
  };

  const ringAt = (z: number): [number, number][] => {
    // Corner rounding: as a section approaches either tip its plan pulls in,
    // which is what turns the ends of the loft into a rounded bumper instead
    // of a flat wall.
    const dTip = Math.min(z - z0, z1 - z);
    const q = Math.max(0, 1 - dTip / depth);
    const squish = Math.sqrt(Math.max(0, 1 - q * q));
    const corner = inset * (1 - squish);
    const yScale = 0.8 + 0.2 * squish;

    const planW = Math.max(0.34, half * plan(z) - corner + fender(z));
    const topY = top(z);
    const flo = Math.min(floorLine(z), archEdgeY(z) - 0.04);
    const wob = Math.max(
      0,
      1 - Math.min(Math.abs(z - AXLE_FRONT), Math.abs(z - AXLE_REAR)) / 0.62,
    );
    const sillY = archEdgeY(z);
    const belt = Math.min(topY - 0.03, m.beltY);
    const sillW = planW - tuck;
    const floorW = Math.min(planW * 0.8 - wob * 0.2, sillW - 0.1);
    const flankY = Math.max(sillY + 0.05, (sillY + belt) * 0.5);
    // Cabin-ness: 1 alongside the greenhouse, fading to 0 towards nose and tail.
    const cabin = (1 - smoothstep(0, 0.5, z - m.cowlX)) * (1 - smoothstep(0, 0.45, m.roofX1 - z));
    const topW = Math.min(planW * topFrac(z), planW - tumble - 0.02);
    const beltW = Math.max(topW + 0.04, planW - tumble);
    const shW = cabin * beltW + (1 - cabin) * (topW + (planW - topW) * 0.4);
    const shY = Math.min(
      Math.max(cabin * belt + (1 - cabin) * (topY + (flankY - topY) * 0.55), flankY + 0.04),
      topY - 0.03,
    );
    const mid = (flo + topY) / 2;
    const wy = (y: number) => mid + (y - mid) * yScale;
    return [
      [0, wy(flo)],
      [floorW, wy(flo)],
      [sillW, wy(sillY)],
      [planW, wy(flankY)],
      [shW, wy(shY)],
      [topW, wy(topY)],
      [0, wy(topY + dome)],
      [-topW, wy(topY)],
      [-shW, wy(shY)],
      [-planW, wy(flankY)],
      [-sillW, wy(sillY)],
      [-floorW, wy(flo)],
    ];
  };

  // Half-width of the skin at any height, read straight off the section, so
  // anything laid along the flank lands exactly on the surface.
  const xAt = (z: number, y: number) => {
    const r = ringAt(z);
    for (let k = 1; k < 6; k++) {
      const p = r[k]!;
      const q = r[k + 1]!;
      const lo = Math.min(p[1], q[1]);
      const hi = Math.max(p[1], q[1]);
      if (y >= lo && y <= hi && q[1] !== p[1]) {
        return p[0] + (q[0] - p[0]) * ((y - p[1]) / (q[1] - p[1]));
      }
    }
    return r[3]![0];
  };

  return { ring: ringAt, xAt };
}

/**
 * A hull's paint, glass and trim, resolved per vertex: the shell can carry a
 * livery instead of a flat colour, and a rival's glass stays neutral dark
 * whatever its paint is.
 */
type HullTint = (strip: number, z: number, role: number) => [number, number, number];

function loftHull(m: Mould, tint?: HullTint): THREE.BufferGeometry {
  const N = 62;
  const skin = makeSkin(m);
  const ringAt = skin.ring;
  const xAt = skin.xAt;
  const z0 = m.tailX;
  const z1 = m.noseX;

  // Every triangle of the skin is tagged as it is stitched: 0 paint, 1 glazing,
  // 2 satin trim. The glazing sits on the upper strips and is placed by station
  // — windscreen ahead of the roof, backlight behind it, door glass between —
  // and the posts that carry it are blacked out: the A-post ahead of the door
  // glass, the C-post behind it, the B-post between the two windows, and the
  // cowl the wipers park in. That frame is what makes the greenhouse read as
  // glazing set into a body, on all three classes, instead of one dark sheet
  // spread over the roof.
  const faceRole = (strip: number, zc: number): number => {
    if (strip === 0 || strip === 1 || strip === 10 || strip === 11) return 2;
    if (strip === 4 || strip === 7) {
      const glassFrom = m.roofX1 + 0.04;
      const glassTo = m.cowlX + 0.02;
      if (zc > glassFrom && zc < glassTo) {
        const bPost = (m.cowlX + m.roofX1) / 2;
        if (zc > bPost - 0.07 && zc < bPost + 0.07) return 2;
        return 1;
      }
      if (zc >= glassTo && zc <= glassTo + 0.16) return 2;
      if (zc <= glassFrom && zc >= glassFrom - 0.18) return 2;
      return 0;
    }
    if (strip === 5 || strip === 6) {
      const windscreen = zc >= m.roofX0 - 0.02 && zc <= m.cowlX + 0.12;
      const backlight = zc >= m.deckX - 0.02 && zc <= m.roofX1 + 0.05;
      if (windscreen || backlight) return 1;
      if (zc > m.cowlX + 0.12 && zc <= m.cowlX + 0.3) return 2;
    }
    return 0;
  };

  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] | null = tint ? [] : null;
  const shade = (strip: number, z: number, role: number, times = 1) => {
    if (!colors || !tint) return;
    const [r, g, b] = tint(strip, z, role);
    for (let n = 0; n < times; n++) colors.push(r, g, b);
  };
  const paintIdx: number[] = [];
  const glassIdx: number[] = [];
  const trimIdx: number[] = [];
  for (let strip = 0; strip < 12; strip++) {
    const jb = (strip + 1) % 12;
    const base = positions.length / 3;
    for (let i = 0; i <= N; i++) {
      const z = z0 + ((z1 - z0) * i) / N;
      const ring = ringAt(z);
      const a = ring[strip]!;
      const b = ring[jb]!;
      positions.push(a[0], a[1], z, b[0], b[1], z);
      // Unwrapped along the length of the car and across the ring, so the paint
      // can carry its flake and any panel detail a texture brings with it.
      uvs.push(i / N, strip / 12, i / N, (strip + 1) / 12);
      shade(strip, z, faceRole(strip, z), 2);
    }
    for (let i = 0; i < N; i++) {
      const A = base + i * 2;
      const B = A + 1;
      const C = A + 3;
      const D = A + 2;
      const zc = z0 + ((z1 - z0) * (i + 0.5)) / N;
      const role = faceRole(strip, zc);
      const target = role === 2 ? trimIdx : role === 1 ? glassIdx : paintIdx;
      target.push(A, B, C, A, C, D);
    }
  }

  // The fender lip: a flange swept along the real arch curve, its inner edge
  // pinned to the skin by xAt, so it hugs the bodywork instead of ringing it
  // like a hoop that fell off. Body-coloured, so it reads as stamped metal.
  for (const axle of [AXLE_FRONT, AXLE_REAR]) {
    for (const sd of [-1, 1]) {
      const SEG = 20;
      const base = positions.length / 3;
      for (let i = 0; i <= SEG; i++) {
        const t = (Math.PI * i) / SEG;
        const z = axle - Math.cos(t) * (ARCH_CUT - 0.01);
        const y = SILL_Y + Math.sin(t) * (ARCH_CUT - 0.01);
        const x0 = xAt(z, y);
        positions.push(sd * x0, y, z, sd * (x0 + 0.055), y - 0.012, z);
        uvs.push(t, 0.5, t, 0.5);
        shade(-1, z, 0, 2);
      }
      for (let i = 0; i < SEG; i++) {
        const A = base + i * 2;
        const B = A + 1;
        const C = A + 3;
        const D = A + 2;
        if (sd > 0) paintIdx.push(A, B, C, A, C, D);
        else paintIdx.push(A, C, B, A, D, C);
      }
    }
  }

  // Close the two ends with a fan each, so the shell is watertight.
  const cap = (i: number, forward: boolean) => {
    const z = z0 + ((z1 - z0) * i) / N;
    const ring = ringAt(z);
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of ring) {
      lo = Math.min(lo, p[1]);
      hi = Math.max(hi, p[1]);
    }
    const center = positions.length / 3;
    positions.push(0, (lo + hi) / 2, z + (forward ? 0.006 : -0.006));
    uvs.push(0.5, 0.5);
    shade(-1, z, 0);
    for (let k = 0; k < 12; k++) {
      const idx = positions.length / 3;
      const p = ring[k]!;
      const q = ring[(k + 1) % 12]!;
      positions.push(p[0], p[1], z, q[0], q[1], z);
      uvs.push(0.5, 0.5, 0.5, 0.5);
      shade(-1, z, 0, 2);
      if (forward) paintIdx.push(center, idx, idx + 1);
      else paintIdx.push(center, idx + 1, idx);
    }
  };
  cap(N, true);
  cap(0, false);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex([...paintIdx, ...glassIdx, ...trimIdx]);
  geometry.addGroup(0, paintIdx.length, 0);
  if (glassIdx.length) geometry.addGroup(paintIdx.length, glassIdx.length, 1);
  if (trimIdx.length)
    geometry.addGroup(paintIdx.length + glassIdx.length, trimIdx.length, 2);
  if (colors) geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

// Smoked polycarbonate: clear enough to show the bowls behind it.
function useLensMaterial() {
  return useDispose(
    useMemo(
      () =>
        new THREE.MeshPhysicalMaterial({
          color: "#dfe8f4",
          metalness: 0.05,
          roughness: 0.06,
          transparent: true,
          opacity: 0.38,
          clearcoat: 1,
          clearcoatRoughness: 0.04,
        }),
      [],
    ),
  );
}

// A real light unit: recessed housing, chrome bowls, projectors behind a smoked
// cover and a bright strip. It is bolted onto the sheet metal at the same angle
// as the nose, so it reads as a lamp instead of a decal.
function Headlamp({
  width,
  height,
  housing,
  bezel,
  lamp,
  cover,
}: {
  width: number;
  height: number;
  housing: THREE.Material;
  bezel: THREE.Material;
  lamp: THREE.Material;
  cover: THREE.Material;
}) {
  return (
    <group>
      {/* Deep housing buried in the nose: only a slim face shows, so the unit
          can never float off the panel however far the dials warp it. */}
      <RoundedBox
        args={[width, height * 1.5, 0.34]}
        radius={0.03}
        bevelSegments={2}
        smoothness={2}
        position={[0, 0, -0.16]}
        material={housing}
      />
      <RoundedBox
        args={[width + 0.016, height * 1.25, 0.05]}
        radius={0.02}
        bevelSegments={2}
        smoothness={2}
        position={[0, 0, -0.012]}
        material={bezel}
      />
      <RoundedBox
        args={[width * 0.96, height, 0.06]}
        radius={0.02}
        bevelSegments={2}
        smoothness={2}
        position={[0, 0, 0.012]}
        material={cover}
      />
      <RoundedBox
        args={[width * 0.82, height * 0.24, 0.035]}
        radius={0.01}
        bevelSegments={1}
        smoothness={1}
        position={[0, -height * 0.24, 0.028]}
        material={lamp}
      />
      {[-width * 0.24, width * 0.24].map((x) => (
        <mesh key={x} rotation-x={Math.PI / 2} position={[x, height * 0.1, 0.026]} material={lamp}>
          <cylinderGeometry args={[height * 0.24, height * 0.24, 0.03, 14]} />
        </mesh>
      ))}
    </group>
  );
}

function MouldedBody({ car }: { car: CarConfig }) {
  const paint = useCarPaint(car);
  const accent = useCarAccent(car);
  const glass = useCanopyMaterial();
  const trim = useTrimMaterial();
  const chrome = useChromeMaterial();
  const lens = useLensMaterial();
  const carbon = useCarbonMaterial();
  const intake = useGrilleMaterial();
  const head = useLampMaterial("#e8f1ff", 0.95, "headlamp");
  const tail = useLampMaterial("#c21327", 1.2, "taillamp");
  const roundel = useNumberTexture(1 + ((Math.round(car.displacement * 10) + car.gears) % 88));
  const roundelMat = useDispose(
    useMemo(
      () =>
        new THREE.MeshStandardMaterial({
          map: roundel,
          transparent: true,
          roughness: 0.45,
          metalness: 0,
        }),
      [roundel],
    ),
  );
  const m = useMemo(() => mould(car), [car]);
  const skin = useMemo(() => makeSkin(m), [m]);
  const key = useMemo(
    () =>
      [
        m.width, m.flare, m.bulge, m.noseX, m.noseY, m.hoodX, m.hoodY, m.cowlX, m.cowlY,
        m.beltY, m.roofX0, m.roofX1, m.roofY, m.deckX, m.deckY, m.tailX, m.tailY, m.tailBot,
      ]
        .map((v) => v.toFixed(3))
        .join("|"),
    [m],
  );
  const hull = useHull(`hull-${key}`, () => loftHull(m));
  const top = useMemo(() => topLine(m), [m]);
  const wing = wingScale(car);
  const race = car.category === "carreras";
  const supercar = car.category === "superdeportivo";
  const flank = m.width / 2;
  // The half-widths the loft itself uses, so trim sits exactly on the surface.
  const beltHalf = Math.max(0.5, flank - (0.055 + m.flare * 0.1));
  const roofHalf = beltHalf - 0.13;

  // Anchors reused by many details, computed once from the same mould.
  const lampX = m.width * 0.29;
  const lampWidth = m.width * 0.3;
  const grille = noseFace(m, 0.52);
  const bar = tailFace(m, 0.26);
  const seg = tailFace(m, 0.56);
  const diffY = m.tailBot + (m.tailY - m.tailBot) * 0.3;
  const wingY = race ? m.deckY + 0.42 + (wing - 1) * 0.2 : 0;
  const wingZ = m.tailX + 0.34;
  const wingW = m.width * (race ? 0.82 : supercar ? 0.7 : 0.62) * (0.94 + (wing - 1) * 0.18);

  return (
    <group>
      {/* One continuous hull: body, canopy and floor in a single skin. */}
      <mesh geometry={hull} material={[paint, glass, trim]} />
      <ArchBands car={car} />

      {/* Cabin furniture behind the glass */}
      <Cabin car={car} mould={m} beltHalf={beltHalf} />
      {/* The bright line under the side glass, and the blades parked on the
          windscreen: the two details that read at any distance. */}
      <WindowBelt mould={m} material={chrome} />
      <Wipers mould={m} material={trim} />

      {/* Roof scoop and roll cage are the racing shell's signature */}
      {race && (
        <RoundedBox
          args={[Math.max(0.34, roofHalf * 1.1), 0.1, 0.6]}
          radius={0.045}
          bevelSegments={2}
          smoothness={2}
          position={[0, m.roofY + 0.02, (m.roofX0 + m.roofX1) / 2]}
          material={paint}
        />
      )}
      {/* The hyper class wears engine-cover louvres and a roof snorkel, so it
          never reads as a tarted-up street coupé. */}
      {supercar &&
        [-0.52, -0.38, -0.24, -0.1].map((dz) => (
          <RoundedBox
            key={`louvre${dz}`}
            args={[m.width * 0.42, 0.024, 0.09]}
            radius={0.008}
            bevelSegments={1}
            smoothness={1}
            position={[0, top(m.deckX + dz) - 0.004, m.deckX + dz]}
            material={carbon}
          />
        ))}
      {supercar && (
        <RoundedBox
          args={[0.3, 0.07, 0.42]}
          radius={0.03}
          bevelSegments={2}
          smoothness={2}
          position={[0, m.roofY - 0.01, (m.roofX0 + m.roofX1) / 2]}
          material={paint}
        />
      )}
      {race && car.rollCage && (
        <>
          {[m.cowlX - 0.28, m.roofX1 + 0.02].map((z) => (
            <mesh key={z} position={[0, m.beltY - 0.02, z]} scale={[1.7, 1, 1]} material={chrome}>
              <torusGeometry args={[Math.max(0.22, m.roofY - m.beltY), 0.026, 8, 22, Math.PI]} />
            </mesh>
          ))}
          <mesh
            position={[0, m.beltY + (m.roofY - m.beltY) * 0.62, m.roofX1 + 0.02]}
            rotation-z={0.32}
            material={chrome}
          >
            <boxGeometry args={[Math.max(0.5, (m.roofY - m.beltY) * 3.4), 0.03, 0.03]} />
          </mesh>
        </>
      )}

      {/* Flanks are left clean: the hull carries the shape, and the arch lips,
          intakes and lamps are the only things bolted to it. */}

      {/* Nose: grille with chrome slats over an open mesh, badge and splitter */}
      <group position={[0, grille[1], grille[0] - 0.08]}>
        <RoundedBox
          args={[m.width * 0.5, 0.26, 0.22]}
          radius={0.05}
          bevelSegments={2}
          smoothness={2}
          material={intake}
        />
        {[-0.07, 0.01, 0.09].map((dy) => (
          <RoundedBox
            key={dy}
            args={[m.width * 0.46, 0.02, 0.23]}
            radius={0.008}
            bevelSegments={1}
            smoothness={1}
            position={[0, dy, 0]}
            material={chrome}
          />
        ))}
      </group>
      <RoundedBox
        args={[0.16, 0.07, 0.05]}
        radius={0.02}
        bevelSegments={1}
        smoothness={2}
        position={[0, grille[1] + 0.17, grille[0] - 0.01]}
        material={accent}
      />
      {race && (
        <>
          {/* Splitter: its upper half is buried in the lower sheet metal, so
              it reads as the lip of the bumper rather than a plate below it. */}
          <RoundedBox
            args={[m.width * 0.94, 0.06, 0.36]}
            radius={0.018}
            bevelSegments={1}
            smoothness={2}
            position={[0, 0.285, m.noseX - 0.15]}
            rotation-x={0.05}
            material={carbon}
          />
          {[-1, 1].map((s) => (
            <RoundedBox
              key={`canard${s}`}
              args={[0.22, 0.02, 0.13]}
              radius={0.008}
              bevelSegments={1}
              smoothness={1}
              position={[s * (skin.xAt(m.noseX - 0.32, 0.36) - 0.08), 0.36, m.noseX - 0.32]}
              rotation-x={-0.18}
              material={carbon}
            />
          ))}
        </>
      )}
      {!race && (
        <RoundedBox
          args={[m.width * 0.9, 0.06, 0.34]}
          radius={0.018}
          bevelSegments={1}
          smoothness={2}
          position={[0, 0.29, m.noseX - 0.14]}
          material={carbon}
        />
      )}

      {/* Headlamps: seated on the leading edge of the nose and swept around
          the corner, sunk into the sheet metal like the real units — nothing
          sticks up like a fin whatever the moulding dials do. */}
      {[-1, 1].map((s) => (
        <group
          key={`hl${s}`}
          position={[s * lampX, m.noseY + 0.02, m.noseX - 0.09]}
          rotation={[-0.24, s * 0.42, s * -0.14]}
        >
          <Headlamp
            width={lampWidth}
            height={0.09}
            housing={trim}
            bezel={chrome}
            lamp={head}
            cover={lens}
          />
        </group>
      ))}

      {/* Intakes beside the grille */}
      {[-1, 1].map((s) => (
        <RoundedBox
          key={`duct${s}`}
          args={[m.width * 0.17, 0.16, 0.16]}
          radius={0.05}
          bevelSegments={2}
          smoothness={2}
          position={[s * (flank - 0.19), 0.38, grille[0] - 0.06]}
          material={intake}
        />
      ))}

      {/* Fender gills on the GT, a big side intake on the low cars: sunk into
          the flank so their outer face is a slit, not a stuck-on box */}
      {!race && !supercar &&
        [-1, 1].map((s) => (
          <RoundedBox
            key={`gill${s}`}
            args={[0.04, 0.12, 0.46]}
            radius={0.016}
            bevelSegments={1}
            smoothness={2}
            position={[s * (skin.xAt(0.52, 0.64) - 0.026), 0.64, 0.52]}
            material={carbon}
          />
        ))}
      {(race || supercar) &&
        [-1, 1].map((s) => (
          <RoundedBox
            key={`vent${s}`}
            args={[0.04, 0.15, 0.44]}
            radius={0.016}
            bevelSegments={1}
            smoothness={2}
            position={[s * (skin.xAt(-0.42, 0.58) - 0.026), 0.58, -0.42]}
            material={carbon}
          />
        ))}
      {/* Race shells ride on full-length side skirts. */}
      {race &&
        [-1, 1].map((s) => (
          <RoundedBox
            key={`skirt${s}`}
            args={[0.05, 0.045, 1.7]}
            radius={0.014}
            bevelSegments={1}
            smoothness={1}
            position={[s * (skin.xAt(0.1, 0.3) - 0.02), 0.3, 0.1]}
            material={carbon}
          />
        ))}

      {/* Panel gaps: the shut lines that tell the eye this is pressed steel and
          not one blob of filler, plus the handles and the fuel flap. */}
      {[-1, 1].map((s) => (
        <group key={`shut${s}`}>
          {[0.66, -0.48].map((z) => {
            const h = Math.max(0.22, m.beltY - 0.44);
            const yc = 0.44 + h / 2;
            return (
              <RoundedBox
                key={z}
                args={[0.016, h, 0.02]}
                radius={0.004}
                bevelSegments={1}
                smoothness={1}
                position={[s * (skin.xAt(z, yc) - 0.008), yc, z]}
                material={trim}
              />
            );
          })}
          <RoundedBox
            args={[0.03, 0.035, 0.16]}
            radius={0.008}
            bevelSegments={1}
            smoothness={1}
            position={[s * (skin.xAt(0.34, m.beltY - 0.13) - 0.014), m.beltY - 0.13, 0.34]}
            material={chrome}
          />
          <mesh
            position={[s * (skin.xAt(-0.62, 0.66) - 0.004), 0.66, -0.62]}
            rotation-z={Math.PI / 2}
            material={chrome}
          >
            <cylinderGeometry args={[0.055, 0.055, 0.022, 20]} />
          </mesh>
        </group>
      ))}
      {/* Tow ring on the race shell's nose */}
      {race &&
        [-1, 1].map((s) => (
          <mesh
            key={`tow${s}`}
            position={[s * (flank - 0.26), 0.3, m.noseX + 0.05]}
            rotation-y={Math.PI / 2}
            material={accent}
          >
            <torusGeometry args={[0.05, 0.014, 8, 18]} />
          </mesh>
        ))}

      {/* Tail: one dark valance sunk into the deck with a single LED blade
          straight across it — the light is part of the body, not a ring of
          floating red boxes. The race shell adds two fin posts on top. */}
      <RoundedBox
        args={[m.width * 0.86, 0.3, 0.16]}
        radius={0.05}
        bevelSegments={2}
        smoothness={2}
        position={[0, bar[1] + 0.02, bar[0] - 0.06]}
        material={trim}
      />
      <RoundedBox
        args={[m.width * 0.72, 0.055, 0.06]}
        radius={0.02}
        bevelSegments={2}
        smoothness={2}
        position={[0, bar[1] + 0.06, bar[0] - 0.005]}
        material={tail}
      />
      <RoundedBox
        args={[m.width * 0.5, 0.014, 0.05]}
        radius={0.005}
        bevelSegments={1}
        smoothness={1}
        position={[0, bar[1] - 0.02, bar[0] - 0.01]}
        material={chrome}
      />
      {race &&
        [-1, 1].map((s) => (
          <RoundedBox
            key={`tailfin${s}`}
            args={[0.05, 0.26, 0.05]}
            radius={0.012}
            bevelSegments={1}
            smoothness={2}
            position={[s * m.width * 0.36, seg[1], seg[0] - 0.02]}
            material={carbon}
          />
        ))}

      {/* Diffuser with fins: tucked under the tail and raked up, never a slab
          left hanging behind the bumper. */}
      <RoundedBox
        args={[m.width * (race ? 0.74 : 0.66), race ? 0.18 : 0.15, 0.3]}
        radius={0.04}
        bevelSegments={2}
        smoothness={2}
        position={[0, diffY - 0.01, m.tailX + 0.06]}
        rotation-x={-0.1}
        material={carbon}
      />
      {(race ? [-0.44, -0.22, 0, 0.22, 0.44] : [-0.3, 0, 0.3]).map((x) => (
        <RoundedBox
          key={`fin${x}`}
          args={[0.05, race ? 0.18 : 0.12, 0.3]}
          radius={0.018}
          bevelSegments={1}
          smoothness={2}
          position={[x * (m.width / 1.98), diffY - 0.02, m.tailX + 0.07]}
          rotation-x={-0.1}
          material={carbon}
        />
      ))}

      <Exhausts
        xs={race ? [-0.34, 0.34] : supercar ? [-0.2, 0.2] : [-0.52, 0.52]}
        y={supercar ? 0.42 : 0.36}
        z={m.tailX + 0.1}
        chrome={chrome}
      />

      {/* Wing: swan-neck posts that bite into the deck on the race car, and a
          deck lip that grows out of the bodywork on the others. Never a plank
          hanging in the air. */}
      {car.spoiler &&
        (race ? (
          <group position={[0, wingY, wingZ]}>
            {[-0.44, 0.44].map((x) => (
              <RoundedBox
                key={x}
                args={[0.06, 0.4, 0.14]}
                radius={0.018}
                bevelSegments={1}
                smoothness={2}
                position={[x, -0.185, -0.05]}
                material={carbon}
              />
            ))}
            <RoundedBox
              args={[wingW, 0.055, 0.5]}
              radius={0.018}
              bevelSegments={1}
              smoothness={2}
              rotation-x={0.14}
              material={carbon}
            />
            {/* Gurney flap: a vertical fence on the trailing edge, the cheapest
                downforce in racing and unmistakable from behind. */}
            <RoundedBox
              args={[wingW * 0.98, 0.06, 0.012]}
              radius={0.005}
              bevelSegments={1}
              smoothness={1}
              position={[0, 0.09, -0.248]}
              material={carbon}
            />
            {/* Second element, hung off the same posts over the trailing edge */}
            <RoundedBox
              args={[wingW * 0.99, 0.04, 0.2]}
              radius={0.013}
              bevelSegments={1}
              smoothness={2}
              position={[0, 0.095, -0.15]}
              rotation-x={0.52}
              material={carbon}
            />
            {[-1, 1].map((s) => (
              <RoundedBox
                key={s}
                args={[0.055, 0.4, 0.62]}
                radius={0.016}
                bevelSegments={1}
                smoothness={2}
                position={[s * (wingW / 2 + 0.02), 0.06, 0.02]}
                material={carbon}
              />
            ))}
          </group>
        ) : supercar ? (
          <group position={[0, top(m.tailX + 0.24) - 0.01, m.tailX + 0.24]}>
            <RoundedBox
              args={[wingW, 0.05, 0.4]}
              radius={0.02}
              bevelSegments={1}
              smoothness={2}
              rotation-x={0.34 + (wing - 1) * 0.38}
              material={paint}
            />
          </group>
        ) : (
          /* GT4: a modest plane on short posts with endplates, the shape a club
             racing shell wears when the rules keep the aero mild. */
          <group position={[0, m.deckY + 0.19, m.tailX + 0.32]}>
            {[-0.55, 0.55].map((x) => (
              <RoundedBox
                key={x}
                args={[0.05, 0.18, 0.12]}
                radius={0.014}
                bevelSegments={1}
                smoothness={2}
                position={[x * wingW * 0.5, -0.1, -0.02]}
                material={carbon}
              />
            ))}
            <RoundedBox
              args={[wingW, 0.045, 0.3]}
              radius={0.014}
              bevelSegments={1}
              smoothness={2}
              rotation-x={0.18}
              material={carbon}
            />
            {[-1, 1].map((s) => (
              <RoundedBox
                key={s}
                args={[0.04, 0.17, 0.32]}
                radius={0.012}
                bevelSegments={1}
                smoothness={2}
                position={[s * (wingW / 2 + 0.01), 0.01, 0]}
                material={carbon}
              />
            ))}
          </group>
        ))}

      {/* Racing roundel on the doors */}
      {race &&
        [-1, 1].map((s) => (
          <mesh
            key={`roundel${s}`}
            position={[s * (skin.xAt(0.24, 0.62) + 0.006), 0.62, 0.24]}
            rotation-y={s * (Math.PI / 2)}
            material={roundelMat}
          >
            <circleGeometry args={[0.22, 28]} />
          </mesh>
        ))}

      {car.stripes &&
        [-0.22, 0.22].flatMap((x) =>
          (
            [
              [m.noseX - 0.26, m.hoodX + 0.04],
              [m.hoodX - 0.04, m.cowlX - 0.05],
            ] as const
          ).map(([za, zb]) => (
            <SlopePanel
              key={`stripe${x}-${za.toFixed(3)}`}
              from={[za, top(za)]}
              to={[zb, top(zb)]}
              inward={[1.5, 0.2]}
              x={x}
              width={0.16}
              thickness={0.06}
              lift={0.008}
              material={accent}
            />
          )),
        )}

      <Mirrors car={car} x={flank - 0.05} y={m.beltY + 0.07} z={m.cowlX - 0.2} />
    </group>
  );
}

// The moulded car: no preset architecture, just the dials.
function ProceduralCarBody({ car }: { car: CarConfig }) {
  return <MouldedBody car={car} />;
}

/** Wing height behind the deck: it also stands in for the wing's size. */
function wingScale(car: CarConfig) {
  const s = (car.sculpt ?? NEUTRAL_SCULPT).wing;
  return 0.5 + s * 1.2;
}

// ─── GLB Model (imported) ─────────────────────────────────────────────────────

/**
 * The touring shell arrives with a twin-kidney nose. A single wide grille
 * covers that opening without touching the model: the body stays intact, the
 * old frame is simply hidden behind a neutral panel and three horizontal bars.
 */
function GenericNoseGrille() {
  return (
    <group name="GenericNoseGrille" position={[0, 0.47, 2.122]}>
      <RoundedBox args={[0.68, 0.16, 0.022]} radius={0.012} bevelSegments={2} smoothness={2}>
        <meshStandardMaterial color="#14181c" metalness={0.72} roughness={0.28} envMapIntensity={1.45} />
      </RoundedBox>
      {[-0.048, -0.024, 0, 0.024, 0.048].map((y) => (
        <mesh key={y} position={[0, y, 0.014]} castShadow>
          <boxGeometry args={[0.6, 0.0045, 0.006]} />
          <meshStandardMaterial color="#7a8590" metalness={0.9} roughness={0.2} envMapIntensity={1.6} />
        </mesh>
      ))}
    </group>
  );
}

function Model({
  source,
  car,
  speedRef,
  steerRef,
}: {
  source: THREE.Group;
  car: CarConfig;
  speedRef?: RefObject<number> | undefined;
  steerRef?: RefObject<number> | undefined;
}) {
  const invalidate = useThree((state) => state.invalidate);
  const object = useMemo(() => normalizeVehicle(source), [source]);
  // The GLB keeps the wheels, rotors and calipers as separate nodes whose
  // origin is the hub: that is enough to roll and steer them without touching
  // the geometry. Front uprights turn around the car's vertical axis.
  const rig = useMemo(() => {
    const spin: THREE.Object3D[] = [];
    const steer: THREE.Object3D[] = [];
    object.traverse((node) => {
      if (/^(Wheel|Roter)-/i.test(node.name)) spin.push(node);
      if (/^(Wheel|Roter|Caliper)-Frount/i.test(node.name)) steer.push(node);
    });
    return { spin, steer, up: new THREE.Vector3(0, 1, 0) };
  }, [object]);
  const appliedSteer = useRef(0);
  useEffect(() => () => disposeVehicle(object), [object]);
  useEffect(() => {
    const pattern = paintPatternIndex(car.bodyId);
    object.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      for (const mat of Array.isArray(node.material) ? node.material : [node.material]) {
        if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
        if (mat.userData["paint"]) {
          mat.color.set(car.color);
          const livery = mat.userData["paintShader"] as
            | { uAccent: { value: THREE.Color }; uPattern: { value: number } }
            | undefined;
          if (livery) {
            livery.uAccent.value.set(car.accent);
            livery.uPattern.value = pattern;
          }
        } else if (/^caliper$/i.test(mat.name)) mat.color.set(car.accent);
      }
    });
    invalidate();
  }, [object, car.bodyId, car.color, car.accent, invalidate]);
  useFrame((_, dt) => {
    const speed = speedRef?.current ?? 0;
    if (speed) {
      // Same sign as the procedural wheels: rolling backwards reverses the spin.
      const step = (speed / 3.6 / 0.33) * dt;
      for (const node of rig.spin) node.rotateY(step);
    }
    const target = (steerRef?.current ?? 0) * 0.5;
    const delta = target - appliedSteer.current;
    if (Math.abs(delta) > 0.0001) {
      for (const node of rig.steer) node.rotateOnWorldAxis(rig.up, delta);
      appliedSteer.current = target;
    }
  });
  return (
    <group>
      <primitive object={object} dispose={null} />
      {car.bodyId === "touring-gt" && <GenericNoseGrille />}
    </group>
  );
}

class ModelErrorBoundary extends Component<
  { children: ReactNode; car: CarConfig },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; car: CarConfig }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  override componentDidCatch(error: unknown) {
    console.error("3D model failed to load", error);
  }
  override render() {
    if (this.state.hasError) return <ProceduralCarBody car={this.props.car} />;
    return this.props.children;
  }
}

// ─── Wheels with rotation ─────────────────────────────────────────────────────

function useWheelLook(car: CarConfig) {
  const colors = useMemo(palette, []);
  const count =
    car.wheelStyle === "malla"
      ? 12
      : car.wheelStyle === "multirayo"
        ? 10
        : car.wheelStyle === "disco"
          ? 0
          : 5;
  const radius = wheelRadius(car.wheelSize);
  // One material per look, shared by every mesh of the wheel and disposed with it.
  const mats = useMemo(() => {
    const tyre = tyreTexture();
    return {
      // The rubber carries the tread and the wall lettering, so a wheel standing
      // still in the workshop is as detailed as one on the circuit.
      rubber: new THREE.MeshStandardMaterial({
        color: tyre ? "#ffffff" : colors.rubber,
        map: tyre,
        roughness: 0.92,
      }),
      rim: new THREE.MeshStandardMaterial({
        color: car.wheelColor,
        metalness: 0.92,
        roughness: 0.16,
      }),
      hub: new THREE.MeshStandardMaterial({ color: "#23272d", metalness: 0.7, roughness: 0.35 }),
      disc: new THREE.MeshStandardMaterial({ color: "#9aa1a8", metalness: 0.85, roughness: 0.45 }),
      caliper: new THREE.MeshStandardMaterial({
        color: car.accent,
        metalness: 0.4,
        roughness: 0.35,
      }),
    };
  }, [colors.rubber, car.wheelColor, car.accent]);
  useEffect(
    () => () => {
      Object.values(mats).forEach((m) => m.dispose());
    },
    [mats],
  );
  return { mats, count, radius };
}

// The wheel itself: tyre, open rim, brake disc and the fixed caliper. Shared by
// the animated (track) and static (workshop) wheels so they always match.
function WheelAssembly({
  car,
  side,
  spinnerRef,
}: {
  car: CarConfig;
  side: number;
  spinnerRef: RefObject<THREE.Group | null>;
}) {
  const { mats, count, radius } = useWheelLook(car);
  return (
    <>
      {/* Calipers are fixed to the upright, so they stay still while the wheel turns */}
      <mesh position={[side * 0.02, radius * 0.4, -0.11]} material={mats.caliper}>
        <boxGeometry args={[0.055, 0.18, 0.1]} />
      </mesh>
      <group ref={spinnerRef}>
        {/* Tyre: a real cross-section revolved around the wheel axis, so the
            sidewall bulges and the tread is round instead of a tin can */}
        <Lathe profile={TYRE_PROFILE(radius, 0.2)} rotation={[0, 0, Math.PI / 2]} material={mats.rubber} segments={36} />
        {/* Rim barrel, also revolved, with the lip rolled over the tyre bead */}
        <Lathe profile={RIM_PROFILE(radius, 0.16)} rotation={[0, 0, Math.PI / 2]} material={mats.rim} segments={32} />
        {/* Brake disc, seen through the open rim barrel */}
        <mesh rotation-z={Math.PI / 2} position-x={side * 0.035} material={mats.disc}>
          <cylinderGeometry args={[radius * 0.62, radius * 0.62, 0.016, 26]} />
        </mesh>
        <group position-x={side * 0.105}>
          <mesh rotation-z={Math.PI / 2} material={count ? mats.hub : mats.rim}>
            <cylinderGeometry args={[radius * 0.44, radius * 0.44, 0.02, 20]} />
          </mesh>
          {Array.from({ length: count }, (_, i) => (
            <mesh key={i} rotation-x={(i * Math.PI) / count} material={mats.rim}>
              <boxGeometry args={[0.03, radius * 1.34, 0.045]} />
            </mesh>
          ))}
          <mesh rotation-z={Math.PI / 2} material={mats.rim}>
            <cylinderGeometry args={[0.06, 0.06, 0.04, 16]} />
          </mesh>
        </group>
      </group>
    </>
  );
}

function WheelSpinning({
  x,
  z,
  car,
  speedRef,
}: {
  x: number;
  z: number;
  car: CarConfig;
  speedRef: RefObject<number>;
}) {
  const wheelRef = useRef<THREE.Group>(null);
  const radius = wheelRadius(car.wheelSize);
  const side = Math.sign(x) || 1;
  useFrame((_, dt) => {
    if (wheelRef.current && speedRef.current) {
      wheelRef.current.rotation.x += (speedRef.current / 3.6 / radius) * dt;
    }
  });
  return (
    <group position={[x, radius, z]}>
      <WheelAssembly car={car} side={side} spinnerRef={wheelRef} />
    </group>
  );
}

// ─── Vehicle ──────────────────────────────────────────────────────────────────

// Soft baked blob shadow, reused for the car and for the roadside trees. A
// single texture costs one draw call and no extra render pass, which is the
// only kind of shadow an integrated GPU can afford everywhere.
function useBlobShadow() {
  const colors = useMemo(palette, []);
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 62);
      g.addColorStop(0, colors.shadow);
      g.addColorStop(0.45, colors.shadow);
      g.addColorStop(1, "transparent");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    }
    return new THREE.CanvasTexture(canvas);
  }, [colors]);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

function Shadow() {
  const texture = useBlobShadow();
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={0.009}>
      <planeGeometry args={[2.8, 5.1]} />
      <meshBasicMaterial
        map={texture}
        transparent
        opacity={0.7}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

function Vehicle({
  car,
  installed,
  focus,
  model,
  speedRef,
  cockpit = false,
  steerRef,
}: {
  car: CarConfig;
  installed: boolean[];
  focus: string;
  model?: THREE.Group | null | undefined;
  speedRef?: RefObject<number>;
  /** First person: the cabin is drawn even with the body on, so cameras 1 shows it. */
  cockpit?: boolean;
  steerRef?: RefObject<number>;
}) {
  const mounted =
    installed[7] || focus === "Carrocería" || focus === "Ruedas" || focus === "Prueba" || !!model;
  // The car is the main shadow caster of every scene it appears in: one traversal
  // after each render marks every mesh, including wheels and details.
  const rootRef = useRef<THREE.Group>(null);
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const inInterior = (object: THREE.Object3D) => {
      let node: THREE.Object3D | null = object;
      while (node) {
        if (node.userData["noShadow"] === true) return true;
        node = node.parent;
      }
      return false;
    };
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = !inInterior(o);
    });
  });
  // The studio bakes its shadow map once. Any change to the shell, the wheels
  // or the imported model must request one new bake, or the old silhouette
  // would stay painted on the floor.
  useEffect(() => {
    gl.shadowMap.needsUpdate = true;
  }, [gl, car, installed, model]);
  const wx = trackX(car);
  return (
    <group ref={rootRef}>
      <Shadow />
      {mounted ? (
        <>
          {/* In the cockpit every outer shell is dropped: the procedural one
              has solid glazing, and the imported showpieces hide their interiors
              (and some prototypes have a closed canopy with no cabin at all), so
              either shell fills the driver's eye with tinted sheets and bars.
              InteriorModel supplies the complete cabin instead. */}
          {cockpit ? null : (
            <group position-y={car.rideHeight * 0.05}>
              {model ? (
                <Suspense fallback={<Loader />}>
                  <ModelErrorBoundary car={car}>
                    <Model source={model} car={car} speedRef={speedRef} steerRef={steerRef} />
                  </ModelErrorBoundary>
                </Suspense>
              ) : (
                <ProceduralCarBody car={car} />
              )}
            </group>
          )}
          {/* The interior always shows in the cockpit, body on or not. */}
          {cockpit && (
            <group position-y={car.rideHeight * 0.05} userData={{ noShadow: true }}>
              <group position={[0, 0.02, 0.1]}>
                <InteriorModel car={car} cockpit imported steerRef={steerRef} />
              </group>
            </group>
          )}
        </>
      ) : (
        <>
          {/* Nothing is faked while the car is being built: the real frame, the
              engine that was just chosen and the interior that was fitted. */}
          <ChassisModel car={car} />
          {installed[1] && (
            <group position={[0, 0.62, 0.92]} scale={0.82}>
              <EngineModel car={car} />
            </group>
          )}
          {installed[8] && (
            <group position={[0, 0.02, 0.1]} userData={{ noShadow: true }}>
              <InteriorModel car={car} cockpit imported={!!model} steerRef={steerRef} />
            </group>
          )}
        </>
      )}
      {(!model || !mounted) &&
        [-wx, wx].flatMap((x) =>
          // From the driver's seat the front wheels are invisible: dropping them
          // keeps their hubs and brakes out of an otherwise clean view.
          (cockpit ? [AXLE_REAR] : [AXLE_REAR, AXLE_FRONT]).map((z) =>
            speedRef ? (
              <WheelSpinning key={`${x}-${z}`} x={x} z={z} car={car} speedRef={speedRef} />
            ) : (
              <WheelStatic key={`${x}-${z}`} x={x} z={z} car={car} />
            ),
          ),
        )}
    </group>
  );
}

function WheelStatic({ x, z, car }: { x: number; z: number; car: CarConfig }) {
  const radius = wheelRadius(car.wheelSize);
  const idle = useRef<THREE.Group>(null);
  return (
    <group position={[x, radius, z]}>
      <WheelAssembly car={car} side={Math.sign(x) || 1} spinnerRef={idle} />
    </group>
  );
}

function Loader() {
  return (
    <Html center>
      <span className="bg-background/80 px-3 py-2 font-mono text-xs text-foreground">
        Cargando auto…
      </span>
    </Html>
  );
}

// A painted shop sign: the caption is drawn onto a canvas once the display cut
// is ready, then mounted on a slim steel backing so the walls read like a real
// workshop instead of four bare panels.
function useSignTexture(text: string, bg: string, fg: string) {
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
  useEffect(() => {
    let alive = true;
    const paint = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 96;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, 512, 96);
      ctx.fillStyle = fg;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // Shrink long captions so they never run off the board.
      let size = 46;
      const font = () => `italic 400 ${size}px 'High Speed', Orbitron, 'Chakra Petch', sans-serif`;
      ctx.font = font();
      while (ctx.measureText(text).width > 476 && size > 18) {
        size -= 2;
        ctx.font = font();
      }
      ctx.fillText(text, 256, 51);
      const next = new THREE.CanvasTexture(canvas);
      next.colorSpace = THREE.SRGBColorSpace;
      next.anisotropy = 8;
      return next;
    };
    const ready = document.fonts?.load
      ? document.fonts.load("italic 400 46px 'High Speed'").catch(() => null)
      : Promise.resolve(null);
    void ready.then(() => {
      if (alive) setTexture(paint());
    });
    return () => {
      alive = false;
    };
  }, [text, bg, fg]);
  useEffect(
    () => () => {
      texture?.dispose();
    },
    [texture],
  );
  return texture;
}

function SignBoard({
  text,
  position,
  rotationY = 0,
  width = 2.6,
  height = 0.58,
  bg = "#1f56b4",
  fg = "#eef3f8",
}: {
  text: string;
  position: [number, number, number];
  rotationY?: number;
  width?: number;
  height?: number;
  bg?: string;
  fg?: string;
}) {
  const map = useSignTexture(text, bg, fg);
  const face = useDispose(
    useMemo(
      () =>
        new THREE.MeshStandardMaterial({
          map: map ?? null,
          color: map ? "#ffffff" : bg,
          roughness: 0.55,
          metalness: 0.05,
        }),
      [map, bg],
    ),
  );
  const back = useDispose(
    useMemo(() => new THREE.MeshStandardMaterial({ color: "#23262b", metalness: 0.5, roughness: 0.45 }), []),
  );
  return (
    <group position={position} rotation-y={rotationY}>
      <RoundedBox
        args={[width + 0.07, height + 0.07, 0.035]}
        radius={0.01}
        bevelSegments={1}
        smoothness={1}
        position={[0, 0, -0.028]}
        material={back}
      />
      <mesh material={face}>
        <planeGeometry args={[width, height]} />
      </mesh>
    </group>
  );
}

// ─── Garage Environment ───────────────────────────────────────────────────────

/**
 * A tidy wall board: an aluminium frame with a painted sign, drawn on a canvas
 * so the bay can carry lettering on every wall for the cost of one draw call
 * each. The panel faces the group's +Z, so the caller only has to turn the
 * whole board towards the room.
 */
function WallSign({
  title,
  sub,
  tint = "#12161c",
  width = 2.6,
  height = 0.9,
  position,
  rotationY = 0,
  frame,
}: {
  title: string;
  sub: string;
  tint?: string;
  width?: number;
  height?: number;
  position: [number, number, number];
  rotationY?: number;
  frame: THREE.Material;
}) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = Math.round((512 * height) / Math.max(width, 0.2));
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const w = canvas.width;
      const h = canvas.height;
      ctx.fillStyle = tint;
      ctx.fillRect(0, 0, w, h);
      // Two bright rules: enough structure that the board reads as fitted
      // signage rather than a flat rectangle.
      ctx.fillStyle = "rgba(255,255,255,0.16)";
      ctx.fillRect(0, 0, w, Math.max(3, h * 0.02));
      ctx.fillRect(0, h - Math.max(3, h * 0.02), w, Math.max(3, h * 0.02));
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#f4f7fa";
      ctx.font = `700 ${Math.round(h * 0.32)}px system-ui, sans-serif`;
      ctx.fillText(title, w / 2, h * 0.42);
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.font = `600 ${Math.round(h * 0.14)}px system-ui, sans-serif`;
      ctx.fillText(sub, w / 2, h * 0.7);
    }
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, [title, sub, tint, width, height]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <group position={position} rotation-y={rotationY}>
      <RoundedBox
        args={[width + 0.1, height + 0.1, 0.06]}
        radius={0.02}
        bevelSegments={1}
        smoothness={1}
        material={frame}
      />
      <mesh position={[0, 0, 0.033]}>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial map={texture} roughness={0.72} metalness={0.05} />
      </mesh>
    </group>
  );
}

function GarageEnvironment() {
  const c = useMemo(palette, []);
  // Every surface is drawn on a small canvas instead of living as a flat
  // colour: a sealed concrete floor, painted blockwork on the walls, plank
  // grain on the timber and a proper hole grid on the pegboard.
  const textures = useMemo(() => {
    const make = (size: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (ctx) draw(ctx);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 16;
      return texture;
    };
    const floor = make(256, (ctx) => {
      ctx.fillStyle = c.floor;
      ctx.fillRect(0, 0, 256, 256);
      drawGrain(ctx, 256, 7000, 0.1, "#ffffff", "#000000", 0x7c1e5a93);
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 1;
      for (let i = 0; i <= 256; i += 64) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, 256);
        ctx.moveTo(0, i);
        ctx.lineTo(256, i);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    });
    floor.repeat.set(6, 6);
    const wall = make(256, (ctx) => {
      ctx.fillStyle = "#9e9c97";
      ctx.fillRect(0, 0, 256, 256);
      drawGrain(ctx, 256, 5200, 0.07, "#ffffff", "#000000", 0x51ce9044);
      // Painted blockwork: four courses of staggered blocks per tile.
      const rows = 4;
      const bh = 256 / rows;
      const cw = 42;
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      ctx.lineWidth = 3;
      for (let r = 0; r < rows; r++) {
        const y = r * bh;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(256, y);
        ctx.stroke();
        for (let x = (r % 2) * (cw / 2); x <= 256; x += cw) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + bh);
          ctx.stroke();
        }
      }
      // A soft highlight on top of every course so the relief reads.
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.lineWidth = 2;
      for (let r = 0; r < rows; r++) {
        const y = r * bh + 2;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(256, y);
        ctx.stroke();
      }
    });
    wall.repeat.set(8, 4);
    const wood = make(256, (ctx) => {
      ctx.fillStyle = "#6f675a";
      ctx.fillRect(0, 0, 256, 256);
      // Five planks across, each one drifting a little and full of grain.
      const pw = 256 / 5;
      for (let i = 0; i < 5; i++) {
        const x = i * pw;
        const t = (i * 37) % 23;
        ctx.fillStyle = `rgba(${132 + t}, ${122 + t}, ${102 + t}, 0.3)`;
        ctx.fillRect(x, 0, pw, 256);
        ctx.fillStyle = "rgba(0,0,0,0.34)";
        ctx.fillRect(x, 0, 2, 256);
        ctx.strokeStyle = "rgba(0,0,0,0.13)";
        ctx.lineWidth = 1;
        for (let g = 0; g < 6; g++) {
          ctx.beginPath();
          const gx = x + 5 + ((g * 13 + i * 29) % (pw - 10));
          ctx.moveTo(gx, 0);
          for (let y = 32; y <= 256; y += 32) ctx.lineTo(gx + Math.sin((y + g * 17) * 0.05) * 2.2, y);
          ctx.stroke();
        }
        ctx.fillStyle = "rgba(0,0,0,0.24)";
        ctx.beginPath();
        ctx.arc(x + ((i * 53) % (pw - 12)) + 6, ((i * 97) % 200) + 28, 3.4, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    const peg = make(128, (ctx) => {
      ctx.fillStyle = "#8d8c87";
      ctx.fillRect(0, 0, 128, 128);
      drawGrain(ctx, 128, 900, 0.06, "#ffffff", "#000000", 0x2233aa77);
      // The hole grid: what makes a pegboard a pegboard.
      for (let y = 8; y < 128; y += 16) {
        for (let x = 8; x < 128; x += 16) {
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.beginPath();
          ctx.arc(x, y, 3.1, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,0.22)";
          ctx.beginPath();
          ctx.arc(x - 0.7, y + 0.8, 0.9, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
    peg.repeat.set(3, 2);
    return { floor, wall, wood, peg };
  }, [c]);
  useEffect(
    () => () => {
      Object.values(textures).forEach((t) => t.dispose());
    },
    [textures],
  );
  // One material instance per look: the props below reuse these instead of
  // creating ~30 throwaway materials, which keeps the garage cheap to render.
  const mat = useMemo(
    () => ({
      wall: new THREE.MeshStandardMaterial({ map: textures.wall, metalness: 0.08, roughness: 0.86 }),
      ceiling: new THREE.MeshStandardMaterial({ color: c.floor, metalness: 0.1, roughness: 0.9 }),
      cabinet: new THREE.MeshStandardMaterial({
        color: "#545a61",
        metalness: 0.78,
        roughness: 0.28,
        envMapIntensity: 1.55,
      }),
      drawer: new THREE.MeshStandardMaterial({
        color: "#dcdcdc",
        metalness: 0.92,
        roughness: 0.16,
        envMapIntensity: 1.8,
      }),
      red: new THREE.MeshStandardMaterial({
        color: "#b3261e",
        metalness: 0.5,
        roughness: 0.28,
        envMapIntensity: 1.45,
      }),
      redDark: new THREE.MeshStandardMaterial({
        color: "#7d1a15",
        metalness: 0.55,
        roughness: 0.3,
        envMapIntensity: 1.4,
      }),
      white: new THREE.MeshStandardMaterial({
        color: "#e8e8e8",
        metalness: 0.22,
        roughness: 0.4,
        envMapIntensity: 1.2,
      }),
      wood: new THREE.MeshStandardMaterial({ map: textures.wood, metalness: 0.05, roughness: 0.9 }),
      peg: new THREE.MeshStandardMaterial({ map: textures.peg, metalness: 0.12, roughness: 0.7 }),
      tire: new THREE.MeshStandardMaterial({ color: "#1d1d1d", roughness: 0.92 }),
      bench: new THREE.MeshStandardMaterial({
        color: "#545454",
        metalness: 0.42,
        roughness: 0.46,
        envMapIntensity: 1.25,
      }),
      steel: new THREE.MeshStandardMaterial({
        color: "#929aa3",
        metalness: 0.95,
        roughness: 0.18,
        envMapIntensity: 1.9,
      }),
      tool: new THREE.MeshStandardMaterial({
        color: "#c8cdd3",
        metalness: 1,
        roughness: 0.1,
        envMapIntensity: 2.1,
      }),
      lamp: new THREE.MeshStandardMaterial({
        color: "#ffffff",
        emissive: "#ffffff",
        emissiveIntensity: 1.6,
      }),
      lift: new THREE.MeshStandardMaterial({
        color: "#d8b132",
        metalness: 0.72,
        roughness: 0.22,
        envMapIntensity: 1.7,
      }),
    }),
    [c, textures],
  );
  useEffect(
    () => () => {
      Object.values(mat).forEach((m) => m.dispose());
    },
    [mat],
  );
  // The dressing of the bay: signed boards on every wall plus the big
  // automotive pieces in the stretches that used to be bare. Built once (the
  // element tree is stable) and wrapped in Merged, so ~80 boxes cost about ten
  // draw calls in total instead of eighty.
  const dressing = useMemo(
    () => (
      <>
        <WallSign
          frame={mat.steel}
          title="NEUMÁTICOS DEPORTIVOS"
          sub="COMPUESTOS · PRESIÓN · BALANCEO"
          tint="#132029"
          width={2.9}
          height={0.95}
          position={[-7.48, 3.35, -2.4]}
          rotationY={Math.PI / 2}
        />
        <WallSign
          frame={mat.steel}
          title="SERVICIO ESPECIALIZADO"
          sub="MOTOR · CHASIS · SUSPENSIÓN"
          tint="#1b1414"
          width={3.4}
          height={0.95}
          position={[0, 3.45, -7.38]}
        />
        <WallSign
          frame={mat.steel}
          title="ALINEACIÓN Y BALANCEO"
          sub="PRECISIÓN EN CADA VUELTA"
          tint="#131a24"
          width={2.9}
          height={0.9}
          position={[7.48, 3.5, -3.4]}
          rotationY={-Math.PI / 2}
        />
        <WallSign
          frame={mat.steel}
          title="GRAND HORIZON"
          sub="TALLER · INGENIERÍA · CARRERAS"
          tint="#101418"
          width={4.2}
          height={1}
          position={[0, 3.62, 7.38]}
          rotationY={Math.PI}
        />

        <Merged>
          {/* Parts rack: it used to stand directly in front of the roller door.
              Same wall, slid along past the tool chests, so the door has nothing
              but floor around it. Body panels, exhausts and a wing pulled off
              customer cars, stacked by size. */}
          <group position={[5.4, 0, -7.28]}>
            {[-1.75, 1.75].map((x) => (
              <RoundedBox
                key={x}
                args={[0.08, 2.6, 0.08]}
                radius={0.02}
                bevelSegments={1}
                smoothness={1}
                position={[x, 1.3, 0]}
                material={mat.steel}
              />
            ))}
            {[0.62, 1.42, 2.22].map((y) => (
              <RoundedBox
                key={y}
                args={[3.6, 0.06, 0.44]}
                radius={0.02}
                bevelSegments={1}
                smoothness={1}
                position={[0, y, 0.06]}
                material={mat.steel}
              />
            ))}
            {/* Bottom shelf: two exhaust lines with their mufflers. */}
            {[-0.55, 0.35].map((x) => (
              <group key={x} position={[x, 0.72, 0.04]}>
                <mesh rotation-z={Math.PI / 2} material={mat.tool}>
                  <cylinderGeometry args={[0.045, 0.045, 1.5, 12]} />
                </mesh>
                <RoundedBox
                  args={[0.4, 0.16, 0.16]}
                  radius={0.04}
                  bevelSegments={1}
                  smoothness={1}
                  position={[0.34, 0.02, 0]}
                  material={mat.steel}
                />
                <mesh position={[-0.85, 0, 0]} rotation-z={Math.PI / 2} material={mat.tool}>
                  <cylinderGeometry args={[0.06, 0.05, 0.16, 12]} />
                </mesh>
              </group>
            ))}
            {/* Middle shelf: a front bumper and an intercooler. */}
            <group position={[-0.85, 1.6, 0.02]}>
              <RoundedBox
                args={[1.1, 0.26, 0.18]}
                radius={0.06}
                bevelSegments={2}
                smoothness={2}
                material={mat.redDark}
              />
              {[-0.55, 0.55].map((dx) => (
                <RoundedBox
                  key={dx}
                  args={[0.07, 0.24, 0.22]}
                  radius={0.02}
                  bevelSegments={1}
                  smoothness={1}
                  position={[dx, -0.02, 0]}
                  material={mat.redDark}
                />
              ))}
            </group>
            <group position={[0.85, 1.62, 0]}>
              <RoundedBox
                args={[0.9, 0.32, 0.12]}
                radius={0.02}
                bevelSegments={1}
                smoothness={1}
                material={mat.steel}
              />
              {[-0.3, -0.1, 0.1, 0.3].map((dx) => (
                <RoundedBox
                  key={dx}
                  args={[0.04, 0.26, 0.14]}
                  radius={0.01}
                  bevelSegments={1}
                  smoothness={1}
                  position={[dx, 0, 0]}
                  material={mat.tool}
                />
              ))}
            </group>
            {/* Top shelf: a bonnet leaning on the wall and a rear wing. */}
            <mesh position={[-0.5, 2.62, -0.04]} rotation-x={0.34} material={mat.white}>
              <boxGeometry args={[1.7, 0.05, 0.5]} />
            </mesh>
            <group position={[1, 2.52, 0.02]}>
              <RoundedBox
                args={[1.3, 0.05, 0.34]}
                radius={0.02}
                bevelSegments={1}
                smoothness={1}
                material={mat.redDark}
              />
              {[-0.62, 0.62].map((dx) => (
                <RoundedBox
                  key={dx}
                  args={[0.05, 0.3, 0.4]}
                  radius={0.02}
                  bevelSegments={1}
                  smoothness={1}
                  position={[dx, -0.1, 0]}
                  material={mat.redDark}
                />
              ))}
            </group>
          </group>

          {/* A V8 on a turntable, waiting for its car — clear of the door and of
              the rack, out in the open where the light reaches it. */}
          <group position={[3.05, 0, -5.5]} rotation-y={-0.45}>
            <RoundedBox
              args={[0.92, 0.08, 0.72]}
              radius={0.02}
              bevelSegments={1}
              smoothness={1}
              position={[0, 0.05, 0]}
              material={mat.steel}
            />
            {(
              [
                [-0.38, -0.28],
                [0.38, -0.28],
                [-0.38, 0.28],
                [0.38, 0.28],
              ] as const
            ).map(([dx, dz]) => (
              <mesh
                key={`${dx}-${dz}`}
                position={[dx, 0.04, dz]}
                rotation-x={Math.PI / 2}
                material={mat.tire}
              >
                <cylinderGeometry args={[0.06, 0.06, 0.05, 10]} />
              </mesh>
            ))}
            <mesh position={[0, 0.62, 0]} material={mat.steel}>
              <cylinderGeometry args={[0.07, 0.1, 1.12, 12]} />
            </mesh>
            <mesh position={[0, 1.2, 0]} rotation-z={Math.PI / 2} material={mat.tool}>
              <cylinderGeometry args={[0.15, 0.15, 0.07, 16]} />
            </mesh>
            <group position={[0, 1.26, 0]} rotation-y={0.22}>
              <RoundedBox
                args={[0.62, 0.46, 0.5]}
                radius={0.03}
                bevelSegments={2}
                smoothness={2}
                position={[0, 0.18, 0]}
                material={mat.bench}
              />
              <RoundedBox
                args={[0.54, 0.2, 0.44]}
                radius={0.03}
                bevelSegments={1}
                smoothness={1}
                position={[0, -0.08, 0]}
                material={mat.steel}
              />
              {[-0.2, 0.2].map((dx) => (
                <group key={dx}>
                  <RoundedBox
                    args={[0.22, 0.14, 0.5]}
                    radius={0.02}
                    bevelSegments={1}
                    smoothness={1}
                    position={[dx, 0.48, 0]}
                    material={mat.steel}
                  />
                  <RoundedBox
                    args={[0.24, 0.1, 0.46]}
                    radius={0.02}
                    bevelSegments={1}
                    smoothness={1}
                    position={[dx, 0.57, 0]}
                    material={mat.red}
                  />
                </group>
              ))}
              <mesh position={[0.33, 0.18, 0]} rotation-z={Math.PI / 2} material={mat.tool}>
                <cylinderGeometry args={[0.09, 0.09, 0.06, 14]} />
              </mesh>
            </group>
          </group>

          {/* Wheel balancer along the right wall. */}
          <group position={[7.14, 0, -1.5]} rotation-y={-Math.PI / 2}>
            <RoundedBox
              args={[0.62, 1.06, 0.72]}
              radius={0.03}
              bevelSegments={2}
              smoothness={2}
              position={[0, 0.53, 0]}
              material={mat.white}
            />
            <RoundedBox
              args={[0.66, 0.22, 0.76]}
              radius={0.04}
              bevelSegments={2}
              smoothness={2}
              position={[0, 1.16, 0]}
              material={mat.redDark}
            />
            <RoundedBox
              args={[0.5, 0.14, 0.6]}
              radius={0.02}
              bevelSegments={1}
              smoothness={1}
              position={[0, 0.1, 0]}
              material={mat.steel}
            />
            <mesh position={[0, 0.92, 0.42]} rotation-x={Math.PI / 2} material={mat.steel}>
              <cylinderGeometry args={[0.045, 0.045, 0.24, 12]} />
            </mesh>
            <mesh position={[0, 0.92, 0.56]} rotation-x={Math.PI / 2} material={mat.tool}>
              <cylinderGeometry args={[0.09, 0.09, 0.05, 14]} />
            </mesh>
          </group>

          {/* Service cart with the battery charger and a tray of sockets. */}
          <group position={[7.14, 0, 0.9]} rotation-y={-Math.PI / 2}>
            {[0.22, 0.72, 1.12].map((y) => (
              <RoundedBox
                key={y}
                args={[0.6, 0.05, 0.9]}
                radius={0.02}
                bevelSegments={1}
                smoothness={1}
                position={[0, y, 0]}
                material={mat.steel}
              />
            ))}
            {(
              [
                [-0.24, -0.38],
                [0.24, -0.38],
                [-0.24, 0.38],
                [0.24, 0.38],
              ] as const
            ).map(([dx, dz]) => (
              <mesh
                key={`${dx}-${dz}`}
                position={[dx, 0.06, dz]}
                rotation-x={Math.PI / 2}
                material={mat.tire}
              >
                <cylinderGeometry args={[0.055, 0.055, 0.05, 10]} />
              </mesh>
            ))}
            <RoundedBox
              args={[0.42, 0.3, 0.3]}
              radius={0.03}
              bevelSegments={1}
              smoothness={1}
              position={[-0.05, 0.9, 0.1]}
              material={mat.red}
            />
            <RoundedBox
              args={[0.36, 0.05, 0.5]}
              radius={0.02}
              bevelSegments={1}
              smoothness={1}
              position={[0.04, 1.42, 0]}
              material={mat.redDark}
            />
            {[-0.14, -0.05, 0.04, 0.13].map((dx) => (
              <mesh key={dx} position={[dx, 1.48, 0.05]} material={mat.tool}>
                <cylinderGeometry args={[0.035, 0.035, 0.09, 10]} />
              </mesh>
            ))}
          </group>

          {/* Chain hoist on its rail, up over the lift bay. */}
          <group position={[0, 3.94, 0.5]}>
            <RoundedBox
              args={[7.6, 0.16, 0.2]}
              radius={0.02}
              bevelSegments={1}
              smoothness={1}
              material={mat.steel}
            />
            {[-3.5, 3.5].map((x) => (
              <RoundedBox
                key={x}
                args={[0.1, 0.5, 0.16]}
                radius={0.02}
                bevelSegments={1}
                smoothness={1}
                position={[x, 0.3, 0]}
                material={mat.steel}
              />
            ))}
            <group position={[1.15, -0.24, 0]}>
              <RoundedBox
                args={[0.46, 0.3, 0.34]}
                radius={0.03}
                bevelSegments={1}
                smoothness={1}
                material={mat.redDark}
              />
              <RoundedBox
                args={[0.34, 0.14, 0.44]}
                radius={0.02}
                bevelSegments={1}
                smoothness={1}
                position={[0, 0.2, 0]}
                material={mat.steel}
              />
              <mesh position={[0, -0.16, 0]} material={mat.steel}>
                <cylinderGeometry args={[0.035, 0.035, 0.12, 10]} />
              </mesh>
              {[0, 1, 2, 3, 4].map((i) => (
                <mesh key={i} position={[0, -0.28 - i * 0.085, 0]} material={mat.tool}>
                  <torusGeometry args={[0.026, 0.009, 6, 10]} />
                </mesh>
              ))}
              <mesh position={[0, -0.78, 0]} material={mat.tool}>
                <torusGeometry args={[0.055, 0.016, 6, 14]} />
              </mesh>
            </group>
          </group>

          {/* Service details: an extinguisher by the chests and the shop clock. */}
          <group position={[-3.15, 1.5, -7.4]}>
            <RoundedBox
              args={[0.16, 0.16, 0.1]}
              radius={0.02}
              bevelSegments={1}
              smoothness={1}
              position={[0, 0.32, 0]}
              material={mat.steel}
            />
            <mesh position={[0, 0, 0.02]} material={mat.redDark}>
              <cylinderGeometry args={[0.11, 0.11, 0.56, 16]} />
            </mesh>
            <mesh position={[0, 0.34, 0.02]} material={mat.steel}>
              <cylinderGeometry args={[0.04, 0.04, 0.12, 10]} />
            </mesh>
          </group>
          <group position={[3.3, 3.2, -7.46]}>
            <mesh rotation-x={Math.PI / 2} material={mat.steel}>
              <cylinderGeometry args={[0.34, 0.34, 0.07, 24]} />
            </mesh>
            <mesh position={[0, 0, 0.04]} material={mat.white}>
              <circleGeometry args={[0.29, 24]} />
            </mesh>
            <mesh position={[0, 0.08, 0.05]} material={mat.tire}>
              <boxGeometry args={[0.02, 0.2, 0.02]} />
            </mesh>
            <mesh position={[0.04, 0, 0.05]} rotation-z={-1.1} material={mat.tire}>
              <boxGeometry args={[0.16, 0.02, 0.02]} />
            </mesh>
          </group>

          {/* The facing wall is the one the camera is pointed at, so that is
              where the shop shows its work: a row of wheels and a loose tire
              hung over the tool chests, mufflers under them. All of it is up
              off the floor and well clear of the door. */}
          {[-1.9, -0.6, 0.8].map((x) => (
            <group key={`wheel-${x}`} position={[x, 2.15, -7.33]}>
              <mesh rotation-x={Math.PI / 2} material={mat.tire}>
                <cylinderGeometry args={[0.31, 0.31, 0.2, 24]} />
              </mesh>
              <mesh position={[0, 0, 0.05]} rotation-x={Math.PI / 2} material={mat.tool}>
                <cylinderGeometry args={[0.185, 0.185, 0.07, 20]} />
              </mesh>
              {[0, 1, 2, 3, 4].map((i) => (
                <mesh
                  key={i}
                  position={[0, 0, 0.1]}
                  rotation-z={(i * Math.PI * 2) / 5}
                  material={mat.steel}
                >
                  <boxGeometry args={[0.17, 0.035, 0.02]} />
                </mesh>
              ))}
              <mesh position={[0, 0, 0.11]} material={mat.steel}>
                <cylinderGeometry args={[0.045, 0.045, 0.05, 12]} />
              </mesh>
            </group>
          ))}
          <group position={[1.95, 2.1, -7.33]}>
            <mesh rotation-x={Math.PI / 2} material={mat.tire}>
              <cylinderGeometry args={[0.32, 0.32, 0.21, 24]} />
            </mesh>
            <mesh rotation-x={Math.PI / 2} material={mat.tool}>
              <cylinderGeometry args={[0.13, 0.13, 0.24, 18]} />
            </mesh>
            <mesh position={[0, 0, -0.13]} material={mat.steel}>
              <boxGeometry args={[0.06, 0.06, 0.14]} />
            </mesh>
          </group>
          {[-1.9, -0.6].map((x) => (
            <group key={`muffler-${x}`} position={[x, 1.45, -7.34]}>
              <mesh rotation-z={Math.PI / 2} material={mat.steel}>
                <cylinderGeometry args={[0.085, 0.085, 0.58, 14]} />
              </mesh>
              {[-0.22, 0.22].map((dx) => (
                <mesh key={dx} position={[dx, 0.16, 0]} material={mat.steel}>
                  <boxGeometry args={[0.04, 0.3, 0.04]} />
                </mesh>
              ))}
            </group>
          ))}
        </Merged>
      </>
    ),
    [mat],
  );
  return (
    <group>
      {/* Floor */}
      <mesh rotation-x={-Math.PI / 2} position-y={-0.01} receiveShadow>
        <planeGeometry args={[18, 18]} />
        <meshStandardMaterial map={textures.floor} metalness={0.22} roughness={0.55} />
      </mesh>
      {/* Walls: a tighter bay, so the workshop hugs the car instead of getting
          lost in an empty hall. All four sides are dressed now, front wall
          included — the camera orbits inside, so nothing opens onto a void. */}
      <mesh position={[0, 2.3, -7.6]} material={mat.wall} receiveShadow>
        <boxGeometry args={[18, 4.6, 0.3]} />
      </mesh>
      <mesh position={[-7.6, 2.3, 0]} rotation-y={Math.PI / 2} material={mat.wall} receiveShadow>
        <boxGeometry args={[18, 4.6, 0.3]} />
      </mesh>
      <mesh position={[7.6, 2.3, 0]} rotation-y={Math.PI / 2} material={mat.wall} receiveShadow>
        <boxGeometry args={[18, 4.6, 0.3]} />
      </mesh>
      <mesh position={[0, 2.3, 7.6]} material={mat.wall} receiveShadow>
        <boxGeometry args={[18, 4.6, 0.3]} />
      </mesh>
      {/* Ceiling */}
      <mesh rotation-x={Math.PI / 2} position-y={4.6} material={mat.ceiling}>
        <planeGeometry args={[18, 18]} />
      </mesh>

      {/* The whole furnishing of the bay, in one merge: the props are static,
          and on an integrated chip the couple of hundred little boxes cost more
          than the entire circuit does. Collapsing them into one draw per
          material pays for every object added to the walls. */}
      <Merged>
        {/* The fourth wall wears its own clutter: two cabinets overhead, a rail
            of clamps, the hose reel, a framed print and the first-aid board. */}
      {[-4.9, 4.9].map((x) => (
        <group key={x} position={[x, 2.5, 7.16]}>
          <RoundedBox args={[1.5, 0.95, 0.5]} radius={0.03} bevelSegments={2} smoothness={2} material={mat.cabinet} castShadow />
          {[-0.37, 0.37].map((dx) => (
            <group key={dx}>
              <RoundedBox args={[0.7, 0.83, 0.05]} radius={0.01} bevelSegments={1} smoothness={1} position={[dx, 0, -0.27]} material={mat.drawer} />
              <RoundedBox args={[0.2, 0.06, 0.04]} radius={0.01} bevelSegments={1} smoothness={1} position={[dx, 0, -0.31]} material={mat.steel} />
            </group>
          ))}
        </group>
      ))}
      <group position={[0, 2.35, 7.41]}>
        <RoundedBox args={[3.6, 0.06, 0.06]} radius={0.02} bevelSegments={1} smoothness={1} material={mat.steel} />
        {[-1.35, -0.45, 0.45, 1.35].map((x) => (
          <group key={x} position={[x, 0, 0]}>
            <RoundedBox args={[0.03, 0.05, 0.03]} radius={0.008} bevelSegments={1} smoothness={1} position={[0, -0.04, 0.01]} material={mat.steel} />
            <RoundedBox args={[0.07, 0.16, 0.05]} radius={0.015} bevelSegments={1} smoothness={1} position={[0, -0.14, 0]} material={mat.tool} />
            <RoundedBox args={[0.05, 0.14, 0.04]} radius={0.012} bevelSegments={1} smoothness={1} position={[0, -0.3, 0]} material={mat.steel} />
          </group>
        ))}
      </group>
      <group position={[2.6, 1.62, 7.4]}>
        <RoundedBox args={[0.34, 0.34, 0.1]} radius={0.02} bevelSegments={1} smoothness={1} position={[0, 0, 0.03]} material={mat.steel} />
        <mesh material={mat.tire}>
          <torusGeometry args={[0.21, 0.025, 8, 26]} />
        </mesh>
        <mesh rotation-x={Math.PI / 2} position={[0, 0, 0.05]} material={mat.steel}>
          <cylinderGeometry args={[0.055, 0.055, 0.08, 14]} />
        </mesh>
      </group>
      <group position={[-2.6, 2.45, 7.43]}>
        <RoundedBox args={[1.0, 1.3, 0.04]} radius={0.02} bevelSegments={1} smoothness={1} material={mat.lift} />
        <RoundedBox args={[0.86, 1.16, 0.03]} radius={0.01} bevelSegments={1} smoothness={1} position={[0, 0, -0.02]} material={mat.white} />
        <RoundedBox args={[0.6, 0.16, 0.03]} radius={0.01} bevelSegments={1} smoothness={1} position={[0, 0.38, -0.04]} material={mat.lift} />
        <RoundedBox args={[0.44, 0.1, 0.03]} radius={0.01} bevelSegments={1} smoothness={1} position={[-0.06, 0.05, -0.04]} material={mat.lift} />
      </group>
      <group position={[0.9, 1.55, 7.44]}>
        <RoundedBox args={[0.36, 0.36, 0.04]} radius={0.02} bevelSegments={1} smoothness={1} material={mat.white} />
        <RoundedBox args={[0.2, 0.06, 0.03]} radius={0.01} bevelSegments={1} smoothness={1} position={[0, 0, -0.024]} material={mat.lift} />
        <RoundedBox args={[0.06, 0.2, 0.03]} radius={0.01} bevelSegments={1} smoothness={1} position={[0, 0, -0.02]} material={mat.lift} />
      </group>

      {/* Painted signage: every bay says what it does. */}
      <SignBoard text="HANGAR 83" position={[-2.4, 3.55, -7.43]} width={2.7} />
      <SignBoard text="NEUMÁTICOS" position={[-7.43, 3.15, -5.7]} rotationY={Math.PI / 2} width={2.6} height={0.5} />
      <SignBoard text="MECÁNICA" position={[7.43, 3.2, -3.4]} rotationY={-Math.PI / 2} width={2.6} height={0.5} />
      <SignBoard text="TALLER DE COMPETICIÓN" position={[0, 3.62, 7.42]} rotationY={Math.PI} width={4.8} />
      {/* No smoking: a white board carrying a red ring and bar. */}
      <group position={[3.5, 3.1, -7.43]}>
        <RoundedBox args={[0.36, 0.36, 0.03]} radius={0.01} bevelSegments={1} smoothness={1} material={mat.white} />
        <mesh position-z={0.02} material={mat.red}>
          <torusGeometry args={[0.11, 0.018, 8, 26]} />
        </mesh>
        <RoundedBox
          args={[0.3, 0.035, 0.02]}
          radius={0.006}
          bevelSegments={1}
          smoothness={1}
          position={[0, 0, 0.02]}
          rotation-z={-Math.PI / 4}
          material={mat.red}
        />
      </group>

      {/* Roller door on the facing wall: closed, obviously — it is backdrop,
          not an exit. Rolled shutter, guide rails and a pull handle. */}
      <group position={[-5.2, 0, -7.43]}>
        {[-1.72, 1.72].map((x) => (
          <RoundedBox
            key={x}
            args={[0.14, 3.2, 0.12]}
            radius={0.02}
            bevelSegments={1}
            smoothness={1}
            position={[x, 1.6, 0]}
            material={mat.steel}
          />
        ))}
        <RoundedBox
          args={[3.72, 0.32, 0.26]}
          radius={0.05}
          bevelSegments={2}
          smoothness={2}
          position={[0, 3.06, 0.02]}
          material={mat.steel}
        />
        <RoundedBox
          args={[3.3, 2.86, 0.06]}
          radius={0.015}
          bevelSegments={1}
          smoothness={1}
          position={[0, 1.47, 0]}
          material={mat.white}
        />
        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <RoundedBox
            key={i}
            args={[3.3, 0.028, 0.075]}
            radius={0.008}
            bevelSegments={1}
            smoothness={1}
            position={[0, 0.28 + i * 0.29, 0]}
            material={mat.tire}
          />
        ))}
        <RoundedBox
          args={[3.34, 0.09, 0.09]}
          radius={0.02}
          bevelSegments={1}
          smoothness={1}
          position={[0, 0.045, 0.01]}
          material={mat.steel}
        />
        <RoundedBox
          args={[0.5, 0.05, 0.05]}
          radius={0.015}
          bevelSegments={1}
          smoothness={1}
          position={[0, 0.36, 0.07]}
          material={mat.steel}
        />
      </group>

      {/* A bank of red tool chests against the back wall */}
      {[-2.325, -0.775, 0.775, 2.325].map((x) => (
        <group key={x} position={[x, 0, -7.15]}>
          {[-0.53, 0.53].map((dx) => (
            <RoundedBox
              key={dx}
              args={[0.1, 0.06, 0.1]}
              radius={0.02}
              bevelSegments={1}
              smoothness={1}
              position={[dx, 0.03, 0]}
              material={mat.steel}
            />
          ))}
          <RoundedBox
            args={[1.2, 1.14, 0.6]}
            radius={0.035}
            bevelSegments={2}
            smoothness={2}
            position={[0, 0.63, 0]}
            material={mat.redDark}
          />
          {[0.2, 0.45, 0.7, 0.95].map((y) => (
            <group key={y}>
              <RoundedBox
                args={[1.08, 0.19, 0.05]}
                radius={0.012}
                bevelSegments={1}
                smoothness={2}
                position={[0, y, 0.31]}
                material={mat.red}
              />
              <RoundedBox
                args={[0.52, 0.028, 0.03]}
                radius={0.01}
                bevelSegments={1}
                smoothness={1}
                position={[0, y, 0.35]}
                material={mat.steel}
              />
            </group>
          ))}
          {[-0.62, 0.62].map((dx) => (
            <RoundedBox
              key={dx}
              args={[0.04, 0.03, 0.34]}
              radius={0.012}
              bevelSegments={1}
              smoothness={1}
              position={[dx, 0.75, 0]}
              material={mat.steel}
            />
          ))}
          <RoundedBox
            args={[1.26, 0.04, 0.66]}
            radius={0.012}
            bevelSegments={1}
            smoothness={2}
            position={[0, 1.22, 0]}
            material={mat.steel}
          />
        </group>
      ))}

      {/* Pegboard with wrenches and sockets on the left wall */}
      <group position={[-7.43, 0, -2.4]}>
        <RoundedBox
          args={[0.05, 1.5, 3.2]}
          radius={0.01}
          bevelSegments={1}
          smoothness={1}
          position={[0, 1.75, 0]}
          material={mat.peg}
        />
        {[-1.44, -1.2, -0.96, -0.72, -0.48, -0.24, 0, 0.24, 0.48, 0.72, 0.96, 1.2, 1.44].map(
          (z, i) => (
            <RoundedBox
              key={z}
              args={[0.03, 0.28 + (i % 3) * 0.05, 0.05]}
              radius={0.01}
              bevelSegments={1}
              smoothness={1}
              position={[0.05, 2.15, z]}
              material={mat.tool}
            />
          ),
        )}
        {[-1.2, -0.9, -0.6, -0.3, 0, 0.3, 0.6, 0.9, 1.2].map((z) => (
          <mesh key={z} position={[0.045, 1.45, z]} rotation-z={Math.PI / 2} material={mat.tool}>
            <cylinderGeometry args={[0.05, 0.05, 0.04, 14]} />
          </mesh>
        ))}
      </group>

      {/* Workbench under the pegboard: vice, drill, tray and a small chest */}
      <group position={[-6.95, 0, -2.4]}>
        <RoundedBox
          args={[0.8, 0.09, 3.1]}
          radius={0.02}
          bevelSegments={1}
          smoothness={1}
          position={[0, 0.93, 0]}
          material={mat.bench}
          receiveShadow
        />
        {[-1.42, 1.42].map((z) => (
          <RoundedBox
            key={z}
            args={[0.7, 0.88, 0.08]}
            radius={0.015}
            bevelSegments={1}
            smoothness={1}
            position={[0, 0.44, z]}
            material={mat.steel}
          />
        ))}
        <RoundedBox
          args={[0.62, 0.16, 0.2]}
          radius={0.03}
          bevelSegments={2}
          smoothness={2}
          position={[0.02, 1.06, -1.28]}
          material={mat.steel}
        />
        <mesh position={[0.02, 1.16, -1.28]} rotation-z={Math.PI / 2} material={mat.tool}>
          <cylinderGeometry args={[0.035, 0.035, 0.3, 12]} />
        </mesh>
        <RoundedBox
          args={[0.34, 0.14, 0.18]}
          radius={0.03}
          bevelSegments={2}
          smoothness={2}
          position={[0, 1.05, -0.6]}
          material={mat.red}
        />
        <RoundedBox
          args={[0.5, 0.03, 0.34]}
          radius={0.01}
          bevelSegments={1}
          smoothness={1}
          position={[0.04, 1.0, 0.5]}
          material={mat.steel}
        />
        {[-0.3, -0.05, 0.2, 0.45, 0.7].map((z) => (
          <RoundedBox
            key={z}
            args={[0.05, 0.03, 0.16]}
            radius={0.01}
            bevelSegments={1}
            smoothness={1}
            position={[0.03, 1.03, z]}
            material={mat.tool}
          />
        ))}
        <group position={[0, 0.29, 0.2]}>
          <RoundedBox
            args={[0.6, 0.58, 0.9]}
            radius={0.03}
            bevelSegments={2}
            smoothness={2}
            material={mat.redDark}
          />
          {[0.42, 0.72].map((y) => (
            <group key={y}>
              <RoundedBox
                args={[0.56, 0.22, 0.04]}
                radius={0.012}
                bevelSegments={1}
                smoothness={1}
                position={[0.03, y, 0.45]}
                material={mat.red}
              />
              <RoundedBox
                args={[0.3, 0.026, 0.03]}
                radius={0.01}
                bevelSegments={1}
                smoothness={1}
                position={[0.03, y, 0.49]}
                material={mat.steel}
              />
            </group>
          ))}
        </group>
        {/* Bench grinder bolted to the far end of the bench */}
        <RoundedBox args={[0.18, 0.09, 0.16]} radius={0.02} bevelSegments={1} smoothness={1} position={[0.02, 1.02, 1.05]} material={mat.bench} />
        <RoundedBox args={[0.36, 0.13, 0.13]} radius={0.03} bevelSegments={2} smoothness={2} position={[0.02, 1.11, 1.05]} material={mat.steel} />
        {[-0.21, 0.21].map((dx) => (
          <mesh key={dx} position={[0.02 + dx, 1.11, 1.05]} rotation-z={Math.PI / 2} material={mat.tire}>
            <cylinderGeometry args={[0.085, 0.085, 0.05, 16]} />
          </mesh>
        ))}
      </group>

      {/* Shelves on the right wall: oil bottles below, parts boxes above */}
      <group position={[7.35, 0, -3.4]}>
        {[1.5, 2.15].map((y) => (
          <RoundedBox
            key={y}
            args={[0.3, 0.04, 2.5]}
            radius={0.01}
            bevelSegments={1}
            smoothness={1}
            position={[0, y, 0]}
            material={mat.steel}
            receiveShadow
          />
        ))}
        {[-0.9, -0.6, -0.3, 0, 0.3, 0.6, 0.9].map((z) => (
          <group key={z} position={[0, 1.52, z]}>
            <mesh position={[0, 0.11, 0]} material={mat.white}>
              <cylinderGeometry args={[0.055, 0.055, 0.22, 12]} />
            </mesh>
            <mesh position={[0, 0.24, 0]} material={z > 0.3 ? mat.red : mat.lift}>
              <cylinderGeometry args={[0.03, 0.03, 0.06, 10]} />
            </mesh>
          </group>
        ))}
        {[-0.9, -0.2, 0.5].map((z) => (
          <RoundedBox
            key={z}
            args={[0.26, 0.22, 0.34]}
            radius={0.02}
            bevelSegments={1}
            smoothness={1}
            position={[0, 2.28, z]}
            material={mat.wood}
          />
        ))}
      </group>

      {/* Tire stacks, compressor and a spare wheel on the wall */}
      {(
        [
          [-6.9, -6.5],
          [-6.9, -5.4],
          [6.7, -5.4],
        ] as const
      ).map(([x, z]) => (
        <group key={`${x}-${z}`} position={[x, 0, z]}>
          {(x < 0 ? [0, 1, 2] : [0, 1, 2, 3]).map((i) => (
            <mesh
              key={i}
              position={[0, 0.12 + i * 0.25, 0]}
              rotation-x={Math.PI / 2}
              material={mat.tire}
              castShadow
            >
              <torusGeometry args={[0.3, 0.12, 8, 16]} />
            </mesh>
          ))}
        </group>
      ))}
      <group position={[7.1, 0, -4.45]} rotation-y={-Math.PI / 2}>
        <mesh position={[0, 0.26, 0]} rotation-z={Math.PI / 2} material={mat.redDark}>
          <cylinderGeometry args={[0.24, 0.24, 0.85, 18]} />
        </mesh>
        <RoundedBox
          args={[0.34, 0.3, 0.3]}
          radius={0.04}
          bevelSegments={2}
          smoothness={2}
          position={[0, 0.66, 0]}
          material={mat.steel}
        />
        {[-0.25, 0.25].map((dx) => (
          <mesh key={dx} position={[dx, 0.06, 0]} rotation-x={Math.PI / 2} material={mat.tire}>
            <cylinderGeometry args={[0.08, 0.08, 0.05, 12]} />
          </mesh>
        ))}
      </group>
      <group position={[4.4, 1.75, -7.38]}>
        <mesh material={mat.tire}>
          <torusGeometry args={[0.27, 0.1, 8, 18]} />
        </mesh>
        <mesh position-z={-0.02} material={mat.steel}>
          <cylinderGeometry args={[0.2, 0.2, 0.05, 18]} />
        </mesh>
      </group>
      {[1.25, 1.55].map((y) => (
        <mesh key={y} position={[6.2, y, -7.4]} rotation-z={Math.PI / 2} material={mat.steel}>
          <cylinderGeometry args={[0.045, 0.045, 1.7, 10]} />
        </mesh>
      ))}

      {/* Crates, jerry cans and the floor jack */}
      <group position={[5.0, 0, -5.9]}>
        <RoundedBox
          args={[0.72, 0.36, 0.5]}
          radius={0.02}
          bevelSegments={1}
          smoothness={1}
          position={[0, 0.18, 0]}
          material={mat.wood}
          castShadow
        />
        <RoundedBox
          args={[0.72, 0.36, 0.5]}
          radius={0.02}
          bevelSegments={1}
          smoothness={1}
          position={[0.06, 0.54, 0.05]}
          material={mat.wood}
          castShadow
        />
        <RoundedBox
          args={[0.6, 0.3, 0.42]}
          radius={0.02}
          bevelSegments={1}
          smoothness={1}
          position={[-0.05, 0.87, -0.04]}
          material={mat.red}
          castShadow
        />
      </group>
      {[-6.62, -6.32].map((z) => (
        <group key={z} position={[7.16, 0, z]} rotation-y={-Math.PI / 2}>
          <RoundedBox
            args={[0.2, 0.42, 0.34]}
            radius={0.03}
            bevelSegments={2}
            smoothness={2}
            position={[0, 0.21, 0]}
            material={mat.red}
            castShadow
          />
          <RoundedBox
            args={[0.06, 0.05, 0.26]}
            radius={0.015}
            bevelSegments={1}
            smoothness={1}
            position={[0, 0.44, 0]}
            material={mat.redDark}
          />
        </group>
      ))}
      <group position={[7.1, 0, 0.3]} rotation-y={Math.PI / 2}>
        <RoundedBox
          args={[0.55, 0.08, 0.26]}
          radius={0.02}
          bevelSegments={1}
          smoothness={1}
          position={[0, 0.05, 0]}
          material={mat.red}
          castShadow
        />
        <RoundedBox
          args={[0.5, 0.06, 0.14]}
          radius={0.02}
          bevelSegments={1}
          smoothness={1}
          position={[0.05, 0.16, 0]}
          rotation-z={0.16}
          material={mat.steel}
        />
        <RoundedBox
          args={[0.14, 0.05, 0.16]}
          radius={0.015}
          bevelSegments={1}
          smoothness={1}
          position={[0.28, 0.23, 0]}
          material={mat.steel}
        />
        <mesh position={[-0.32, 0.38, 0]} rotation-z={1.15} material={mat.redDark}>
          <cylinderGeometry args={[0.02, 0.02, 1.05, 10]} />
        </mesh>
      </group>

      {/* More of the shop: a spare engine on its stand, a gearbox waiting for a
          car, a bucket seat, tools and the usual wall dressing. A real workshop
          is cluttered with the work — neatly, not spread over the floor. */}
      <group position={[-7.0, 0, 2.4]}>
        {/* Engine stand */}
        <RoundedBox args={[0.1, 1.0, 0.1]} radius={0.02} bevelSegments={1} smoothness={1} position={[-0.28, 0.5, 0]} material={mat.steel} />
        <RoundedBox args={[0.1, 1.0, 0.1]} radius={0.02} bevelSegments={1} smoothness={1} position={[0.28, 0.5, 0]} material={mat.steel} />
        <RoundedBox args={[0.7, 0.06, 0.5]} radius={0.02} bevelSegments={1} smoothness={1} position={[0, 0.03, 0]} material={mat.redDark} />
        <RoundedBox args={[0.08, 0.08, 0.5]} radius={0.02} bevelSegments={1} smoothness={1} position={[-0.28, 0.3, 0]} material={mat.steel} />
        <RoundedBox args={[0.5, 0.06, 0.4]} radius={0.02} bevelSegments={1} smoothness={1} position={[0, 0.56, 0]} material={mat.steel} />
        {/* The block itself */}
        <RoundedBox args={[0.46, 0.4, 0.4]} radius={0.05} bevelSegments={2} smoothness={2} position={[0, 0.79, 0]} material={mat.redDark} castShadow />
        <RoundedBox args={[0.42, 0.16, 0.34]} radius={0.04} bevelSegments={2} smoothness={2} position={[0, 1.05, 0.02]} material={mat.steel} />
        {[-0.1, 0.1].map((z) => (
          <mesh key={z} position={[0, 1.17, z]} rotation-z={Math.PI / 2} material={mat.steel}>
            <cylinderGeometry args={[0.05, 0.05, 0.36, 12]} />
          </mesh>
        ))}
        <mesh position={[0.25, 0.9, 0]} rotation-z={Math.PI / 2} material={mat.tool}>
          <cylinderGeometry args={[0.09, 0.09, 0.1, 14]} />
        </mesh>
      </group>
      <group position={[7.05, 0, -3.2]} rotation-y={-1.2}>
        <mesh position={[0, 0.19, 0]} rotation-z={Math.PI / 2} material={mat.steel} castShadow>
          <cylinderGeometry args={[0.19, 0.19, 0.24, 16]} />
        </mesh>
        <RoundedBox args={[0.36, 0.3, 0.28]} radius={0.05} bevelSegments={2} smoothness={2} position={[0.3, 0.2, 0]} material={mat.redDark} castShadow />
        <mesh position={[0.58, 0.2, 0]} rotation-z={Math.PI / 2} material={mat.steel}>
          <cylinderGeometry args={[0.06, 0.06, 0.3, 12]} />
        </mesh>
        <mesh position={[0.32, 0.44, 0]} rotation-z={0.3} material={mat.tire}>
          <cylinderGeometry args={[0.02, 0.02, 0.26, 8]} />
        </mesh>
      </group>
      {/* Bucket seat waiting its turn */}
      <group position={[3.5, 0, -6.8]} rotation-y={-0.5}>
        <RoundedBox args={[0.52, 0.14, 0.5]} radius={0.04} bevelSegments={2} smoothness={2} position={[0, 0.09, 0]} material={mat.redDark} castShadow />
        <RoundedBox args={[0.46, 0.06, 0.42]} radius={0.03} bevelSegments={2} smoothness={2} position={[0, 0.18, 0.03]} material={mat.red} />
        <RoundedBox
          args={[0.52, 0.74, 0.14]}
          radius={0.05}
          bevelSegments={2}
          smoothness={2}
          position={[0, 0.52, -0.22]}
          rotation-x={-0.2}
          material={mat.red}
          castShadow
        />
        {[-0.26, 0.26].map((x) => (
          <RoundedBox
            key={x}
            args={[0.1, 0.58, 0.2]}
            radius={0.04}
            bevelSegments={2}
            smoothness={2}
            position={[x, 0.5, -0.2]}
            rotation-x={-0.2}
            material={mat.redDark}
          />
        ))}
        {[-0.2, 0.2].map((x) => (
          <RoundedBox key={x} args={[0.06, 0.1, 0.4]} radius={0.02} bevelSegments={1} smoothness={1} position={[x, 0.05, 0]} material={mat.steel} />
        ))}
      </group>
      {/* Rolling tool cart, battery on charge, drained pan and spare discs */}
      <group position={[-7.0, 0, -4.9]} rotation-y={Math.PI / 2}>
        <RoundedBox args={[0.58, 0.82, 0.44]} radius={0.04} bevelSegments={2} smoothness={2} position={[0, 0.47, 0]} material={mat.redDark} castShadow />
        <RoundedBox args={[0.62, 0.05, 0.48]} radius={0.02} bevelSegments={1} smoothness={1} position={[0, 0.9, 0]} material={mat.steel} />
        {[0.25, 0.5, 0.75].map((y) => (
          <group key={y}>
            <RoundedBox args={[0.48, 0.18, 0.04]} radius={0.012} bevelSegments={1} smoothness={1} position={[0, y, 0.23]} material={mat.red} />
            <RoundedBox args={[0.26, 0.022, 0.03]} radius={0.01} bevelSegments={1} smoothness={1} position={[0, y, 0.26]} material={mat.steel} />
          </group>
        ))}
        <RoundedBox args={[0.04, 0.05, 0.36]} radius={0.015} bevelSegments={1} smoothness={1} position={[0.33, 0.84, 0]} material={mat.steel} />
        {[-0.24, 0.24].map((x) =>
          [-0.18, 0.18].map((z) => (
            <mesh key={`${x}-${z}`} position={[x, 0.05, z]} rotation-z={Math.PI / 2} material={mat.tire}>
              <cylinderGeometry args={[0.05, 0.05, 0.03, 10]} />
            </mesh>
          )),
        )}
        {/* Tools left on the tray */}
        <RoundedBox args={[0.16, 0.04, 0.06]} radius={0.01} bevelSegments={1} smoothness={1} position={[-0.12, 0.95, 0.1]} material={mat.tool} />
        <RoundedBox args={[0.1, 0.05, 0.1]} radius={0.01} bevelSegments={1} smoothness={1} position={[0.14, 0.95, -0.08]} material={mat.steel} />
      </group>
      <group position={[7.1, 0, -1.4]} rotation-y={Math.PI}>
        <RoundedBox args={[0.34, 0.22, 0.2]} radius={0.02} bevelSegments={1} smoothness={1} position={[0, 0.11, 0]} material={mat.redDark} castShadow />
        {[-0.09, 0.09].map((x) => (
          <mesh key={x} position={[x, 0.24, 0]} material={mat.tool}>
            <cylinderGeometry args={[0.02, 0.02, 0.05, 8]} />
          </mesh>
        ))}
        <RoundedBox args={[0.2, 0.14, 0.16]} radius={0.02} bevelSegments={1} smoothness={1} position={[0.38, 0.07, 0]} material={mat.steel} />
        <RoundedBox args={[0.24, 0.015, 0.025]} radius={0.006} bevelSegments={1} smoothness={1} position={[0.19, 0.05, 0.04]} material={mat.red} />
        {[0.09, 0.31].map((x, i) => (
          <RoundedBox
            key={x}
            args={[0.04, 0.03, 0.03]}
            radius={0.008}
            bevelSegments={1}
            smoothness={1}
            position={[x, i === 0 ? 0.27 : 0.16, 0.04]}
            material={mat.tool}
          />
        ))}
      </group>
      <group position={[6.3, 0, -6.7]}>
        <RoundedBox args={[0.92, 0.1, 0.56]} radius={0.03} bevelSegments={1} smoothness={1} position={[0, 0.05, 0]} material={mat.redDark} />
        <RoundedBox args={[0.74, 0.03, 0.4]} radius={0.01} bevelSegments={1} smoothness={1} position={[0, 0.1, 0]} material={mat.tire} />
      </group>
      <group position={[-7.15, 0, 0.35]}>
        {[0, 1, 2].map((i) => (
          <mesh key={i} position={[0, 0.0175 + i * 0.036, 0]} material={mat.steel}>
            <cylinderGeometry args={[0.16, 0.16, 0.035, 20]} />
          </mesh>
        ))}
        <RoundedBox args={[0.1, 0.14, 0.09]} radius={0.02} bevelSegments={1} smoothness={1} position={[0.22, 0.07, 0]} material={mat.red} />
      </group>

      {/* Filling the bay: the engine crane parked in the front corner, drums
          against the front wall, a loose tire, cones, a crate stack and the
          rubber mat in front of the bench. */}
      <group position={[-6.35, 0, 6.05]} rotation-y={-0.8}>
        {[-0.24, 0.24].map((x) => (
          <RoundedBox key={x} args={[0.07, 0.07, 1.4]} radius={0.02} bevelSegments={1} smoothness={1} position={[x, 0.07, 0]} material={mat.lift} />
        ))}
        <RoundedBox args={[0.52, 0.07, 0.09]} radius={0.02} bevelSegments={1} smoothness={1} position={[0, 0.07, 0.62]} material={mat.lift} />
        {(
          [
            [-0.24, -0.64],
            [0.24, -0.64],
            [-0.24, 0.64],
            [0.24, 0.64],
          ] as const
        ).map(([wx, wz]) => (
          <mesh key={`${wx}-${wz}`} position={[wx, 0.06, wz]} rotation-z={Math.PI / 2} material={mat.tire}>
            <cylinderGeometry args={[0.065, 0.065, 0.05, 12]} />
          </mesh>
        ))}
        <RoundedBox args={[0.14, 1.75, 0.14]} radius={0.025} bevelSegments={1} smoothness={1} position={[0, 0.95, 0.5]} material={mat.lift} castShadow />
        <RoundedBox
          args={[0.1, 0.12, 1.7]}
          radius={0.02}
          bevelSegments={1}
          smoothness={1}
          position={[0, 1.62, -0.22]}
          rotation-x={0.26}
          material={mat.lift}
          castShadow
        />
        <RoundedBox
          args={[0.07, 1.3, 0.07]}
          radius={0.02}
          bevelSegments={1}
          smoothness={1}
          position={[0, 1.02, 0.1]}
          rotation-x={-0.65}
          material={mat.steel}
        />
        <mesh position={[0, 1.55, -1.0]} material={mat.steel}>
          <cylinderGeometry args={[0.014, 0.014, 0.5, 8]} />
        </mesh>
        <mesh position={[0, 1.26, -1.0]} material={mat.steel}>
          <torusGeometry args={[0.05, 0.014, 8, 16]} />
        </mesh>
        <RoundedBox
          args={[0.05, 0.05, 0.45]}
          radius={0.015}
          bevelSegments={1}
          smoothness={1}
          position={[0, 1.1, 0.78]}
          rotation-x={-0.5}
          material={mat.steel}
        />
      </group>

      {/* Tire changer bolted to the front wall, right beside the crane */}
      <group position={[-3.55, 0, 6.78]}>
        <RoundedBox args={[0.72, 0.92, 0.6]} radius={0.04} bevelSegments={2} smoothness={2} position={[0, 0.46, 0]} material={mat.cabinet} castShadow />
        <RoundedBox args={[0.78, 0.06, 0.64]} radius={0.02} bevelSegments={1} smoothness={1} position={[0, 0.95, 0]} material={mat.steel} />
        <mesh position={[0, 1.0, 0]} material={mat.steel}>
          <cylinderGeometry args={[0.3, 0.3, 0.07, 22]} />
        </mesh>
        <mesh position={[0, 1.04, 0]} rotation-x={Math.PI / 2} material={mat.tire}>
          <torusGeometry args={[0.26, 0.09, 8, 20]} />
        </mesh>
        <RoundedBox args={[0.11, 1.55, 0.11]} radius={0.02} bevelSegments={1} smoothness={1} position={[0.37, 1.4, -0.12]} material={mat.cabinet} castShadow />
        <RoundedBox args={[0.11, 0.11, 0.8]} radius={0.02} bevelSegments={1} smoothness={1} position={[0.37, 2.12, 0.22]} material={mat.steel} />
        <mesh position={[0.37, 1.98, 0.58]} rotation-z={Math.PI / 2} material={mat.tool}>
          <cylinderGeometry args={[0.035, 0.035, 0.3, 10]} />
        </mesh>
        {(
          [
            [-0.27, -0.23],
            [0.27, -0.23],
            [-0.27, 0.23],
            [0.27, 0.23],
          ] as const
        ).map(([wx, wz]) => (
          <mesh key={`${wx}-${wz}`} position={[wx, 0.05, wz]} rotation-z={Math.PI / 2} material={mat.tire}>
            <cylinderGeometry args={[0.06, 0.06, 0.05, 12]} />
          </mesh>
        ))}
      </group>

      {/* Traffic cones lined up along the front wall */}
      {[-1.9, -1.4, -0.9].map((cx) => (
        <group key={cx} position={[cx, 0, 6.9]}>
          <RoundedBox args={[0.36, 0.04, 0.36]} radius={0.012} bevelSegments={1} smoothness={1} position={[0, 0.02, 0]} material={mat.lift} />
          <mesh position={[0, 0.29, 0]} material={mat.lift}>
            <cylinderGeometry args={[0.035, 0.17, 0.52, 14]} />
          </mesh>
          <mesh position={[0, 0.3, 0]} material={mat.tire}>
            <cylinderGeometry args={[0.11, 0.125, 0.09, 14]} />
          </mesh>
        </group>
      ))}

      {/* A/C service station on the front wall */}
      <group position={[3.3, 0, 6.85]}>
        <RoundedBox args={[0.66, 1.18, 0.54]} radius={0.05} bevelSegments={2} smoothness={2} position={[0, 0.65, 0]} material={mat.cabinet} castShadow />
        <RoundedBox args={[0.6, 0.34, 0.04]} radius={0.02} bevelSegments={1} smoothness={1} position={[0, 1.04, 0.29]} material={mat.drawer} />
        {[-0.17, 0, 0.17].map((dx) => (
          <mesh key={dx} position={[dx, 1.04, 0.32]} rotation-x={Math.PI / 2} material={mat.steel}>
            <cylinderGeometry args={[0.06, 0.06, 0.03, 14]} />
          </mesh>
        ))}
        {[-0.15, 0.15].map((dx) => (
          <mesh key={dx} position={[dx, 0.44, 0.31]} material={mat.tire}>
            <torusGeometry args={[0.14, 0.028, 8, 20]} />
          </mesh>
        ))}
        {(
          [
            [-0.28, -0.24],
            [0.28, -0.24],
            [-0.28, 0.24],
            [0.28, 0.24],
          ] as const
        ).map(([wx, wz]) => (
          <mesh key={`${wx}-${wz}`} position={[wx, 0.05, wz]} rotation-z={Math.PI / 2} material={mat.tire}>
            <cylinderGeometry args={[0.06, 0.06, 0.05, 12]} />
          </mesh>
        ))}
      </group>

      {/* Drums lined up in a row against the front wall */}
      {[5.9, 6.5, 7.1].map((dx, i) => (
        <group key={dx} position={[dx, 0, 7.05]}>
          <mesh position={[0, 0.44, 0]} material={i === 1 ? mat.redDark : mat.lift} castShadow>
            <cylinderGeometry args={[0.29, 0.29, 0.88, 20]} />
          </mesh>
          {[0.24, 0.64].map((y) => (
            <mesh key={y} position={[0, y, 0]} material={mat.steel}>
              <torusGeometry args={[0.29, 0.022, 8, 22]} />
            </mesh>
          ))}
          <mesh position={[0, 0.88, 0]} material={mat.steel}>
            <cylinderGeometry args={[0.06, 0.06, 0.03, 12]} />
          </mesh>
        </group>
      ))}

      {/* Spare wheel parked against the right wall */}
      <group position={[7.22, 0.41, 5.3]} rotation-z={-0.16}>
        <mesh rotation-y={Math.PI / 2} material={mat.tire} castShadow>
          <torusGeometry args={[0.3, 0.12, 10, 22]} />
        </mesh>
      </group>

      {/* Bucket and mop beside the tool cart */}
      <group position={[-6.8, 0, -4.2]}>
        <mesh position={[0, 0.16, 0]} material={mat.lift} castShadow>
          <cylinderGeometry args={[0.15, 0.12, 0.32, 16]} />
        </mesh>
        <mesh position={[0.22, 0.62, 0]} rotation-z={-0.22} material={mat.wood}>
          <cylinderGeometry args={[0.015, 0.015, 1.3, 8]} />
        </mesh>
        <RoundedBox args={[0.12, 0.09, 0.22]} radius={0.02} bevelSegments={1} smoothness={1} position={[0.36, 0.05, 0]} material={mat.tire} />
      </group>

      {/* Axle stands squared up beside the lift */}
      {[-0.95, 0.95].map((sz) => (
        <group key={sz} position={[3.05, 0, sz]}>
          <RoundedBox args={[0.36, 0.06, 0.36]} radius={0.02} bevelSegments={1} smoothness={1} position={[0, 0.03, 0]} material={mat.steel} />
          <RoundedBox args={[0.13, 0.56, 0.13]} radius={0.02} bevelSegments={1} smoothness={1} position={[0, 0.32, 0]} material={mat.lift} castShadow />
          <RoundedBox args={[0.3, 0.06, 0.12]} radius={0.02} bevelSegments={1} smoothness={1} position={[0, 0.62, 0]} material={mat.lift} />
          <RoundedBox args={[0.16, 0.05, 0.05]} radius={0.01} bevelSegments={1} smoothness={1} position={[0.12, 0.5, 0]} material={mat.steel} />
        </group>
      ))}

      {/* Hydraulic press standing against the right wall */}
      <group position={[7.0, 0, 2.6]} rotation-y={-Math.PI / 2}>
        <RoundedBox args={[0.62, 0.09, 0.8]} radius={0.02} bevelSegments={1} smoothness={1} position={[0, 0.045, 0]} material={mat.steel} />
        {[-0.3, 0.3].map((dz) => (
          <RoundedBox key={dz} args={[0.13, 2.0, 0.13]} radius={0.02} bevelSegments={1} smoothness={1} position={[0, 1.05, dz]} material={mat.steel} castShadow />
        ))}
        <RoundedBox args={[0.5, 0.16, 0.78]} radius={0.03} bevelSegments={1} smoothness={1} position={[0, 2.02, 0]} material={mat.redDark} castShadow />
        <mesh position={[0, 1.6, 0]} material={mat.steel}>
          <cylinderGeometry args={[0.09, 0.09, 0.62, 14]} />
        </mesh>
        <RoundedBox args={[0.52, 0.1, 0.7]} radius={0.03} bevelSegments={1} smoothness={1} position={[0, 0.98, 0]} material={mat.red} castShadow />
        <mesh position={[0, 1.22, 0]} material={mat.tool}>
          <cylinderGeometry args={[0.07, 0.07, 0.34, 14]} />
        </mesh>
        <RoundedBox args={[0.06, 0.5, 0.14]} radius={0.02} bevelSegments={1} smoothness={1} position={[0.26, 1.5, 0]} material={mat.tool} />
      </group>

      {/* Wheel rack up on the right wall */}
      <group position={[7.36, 2.62, -5.55]}>
        <RoundedBox args={[0.07, 0.07, 2.3]} radius={0.02} bevelSegments={1} smoothness={1} material={mat.steel} />
        {[-0.9, -0.3, 0.3, 0.9].map((dz) => (
          <mesh key={dz} position={[-0.04, -0.38, dz]} rotation-y={Math.PI / 2} material={mat.tire} castShadow>
            <torusGeometry args={[0.28, 0.1, 8, 18]} />
          </mesh>
        ))}
      </group>

      {/* Parts washer on the back wall */}
      <group position={[4.7, 0, -6.95]}>
        {(
          [
            [-0.33, -0.24],
            [0.33, -0.24],
            [-0.33, 0.24],
            [0.33, 0.24],
          ] as const
        ).map(([lx, lz]) => (
          <RoundedBox key={`${lx}-${lz}`} args={[0.06, 0.6, 0.06]} radius={0.015} bevelSegments={1} smoothness={1} position={[lx, 0.3, lz]} material={mat.steel} />
        ))}
        <RoundedBox args={[0.8, 0.4, 0.6]} radius={0.03} bevelSegments={2} smoothness={2} position={[0, 0.8, 0]} material={mat.steel} castShadow />
        <RoundedBox args={[0.74, 0.08, 0.54]} radius={0.02} bevelSegments={1} smoothness={1} position={[0, 1.02, 0]} material={mat.red} />
        <RoundedBox args={[0.72, 0.04, 0.5]} radius={0.01} bevelSegments={1} smoothness={1} position={[0, 1.08, 0]} rotation-x={-0.09} material={mat.redDark} />
        <mesh position={[0.44, 0.7, 0.26]} material={mat.tire}>
          <cylinderGeometry args={[0.02, 0.02, 0.7, 8]} />
        </mesh>
        <RoundedBox args={[0.16, 0.1, 0.12]} radius={0.02} bevelSegments={1} smoothness={1} position={[0.44, 1.02, 0.26]} material={mat.tool} />
      </group>

      <group position={[-7.18, 0, 0.78]}>
        <RoundedBox args={[0.46, 0.34, 0.42]} radius={0.02} bevelSegments={1} smoothness={1} position={[0, 0.17, 0]} material={mat.wood} castShadow />
        <RoundedBox args={[0.38, 0.28, 0.36]} radius={0.02} bevelSegments={1} smoothness={1} position={[0.03, 0.48, 0.02]} material={mat.wood} castShadow />
        <RoundedBox args={[0.3, 0.24, 0.3]} radius={0.02} bevelSegments={1} smoothness={1} position={[-0.02, 0.74, -0.01]} material={mat.redDark} castShadow />
      </group>

      <mesh position={[-6.2, 0.012, -2.4]} material={mat.tire}>
        <boxGeometry args={[2.4, 0.024, 0.95]} />
      </mesh>

      {/* Wall dressing: spare hood on the left, wheel and helmets on the right,
          clock and posters on the back — the shop reads busy but ordered. */}
      <group position={[-7.3, 0.72, 4.4]} rotation-z={0.2}>
        <RoundedBox args={[0.06, 1.5, 1.2]} radius={0.03} bevelSegments={2} smoothness={2} material={mat.redDark} castShadow />
      </group>
      <group position={[7.42, 1.9, 1.6]} rotation-y={Math.PI / 2}>
        <mesh material={mat.tire} castShadow>
          <torusGeometry args={[0.19, 0.03, 10, 24]} />
        </mesh>
        <mesh rotation-x={Math.PI / 2} material={mat.steel}>
          <cylinderGeometry args={[0.045, 0.045, 0.05, 12]} />
        </mesh>
        {[0, Math.PI / 3, -Math.PI / 3].map((a) => (
          <RoundedBox key={a} args={[0.32, 0.03, 0.02]} radius={0.008} bevelSegments={1} smoothness={1} rotation-z={a} material={mat.steel} />
        ))}
      </group>
      {(
        [
          [-3.9, "#e8e8e8"],
          [-3.4, "#b3261e"],
          [-2.9, "#d1aa2b"],
        ] as const
      ).map(([z]) => (
        <mesh key={z} position={[7.38, 2.27, z]} scale={[1, 0.85, 1]} material={z === -3.4 ? mat.red : z === -2.9 ? mat.lift : mat.white} castShadow>
          <sphereGeometry args={[0.12, 16, 12]} />
        </mesh>
      ))}
      <group position={[7.41, 0.95, 0.4]}>
        <mesh material={mat.red}>
          <cylinderGeometry args={[0.065, 0.065, 0.38, 14]} />
        </mesh>
        <RoundedBox args={[0.1, 0.06, 0.1]} radius={0.02} bevelSegments={1} smoothness={1} position={[0, 0.22, 0]} material={mat.tire} />
        <RoundedBox args={[0.03, 0.16, 0.03]} radius={0.01} bevelSegments={1} smoothness={1} position={[-0.08, 0.1, 0]} material={mat.tire} />
      </group>
      <group position={[0, 3.35, -7.42]}>
        <mesh rotation-x={Math.PI / 2} material={mat.white}>
          <cylinderGeometry args={[0.21, 0.21, 0.05, 24]} />
        </mesh>
        <mesh material={mat.redDark}>
          <torusGeometry args={[0.21, 0.022, 8, 28]} />
        </mesh>
        <RoundedBox args={[0.02, 0.13, 0.012]} radius={0.005} bevelSegments={1} smoothness={1} position={[0, 0.05, 0.03]} material={mat.tire} />
        <RoundedBox args={[0.02, 0.09, 0.012]} radius={0.005} bevelSegments={1} smoothness={1} position={[0.04, 0, 0.03]} rotation-z={-Math.PI / 2} material={mat.tire} />
      </group>
      <group position={[7.44, 2.3, 3.9]} rotation-y={-Math.PI / 2}>
        <RoundedBox args={[0.95, 1.25, 0.02]} radius={0.02} bevelSegments={1} smoothness={1} material={mat.red} />
        <RoundedBox args={[0.95, 0.2, 0.03]} radius={0.01} bevelSegments={1} smoothness={1} position={[0, -0.42, 0]} material={mat.white} />
      </group>
      <group position={[6.7, 2.2, -7.44]}>
        <RoundedBox args={[0.9, 1.1, 0.02]} radius={0.02} bevelSegments={1} smoothness={1} material={mat.white} />
        <RoundedBox args={[0.9, 0.22, 0.03]} radius={0.01} bevelSegments={1} smoothness={1} position={[0, 0.3, 0]} material={mat.red} />
      </group>

      {/* Air line and drop light hanging from the roof */}
      <group position={[-2.6, 4.44, 1.6]}>
        <RoundedBox args={[0.14, 0.16, 0.14]} radius={0.02} bevelSegments={1} smoothness={1} position={[0, 0.1, 0]} material={mat.steel} />
        <mesh rotation-z={Math.PI / 2} material={mat.redDark}>
          <cylinderGeometry args={[0.16, 0.16, 0.14, 18]} />
        </mesh>
        <mesh rotation-y={Math.PI / 2} material={mat.tire}>
          <torusGeometry args={[0.19, 0.022, 8, 26]} />
        </mesh>
        <mesh position={[0.19, -0.42, 0]} material={mat.tire}>
          <cylinderGeometry args={[0.02, 0.02, 0.7, 8]} />
        </mesh>
        <RoundedBox args={[0.05, 0.12, 0.05]} radius={0.015} bevelSegments={1} smoothness={1} position={[0.19, -0.86, 0]} material={mat.steel} />
      </group>
      <group position={[2.3, 4.1, 1.4]}>
        <RoundedBox
          args={[0.18, 0.05, 0.18]}
          radius={0.015}
          bevelSegments={1}
          smoothness={1}
          position={[0, 0.475, 0]}
          material={mat.steel}
        />
        <mesh material={mat.tire}>
          <cylinderGeometry args={[0.018, 0.018, 1.0, 8]} />
        </mesh>
        <mesh position={[0, -0.62, 0]} material={mat.redDark}>
          <cylinderGeometry args={[0.1, 0.06, 0.14, 14]} />
        </mesh>
        <mesh position={[0, -0.71, 0]} material={mat.lamp}>
          <sphereGeometry args={[0.05, 12, 10]} />
        </mesh>
      </group>

      {/* Roof steel: four beams bridging the bay with hanger plates — the
          industrial ceiling the reference bay has. */}
      {[-4.6, -1.6, 1.6, 4.6].map((x) => (
        <group key={x}>
          <RoundedBox args={[0.14, 0.24, 15.2]} radius={0.02} bevelSegments={1} smoothness={1} position={[x, 4.46, 0]} material={mat.steel} />
          {[-5.6, -2.8, 0, 2.8, 5.6].map((z) => (
            <RoundedBox
              key={z}
              args={[0.32, 0.12, 0.05]}
              radius={0.012}
              bevelSegments={1}
              smoothness={1}
              position={[x, 4.3, z]}
              material={mat.steel}
            />
          ))}
        </group>
      ))}

      {/* Overhead lights: a canopy plate bolted to the ceiling and a short
          pendant — mounted, never dangling on a thread. */}
      {[-3.2, 0, 3.2].map((x) => (
        <group key={x}>
          <RoundedBox
            args={[0.4, 0.05, 0.26]}
            radius={0.015}
            bevelSegments={1}
            smoothness={1}
            position={[x, 4.575, 0]}
            material={mat.steel}
          />
          <RoundedBox
            args={[0.07, 0.09, 0.07]}
            radius={0.015}
            bevelSegments={1}
            smoothness={1}
            position={[x, 4.51, 0]}
            material={mat.steel}
          />
          <RoundedBox
            args={[1.5, 0.1, 0.3]}
            radius={0.03}
            bevelSegments={1}
            smoothness={1}
            position={[x, 4.42, 0]}
            material={mat.steel}
          />
          <RoundedBox
            args={[1.42, 0.035, 0.24]}
            radius={0.012}
            bevelSegments={1}
            smoothness={1}
            position={[x, 4.36, 0]}
            material={mat.lamp}
          />
        </group>
      ))}
      {/* The key light of the bay: a warm cone from the centre fixture that
          drops real shadows under the car, the lift and every bench. */}
      <spotLight
        position={[0, 4.32, 0]}
        angle={1.08}
        penumbra={0.7}
        intensity={32}
        distance={17}
        color="#fff3de"
        castShadow
        shadow-mapSize-width={1536}
        shadow-mapSize-height={1536}
        shadow-bias={-0.0016}
        shadow-normalBias={0.03}
        shadow-camera-near={0.5}
        shadow-camera-far={17}
      />
      {/* A mechanic's stool and a broom leaning by the left wall */}
      <group position={[-6.8, 0, 3.6]} rotation-y={0.4}>
        <mesh position={[0, 0.44, 0]} material={mat.redDark} castShadow>
          <cylinderGeometry args={[0.17, 0.17, 0.05, 18]} />
        </mesh>
        {(
          [
            [0.11, 0.11],
            [-0.11, 0.11],
            [0.11, -0.11],
            [-0.11, -0.11],
          ] as const
        ).map(([lx, lz]) => (
          <mesh key={`${lx}-${lz}`} position={[lx, 0.22, lz]} material={mat.steel}>
            <cylinderGeometry args={[0.018, 0.018, 0.44, 8]} />
          </mesh>
        ))}
      </group>
      <group position={[-7.25, 0.65, 5.5]}>
        <mesh rotation-z={0.28} material={mat.wood}>
          <cylinderGeometry args={[0.015, 0.015, 1.3, 8]} />
        </mesh>
        <RoundedBox
          args={[0.1, 0.12, 0.26]}
          radius={0.02}
          bevelSegments={1}
          smoothness={1}
          position={[0.18, -0.62, 0]}
          rotation-z={0.28}
          material={mat.redDark}
        />
      </group>

      {/* More wall dressing: a locker on the left; cabinet, fan and spray kit
          on the right — both side walls carry their share of the shop. */}
      <group position={[-7.05, 0, 1.6]}>
        <RoundedBox args={[0.56, 1.92, 1.15]} radius={0.03} bevelSegments={2} smoothness={2} position={[0, 0.97, 0]} material={mat.cabinet} castShadow />
        {[-0.29, 0.29].map((dz) => (
          <group key={dz}>
            <RoundedBox args={[0.05, 1.8, 0.53]} radius={0.01} bevelSegments={1} smoothness={1} position={[0.3, 0.97, dz]} material={mat.drawer} />
            <RoundedBox args={[0.04, 0.22, 0.035]} radius={0.01} bevelSegments={1} smoothness={1} position={[0.34, 0.97, dz + 0.19]} material={mat.steel} />
          </group>
        ))}
      </group>
      <group position={[-7.42, 1.6, 6.6]}>
        <mesh rotation-y={Math.PI / 2} material={mat.tire}>
          <torusGeometry args={[0.16, 0.02, 8, 22]} />
        </mesh>
        <RoundedBox args={[0.03, 0.12, 0.03]} radius={0.01} bevelSegments={1} smoothness={1} position={[0, 0.24, 0]} material={mat.steel} />
      </group>
      <group position={[7.15, 2.5, 1.3]}>
        <RoundedBox args={[0.5, 0.95, 1.5]} radius={0.03} bevelSegments={2} smoothness={2} material={mat.cabinet} castShadow />
        {[-0.37, 0.37].map((dz) => (
          <group key={dz}>
            <RoundedBox args={[0.05, 0.83, 0.7]} radius={0.01} bevelSegments={1} smoothness={1} position={[-0.27, 0, dz]} material={mat.drawer} />
            <RoundedBox args={[0.04, 0.06, 0.2]} radius={0.01} bevelSegments={1} smoothness={1} position={[-0.31, 0, dz + 0.2]} material={mat.steel} />
          </group>
        ))}
      </group>
      <group position={[7.42, 3.4, 4.5]}>
        <mesh rotation-z={Math.PI / 2} material={mat.steel}>
          <cylinderGeometry args={[0.3, 0.3, 0.04, 20]} />
        </mesh>
        {[0, 2.1, 4.2].map((a) => (
          <mesh key={a} position={[-0.05, Math.cos(a) * 0.15, Math.sin(a) * 0.15]} rotation-x={a} material={mat.tire}>
            <boxGeometry args={[0.02, 0.22, 0.08]} />
          </mesh>
        ))}
        <mesh position={[-0.06, 0, 0]} rotation-z={Math.PI / 2} material={mat.tool}>
          <cylinderGeometry args={[0.05, 0.05, 0.07, 12]} />
        </mesh>
      </group>
      <group position={[7.4, 1.5, 6.0]}>
        <RoundedBox args={[0.05, 0.13, 0.1]} radius={0.015} bevelSegments={1} smoothness={1} material={mat.tool} />
        <mesh position={[-0.04, 0.05, -0.06]} rotation-x={Math.PI / 2} material={mat.steel}>
          <cylinderGeometry args={[0.016, 0.016, 0.07, 8]} />
        </mesh>
        <mesh position={[0, -0.11, 0.01]} material={mat.steel}>
          <cylinderGeometry args={[0.04, 0.03, 0.1, 10]} />
        </mesh>
      </group>
      <group position={[7.4, 1.05, 6.45]}>
        <mesh rotation-y={Math.PI / 2} material={mat.tire}>
          <torusGeometry args={[0.2, 0.022, 8, 26]} />
        </mesh>
      </group>

      {/* Lift arms under car */}
      {/* The two-post lift: the one big machine that belongs centre stage. */}
      <group>
        {[-1.85, 1.85].map((x) => (
          <group key={x}>
            <RoundedBox
              args={[0.22, 2.28, 0.3]}
              radius={0.04}
              bevelSegments={2}
              smoothness={2}
              position={[x, 1.16, 0]}
              material={mat.lift}
              castShadow
            />
            <RoundedBox
              args={[0.42, 0.06, 0.5]}
              radius={0.02}
              bevelSegments={1}
              smoothness={1}
              position={[x, 0.03, 0]}
              material={mat.lift}
            />
            <RoundedBox
              args={[0.12, 0.1, 0.4]}
              radius={0.02}
              bevelSegments={1}
              smoothness={1}
              position={[x, 0.1, 0]}
              material={mat.steel}
            />
          </group>
        ))}
        <RoundedBox
          args={[3.9, 0.14, 0.24]}
          radius={0.03}
          bevelSegments={1}
          smoothness={1}
          position={[0, 2.3, 0]}
          material={mat.lift}
          castShadow
        />
        {[-1, 1].map((sd) => (
          <RoundedBox
            key={sd}
            args={[1.44, 0.05, 2.9]}
            radius={0.015}
            bevelSegments={1}
            smoothness={1}
            position={[sd * 1.12, 0.025, 0]}
            material={mat.lift}
          />
        ))}
        </group>
      </Merged>

      {dressing}
    </group>
  );
}

// ─── Track Environment ────────────────────────────────────────────────────────

// A safety barrier is a structure, not a slab: a concrete kerb and plinth with a
// post every few metres, and a bright steel double-rail on top. Both halves are
// merged into a single geometry each, so the whole ring still costs two draw
// calls. Lengths are one metre in Z and scaled per instance.
const BARRIER_SOLID = (() => {
  const parts: THREE.BufferGeometry[] = [];
  const add = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    geo.translate(x, y, z);
    parts.push(geo);
  };
  add(0.62, 0.1, 1, 0, 0.05, 0); // kerb
  add(0.46, 0.36, 1, 0, 0.28, 0); // plinth
  for (const z of [-0.34, 0, 0.34]) add(0.18, 0.68, 0.16, 0, 0.66, z); // posts
  return mergeGeometries(parts, false)!;
})();

const BARRIER_RAIL = (() => {
  const parts: THREE.BufferGeometry[] = [];
  const add = (y: number, h: number, w: number) => {
    const geo = new THREE.BoxGeometry(w, h, 1);
    geo.translate(0, y, 0);
    parts.push(geo);
  };
  add(0.62, 0.15, 0.2); // lower rail
  add(0.8, 0.15, 0.2); // upper rail
  add(0.91, 0.06, 0.24); // top cap
  return mergeGeometries(parts, false)!;
})();

// Shared materials and geometries for the trackside. They are created once at
// module load and reused by every circuit of a session, which is what makes the
// static batching free: the mesh instances only carry transforms.
const BARRIER_MAT = new THREE.MeshLambertMaterial({ color: "#727c88" });
const BARRIER_RAIL_MAT = new THREE.MeshStandardMaterial({
  color: "#cdd7e2",
  roughness: 0.3,
  metalness: 0.82,
});
const TREE_TRUNK = new THREE.CylinderGeometry(0.16, 0.22, 3, 6);
const TREE_TRUNK_FAR = new THREE.CylinderGeometry(0.16, 0.22, 3, 4);
const TREE_CANOPY = new THREE.ConeGeometry(1.3, 3.2, 7);
const TREE_CANOPY_FAR = new THREE.ConeGeometry(1.3, 3.2, 5);
const TREE_TRUNK_MAT = new THREE.MeshLambertMaterial({ color: "#4a3520" });
const TREE_CANOPY_MAT = new THREE.MeshLambertMaterial({ color: "#2d5a27" });
// The soft blob under a tree: the rotation is baked into the geometry so the
// instanced batch only has to carry a position.
const TREE_BLOT = new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2);

function TrackEnvironment({ track }: { track: ClubCircuit }) {
  // Barriers and trees are drawn with instanced meshes: hundreds of objects,
  // only a handful of draw calls, which keeps the integrated GPU comfortably
  // above 60. The frame-rate governor can thin them out on the weakest machines.
  const { level } = useContext(PerfContext);
  const treeShadow = useBlobShadow();
  const barrierOffset = track.halfWidth + 2.4;
  // Shorter base spans mean the barrier follows the arc instead of reading as a
  // chain of visible kinks in a long corner. The recursion below still catches
  // any chord that would reach the drivable band.
  const wallStep = level === 2 ? 2 : level === 1 ? 4 : 6;
  // Tree density comes from the circuit profile: a deep forest is packed, a
  // street circuit has none at all.
  const treeStep = useMemo(() => {
    const profile = track.spec.profile;
    const density = profile.trees;
    if (density <= 0) return 0;
    // A city has its own street trees on the pavement (see CircuitScenery);
    // the conifer field here belongs to forests, valleys and the speedway.
    if (profile.kind === "city") return 0;
    const base = level === 2 ? 22 : level === 1 ? 34 : 60;
    return Math.max(6, Math.round(base / density));
  }, [level, track]);
  const walls = useMemo(() => {
    // A barrier is a chain of straight panels, so the step decides how well it
    // follows the verge: on a tight corner a long chord cuts towards the apex
    // and ends up standing on the road, where the car drives straight through
    // it. Every coarse span is therefore halved until no chord reaches inside
    // the band the car can use — the wall stays glued to the edge at the
    // corners while the straights keep the cheap long panels.
    const limit = track.halfWidth + 1.25 + 0.31;
    const out: ChunkItem[] = [];
    const at = (i: number) => ({
      p: track.points[i % 600]!,
      r: track.rights[i % 600]!,
    });
    const panel = (a: number, b: number) => {
      const pa = at(a);
      const pb = at(b);
      // Two independent offset curves: on a tight corner the left and right
      // barriers do not have the same chord, so each side gets its own length
      // and heading. Both are centred between their endpoints, which is what
      // makes neighbouring panels meet instead of leaving half-length holes.
      const ax = pa.p.x + pa.r.x * barrierOffset;
      const az = pa.p.z + pa.r.z * barrierOffset;
      const bx = pb.p.x + pb.r.x * barrierOffset;
      const bz = pb.p.z + pb.r.z * barrierOffset;
      const ox = pa.p.x - pa.r.x * barrierOffset;
      const oz = pa.p.z - pa.r.z * barrierOffset;
      const px = pb.p.x - pb.r.x * barrierOffset;
      const pz = pb.p.z - pb.r.z * barrierOffset;
      const dx = bx - ax;
      const dz = bz - az;
      const len = Math.hypot(dx, dz) || 1;
      const idx = px - ox;
      const idz = pz - oz;
      const ilen = Math.hypot(idx, idz) || 1;
      let reach = false;
      for (let i = a + 1; i < b && !reach; i++) {
        const p = at(i).p;
        const outer = Math.abs((p.x - ax) * dz - (p.z - az) * dx) / len;
        const inner = Math.abs((p.x - ox) * idz - (p.z - oz) * idx) / ilen;
        reach = outer < limit || inner < limit;
      }
      if (reach && b - a > 1) {
        const mid = a + Math.ceil((b - a) / 2);
        panel(a, mid);
        panel(mid, b);
        return;
      }
      const add = (sx: number, sz: number, ex: number, ez: number) => {
        const ddx = ex - sx;
        const ddz = ez - sz;
        const length = Math.hypot(ddx, ddz) || 1;
        out.push({
          p: [(sx + ex) / 2, 0, (sz + ez) / 2],
          r: Math.atan2(ddx, ddz),
          s: [1, 1, length + 0.2],
        });
      };
      add(ax, az, bx, bz);
      add(ox, oz, px, pz);
    };
    for (let i = 0; i < 600; i += wallStep) panel(i, i + wallStep);
    return out;
  }, [track, wallStep, barrierOffset]);
  const trees = useMemo(() => {
    const out: { base: readonly [number, number, number]; s: number }[] = [];
    if (!treeStep) return out;
    for (let i = 0; i < 600; i += treeStep) {
      const point = track.points[i];
      const rv = track.rights[i];
      if (!point || !rv) continue;
      const n = i / treeStep;
      const side = n % 2 === 0 ? 1 : -1;
      // Always measured along the track normal, so a tree can never land on the
      // asphalt the way a raw world-axis offset could.
      const offset = 26 + (n % 5) * 10;
      out.push({
        base: [point.x + rv.x * offset * side, 0, point.z + rv.z * offset * side],
        s: 0.85 + (n % 4) * 0.12,
      });
    }
    return out;
  }, [track, treeStep]);
  // The trunk and the canopy live at different heights, so each has its own
  // transform list; both share the same instanced batching and LOD switch.
  const treeTrunks = useMemo(
    () =>
      trees.map(
        (t): ChunkItem => ({
          p: [t.base[0], 1.5 * t.s, t.base[2]],
          s: [t.s, t.s, t.s],
        }),
      ),
    [trees],
  );
  const treeCanopies = useMemo(
    () =>
      trees.map(
        (t): ChunkItem => ({
          p: [t.base[0], 3.6 * t.s, t.base[2]],
          s: [t.s, t.s, t.s],
        }),
      ),
    [trees],
  );
  const treeBlots = useMemo(
    () => trees.map((t): ChunkItem => ({ p: [t.base[0], 0.03, t.base[2]] })),
    [trees],
  );
  const treeBlobMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: treeShadow,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        toneMapped: false,
      }),
    [treeShadow],
  );
  useEffect(() => () => treeBlobMat.dispose(), [treeBlobMat]);
  // The gantry is static in shape, so its parts are merged at build time.
  const frame = useMemo(() => {
    // The legs stand behind the barrier line: a five metre post inside the band
    // the car can reach is a hole in the world.
    const posts: THREE.BufferGeometry[] = [
      -track.halfWidth - 3.2,
      track.halfWidth + 3.2,
    ].map((x) => {
      const geo = new THREE.BoxGeometry(0.2, 5, 0.2);
      geo.translate(x, 2.5, 0);
      return geo;
    });
    const lights = [-1.2, -0.6, 0, 0.6, 1.2].map((x) => {
      const geo = new THREE.SphereGeometry(0.1, 10, 8);
      geo.translate(x, 4.6, -0.3);
      return geo;
    });
    return {
      posts: mergeGeometries(posts, false)!,
      lights: mergeGeometries(lights, false)!,
    };
  }, [track.halfWidth]);
  useEffect(
    () => () => {
      frame.posts.dispose();
      frame.lights.dispose();
    },
    [frame],
  );
  const { posts: gantryPosts, lights: startLights } = frame;
  return (
    <group>
      {/* Track surface (grass, asphalt, kerbs and pit lane) */}
      <Circuit3D track={track} />
      {/* Safety barriers: kerb, plinth and posts in concrete, rails in steel.
          Batched per arc of the lap: the arcs the car has left behind are
          dropped whole, which is where the vertex load of the ring used to go. */}
      <ChunkedInstances
        geometry={BARRIER_SOLID}
        material={BARRIER_MAT}
        items={walls}
        arcs={36}
        radius={560}
      />
      <ChunkedInstances
        geometry={BARRIER_RAIL}
        material={BARRIER_RAIL_MAT}
        items={walls}
        arcs={36}
        radius={620}
      />
      {/* Trees: trunk and canopy drop to a cheaper profile past 120 m, where a
          seven-sided cone is a smear of green on the sensor anyway. */}
      <ChunkedInstances
        geometry={TREE_BLOT}
        material={treeBlobMat}
        items={treeBlots}
        arcs={12}
        radius={380}
      />
      <ChunkedInstances
        geometry={TREE_TRUNK}
        material={TREE_TRUNK_MAT}
        items={treeTrunks}
        arcs={12}
        radius={520}
        lod={{ geometry: TREE_TRUNK_FAR, distance: 120 }}
      />
      <ChunkedInstances
        geometry={TREE_CANOPY}
        material={TREE_CANOPY_MAT}
        items={treeCanopies}
        arcs={12}
        radius={520}
        lod={{ geometry: TREE_CANOPY_FAR, distance: 120 }}
      />
      {/* Start/finish line */}
      <mesh position={[track.spawn.x, 0.06, track.spawn.z]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[track.halfWidth * 2, 1.5]} />
        <meshStandardMaterial color="#f4f6f8" metalness={0.1} roughness={0.7} />
      </mesh>
      {/* Start gantry: posts merged into one geometry, bar and lights into two
          more, so the whole structure is three draw calls instead of seven. */}
      <group position={[track.spawn.x, 0, track.spawn.z]}>
        <mesh geometry={gantryPosts}>
          <meshStandardMaterial color="#6a6f77" metalness={0.7} roughness={0.3} />
        </mesh>
        <mesh position={[0, 5, 0]}>
          <boxGeometry args={[track.halfWidth * 2 + 7, 0.3, 0.3]} />
          <meshStandardMaterial color="#2f333a" metalness={0.6} roughness={0.4} />
        </mesh>
        <mesh geometry={startLights}>
          <meshBasicMaterial color="#dbe8f7" />
        </mesh>
      </group>
    </group>
  );
}

// ─── Lighting ─────────────────────────────────────────────────────────────────

// A vertex-coloured dome: a smooth sky gradient with no custom shader to break
// on integrated drivers, and only one extra draw call.
function SkyDome({ horizon, zenith }: { horizon: string; zenith: string }) {
  const geometry = useMemo(() => {
    const geo = new THREE.SphereGeometry(1, 32, 16);
    const pos = geo.getAttribute("position");
    const colors = new Float32Array(pos.count * 3);
    const low = new THREE.Color(horizon);
    const high = new THREE.Color(zenith);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = THREE.MathUtils.clamp((pos.getY(i) + 0.12) * 1.4, 0, 1);
      c.copy(low).lerp(high, t * t);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return geo;
  }, [horizon, zenith]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    // Drawn last with depth testing: the dome then only shades the pixels that
    // nothing else covered, instead of wasting a full-screen pass underneath.
    <mesh geometry={geometry} scale={900} frustumCulled={false} renderOrder={1}>
      <meshBasicMaterial
        vertexColors
        side={THREE.BackSide}
        fog={false}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

// The scene's key light, optionally casting a real shadow map. With an anchor
// the light and its shadow frustum travel with the car: a 512² map inside a
// ±12 m box puts a texel under two and a half centimetres, which is sharper
// than any 2048² map spread over the whole circuit — and the PCF-soft filter
// turns those few texels into a soft edge instead of a staircase.
const SUN_TMP = new THREE.Vector3();

function ShadowSun({
  outdoor,
  night,
  shadows,
  anchor,
  span,
}: {
  outdoor: boolean;
  night: boolean;
  shadows: boolean;
  anchor?: RefObject<THREE.Object3D | null> | undefined;
  span: number;
}) {
  const c = useMemo(palette, []);
  const light = useRef<THREE.DirectionalLight>(null);
  useFrame(() => {
    const l = light.current;
    if (!l || !anchor) return;
    const a = anchor.current;
    if (!a) return;
    a.getWorldPosition(SUN_TMP);
    // A lower, warmer sun: long shadows across the kerbs read as late
    // afternoon and give the flat track a sense of relief.
    l.position.set(SUN_TMP.x + 13, 11.5, SUN_TMP.z + 8);
    l.target.position.set(SUN_TMP.x, 0, SUN_TMP.z);
    l.target.updateMatrixWorld();
  });
  return (
    <directionalLight
      ref={light}
      castShadow={shadows}
      position={[8, 12, 6]}
      color={night ? "#9fb6e8" : outdoor ? c.warm : "#ffffff"}
      intensity={night ? 0.35 : outdoor ? 1.75 : 1.85}
      shadow-mapSize-width={shadows ? 1024 : 0}
      shadow-mapSize-height={shadows ? 1024 : 0}
      shadow-radius={2.5}
      shadow-camera-left={-span}
      shadow-camera-right={span}
      shadow-camera-top={span}
      shadow-camera-bottom={-span}
      shadow-camera-near={1}
      // The shadow frustum is only `span` metres wide, so nothing further than
      // that from the car can cast: the 30 m cut-off of the pipeline is enforced
      // by the box itself and costs no per-object test.
      shadow-camera-far={Math.max(24, span * 2.6)}
      shadow-bias={-0.0012}
      shadow-normalBias={0.035}
    />
  );
}

// ─── Time-sliced reflections ──────────────────────────────────────────────────
//
// A real cube map of the circuit for the bodywork, refreshed one face at a
// time: every other frame exactly one of the six faces is redrawn, so a full
// reflection of the world is never more than twelve frames old — a fifth of a
// second, invisible on a car reflecting a horizon — while a frame only pays for
// half a face instead of a whole cube. The shadow maps are frozen during the
// pass (nothing changes under them in 200 ms) and the car is hidden so the paint
// never reflects itself through the camera sitting inside it.
const REFLECT_TMP = new THREE.Vector3();
/** Metres of scenery the reflection pass draws: a horizon, not a landscape. */
const REFLECT_CULL_RADIUS = 190;

function blackCube(): THREE.CubeTexture {
  const faces = Array.from({ length: 6 }, () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, 1, 1);
    }
    return canvas;
  });
  const texture = new THREE.CubeTexture(faces);
  // Same filtering as the live cube: swapping between the two must not change a
  // single shader define, otherwise the pass would recompile the whole scene.
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function TimeSlicedReflections({
  anchor,
  every = 2,
  size = 128,
}: {
  /** The object the cube is captured from (the car); the camera when absent. */
  anchor?: RefObject<THREE.Object3D | null> | undefined;
  /** Frames between face updates: one face every other frame. */
  every?: number;
  size?: number;
}) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const rig = useMemo(() => {
    const target = new THREE.WebGLCubeRenderTarget(size, {
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
    });
    const camera = new THREE.CubeCamera(0.4, 1200, target);
    return { target, camera, empty: blackCube() };
  }, [size]);
  useEffect(() => {
    rig.camera.coordinateSystem = gl.coordinateSystem;
    rig.camera.updateCoordinateSystem();
    scene.environment = rig.target.texture;
    scene.environmentIntensity = 1.1;
    return () => {
      if (scene.environment === rig.target.texture) {
        scene.environment = null;
        scene.environmentIntensity = 1;
      }
      rig.target.dispose();
      rig.empty.dispose();
    };
  }, [gl, rig, scene]);
  const frame = useRef(0);
  const face = useRef(0);
  const warmed = useRef(false);
  useFrame((state) => {
    // All six faces on the very first frame, so even a canvas that only draws
    // on demand starts with a complete cube instead of five black ones.
    const first = !warmed.current;
    if (!first && frame.current++ % every !== 0) return;
    warmed.current = true;
    const car = anchor?.current ?? null;
    const origin = car
      ? car.getWorldPosition(REFLECT_TMP)
      : state.camera.getWorldPosition(REFLECT_TMP);
    rig.camera.position.set(origin.x, car ? origin.y + 0.75 : origin.y, origin.z);
    rig.camera.updateMatrixWorld(true);
    const prevAuto = gl.shadowMap.autoUpdate;
    const prevVisible = car ? car.visible : true;
    const prevEnv = scene.environment;
    const prevTarget = gl.getRenderTarget();
    gl.shadowMap.autoUpdate = false;
    if (car) car.visible = false;
    // Feed the cube only the near arcs: the paint reads them as a horizon.
    cullForReflection(origin.x, origin.z, REFLECT_CULL_RADIUS);
    // Drawing into the cube while the materials sample it would be a feedback
    // loop, so the pass runs against a black cube of the same type.
    scene.environment = rig.empty;
    do {
      const index = face.current;
      gl.setRenderTarget(rig.target, index);
      gl.render(scene, rig.camera.children[index] as THREE.PerspectiveCamera);
      face.current = (index + 1) % 6;
    } while (first && face.current !== 0);
    gl.setRenderTarget(prevTarget);
    // The full visibility set comes back on the same frame: the culler runs
    // after this callback and repopulates from the normal radius.
    markChunksDirty();
    scene.environment = prevEnv;
    if (car) car.visible = prevVisible;
    gl.shadowMap.autoUpdate = prevAuto;
  });
  return null;
}

function Lighting({
  outdoor = false,
  night = false,
  fog = true,
  shadows = false,
  anchor,
  span = 16,
}: {
  outdoor?: boolean;
  night?: boolean;
  fog?: boolean;
  /** Enables the real shadow map: the car and the trackside cast onto the ground. */
  shadows?: boolean;
  /** When present, the shadow frustum follows this object instead of the origin. */
  anchor?: RefObject<THREE.Object3D | null> | undefined;
  /** Half-size of the shadow frustum, in metres. */
  span?: number;
}) {
  const c = useMemo(palette, []);
  const zenith = useMemo(() => {
    if (night) return "#04060f";
    const sky = new THREE.Color(c.sky);
    return `#${sky.clone().multiplyScalar(0.45).getHexString()}`;
  }, [c.sky, night]);
  const sky = night ? "#0b1024" : outdoor ? c.sky : c.studio;
  return (
    <>
      <color attach="background" args={[sky]} />
      {fog && (
        <fog
          attach="fog"
          args={[sky, night ? 60 : outdoor ? 160 : 18, night ? 520 : outdoor ? 700 : 50]}
        />
      )}
      {outdoor && <SkyDome horizon={night ? "#141c34" : c.sky} zenith={zenith} />}
      <hemisphereLight
        args={[
          night ? "#2a3a63" : outdoor ? c.cool : "#e9eaec",
          outdoor ? c.grass : c.floor,
          night ? 0.4 : outdoor ? 1.05 : 0.62,
        ]}
      />
      <ShadowSun
        outdoor={outdoor}
        night={night}
        shadows={shadows}
        anchor={anchor}
        span={span}
      />
      {/* Studio rim light: a cool light from behind the car picks out the roofline
          and the rear haunch, which is what stops white paint reading as a slab. */}
      {!outdoor && <directionalLight position={[-7, 4.5, -9]} color="#e9eaec" intensity={1.35} />}
      {/* The studio and the garage get a baked light-former environment, which
          is free after the first frame. The outdoor scenes leave this slot to
          the time-sliced cube camera: a real reflection of the circuit instead
          of a grey box, refreshed one face every other frame. */}
      {!outdoor && (
        <Environment resolution={256} frames={1}>
          <Lightformer
            intensity={1.5}
            position={[0, 5, 0]}
            rotation-x={Math.PI / 2}
            scale={[10, 8, 1]}
            color="#ffffff"
          />
          <Lightformer
            intensity={1}
            position={[-5, 2, 0]}
            rotation-y={Math.PI / 2}
            scale={[8, 2, 1]}
            color="#e9eaec"
          />
          <Lightformer
            intensity={1}
            position={[5, 2, 0]}
            rotation-y={-Math.PI / 2}
            scale={[8, 2, 1]}
            color="#ffffff"
          />
          {/* Low strips put highlights on the lift, chests and bench instead of
              only on the car's upper panels. Baked once, so the extra shine is
              free after the first frame. */}
          <Lightformer
            intensity={1.5}
            position={[0, 1.1, 5.6]}
            rotation-y={Math.PI}
            scale={[12, 1.1, 1]}
            color="#f2f5f9"
          />
          <Lightformer
            intensity={1.15}
            position={[0, 1.35, -5.6]}
            scale={[12, 1, 1]}
            color="#e8edf4"
          />
          <Lightformer
            intensity={1.05}
            position={[-5.4, 0.95, 0]}
            rotation-y={Math.PI / 2}
            scale={[8, 0.9, 1]}
            color="#ffffff"
          />
          <Lightformer
            intensity={1.05}
            position={[5.4, 0.95, 0]}
            rotation-y={-Math.PI / 2}
            scale={[8, 0.9, 1]}
            color="#ffffff"
          />
        </Environment>
      )}
    </>
  );
}

// ─── Minimap ──────────────────────────────────────────────────────────────────

function Minimap({
  track,
  carRef,
}: {
  track: ClubCircuit;
  carRef: RefObject<{ x: number; z: number }>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The track outline only has to be drawn once into an offscreen canvas; the
  // moving car dot is then composited every frame without any React re-render.
  const map = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 160;
    const ctx = canvas.getContext("2d");
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    track.points.forEach((p) => {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    });
    const scale = Math.min(150 / (maxX - minX), 150 / (maxZ - minZ));
    const ox = 80 - ((minX + maxX) / 2) * scale;
    const oy = 80 - ((minZ + maxZ) / 2) * scale;
    const path = () => {
      ctx?.beginPath();
      track.points.forEach((p, i) => {
        const x = p.x * scale + ox;
        const y = p.z * scale + oy;
        if (i === 0) ctx?.moveTo(x, y);
        else ctx?.lineTo(x, y);
      });
      ctx?.closePath();
    };
    if (ctx) {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#767b85";
      ctx.lineWidth = track.halfWidth * 2 * scale + 3;
      path();
      ctx.stroke();
      ctx.strokeStyle = "#3b3f47";
      ctx.lineWidth = track.halfWidth * 2 * scale;
      path();
      ctx.stroke();
      ctx.strokeStyle = "#e8eaee";
      ctx.lineWidth = 1.5;
      path();
      ctx.stroke();
      // Start/finish marker.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(track.spawn.x * scale + ox - 3, track.spawn.z * scale + oy - 3, 6, 6);
    }
    return { canvas, scale, ox, oy };
  }, [track]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      // ~20 Hz: the map is a DOM canvas, so redrawing it every frame only adds
      // compositor work on integrated graphics without being visible.
      if (t - last < 48) return;
      last = t;
      ctx.clearRect(0, 0, 160, 160);
      ctx.drawImage(map.canvas, 0, 0);
      const p = carRef.current;
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#4d9bff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x * map.scale + map.ox, p.z * map.scale + map.oy, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [map, carRef]);
  return (
    <canvas
      ref={canvasRef}
      width={160}
      height={160}
      className="absolute right-4 top-16 rounded-lg border border-border bg-black/60"
      aria-label="Minimapa del circuito"
    />
  );
}

// ─── Race scene ───────────────────────────────────────────────────────────────

// The frame-rate governor. Besides the visible frame rate it reads the real
// cost of a frame from a GPU timer query (EXT_disjoint_timer_query_webgl2), so
// it can hold a *budget* — the work of an 80 fps frame — even when the panel
// caps what you see at 60 Hz. The render scale therefore climbs to the highest
// value the GPU can actually carry and only drops when the budget is blown.
const GPU_TIMER = "EXT_disjoint_timer_query_webgl2";
/** 12.5 ms of GPU work per frame: the budget of an 80 fps frame. */
const FRAME_BUDGET_MS = 12.5;
type TimerExt = { TIME_ELAPSED_EXT: number };

/**
 * FXAA, because WebGL only offers 4× MSAA or nothing and 4× MSAA measured 11 ms
 * of a 16.6 ms frame here — more than the whole scene. This draws the scene into
 * an HDR target and spends one full-screen pass smoothing what was just drawn:
 * kerbs, wire fences, gantry, bodywork. Taking the render from r3f (a render
 * priority above zero) also means the scene is drawn exactly once.
 *
 * three never tone maps into a render target, and every fragment prefix it
 * builds already carries its own ACES operator plus exposure behind a
 * toneMapping() call. This pass ends by calling exactly that — the real thing,
 * not a retyped copy of it — and then appends the sRGB transfer the screen path
 * would have appended after it, so the picture lands as the renderer would have
 * presented it.
 */
const FXAA_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FXAA_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 texel;
varying vec2 vUv;

// toneMapping() and its exposure uniform come from three's own fragment prefix;
// the sRGB transfer below is the one the built-in materials append after it.
vec3 present(vec3 color) {
  color = toneMapping(color);
  vec3 low = pow(color, vec3(0.41666)) * 1.055 - vec3(0.055);
  return mix(low, color * 12.92, step(color, vec3(0.0031308)));
}

// The edge test only wants a luminance, and the blend that follows is a plain
// average of light — both are just as true taken from the raw HDR texel, and
// both cost one fetch instead of a tone map plus three powers. The picture is
// presented exactly once, at the very end, on the sample that is kept.
vec3 tap(vec2 uv) {
  return texture2D(tDiffuse, uv).rgb;
}

// Square root stands in for the perceptual curve while measuring: one op per
// tap instead of a full tone map, and it keeps dark kerbs as distinguishable as
// bright barriers.
float lumaOf(vec3 c) {
  vec3 p = sqrt(max(c, vec3(0.0)));
  return dot(p, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec4 center = texture2D(tDiffuse, vUv);
  vec3 rgbM = center.rgb;
  vec3 rgbNW = tap(vUv + vec2(-1.0, -1.0) * texel);
  vec3 rgbNE = tap(vUv + vec2(1.0, -1.0) * texel);
  vec3 rgbSW = tap(vUv + vec2(-1.0, 1.0) * texel);
  vec3 rgbSE = tap(vUv + vec2(1.0, 1.0) * texel);
  float lNW = lumaOf(rgbNW);
  float lNE = lumaOf(rgbNE);
  float lSW = lumaOf(rgbSW);
  float lSE = lumaOf(rgbSE);
  float lM = lumaOf(rgbM);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  float reduce = max((lNW + lNE + lSW + lSE) * 0.0078125, 0.0078125);
  float rcpMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
  dir = clamp(dir * rcpMin, vec2(-8.0), vec2(8.0)) * texel;
  vec3 rgbA = 0.5 * (tap(vUv + dir * (1.0 / 3.0 - 0.5)) + tap(vUv + dir * (2.0 / 3.0 - 0.5)));
  vec3 rgbB = rgbA * 0.5 + 0.25 * (tap(vUv + dir * -0.5) + tap(vUv + dir * 0.5));
  float lB = lumaOf(rgbB);
  vec3 rgb = (lB < lMin || lB > lMax) ? rgbA : rgbB;
  // A light unsharp pass on the same five taps. At native density FXAA alone
  // still leaves panels and lettering slightly soft; this restores local
  // contrast without another texture fetch or a second full-screen pass.
  vec3 local = (rgbNW + rgbNE + rgbSW + rgbSE) * 0.25;
  rgb = max(rgb + (rgb - local) * 0.22, vec3(0.0));
  gl_FragColor = vec4(present(rgb), center.a);
}
`;

function FxaaPass({ samples = 4 }: { samples?: number }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const target = useMemo(() => {
    const ctx = gl.getContext();
    const hdr = !!(ctx.getExtension("EXT_color_buffer_half_float") || ctx.getExtension("EXT_color_buffer_float"));
    return new THREE.WebGLRenderTarget(512, 512, {
      type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
      // Real geometric coverage, not a blur. The FXAA pass below softens the
      // edges that survive, but a gantry leg a few degrees off vertical is a
      // staircase only multisampling can straighten. Two samples plus FXAA is
      // the studio compromise: it keeps diagonals clean at the higher render
      // scale while leaving the weak integrated GPU enough time for 60 fps.
      samples,
    });
  }, [gl, samples]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: target.texture },
          texel: { value: new THREE.Vector2(1 / 512, 1 / 512) },
        },
        vertexShader: FXAA_VERT,
        fragmentShader: FXAA_FRAG,
        depthTest: false,
        depthWrite: false,
      }),
    [target, gl],
  );
  const { quadScene, quadCamera } = useMemo(() => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    mesh.frustumCulled = false;
    const s = new THREE.Scene();
    s.add(mesh);
    return { quadScene: s, quadCamera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
  }, [material]);
  const size = useMemo(() => new THREE.Vector2(), []);
  useEffect(() => {
    // A frame is two renders now (scene into the target, quad to the screen),
    // and render() resets the counters at its start, so the second one would be
    // all the chip ever saw. Resetting by hand keeps them whole.
    gl.info.autoReset = false;
    return () => {
      gl.info.autoReset = true;
    };
  }, [gl]);
  useEffect(
    () => () => {
      material.dispose();
      target.dispose();
    },
    [material, target],
  );
  // Priority 1: r3f hands the frame over, and this becomes the only renderer.
  useFrame(() => {
    gl.info.reset();
    gl.getDrawingBufferSize(size);
    const w = Math.max(1, Math.round(size.x));
    const h = Math.max(1, Math.round(size.y));
    if (target.width !== w || target.height !== h) target.setSize(w, h);
    (material.uniforms["texel"]?.value as THREE.Vector2).set(1 / w, 1 / h);
    gl.setRenderTarget(target);
    gl.render(scene, camera);
    gl.setRenderTarget(null);
    gl.render(quadScene, quadCamera);
  }, 1);
  return null;
}

/**
 * Rebuilds the shadow map on every other frame. The map is cast from the light
 * onto a static car under a fixed sun, so half the refreshes are byte-for-byte
 * identical to the ones they skip — the pass is pure waste there, and this is
 * half of it back. Only for scenes where the light and the casters hold still;
 * the circuit keeps its per-frame shadows so a car at speed never leaves one
 * behind.
 */
function ShadowThrottle() {
  const gl = useThree((s) => s.gl);
  const frame = useRef(0);
  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    return () => {
      gl.shadowMap.autoUpdate = true;
    };
  }, [gl]);
  useFrame(() => {
    frame.current++;
    gl.shadowMap.needsUpdate = frame.current % 2 === 0;
  });
  return null;
}

/**
 * The studio and the garage are still lifes: the sun never moves and the car
 * only spins the camera around it. Bake the shadow depth map once and skip the
 * entire shadow pass from then on. Vehicle requests a refresh whenever the
 * shell, the installed parts or the loaded model changes.
 */
function StaticShadow() {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    return () => {
      gl.shadowMap.autoUpdate = true;
      gl.shadowMap.needsUpdate = true;
    };
  }, [gl]);
  return null;
}

function AdaptiveResolution({
  enabled,
  onStats,
  budgetMs = FRAME_BUDGET_MS,
  minDpr = 1,
  floorDpr = 1,
}: {
  enabled: boolean;
  onStats?: ((p: Perf) => void) | undefined;
  /** GPU milliseconds a frame may cost before the scale is pulled back. */
  budgetMs?: number;
  /**
   * Density to aim for even on a 1× monitor. The workshop is viewed close up,
   * where 1× makes panel gaps and lamps read soft; the governor still drops
   * back if the extra pixels would cost the frame budget.
   */
  minDpr?: number;
  /**
   * Lowest render density the governor may choose. On the circuit this is
   * deliberately below 1×: a 60 fps frame matters more than native pixels, and
   * FXAA keeps the lower buffer from looking stair-stepped.
   */
  floorDpr?: number;
}) {
  const gl = useThree((s) => s.gl);
  const setDpr = useThree((s) => s.setDpr);
  const counter = useRef({ time: 0, frames: 0 });
  const max = Math.min(
    2,
    Math.max(typeof window === "undefined" ? 1 : window.devicePixelRatio || 1, minDpr),
  );
  // Start at a balanced scale instead of the ceiling: the first frame should not
  // wait for three slow samples before the governor reacts.
  const floor = Math.min(1, Math.max(0.5, floorDpr));
  const dpr = useRef(Math.min(max, Math.max(floor, 1.15)));
  const level = useRef<0 | 1 | 2>(2);
  const sampled = useRef(false);

  const last = useRef<number | null>(null);
  const strikes = useRef(0);
  const good = useRef(0);
  const gpuMs = useRef(0);
  // Timer queries have to bracket the frame's GPU work: one opens as the frame
  // callbacks start and closes when the frame's main render has been queued, so
  // the number that comes back is the milliseconds the GPU actually spent. The
  // probe is never on the critical path: results land a frame or two later and
  // are collected from a short queue, so nothing is lost or overwritten.
  const timer = useRef<{
    ext: TimerExt | null;
    ctx: WebGL2RenderingContext | null;
    live: WebGLQuery | null;
    liveAt: number;
    pending: WebGLQuery[];
    renders: number;
  }>({ ext: null, ctx: null, live: null, liveAt: 0, pending: [], renders: 0 });
  const samples = useRef<number[]>([]);
  useEffect(() => {
    const ctx = gl.getContext() as WebGL2RenderingContext;
    if (typeof ctx.beginQuery !== "function") return;
    const ext = (ctx.getExtension(GPU_TIMER) as TimerExt | null) ?? null;
    if (!ext) return;
    timer.current.ext = ext;
    timer.current.ctx = ctx;
    const original = gl.render.bind(gl);
    const wrapped = (scene: THREE.Object3D, camera: THREE.Camera) => {
      original(scene, camera);
      // Only the frame's main render (the one aimed at the canvas) closes the
      // query; the cube faces of the reflections run inside it.
      if (gl.getRenderTarget() !== null) return;
      const t = timer.current;
      t.renders++;
      if (t.live) {
        try {
          ctx.endQuery(ext.TIME_ELAPSED_EXT);
          t.pending.push(t.live);
        } catch {
          /* the context may have been lost */
        }
        t.live = null;
      }
      for (let i = t.pending.length - 1; i >= 0; i--) {
        const query = t.pending[i] ?? null;
        if (!query) continue;
        let done = false;
        try {
          done = ctx.getQueryParameter(query, ctx.QUERY_RESULT_AVAILABLE) as boolean;
        } catch {
          done = true;
        }
        if (!done) {
          // A query that never completes (a device reset) is dropped rather
          // than left to pile up.
          if (t.pending.length > 4) {
            try {
              ctx.deleteQuery(query);
            } catch {
              /* already gone */
            }
            t.pending.splice(i, 1);
          }
          continue;
        }
        try {
          const ns = ctx.getQueryParameter(query, ctx.QUERY_RESULT) as number;
          if (ns > 0 && ns < 400e6) {
            samples.current.push(ns / 1e6);
            if (samples.current.length > 48) samples.current.shift();
          }
        } catch {
          /* query lost with the context: the frame-rate fallback still works */
        }
        try {
          ctx.deleteQuery(query);
        } catch {
          /* already gone */
        }
        t.pending.splice(i, 1);
      }
    };
    gl.render = wrapped;
    return () => {
      gl.render = original;
      const t = timer.current;
      if (t.live && t.ctx && t.ext) {
        try {
          t.ctx.endQuery(t.ext.TIME_ELAPSED_EXT);
        } catch {
          /* nothing to close */
        }
        t.ctx.deleteQuery(t.live);
      }
      t.live = null;
      t.pending.forEach((query) => t.ctx?.deleteQuery(query));
      t.pending = [];
      t.ext = null;
      t.ctx = null;
    };
  }, [gl]);
  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    // ── GPU timing ─────────────────────────────────────────────────────────
    const t = timer.current;
    if (t.live && t.ctx && t.ext && performance.now() - t.liveAt > 200) {
      // A frame whose main render never ran (a paused canvas): throw the query
      // away instead of letting it starve the chain.
      try {
        t.ctx.endQuery(t.ext.TIME_ELAPSED_EXT);
      } catch {
        /* nothing to close */
      }
      t.ctx.deleteQuery(t.live);
      t.live = null;
    }
    if (t.ctx && t.ext && !t.live) {
      try {
        const query = t.ctx.createQuery();
        t.ctx.beginQuery(t.ext.TIME_ELAPSED_EXT, query);
        t.live = query;
        t.liveAt = performance.now();
      } catch {
        t.ext = null;
      }
    }
    if (!enabled) return;
    // The Canvas `dpr` prop re-applies its own value whenever React re-renders
    // the tree, which would quietly undo the scale the governor just chose — the
    // renderer then keeps drawing at the full ratio while every readout claims
    // otherwise, and the density pays for it. Re-assert the decided ratio here,
    // so the prop can no longer win.
    if (Math.abs(state.gl.getPixelRatio() - dpr.current) > 0.002) {
      state.gl.setPixelRatio(dpr.current);
      state.gl.setSize(state.size.width, state.size.height, false);
    }
    counter.current.time += dt;
    counter.current.frames++;
    const window_ = sampled.current ? 0.6 : 0.5;
    if (counter.current.time < window_) return;
    const fps = counter.current.frames / counter.current.time;
    counter.current = { time: 0, frames: 0 };
    // An occluded or backgrounded tab throttles requestAnimationFrame to a
    // crawl, and the rate that comes out of it says nothing about the renderer:
    // adapting to it would pull the scale down while nobody is looking, and the
    // picture would come back soft for no reason at all.
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      samples.current = [];
      return;
    }
    last.current = fps;
    sampled.current = true;

    // Median GPU time of the window: a single spike (a shadow-map rebuild, a
    // garbage collection) must never drag the picture down.
    let over = false;
    if (samples.current.length >= 5) {
      const sorted = [...samples.current].sort((a, b) => a - b);
      const med = sorted[Math.floor(sorted.length / 2)] ?? 0;
      gpuMs.current = med;
      samples.current = [];
      over = med > budgetMs;
    }
    // The visible rate is the safety net: below 48 fps something (CPU, the
    // compositor) is behind even when the GPU claims it is inside budget. But a
    // tab that is not the focused one is throttled by the browser instead, and
    // the rate that comes out of it is the browser's, not the renderer's — so the
    // net is only drawn while this is the window being looked at, and in that
    // state the climb goes by the GPU timer alone.
    const watched = typeof document === "undefined" || document.hasFocus();
    // 56, not 48: a frame that misses the 60 Hz deadline is already visible as
    // judder, and the old threshold let the scale sit at a 50 fps plateau.
    if (fps < 56 && watched) over = true;

    // The scale is what gives way first, and it gives way in small steps: two
    // sub-millisecond queries must agree before a step is taken, so a single
    // spike (a shadow rebuild, a garbage collection) can never drag the picture
    // down.
    if (over) {
      strikes.current++;
      good.current = 0;
    } else {
      strikes.current = 0;
    }
    if (strikes.current >= 2) {
      strikes.current = 0;
      if (dpr.current > floor + 0.001) {
        // Halve the step as the ceiling is approached, so the scale settles
        // instead of ringing around it. The floor can sit below 1× on the
        // circuit, where a missed deadline is more noticeable than a slightly
        // softer buffer.
        dpr.current = Math.max(
          floor,
          +(dpr.current - (gpuMs.current > budgetMs * 1.6 ? 0.2 : 0.1)).toFixed(2),
        );
        setDpr(dpr.current);
      }
    } else if ((!watched || fps > 58) && gpuMs.current < budgetMs * 0.82) {
      // Inside budget and holding the refresh: climb, slowly, one step per
      // three samples, so the picture never flickers between two scales. An
      // unwatched window climbs on the GPU timer: the rate it reports is the
      // browser's throttle, not the renderer's.
      //
      // The climb asks for real headroom, not just a pass: a scale that costs
      // 12 of the 12.5 allowed milliseconds has no room for the next one, and
      // stepping up anyway buys seven percent more pixels and pays for them
      // with a hitch every couple of seconds while the two scales trade
      // places. The band is where it rests.
      good.current++;
      if (good.current >= 3) {
        good.current = 0;
        if (dpr.current < max) {
          dpr.current = Math.min(max, +(dpr.current + 0.1).toFixed(2));
          setDpr(dpr.current);
        } else if (level.current < 2) {
          level.current = (level.current + 1) as 0 | 1 | 2;
        }
      }
    }
    // The density of the scenery is the quality the player asked for, so it is
    // the last thing to be given up: only once the scale is already native and
    // the frame rate has genuinely collapsed.
    if (watched && dpr.current <= floor + 0.001 && level.current > 0 && fps < 50) {
      level.current = (level.current - 1) as 0 | 1 | 2;
    }
    onStats?.({ level: level.current, fps, dpr: dpr.current, gpuMs: gpuMs.current });
  });
  return null;
}

const renderer = {
  // Off on purpose, and measured rather than assumed: WebGL offers either 4×
  // MSAA or nothing, and the multisample resolve cost 11 ms of a 16.6 ms frame
  // in this studio — more than the whole rest of the scene. The frame rate is
  // kept by holding the render scale at native density and by a sharp shadow
  // map instead, which together cost a fraction of that.
  antialias: false,
  toneMapping: THREE.ACESFilmicToneMapping,
  toneMappingExposure: 1.05,
  powerPreference: "high-performance" as const,
  stencil: false,
};

// 4× MSAA everywhere a scene is watched closely. The governor keeps the render
// scale at native density and the draw-call budget is what actually decides the
// frame cost on integrated graphics, so the multisample resolve is affordable —
// and it is the only thing that removes the stair-stepped edges on kerbs, wire
// fences and bodywork.

// ─── Main exported components ─────────────────────────────────────────────────

export function CarStudio3D({
  car,
  installed,
  focus,
  model,
  className = "h-[min(60vh,660px)] min-h-[360px]",
}: {
  car: CarConfig;
  installed: boolean[];
  focus: string;
  model?: THREE.Group | null | undefined;
  className?: string;
}) {
  const c = useMemo(palette, []);
  return (
    <div
      className={`relative w-full bg-muted ${className}`}
      aria-label="Taller tridimensional"
    >
      <Canvas
        shadows
        frameloop="always"
        dpr={[1, 2]}
        camera={{ position: [4.35, 1.85, 5.1], fov: 35 }}
        gl={renderer}
        onCreated={({ gl }) => {
          gl.shadowMap.enabled = true;
          // r186 removed PCFSoft: the plain PCF path is now a five-tap Vogel disk
          // behind hardware filtering, and shadow.radius softens it further.
          gl.shadowMap.type = THREE.PCFShadowMap;
        }}
      >
        {/* The overhead spot already casts the car's shadow; the directional
            map only duplicates it and costs every fragment another lookup. */}
        <Lighting />
        <GarageEnvironment />
        <Vehicle car={car} installed={installed} focus={focus} model={model} />
        <OrbitControls
          makeDefault
          enablePan={false}
          minDistance={3.6}
          maxDistance={7.2}
          maxPolarAngle={1.48}
          target={[0, 0.62, 0]}
          enableDamping
        />
        {/* Fixed sun and a static car: bake the shadow once. The orbit only
            moves the camera, so rebuilding this map every other frame was
            paying for the same picture again and again. */}
        <StaticShadow />
        {/* The studio is the view that spends the most time on screen, so it
            carries the same governor as the circuit: the render scale climbs
            while there is budget and only drops when a frame costs too much. */}
        <AdaptiveResolution enabled minDpr={1.5} floorDpr={1} />
        <FxaaPass samples={2} />
      </Canvas>
      <div className="scene-vignette" aria-hidden />
      <div className="pointer-events-none absolute bottom-4 left-4 border-l-2 border-primary bg-background/75 px-3 py-2 font-mono text-[10px] uppercase">
        {focus} · {car.name}
      </div>
    </div>
  );
}

// Frames the whole lap: the preview has to show the complete circuit, so the
// camera is placed from the real extent of the layout instead of a fixed spot
// that only worked for one track.
function FrameCamera({
  view,
}: {
  view: { pos: [number, number, number]; target: [number, number, number] };
}) {
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    camera.position.set(view.pos[0], view.pos[1], view.pos[2]);
    camera.lookAt(view.target[0], view.target[1], view.target[2]);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, invalidate, view]);
  return null;
}

export function CircuitPreview({
  circuit = "deepforest",
  className = "h-[320px]",
}: {
  circuit?: CircuitId;
  className?: string;
}) {
  const track = useMemo(() => createClubCircuit(circuit), [circuit]);
  const view = useMemo(() => {
    const shape = track.spec.shape;
    const centre = track.points.reduce(
      (acc, p) => {
        acc.x += p.x / track.points.length;
        acc.z += p.z / track.points.length;
        return acc;
      },
      { x: 0, z: 0 },
    );
    const reach = Math.max(shape.a, shape.b) + track.spec.profile.far;
    return {
      pos: [centre.x + reach * 0.75, reach * 0.95, centre.z + reach * 1.25] as [
        number,
        number,
        number,
      ],
      target: [centre.x, 0, centre.z] as [number, number, number],
    };
  }, [track]);
  return (
    <div className={`relative w-full ${className}`} aria-label="Vista previa del circuito">
      <Canvas
        shadows={false}
        // Static overview: it only needs to draw when something changes, so it
        // stops competing with the driving canvas for the frame budget.
        frameloop="demand"
        dpr={[1, 1.35]}
        gl={renderer}
        camera={{ position: view.pos, fov: 45 }}
        onCreated={({ gl }) => {
          gl.shadowMap.enabled = false;
        }}
      >
        <FrameCamera view={view} />
        <Lighting outdoor night={track.spec.profile.night} fog={false} />
        <TimeSlicedReflections />
        <TrackEnvironment track={track} />
      </Canvas>
      <div className="scene-vignette" aria-hidden />
    </div>
  );
}

export function Garage3D({
  car,
  model,
}: {
  car: CarConfig;
  model?: THREE.Group | null | undefined;
}) {
  return (
    <div className="relative h-[360px] w-full bg-muted" aria-label="Garaje tridimensional">
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={renderer}
        camera={{ position: [6.5, 3.4, 7.5], fov: 42 }}
        onCreated={({ gl }) => {
          gl.shadowMap.enabled = true;
          // r186 removed PCFSoft: the plain PCF path is now a five-tap Vogel disk
// behind hardware filtering, and shadow.radius softens it further.
gl.shadowMap.type = THREE.PCFShadowMap;
        }}
      >
        {/* The overhead spot already casts the car's shadow; the directional
            map only duplicates it and costs every fragment another lookup. */}
        <Lighting />
        <GarageEnvironment />
        <Vehicle car={car} installed={Array(9).fill(true)} focus="Garaje" model={model} />
        <OrbitControls
          makeDefault
          enablePan={false}
          minDistance={4}
          maxDistance={12}
          maxPolarAngle={1.48}
          target={[0, 0.8, 0]}
          enableDamping
        />
        <AdaptiveResolution enabled minDpr={1.35} floorDpr={1} />
        <StaticShadow />
        <FxaaPass samples={2} />
      </Canvas>
      <div className="scene-vignette" aria-hidden />
    </div>
  );
}

// ─── Driving on circuit ───────────────────────────────────────────────────────

type CameraMode = "firstPerson" | "closeThird" | "farThird";

/**
 * Headlights, on the F key. Two spot lamps throw the dipped beam down the road
 * and a short point light lifts the tarmac just off the nose; the lamp glass in
 * the model brightens with them, so the car itself looks lit from the front
 * instead of carrying a pair of invisible projectors. Everything hangs off the
 * player's car group, so the beam turns and travels with the car for free.
 */
function Headlights({ on, model }: { on: boolean; model?: THREE.Group | null | undefined }) {
  const left = useRef<THREE.SpotLight>(null);
  const right = useRef<THREE.SpotLight>(null);
  const leftTarget = useMemo(() => new THREE.Object3D(), []);
  const rightTarget = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => {
    if (left.current) left.current.target = leftTarget;
    if (right.current) right.current.target = rightTarget;
  }, [leftTarget, rightTarget]);
  // The lens glow is a material tweak, not a rebuild: the headlamp glass is
  // tagged when the car is built and brightens when the switch goes on.
  useEffect(() => {
    if (!model) return;
    model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : mesh.material
          ? [mesh.material]
          : [];
      for (const material of materials) {
        if (material.name !== "headlamp") continue;
        const lamp = material as THREE.MeshStandardMaterial;
        lamp.emissiveIntensity = on ? 3.6 : 0.95;
      }
    });
  }, [model, on]);
  return (
    <group>
      <primitive object={leftTarget} position={[-3.1, -0.62, 48]} />
      <primitive object={rightTarget} position={[3.1, -0.62, 48]} />
      <spotLight
        ref={left}
        position={[-0.62, 0.66, 2.12]}
        color="#e7f0ff"
        angle={0.52}
        penumbra={0.55}
        distance={130}
        decay={1.7}
        intensity={on ? 260 : 0}
      />
      <spotLight
        ref={right}
        position={[0.62, 0.66, 2.12]}
        color="#e7f0ff"
        angle={0.52}
        penumbra={0.55}
        distance={130}
        decay={1.7}
        intensity={on ? 260 : 0}
      />
      <pointLight position={[0, 0.72, 3.4]} color="#dbe7ff" distance={18} decay={1.8} intensity={on ? 7 : 0} />
    </group>
  );
}

function DriverCircuit({
  car,
  model,
  paused,
  reset,
  input,
  onTelemetry,
  cameraMode,
  track,
  carPos,
  onLap,
  onOffTrack,
  onImpact,
  anchorRef,
  race = null,
  spawn = null,
  headlights,
}: {
  car: CarConfig;
  model?: THREE.Group | null | undefined;
  paused: boolean;
  reset: number;
  input: RefObject<Set<string>>;
  onTelemetry: (speed: number, gear: number, rpm: number, lapTime: number) => void;
  cameraMode: CameraMode;
  track: ClubCircuit;
  carPos: RefObject<{ x: number; z: number }>;
  onLap: (lap: number, time: number) => void;
  onOffTrack: (off: boolean) => void;
  /** A hit against the barrier, with the damage it left behind. */
  onImpact?: ((severity: number, damage: number, wrecked: boolean) => void) | undefined;
  /** The shadow sun follows whatever this points at. */
  anchorRef?: RefObject<THREE.Object3D | null>;
  /** Set in a race: the player's car becomes one of the twenty on the grid. */
  race?: RaceState | null;
  /** The grid slot to start from: a race lines up behind the pole. */
  spawn?: { x: number; z: number; yaw: number; index: number } | null;
  /** The F key switch: dipped headlights for the night layouts. */
  headlights: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const state = useRef(newDriveState());
  const timer = useRef(0);
  const accumulator = useRef(0);
  const speedRef = useRef(0);
  const steerRef = useRef(0);
  const config = useMemo(() => driveSetup(car, simulate(car).topSpeed), [car]);
  // The pristine settings, kept aside: the damage is folded into the live setup
  // every frame, so a bent car grips less, brakes less and runs out of top end
  // without the physics module having to know that damage exists.
  const stock = useMemo(
    () => ({ grip: config.grip, braking: config.braking, maxSpeed: config.maxSpeed }),
    [config],
  );
  const hitAt = useRef(0);
  // Severity of the hit that opened the current crash event, so a single
  // impact spreading over several frames is booked once, at its worst.
  const lastSeverity = useRef(0);
  const smoke = useRef<THREE.Group>(null);
  const smokeClock = useRef(0);
  const smokeMap = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
      grad.addColorStop(0, "rgba(233,236,240,0.95)");
      grad.addColorStop(0.45, "rgba(190,196,204,0.55)");
      grad.addColorStop(1, "rgba(150,156,164,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 64, 64);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);
  const target = useMemo(() => new THREE.Vector3(), []);
  const look = useMemo(() => new THREE.Vector3(), []);
  const lookSmooth = useMemo(() => new THREE.Vector3(), []);
  const trackIndex = useRef(0);
  const lapCount = useRef(0);
  const lapStart = useRef(0);
  const elapsed = useRef(0);
  // In a race the first crossing of the line only arms the lap counter: the car
  // starts behind the line, so lap one is the one that begins there.
  const crossed = useRef(false);
  const bestLap = useRef<number | null>(null);
  const offRef = useRef(false);
  // Remembers the previous camera so a switch never sweeps through the body.
  const prevMode = useRef<CameraMode>(cameraMode);
  // Keep the latest callbacks in a ref: the reset effect must only depend on
  // `reset`/`track`, otherwise a new callback identity on every parent render
  // would reset the car continuously (the car would never accelerate).
  const handlers = useRef({ onTelemetry, onLap, onOffTrack, onImpact });
  handlers.current = { onTelemetry, onLap, onOffTrack, onImpact };
  useEffect(() => {
    state.current = newDriveState();
    // Racing lines the car up on its grid slot; practice puts it on the line.
    const start = spawn ?? { x: track.spawn.x, z: track.spawn.z, yaw: track.yaw, index: 0 };
    state.current.x = start.x;
    state.current.z = start.z;
    state.current.yaw = start.yaw;
    state.current.vx = 0;
    state.current.vz = 0;
    accumulator.current = 0;
    speedRef.current = 0;
    trackIndex.current = start.index;
    lapCount.current = 0;
    lapStart.current = 0;
    elapsed.current = 0;
    crossed.current = false;
    bestLap.current = null;
    offRef.current = false;
    resetDamage();
    handlers.current.onTelemetry(0, 0, 0, 0);
    handlers.current.onLap(0, 0);
    handlers.current.onOffTrack(false);
    if (race) {
      const p = race.player;
      p.x = start.x;
      p.z = start.z;
      p.vx = 0;
      p.vz = 0;
      p.yaw = start.yaw;
      p.speed = 0;
      p.index = start.index;
      p.odometer = 0;
      p.laps = 0;
      p.best = null;
      p.offTrack = false;
      p.finishedAt = null;
      // The rivals reach the player through these two hooks: a contact bends
      // the bodywork exactly like the barrier does, and the shove goes straight
      // into the state the next physics step reads.
      p.bump = (severity: number) => {
        if (severity <= 0) return;
        const now = performance.now();
        if (now - hitAt.current > 320) lastSeverity.current = 0;
        if (
          (lastSeverity.current === 0 || severity > lastSeverity.current) &&
          applyImpact(severity)
        ) {
          hitAt.current = now;
          lastSeverity.current = severity;
          const report = handlers.current.onImpact;
          if (report) report(Math.round(severity), damageState.value, damageState.wrecked);
        }
      };
      p.shove = (x: number, z: number, vx: number, vz: number) => {
        const st = state.current;
        st.x = x;
        st.z = z;
        st.vx = vx;
        st.vz = vz;
        st.speed = Math.hypot(vx, vz);
      };
    }
  }, [reset, track, race, spawn]);
  useFrame(({ camera }, raw) => {
    const dt = Math.min(raw, 0.05);
    const s = state.current;
    if (!paused) {
      const k = input.current;
      // The lights hold the grid: until they go out the pedals do nothing. Once
      // the flag is out the car only coasts — the event is over, let it roll.
      const green = !race || race.phase === "racing";
      const finished = race !== null && race.phase === "finished";
      // Damage folds into the live setup every frame: a bent car grips less,
      // brakes worse and loses top end. A wrecked one has no engine left at all
      // and simply coasts to a stop.
      const dmg = damageState.value;
      const wrecked = damageState.wrecked;
      config.grip = stock.grip * (1 - 0.22 * dmg);
      config.braking = stock.braking * (1 - 0.2 * dmg);
      config.maxSpeed = stock.maxSpeed * (1 - 0.2 * dmg);
      accumulator.current += dt;
      while (accumulator.current >= 1 / 120) {
        stepDrive(
          s,
          {
            throttle:
              !wrecked && green && (k.has("KeyW") || k.has("ArrowUp")) ? 1 - 0.18 * dmg : 0,
            steer: green
              ? (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0) -
                (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0)
              : 0,
            brake: finished ? true : !wrecked && green && (k.has("KeyS") || k.has("ArrowDown")),
            drift: green && k.has("Space"),
          },
          config,
          1 / 120,
        );
        if (wrecked) {
          // Nothing left to drive with: the wreck sheds speed on its own.
          const coast = Math.exp(-1.1 / 120);
          s.vx *= coast;
          s.vz *= coast;
          s.speed = Math.hypot(s.vx, s.vz);
        }
        accumulator.current -= 1 / 120;
      }
      elapsed.current += dt;
      // Track position: nearest centerline point + signed lateral offset.
      const near = nearestTrack(track, s.x, s.z, trackIndex.current);
      trackIndex.current = near.index;
      const lateral = near.lateral;
      const absLateral = Math.abs(lateral);
      const offTrack = absLateral > track.halfWidth;
      offRef.current = offTrack;
      handlers.current.onOffTrack(offTrack);
      if (offTrack) {
        // On the grass: rolling resistance so running wide costs time — firm,
        // but light enough that the car still reaches the barrier, which is
        // what makes the walls part of the race instead of scenery.
        const grassDrag = Math.exp(-1.4 * dt);
        s.vx *= grassDrag;
        s.vz *= grassDrag;
      }
      // Barrier: hard clamp + slide, plus the hit itself. A square, fast impact
      // rebounds off the wall and bends the car; a long scrape costs nothing.
      const wallLimit = track.halfWidth + 1.25;
      if (near.point && near.right && absLateral > wallLimit) {
        const pushDir = lateral > 0 ? -1 : 1;
        const correction = (absLateral - wallLimit) * pushDir;
        s.x += near.right.x * correction;
        s.z += near.right.z * correction;
        // `right` points to the +lateral side, so the way out of the track is
        // `right` on the positive side and `-right` on the negative one — i.e.
        // `-right * pushDir`, which is what the closing speed must be measured
        // against. Getting this sign backwards silently swallows every impact.
        const outX = -near.right.x * pushDir;
        const outZ = -near.right.z * pushDir;
        const outwardVel = s.vx * outX + s.vz * outZ;
        if (outwardVel > 0) {
          // How head-on the hit was: 1 is square into the barrier. The square
          // term sharpens a face-first impact, but never lets a shallow one fade
          // to nothing — a fast scrape still dents the car.
          const square = Math.min(1, outwardVel / Math.max(2, s.speed));
          const severity = outwardVel * 3.6 * (0.35 + 0.65 * square);
          // Kill the outward component and hand a share of it back as a shove
          // off the wall, so a hard hit rebounds the way a real one does.
          const bounce = 1 + 0.4 * square;
          s.vx -= outX * outwardVel * bounce;
          s.vz -= outZ * outwardVel * bounce;
          const now = performance.now();
          // One crash touches the wall over several frames. The cooldown folds
          // those contacts into a single event, but it must never swallow the
          // worst one: a hit harder than the one that opened the event still
          // counts, so a fast nose-first impact is not lost behind a scrape
          // that happened two frames earlier.
          if (now - hitAt.current > 320) lastSeverity.current = 0;
          if (
            (lastSeverity.current === 0 || severity > lastSeverity.current) &&
            applyImpact(severity)
          ) {
            hitAt.current = now;
            lastSeverity.current = severity;
            const report = handlers.current.onImpact;
            if (report)
              report(Math.round(severity), damageState.value, damageState.wrecked);
          }
        }
        s.speed = Math.hypot(s.vx, s.vz);
      }
      // Lap detection: crossing the start/finish line, and only while actually
      // driving on the road — a car parked in the grass by the line must not be
      // credited with a lap of eight seconds. The first crossing arms the
      // counter: on a grid the lap begins at the line, not on the slot.
      if (near.index < 12 && !offTrack && s.speed > 4) {
        const since = elapsed.current - lapStart.current;
        if (!crossed.current) {
          crossed.current = true;
          lapStart.current = elapsed.current;
        } else if (since > 8) {
          lapCount.current++;
          if (bestLap.current === null || since < bestLap.current) bestLap.current = since;
          handlers.current.onLap(lapCount.current, since);
          lapStart.current = elapsed.current;
        }
      }
    }
    speedRef.current = s.speed;
    steerRef.current = s.steer;
    // Fed to the cockpit dashboard: road speed, live revs, gear.
    cockpitTelemetry.speed = Math.abs(s.speed) * 3.6;
    cockpitTelemetry.rpm = s.rpm;
    cockpitTelemetry.gear = s.gear;
    carPos.current.x = s.x;
    carPos.current.z = s.z;
    // The race's view of the player: the same state the rivals' contacts and
    // the timing tower read, banked from the car itself.
    if (race) {
      const p = race.player;
      p.odometer += Math.hypot(s.x - p.x, s.z - p.z);
      p.x = s.x;
      p.z = s.z;
      p.vx = s.vx;
      p.vz = s.vz;
      p.yaw = s.yaw;
      p.speed = s.speed;
      p.index = trackIndex.current;
      p.offTrack = offRef.current;
      p.laps = lapCount.current;
      p.best = bestLap.current;
    }
    if (anchorRef) anchorRef.current = group.current;
    if (group.current) {
      group.current.position.set(s.x, 0, s.z);
      group.current.rotation.y = s.yaw;
      // A damaged car sits crooked: the body leans further the more it is bent.
      group.current.rotation.z = -damageState.value * 0.055;
    }
    // Smoke off a bent nose: it rises and fades, and how thick it comes out
    // reads how badly the car is hurt.
    if (smoke.current) {
      const plume = smoke.current;
      const dmg = damageState.value;
      plume.visible = dmg > 0.2;
      if (plume.visible) {
        smokeClock.current += dt;
        const strength = Math.min(1, (dmg - 0.18) * 1.8);
        for (let i = 0; i < plume.children.length; i++) {
          const puff = plume.children[i] as THREE.Sprite;
          const phase = (smokeClock.current * 0.5 + i / plume.children.length) % 1;
          puff.position.set(((i % 3) - 1) * 0.24, 0.2 + phase * 1.6, phase * 1.1);
          puff.scale.setScalar(0.45 + phase * 1.5);
          (puff.material as THREE.SpriteMaterial).opacity = (1 - phase) * 0.55 * strength;
        }
      }
    }
    const sinY = Math.sin(s.yaw);
    const cosY = Math.cos(s.yaw);
    // The speed the frame reacts to is the real one: it used to top out at
    // 108 km/h, so everything above that felt frozen. Now it keeps growing to
    // 200-odd, where the field actually runs.
    const speedK = Math.min(1, s.speed / 58);
    if (cameraMode === "firstPerson") {
      // Onboard: the driver's eye, sitting above the wheel so the rim only
      // fills the lower third of the screen and the circuit stays in view —
      // the way an onboard camera is mounted in a real car. The mount is rigid:
      // any smoothing would let the car slide away from the camera under
      // acceleration and the whole cockpit would fall apart on screen.
      const eyeY = 1.06 + car.rideHeight * 0.05;
      const eyeZ = 0.1 + 0.22;
      camera.position.set(s.x + sinY * eyeZ, eyeY, s.z + cosY * eyeZ);
      lookSmooth.set(s.x + sinY * 20, 0.98 - speedK * 0.16, s.z + cosY * 20);
      camera.lookAt(lookSmooth);
    } else {
      // The boom shortens and drops as the car gets quick: the road rushes at
      // the camera instead of it calmly following along behind.
      if (cameraMode === "closeThird") {
        const boom = 5.4 - speedK * 0.8;
        target.set(s.x - sinY * boom, 3.4 - speedK * 0.5, s.z - cosY * boom);
        look.set(s.x + sinY * (7 + speedK * 5), 0.7, s.z + cosY * (7 + speedK * 5));
      } else {
        const boom = 8.6 - speedK * 1.5;
        target.set(s.x - sinY * boom, 3.5 - speedK * 0.75, s.z - cosY * boom);
        look.set(s.x + sinY * (9 + speedK * 6), 0.6, s.z + cosY * (9 + speedK * 6));
      }
      // Critically-damped smoothing on both position and gaze keeps the chase
      // camera fluid at any framerate without rubber-banding. On a camera
      // switch the first frame snaps, so the view never sweeps through the car.
      const follow = prevMode.current === cameraMode ? 1 - Math.exp(-7 * dt) : 1;
      camera.position.lerp(target, follow);
      lookSmooth.lerp(look, prevMode.current === cameraMode ? Math.min(1, follow * 1.4) : 1);
      camera.lookAt(lookSmooth);
    }
    prevMode.current = cameraMode;
    // A camera bolted to a car, not floating above it: the horizon leans with
    // the steering and shivers with the road, harder the faster it goes.
    const roll = s.steer * speedK * 0.014 + Math.sin(elapsed.current * 27) * speedK * 0.0016;
    if (roll !== 0) camera.rotateZ(roll);
    // Speed-sensitive field of view. The horizon stretches as the car goes
    // faster, which is what sells speed on screen without faking the physics.
    const cam = camera as THREE.PerspectiveCamera;
    const baseFov = cameraMode === "firstPerson" ? 62 : cameraMode === "closeThird" ? 53 : 47;
    const wantFov = baseFov + speedK * (cameraMode === "firstPerson" ? 18 : 16);
    if (Math.abs(cam.fov - wantFov) > 0.02) {
      cam.fov += (wantFov - cam.fov) * Math.min(1, dt * 2.6);
      cam.updateProjectionMatrix();
    }
    timer.current += dt;
    if (timer.current > 0.06) {
      handlers.current.onTelemetry(
        Math.round(Math.abs(s.speed) * 3.6),
        s.gear,
        s.rpm,
        // In a race the clock that matters is the one the whole field runs on.
        race ? race.time : elapsed.current - lapStart.current,
      );
      timer.current = 0;
    }
  });
  return (
    <group ref={group}>
      <Vehicle
        car={car}
        installed={Array(9).fill(true)}
        focus="Prueba"
        model={model}
        speedRef={speedRef}
        cockpit={cameraMode === "firstPerson"}
        steerRef={steerRef}
      />
      <Headlights on={headlights} model={model} />
      {/* Engine smoke: six soft sprites over the bonnet, only lit up once the
          car has taken real damage. */}
      <group ref={smoke} position={[0, 0.8, 1.5]} visible={false}>
        {Array.from({ length: 6 }, (_, i) => (
          <sprite key={i}>
            <spriteMaterial map={smokeMap} transparent depthWrite={false} opacity={0} />
          </sprite>
        ))}
      </group>
    </group>
  );
}

// ─── Rival field ──────────────────────────────────────────────────────────────
// Nineteen rivals, nineteen different cars: each one is built from its own
// moulding with its own livery, aero kit and lamps, and the colours travel as
// vertex tints over the car's paint so the whole machine is still one draw.
// Only the wheels, the shadows and the physics stay shared.

/** Writes a flat colour into a geometry as a multiplier over the car's paint. */
function tintGeometry(
  geometry: THREE.BufferGeometry,
  target: THREE.Color,
  paint: THREE.Color,
) {
  const count = geometry.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  const r = target.r / Math.max(0.004, paint.r);
  const g = target.g / Math.max(0.004, paint.g);
  const b = target.b / Math.max(0.004, paint.b);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.clearGroups();
  return geometry;
}

/** The paint multiplier that turns a car's colour into a given target. */
function shadeOf(paint: THREE.Color, target: [number, number, number]): [number, number, number] {
  return [
    target[0] / Math.max(0.004, paint.r),
    target[1] / Math.max(0.004, paint.g),
    target[2] / Math.max(0.004, paint.b),
  ];
}

/** A positioned box ready to be merged: it keeps its uv so every part of a
 *  rival's shell shares one attribute set, whatever the shell is dressed with. */
function box(w: number, h: number, d: number, x: number, y: number, z: number) {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(x, y, z);
  return geo;
}

/**
 * The aero a rival wears, built onto the body it is bolted to: splitter, side
 * skirts and diffuser always, plus a boot lip or a single-plane wing — low on
 * struts or swan-necked — so no two cars carry the same parts. Touring-car
 * hardware, never a grand-prix contraption.
 */
function aeroKit(m: Mould, rng: () => number) {
  const parts: THREE.BufferGeometry[] = [];
  const flank = m.width / 2;
  const style = Math.floor(rng() * 3);
  const wingW = m.width * (0.7 + rng() * 0.2);
  const wingZ = m.tailX + 0.3 + rng() * 0.12;

  // Splitter, skirts and diffuser: the parts every touring car in the paddock
  // runs, sized off the bodywork they hang under.
  parts.push(box(flank * (1.5 + rng() * 0.35), 0.05, 0.4 + rng() * 0.22, 0, 0.05, m.noseX - 0.22));
  for (const sd of [-1, 1]) {
    parts.push(box(0.09, 0.09 + rng() * 0.05, 1.4 + rng() * 0.6, sd * (flank - 0.03), 0.09, 0.05));
  }
  parts.push(box(flank * 1.5, 0.24, 0.12, 0, m.tailBot + 0.1, m.tailX + 0.16));
  const fins = 2 + Math.floor(rng() * 3);
  for (let f = 0; f < fins; f++) {
    const x = (f / Math.max(1, fins - 1) - 0.5) * flank * 1.1;
    parts.push(box(0.035, 0.16, 0.3, x, m.tailBot + 0.06, m.tailX + 0.26));
  }
  if (style === 0) {
    // Ducktail: the quiet one, a lip stamped into the boot lid.
    parts.push(box(wingW, 0.05, 0.22, 0, m.deckY + 0.07, wingZ - 0.12));
  } else {
    const swan = style === 2;
    const wingY = m.deckY + (swan ? 0.34 : 0.24) + rng() * 0.1;
    parts.push(box(wingW, 0.05, 0.44, 0, wingY, wingZ));
    for (const sd of [-1, 1]) {
      parts.push(box(0.04, 0.17, 0.32, sd * (wingW / 2 - 0.02), wingY + 0.01, wingZ));
      // Struts over the plane when swan-necked, under it when low-mounted.
      parts.push(
        box(
          0.05,
          wingY - m.deckY + (swan ? 0.05 : 0),
          0.09,
          sd * wingW * 0.28,
          (wingY + m.deckY) / 2,
          wingZ + (swan ? 0.1 : -0.06),
        ),
      );
    }
  }
  return mergeGeometries(parts, false)!;
}

/**
 * One complete rival: its own shell, the kit it runs and the lamps that make it
 * read as a car. Everything merges into a single geometry so each rival is one
 * draw, with the livery, glass and lamps carried as per-vertex tints.
 */
function dressRival(spec: RivalSpec, paint: THREE.Color, rng: () => number) {
  const car = spec.car;
  const m = mould(car);
  const skin = makeSkin(m);
  const flank = m.width / 2;
  // The livery accent always contrasts the paint, whatever colour was drawn.
  const lum = 0.2126 * paint.r + 0.7152 * paint.g + 0.0722 * paint.b;
  const accent = new THREE.Color(lum > 0.22 ? "#12161c" : "#e9eef4");
  const accentShade = shadeOf(paint, [accent.r, accent.g, accent.b]);
  const glassShade = shadeOf(paint, [0.05, 0.06, 0.08]);
  const trimShade = shadeOf(paint, [0.1, 0.1, 0.11]);
  const livery = spec.variant;
  const parts: THREE.BufferGeometry[] = [
    loftHull(m, (strip, _z, role) => {
      if (role === 1) return glassShade;
      if (role === 2) return trimShade;
      // 0 plain · 1 bonnet and roof · 2 flanks · 3 sills: two-tone touring paint.
      const accented =
        livery === 1
          ? strip === 5 || strip === 6
          : livery === 2
            ? strip === 3 || strip === 4 || strip === 8 || strip === 9
            : livery === 3
              ? strip === 2 || strip === 10
              : false;
      return accented ? accentShade : [1, 1, 1];
    }),
    tintGeometry(aeroKit(m, rng), new THREE.Color("#16191e"), paint),
  ];
  // Lamps, grille and bumper trim, planted on the skin so nothing floats.
  const dark = new THREE.Color("#14171d");
  const glow = new THREE.Color("#e6eef8");
  const red = new THREE.Color("#b4121f");
  const noseZ = m.noseX - 0.15;
  const noseW = Math.max(0.25, Math.min(flank * 0.62, skin.xAt(noseZ, m.noseY - 0.14) - 0.1));
  const lampY = m.noseY - 0.16;
  for (const sd of [-1, 1]) {
    parts.push(tintGeometry(box(noseW * 0.8, 0.13, 0.3, sd * noseW, lampY, noseZ), glow, paint));
    parts.push(tintGeometry(box(noseW * 0.3, 0.16, 0.14, sd * noseW * 0.35, lampY, noseZ + 0.06), dark, paint));
  }
  parts.push(
    tintGeometry(box(Math.min(flank * 0.9, noseW * 1.1), 0.15, 0.18, 0, lampY - 0.02, m.noseX - 0.05), dark, paint),
  );
  const tailZ = m.tailX + 0.1;
  const tailW = Math.max(
    0.25,
    Math.min(flank * 0.58, skin.xAt(tailZ, m.tailY - 0.18) - 0.08),
  );
  for (const sd of [-1, 1]) {
    parts.push(
      tintGeometry(box(tailW * 0.85, 0.12, 0.22, sd * tailW, m.tailY - 0.2, tailZ), red, paint),
    );
  }
  const geometry = mergeGeometries(parts, false);
  return geometry ?? parts[0]!;
}

let blotTexture: THREE.CanvasTexture | null = null;
function blotShadow() {
  if (blotTexture) return blotTexture;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grad = ctx.createRadialGradient(32, 32, 4, 32, 32, 31);
    grad.addColorStop(0, "rgba(0,0,0,0.5)");
    grad.addColorStop(0.62, "rgba(0,0,0,0.26)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
  }
  blotTexture = new THREE.CanvasTexture(canvas);
  return blotTexture;
}

function RivalField({
  race,
  track,
  playerColor,
  baseWheel,
  onLights,
  onStandings,
  onFinish,
}: {
  race: RaceState;
  track: ClubCircuit;
  playerColor: string;
  /** The player's wheel size: the rivals' rims scale against it. */
  baseWheel: number;
  onLights: (digit: number) => void;
  onStandings: (pos: number, lap: number, leaderLap: number) => void;
  onFinish: (rows: RaceRow[]) => void;
}) {
  const cars = race.cars;
  const count = cars.length;
  const bodyGroups = useRef<(THREE.Group | null)[]>([]);
  const tyreMesh = useRef<THREE.InstancedMesh>(null);
  const rimMesh = useRef<THREE.InstancedMesh>(null);
  const blotMesh = useRef<THREE.InstancedMesh>(null);

  // Nineteen cars, nineteen mouldings: every rival gets its own shell, livery,
  // aero kit and lamps, and the colours ride along as vertex tints, so the
  // whole machine is still a single draw call.
  const look = useMemo(() => {
    const hulls: THREE.BufferGeometry[] = [];
    const paints: THREE.MeshStandardMaterial[] = [];
    for (let i = 0; i < cars.length; i++) {
      const spec = cars[i]!.spec;
      const color = new THREE.Color(spec.color);
      hulls.push(dressRival(spec, color, makeRng(0x7c31 + i * 131)));
      paints.push(
        new THREE.MeshStandardMaterial({
          color: spec.color,
          vertexColors: true,
          metalness: 0.45,
          roughness: 0.32,
        }),
      );
    }
    return { hulls, paints };
  }, [cars]);
  const wheel = useMemo(() => {
    const radius = (baseWheel * 0.0254) / 2 + 0.11;
    return {
      radius,
      tyre: new THREE.CylinderGeometry(radius, radius, 0.3, 16, 1).rotateZ(Math.PI / 2),
      rim: new THREE.CylinderGeometry(radius * 0.6, radius * 0.6, 0.315, 12, 1).rotateZ(Math.PI / 2),
    };
  }, [baseWheel]);
  // A rival's tyre is the same rubber as the player's: tread around the barrel,
  // lettering on the wall. Three materials on the one cylinder, so the whole
  // field still costs two extra draw calls.
  const tyreMat = useMemo(() => {
    const tread = tyreTexture();
    const wall = tyreWallTexture();
    const rubber = (map: THREE.Texture | null, roughness: number) =>
      new THREE.MeshStandardMaterial({
        color: map ? "#ffffff" : "#141417",
        map,
        roughness,
      });
    return [rubber(tread, 0.92), rubber(wall, 0.94), rubber(wall, 0.94)];
  }, []);
  const rimMat = useMemo(() => new THREE.MeshStandardMaterial({ metalness: 0.72, roughness: 0.3 }), []);
  const blotMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: blotShadow(),
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        color: "#000000",
      }),
    [],
  );
  const blotGeo = useMemo(() => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), []);
  useEffect(
    () => () => {
      look.hulls.forEach((g) => g.dispose());
      look.paints.forEach((m) => m.dispose());
      tyreMat.forEach((m) => m.dispose());
      rimMat.dispose();
      blotMat.dispose();
      wheel.tyre.dispose();
      wheel.rim.dispose();
      blotGeo.dispose();
    },
    [look, tyreMat, rimMat, blotMat, wheel, blotGeo],
  );
  // Rim paint per rival: one instanced batch still shows nineteen wheels.
  useEffect(() => {
    const rims = rimMesh.current;
    if (!rims) return;
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      color.set(cars[i]!.spec.car.wheelColor);
      for (let w = 0; w < 4; w++) rims.setColorAt(i * 4 + w, color);
    }
    if (rims.instanceColor) rims.instanceColor.needsUpdate = true;
  }, [cars, count, look]);

  const scratch = useMemo(
    () => ({
      up: new THREE.Vector3(0, 1, 0),
      axle: new THREE.Vector3(1, 0, 0),
      pos: new THREE.Vector3(),
      one: new THREE.Vector3(1, 1, 1),
      scale: new THREE.Vector3(1, 1, 1),
      qCar: new THREE.Quaternion(),
      qA: new THREE.Quaternion(),
      qB: new THREE.Quaternion(),
      matrix: new THREE.Matrix4(),
      bodies: cars.map((car): ContactBody => ({
        x: car.state.x,
        z: car.state.z,
        yaw: car.state.yaw,
        vx: 0,
        vz: 0,
        r: 0.98,
        half: 1.18,
      })),
      playerBody: { x: 0, z: 0, yaw: 0, vx: 0, vz: 0, r: 0.98, half: 1.18, player: true } as ContactBody,
    }),
    [cars],
  );
  const clock = useRef({ acc: 0, hud: 0, reported: false, touchOn: false });

  useFrame(({ camera }, raw) => {
    const dt = Math.min(raw, 0.05);
    const now = performance.now() / 1000;
    // ── Lights: three, two, one, go.
    if (race.phase === "countdown") {
      if (race.startAt === 0) race.startAt = now + 2.9;
      if (now >= race.startAt) {
        race.phase = "racing";
        race.t0 = now;
        race.lights = 0;
        onLights(0);
      } else {
        const left = Math.max(1, Math.ceil(race.startAt - now));
        if (left !== race.lights) {
          race.lights = left;
          onLights(left);
        }
      }
    }
    race.time = race.phase === "racing" ? now - race.t0 : race.phase === "finished" ? race.time : 0;
    const player = race.player;
    const playerAt = { x: player.x, z: player.z, vx: player.vx, vz: player.vz, speed: player.speed };

    // ── The field: fixed steps, laps, contacts.
    if (race.phase !== "countdown") {
      const step = 1 / 120;
      clock.current.acc += dt;
      let guard = 0;
      while (clock.current.acc >= step && guard++ < 10) {
        for (const car of cars) {
          const prev = car.index;
          stepAiCar(car, race.guide, track, cars, playerAt, race.level, step);
          if (prev > 500 && car.index < 100 && car.state.speed > 3) {
            if (car.crossedAt === 0) {
              car.crossedAt = race.time;
              car.lapStart = race.time;
            } else {
              const since = race.time - car.lapStart;
              if (since > 8) {
                car.laps++;
                if (car.best === null || since < car.best) car.best = since;
                car.lapStart = race.time;
              }
            }
          }
        }
        // ── Contacts: the player is in the same scrum as everybody else.
        const bodies = scratch.bodies;
        cars.forEach((car, i) => {
          const body = bodies[i]!;
          body.x = car.state.x;
          body.z = car.state.z;
          body.yaw = car.state.yaw;
          body.vx = car.state.vx;
          body.vz = car.state.vz;
          body.player = false;
        });
        const pb = scratch.playerBody;
        pb.x = player.x;
        pb.z = player.z;
        pb.yaw = player.yaw;
        pb.vx = player.vx;
        pb.vz = player.vz;
        const all = [...bodies, pb];
        const hit = resolveContacts(all);
        let touched = false;
        cars.forEach((car, i) => {
          const body = bodies[i]!;
          if (Math.abs(body.x - car.state.x) > 0.0015 || Math.abs(body.z - car.state.z) > 0.0015) {
            touched = true;
          }
          car.state.x = body.x;
          car.state.z = body.z;
          car.state.vx = body.vx;
          car.state.vz = body.vz;
        });
        // Temporary: counts distinct touch events so the AI's manners can be
        // measured instead of guessed.
        if (touched && !clock.current.touchOn) race.bumps = (race.bumps ?? 0) + 1;
        clock.current.touchOn = touched;
        if (pb.x !== player.x || pb.z !== player.z || pb.vx !== player.vx || pb.vz !== player.vz) {
          player.shove(pb.x, pb.z, pb.vx, pb.vz);
        }
        if (hit > 6) player.bump(hit);
        clock.current.acc -= step;
      }
    }

    // ── Classification and the flag.
    if (race.phase !== "countdown") {
      for (const car of cars) {
        if (car.finishedAt === null && car.laps >= race.laps) car.finishedAt = race.time;
      }
      if (player.finishedAt === null && player.laps >= race.laps) {
        player.finishedAt = race.time;
        if (race.phase === "racing") race.phase = "finished";
      }
    }
    clock.current.hud += dt;
    const table = classify(
      [
        // The player goes in last: with the whole field still on its marks the
        // sort is a tie, and a stable one puts the player at the back of the
        // grid, exactly where the race starts from.
        ...cars.map((car) => ({
          name: car.spec.name,
          short: car.spec.short,
          color: car.spec.color,
          odometer: car.odometer,
          laps: car.laps,
          best: car.best,
          finishedAt: car.finishedAt,
          speed: car.state.speed,
          player: false,
        })),
        {
          name: "Vos",
          short: "VOS",
          color: playerColor,
          odometer: player.odometer,
          laps: player.laps,
          best: player.best,
          finishedAt: player.finishedAt,
          speed: player.speed,
          player: true,
        },
      ],
      race.laps,
    );
    if (clock.current.hud > 0.2) {
      clock.current.hud = 0;
      // On the grid the order is the grid: the tower lights up when it goes green.
      if (race.phase !== "countdown") {
        onStandings(table.playerPos, Math.min(race.laps, player.laps), table.leaderLaps);
      }
    }
    if (race.phase === "finished" && !clock.current.reported) {
      clock.current.reported = true;
      onFinish(table.rows);
    }

    // ── Draw: one transform per rival, wheels turning with the odometer.
    const tyres = tyreMesh.current;
    const rims = rimMesh.current;
    const blots = blotMesh.current;
    const camera2 = camera.position;
    for (let i = 0; i < count; i++) {
      const car = cars[i]!;
      const s = car.state;
      const near = (s.x - camera2.x) ** 2 + (s.z - camera2.z) ** 2 < 330 * 330;
      const group = bodyGroups.current[i];
      if (group) {
        group.visible = near;
        group.position.set(s.x, 0, s.z);
        group.rotation.y = s.yaw;
      }
      // Each rival rides on its own rims and its own wheel size, so the field
      // is not nineteen copies of one setup.
      const wheelK = car.spec.car.wheelSize / baseWheel;
      const radius = wheel.radius * wheelK;
      scratch.scale.set(wheelK, wheelK, wheelK);
      if (tyres && rims) {
        scratch.qCar.setFromAxisAngle(scratch.up, s.yaw);
        for (let w = 0; w < 4; w++) {
          const front = w < 2;
          const side = w % 2 === 0 ? 1 : -1;
          const lx = side * WHEEL_X;
          const lz = front ? AXLE_FRONT : AXLE_REAR;
          scratch.pos.set(s.x, radius, s.z);
          scratch.pos.x += lx * Math.cos(s.yaw);
          scratch.pos.z -= lx * Math.sin(s.yaw);
          scratch.pos.x += lz * Math.sin(s.yaw);
          scratch.pos.z += lz * Math.cos(s.yaw);
          scratch.qA.copy(scratch.qCar);
          if (front) {
            scratch.qB.setFromAxisAngle(scratch.up, s.steer * 0.32);
            scratch.qA.multiply(scratch.qB);
          }
          scratch.qB.setFromAxisAngle(scratch.axle, car.odometer / radius);
          scratch.qA.multiply(scratch.qB);
          scratch.matrix.compose(scratch.pos, scratch.qA, near ? scratch.scale : ZERO_SCALE);
          tyres.setMatrixAt(i * 4 + w, scratch.matrix);
          rims.setMatrixAt(i * 4 + w, scratch.matrix);
        }
      }
      if (blots) {
        scratch.qCar.setFromAxisAngle(scratch.up, s.yaw);
        scratch.pos.set(s.x, 0.035, s.z);
        scratch.matrix.compose(
          scratch.pos,
          scratch.qCar,
          near ? SHADOW_SCALE : ZERO_SCALE,
        );
        blots.setMatrixAt(i, scratch.matrix);
      }
    }
    if (tyres) tyres.instanceMatrix.needsUpdate = true;
    if (rims) rims.instanceMatrix.needsUpdate = true;
    if (blots) blots.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      {cars.map((car, i) => (
        <group
          key={i}
          ref={(el) => {
            bodyGroups.current[i] = el;
          }}
        >
          <mesh geometry={look.hulls[i]!} material={look.paints[i]!} />
        </group>
      ))}
      <instancedMesh ref={tyreMesh} args={[wheel.tyre, tyreMat, count * 4]} frustumCulled={false} />
      <instancedMesh ref={rimMesh} args={[wheel.rim, rimMat, count * 4]} frustumCulled={false} />
      <instancedMesh ref={blotMesh} args={[blotGeo, blotMat, count]} frustumCulled={false} />
    </group>
  );
}

const ZERO_SCALE = new THREE.Vector3(0, 0, 0);
const SHADOW_SCALE = new THREE.Vector3(2.5, 1, 5.4);

export function Driving3D({
  car,
  model,
  circuit = "deepforest",
  className = "h-[560px]",
  race = null,
}: {
  car: CarConfig;
  model?: THREE.Group | null | undefined;
  circuit?: CircuitId;
  className?: string;
  /** Set for an event: the laps to run and how quick the rivals are (0-100). */
  race?: { laps: number; level: number } | null;
}) {
  const [paused, setPaused] = useState(false);
  const [reset, setReset] = useState(0);
  const [cameraMode, setCameraMode] = useState<CameraMode>("farThird");
  const [lap, setLap] = useState(0);
  const [offTrack, setOffTrack] = useState(false);
  // Race furniture: the countdown the lights are showing, where the player runs
  // in the classification, and the table once the flag is out.
  const [lights, setLights] = useState<number | null>(null);
  const [position, setPosition] = useState<{ pos: number; lap: number; leader: number } | null>(
    null,
  );
  const [results, setResults] = useState<RaceRow[] | null>(null);
  // Damage carried out of the barriers: how bent the car is, the last hit worth
  // reporting, and whether it was bad enough to end the race.
  const [damage, setDamage] = useState(0);
  const [damageInfo, setDamageInfo] = useState<{
    severity: number;
    damage: number;
    wrecked: boolean;
  } | null>(null);
  const input = useRef(new Set<string>());
  const carPos = useRef({ x: 0, z: 0 });
  const sunAnchor = useRef<THREE.Object3D | null>(null);
  const track = useMemo(() => createClubCircuit(circuit), [circuit]);
  // Headlights live on F. They come on by themselves on the night layouts, so
  // Tokyo is readable from the first corner; a daytime circuit starts dark.
  const [headlights, setHeadlights] = useState(false);
  useEffect(() => {
    setHeadlights(track.spec.profile.night);
  }, [track]);
  const racing = race !== null;
  const raceLaps = race?.laps ?? 0;
  const raceLevel = race?.level ?? 0;
  // The event itself: nineteen rivals off the player's own build, the grid they
  // line up on and the guide the AI follows. Rebuilt on every restart, so a
  // fresh race gets a fresh field instead of a grid of half-worn cars.
  const event = useMemo(() => {
    if (!racing) return null;
    const topSpeed = simulate(car).topSpeed;
    const guide = guideFor(track);
    const state: RaceState = {
      phase: "countdown",
      laps: raceLaps,
      level: raceLevel,
      time: 0,
      startAt: 0,
      t0: 0,
      lights: 0,
      guide,
      cars: createField(buildRivals(car, topSpeed), track, topSpeed, raceLevel),
      player: {
        x: 0,
        z: 0,
        vx: 0,
        vz: 0,
        yaw: 0,
        speed: 0,
        index: 0,
        odometer: 0,
        laps: 0,
        best: null,
        offTrack: false,
        finishedAt: null,
        bump: () => {},
        shove: () => {},
      },
    };
    return { state, slot: playerSlot(track, RIVAL_COUNT) };
  }, [racing, car, track, raceLaps, raceLevel, reset]);
  const raceState = event?.state ?? null;
  const [perf, setPerf] = useState<Perf>({
    level: 2,
    fps: 60,
    // Starts where the governor starts, so the first frame is already at the
    // right scale instead of jumping once the first sample lands.
    dpr: Math.min(typeof window === "undefined" ? 1 : window.devicePixelRatio || 1, 2),
  });
  const hudRef = useRef<HTMLSpanElement>(null);
  const speedRef = useRef<HTMLSpanElement>(null);
  const gearRef = useRef<HTMLSpanElement>(null);
  const lapTimeRef = useRef<HTMLSpanElement>(null);
  const rushRef = useRef<HTMLDivElement>(null);
  const streakRef = useRef<HTMLDivElement>(null);
  const rpmBarRef = useRef<HTMLDivElement>(null);
  const rpmTextRef = useRef<HTMLSpanElement>(null);
  const tickRefs = useRef<Array<HTMLSpanElement | null>>([]);
  // Written straight to the DOM: the readout updates without re-rendering the
  // scene, so it costs nothing and never disturbs the frame budget.
  const handleStats = useCallback((p: Perf) => {
    // The frame rate says what the panel allows; the GPU time says how much
    // room is left before it stops keeping up, so both are shown.
    const ms = p.gpuMs ? ` · ${p.gpuMs.toFixed(1)} ms` : "";
    if (hudRef.current) hudRef.current.textContent = `${Math.round(p.fps)} FPS${ms}`;
    // The frame rate itself goes straight to the DOM; only a change of quality
    // level or of render scale is worth reconciling the scene, which is what
    // puts the current scale on the HUD.
    setPerf((prev) =>
      prev.level === p.level && Math.abs(prev.dpr - p.dpr) < 0.06 ? prev : { ...p },
    );
  }, []);
  // Telemetry goes straight to the DOM: the speedo and the gearbox readout
  // update about sixteen times a second without re-rendering the scene tree.
  const handleTelemetry = useCallback(
    (v: number, gear: number, rpm: number, time: number) => {
      if (speedRef.current) speedRef.current.textContent = String(v);
      if (gearRef.current) gearRef.current.textContent = String(gear + 1);
      if (lapTimeRef.current) lapTimeRef.current.textContent = time.toFixed(1);
      if (rpmTextRef.current) rpmTextRef.current.textContent = String(Math.round(rpm / 100) * 100);
      const k = Math.min(1, rpm / car.maxRpm);
      if (rpmBarRef.current) {
        rpmBarRef.current.style.transform = `scaleX(${k})`;
        rpmBarRef.current.style.background = k > 0.92 ? "var(--yellow)" : "var(--primary)";
      }
      // The rush reads the speedo: the frame closes in and the streaks come up
      // as the car gets quick. Pure compositing, so the frame budget is safe.
      const rush = Math.min(1, v / 260);
      const turn = (rush * rush).toFixed(3);
      if (rushRef.current) rushRef.current.style.opacity = turn;
      if (streakRef.current) streakRef.current.style.opacity = turn;
      tickRefs.current.forEach((el, i) => {
        if (el) el.style.background = i <= gear ? "var(--primary)" : "oklch(1 0 0 / 0.18)";
      });
    },
    [car.maxRpm],
  );
  // Stable identity: prevents the reset effect inside DriverCircuit from firing
  // on every render (which would stop the car from ever accelerating).
  const handleLap = useCallback((l: number, _t: number) => {
    setLap(l);
  }, []);
  // The lights and the timing tower, written from the field's own frame loop.
  const handleLights = useCallback((digit: number) => setLights(digit), []);
  const handleStanding = useCallback((pos: number, lapped: number, leader: number) => {
    setPosition((prev) =>
      prev && prev.pos === pos && prev.lap === lapped && prev.leader === leader
        ? prev
        : { pos, lap: lapped, leader },
    );
  }, []);
  const handleFinish = useCallback((rows: RaceRow[]) => setResults(rows), []);
  // A hit against the barrier. Grazes only bend the bodywork, so the race can be
  // continued; a hard one leaves the car unable to go on and asks for a restart.
  const handleImpact = useCallback((severity: number, value: number, wrecked: boolean) => {
    setDamage(Math.round(value * 100));
    setDamageInfo({ severity, damage: value, wrecked });
  }, []);
  const restart = useCallback(() => {
    resetDamage();
    setDamage(0);
    setDamageInfo(null);
    setResults(null);
    setPosition(null);
    input.current.clear();
    setReset((v) => v + 1);
  }, []);
  // The countdown bows out on its own: "¡YA!" lingers just long enough to read.
  useEffect(() => {
    if (lights === null) return;
    const id = window.setTimeout(() => setLights(null), lights === 0 ? 950 : 1150);
    return () => window.clearTimeout(id);
  }, [lights]);
  // The light-hit notice bows out on its own; the wrecked one stays until the
  // race is restarted.
  useEffect(() => {
    if (!damageInfo || damageInfo.wrecked) return;
    const id = window.setTimeout(() => setDamageInfo(null), 5200);
    return () => window.clearTimeout(id);
  }, [damageInfo]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (
        [
          "KeyW",
          "KeyA",
          "KeyS",
          "KeyD",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "Space",
        ].includes(e.code)
      ) {
        e.preventDefault();
        input.current.add(e.code);
      }
      if (e.code === "Escape") setPaused((p) => !p);
      if (e.code === "KeyF") setHeadlights((v) => !v);
      if (e.code === "KeyC")
        setCameraMode((m) =>
          m === "farThird" ? "closeThird" : m === "closeThird" ? "firstPerson" : "farThird",
        );
      if (e.code === "Digit1") setCameraMode("firstPerson");
      if (e.code === "Digit2") setCameraMode("closeThird");
      if (e.code === "Digit3") setCameraMode("farThird");
    };
    const up = (e: KeyboardEvent) => input.current.delete(e.code);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);
  return (
    <div className={`relative w-full ${className}`} aria-label="Conducción libre tridimensional">
      <Canvas
        shadows
        // The scale the governor decided, passed straight back as the canvas
        // ratio: leaving the prop as a range lets any re-render stamp the
        // initial ratio over every decision the governor takes.
        dpr={perf.dpr}
        gl={renderer}
        camera={{ position: [0, 3, -7], fov: 55 }}
        onCreated={({ gl }) => {
          gl.shadowMap.enabled = true;
          // r186 removed PCFSoft: the plain PCF path is now a five-tap Vogel disk
          // behind hardware filtering, and shadow.radius softens it further.
          gl.shadowMap.type = THREE.PCFShadowMap;
        }}
      >
        <PerfContext.Provider value={perf}>
          <Lighting outdoor night={track.spec.profile.night} shadows span={12} anchor={sunAnchor} />
          {/* The sun and the scenery never move; only the cars do. Refreshing
              the depth map on alternate frames halves the shadow pass while
              keeping the car's shadow within one frame of its wheels. */}
          <ShadowThrottle />
          <TimeSlicedReflections anchor={sunAnchor} />
          <TrackEnvironment track={track} />
          <DriverCircuit
            car={car}
            model={model}
            paused={paused}
            reset={reset}
            input={input}
            onTelemetry={handleTelemetry}
            cameraMode={cameraMode}
            track={track}
            carPos={carPos}
            onLap={handleLap}
            onOffTrack={setOffTrack}
            onImpact={handleImpact}
            anchorRef={sunAnchor}
            race={raceState}
            spawn={event?.slot ?? null}
            headlights={headlights}
          />
          {raceState && (
            <RivalField
              key={reset}
              race={raceState}
              track={track}
              playerColor={car.color}
              baseWheel={car.wheelSize}
              onLights={handleLights}
              onStandings={handleStanding}
              onFinish={handleFinish}
            />
          )}
          <AdaptiveResolution
            enabled={!paused}
            onStats={handleStats}
            minDpr={1.1}
            floorDpr={1}
          />
          {/* Native-density FXAA plus in-pass unsharp masking. The extra
              multisample target cost ~15 FPS from the driver's eye, so the
              shader does the edge work without that resolve. */}
          <FxaaPass samples={0} />
        </PerfContext.Provider>
      </Canvas>
      <div className="scene-vignette" aria-hidden />
      {/* Speed rush: the frame closes in and two streaks pull past as the car
          gets quick. Compositor work only, driven straight from the speedo. */}
      <div ref={rushRef} className="speed-rush" aria-hidden />
      <div ref={streakRef} className="speed-streaks" aria-hidden />
      <Minimap track={track} carRef={carPos} />
      <div className="absolute left-4 top-4 bg-background/80 p-4">
        <span ref={speedRef} className="font-mono text-3xl" data-testid="driving-speed">
          0
        </span>
        <span className="ml-2 text-xs text-muted-foreground">km/h</span>
      </div>
      <div className="absolute left-4 top-20 bg-background/80 p-2 font-mono text-xs">
        {raceState ? (
          <>
            <div data-testid="race-position">
              P {position?.pos ?? RIVAL_COUNT + 1} / {RIVAL_COUNT + 1}
            </div>
            <div>
              Vuelta: {Math.min(lap + 1, raceState.laps)} / {raceState.laps}
            </div>
            <div className="text-muted-foreground">
              IA {raceState.level} · {aiBand(raceState.level).label}
            </div>
          </>
        ) : (
          <div>Vuelta: {lap}</div>
        )}
        <div>
          Tiempo: <span ref={lapTimeRef}>0.0</span>s
        </div>
        {offTrack && <div className="text-red-500">¡Fuera de pista!</div>}
        {damage > 0 && (
          <div
            className={damage >= 60 ? "text-red-400" : "text-amber-400"}
            data-testid="driving-damage"
          >
            Daño: {damage}%
          </div>
        )}
      </div>
      {/* The lights: three, two, one, go. */}
      {raceState && lights !== null && (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
          <div className="text-center">
            <span
              className={`font-display text-7xl leading-none tracking-widest drop-shadow-lg ${
                lights === 0 ? "text-green-400" : "text-foreground"
              }`}
              data-testid="race-lights"
            >
              {lights === 0 ? "¡YA!" : lights}
            </span>
            <p className="mt-3 font-mono text-[10px] tracking-[0.3em] text-muted-foreground uppercase">
              {lights === 0 ? "A fondo" : "Preparados"}
            </p>
          </div>
        </div>
      )}
      {/* A hit the race can survive: the car is bent but still rolling. */}
      {damageInfo && !damageInfo.wrecked && (
        <div className="pointer-events-none absolute left-1/2 top-20 z-20 w-[min(420px,72vw)] -translate-x-1/2 rounded-lg border border-amber-400/40 bg-background/85 px-4 py-2 text-center font-mono text-xs">
          <div className="text-amber-400">Golpe de {damageInfo.severity} km/h</div>
          <div className="text-muted-foreground">
            Daño {Math.round(damageInfo.damage * 100)}% · podés seguir, pero el auto perdió
            rendimiento
          </div>
        </div>
      )}
      {/* A hit it cannot: the engine is gone and the race has to start again. */}
      {damageInfo?.wrecked && (
        <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center bg-background/70">
          <div
            className="glass pointer-events-auto w-[min(400px,86vw)] rounded-xl border border-white/15 p-6 text-center"
            data-testid="driving-wrecked"
          >
            <p className="font-display text-lg tracking-widest uppercase text-red-400">
              Accidente grave
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              El impacto de {damageInfo.severity} km/h dejó el auto sin motor. Para seguir hay que
              reiniciar la carrera.
            </p>
            <div className="mt-4 flex justify-center">
              <Button onClick={restart} className="gap-2" data-testid="driving-restart">
                <RotateCcw className="h-4 w-4" />
                Reiniciar carrera
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* GT-style gearbox cluster: the gear you are in, how many the car has and
          a rev bar that turns yellow as it reaches the limiter. The number of
          gears is whatever the build chose in the gearbox station. */}
      <div className="absolute bottom-14 right-4 flex items-end gap-3 border-l-2 border-primary bg-background/85 px-3 py-2">
        <div className="flex flex-col items-center leading-none">
          <span className="font-mono text-[9px] uppercase text-muted-foreground">Marcha</span>
          <span ref={gearRef} className="font-mono text-4xl" data-testid="driving-gear">
            1
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex gap-[3px]">
            {Array.from({ length: car.gears }, (_, i) => (
              <span
                key={i}
                ref={(el) => {
                  tickRefs.current[i] = el;
                }}
                className="block h-2 w-4"
                style={{ background: "oklch(1 0 0 / 0.18)" }}
              />
            ))}
          </div>
          <div className="h-2 w-44" style={{ background: "oklch(1 0 0 / 0.18)" }}>
            <div ref={rpmBarRef} className="h-full w-full origin-left scale-x-0 bg-primary" />
          </div>
          <span className="font-mono text-[9px] text-muted-foreground">
            <span ref={rpmTextRef}>0</span> / {car.maxRpm} RPM · {car.gears} MARCHAS ·{" "}
            {car.gearbox.toUpperCase()}
          </span>
        </div>
      </div>
      <div className="gloss absolute right-4 bottom-4 flex items-center gap-2 rounded-lg border border-white/15 bg-background/85 px-3 py-1.5 font-mono text-xs">
        <span className="text-[9px] tracking-[0.18em] text-muted-foreground uppercase">
          Rendimiento
        </span>
        <span ref={hudRef} className="text-foreground" data-testid="driving-fps">
          -- FPS
        </span>
        <span className="text-muted-foreground" data-testid="driving-scale">
          {perf.dpr.toFixed(2).replace(".", ",")}× ·{" "}
          {perf.level === 2 ? "ALTA" : perf.level === 1 ? "MEDIA" : "FLUIDA"}
        </span>
      </div>
      <div className="absolute right-4 top-4 flex gap-2">
        <Button
          size="icon"
          variant="secondary"
          title={paused ? "Continuar" : "Pausar"}
          aria-label={paused ? "Continuar" : "Pausar"}
          onClick={() => setPaused((v) => !v)}
        >
          {paused ? <Play /> : <Pause />}
        </Button>
        <Button
          size="icon"
          variant={headlights ? "default" : "secondary"}
          title={headlights ? "Apagar luces (F)" : "Encender luces (F)"}
          aria-label={headlights ? "Apagar luces" : "Encender luces"}
          aria-pressed={headlights}
          data-testid="driving-lights"
          onClick={() => setHeadlights((v) => !v)}
        >
          <Lightbulb />
        </Button>
        <Button
          size="icon"
          variant="secondary"
          title="Cambiar cámara (C)"
          aria-label="Cambiar cámara"
          onClick={() =>
            setCameraMode((m) =>
              m === "farThird" ? "closeThird" : m === "closeThird" ? "firstPerson" : "farThird",
            )
          }
        >
          <Camera />
        </Button>
        <Button
          size="icon"
          variant="secondary"
          title="Reiniciar conducción"
          aria-label="Reiniciar conducción"
          onClick={restart}
        >
          <RotateCcw />
        </Button>
      </div>
      {paused && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="bg-background/85 px-6 py-4 text-center">
            <span className="font-display tracking-widest">PAUSA</span>
            <div className="mt-2 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-left font-mono text-[10px] text-muted-foreground">
              <span className="text-foreground">W / S</span>
              <span>Acelerar · frenar y reversa</span>
              <span className="text-foreground">A / D</span>
              <span>Doblar</span>
              <span className="text-foreground">Espacio</span>
              <span>Derrape</span>
              <span className="text-foreground">1 · 2 · 3 · C</span>
              <span>Cambiar cámara</span>
              <span className="text-foreground">F</span>
              <span>Luces cortas</span>
              <span className="text-foreground">ESC</span>
              <span>Salir de la pausa</span>
            </div>
          </div>
        </div>
      )}
      {/* The flag: the whole field is classified, winners by time and the rest
          by how far they got before the leaders were home. */}
      {results && (
        <div className="absolute inset-0 z-40 grid place-items-center bg-background/75 p-4">
          <div
            className="glass flex max-h-full w-[min(560px,94vw)] flex-col rounded-xl border border-white/15 p-4"
            data-testid="race-results"
          >
            <p className="font-display text-lg tracking-widest uppercase">Clasificación</p>
            <p className="font-mono text-[10px] text-muted-foreground">
              {raceState
                ? `${raceState.laps} vueltas · IA ${raceState.level} ${aiBand(raceState.level).label}`
                : ""}
            </p>
            <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
              <table className="w-full font-mono text-[11px]">
                <thead className="text-[9px] tracking-[0.18em] text-muted-foreground uppercase">
                  <tr>
                    <th className="w-7 text-left">P</th>
                    <th className="text-left">Piloto</th>
                    <th className="w-16 text-right">Mejor</th>
                    <th className="w-16 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((row) => (
                    <tr key={row.pos} className={row.player ? "text-primary" : "text-foreground"}>
                      <td className="py-[1px]">{row.pos}</td>
                      <td className="py-[1px]">
                        <span
                          className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
                          style={{ background: row.color }}
                        />
                        {row.player ? "Vos" : row.name}
                      </td>
                      <td className="py-[1px] text-right">
                        {row.best !== null ? raceTime(row.best) : "—"}
                      </td>
                      <td className="py-[1px] text-right">
                        {row.finishedAt !== null
                          ? raceTime(row.finishedAt)
                          : `+${(row.gap ?? 0).toFixed(1)}s`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex justify-center gap-2">
              <Button onClick={restart} className="gap-2" data-testid="race-restart">
                <RotateCcw className="h-4 w-4" />
                Reiniciar carrera
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Race (straight line, kept for comparison) ────────────────────────────────

function Roadside() {
  const c = useMemo(palette, []);
  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.04} receiveShadow>
        <planeGeometry args={[1500, 1500]} />
        <meshStandardMaterial color={c.grass} roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.015} receiveShadow>
        <planeGeometry args={[16, 1400]} />
        <meshStandardMaterial color={c.asphalt} roughness={0.9} />
      </mesh>
      {[-8, 8].map((x) => (
        <group key={x}>
          <mesh position={[x, 0.02, 0]} rotation-x={-Math.PI / 2}>
            <planeGeometry args={[0.16, 1400]} />
            <meshBasicMaterial color={c.line} />
          </mesh>
          <mesh position={[x * 1.25, 0.4, 0]}>
            <boxGeometry args={[0.12, 0.8, 1400]} />
            <meshStandardMaterial color={c.metal} metalness={0.5} roughness={0.5} />
          </mesh>
        </group>
      ))}
    </>
  );
}

export function Race3D({
  car,
  rival,
  me,
  rv,
  running,
}: {
  car: CarConfig;
  rival: CarConfig;
  me: Sample | null;
  rv: Sample | null;
  running: boolean;
}) {
  return (
    <div className="relative h-[450px] w-full" aria-label="Prueba de aceleración tridimensional">
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={renderer}
        camera={{ position: [11, 9, 16], fov: 46 }}
        onCreated={({ gl }) => {
          gl.shadowMap.enabled = true;
          // r186 removed PCFSoft: the plain PCF path is now a five-tap Vogel disk
// behind hardware filtering, and shadow.radius softens it further.
gl.shadowMap.type = THREE.PCFShadowMap;
        }}
      >
        <Lighting outdoor shadows span={26} />
        <TimeSlicedReflections />
        <Roadside />
        {[
          [car, me, -2.5],
          [rival, rv, 2.5],
        ].map(([config, sample, x], i) => (
          <group
            key={i}
            position={[
              x as number,
              0,
              4 - (Math.min((sample as Sample | null)?.x ?? 0, 402) / 402) * 22,
            ]}
          >
            <Vehicle car={config as CarConfig} installed={Array(9).fill(true)} focus="Prueba" />
          </group>
        ))}
        <AdaptiveResolution enabled={running} />
        <FxaaPass samples={2} />
      </Canvas>
      <div className="scene-vignette" aria-hidden />
    </div>
  );
}

