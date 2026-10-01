import type { CarConfig } from "@/lib/car";

const BODIES = {
  sedan: {
    body: "M20 112 L28 88 Q34 80 60 76 L110 70 L150 42 Q160 36 180 36 L262 36 Q280 36 296 50 L326 72 L372 78 Q392 82 396 96 L398 112 Z",
    glass: "M118 70 L154 46 Q160 42 172 42 L210 42 L210 70 Z M218 42 L260 42 Q274 42 286 54 L304 70 L218 70 Z",
    fw: 92, rw: 318, wy: 112,
  },
  coupe: {
    body: "M16 112 L22 92 Q28 84 56 80 L120 72 L170 44 Q182 38 204 38 L250 40 Q272 42 296 58 L340 78 L380 82 Q398 86 400 100 L400 112 Z",
    glass: "M132 72 L174 48 Q182 44 196 44 L232 44 L238 72 Z M244 46 Q266 48 284 60 L306 74 L246 74 Z",
    fw: 90, rw: 322, wy: 112,
  },
  hiper: {
    body: "M10 112 L14 98 Q20 90 50 86 L130 76 L196 48 Q214 42 236 44 L268 48 Q300 56 330 74 L384 84 Q402 88 404 102 L404 112 Z",
    glass: "M150 76 L200 52 Q214 46 232 48 L262 52 Q286 60 300 72 L304 78 Z",
    fw: 88, rw: 326, wy: 112,
  },
};

export function CarSvg({ car, className, spin = false }: { car: CarConfig; className?: string; spin?: boolean }) {
  const b = BODIES[car.body];
  const wr = 14 + car.wheelSize * 0.9;
  const style = car.wheelStyle ?? "rayos";
  const lift = ((car.rideHeight ?? 0.5) - 0.5) * -12;
  const roofS = 0.86 + (car.roof ?? 0.5) * 0.28;
  const wheel = (cx: number) => (
    <g key={cx}>
      <circle cx={cx} cy={b.wy} r={wr} fill="#0b0c0f" />
      <g className={spin ? "origin-center animate-spin" : ""} style={{ transformOrigin: `${cx}px ${b.wy}px`, animationDuration: "0.25s" }}>
        <circle cx={cx} cy={b.wy} r={wr * 0.66} fill={car.wheelColor} />
        {style === "rayos" && [0, 72, 144, 216, 288].map((a) => (
          <rect key={a} x={cx - 2.5} y={b.wy - wr * 0.62} width={5} height={wr * 0.62} fill="#0b0c0f" opacity={0.55} transform={`rotate(${a} ${cx} ${b.wy})`} />
        ))}
        {style === "multirayo" && Array.from({ length: 10 }, (_, i) => i * 36).map((a) => (
          <rect key={a} x={cx - 1} y={b.wy - wr * 0.62} width={2} height={wr * 0.62} fill="#0b0c0f" opacity={0.6} transform={`rotate(${a} ${cx} ${b.wy})`} />
        ))}
        {style === "disco" && <circle cx={cx} cy={b.wy} r={wr * 0.5} fill="none" stroke="#000" strokeOpacity={0.35} strokeWidth={2} />}
        {style === "malla" && [0, 30, 60, 90, 120, 150].map((a) => (
          <rect key={a} x={cx - 0.75} y={b.wy - wr * 0.62} width={1.5} height={wr * 1.24} fill="#0b0c0f" opacity={0.5} transform={`rotate(${a} ${cx} ${b.wy})`} />
        ))}
        <circle cx={cx} cy={b.wy} r={wr * 0.16} fill="#c9ccd1" />
      </g>
    </g>
  );
  return (
    <svg viewBox="0 0 420 150" className={className} role="img" aria-label={car.name}>
      <ellipse cx={210} cy={b.wy + wr - 2} rx={190} ry={7} fill="#000" opacity={0.45} />
      <g transform={`translate(0 ${lift}) translate(0 112) scale(1 ${roofS}) translate(0 -112)`}>
      <path d={b.body} fill={car.color} stroke="#000" strokeOpacity={0.4} strokeWidth={1.5} />
      {car.stripes && <path d="M20 98 L400 98 L400 104 L20 104 Z" fill={car.accent} opacity={0.9} />}
      <path d={b.glass} fill="#1a2330" opacity={0.92} />
      <path d={b.body} fill="url(#shine)" />
      <rect x={14} y={104} width={392} height={8} fill={car.accent} opacity={0.85} />
      <rect x={378} y={86} width={18} height={6} rx={2} fill="#ffe9a8" />
      <rect x={18} y={90} width={14} height={6} rx={2} fill="#ff3b30" />
      {car.spoiler && (
        <g fill={car.accent}>
          <rect x={14} y={car.body === "hiper" ? 58 : 62} width={70} height={7} rx={2} />
          <rect x={38} y={car.body === "hiper" ? 64 : 68} width={6} height={18} />
        </g>
      )}
      {car.downforce > 0.4 && <path d="M372 108 L408 108 L408 114 L366 114 Z" fill={car.accent} />}
      </g>
      <defs>
        <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity={0.35} />
          <stop offset="0.45" stopColor="#fff" stopOpacity={0} />
          <stop offset="1" stopColor="#000" stopOpacity={0.25} />
        </linearGradient>
      </defs>
      {wheel(b.fw)}
      {wheel(b.rw)}
    </svg>
  );
}
