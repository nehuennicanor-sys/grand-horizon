import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CarSvg } from "@/components/CarSvg";
import {
  defaultCar, gearRatios, LAYOUTS, RIVALS, simulate, specs,
  type CarConfig, type Category, type Result,
} from "@/lib/car";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Garage Lab — Armá tu auto desde cero" },
      { name: "description", content: "Diseñá motor, transmisión, chasis y carrocería de tu auto, y ponelo a prueba en la pista." },
      { property: "og:title", content: "Garage Lab — Armá tu auto desde cero" },
      { property: "og:description", content: "Diseñá cada pieza de tu auto y probá su velocidad." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Garage,
});

const STEPS = ["Clase", "Motor", "Transmisión", "Chasis", "Diseño", "Prueba"] as const;
const LIMITS: Record<Category, { disp: [number, number]; rpm: [number, number]; layouts: string[] }> = {
  normal: { disp: [1, 3], rpm: [5000, 7000], layouts: ["I3", "I4", "I6", "V6"] },
  deportivo: { disp: [1.6, 5], rpm: [6000, 8500], layouts: ["I4", "I6", "V6", "V8"] },
  super: { disp: [3, 8], rpm: [7000, 9500], layouts: ["V8", "V10", "V12", "W16"] },
};

// Empty chassis: neutral starting values, nothing installed.
function blankCar(): CarConfig {
  return {
    ...defaultCar("normal"),
    name: "Mi auto", layout: "I4", displacement: 2, aspiration: "atmosferico", maxRpm: 6500, boost: 0.5,
    gearbox: "manual", gears: 6, finalDrive: 3.6, drive: "RWD", material: "acero", tires: "deportivo",
    downforce: 0, body: "coupe", color: "#8a8f98", accent: "#1a1c21", wheelColor: "#2a2d33",
    spoiler: false, stripes: false, wheelSize: 17,
  };
}

function Garage() {
  const [car, setCar] = useState<CarConfig>(blankCar);
  const [step, setStep] = useState(0);
  const [installed, setInstalled] = useState<boolean[]>([false, false, false, false, false]);
  const set = <K extends keyof CarConfig>(k: K, v: CarConfig[K]) => setCar((c) => ({ ...c, [k]: v }));
  const s = useMemo(() => specs(car), [car]);
  const lim = LIMITS[car.category];
  const ready = installed.every(Boolean);

  const install = () => {
    setInstalled((p) => p.map((v, i) => (i === step ? true : v)));
    setStep((x) => Math.min(x + 1, 5));
  };

  const pickCategory = (c: Category) => {
    const L = LIMITS[c];
    setCar((p) => ({
      ...p, category: c,
      displacement: Math.min(Math.max(p.displacement, L.disp[0]), L.disp[1]),
      maxRpm: Math.min(Math.max(p.maxRpm, L.rpm[0]), L.rpm[1]),
      layout: (L.layouts.includes(p.layout) ? p.layout : L.layouts[0]) as CarConfig["layout"],
    }));
  };

  return (
    <div className="min-h-screen bg-background bg-hero font-sans text-foreground">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
        <h1 className="font-display text-xl font-black tracking-widest">GARAGE<span className="text-primary">LAB</span></h1>
        <p className="hidden text-sm text-muted-foreground sm:block">Armá tu auto pieza por pieza</p>
      </header>

      <nav className="mx-auto flex max-w-7xl gap-2 overflow-x-auto px-6 pb-4">
        {STEPS.map((name, i) => {
          const locked = i === 5 && !ready;
          return (
            <button key={name} disabled={locked} onClick={() => setStep(i)}
              className={`flex shrink-0 items-center gap-2 rounded-md border px-4 py-2 font-display text-xs tracking-wider transition ${
                step === i ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary"
              } disabled:cursor-not-allowed disabled:opacity-40`}>
              <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${installed[i] ? "bg-accent text-accent-foreground" : "bg-muted"}`}>
                {installed[i] ? "✓" : i + 1}
              </span>
              {name.toUpperCase()}
            </button>
          );
        })}
      </nav>

      <main className="mx-auto grid max-w-7xl gap-6 px-6 pb-16 lg:grid-cols-[1fr_380px]">
        <section className="space-y-6">
          <div className="relative overflow-hidden rounded-xl border border-border bg-card p-6">
            <div className="absolute inset-x-0 bottom-10 h-px bg-border" />
            <BuildPreview car={car} installed={installed} />
            <div className="mt-2 flex items-end justify-between">
              <div>
                <p className="text-xs uppercase tracking-widest text-muted-foreground">{car.category}</p>
                <p className="font-display text-2xl font-bold">{car.name || "Sin nombre"}</p>
              </div>
              <p className="font-mono text-xs text-muted-foreground">{installed.filter(Boolean).length}/5 módulos</p>
            </div>
          </div>

          {step < 5 ? (
            <div className="rounded-xl border border-border bg-card p-6">
              {step === 0 && (
                <Panel title="Elegí la clase" hint="Define qué piezas vas a poder usar.">
                  <div className="grid gap-3 sm:grid-cols-3">
                    {([["normal", "Normal", "Uso diario, eficiente"], ["deportivo", "Deportivo", "Equilibrio y potencia"], ["super", "Superdeportivo", "Sin límites"]] as const).map(([k, l, d]) => (
                      <Choice key={k} active={car.category === k} onClick={() => pickCategory(k)} title={l} desc={d} />
                    ))}
                  </div>
                  <label className="block">
                    <span className="text-sm text-muted-foreground">Nombre del proyecto</span>
                    <input value={car.name} onChange={(e) => set("name", e.target.value)} maxLength={24}
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 font-display outline-none focus:border-primary" />
                  </label>
                </Panel>
              )}
              {step === 1 && (
                <Panel title="Diseñá el motor" hint="Cilindros, cilindrada, aspiración y régimen.">
                  <Group label="Configuración de cilindros">
                    {lim.layouts.map((l) => <Pill key={l} active={car.layout === l} onClick={() => set("layout", l as CarConfig["layout"])}>{l}</Pill>)}
                  </Group>
                  <Range label="Cilindrada" value={car.displacement} min={lim.disp[0]} max={lim.disp[1]} step={0.1} unit="L" onChange={(v) => set("displacement", v)} />
                  <Group label="Aspiración">
                    {([["atmosferico", "Atmosférico"], ["turbo", "Turbo"], ["biturbo", "Biturbo"], ["compresor", "Compresor"]] as const).map(([k, l]) =>
                      <Pill key={k} active={car.aspiration === k} onClick={() => set("aspiration", k)}>{l}</Pill>)}
                  </Group>
                  {car.aspiration !== "atmosferico" && <Range label="Presión de soplado" value={car.boost} min={0} max={1} step={0.05} unit="" fmt={(v) => `${(0.4 + v * 1.2).toFixed(1)} bar`} onChange={(v) => set("boost", v)} />}
                  <Range label="Corte de RPM" value={car.maxRpm} min={lim.rpm[0]} max={lim.rpm[1]} step={100} unit="rpm" onChange={(v) => set("maxRpm", v)} />
                </Panel>
              )}
              {step === 2 && (
                <Panel title="Transmisión y eje" hint="Caja, relaciones y tracción.">
                  <Group label="Caja de cambios">
                    {([["manual", "Manual"], ["automatica", "Automática"], ["doble-embrague", "Doble embrague"]] as const).map(([k, l]) =>
                      <Pill key={k} active={car.gearbox === k} onClick={() => set("gearbox", k)}>{l}</Pill>)}
                  </Group>
                  <Range label="Cantidad de marchas" value={car.gears} min={4} max={8} step={1} unit="" onChange={(v) => set("gears", v)} />
                  <Range label="Relación final del diferencial" value={car.finalDrive} min={2.5} max={4.6} step={0.05} unit=":1" fmt={(v) => `${v.toFixed(2)}:1`} onChange={(v) => set("finalDrive", v)} />
                  <p className="text-xs text-muted-foreground">Corta = más aceleración. Larga = más velocidad final.</p>
                  <Group label="Tracción (eje motriz)">
                    {([["FWD", "Delantera"], ["RWD", "Trasera"], ["AWD", "Integral 4x4"]] as const).map(([k, l]) =>
                      <Pill key={k} active={car.drive === k} onClick={() => set("drive", k)}>{l}</Pill>)}
                  </Group>
                  <div className="flex flex-wrap gap-2 font-mono text-xs text-muted-foreground">
                    {gearRatios(car).map((r, i) => <span key={i} className="rounded bg-muted px-2 py-1">{i + 1}ª {r.toFixed(2)}</span>)}
                  </div>
                </Panel>
              )}
              {step === 3 && (
                <Panel title="Chasis y aerodinámica" hint="Material, neumáticos y carga aerodinámica.">
                  <Group label="Material">
                    {([["acero", "Acero"], ["aluminio", "Aluminio"], ["carbono", "Fibra de carbono"]] as const).map(([k, l]) =>
                      <Pill key={k} active={car.material === k} onClick={() => set("material", k)}>{l}</Pill>)}
                  </Group>
                  <Group label="Neumáticos">
                    {([["eco", "Eco"], ["deportivo", "Deportivos"], ["semi-slick", "Semi-slick"]] as const).map(([k, l]) =>
                      <Pill key={k} active={car.tires === k} onClick={() => set("tires", k)}>{l}</Pill>)}
                  </Group>
                  <Range label="Carga aerodinámica" value={car.downforce} min={0} max={1} step={0.05} unit="" fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set("downforce", v)} />
                  <Range label="Tamaño de llantas" value={car.wheelSize} min={15} max={22} step={1} unit="″" onChange={(v) => set("wheelSize", v)} />
                </Panel>
              )}
              {step === 4 && (
                <Panel title="Diseño y aspecto" hint="Carrocería, colores y detalles.">
                  <Group label="Carrocería">
                    {([["sedan", "Sedán"], ["coupe", "Coupé"], ["hiper", "Hiperauto"]] as const).map(([k, l]) =>
                      <Pill key={k} active={car.body === k} onClick={() => set("body", k)}>{l}</Pill>)}
                  </Group>
                  <div className="grid grid-cols-3 gap-3">
                    <Color label="Pintura" value={car.color} onChange={(v) => set("color", v)} />
                    <Color label="Detalles" value={car.accent} onChange={(v) => set("accent", v)} />
                    <Color label="Llantas" value={car.wheelColor} onChange={(v) => set("wheelColor", v)} />
                  </div>
                  <Group label="Extras">
                    <Pill active={car.spoiler} onClick={() => set("spoiler", !car.spoiler)}>Alerón</Pill>
                    <Pill active={car.stripes} onClick={() => set("stripes", !car.stripes)}>Franja lateral</Pill>
                  </Group>
                </Panel>
              )}
              <button onClick={install}
                className="mt-6 w-full rounded-md bg-primary py-3 font-display text-sm font-bold tracking-widest text-primary-foreground shadow-glow transition hover:brightness-110">
                {installed[step] ? "ACTUALIZAR Y SEGUIR →" : `INSTALAR ${STEPS[step].toUpperCase()} →`}
              </button>
            </div>
          ) : (
            <TestTrack car={car} />
          )}
        </section>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-4 font-display text-sm tracking-widest text-muted-foreground">FICHA TÉCNICA</h2>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Potencia" value={installed[1] ? `${s.hp}` : "—"} unit="CV" />
              <Stat label="Torque" value={installed[1] ? `${s.torqueNm}` : "—"} unit="Nm" />
              <Stat label="Peso" value={`${s.mass}`} unit="kg" />
              <Stat label="CV / tonelada" value={installed[1] ? `${s.hpPerTon}` : "—"} unit="" />
            </div>
            <ul className="mt-4 space-y-1 text-sm">
              <Row k="Motor" v={installed[1] ? `${car.layout} ${car.displacement.toFixed(1)}L ${car.aspiration}` : "Sin instalar"} />
              <Row k="Caja" v={installed[2] ? `${car.gears} vel. ${car.gearbox}` : "Sin instalar"} />
              <Row k="Tracción" v={installed[2] ? car.drive : "Sin instalar"} />
              <Row k="Chasis" v={installed[3] ? `${car.material}, ${car.tires}` : "Sin instalar"} />
              <Row k="Cx" v={s.cd.toFixed(2)} />
            </ul>
          </div>
          {!ready && <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">Instalá los 5 módulos para desbloquear la pista de pruebas.</p>}
        </aside>
      </main>
    </div>
  );
}

function BuildPreview({ car, installed }: { car: CarConfig; installed: boolean[] }) {
  const designed = installed[4];
  const shown: CarConfig = designed ? car : { ...car, color: "#3a3e46", accent: "#25282e", wheelColor: "#1c1e22", stripes: false, spoiler: false };
  return (
    <div className="relative">
      <CarSvg car={shown} className={`mx-auto w-full max-w-2xl transition ${designed ? "" : "opacity-60"}`} />
      {!designed && (
        <span className="absolute left-1/2 top-2 -translate-x-1/2 rounded bg-muted px-3 py-1 font-mono text-xs text-muted-foreground">
          CHASIS EN CONSTRUCCIÓN
        </span>
      )}
    </div>
  );
}

function TestTrack({ car }: { car: CarConfig }) {
  const [rivalIdx, setRivalIdx] = useState(1);
  const [res, setRes] = useState<{ me: Result; rival: Result } | null>(null);
  const [t, setT] = useState(0);
  const [running, setRunning] = useState(false);
  const raf = useRef(0);
  const rival = RIVALS[rivalIdx]!;

  const start = () => {
    const me = simulate(car), rv = simulate(rival.car);
    setRes({ me, rival: rv });
    setRunning(true);
    const t0 = performance.now();
    const end = Math.max(me.qmTime ?? 30, rv.qmTime ?? 30) + 0.5;
    const tick = () => {
      const now = (performance.now() - t0) / 1000;
      setT(now);
      if (now < end) raf.current = requestAnimationFrame(tick);
      else setRunning(false);
    };
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const at = (r: Result) => r.samples.find((x) => x.t >= t) ?? r.samples[r.samples.length - 1];
  const me = res ? at(res.me) : null;
  const rv = res ? at(res.rival) : null;
  const pos = (x: number) => `${Math.min(x / 402, 1) * 82}%`;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-bold">Pista de pruebas · ¼ de milla</h2>
          <div className="flex gap-2">
            {RIVALS.map((r, i) => <Pill key={r.name} active={rivalIdx === i} onClick={() => setRivalIdx(i)}>{r.name}</Pill>)}
          </div>
        </div>
        <div className="relative overflow-hidden rounded-lg bg-track">
          {[car, rival.car].map((c, lane) => {
            const smp = lane === 0 ? me : rv;
            return (
              <div key={lane} className="relative h-28 border-b border-border last:border-0">
                <div className={`absolute inset-x-0 top-1/2 h-1 road-lines opacity-30`} />
                <div className="absolute right-[6%] top-0 h-full w-2 bg-[repeating-linear-gradient(0deg,var(--foreground)_0_8px,var(--background)_8px_16px)]" />
                <div className="absolute bottom-1 w-[18%] transition-none" style={{ left: smp ? pos(smp.x) : "0%" }}>
                  <CarSvg car={c} spin={running} />
                </div>
                <span className="absolute left-2 top-2 font-mono text-[10px] text-muted-foreground">{lane === 0 ? car.name : rival.name}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <Stat label="Velocidad" value={me ? me.v.toFixed(0) : "0"} unit="km/h" big />
          <Stat label="RPM" value={me ? Math.round(me.rpm).toString() : "0"} unit="" big />
          <Stat label="Marcha" value={me ? `${me.gear}` : "N"} unit="" big />
        </div>
        <button onClick={start} disabled={running}
          className="mt-6 w-full rounded-md bg-primary py-3 font-display text-sm font-bold tracking-widest text-primary-foreground shadow-glow transition hover:brightness-110 disabled:opacity-50">
          {running ? "CORRIENDO…" : res ? "CORRER DE NUEVO" : "¡LARGAR!"}
        </button>
      </div>

      {res && !running && (
        <div className="grid gap-4 sm:grid-cols-2">
          <ResultCard title={car.name} r={res.me} win={(res.me.qmTime ?? 99) <= (res.rival.qmTime ?? 99)} />
          <ResultCard title={rival.name} r={res.rival} win={(res.rival.qmTime ?? 99) < (res.me.qmTime ?? 99)} />
        </div>
      )}
    </div>
  );
}

function ResultCard({ title, r, win }: { title: string; r: Result; win: boolean }) {
  const f = (v: number | null) => (v === null ? "—" : `${v.toFixed(2)} s`);
  return (
    <div className={`rounded-xl border bg-card p-5 ${win ? "border-accent" : "border-border"}`}>
      <div className="mb-3 flex items-center justify-between">
        <p className="font-display font-bold">{title}</p>
        {win && <span className="rounded bg-accent px-2 py-0.5 font-display text-[10px] text-accent-foreground">GANADOR</span>}
      </div>
      <ul className="space-y-1 text-sm">
        <Row k="0–100 km/h" v={f(r.t100)} />
        <Row k="0–200 km/h" v={f(r.t200)} />
        <Row k="¼ milla" v={`${f(r.qmTime)} @ ${r.qmSpeed?.toFixed(0) ?? "—"} km/h`} />
        <Row k="Velocidad máxima" v={`${r.topSpeed} km/h`} />
        <Row k="Puntaje" v={`${r.score}`} />
      </ul>
    </div>
  );
}

function Panel({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-lg font-bold">{title}</h2>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      {children}
    </div>
  );
}
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-sm text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick}
      className={`rounded-md border px-3 py-1.5 text-sm font-semibold transition ${active ? "border-primary bg-primary/15 text-primary" : "border-border hover:border-primary"}`}>
      {children}
    </button>
  );
}
function Choice({ active, onClick, title, desc }: { active: boolean; onClick: () => void; title: string; desc: string }) {
  return (
    <button onClick={onClick}
      className={`rounded-lg border p-4 text-left transition ${active ? "border-primary bg-primary/10 shadow-glow" : "border-border hover:border-primary"}`}>
      <p className="font-display font-bold">{title}</p>
      <p className="text-sm text-muted-foreground">{desc}</p>
    </button>
  );
}
function Range({ label, value, min, max, step, unit, onChange, fmt }: {
  label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void; fmt?: (v: number) => string;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-primary">{fmt ? fmt(value) : `${step < 1 ? value.toFixed(1) : value} ${unit}`}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-primary" />
    </label>
  );
}
function Color({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-sm text-muted-foreground">{label}</span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 h-10 w-full cursor-pointer rounded-md border border-input bg-background" />
    </label>
  );
}
function Stat({ label, value, unit, big }: { label: string; value: string; unit: string; big?: boolean }) {
  return (
    <div className="rounded-lg bg-muted p-3">
      <p className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={`font-display font-bold ${big ? "text-3xl" : "text-xl"}`}>{value}<span className="ml-1 text-xs text-muted-foreground">{unit}</span></p>
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <li className="flex justify-between gap-3 border-b border-border/50 py-1 last:border-0">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right font-semibold capitalize">{v}</span>
    </li>
  );
}
