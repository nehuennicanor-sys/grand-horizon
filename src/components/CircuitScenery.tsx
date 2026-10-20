import { useContext, useEffect, useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ChunkCuller, ChunkedInstances, ChunkedMerged, type ChunkItem } from "@/components/chunked";
import { buildCity, buildSkyline, seaOf } from "@/components/city";
import { PerfContext } from "@/components/perf-context";
import { type ClubCircuit } from "@/lib/club-circuit";
import { makeRng } from "@/lib/prng";

// Everything here is batched statically and drawn from InstancedMeshes split
// into arcs of the lap (see chunked.tsx): a whole city plus every grandstand and
// its crowd costs a few dozen draw calls, each arc culls on its own, and the
// far variants take over once a stand is small enough on screen that nobody can
// tell a head from a shoulder.

// The crowd keeps to the same sober combination as the interface: dark navy,
// steel and white with the odd blue coat, so the grandstands read as a solid
// block instead of a rainbow of shirts.
const SEAT_COLORS = [
  "#1c2530",
  "#2b3a4a",
  "#e8edf2",
  "#33566e",
  "#8c98a6",
  "#152232",
  "#44637d",
  "#cfd8e0",
];

const SKIN = ["#e8b98f", "#c98d5f", "#8d5a34", "#f2d0ae", "#5f3a24"];

const FLAG_COLORS = ["#e8edf2", "#1f56b4", "#c9a227", "#e0483c", "#2a6ac6"];

/** Mipmaps on, plus anisotropic filtering: distant textures cost less memory bandwidth. */
function tune<T extends THREE.Texture>(texture: T, repeat?: number): T {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  if (repeat) texture.repeat.set(repeat, repeat);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 16;
  return texture;
}

/** True when (x,z) is at least `min` metres away from every point of the lap. */
function clearOfTrack(track: ClubCircuit, x: number, z: number, min: number) {
  const m = min * min;
  for (let i = 0; i < 600; i += 2) {
    const p = track.points[i]!;
    if ((x - p.x) ** 2 + (z - p.z) ** 2 < m) return false;
  }
  return true;
}

// ─── Shared geometries (built once, shared by every chunk) ───────────────────

const CROWD_BODY = new THREE.BoxGeometry(0.44, 0.78, 0.36);
const CROWD_HEAD = new THREE.BoxGeometry(0.24, 0.24, 0.24);
const FLAG = new THREE.BoxGeometry(0.5, 0.34, 0.03);

// The crowd is one of the few families where a lower-detail variant is worth
// it: past ~150 m a head is 2 px, and the rows are dense enough that dropping
// every second spectator is invisible from the cockpit.
const CROWD_BODY_FAR = new THREE.BoxGeometry(0.5, 0.82, 0.38);

function Grandstands({ track, level }: { track: ClubCircuit; level: number }) {
  const profile = track.spec.profile;
  const rng = useMemo(() => makeRng(profile.crowdSeed), [profile.crowdSeed]);
  const model = useMemo(() => {
    const stands = Math.max(
      1,
      Math.round(profile.stands * (level >= 2 ? 1 : level === 1 ? 0.7 : 0.4)),
    );
    const steps = 8;
    const peoplePerRow = level >= 2 ? 22 : level === 1 ? 13 : 6;
    const stepRise = 0.75;
    const stepDepth = 1.3;
    const width = 50;
    const rowHalf = width / 2 - 1.6;
    /** Worst approach of a stand's front row to any point of the lap. */
    const rowNear = (cx: number, cz: number, yaw: number) => {
      const ax = Math.cos(yaw);
      const az = -Math.sin(yaw);
      let near = Infinity;
      for (let k = -2; k <= 2; k++) {
        const sx = cx + ax * rowHalf * (k / 2);
        const sz = cz + az * rowHalf * (k / 2);
        for (let i = 0; i < 600; i += 3) {
          const p = track.points[i]!;
          near = Math.min(near, (sx - p.x) ** 2 + (sz - p.z) ** 2);
        }
      }
      return near;
    };

    const standXf: { pos: THREE.Vector3; yaw: number }[] = [];
    // The first stand is fixed: a main grandstand on the start straight, facing
    // the pits and set slightly ahead of the line so the crowd is in view as
    // the lap begins.
    const mainIndex = 21;
    standXf.push({
      pos: new THREE.Vector3(
        track.points[mainIndex]!.x + track.rights[mainIndex]!.x * (track.halfWidth + 11),
        0,
        track.points[mainIndex]!.z + track.rights[mainIndex]!.z * (track.halfWidth + 11),
      ),
      yaw: Math.atan2(-track.rights[mainIndex]!.x, -track.rights[mainIndex]!.z),
    });
    // The rest are spread around the lap, always on the outside of the curve so
    // the crowd looks across the track from behind the barrier line.
    for (let s = 1; s < stands; s++) {
      const u = (s / stands + 0.02) % 1;
      const index = Math.floor(u * 600) % 600;
      const point = track.points[index]!;
      const right = track.rights[index]!;
      const off = track.halfWidth + 9;
      // A stand is fifty metres wide, so its corners swing far around a corner:
      // the clearance is measured across the whole front row, not just at its
      // centre, and the side with more room wins.
      const cand = [1, -1].map((sign) => {
        const x = point.x + right.x * off * sign;
        const z = point.z + right.z * off * sign;
        const yaw = Math.atan2(-right.x * sign, -right.z * sign);
        return { sign, x, z, near: rowNear(x, z, yaw), yaw };
      });
      const best = cand.sort((a, b) => b.near - a.near)[0]!;
      standXf.push({ pos: new THREE.Vector3(best.x, 0, best.z), yaw: best.yaw });
    }

    // However carefully a stand was placed, it can still lean over the road
    // where the lap doubles back on itself: nudge such a stand straight back
    // until its whole front row clears the barrier line.
    standXf.forEach(({ pos, yaw }) => {
      for (let k = 0; k < 8 && rowNear(pos.x, pos.z, yaw) < (track.halfWidth + 4) ** 2; k++) {
        pos.x -= Math.sin(yaw) * 6;
        pos.z -= Math.cos(yaw) * 6;
      }
    });

    const stepsItems: ChunkItem[] = [];
    const roofItems: ChunkItem[] = [];
    const sideItems: ChunkItem[] = [];
    const bodyItems: ChunkItem[] = [];
    const farBodyItems: ChunkItem[] = [];
    const headItems: ChunkItem[] = [];
    const flagItems: ChunkItem[] = [];
    const columnItems: ChunkItem[] = [];

    standXf.forEach(({ pos, yaw }, s) => {
      const sinY = Math.sin(yaw);
      const cosY = Math.cos(yaw);
      for (let r = 0; r < steps; r++) {
        // Each step sits further back and higher: a classic tiered grandstand.
        const back = r * stepDepth;
        stepsItems.push({ p: [pos.x - sinY * back, stepRise * (r + 0.5), pos.z - cosY * back], r: yaw });
        for (let p = 0; p < peoplePerRow; p++) {
          const lx = -width / 2 + 1.4 + (p / Math.max(1, peoplePerRow - 1)) * (width - 2.8);
          const jitter = (rng() - 0.5) * 0.5;
          const localX = lx + jitter;
          const px = pos.x + cosY * localX - sinY * back;
          const pz = pos.z - sinY * localX - cosY * back;
          const py = stepRise * (r + 1) + 0.39;
          const scale = 0.94 + rng() * 0.12;
          bodyItems.push({
            p: [px, py, pz],
            r: yaw,
            s: [scale, scale, scale],
            c: SEAT_COLORS[Math.floor(rng() * SEAT_COLORS.length)]!,
          });
          if (rng() < 0.5) {
            farBodyItems.push({
              p: [px, py, pz],
              r: yaw,
              s: [scale, scale, scale],
              c: SEAT_COLORS[Math.floor(rng() * SEAT_COLORS.length)]!,
            });
          }
          headItems.push({
            p: [px, py + 0.5, pz],
            r: yaw,
            c: SKIN[Math.floor(rng() * SKIN.length)]!,
          });
          // Every so often somebody holds up a flag: the little bit of motion
          // that makes a stand look inhabited rather than modelled.
          if (rng() < 0.012) {
            flagItems.push({
              p: [px, py + 1.15, pz],
              r: yaw + (rng() - 0.5) * 0.4,
              c: FLAG_COLORS[Math.floor(rng() * FLAG_COLORS.length)]!,
            });
          }
        }
      }
      const midBack = (steps * stepDepth) / 2;
      roofItems.push({
        p: [pos.x - sinY * midBack, stepRise * steps + 0.9, pos.z - cosY * midBack],
        r: yaw,
      });
      for (const side of [-1, 1]) {
        sideItems.push({
          p: [
            pos.x + cosY * side * (width / 2 + 0.3) - sinY * midBack,
            stepRise * steps * 0.5 + 0.8,
            pos.z - sinY * side * (width / 2 + 0.3) - cosY * midBack,
          ],
          r: yaw,
        });
        // Roof columns: a real stand is held up by steel, and they give the
        // silhouette something to read against the sky.
        columnItems.push({
          p: [
            pos.x + cosY * side * (width / 2 - 1.4) - sinY * (steps * stepDepth + 0.6),
            0,
            pos.z - sinY * side * (width / 2 - 1.4) - cosY * (steps * stepDepth + 0.6),
          ],
          r: yaw,
        });
      }
    });

    return {
      stands,
      stepsItems,
      roofItems,
      sideItems,
      bodyItems,
      farBodyItems,
      headItems,
      flagItems,
      columnItems,
    };
  }, [profile, rng, track, level]);

  const standMat = useMemo(() => new THREE.MeshLambertMaterial({ color: "#c9ccd2" }), []);
  const roofMat = useMemo(() => new THREE.MeshLambertMaterial({ color: "#4a4f59" }), []);
  const sideMat = useMemo(() => new THREE.MeshLambertMaterial({ color: "#9aa0a8" }), []);
  const bodyMat = useMemo(() => new THREE.MeshLambertMaterial({}), []);
  const headMat = useMemo(() => new THREE.MeshLambertMaterial({}), []);
  const flagMat = useMemo(() => new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), []);
  const colMat = useMemo(() => new THREE.MeshLambertMaterial({ color: "#8a9099" }), []);
  const stepGeo = useMemo(() => new THREE.BoxGeometry(50, 0.75, 1.3), []);
  const roofGeo = useMemo(() => new THREE.BoxGeometry(53, 0.34, 1.3 * 8 * 0.75), []);
  const sideGeo = useMemo(() => new THREE.BoxGeometry(0.5, 0.75 * 8 + 1.6, 1.3 * 8), []);
  const colGeo = useMemo(() => new THREE.BoxGeometry(0.34, 7.6, 0.34), []);
  const flagGeo = FLAG;

  const arcs = Math.min(8, model.stands);
  return (
    <group>
      <ChunkedInstances geometry={stepGeo} material={standMat} items={model.stepsItems} arcs={arcs} radius={520} />
      <ChunkedInstances geometry={roofGeo} material={roofMat} items={model.roofItems} arcs={arcs} radius={640} />
      <ChunkedInstances geometry={sideGeo} material={sideMat} items={model.sideItems} arcs={arcs} radius={520} />
      <ChunkedInstances geometry={colGeo} material={colMat} items={model.columnItems} arcs={arcs} radius={520} />
      <ChunkedInstances
        geometry={CROWD_BODY}
        material={bodyMat}
        items={model.bodyItems}
        arcs={arcs}
        radius={480}
        lod={{ geometry: CROWD_BODY_FAR, items: model.farBodyItems, distance: 140 }}
      />
      <ChunkedInstances
        geometry={CROWD_HEAD}
        material={headMat}
        items={model.headItems}
        arcs={arcs}
        radius={140}
      />
      <ChunkedInstances geometry={flagGeo} material={flagMat} items={model.flagItems} arcs={arcs} radius={170} />
    </group>
  );
}

function Cityscape({ track, level }: { track: ClubCircuit; level: number }) {
  const profile = track.spec.profile;
  const build = useMemo(() => buildCity(track, level), [track, level]);
  const facade = useMemo(
    () =>
      new THREE.MeshLambertMaterial({
        map: build.facade.map,
        emissive: new THREE.Color(profile.night && build.facade.emissive ? "#ffffff" : "#000000"),
        emissiveMap: build.facade.emissive,
        emissiveIntensity: profile.night ? 1.2 : 0,
      }),
    [build.facade, profile.night],
  );
  const store = useMemo(
    () =>
      new THREE.MeshLambertMaterial({
        map: build.store.map,
        emissive: new THREE.Color(profile.night && build.store.emissive ? "#ffffff" : "#000000"),
        emissiveMap: build.store.emissive,
        emissiveIntensity: profile.night ? 1.32 : 0,
      }),
    [build.store, profile.night],
  );
  const detail = useMemo(() => new THREE.MeshLambertMaterial({ vertexColors: true }), []);
  const neon = useMemo(
    () => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    [],
  );
  useEffect(
    () => () => {
      facade.dispose();
      store.dispose();
      detail.dispose();
      neon.dispose();
    },
    [facade, store, detail, neon],
  );
  const chunks = useMemo(
    () =>
      build.chunks.map((chunk) => ({
        x: chunk.x,
        z: chunk.z,
        spread: chunk.spread,
        parts: [
          { geometry: chunk.facade, material: facade },
          { geometry: chunk.store, material: store },
          { geometry: chunk.detail, material: detail },
          { geometry: chunk.neon, material: neon },
        ],
      })),
    [build.chunks, facade, store, detail, neon],
  );
  return <ChunkedMerged chunks={chunks} radius={540} />;
}

// ─── Landscape ────────────────────────────────────────────────────────────────
// The features that make one original GT layout read differently from another:
// boulders on the mountain pass, palms and a bay on the coast, and the concrete
// portals that span the expressway (rock arches on the mountain).
function Terrain({ track, level }: { track: ClubCircuit; level: number }) {
  const profile = track.spec.profile;
  const rng = useMemo(() => makeRng(profile.crowdSeed + 311), [profile.crowdSeed]);
  const model = useMemo(() => {
    const palmTrunks: ChunkItem[] = [];
    const palmFronds: ChunkItem[] = [];
    const pillars: ChunkItem[] = [];
    const beams: ChunkItem[] = [];
    const hulls: ChunkItem[] = [];
    const cabins: ChunkItem[] = [];
    const masts: ChunkItem[] = [];
    let pier: { x: number; z: number; yaw: number } | null = null;
    const sea = seaOf(track);
    const scale = level >= 2 ? 1 : level === 1 ? 0.65 : 0.3;
    const euler = new THREE.Euler();

    // Palms are street furniture on a city lap: they belong between the catch
    // fence and the shopfronts, not scattered through the blocks behind them.
    const palmCount = Math.round(profile.palms * scale);
    let n = 0;
    for (let i = 0; i < palmCount * 8 && n < palmCount; i++) {
      const index = Math.floor(rng() * 600) % 600;
      const point = track.points[index]!;
      const right = track.rights[index]!;
      const sign = rng() < 0.5 ? 1 : -1;
      const dist =
        profile.kind === "city"
          ? track.halfWidth + 5 + rng() * 2.8
          : track.halfWidth + 9 + rng() * 52;
      const x = point.x + right.x * dist * sign + (rng() - 0.5) * (profile.kind === "city" ? 1.5 : 14);
      const z = point.z + right.z * dist * sign + (rng() - 0.5) * (profile.kind === "city" ? 1.5 : 14);
      if (!clearOfTrack(track, x, z, track.halfWidth + (profile.kind === "city" ? 4.7 : 7))) continue;
      const s = 0.85 + rng() * 0.5;
      const yaw = rng() * Math.PI;
      palmTrunks.push({ p: [x, 2.7 * s, z], r: yaw, s: [s, s, s] });
      euler.set((rng() - 0.5) * 0.3, rng() * Math.PI, (rng() - 0.5) * 0.3);
      palmFronds.push({
        p: [x, 5.4 * s, z],
        r: euler.y,
        s: [3.1 * s, 0.85 * s, 3.1 * s],
        c: rng() < 0.4 ? "#4c8a3f" : "#3b7134",
      });
      n++;
    }

    // Water: a bay with a far shore for the harbour city, an open sea
    // elsewhere. Boats and a pier give the water a scale and an edge.
    if (sea) {
      const land = sea.angle + Math.PI;
      const boats = profile.kind === "city" ? (level >= 2 ? 18 : level === 1 ? 11 : 5) : level >= 2 ? 9 : 5;
      const HULL_COLORS = ["#f2f5f7", "#e8edf2", "#dfe5ea", "#c7d6e2", "#33465a", "#8c2f2f"];
      for (let i = 0; i < boats; i++) {
        const a = land + (rng() - 0.5) * 1.35;
        const dist = sea.r - 24 - rng() * (profile.kind === "city" ? 74 : 170);
        const x = sea.x + Math.cos(a) * dist;
        const z = sea.z + Math.sin(a) * dist;
        const yaw = rng() * Math.PI * 2;
        const s = 0.8 + rng() * 0.35;
        hulls.push({
          p: [x, 0.32 * s, z],
          r: yaw,
          s: [s, s, s],
          c: HULL_COLORS[Math.floor(rng() * HULL_COLORS.length)]!,
        });
        cabins.push({ p: [x, 0.74 * s, z], r: yaw, s: [s, s, s] });
        masts.push({ p: [x, 1.9 * s, z], r: yaw, s: [s, s, s] });
      }
      if (sea.bay) {
        const outward = { x: Math.cos(sea.angle), z: Math.sin(sea.angle) };
        const shoreX = sea.x + Math.cos(land) * sea.r;
        const shoreZ = sea.z + Math.sin(land) * sea.r;
        pier = {
          x: shoreX + outward.x * 38,
          z: shoreZ + outward.z * 38,
          yaw: Math.atan2(outward.x, outward.z),
        };
        // A promenade row of palms on the land side of the quay.
        const palms = level >= 2 ? 15 : level === 1 ? 9 : 4;
        for (let i = 0; i < palms; i++) {
          const a = land + ((i / Math.max(1, palms - 1)) - 0.5) * 1.25;
          const rr = sea.r + 8 + rng() * 7;
          const x = sea.x + Math.cos(a) * rr;
          const z = sea.z + Math.sin(a) * rr;
          if (!clearOfTrack(track, x, z, track.halfWidth + 5)) continue;
          const s = 0.9 + rng() * 0.3;
          palmTrunks.push({ p: [x, 2.7 * s, z], r: rng() * Math.PI, s: [s, s, s] });
          palmFronds.push({
            p: [x, 5.4 * s, z],
            r: rng() * Math.PI,
            s: [3.1 * s, 0.85 * s, 3.1 * s],
            c: rng() < 0.4 ? "#4c8a3f" : "#3b7134",
          });
        }
      }
    }

    const portalCount = Math.max(0, Math.round(profile.overpasses * scale));
    const rock = profile.kind === "mountain";
    for (let i = 0; i < portalCount; i++) {
      const index =
        Math.floor((0.12 + 0.76 * ((i + 0.5) / portalCount)) * 600 + (rng() - 0.5) * 14) % 600;
      const point = track.points[index]!;
      const right = track.rights[index]!;
      const yaw = Math.atan2(-right.z, right.x);
      const off = track.halfWidth + 4.4;
      // A portal is placed from its own station alone, so where the lap runs
      // past itself a leg can land on the other carriageway. Each leg is checked
      // against every *other* part of the lap and the portal is dropped outright
      // when it cannot stand clear.
      let clear = true;
      for (const side of [1, -1]) {
        const lx = point.x + right.x * off * side;
        const lz = point.z + right.z * off * side;
        for (let j = 0; j < 600 && clear; j += 2) {
          const gap = Math.min(Math.abs(j - index), 600 - Math.abs(j - index));
          if (gap < 16) continue;
          const p = track.points[j]!;
          if ((lx - p.x) ** 2 + (lz - p.z) ** 2 < (track.halfWidth + 2.4) ** 2) clear = false;
        }
        if (!clear) break;
      }
      if (!clear) continue;
      pillars.push({ p: [point.x + right.x * off, 6, point.z + right.z * off], r: yaw });
      pillars.push({ p: [point.x - right.x * off, 6, point.z - right.z * off], r: yaw });
      beams.push({ p: [point.x, rock ? 6.6 : 6, point.z], r: yaw });
    }
    return {
      sea,
      palmTrunks,
      palmFronds,
      pillars,
      beams,
      hulls,
      cabins,
      masts,
      pier,
      rock: profile.kind === "mountain",
    };
  }, [profile, rng, track, level]);

  const trunkMat = useMemo(() => new THREE.MeshLambertMaterial({ color: "#8a7355" }), []);
  const frondMat = useMemo(() => new THREE.MeshLambertMaterial({}), []);
  const concreteMat = useMemo(
    () =>
      new THREE.MeshLambertMaterial({
        color: model.rock ? "#6f6658" : profile.night ? "#6d747d" : "#8b9099",
      }),
    [model.rock, profile.night],
  );
  const seaMat = useMemo(
    () => new THREE.MeshLambertMaterial({ color: profile.water ?? "#1c4a6b" }),
    [profile.water],
  );
  const quayMat = useMemo(
    () => new THREE.MeshLambertMaterial({ color: profile.night ? "#565d66" : "#aaa9a4" }),
    [profile.night],
  );
  const hullMat = useMemo(() => new THREE.MeshLambertMaterial({}), []);
  const cabinMat = useMemo(() => new THREE.MeshLambertMaterial({ color: "#eef2f5" }), []);
  const mastMat = useMemo(() => new THREE.MeshLambertMaterial({ color: "#c3cbd3" }), []);
  const trunkGeo = useMemo(() => new THREE.CylinderGeometry(0.16, 0.3, 5.4, 6), []);
  const trunkGeoFar = useMemo(() => new THREE.CylinderGeometry(0.16, 0.3, 5.4, 4), []);
  const frondGeo = useMemo(() => new THREE.IcosahedronGeometry(1, 0), []);
  const pillarGeo = useMemo(() => new THREE.BoxGeometry(1.2, 12, model.rock ? 4 : 1.5), [model.rock]);
  const beamGeo = useMemo(
    () => new THREE.BoxGeometry(track.halfWidth * 2 + 9.6, model.rock ? 3.6 : 1.2, model.rock ? 6.4 : 5.4),
    [model.rock, track.halfWidth],
  );
  const hullGeo = useMemo(() => new THREE.BoxGeometry(2.4, 0.75, 5.2), []);
  const cabinGeo = useMemo(() => new THREE.BoxGeometry(1.5, 0.85, 1.9), []);
  const mastGeo = useMemo(() => new THREE.CylinderGeometry(0.05, 0.05, 3.6, 4), []);

  return (
    <group>
      {model.sea && (
        <>
          <mesh position={[model.sea.x, -0.03, model.sea.z]} rotation-x={-Math.PI / 2} material={seaMat}>
            <circleGeometry args={[model.sea.r, 48]} />
          </mesh>
          {/* Promenade / quay around the shoreline. */}
          <mesh
            position={[model.sea.x, 0.02, model.sea.z]}
            rotation-x={-Math.PI / 2}
            material={quayMat}
          >
            <ringGeometry args={[model.sea.r - 7, model.sea.r + 5, 96]} />
          </mesh>
        </>
      )}
      {model.pier && (
        <group position={[model.pier.x, 0, model.pier.z]} rotation-y={model.pier.yaw}>
          <mesh position={[0, 0.34, 0]} material={concreteMat}>
            <boxGeometry args={[5.6, 0.5, 84]} />
          </mesh>
          {[-32, -16, 0, 16, 32].flatMap((z) =>
            [-2.4, 2.4].map((x) => (
              <mesh key={`${x}:${z}`} position={[x, -0.1, z]} material={concreteMat}>
                <boxGeometry args={[0.38, 1.7, 0.38]} />
              </mesh>
            )),
          )}
          <mesh position={[0, 1.6, 24]} material={cabinMat}>
            <boxGeometry args={[3.1, 2.2, 4.2]} />
          </mesh>
          <mesh position={[0, 2.8, 24]} material={concreteMat}>
            <boxGeometry args={[3.5, 0.28, 4.6]} />
          </mesh>
        </group>
      )}
      {model.hulls.length > 0 && (
        <>
          <ChunkedInstances geometry={hullGeo} material={hullMat} items={model.hulls} arcs={6} radius={640} />
          <ChunkedInstances geometry={cabinGeo} material={cabinMat} items={model.cabins} arcs={6} radius={640} />
          <ChunkedInstances geometry={mastGeo} material={mastMat} items={model.masts} arcs={6} radius={520} />
        </>
      )}
      {model.palmTrunks.length > 0 && (
        <>
          <ChunkedInstances
            geometry={trunkGeo}
            material={trunkMat}
            items={model.palmTrunks}
            arcs={8}
            radius={470}
            lod={{ geometry: trunkGeoFar, distance: 120 }}
          />
          <ChunkedInstances geometry={frondGeo} material={frondMat} items={model.palmFronds} arcs={8} radius={470} />
        </>
      )}
      {model.pillars.length > 0 && (
        <>
          <ChunkedInstances geometry={pillarGeo} material={concreteMat} items={model.pillars} arcs={6} radius={620} />
          <ChunkedInstances geometry={beamGeo} material={concreteMat} items={model.beams} arcs={6} radius={620} />
        </>
      )}
    </group>
  );
}

// ─── Sponsor hoardings ────────────────────────────────────────────────────────
// The long branded panels that line a real circuit: they sit behind the barrier
// on alternating sides of the lap and keep to the same blue / white / black /
// yellow family as the interface, so the track reads as a race track and not as
// an empty field.
const BOARD_COLORS = [
  "#1f56b4",
  "#eef3f9",
  "#1b2735",
  "#c9a227",
  "#2a6ac6",
  "#0e1a2b",
  "#4a86e8",
];

function Hoardings({ track, level }: { track: ClubCircuit; level: number }) {
  const model = useMemo(() => {
    const step = level >= 2 ? 12 : level === 1 ? 20 : 42;
    const count = Math.floor(600 / step);
    const boards: ChunkItem[] = [];
    const strips: ChunkItem[] = [];
    for (let i = 0; i < count; i++) {
      const index = (i * step) % 600;
      const point = track.points[index]!;
      const right = track.rights[index]!;
      const sign = i % 2 === 0 ? 1 : -1;
      const dist = track.halfWidth + 8;
      const x = point.x + right.x * dist * sign;
      const z = point.z + right.z * dist * sign;
      const yaw = Math.atan2(-right.x * sign, -right.z * sign);
      boards.push({ p: [x, 0.88, z], r: yaw, c: BOARD_COLORS[i % BOARD_COLORS.length]! });
      strips.push({ p: [x, 1.36, z], r: yaw });
    }
    return { boards, strips };
  }, [track, level]);
  const boardGeo = useMemo(() => new THREE.BoxGeometry(9.8, 1.15, 0.16), []);
  const stripGeo = useMemo(() => new THREE.BoxGeometry(9.3, 0.17, 0.2), []);
  const boardMat = useMemo(() => new THREE.MeshLambertMaterial({}), []);
  const stripMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#f4f7fb" }), []);
  return (
    <group>
      <ChunkedInstances geometry={boardGeo} material={boardMat} items={model.boards} arcs={14} radius={330} />
      <ChunkedInstances geometry={stripGeo} material={stripMat} items={model.strips} arcs={14} radius={330} />
    </group>
  );
}

// ─── Catch fencing ────────────────────────────────────────────────────────────
// A diamond mesh drawn once into a canvas and alpha-tested: the fence of the
// reference photos costs a couple of draw calls and no sorting, because
// alpha-tested geometry stays in the opaque pass.
let fenceTex: THREE.CanvasTexture | null = null;
function fenceTexture() {
  if (fenceTex) return fenceTex;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, 32, 32);
  // A thin wire drawn on a 32 px cell: at the repeat used below a diamond is
  // about 40 cm across, which is what a real catch fence looks like from the
  // cockpit instead of the giant lattice a coarse tiling produces.
  ctx.strokeStyle = "#96a2b0";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(0, 16);
  ctx.lineTo(16, 0);
  ctx.lineTo(32, 16);
  ctx.lineTo(16, 32);
  ctx.closePath();
  ctx.stroke();
  fenceTex = tune(new THREE.CanvasTexture(canvas));
  const tex = fenceTex;
  tex.repeat.set(30, 7);
  return tex;
}

function CatchFence({ track, level }: { track: ClubCircuit; level: number }) {
  const model = useMemo(() => {
    const step = level >= 2 ? 5 : level === 1 ? 9 : 18;
    const dist = track.halfWidth + 4.6;
    const panels: ChunkItem[] = [];
    const postIndex = new Set<number>();
    // Each panel spans from one station to the next and is centred on that
    // chord. Centring it on a single station (the old behaviour) left a
    // half-panel hole between every pair on the longer circuits.
    for (let i = 0; i < 600; i += step) {
      const j = (i + step) % 600;
      const a = track.points[i]!;
      const ar = track.rights[i]!;
      const b = track.points[j]!;
      const br = track.rights[j]!;
      postIndex.add(i);
      postIndex.add(j);
      for (const sign of [1, -1]) {
        const ax = a.x + ar.x * dist * sign;
        const az = a.z + ar.z * dist * sign;
        const bx = b.x + br.x * dist * sign;
        const bz = b.z + br.z * dist * sign;
        const dx = bx - ax;
        const dz = bz - az;
        const len = Math.hypot(dx, dz) || 1;
        panels.push({
          p: [(ax + bx) / 2, 1.55, (az + bz) / 2],
          r: Math.atan2(-dz, dx),
          s: [len + 0.16, 1, 1],
        });
      }
    }
    const posts: ChunkItem[] = [];
    for (const index of postIndex) {
      const point = track.points[index]!;
      const right = track.rights[index]!;
      for (const sign of [1, -1]) {
        const x = point.x + right.x * dist * sign;
        const z = point.z + right.z * dist * sign;
        posts.push({ p: [x, 1.55, z], r: Math.atan2(-right.x * sign, -right.z * sign) });
      }
    }
    return { panels, posts, step };
  }, [track, level]);
  const panelMat = useMemo(
    () =>
      new THREE.MeshLambertMaterial({
        map: fenceTexture(),
        transparent: false,
        alphaTest: 0.35,
        side: THREE.DoubleSide,
        color: "#b9c4d1",
      }),
    [],
  );
  const postMat = useMemo(() => new THREE.MeshLambertMaterial({ color: "#6c757f" }), []);
  const panelGeo = useMemo(() => new THREE.PlaneGeometry(1, 2.9), []);
  const postGeo = useMemo(() => new THREE.BoxGeometry(0.12, 3.3, 0.12), []);
  return (
    <group>
      <ChunkedInstances geometry={panelGeo} material={panelMat} items={model.panels} arcs={16} radius={300} />
      <ChunkedInstances geometry={postGeo} material={postMat} items={model.posts} arcs={16} radius={300} />
    </group>
  );
}

// ─── Distant skyline ──────────────────────────────────────────────────────────
// The city on the horizon of the reference photos: a ring of instanced towers
// far outside the lap, hazed by the scene fog so it sits behind the circuit
// instead of competing with it.
function Skyline({ track, level }: { track: ClubCircuit; level: number }) {
  const profile = track.spec.profile;
  const build = useMemo(() => buildSkyline(track, level), [track, level]);
  // At night the far towers are beyond every practical light, so a Lambert
  // material leaves only the lit windows floating in the dark. The skyline is
  // a painted backdrop: draw its albedo unlit so the whole silhouette — walls,
  // spandrels and windows — stays legible against the haze.
  const facade = useMemo(
    () =>
      profile.night
        ? new THREE.MeshBasicMaterial({
            map: build.facade.map,
            color: "#b9c6da",
            fog: false,
          })
        : new THREE.MeshLambertMaterial({
            map: build.facade.map,
            color: "#dfe6ec",
            fog: false,
          }),
    [build.facade, profile.night],
  );
  const detail = useMemo(
    () => new THREE.MeshLambertMaterial({ vertexColors: true, fog: false }),
    [],
  );
  useEffect(
    () => () => {
      facade.dispose();
      detail.dispose();
    },
    [facade, detail],
  );
  const chunks = useMemo(
    () =>
      build.chunks.map((chunk) => ({
        x: chunk.x,
        z: chunk.z,
        spread: chunk.spread,
        parts: [
          { geometry: chunk.facade, material: facade },
          { geometry: chunk.detail, material: detail },
        ],
      })),
    [build.chunks, facade, detail],
  );
  return <ChunkedMerged chunks={chunks} radius={1180} />;
}

/**
 * Street lamps: behind the catch fence with the arm reaching over the kerb, so
 * the pole is never inside the band the car can reach. City layouts keep them
 * by day too — a modern avenue has lighting columns even when they are off.
 */
function Lamps({ track, level }: { track: ClubCircuit; level: number }) {
  const profile = track.spec.profile;
  const model = useMemo(() => {
    if (!profile.night && profile.kind !== "city") return null;
    const step = level >= 2 ? 22 : level === 1 ? 34 : 60;
    const count = Math.floor(600 / step);
    const poles: ChunkItem[] = [];
    const arms: ChunkItem[] = [];
    const heads: ChunkItem[] = [];
    for (let i = 0; i < count; i++) {
      const index = (i * step) % 600;
      const point = track.points[index]!;
      const right = track.rights[index]!;
      const sign = i % 2 === 0 ? 1 : -1;
      const dist = track.halfWidth + 5.8;
      const x = point.x + right.x * dist * sign;
      const z = point.z + right.z * dist * sign;
      const yaw = Math.atan2(-right.x * sign, -right.z * sign);
      poles.push({ p: [x, 4, z], r: yaw });
      arms.push({ p: [x + Math.sin(yaw) * 0.8, 7.82, z + Math.cos(yaw) * 0.8], r: yaw });
      heads.push({ p: [x + Math.sin(yaw) * 1.45, 7.68, z + Math.cos(yaw) * 1.45], r: yaw });
    }
    return { poles, arms, heads };
  }, [profile, level, track]);
  const poleGeo = useMemo(() => new THREE.BoxGeometry(0.22, 8, 0.22), []);
  const armGeo = useMemo(() => new THREE.BoxGeometry(0.13, 0.13, 3), []);
  const headGeo = useMemo(() => new THREE.BoxGeometry(0.58, 0.26, 1.6), []);
  const poleMat = useMemo(() => new THREE.MeshLambertMaterial({ color: "#3a3f47" }), []);
  const headMat = useMemo(
    () =>
      profile.night
        ? new THREE.MeshBasicMaterial({ color: "#eaf3ff", toneMapped: false })
        : new THREE.MeshLambertMaterial({ color: "#4a515a" }),
    [profile.night],
  );
  if (!model) return null;
  return (
    <group>
      <ChunkedInstances geometry={poleGeo} material={poleMat} items={model.poles} arcs={12} radius={430} />
      <ChunkedInstances geometry={armGeo} material={poleMat} items={model.arms} arcs={12} radius={430} />
      <ChunkedInstances geometry={headGeo} material={headMat} items={model.heads} arcs={12} radius={430} />
    </group>
  );
}

/** A fair-weather cumulus, painted once into a small sprite. */
function cloudTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // A whisper of white under everything: the mip levels then never darken as
  // transparent texels average out.
  ctx.fillStyle = "rgba(255,255,255,0.004)";
  ctx.fillRect(0, 0, 256, 128);
  const puff = (x: number, y: number, r: number, a: number) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.5, `rgba(255,255,255,${a * 0.6})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  puff(64, 80, 42, 0.8);
  puff(104, 66, 54, 0.9);
  puff(152, 72, 48, 0.85);
  puff(192, 86, 34, 0.6);
  puff(88, 92, 38, 0.6);
  puff(140, 94, 40, 0.6);
  puff(46, 96, 24, 0.45);
  const tex = tune(new THREE.CanvasTexture(canvas));
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Clouds: a ring of soft billboards that all face the middle of the circuit, so
 * the one mesh works from any point of the lap. They sit inside the sky dome,
 * ignore the fog — they are the far background — and cost a single draw call.
 */
function Clouds({ level, night }: { level: number; night: boolean }) {
  const texture = useMemo(() => cloudTexture(), []);
  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: texture,
        // After dark a white cumulus deck turns into a wall of floodlights.
        // Keep only a faint, blue-grey haze so the skyline stays the subject.
        color: night ? "#8494ad" : "#f2f6fc",
        transparent: true,
        opacity: night ? 0.26 : 0.9,
        depthWrite: false,
        fog: false,
      }),
    [night, texture],
  );
  const mesh = useMemo(() => {
    const rng = makeRng(90210);
    const count = night ? (level >= 2 ? 10 : level === 1 ? 8 : 6) : level >= 2 ? 24 : level === 1 ? 15 : 9;
    const m = new THREE.InstancedMesh(geometry, material, count);
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rng() * 0.26;
      const r = 520 + rng() * 250;
      const w = night ? 170 + rng() * 210 : 240 + rng() * 320;
      const y = night ? 220 + rng() * 170 : 130 + rng() * 160 + (i % 3) * 26;
      p.set(Math.cos(a) * r, y, Math.sin(a) * r);
      q.setFromAxisAngle(up, Math.atan2(-Math.cos(a), -Math.sin(a)));
      s.set(w, w * (0.36 + rng() * 0.18), 1);
      mtx.compose(p, q, s);
      m.setMatrixAt(i, mtx);
    }
    m.instanceMatrix.needsUpdate = true;
    m.frustumCulled = false;
    m.matrixAutoUpdate = false;
    return m;
  }, [geometry, material, level, night]);
  useEffect(
    () => () => {
      mesh.dispose();
      geometry.dispose();
      material.dispose();
      texture?.dispose();
    },
    [mesh, geometry, material, texture],
  );
  return <primitive object={mesh} />;
}

/** The soft, faded edge of a rubber streak. */
function markTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "rgba(255,255,255,0.004)";
  ctx.fillRect(0, 0, 32, 64);
  const side = ctx.createLinearGradient(0, 0, 32, 0);
  side.addColorStop(0, "rgba(255,255,255,0)");
  side.addColorStop(0.32, "rgba(255,255,255,0.85)");
  side.addColorStop(0.68, "rgba(255,255,255,0.85)");
  side.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = side;
  ctx.fillRect(0, 0, 32, 64);
  // The ends fade out as well, so a run of marks reads as one long streak.
  const ends = ctx.createLinearGradient(0, 0, 0, 64);
  ends.addColorStop(0, "rgba(0,0,0,1)");
  ends.addColorStop(0.16, "rgba(0,0,0,0)");
  ends.addColorStop(0.84, "rgba(0,0,0,0)");
  ends.addColorStop(1, "rgba(0,0,0,1)");
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = ends;
  ctx.fillRect(0, 0, 32, 64);
  const tex = tune(new THREE.CanvasTexture(canvas));
  return tex;
}

/**
 * Rubber laid down through the corners. The marks follow the racing line — the
 * inside of every turn — and are chunked with everything else, so only the
 * handful of arcs around the car are ever submitted.
 */
function TyreMarks({ track, level }: { track: ClubCircuit; level: number }) {
  const items = useMemo(() => {
    if (level === 0) return null;
    const rng = makeRng(4711);
    const n = track.points.length;
    const out: ChunkItem[] = [];
    for (let i = 0; i < n; i++) {
      const p = track.points[i]!;
      const right = track.rights[i]!;
      const prev = track.points[(i - 4 + n) % n]!;
      const next = track.points[(i + 4) % n]!;
      const a1 = Math.atan2(p.x - prev.x, p.z - prev.z);
      const a2 = Math.atan2(next.x - p.x, next.z - p.z);
      let turn = a2 - a1;
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn < -Math.PI) turn += Math.PI * 2;
      if (Math.abs(turn) < 0.11) continue;
      // The curve bends towards its own centre, and `rights` is the direction
      // that centre lies in: that is where the wheels actually go.
      const lat = (turn > 0 ? 1 : -1) * (1.7 + rng() * 0.9);
      const yaw = Math.atan2(next.x - p.x, next.z - p.z);
      for (const off of [lat - 0.52, lat + 0.52]) {
        out.push({
          p: [p.x + right.x * off, 0.03, p.z + right.z * off],
          r: yaw,
          s: [0.3 + rng() * 0.09, 1, 5.4],
          c: rng() < 0.45 ? "#24272c" : rng() < 0.6 ? "#31353c" : "#3d424a",
        });
      }
      if (out.length > 700) break;
    }
    return out;
  }, [track, level]);
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  const texture = useMemo(() => markTexture(), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    [texture],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
      texture?.dispose();
    },
    [geometry, material, texture],
  );
  if (!items || items.length === 0) return null;
  return <ChunkedInstances geometry={geometry} material={material} items={items} arcs={18} radius={340} />;
}

// ─── Street trees ────────────────────────────────────────────────────────────
// A boulevard needs trees between the fence and the shopfronts. They are kept
// low and narrow so they frame the buildings instead of hiding them, and they
// use the same instanced batching as the rest of the roadside.
function StreetTrees({ track, level }: { track: ClubCircuit; level: number }) {
  const profile = track.spec.profile;
  const model = useMemo(() => {
    if (profile.kind !== "city") return null;
    const step = level >= 2 ? 12 : level === 1 ? 19 : 32;
    const rng = makeRng(profile.crowdSeed + 517);
    const trunks: ChunkItem[] = [];
    const crowns: ChunkItem[] = [];
    for (let i = 4; i < 600; i += step) {
      const point = track.points[i]!;
      const right = track.rights[i]!;
      const sign = Math.floor(i / step) % 2 === 0 ? 1 : -1;
      const dist = track.halfWidth + 6.5 + rng() * 1.2;
      const x = point.x + right.x * dist * sign;
      const z = point.z + right.z * dist * sign;
      if (!clearOfTrack(track, x, z, track.halfWidth + 5.2)) continue;
      const s = 0.82 + rng() * 0.32;
      trunks.push({ p: [x, 1.55 * s, z], r: rng() * Math.PI, s: [s, s, s] });
      crowns.push({
        p: [x, 3.9 * s, z],
        r: rng() * Math.PI,
        s: [2.05 * s, 1.8 * s, 2.05 * s],
        c: profile.night ? (rng() < 0.5 ? "#28452c" : "#315235") : rng() < 0.5 ? "#3f6b3c" : "#4c7a43",
      });
    }
    return { trunks, crowns };
  }, [profile, level, track]);
  const trunkGeo = useMemo(() => new THREE.CylinderGeometry(0.13, 0.2, 3.1, 5), []);
  const crownGeo = useMemo(() => new THREE.IcosahedronGeometry(1, 1), []);
  const trunkMat = useMemo(() => new THREE.MeshLambertMaterial({ color: "#5b4630" }), []);
  const crownMat = useMemo(() => new THREE.MeshLambertMaterial({}), []);
  if (!model || model.trunks.length === 0) return null;
  return (
    <group>
      <ChunkedInstances geometry={trunkGeo} material={trunkMat} items={model.trunks} arcs={10} radius={380} />
      <ChunkedInstances geometry={crownGeo} material={crownMat} items={model.crowns} arcs={10} radius={380} />
    </group>
  );
}

// ─── Paddock tents ───────────────────────────────────────────────────────────
// The white team marquees of a real street race, lined up behind the pit box.
// One merged geometry: canopy, pyramid roof, legs, back wall and a blue band.
function PaddockTents({ track, level }: { track: ClubCircuit; level: number }) {
  const geometry = useMemo(() => {
    if (level < 1) return null;
    const parts: THREE.BufferGeometry[] = [];
    const paint = (geo: THREE.BufferGeometry, color: string) => {
      const c = new THREE.Color(color);
      const count = geo.getAttribute("position")!.count;
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
      }
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      parts.push(geo);
    };
    const add = (w: number, h: number, d: number, x: number, y: number, z: number, color: string) => {
      const geo = new THREE.BoxGeometry(w, h, d);
      geo.translate(x, y, z);
      paint(geo, color);
    };
    const tents = level >= 2 ? 3 : 2;
    for (let i = 0; i < tents; i++) {
      const x = -41;
      const z = 4 + i * 15;
      add(9, 0.34, 11, x, 3.16, z, "#eef2f6");
      const roof = new THREE.ConeGeometry(7.5, 2.5, 4);
      roof.rotateY(Math.PI / 4);
      roof.translate(x, 4.55, z);
      paint(roof, "#f7f9fb");
      for (const sx of [-4.15, 4.15]) {
        for (const sz of [-5.15, 5.15]) {
          add(0.15, 3.16, 0.15, x + sx, 1.58, z + sz, "#575e68");
        }
      }
      add(8.6, 2.55, 0.12, x, 1.44, z + 5.42, "#e3e8ed");
      add(0.12, 0.55, 10.7, x + 4.58, 2.92, z, "#1f56b4");
    }
    return mergeGeometries(parts, false);
  }, [level]);
  const material = useMemo(() => new THREE.MeshLambertMaterial({ vertexColors: true }), []);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  if (!geometry) return null;
  return (
    <group position={[track.spawn.x, 0, track.spawn.z]} rotation-y={track.yaw}>
      <mesh geometry={geometry} material={material} />
    </group>
  );
}

export function CircuitScenery({ track }: { track: ClubCircuit }) {
  const { level } = useContext(PerfContext);
  return (
    <group>
      <Clouds level={level} night={track.spec.profile.night} />
      <Skyline track={track} level={level} />
      <Terrain track={track} level={level} />
      <Cityscape track={track} level={level} />
      <Grandstands track={track} level={level} />
      <Hoardings track={track} level={level} />
      <TyreMarks track={track} level={level} />
      <CatchFence track={track} level={level} />
      <Lamps track={track} level={level} />
      <StreetTrees track={track} level={level} />
      <PaddockTents track={track} level={level} />
      <ChunkCuller />
    </group>
  );
}
