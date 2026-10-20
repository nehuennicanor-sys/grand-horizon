import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { CircuitScenery } from "@/components/CircuitScenery";
import { trackRibbon, type ClubCircuit } from "@/lib/club-circuit";
import { drawGrain, makeRng } from "@/lib/prng";

// Cheap procedural textures (≤256², built once on the CPU) that give the
// surfaces a believable, non-flat look with zero network cost and no
// per-frame overhead — important on integrated GPUs like the Intel UHD 620.
function makeCanvas(size: number) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  return { canvas, ctx: canvas.getContext("2d") };
}

function toTexture(canvas: HTMLCanvasElement, repeat: number) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  // Grazing angles dominate the driving view, so anisotropic filtering is the
  // cheapest way to keep the surface sharp without more pixels.
  texture.anisotropy = 16;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  return texture;
}

function speckle(
  ctx: CanvasRenderingContext2D,
  size: number,
  count: number,
  alpha: number,
  light: string,
  dark: string,
) {
  drawGrain(ctx, size, count, alpha, light, dark);
}

// Asphalt with fine grain, a worn racing line and painted edge lines. Because
// the ribbon maps u across the width and v along the track (repeating every
// 8 m), everything here must stay low-contrast *along* v or the tiling becomes
// visible as repeating slabs.
function asphaltTexture(base: string, line: string) {
  const S = 512;
  const { canvas, ctx } = makeCanvas(S);
  if (ctx) {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, S, S);
    // Soft mottling only: no hard-edged shapes, so nothing reads as a slab.
    // Positions come from the PRNG because a linear sweep would draw stripes.
    const mottle = makeRng(0x51ed270b);
    for (let i = 0; i < 90; i++) {
      const x = mottle() * S;
      const y = mottle() * S;
      const r = 18 + mottle() * 80;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const tone = mottle() < 0.5 ? "255,255,255" : "0,0,0";
      g.addColorStop(0, `rgba(${tone},0.045)`);
      g.addColorStop(1, `rgba(${tone},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Fine aggregate grain keeps the surface from looking like plastic.
    speckle(ctx, S, 22000, 0.16, "#ffffff", "#000000");
    // Worn, darker racing line down the middle of the width (u axis).
    const grad = ctx.createLinearGradient(0, 0, S, 0);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(0.3, "rgba(0,0,0,0.07)");
    grad.addColorStop(0.5, "rgba(0,0,0,0.12)");
    grad.addColorStop(0.7, "rgba(0,0,0,0.07)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, S, S);
    // Polished tyre tracks either side of the line.
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(S * 0.35, 0, 30, S);
    ctx.fillRect(S * 0.59, 0, 30, S);
    ctx.globalAlpha = 1;
    // Painted edge lines (u = across the width, so these run along the track).
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = line;
    ctx.fillRect(16, 0, 8, S);
    ctx.fillRect(S - 24, 0, 8, S);
    ctx.globalAlpha = 1;
  }
  return toTexture(canvas, 1);
}

// Alternating red/white kerb bands that read correctly along the track.
function curbTexture(red: string, white: string) {
  const S = 256;
  const { canvas, ctx } = makeCanvas(S);
  if (ctx) {
    ctx.fillStyle = white;
    ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = red;
    ctx.fillRect(0, 0, S, S / 2);
    // Kerbs are painted concrete: grain plus worn edges.
    speckle(ctx, S, 6000, 0.22, "#ffffff", "#000000");
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, S / 2 - 3, S, 3);
    ctx.fillRect(0, S - 4, S, 4);
    ctx.globalAlpha = 1;
  }
  return toTexture(canvas, 1);
}

function grassTexture(base: string, dark: string) {
  const S = 512;
  const { canvas, ctx } = makeCanvas(S);
  if (ctx) {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, S, S);
    // Broad mowing/colour patches so the field is not a flat green.
    const tufts = makeRng(0x2f9a41c7);
    for (let i = 0; i < 420; i++) {
      ctx.globalAlpha = 0.08 + tufts() * 0.22;
      ctx.fillStyle = tufts() < 0.34 ? dark : base;
      const r = 6 + tufts() * 46;
      ctx.beginPath();
      ctx.arc(tufts() * S, tufts() * S, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Blade-level speckle.
    speckle(ctx, S, 26000, 0.45, "#7fae57", "#20361a");
  }
  return toTexture(canvas, 1);
}

/**
 * City ground: paving slabs, asphalt patches and utility covers instead of a
 * lawn. A street circuit has no grass under the buildings, and a tiled surface
 * with visible joints also gives the eye a sense of speed at low ride height.
 */
function pavementTexture(base: string, dark: string) {
  const S = 512;
  const { canvas, ctx } = makeCanvas(S);
  if (ctx) {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, S, S);
    const rnd = makeRng(0x7a31c05d);
    // Large slabs with alternating tones, laid in a running bond. The contrast
    // is kept low: at street level the surface has to read as stone, not as a
    // giant chessboard seen from above.
    const rows = 4;
    const cols = 4;
    const cw = S / cols;
    const ch = S / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.globalAlpha = 0.025 + rnd() * 0.045;
        ctx.fillStyle = (r + c) % 2 === 0 ? dark : "#ffffff";
        ctx.fillRect(c * cw + 1, r * ch + 1, cw - 2, ch - 2);
      }
    }
    ctx.globalAlpha = 1;
    // Joints.
    ctx.strokeStyle = dark;
    ctx.globalAlpha = 0.26;
    ctx.lineWidth = 2;
    for (let r = 0; r <= rows; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * ch);
      ctx.lineTo(S, r * ch);
      ctx.stroke();
    }
    for (let c = 0; c <= cols; c++) {
      ctx.beginPath();
      ctx.moveTo(c * cw, 0);
      ctx.lineTo(c * cw, S);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Asphalt repairs and rubber ground into the paving.
    for (let i = 0; i < 26; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const r = 18 + rnd() * 58;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const darkPatch = rnd() < 0.5;
      g.addColorStop(0, darkPatch ? "rgba(0,0,0,0.14)" : "rgba(255,255,255,0.07)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // A few manhole covers give the ground a believable scale.
    for (let i = 0; i < 4; i++) {
      const x = 40 + rnd() * (S - 80);
      const y = 40 + rnd() * (S - 80);
      ctx.fillStyle = "rgba(20,22,25,0.55)";
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(200,204,208,0.25)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.stroke();
    }
    speckle(ctx, S, 18000, 0.16, "#ffffff", "#000000");
  }
  return toTexture(canvas, 1);
}

export function Circuit3D({ track }: { track: ClubCircuit }) {
  const colors = useMemo(() => {
    const css = getComputedStyle(document.documentElement);
    const get = (n: string) => css.getPropertyValue(`--scene-${n}`).trim();
    return {
      asphalt: get("asphalt"),
      grass: get("grass"),
      line: get("line"),
      curb: get("curb"),
      metal: get("metal"),
      rubber: get("rubber"),
      floor: get("floor"),
    };
  }, []);
  const road = useMemo(() => asphaltTexture(colors.asphalt, colors.line), [colors]);
  const curb = useMemo(() => curbTexture(colors.curb, colors.line), [colors]);
  // Each circuit paints its own ground: forest green, valley green, city
  // pavement or desert sand. A city never grows grass under its blocks.
  const profile = track.spec.profile;
  const city = profile.kind === "city";
  const ground = useMemo(() => {
    const texture = city
      ? pavementTexture(profile.grass, profile.dirt)
      : grassTexture(profile.grass, profile.dirt);
    // One tile of the paving is roughly 8 m across in the city: big enough to
    // see the slabs from the cockpit, small enough that the repeat disappears.
    texture.repeat.set(city ? 250 : 70, city ? 250 : 70);
    return texture;
  }, [city, profile]);
  // The sidewalk promises paving at walking scale: trackRibbon already tiles
  // its v coordinate every 8 m, so keep the extra map at 1:1.
  const walk = useMemo(() => {
    if (!city) return null;
    const texture = pavementTexture(profile.grass, profile.dirt);
    texture.repeat.set(1, 1);
    return texture;
  }, [city, profile]);
  const hw = track.halfWidth;
  const meshes = useMemo(
    () => [
      trackRibbon(track, -hw, hw, 0.02),
      trackRibbon(track, -hw - 0.2, -hw, 0.035),
      trackRibbon(track, hw, hw + 0.2, 0.035),
      trackRibbon(track, -hw - 1.2, -hw - 0.2, 0.04),
      trackRibbon(track, hw + 0.2, hw + 1.2, 0.04),
      trackRibbon(track, -hw - 5, -hw - 4.5, 0.65),
      trackRibbon(track, hw + 4.5, hw + 5, 0.65),
      ...(city
        ? [
            trackRibbon(track, -hw - 9.4, -hw - 5.2, 0.06),
            trackRibbon(track, hw + 5.2, hw + 9.4, 0.06),
          ]
        : []),
    ],
    [track, hw, city],
  );
  useEffect(
    () => () => {
      road.dispose();
      ground.dispose();
      walk?.dispose();
      curb.dispose();
      meshes.forEach((g) => g.dispose());
    },
    [road, ground, walk, curb, meshes],
  );
  // The pit complex is built in the frame of the start line, so it follows the
  // spawn of whichever circuit is loaded.
  const frame = useMemo(() => {
    let cx = 0;
    let cz = 0;
    track.points.forEach((p) => {
      cx += p.x;
      cz += p.z;
    });
    return { cx: cx / track.points.length, cz: cz / track.points.length, yaw: track.yaw };
  }, [track]);
  return (
    <group>
      {/* One grass plane for the whole scene, so no two planes ever z-fight */}
      <mesh rotation-x={-Math.PI / 2} position={[frame.cx, -0.08, frame.cz]} receiveShadow>
        <planeGeometry args={[2000, 2000]} />
        {/* Lambert, not Standard: the ground fills half the screen and matte
            grass loses nothing from the cheaper shading model, which is what
            pays for the extra crowd and detail elsewhere on the lap. */}
        <meshLambertMaterial map={ground} />
      </mesh>
      {city &&
        meshes.slice(7).map((geometry, i) => (
          <mesh key={`walk-${i}`} geometry={geometry} receiveShadow>
            <meshLambertMaterial map={walk} color="#ffffff" side={THREE.DoubleSide} />
          </mesh>
        ))}
      {meshes.slice(0, city ? 7 : meshes.length).map((geometry, i) => (
        <mesh key={i} geometry={geometry} receiveShadow>
          {i > 4 ? (
            <meshLambertMaterial color={colors.metal} side={THREE.DoubleSide} />
          ) : (
            <meshLambertMaterial
              map={i === 0 ? road : i === 3 || i === 4 ? curb : null}
              color={i === 0 ? "#ffffff" : colors.line}
              side={THREE.DoubleSide}
            />
          )}
        </mesh>
      ))}
      {/* City skyline, grandstands and their crowds. */}
      <CircuitScenery track={track} />
      <group position={[track.spawn.x, 0, track.spawn.z]} rotation-y={frame.yaw}>
        {/* Pit lane */}
        <mesh position={[-14 * (hw / 8), 0.025, 35]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[8, 90]} />
          <meshLambertMaterial map={road} />
        </mesh>
        {/* Start grid */}
        {Array.from({ length: 16 }, (_, i) => (
          <mesh key={i} position={[hw * -0.94 + i * ((hw * 1.88) / 15), 0.05, 15]} rotation-x={-Math.PI / 2}>
            <planeGeometry args={[1, 1.5]} />
            <meshBasicMaterial color={i % 2 ? colors.rubber : colors.line} />
          </mesh>
        ))}
        {/* Pit markers */}
        {Array.from({ length: 6 }, (_, i) => (
          <mesh
            key={i}
            position={[i % 2 ? 3 : -3, 0.05, -8 - Math.floor(i / 2) * 8]}
            rotation-x={-Math.PI / 2}
          >
            <planeGeometry args={[2, 0.1]} />
            <meshBasicMaterial color={colors.line} />
          </mesh>
        ))}
        {/* Pit building */}
        <group position={[-24 * (hw / 8), 0, 30]}>
          <mesh position={[0, 2.5, 0]}>
            <boxGeometry args={[9, 5, 65]} />
            <meshLambertMaterial color={colors.floor} />
          </mesh>
          <mesh position={[4.6, 2, 0]}>
            <boxGeometry args={[0.1, 2, 61]} />
            <meshStandardMaterial color={colors.metal} metalness={0.5} roughness={0.3} />
          </mesh>
          <mesh position={[0, 5.2, 0]}>
            <boxGeometry args={[12, 0.3, 68]} />
            <meshLambertMaterial color={colors.line} />
          </mesh>
        </group>
        {/* Gantry over the start line */}
        <group position={[0, 0, 18]}>
          {[-hw - 3, hw + 3].map((x) => (
            <mesh key={x} position={[x, 3, 0]}>
              <boxGeometry args={[0.4, 6, 0.4]} />
              <meshStandardMaterial color={colors.metal} metalness={0.6} />
            </mesh>
          ))}
          <mesh position={[0, 5.6, 0]}>
            <boxGeometry args={[hw * 2 + 7, 1, 0.5]} />
            <meshStandardMaterial color={colors.floor} />
          </mesh>
          {[-1.2, -0.6, 0, 0.6, 1.2].map((x) => (
            <mesh key={x} position={[x, 5.6, -0.3]}>
              <sphereGeometry args={[0.18, 12, 8]} />
              <meshBasicMaterial color={colors.curb} />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  );
}
