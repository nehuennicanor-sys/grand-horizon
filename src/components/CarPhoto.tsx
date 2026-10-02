import { useState } from "react";
import garageBg from "@/assets/garage-bg.jpg";
import { streamImage } from "@/lib/stream-image";
import { specs, type CarConfig } from "@/lib/car";

const BODY: Record<string, string> = {
  sedan: "four-door sport sedan",
  coupe: "two-door sports coupé",
  hiper: "low, wide mid-engine hypercar with dramatic aero",
};
const WHEELS: Record<string, string> = {
  rayos: "classic 5-spoke", multirayo: "multi-spoke", disco: "flat aero disc", malla: "mesh/BBS-style",
};

function prompt(car: CarConfig) {
  const s = specs(car);
  return [
    `Place a photorealistic ${BODY[car.body] ?? "car"} parked in the center of this garage workshop, shown in a 3/4 front view, keeping the garage background, lighting and atmosphere.`,
    `Paint color ${car.color} with ${car.accent} accent details. ${car.wheelSize}-inch ${WHEELS[car.wheelStyle] ?? ""} wheels in ${car.wheelColor}.`,
    `Ride height ${Math.round(60 + car.rideHeight * 120)} mm, ${car.roof < 0.33 ? "very low" : car.roof < 0.66 ? "medium" : "tall"} roofline.`,
    car.spoiler ? "Large rear wing spoiler." : "No rear wing.",
    car.stripes ? `Racing stripe along the side in ${car.accent}.` : "",
    `About ${s.hp} hp ${car.layout} engine character. Original design, no brand logos, no text. Studio-quality automotive photography, realistic reflections.`,
  ].join(" ");
}

export function CarPhoto({ car }: { car: CarConfig }) {
  const [img, setImg] = useState<string | null>(null);
  const [final, setFinal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true); setErr(null); setImg(null); setFinal(false);
    try {
      const blob = await (await fetch(garageBg)).blob();
      const form = new FormData();
      form.append("image", new File([blob], "garage.jpg", { type: blob.type || "image/jpeg" }));
      form.append("prompt", prompt(car));
      await streamImage("/api/car-photo", form, (url, isFinal) => { setImg(url); setFinal(isFinal); });
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      setErr(m.includes("402") ? "Sin créditos de IA disponibles." : m.includes("429") ? "Demasiadas solicitudes, probá en un momento." : "No se pudo generar la foto.");
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-6 rounded-xl border border-border bg-card/60 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-display text-xs tracking-widest text-muted-foreground">FOTO REALISTA EN EL TALLER</h3>
        <button onClick={run} disabled={busy}
          className="rounded-md bg-primary px-4 py-2 font-display text-xs font-bold tracking-widest text-primary-foreground disabled:opacity-60">
          {busy ? "REVELANDO…" : img ? "OTRA FOTO" : "GENERAR FOTO"}
        </button>
      </div>
      <div className="relative aspect-square overflow-hidden rounded-lg bg-muted">
        <img src={img ?? garageBg} alt={img ? "Foto realista de tu auto en el taller" : "Taller"}
          className={`h-full w-full object-cover transition-[filter] duration-700 ${img && !final ? "blur-2xl" : img ? "blur-0" : "opacity-40"}`} />
        {!img && !busy && <p className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted-foreground">Tu auto con los colores, llantas y extras que elegiste.</p>}
        {busy && !img && <p className="absolute inset-0 grid place-items-center font-mono text-xs text-muted-foreground animate-pulse">Preparando la escena…</p>}
      </div>
      {err && <p className="mt-2 text-sm text-destructive">{err}</p>}
    </div>
  );
}
