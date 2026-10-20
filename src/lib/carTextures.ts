import * as THREE from "three";

/**
 * The small canvases the bodywork is dressed with.
 *
 * Everything the eye reads up close — the twill of the aero kit, the mesh in the
 * grille, the flake under the clearcoat, the lettering on the tyre wall — is
 * drawn here once and shared by every car in the scene. A richer surface
 * therefore costs a few kilobytes of canvas and never an image download, and the
 * same textures are used by all three classes, so a street coupé, a hypercar and
 * a touring car are finished to the same standard.
 */

function painted(
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  colorSpace: THREE.ColorSpace = THREE.SRGBColorSpace,
): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  draw(ctx, w, h);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  texture.colorSpace = colorSpace;
  return texture;
}

/** Fits a line of text to a fraction of the canvas width, centred on (x, y). */
function fitted(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  max: number,
  weight = 700,
) {
  ctx.font = `italic ${weight} 64px system-ui, sans-serif`;
  const wide = ctx.measureText(text).width;
  const scale = Math.min(1, max / Math.max(1, wide));
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

let carbon: THREE.CanvasTexture | null = null;

/** 2×2 twill: the weave the splitter, the skirts and the wing are laid up in. */
export function carbonTexture() {
  if (carbon) return carbon;
  carbon = painted(256, 256, (ctx, s) => {
    ctx.fillStyle = "#101317";
    ctx.fillRect(0, 0, s, s);
    const cells = 8;
    const cell = s / cells;
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        // Alternate the tow direction cell by cell: that checkerboard of
        // highlight and shade is what reads as carbon from any distance.
        const over = (x + y) % 2 === 0;
        const cx = x * cell;
        const cy = y * cell;
        const g = over
          ? ctx.createLinearGradient(cx, cy, cx + cell, cy + cell)
          : ctx.createLinearGradient(cx + cell, cy, cx, cy + cell);
        g.addColorStop(0, "#39414b");
        g.addColorStop(0.45, "#20262d");
        g.addColorStop(1, "#0d1014");
        ctx.fillStyle = g;
        ctx.fillRect(cx, cy, cell, cell);
        ctx.strokeStyle = over ? "rgba(206,219,234,0.16)" : "rgba(206,219,234,0.07)";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        if (over) {
          ctx.moveTo(cx + 1, cy + cell * 0.5);
          ctx.lineTo(cx + cell - 1, cy + cell * 0.5);
        } else {
          ctx.moveTo(cx + cell * 0.5, cy + 1);
          ctx.lineTo(cx + cell * 0.5, cy + cell - 1);
        }
        ctx.stroke();
      }
    }
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = `rgba(255,255,255,${(Math.random() * 0.05).toFixed(3)})`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 1.6, 1.6);
    }
  });
  carbon?.repeat.set(2, 2);
  return carbon;
}

let grille: THREE.CanvasTexture | null = null;

/** The open hex mesh that fills the grille, the ducts and the intakes. */
export function grilleTexture() {
  if (grille) return grille;
  grille = painted(256, 256, (ctx, s) => {
    ctx.fillStyle = "#05060a";
    ctx.fillRect(0, 0, s, s);
    const step = 18;
    for (let y = 0; y < s; y += step) {
      for (let x = 0; x < s; x += step) {
        const ox = ((y / step) % 2) * (step / 2);
        ctx.fillStyle = "#1a1f27";
        ctx.beginPath();
        ctx.arc(x + ox + step / 2, y + step / 2, step * 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(196,209,224,0.55)";
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(x + ox + step / 2, y + step / 2, step * 0.3, Math.PI * 0.15, Math.PI * 1.1);
        ctx.stroke();
      }
    }
  });
  grille?.repeat.set(3, 3);
  return grille;
}

let flake: THREE.CanvasTexture | null = null;

/**
 * The metallic flake under a clearcoat: a very shallow normal map, so the
 * highlights break up as the car turns instead of sliding over the panel like a
 * mirror. It is used by every paint in the game, so the surface is identical on
 * all three classes.
 */
export function flakeNormalTexture() {
  if (flake) return flake;
  flake = painted(
    128,
    128,
    (ctx, s) => {
      ctx.fillStyle = "rgb(128,128,255)";
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 3200; i++) {
        const x = Math.random() * s;
        const y = Math.random() * s;
        const tilt = (Math.random() - 0.5) * 40;
        ctx.fillStyle = `rgba(${Math.round(128 + tilt)},${Math.round(128 - tilt * 0.6)},255,0.5)`;
        ctx.fillRect(x, y, 1.5, 1.5);
      }
    },
    THREE.NoColorSpace,
  );
  flake?.repeat.set(7, 7);
  return flake;
}

let tread: THREE.CanvasTexture | null = null;

/**
 * A tyre laid flat: the strip is mapped across the width of the rubber, so the
 * grooves run around the circumference and the sidewall lettering wraps the
 * wall — exactly the way the lathe and the racing cylinder unwrap it.
 */
export function tyreTexture() {
  if (tread) return tread;
  tread = painted(512, 256, (ctx, w, h) => {
    ctx.fillStyle = "#111418";
    ctx.fillRect(0, 0, w, h);
    // Sidewalls: a darker wall with a sheen, so the two ends of the strip read
    // as the wall of a tyre instead of more tread.
    for (const v of [0.15, 0.85]) {
      const g = ctx.createLinearGradient(0, (v - 0.13) * h, 0, (v + 0.13) * h);
      g.addColorStop(0, "#0c0e11");
      g.addColorStop(0.5, "#191d22");
      g.addColorStop(1, "#0c0e11");
      ctx.fillStyle = g;
      ctx.fillRect(0, (v - 0.14) * h, w, 0.28 * h);
      ctx.fillStyle = "rgba(232,238,244,0.8)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const wall = h * 0.055;
      ctx.font = `italic 700 ${Math.round(wall)}px system-ui, sans-serif`;
      for (let i = 0; i < 2; i++) {
        fitted(ctx, "GRAND HORIZON", (i + 0.5) * (w / 2), v * h - wall * 0.5, w * 0.36);
      }
      ctx.fillStyle = "rgba(214,222,230,0.6)";
      ctx.font = `600 ${Math.round(wall * 0.78)}px system-ui, sans-serif`;
      ctx.fillText("245/40 R18", w * 0.2, v * h + wall * 1.2);
      ctx.fillText("245/40 R18", w * 0.7, v * h - wall * 1.4);
    }
    // Tread: three circumferential grooves with staggered blocks either side.
    const groove = h * 0.028;
    for (const v of [0.4, 0.5, 0.6]) {
      ctx.fillStyle = "#08090b";
      ctx.fillRect(0, v * h - groove / 2, w, groove);
      ctx.fillStyle = "rgba(120,132,146,0.25)";
      ctx.fillRect(0, v * h - groove / 2, w, 1.5);
    }
    for (const v of [0.33, 0.67]) {
      for (let i = 0; i < 16; i++) {
        const x = (i / 16) * w + (v > 0.5 ? w / 32 : 0);
        ctx.fillStyle = "rgba(8,9,11,0.85)";
        ctx.fillRect(x, v * h - h * 0.02, w / 40, h * 0.04);
      }
    }
    // Fine grain over the whole strip.
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(255,255,255,${(Math.random() * 0.04).toFixed(3)})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 1.5);
    }
  });
  tread?.repeat.set(1, 1);
  return tread;
}

let wall: THREE.CanvasTexture | null = null;

/** The disc on the side of a tyre, for the caps of the racing cylinder. */
export function tyreWallTexture() {
  if (wall) return wall;
  wall = painted(256, 256, (ctx, s) => {
    const c = s / 2;
    const g = ctx.createRadialGradient(c, c, s * 0.3, c, c, s * 0.5);
    g.addColorStop(0, "#0b0d10");
    g.addColorStop(0.72, "#1b1f24");
    g.addColorStop(1, "#0b0d10");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    // Branding around the wall: one glyph at a time, each turned to sit square
    // on the ring, the way the lettering is moulded into a real sidewall.
    const text = "GRAND HORIZON ·  245/40 R18 · ";
    const radius = s * 0.42;
    ctx.fillStyle = "rgba(236,241,246,0.85)";
    ctx.font = `italic 700 ${Math.round(s * 0.055)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < text.length; i++) {
      const a = (i / text.length) * Math.PI * 2 - Math.PI / 2;
      ctx.save();
      ctx.translate(c + Math.cos(a) * radius, c + Math.sin(a) * radius);
      ctx.rotate(a + Math.PI / 2);
      ctx.fillText(text[i]!, 0, 0);
      ctx.restore();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c, c, radius * 1.12, 0, Math.PI * 2);
    ctx.stroke();
  });
  wall?.repeat.set(1, 1);
  return wall;
}
