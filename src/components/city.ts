import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { type ClubCircuit } from "@/lib/club-circuit";
import { makeRng } from "@/lib/prng";

// ─── City kit ────────────────────────────────────────────────────────────────
//
// The old skyline was a handful of stretched boxes with one window texture
// shared by every face, which is exactly why the blocks read as flat "skirts":
// a 20 m shop and a 90 m tower both showed the same six windows, and the roof
// was painted with the same grid as the wall. This module builds the city out
// of real pieces instead:
//
//   * a tiling facade texture with one window per bay and per floor, spandrels
//     and a separate shopfront band, mapped in metres so windows keep their
//     size on every building;
//   * six building types (stepped tower, mid-rise with balconies, pavilion,
//     twin towers, round tower and an arcaded podium) with cornices, pilasters,
//     ledges, awnings, roof plant and antennas as actual geometry;
//   * street rows aligned with the lap, a taller second row, landmark clusters,
//     and a waterfront row across the bay;
//   * everything is merged per arc of the lap, so a whole city costs a few
//     dozen draw calls instead of one per block.

export const BAY = 3.2; // metres per window bay
export const FLOOR = 3.7; // metres per storey
export const COLS = 6;
export const ROWS = 8;

export type FacadeMaps = {
  map: THREE.Texture;
  emissive: THREE.Texture | null;
};

export type CityChunk = {
  x: number;
  z: number;
  spread: number;
  facade: THREE.BufferGeometry | null;
  store: THREE.BufferGeometry | null;
  detail: THREE.BufferGeometry | null;
  neon: THREE.BufferGeometry | null;
};

export type CityBuild = {
  chunks: CityChunk[];
  facade: FacadeMaps;
  store: FacadeMaps;
};

export type SkyBuild = {
  chunks: CityChunk[];
  facade: FacadeMaps;
};

const facadeCache = new Map<string, FacadeMaps>();
const storeCache = new Map<string, FacadeMaps>();

function toTexture(canvas: HTMLCanvasElement) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 16;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  return texture;
}

function shade(hex: string, factor: number) {
  const color = new THREE.Color(hex);
  color.multiplyScalar(factor);
  return `#${color.getHexString()}`;
}

/**
 * One tile of facade: six bays across, eight storeys up. Every cell is
 * self-contained (spandrel at the bottom, window above) so the tile repeats
 * without a visible seam in either direction.
 */
function facadeMaps(night: boolean, tint: string, seed: number): FacadeMaps {
  const key = `${night ? 1 : 0}|${tint}|${seed}`;
  const hit = facadeCache.get(key);
  if (hit) return hit;
  const W = 384;
  const H = 512;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const fallback = toTexture(canvas);
    const maps = { map: fallback, emissive: null };
    facadeCache.set(key, maps);
    return maps;
  }
  const emCanvas = document.createElement("canvas");
  emCanvas.width = W;
  emCanvas.height = H;
  const em = emCanvas.getContext("2d");
  const rng = makeRng(seed);
  const wall = night ? shade(tint, 0.46) : tint;
  const wallDark = shade(wall, 0.82);
  const wallLight = shade(wall, 1.1);
  const frame = shade(wall, night ? 0.34 : 0.5);
  const spandrel = shade(wall, night ? 0.66 : 0.88);
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, W, H);
  if (em) {
    em.fillStyle = "#000000";
    em.fillRect(0, 0, W, H);
  }
  const bw = W / COLS;
  const bh = H / ROWS;
  // Storey bands and the vertical joints between bays. The bands are slightly
  // darker so the eye reads a spandrel even before the geometry ledges.
  for (let r = 0; r < ROWS; r++) {
    const y = H - (r + 1) * bh;
    ctx.fillStyle = spandrel;
    ctx.fillRect(0, y, W, 10);
    ctx.fillStyle = shade(wall, night ? 0.58 : 0.78);
    ctx.fillRect(0, y + 10, W, 2);
  }
  for (let c = 0; c < COLS; c++) {
    ctx.fillStyle = wallDark;
    ctx.fillRect(c * bw, 0, 2, H);
    ctx.fillStyle = wallLight;
    ctx.fillRect(c * bw + 2, 0, 1, H);
  }
  // Window frames, glass, blinds and the lit offices. Night windows are mostly
  // dark with a warm (or fluorescent) minority; daytime windows reflect the sky.
  for (let r = 0; r < ROWS; r++) {
    const y = H - (r + 1) * bh;
    for (let c = 0; c < COLS; c++) {
      const x = c * bw;
      const wx = x + 10;
      const wy = y + 16;
      const ww = bw - 20;
      const wh = bh - 27;
      ctx.fillStyle = frame;
      ctx.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
      const lit = night ? rng() < 0.34 : rng() < 0.1;
      const cool = rng() < 0.42;
      if (lit) {
        const g = ctx.createLinearGradient(wx, wy, wx, wy + wh);
        if (night) {
          g.addColorStop(0, cool ? "#dcebff" : "#ffe2ac");
          g.addColorStop(1, cool ? "#a9c7ea" : "#e0b676");
        } else {
          g.addColorStop(0, "#f5f7f2");
          g.addColorStop(1, "#c9d4dd");
        }
        ctx.fillStyle = g;
        ctx.fillRect(wx, wy, ww, wh);
        if (em) {
          em.fillStyle = night ? (cool ? "#bcd7ff" : "#ffd89b") : "#d8dfe6";
          em.fillRect(wx, wy, ww, wh);
          // A darker desk/partition line breaks up the bright rectangle.
          em.fillStyle = "#000000";
          em.fillRect(wx, wy + wh * 0.62, ww, Math.max(1, wh * 0.08));
        }
        ctx.fillStyle = "rgba(40,45,52,0.32)";
        ctx.fillRect(wx, wy + wh * 0.62, ww, Math.max(1, wh * 0.08));
      } else {
        const g = ctx.createLinearGradient(wx, wy, wx, wy + wh);
        if (night) {
          g.addColorStop(0, "#0c1320");
          g.addColorStop(1, "#182331");
        } else {
          g.addColorStop(0, "#cfe0ee");
          g.addColorStop(0.52, "#96adc0");
          g.addColorStop(1, "#61788c");
        }
        ctx.fillStyle = g;
        ctx.fillRect(wx, wy, ww, wh);
        ctx.fillStyle = "rgba(255,255,255,0.16)";
        ctx.fillRect(wx + 2, wy + 2, ww * 0.28, wh - 4);
      }
      // Mullion and sill.
      ctx.fillStyle = frame;
      ctx.fillRect(wx + ww / 2 - 1, wy, 2, wh);
      ctx.fillStyle = wallLight;
      ctx.fillRect(wx - 5, wy + wh + 3, ww + 10, 3);
      if (rng() < 0.18) {
        ctx.fillStyle = night ? "#33404e" : "#dde6ec";
        ctx.fillRect(wx, wy, ww, wh * (0.18 + rng() * 0.42));
      }
      // An occasional air conditioner under the sill: small, but it stops the
      // facade looking like wallpaper.
      if (rng() < 0.08) {
        ctx.fillStyle = night ? "#5a626d" : "#aeb7bf";
        ctx.fillRect(wx + ww * 0.62, wy + wh + 6, ww * 0.26, 7);
        ctx.fillStyle = "#2b323b";
        ctx.fillRect(wx + ww * 0.64, wy + wh + 8, ww * 0.2, 2);
      }
    }
  }
  // Vertical stone piers every second bay on the lower half: the texture has
  // some structure of its own so ledges and pilasters do not carry it alone.
  for (let c = 0; c < COLS; c += 2) {
    ctx.fillStyle = wallLight;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(c * bw + 3, 0, 3, H);
    ctx.globalAlpha = 1;
  }
  const maps: FacadeMaps = { map: toTexture(canvas), emissive: night ? toTexture(emCanvas) : null };
  facadeCache.set(key, maps);
  return maps;
}

/** Street level: glazing, doors, a fascia band and painted shop signs. */
function storeMaps(night: boolean, tint: string, seed: number): FacadeMaps {
  const key = `${night ? 1 : 0}|${tint}|${seed}`;
  const hit = storeCache.get(key);
  if (hit) return hit;
  const W = 512;
  const H = 128;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const fallback = toTexture(canvas);
    const maps = { map: fallback, emissive: null };
    storeCache.set(key, maps);
    return maps;
  }
  const emCanvas = document.createElement("canvas");
  emCanvas.width = W;
  emCanvas.height = H;
  const em = emCanvas.getContext("2d");
  const rng = makeRng(seed);
  const bands = 4;
  const bw = W / bands;
  ctx.fillStyle = night ? "#181d25" : shade(tint, 0.86);
  ctx.fillRect(0, 0, W, H);
  if (em) {
    em.fillStyle = "#000000";
    em.fillRect(0, 0, W, H);
  }
  const fascia = night ? "#11151c" : shade(tint, 0.42);
  ctx.fillStyle = fascia;
  ctx.fillRect(0, 0, W, 30);
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(0, 30, W, 2);
  const signs = ["#1f56b4", "#c9a227", "#e8edf2", "#2a6ac6", "#b8452f", "#1f6f8b"];
  for (let b = 0; b < bands; b++) {
    const x = b * bw;
    const sign = signs[Math.floor(rng() * signs.length)]!;
    ctx.fillStyle = sign;
    ctx.fillRect(x + 12, 7, bw - 24, 16);
    // Fake lettering: a few bright ticks read as a word from the cockpit.
    ctx.fillStyle = sign === "#e8edf2" ? "#1b2735" : "#f4f7fb";
    const n = 3 + Math.floor(rng() * 3);
    for (let k = 0; k < n; k++) {
      const lw = 10 + rng() * 18;
      ctx.fillRect(x + 20 + k * 26, 13, lw, 4);
    }
    if (em) {
      em.fillStyle = sign === "#e8edf2" ? "#c7d4e2" : sign;
      em.fillRect(x + 12, 7, bw - 24, 16);
    }
    const gx = x + 10;
    const gy = 40;
    const gw = bw - 20;
    const gh = H - gy - 9;
    const g = ctx.createLinearGradient(gx, gy, gx, gy + gh);
    if (night) {
      const warm = rng() < 0.7;
      g.addColorStop(0, warm ? "#f0cf94" : "#bfe0ff");
      g.addColorStop(0.7, warm ? "#bd8a4b" : "#6f9cc4");
      g.addColorStop(1, warm ? "#5a3c22" : "#314a63");
    } else {
      g.addColorStop(0, "#c8dceb");
      g.addColorStop(0.6, "#8ba2b5");
      g.addColorStop(1, "#53697c");
    }
    ctx.fillStyle = g;
    ctx.fillRect(gx, gy, gw, gh);
    if (em) {
      em.fillStyle = night ? (rng() < 0.7 ? "#ffdc9c" : "#cfe6ff") : "#000000";
      em.fillRect(gx, gy, gw, gh);
    }
    // Frame, door and a couple of interior silhouettes.
    ctx.fillStyle = night ? "#0d1218" : "#26313b";
    ctx.fillRect(gx, gy, 4, gh);
    ctx.fillRect(gx + gw - 4, gy, 4, gh);
    ctx.fillRect(gx + gw * 0.62, gy, 3, gh);
    if (b % 2 === 1) {
      ctx.fillStyle = night ? "#141a22" : "#323c46";
      ctx.fillRect(gx + gw * 0.12, gy + gh * 0.18, gw * 0.24, gh * 0.82);
      ctx.fillStyle = night ? "#98a4b4" : "#d8e0e8";
      ctx.fillRect(gx + gw * 0.2, gy + gh * 0.52, 3, 9);
    }
    if (rng() < 0.5) {
      ctx.fillStyle = "rgba(18,22,28,0.5)";
      ctx.fillRect(gx + gw * 0.7, gy + gh * 0.55, 20, gh * 0.45);
    }
  }
  const maps: FacadeMaps = { map: toTexture(canvas), emissive: night ? toTexture(emCanvas) : null };
  storeCache.set(key, maps);
  return maps;
}

// ─── Geometry helpers ────────────────────────────────────────────────────────

function paint(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation) {
  const c = new THREE.Color(color);
  const count = geo.getAttribute("position")!.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
}

function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: THREE.ColorRepresentation,
  tilt = 0,
) {
  const geo = new THREE.BoxGeometry(w, h, d);
  if (tilt) geo.rotateX(tilt);
  geo.translate(x, y, z);
  return paint(geo, color);
}

/**
 * A wall with no top or bottom, mapped in metres: one texture tile is COLS
 * bays wide and ROWS storeys tall, so the windows stay the same size whether
 * the block is a kiosk or a skyscraper. `uPhase` breaks the alignment between
 * neighbours and `vBase` continues the storey grid above a podium.
 */
function wallBox(
  w: number,
  h: number,
  d: number,
  cx: number,
  cy: number,
  cz: number,
  uPhase: number,
  vBase: number,
) {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let vertex = 0;
  const add = (
    p0: readonly [number, number, number],
    p1: readonly [number, number, number],
    p2: readonly [number, number, number],
    p3: readonly [number, number, number],
    normal: readonly [number, number, number],
    uSpan: number,
    vSpan: number,
    u0: number,
    v0: number,
  ) => {
    positions.push(...p0, ...p1, ...p2, ...p3);
    for (let i = 0; i < 4; i++) normals.push(normal[0], normal[1], normal[2]);
    uvs.push(u0, v0, u0 + uSpan, v0, u0 + uSpan, v0 + vSpan, u0, v0 + vSpan);
    indices.push(vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3);
    vertex += 4;
  };
  const hw = w / 2;
  const hd = d / 2;
  const x0 = cx - hw;
  const x1 = cx + hw;
  const z0 = cz - hd;
  const z1 = cz + hd;
  const y0 = cy;
  const y1 = cy + h;
  const uW = w / (BAY * COLS);
  const uD = d / (BAY * COLS);
  const vH = h / (FLOOR * ROWS);
  add([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], uW, vH, uPhase, vBase);
  add([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], uW, vH, uPhase + 0.37, vBase);
  add([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], uD, vH, uPhase + 0.71, vBase);
  add([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], uD, vH, uPhase + 0.19, vBase);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/** A wall mapped with the single-storey shopfront tile. */
function shopBox(w: number, h: number, d: number, cx: number, cy: number, cz: number, uPhase: number) {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let vertex = 0;
  const add = (
    p0: readonly [number, number, number],
    p1: readonly [number, number, number],
    p2: readonly [number, number, number],
    p3: readonly [number, number, number],
    normal: readonly [number, number, number],
    uSpan: number,
    u0: number,
  ) => {
    positions.push(...p0, ...p1, ...p2, ...p3);
    for (let i = 0; i < 4; i++) normals.push(normal[0], normal[1], normal[2]);
    uvs.push(u0, 0, u0 + uSpan, 0, u0 + uSpan, 1, u0, 1);
    indices.push(vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3);
    vertex += 4;
  };
  const hw = w / 2;
  const hd = d / 2;
  const x0 = cx - hw;
  const x1 = cx + hw;
  const z0 = cz - hd;
  const z1 = cz + hd;
  const y0 = cy;
  const y1 = cy + h;
  const uW = w / (5.5 * 4);
  const uD = d / (5.5 * 4);
  add([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], uW, uPhase);
  add([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], uW, uPhase + 0.41);
  add([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], uD, uPhase + 0.73);
  add([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], uD, uPhase + 0.17);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/** Round shaft with the same storey grid wrapped around its circumference. */
function roundWall(
  radius: number,
  height: number,
  cx: number,
  cy: number,
  cz: number,
  uPhase: number,
  vBase: number,
  segments = 20,
) {
  const geo = new THREE.CylinderGeometry(radius, radius, height, segments, 1, true);
  const uv = geo.getAttribute("uv")!;
  const uRepeat = (Math.PI * 2 * radius) / (BAY * COLS);
  const vRepeat = height / (FLOOR * ROWS);
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * uRepeat + uPhase, uv.getY(i) * vRepeat + vBase);
  }
  geo.translate(cx, cy + height / 2, cz);
  return geo;
}

function roundSlab(radius: number, h: number, cx: number, cy: number, cz: number, color: THREE.ColorRepresentation) {
  const geo = new THREE.CylinderGeometry(radius, radius, h, 20);
  geo.translate(cx, cy, cz);
  return paint(geo, color);
}

// ─── Building types ──────────────────────────────────────────────────────────

type Kind = "tower" | "midrise" | "hall" | "twin" | "round" | "arcade";

type Block = {
  x: number;
  z: number;
  yaw: number;
  w: number;
  d: number;
  h: number;
  kind: Kind;
  phase: number;
  neon: boolean;
};

type Local = {
  facade: THREE.BufferGeometry[];
  store: THREE.BufferGeometry[];
  detail: THREE.BufferGeometry[];
  neon: THREE.BufferGeometry[];
};

const AWNINGS = ["#b8452f", "#1f6f8b", "#c9a227", "#2a6a4f", "#e8edf2", "#7a3f63"];

type Colors = {
  base: string;
  light: string;
  dark: string;
  trim: string;
  rail: string;
  metal: string;
  glass: string;
};

function colorsOf(tint: string, night: boolean, rng: () => number): Colors {
  const v = 0.9 + rng() * 0.18;
  return {
    base: shade(tint, (night ? 0.5 : 0.92) * v),
    light: shade(tint, (night ? 0.64 : 1.12) * v),
    dark: shade(tint, (night ? 0.34 : 0.7) * v),
    trim: shade(tint, (night ? 0.58 : 1.03) * v),
    rail: night ? "#465062" : "#3a424b",
    metal: night ? "#39424f" : "#4a525c",
    glass: night ? "#182433" : "#566c7e",
  };
}

function tower(b: Block, o: Local, c: Colors, rng: () => number) {
  const { w, d, h, phase } = b;
  const storeH = 4.6;
  o.store.push(shopBox(w + 0.7, storeH, d + 0.7, 0, 0, 0, phase));
  o.detail.push(box(w + 1.2, 0.45, d + 1.2, 0, 0.22, 0, c.dark));
  const s2 = Math.max(4.2, h * 0.15);
  const s3 = Math.max(2.6, h * 0.055);
  const s1 = Math.max(7, h - storeH - s2 - s3 - 0.9);
  const y1 = storeH;
  o.facade.push(wallBox(w, s1, d, 0, y1, 0, phase, y1 / (FLOOR * ROWS)));
  const y2 = y1 + s1;
  o.facade.push(wallBox(w * 0.78, s2, d * 0.78, 0, y2, 0, phase + 0.13, y2 / (FLOOR * ROWS)));
  const y3 = y2 + s2;
  o.facade.push(wallBox(w * 0.52, s3, d * 0.52, 0, y3, 0, phase + 0.29, y3 / (FLOOR * ROWS)));
  o.detail.push(box(w + 0.5, 0.38, d + 0.5, 0, y1 + 0.19, 0, c.trim));
  o.detail.push(box(w * 0.78 + 0.45, 0.32, d * 0.78 + 0.45, 0, y2 + 0.16, 0, c.trim));
  o.detail.push(box(w * 0.52 + 0.45, 0.38, d * 0.52 + 0.45, 0, y3 + 0.19, 0, c.trim));
  // Corner piers and a central front fin: real relief, not a painted stripe.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      o.detail.push(box(0.38, s1, 0.38, sx * (w / 2 - 0.04), y1 + s1 / 2, sz * (d / 2 - 0.04), c.light));
    }
  }
  o.detail.push(box(0.55, s1, 0.45, 0, y1 + s1 / 2, d / 2 - 0.02, c.light));
  for (const f of [0.33, 0.66]) {
    o.detail.push(box(w + 0.32, 0.26, d + 0.32, 0, y1 + s1 * f, 0, c.dark));
  }
  // Entrance canopy with two slender posts.
  const cw = Math.min(w * 0.55, 9);
  o.detail.push(box(cw, 0.28, 2.4, 0, storeH - 0.9, d / 2 + 1.2, c.metal));
  for (const sx of [-1, 1]) {
    o.detail.push(box(0.16, storeH - 0.9, 0.16, sx * cw * 0.4, (storeH - 0.9) / 2, d / 2 + 2.2, c.metal));
  }
  // Roof plant and antenna.
  o.detail.push(box(w * 0.24, 2.3, d * 0.24, 0, y3 + s3 + 1.15, 0, c.dark));
  o.detail.push(box(0.2, 9, 0.2, 0, y3 + s3 + 4.5, 0, c.metal));
  if (b.neon) {
    o.neon.push(box(0.5, Math.min(9, h * 0.2), 0.3, w * 0.3, storeH + 5.4, d / 2 + 0.22, "#4db8ff"));
    o.neon.push(box(0.42, 0.42, Math.min(6, w * 0.5), 0, y3 + s3 + 3.2, d / 2 - 0.1, "#9fd8ff"));
  }
}

function midrise(b: Block, o: Local, c: Colors, rng: () => number) {
  const { w, d, h, phase } = b;
  const storeH = 4.2;
  o.store.push(shopBox(w + 0.5, storeH, d + 0.5, 0, 0, 0, phase));
  o.detail.push(box(w + 0.9, 0.4, d + 0.9, 0, 0.2, 0, c.dark));
  const shaft = h - storeH - 0.7;
  o.facade.push(wallBox(w, shaft, d, 0, storeH, 0, phase, storeH / (FLOOR * ROWS)));
  o.detail.push(box(w + 0.7, 0.62, d + 0.7, 0, h - 0.31, 0, c.trim));
  o.detail.push(box(w + 0.4, 0.32, d + 0.4, 0, h + 0.15, 0, c.dark));
  // A shallow mansard roof gives the block a silhouette above the cornice.
  o.detail.push(box(w * 0.84, 1.5, d * 0.84, 0, h + 0.8, 0, c.dark));
  o.detail.push(box(w * 0.6, 0.9, d * 0.6, 0, h + 1.75, 0, c.trim));
  o.detail.push(box(w * 0.28, 1.5, d * 0.28, 0, h + 2.4, 0, c.dark));
  // Balconies: slabs, railings and side returns on the street face.
  const floors = Math.max(1, Math.floor((h - storeH - 1) / FLOOR));
  for (let f = 1; f <= Math.min(floors - 1, 3); f++) {
    const y = storeH + f * FLOOR;
    const bw = w * 0.58;
    o.detail.push(box(bw + 0.3, 0.18, 1.35, 0, y, d / 2 + 0.68, c.light));
    o.detail.push(box(bw + 0.3, 0.9, 0.07, 0, y + 0.52, d / 2 + 1.34, c.rail));
    for (const sx of [-1, 1]) {
      o.detail.push(box(0.07, 0.9, 1.35, sx * (bw + 0.3) / 2, y + 0.52, d / 2 + 0.68, c.rail));
    }
  }
  // Awnings over the shopfronts.
  const count = 2 + (rng() < 0.5 ? 1 : 0);
  for (let i = 0; i < count; i++) {
    const aw = (w * 0.9) / count - 0.9;
    const ax = -w * 0.45 + ((i + 0.5) * (w * 0.9)) / count;
    o.detail.push(
      box(aw, 0.15, 1.5, ax, storeH - 0.55, d / 2 + 0.78, AWNINGS[Math.floor(rng() * AWNINGS.length)]!, 0.3),
    );
  }
  for (const sx of [-1, 1]) {
    o.detail.push(box(0.4, shaft, 0.4, sx * (w / 2 - 0.08), storeH + shaft / 2, d / 2 - 0.06, c.light));
  }
  if (b.neon) {
    o.neon.push(box(0.35, 4.5, 0.28, w * 0.32, storeH + 2.2, d / 2 + 0.22, "#e8f4ff"));
    o.neon.push(box(w * 0.42, 0.34, 0.24, 0, h + 3.5, d / 2 - 0.1, "#ffd88a"));
  }
}

function hall(b: Block, o: Local, c: Colors, rng: () => number) {
  const { w, d, h, phase } = b;
  const glassH = Math.min(5.5, h * 0.5);
  o.store.push(shopBox(w, glassH, d, 0, 0, 0, phase));
  o.facade.push(wallBox(w, h - glassH, d, 0, glassH, 0, phase, glassH / (FLOOR * ROWS)));
  o.detail.push(box(w + 1, 0.8, d + 1, 0, h - 0.4, 0, c.trim));
  o.detail.push(box(w + 0.5, 0.35, d + 0.5, 0, h + 0.17, 0, c.dark));
  // Sawtooth skylights along the roof.
  const n = 3;
  for (let i = 0; i < n; i++) {
    const x = -w * 0.3 + (i / Math.max(1, n - 1)) * w * 0.6;
    o.detail.push(box(w * 0.16, 0.5, d * 0.72, x, h + 0.95, 0, c.glass, 0.16));
  }
  o.detail.push(box(w * 0.22, 1.7, d * 0.22, w * 0.24, h + 1.35, -d * 0.2, c.dark));
  o.detail.push(box(w * 0.32, 0.36, 3.6, -w * 0.1, glassH - 0.6, d / 2 + 1.8, c.metal));
  for (const sx of [-1, 1]) {
    o.detail.push(box(0.16, glassH - 0.6, 0.16, -w * 0.1 + sx * w * 0.12, (glassH - 0.6) / 2, d / 2 + 3.6, c.metal));
  }
  if (b.neon) {
    o.neon.push(box(w * 0.55, 1.4, 0.3, 0, h + 2.4, d / 2 + 0.2, rng() < 0.5 ? "#9fd8ff" : "#ffd88a"));
  }
}

function twin(b: Block, o: Local, c: Colors, rng: () => number) {
  const { w, d, h, phase } = b;
  const podH = 6.5;
  o.store.push(shopBox(w, podH, d, 0, 0, 0, phase));
  o.detail.push(box(w + 0.8, 0.6, d + 0.8, 0, podH - 0.3, 0, c.trim));
  const aw = w * 0.38;
  const ad = d * 0.72;
  const ax = -w * 0.26;
  const bx = w * 0.27;
  const hA = Math.max(podH + 10, h * 0.84);
  const hB = Math.max(podH + 8, h * 0.66);
  o.facade.push(wallBox(aw, hA - podH, ad, ax, podH, 0, phase, podH / (FLOOR * ROWS)));
  o.facade.push(wallBox(aw * 0.88, hB - podH, ad * 0.88, bx, podH, 0, phase + 0.41, podH / (FLOOR * ROWS)));
  o.detail.push(box(aw + 0.4, 0.34, ad + 0.4, ax, hA + 0.17, 0, c.trim));
  o.detail.push(box(aw * 0.88 + 0.4, 0.34, ad * 0.88 + 0.4, bx, hB + 0.17, 0, c.trim));
  o.detail.push(box(aw * 0.35, 1.8, ad * 0.35, ax, hA + 1.2, 0, c.dark));
  o.detail.push(box(aw * 0.3, 1.5, ad * 0.3, bx, hB + 1.1, 0, c.dark));
  o.detail.push(box(0.18, 8, 0.18, ax, hA + 5.5, 0, c.metal));
  o.detail.push(box(0.18, 7, 0.18, bx, hB + 4.8, 0, c.metal));
  // A glazed skybridge links the pair below the shorter crown.
  const by = podH + (hB - podH) * 0.58;
  const bridgeW = w * 0.48;
  o.facade.push(wallBox(bridgeW, 2.5, d * 0.32, 0, by, 0, phase + 0.19, by / (FLOOR * ROWS)));
  o.detail.push(box(bridgeW + 0.24, 0.28, d * 0.32 + 0.24, 0, by, 0, c.trim));
  o.detail.push(box(bridgeW + 0.24, 0.28, d * 0.32 + 0.24, 0, by + 2.5, 0, c.trim));
  if (b.neon) {
    o.neon.push(box(0.32, 6, 0.3, ax + aw * 0.3, hA - 8, ad / 2 + 0.2, "#4db8ff"));
    o.neon.push(box(0.32, 4, 0.3, bx - aw * 0.2, hB - 6, ad * 0.44 + 0.2, "#ffd88a"));
  }
}

function roundTower(b: Block, o: Local, c: Colors, rng: () => number) {
  const { w, d, h, phase } = b;
  const podH = 4.6;
  const radius = Math.min(w, d) / 2;
  o.store.push(shopBox(w + 0.5, podH, d + 0.5, 0, 0, 0, phase));
  o.detail.push(box(w + 0.9, 0.42, d + 0.9, 0, 0.21, 0, c.dark));
  o.facade.push(roundWall(radius, h - podH, 0, podH, 0, phase, podH / (FLOOR * ROWS)));
  o.detail.push(roundSlab(radius + 0.45, 0.55, 0, h + 0.28, 0, c.trim));
  for (const f of [0.24, 0.48, 0.72]) {
    o.detail.push(roundSlab(radius + 0.32, 0.22, 0, podH + (h - podH) * f, 0, c.dark));
  }
  o.detail.push(roundSlab(radius * 0.3, 2.1, 0, h + 1.6, 0, c.dark));
  o.detail.push(box(0.2, 11, 0.2, 0, h + 7, 0, c.metal));
  if (b.neon) {
    o.neon.push(box(0.4, h * 0.45, 0.3, 0, podH + (h - podH) * 0.5, radius + 0.15, "#4db8ff"));
  }
}

function arcade(b: Block, o: Local, c: Colors, rng: () => number) {
  const { w, d, h, phase } = b;
  const podH = Math.min(13, Math.max(9, h * 0.34));
  // The shopfront is recessed behind a colonnade, so the street has depth.
  o.store.push(shopBox(w - 2.6, podH - 1.2, d - 2.6, 0, 0.6, 0, phase));
  o.detail.push(box(w + 0.6, 0.55, d + 0.6, 0, 0.28, 0, c.dark));
  const cols = Math.max(3, Math.round(w / 4.2));
  for (let i = 0; i < cols; i++) {
    const x = -w / 2 + 1.3 + (i / Math.max(1, cols - 1)) * (w - 2.6);
    o.detail.push(box(0.86, podH - 1.2, 0.86, x, (podH - 1.2) / 2 + 0.6, d / 2 - 0.55, c.light));
  }
  const sideCols = Math.max(2, Math.round(d / 5));
  for (const sx of [-1, 1]) {
    for (let i = 0; i < sideCols; i++) {
      const z = -d / 2 + 1.4 + (i / Math.max(1, sideCols - 1)) * (d - 2.8);
      o.detail.push(box(0.8, podH - 1.2, 0.8, sx * (w / 2 - 0.55), (podH - 1.2) / 2 + 0.6, z, c.light));
    }
  }
  o.detail.push(box(w + 1, 0.75, d + 1, 0, podH, 0, c.trim));
  const tw = w * 0.72;
  const td = d * 0.72;
  const shaft = Math.max(8, h - podH - 1.2);
  o.facade.push(wallBox(tw, shaft, td, 0, podH + 0.5, 0, phase + 0.23, podH / (FLOOR * ROWS)));
  o.detail.push(box(tw + 0.7, 0.6, td + 0.7, 0, podH + shaft + 0.6, 0, c.trim));
  o.detail.push(box(tw * 0.9, 1.7, td * 0.9, 0, podH + shaft + 1.5, 0, c.dark));
  o.detail.push(box(tw * 0.26, 1.4, td * 0.26, 0, podH + shaft + 3, 0, c.dark));
  const floors = Math.max(1, Math.floor((shaft - 2) / FLOOR));
  for (let f = 1; f <= Math.min(floors - 1, 2); f++) {
    const y = podH + 0.5 + f * FLOOR;
    const bw = tw * 0.52;
    o.detail.push(box(bw + 0.3, 0.18, 1.4, 0, y, td / 2 + 0.7, c.light));
    o.detail.push(box(bw + 0.3, 0.88, 0.07, 0, y + 0.5, td / 2 + 1.38, c.rail));
  }
  // The row of arches over the colonnade, faked with short lintels.
  for (let i = 0; i < cols - 1; i++) {
    const x = -w / 2 + 1.3 + ((i + 0.5) / Math.max(1, cols - 2)) * (w - 2.6);
    o.detail.push(box((w - 2.6) / Math.max(1, cols - 1) * 0.72, 0.55, 1.4, x, podH - 2.1, d / 2 - 1.1, c.dark));
  }
  if (b.neon) {
    o.neon.push(box(0.34, 4, 0.3, 0, podH + 4, td / 2 + 0.2, "#ffd88a"));
  }
}

// ─── Layout ─────────────────────────────────────────────────────────────────

const ARCS = 12;

type Bucket = Local & {
  pts: { x: number; z: number }[];
};

function averageCentre(track: ClubCircuit) {
  let x = 0;
  let z = 0;
  for (const p of track.points) {
    x += p.x;
    z += p.z;
  }
  return { x: x / track.points.length, z: z / track.points.length };
}

function chunkIndex(x: number, z: number, centre: { x: number; z: number }) {
  const angle = Math.atan2(z - centre.z, x - centre.x);
  return Math.max(0, Math.min(ARCS - 1, Math.floor(((angle + Math.PI) / (Math.PI * 2)) * ARCS)));
}

function finish(parts: THREE.BufferGeometry[]) {
  if (parts.length === 0) return null;
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return merged;
}

function finishBuckets(buckets: Bucket[], centre: { x: number; z: number }): CityChunk[] {
  const chunks: CityChunk[] = [];
  buckets.forEach((bucket, i) => {
    const facade = finish(bucket.facade);
    const store = finish(bucket.store);
    const detail = finish(bucket.detail);
    const neon = finish(bucket.neon);
    if (!facade && !store && !detail && !neon) return;
    let px = 0;
    let pz = 0;
    for (const p of bucket.pts) {
      px += p.x;
      pz += p.z;
    }
    const count = Math.max(1, bucket.pts.length);
    px /= count;
    pz /= count;
    let spread = 0;
    for (const p of bucket.pts) spread = Math.max(spread, Math.hypot(p.x - px, p.z - pz));
    chunks.push({
      x: px,
      z: pz,
      spread,
      facade,
      store,
      detail,
      neon: neon ?? null,
    });
  });
  return chunks;
}

/** The bay in front of a waterfront city: its near edge lies just outside the lap. */
export type SeaInfo = {
  x: number;
  z: number;
  r: number;
  angle: number;
  /** Distance from the lap centre to the shoreline. */
  shore: number;
  /** The sea is a closed bay with a far shore when true. */
  bay: boolean;
};

export function seaOf(track: ClubCircuit): SeaInfo | null {
  const profile = track.spec.profile;
  if (!profile.water) return null;
  const centre = averageCentre(track);
  const reach = Math.max(track.spec.shape.a, track.spec.shape.b);
  const angle = -0.6;
  const shore = reach + 70;
  if (profile.kind === "city") {
    const width = 520;
    const r = width / 2;
    return {
      x: centre.x + Math.cos(angle) * (shore + r),
      z: centre.z + Math.sin(angle) * (shore + r),
      r,
      angle,
      shore,
      bay: true,
    };
  }
  const r = 1400;
  return {
    x: centre.x + Math.cos(angle) * (shore + r),
    z: centre.z + Math.sin(angle) * (shore + r),
    r,
    angle,
    shore,
    bay: false,
  };
}

function inSea(sea: SeaInfo | null, x: number, z: number, margin = 12) {
  if (!sea) return false;
  return (x - sea.x) ** 2 + (z - sea.z) ** 2 < (sea.r + margin) ** 2;
}

/**
 * Neighborhoods, in the order they are built: a street wall on both sides of
 * the lap, a taller row behind it, landmark clusters, then the waterfront.
 */
export function buildCity(track: ClubCircuit, level: number): CityBuild {
  const profile = track.spec.profile;
  const city = profile.kind === "city";
  const night = profile.night;
  const tint = profile.buildingTint;
  const rng = makeRng(profile.crowdSeed + 907);
  const centre = averageCentre(track);
  const reach = Math.max(track.spec.shape.a, track.spec.shape.b);
  const sea = seaOf(track);
  const spawn = track.spawn;
  // The pit box and the team marquees need the start straight clear.
  const nearPaddock = (x: number, z: number, r = 82) =>
    (x - spawn.x) ** 2 + (z - spawn.z) ** 2 < r * r;
  // The band between the lap and the water is a promenade, not a building lot:
  // leaving it open is what makes the bay visible from the circuit.
  const seaBand = (x: number, z: number) => {
    if (!sea?.bay) return false;
    const away =
      (x - centre.x) * (sea.x - centre.x) + (z - centre.z) * (sea.z - centre.z);
    if (away <= 0) return false;
    return Math.hypot(x - sea.x, z - sea.z) < sea.r + 120;
  };
  const buckets: Bucket[] = Array.from({ length: ARCS }, () => ({
    facade: [],
    store: [],
    detail: [],
    neon: [],
    pts: [],
  }));
  const quality = level >= 2 ? 1 : level === 1 ? 0.74 : 0.45;

  const stands = Math.max(1, Math.round(profile.stands * (level >= 2 ? 1 : level === 1 ? 0.7 : 0.4)));
  const standIndices: number[] = [21];
  for (let s = 1; s < stands; s++) {
    standIndices.push(Math.floor((((s / stands + 0.02) % 1) * 600)) % 600);
  }
  const nearStand = (index: number) => {
    for (const j of standIndices) {
      const gap = Math.min(Math.abs(index - j), 600 - Math.abs(index - j));
      if (gap < 8) return true;
    }
    return false;
  };

  const addBlock = (b: Block) => {
    const local: Local = { facade: [], store: [], detail: [], neon: [] };
    const c = colorsOf(tint, night, rng);
    switch (b.kind) {
      case "tower":
        tower(b, local, c, rng);
        break;
      case "midrise":
        midrise(b, local, c, rng);
        break;
      case "hall":
        hall(b, local, c, rng);
        break;
      case "twin":
        twin(b, local, c, rng);
        break;
      case "round":
        roundTower(b, local, c, rng);
        break;
      default:
        arcade(b, local, c, rng);
        break;
    }
    const matrix = new THREE.Matrix4().makeRotationY(b.yaw);
    matrix.setPosition(b.x, 0, b.z);
    const target = buckets[chunkIndex(b.x, b.z, centre)]!;
    target.pts.push({ x: b.x, z: b.z });
    const take = (list: THREE.BufferGeometry[], key: "facade" | "store" | "detail" | "neon") => {
      if (list.length === 0) return;
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) return;
      merged.applyMatrix4(matrix);
      target[key].push(merged);
    };
    take(local.facade, "facade");
    take(local.store, "store");
    take(local.detail, "detail");
    take(local.neon, "neon");
  };

  const typeFor = (nearRow: boolean, h: number): Kind => {
    if (!city) return rng() < 0.55 ? "hall" : rng() < 0.7 ? "midrise" : "tower";
    const r = rng();
    if (h > 55) return r < 0.55 ? "tower" : r < 0.75 ? "twin" : r < 0.9 ? "round" : "arcade";
    if (nearRow) {
      if (profile.water) {
        // Côte d'Azur reads as a harbour city: arcaded podiums and low blocks.
        if (r < 0.34) return "arcade";
        if (r < 0.68) return "midrise";
        if (r < 0.8) return "hall";
        if (r < 0.92) return "tower";
        return "round";
      }
      if (r < 0.36) return "midrise";
      if (r < 0.62) return "arcade";
      if (r < 0.76) return "hall";
      if (r < 0.92) return "tower";
      return "round";
    }
    if (r < 0.4) return "tower";
    if (r < 0.6) return "twin";
    if (r < 0.75) return "round";
    if (r < 0.9) return "midrise";
    return "arcade";
  };

  const spacing = track.length / 600;
  const step = Math.max(4, Math.round((level >= 2 ? 26 : level === 1 ? 34 : 52) / spacing));
  // ── Street wall ───────────────────────────────────────────────────────────
  for (let i = 0; i < 600; i += step) {
    const point = track.points[i]!;
    const right = track.rights[i]!;
    for (const sign of [1, -1]) {
      // The main grandstand and the pit box need their own room.
      if (nearStand(i)) continue;
      if (i < 14 || i > 586) {
        if (sign < 0) continue; // pit lane side
      }
      const phase = rng();
      const w = Math.min(28, Math.max(12, step * spacing * (0.78 + rng() * 0.16)));
      const d = (city ? 14 : 11) + rng() * (city ? 10 : 9);
      const face = (city ? 9.4 : 12) + rng() * 2.6;
      const dist = track.halfWidth + face + d / 2;
      const x = point.x + right.x * dist * sign + (rng() - 0.5) * 3;
      const z = point.z + right.z * dist * sign + (rng() - 0.5) * 3;
      if (inSea(sea, x, z, d / 2 + 14)) continue;
      if (seaBand(x, z)) continue;
      const yaw = Math.atan2(-right.x * sign, -right.z * sign);
      if (!clearFootprint(track, x, z, yaw, w, d, track.halfWidth + 7.5)) continue;
      const tall = rng();
      const h = city
        ? tall < 0.18
          ? 46 + rng() * 48
          : tall < 0.58
            ? 20 + rng() * 22
            : 12 + rng() * 10
        : 6 + rng() * 16;
      addBlock({
        x,
        z,
        yaw,
        w,
        d,
        h,
        kind: typeFor(true, h),
        phase,
        neon: profile.neon && rng() < 0.55,
      });
    }
  }

  // ── Second row ────────────────────────────────────────────────────────────
  const step2 = Math.max(6, Math.round((level >= 2 ? 42 : level === 1 ? 58 : 88) / spacing));
  for (let i = Math.floor(step2 / 2); i < 600; i += step2) {
    const point = track.points[i]!;
    const right = track.rights[i]!;
    for (const sign of [1, -1]) {
      if (rng() > quality + 0.12) continue;
      if (sign < 0 && (i < 18 || i > 582)) continue;
      const w = 18 + rng() * 18;
      const d = 17 + rng() * 15;
      const dist = track.halfWidth + 28 + rng() * 22 + d / 2;
      const x = point.x + right.x * dist * sign + (rng() - 0.5) * 12;
      const z = point.z + right.z * dist * sign + (rng() - 0.5) * 12;
      if (nearPaddock(x, z)) continue;
      if (inSea(sea, x, z, Math.hypot(w, d) / 2 + 16)) continue;
      if (seaBand(x, z)) continue;
      const yaw = Math.atan2(-right.x * sign, -right.z * sign) + (rng() - 0.5) * 0.2;
      if (!clearFootprint(track, x, z, yaw, w, d, track.halfWidth + 15)) continue;
      const h = city ? 30 + rng() * 70 : 10 + rng() * 22;
      addBlock({
        x,
        z,
        yaw,
        w,
        d,
        h,
        kind: typeFor(false, h),
        phase: rng(),
        neon: profile.neon && rng() < 0.5,
      });
    }
  }

  // ── Landmark clusters ─────────────────────────────────────────────────────
  const clusters = city ? (level >= 2 ? 4 : level === 1 ? 3 : 2) : 2;
  for (let c = 0; c < clusters; c++) {
    const angle = profile.crowdSeed * 0.37 + (c / clusters) * Math.PI * 2;
    const radius = reach * (1.22 + rng() * 0.2) + 70;
    const cx = centre.x + Math.cos(angle) * radius;
    const cz = centre.z + Math.sin(angle) * radius;
    const n = city ? 5 + Math.floor(rng() * 4) : 3;
    for (let k = 0; k < n; k++) {
      const x = cx + (rng() - 0.5) * 150;
      const z = cz + (rng() - 0.5) * 150;
      if (nearPaddock(x, z)) continue;
      if (inSea(sea, x, z, 26)) continue;
      const w = 18 + rng() * 18;
      const d = 18 + rng() * 16;
      const yaw = rng() * Math.PI;
      if (!clearFootprint(track, x, z, yaw, w, d, track.halfWidth + 14)) continue;
      const h = city ? 70 + rng() * 70 : 24 + rng() * 30;
      addBlock({
        x,
        z,
        yaw,
        w,
        d,
        h,
        kind: city ? (rng() < 0.55 ? "tower" : rng() < 0.7 ? "twin" : "round") : "tower",
        phase: rng(),
        neon: profile.neon,
      });
    }
  }

  // ── Promenade front on the near shore ─────────────────────────────────────
  // Low blocks follow the two ends of the bay, leaving the middle open so the
  // water and the far skyline stay in view from the circuit. Everything sits on
  // land: a positive offset from the waterline, never inside the bay.
  if (sea?.bay) {
    const land = sea.angle + Math.PI;
    const n = level >= 2 ? 20 : level === 1 ? 13 : 7;
    for (let k = 0; k < n; k++) {
      const a = land + (k / Math.max(1, n - 1) - 0.5) * 2.1;
      const rr = sea.r + 22 + rng() * 26;
      const x = sea.x + Math.cos(a) * rr;
      const z = sea.z + Math.sin(a) * rr;
      const w = 16 + rng() * 10;
      const d = 12 + rng() * 6;
      const yaw = Math.atan2(-Math.cos(a), -Math.sin(a));
      if (inSea(sea, x, z, 14)) continue;
      if (!clearFootprint(track, x, z, yaw, w, d, track.halfWidth + 8)) continue;
      addBlock({
        x,
        z,
        yaw,
        w,
        d,
        h: 14 + rng() * 18,
        kind: rng() < 0.55 ? "arcade" : "midrise",
        phase: rng(),
        neon: false,
      });
    }
  }

  return {
    chunks: finishBuckets(buckets, centre),
    facade: facadeMaps(night, tint, 17 + profile.crowdSeed),
    store: storeMaps(night, tint, 31 + profile.crowdSeed),
  };
}

/**
 * Distance from every point of the lap to the *oriented footprint* of a block.
 * A bounding circle is far too pessimistic for a 20 x 18 m building lined up
 * with the street: it would reject the entire front row even though its facade
 * stands ten metres clear of the asphalt. Testing the rectangle itself lets the
 * street wall sit close without ever putting a corner over the track.
 */
function clearFootprint(
  track: ClubCircuit,
  x: number,
  z: number,
  yaw: number,
  w: number,
  d: number,
  min: number,
) {
  const ax = Math.cos(yaw);
  const az = -Math.sin(yaw);
  const bx = Math.sin(yaw);
  const bz = Math.cos(yaw);
  const hw = w / 2;
  const hd = d / 2;
  const m = min * min;
  for (let i = 0; i < 600; i += 2) {
    const p = track.points[i]!;
    const dx = p.x - x;
    const dz = p.z - z;
    const lx = Math.abs(dx * ax + dz * az) - hw;
    const lz = Math.abs(dx * bx + dz * bz) - hd;
    const qx = Math.max(0, lx);
    const qz = Math.max(0, lz);
    if (qx * qx + qz * qz < m) return false;
  }
  return true;
}

// ─── Distant skyline ─────────────────────────────────────────────────────────

function skyTower(
  facade: THREE.BufferGeometry[],
  detail: THREE.BufferGeometry[],
  x: number,
  z: number,
  yaw: number,
  w: number,
  d: number,
  h: number,
  phase: number,
  dark: string,
  metal: string,
) {
  const localF: THREE.BufferGeometry[] = [];
  const localD: THREE.BufferGeometry[] = [];
  const h1 = h * 0.6;
  const h2 = h * 0.25;
  const h3 = h * 0.15;
  localF.push(wallBox(w, h1, d, 0, 0, 0, phase, 0));
  localF.push(wallBox(w * 0.72, h2, d * 0.72, 0, h1, 0, phase + 0.17, h1 / (FLOOR * ROWS)));
  localF.push(wallBox(w * 0.44, h3, d * 0.44, 0, h1 + h2, 0, phase + 0.31, (h1 + h2) / (FLOOR * ROWS)));
  localD.push(box(w + 0.4, 0.4, d + 0.4, 0, h1, 0, dark));
  localD.push(box(w * 0.72 + 0.4, 0.35, d * 0.72 + 0.4, 0, h1 + h2, 0, dark));
  localD.push(box(w * 0.44 + 0.4, 0.4, d * 0.44 + 0.4, 0, h1 + h2 + h3, 0, dark));
  localD.push(box(0.18, 9 + (h % 13), 0.18, 0, h + 5, 0, metal));
  const matrix = new THREE.Matrix4().makeRotationY(yaw);
  matrix.setPosition(x, 0, z);
  const mf = mergeGeometries(localF, false);
  const md = mergeGeometries(localD, false);
  for (const g of localF) g.dispose();
  for (const g of localD) g.dispose();
  if (mf) {
    mf.applyMatrix4(matrix);
    facade.push(mf);
  }
  if (md) {
    md.applyMatrix4(matrix);
    detail.push(md);
  }
}

export function buildSkyline(track: ClubCircuit, level: number): SkyBuild {
  const profile = track.spec.profile;
  const night = profile.night;
  const rng = makeRng(profile.crowdSeed + 173);
  const centre = averageCentre(track);
  const reach = Math.max(track.spec.shape.a, track.spec.shape.b);
  const sea = seaOf(track);
  const buckets: Bucket[] = Array.from({ length: ARCS }, () => ({
    facade: [],
    store: [],
    detail: [],
    neon: [],
    pts: [],
  }));
  const count = level >= 2 ? 132 : level === 1 ? 68 : 24;
  const dark = night ? "#242c3a" : "#8d99a9";
  const metal = night ? "#354052" : "#7d8998";
  const place = (x: number, z: number, w: number, d: number, h: number, yaw: number, phase: number) => {
    const bucket = buckets[chunkIndex(x, z, centre)]!;
    bucket.pts.push({ x, z });
    skyTower(bucket.facade, bucket.detail, x, z, yaw, w, d, h, phase, dark, metal);
  };
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rng() * 0.05;
    const radius = reach + 150 + rng() * 260;
    let x = centre.x + Math.cos(a) * radius;
    let z = centre.z + Math.sin(a) * radius;
    // Never build in the bay: the far shore has its own row below.
    if (inSea(sea, x, z, 24)) {
      if (sea?.bay) continue;
      continue;
    }
    const w = 14 + rng() * 20;
    const d = 14 + rng() * 20;
    const h = 22 + rng() * (profile.kind === "city" ? 105 : 52);
    place(x, z, w, d, h, rng() * Math.PI, rng());
  }
  // Across the bay: a low waterfront row and a taller skyline behind it. This
  // is the Montreal/Manhattan view — the far side of the water is a city, not
  // an empty horizon.
  if (sea?.bay) {
    const rows = 2;
    const per = level >= 2 ? 30 : level === 1 ? 18 : 9;
    for (let row = 0; row < rows; row++) {
      for (let k = 0; k < per; k++) {
        const a = sea.angle + ((k / Math.max(1, per - 1)) - 0.5) * 1.25 + (rng() - 0.5) * 0.02;
        const radius = sea.r + 18 + row * 38 + rng() * 12;
        const x = sea.x + Math.cos(a) * radius;
        const z = sea.z + Math.sin(a) * radius;
        const w = 14 + rng() * 16;
        const d = 14 + rng() * 16;
        const h = row === 0 ? 18 + rng() * 26 : 42 + rng() * 78;
        // Face the water: local +z points back towards the sea centre.
        place(x, z, w, d, h, Math.atan2(-Math.cos(a), -Math.sin(a)) + (rng() - 0.5) * 0.12, rng());
      }
    }
  }
  return {
    chunks: finishBuckets(buckets, centre),
    facade: facadeMaps(night, "#8f9aa9", 71 + profile.crowdSeed),
  };
}
