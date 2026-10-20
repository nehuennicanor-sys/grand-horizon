import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

// ─── Chunked static scenery ───────────────────────────────────────────────────
//
// Everything on the circuit that never moves is batched statically: one
// InstancedMesh per arc of the lap, so the whole scenery of a 2.4 km track is
// submitted as a few dozen draw calls and, crucially, every arc can be culled
// on its own. A single ring mesh spanning the whole lap can never be culled —
// its bounding sphere always touches the frustum — which is why the barriers
// used to cost as much as the rest of the scene together.
//
// The visibility pass (see ChunkCuller) is deliberately conservative:
//   * the frustum test is three.js' own, run per chunk and now effective
//     because the chunks are small;
//   * a chunk is dropped outright once it is beyond the distance at which the
//     scene fog has already erased it, which also stands in for the occlusion
//     cull: whatever a building or a hill hides on this track sits behind that
//     same fog at the speed the car travels;
//   * beyond `lodDistance` a cheaper geometry (fewer segments, no crowd heads)
//     takes over, which is invisible at racing speed and halves the vertices.

export type ChunkItem = {
  p: readonly [number, number, number];
  r?: number | undefined;
  s?: readonly [number, number, number] | undefined;
  c?: string | undefined;
};

type Entry = {
  obj: THREE.Object3D;
  /** Chunk centre in world space (y ignored: the camera never flies). */
  x: number;
  z: number;
  /** Distance beyond which the chunk is fogged out and can be skipped. */
  maxDist: number;
  near?: THREE.Object3D | undefined;
  far?: THREE.Object3D | undefined;
  lodDistance?: number | undefined;
  /** Distance under which the chunk still casts into the shadow map. */
  shadowDistance?: number | undefined;
};

const entries = new Set<Entry>();
let dirty = true;

function register(entry: Entry) {
  entries.add(entry);
  dirty = true;
  return () => {
    entries.delete(entry);
  };
}

/** Forces the next frame to re-evaluate visibility (used after a special pass). */
export function markChunksDirty() {
  dirty = true;
}

/**
 * A deliberately poorer visibility set for the reflection pass: only the arcs
 * close to the capture point, and always the cheap LOD variant. The car's paint
 * cannot tell a grandstand at 500 m from the haze, so the pass that feeds it
 * costs a handful of draw calls instead of the whole scene.
 */
export function cullForReflection(x: number, z: number, radius: number) {
  const r2 = radius * radius;
  for (const e of entries) {
    const dx = e.x - x;
    const dz = e.z - z;
    const inside = dx * dx + dz * dz <= r2;
    if (e.far) {
      if (e.near) e.near.visible = false;
      e.far.visible = inside;
    } else if (e.obj.visible !== inside) {
      e.obj.visible = inside;
    }
  }
  dirty = false;
}

/**
 * One pass every few frames over the chunk registry. The work is a couple of
 * dozen squared distances, and the result is cached in `visible`, so the render
 * list itself never has to touch a hidden chunk again.
 */
export function ChunkCuller({ every = 5 }: { every?: number }) {
  const frame = useRef(0);
  useFrame(({ camera }) => {
    if (!dirty && frame.current++ % every !== 0) return;
    dirty = false;
    const px = camera.position.x;
    const pz = camera.position.z;
    for (const e of entries) {
      const dx = e.x - px;
      const dz = e.z - pz;
      const d2 = dx * dx + dz * dz;
      const on = d2 <= e.maxDist * e.maxDist;
      if (e.far && e.lodDistance) {
        // Near / far swap, both gated by the chunk being on at all.
        const near = on && d2 <= e.lodDistance * e.lodDistance;
        if (e.near && e.near.visible !== near) e.near.visible = near;
        const far = on && !near;
        if (e.far.visible !== far) e.far.visible = far;
      } else if (e.obj.visible !== on) {
        e.obj.visible = on;
      }
      if (e.shadowDistance !== undefined) {
        const cast = on && d2 <= e.shadowDistance * e.shadowDistance;
        if (e.obj.castShadow !== cast) e.obj.castShadow = cast;
      }
    }
  });
  return null;
}

// ─── Builder ─────────────────────────────────────────────────────────────────

function chunkList(items: ChunkItem[], arcs: number): ChunkItem[][] {
  const per = Math.max(1, Math.ceil(items.length / Math.max(1, arcs)));
  const out: ChunkItem[][] = [];
  for (let i = 0; i < items.length; i += per) out.push(items.slice(i, i + per));
  return out;
}

function buildInstanced(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  items: ChunkItem[],
  shareFrom?: THREE.InstancedMesh | undefined,
) {
  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  items.forEach((it, i) => {
    q.setFromAxisAngle(up, it.r ?? 0);
    const s = it.s ?? [1, 1, 1];
    scale.set(s[0], s[1], s[2]);
    m.compose(new THREE.Vector3(it.p[0], it.p[1], it.p[2]), q, scale);
    mesh.setMatrixAt(i, m);
    if (it.c) mesh.setColorAt(i, color.set(it.c));
  });
  if (shareFrom) {
    // Identical transform list: share the buffers so the far variant costs one
    // geometry switch and no extra upload.
    mesh.instanceMatrix = shareFrom.instanceMatrix;
    if (shareFrom.instanceColor) mesh.instanceColor = shareFrom.instanceColor;
  } else {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  if (mesh.boundingSphere === null) mesh.computeBoundingSphere();
  mesh.frustumCulled = true;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

/**
 * Draws `items` as one InstancedMesh per arc of the lap, optionally with a
 * cheaper far variant, and registers every arc with the culler.
 */
/**
 * Static merged geometry: a chunk carries a handful of pre-built meshes (the
 * city uses one per material) and is registered with the same culler as the
 * instanced batches. This is how a whole neighbourhood — hundreds of blocks
 * with ledges, balconies and signs — is drawn in a few dozen calls.
 */
export function ChunkedMerged({
  chunks,
  radius,
}: {
  chunks: {
    x: number;
    z: number;
    spread: number;
    parts: { geometry: THREE.BufferGeometry | null; material: THREE.Material }[];
  }[];
  radius: number;
}) {
  const built = useMemo(
    () =>
      chunks.map((chunk) => {
        const meshes: THREE.Mesh[] = [];
        for (const part of chunk.parts) {
          if (!part.geometry) continue;
          const mesh = new THREE.Mesh(part.geometry, part.material);
          mesh.matrixAutoUpdate = false;
          mesh.updateMatrix();
          mesh.frustumCulled = true;
          meshes.push(mesh);
        }
        return { x: chunk.x, z: chunk.z, meshes, maxDist: radius + chunk.spread + 24 };
      }),
    [chunks, radius],
  );
  useEffect(() => {
    const offs = built.flatMap((chunk) =>
      chunk.meshes.map((obj) =>
        register({ obj, x: chunk.x, z: chunk.z, maxDist: chunk.maxDist }),
      ),
    );
    return () => {
      offs.forEach((off) => off());
      built.forEach((chunk) => chunk.meshes.forEach((mesh) => mesh.geometry.dispose()));
    };
  }, [built]);
  return (
    <group>
      {built.map((chunk, i) => (
        <group key={i}>
          {chunk.meshes.map((mesh, j) => (
            <primitive key={j} object={mesh} />
          ))}
        </group>
      ))}
    </group>
  );
}

export function ChunkedInstances({
  geometry,
  material,
  items,
  arcs = 12,
  radius = 620,
  lod,
  shadowDistance,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  items: ChunkItem[];
  /** How many arcs of the lap the batch is split into. */
  arcs?: number;
  /** Distance at which the fog has erased the chunk. */
  radius?: number;
  /** Cheaper geometry used past `lod.distance` metres (own item list allowed). */
  lod?:
    | {
        geometry: THREE.BufferGeometry;
        material?: THREE.Material | undefined;
        distance: number;
        items?: ChunkItem[] | undefined;
      }
    | undefined;
  /** Keep real shadows only around the car (directive: 30 m). */
  shadowDistance?: number | undefined;
}) {
  const built = useMemo(() => {
    return chunkList(items, arcs).map((group) => {
      const farItems = lod?.items;
      const share = lod !== undefined && farItems === undefined;
      const near = buildInstanced(geometry, material, group);
      const far = lod
        ? buildInstanced(lod.geometry, lod.material ?? material, farItems ?? group, share ? near : undefined)
        : null;
      const cx = group.reduce((a, it) => a + it.p[0], 0) / group.length;
      const cz = group.reduce((a, it) => a + it.p[2], 0) / group.length;
      let spread = 0;
      for (const it of group) spread = Math.max(spread, Math.hypot(it.p[0] - cx, it.p[2] - cz));
      return { near, far, share, x: cx, z: cz, maxDist: radius + spread + 24 };
    });
  }, [geometry, material, items, arcs, radius, lod]);

  useEffect(() => {
    const offs = built.map((b) => {
      if (b.far) b.far.visible = false;
      return register({
        obj: b.near,
        x: b.x,
        z: b.z,
        maxDist: b.maxDist,
        near: b.far ? b.near : undefined,
        far: b.far ?? undefined,
        lodDistance: b.far ? (lod?.distance ?? 140) : undefined,
        shadowDistance,
      });
    });
    return () => {
      offs.forEach((off) => off());
      built.forEach((b) => {
        b.near.dispose();
        if (b.far && !b.share) b.far.dispose();
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built]);

  return (
    <group>
      {built.map((b, i) => (
        <group key={i}>
          <primitive object={b.near} />
          {b.far && <primitive object={b.far} />}
        </group>
      ))}
    </group>
  );
}
