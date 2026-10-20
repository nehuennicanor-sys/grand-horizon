// Deterministic pseudo-random numbers for procedural textures.
//
// Hand-rolled "noise" that walks the canvas with `(i * a) % size` is a trap:
// x and y are both linear in i, so the samples do not scatter — they line up
// along diagonal bands, which is exactly why the asphalt kept reading as
// tiled planks instead of grain. A tiny mulberry32 PRNG gives real scatter,
// stays reproducible between reloads, and costs nothing at startup.
export function makeRng(seed: number) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fills a canvas with fine, evenly scattered grain. */
export function drawGrain(
  ctx: CanvasRenderingContext2D,
  size: number,
  count: number,
  alpha: number,
  light: string,
  dark: string,
  seed = 0x9e3779b9,
) {
  const rnd = makeRng(seed);
  const lightRgb = light;
  const darkRgb = dark;
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rnd() * size);
    const y = Math.floor(rnd() * size);
    const dot = rnd() < 0.42 ? 2 : 1;
    ctx.globalAlpha = alpha * (0.35 + rnd());
    ctx.fillStyle = rnd() < 0.5 ? lightRgb : darkRgb;
    ctx.fillRect(x, y, dot, dot);
  }
  ctx.globalAlpha = 1;
}
